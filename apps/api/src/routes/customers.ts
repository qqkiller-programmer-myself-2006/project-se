import bcrypt from "bcryptjs";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Store } from "../store.js";
import { toPublicCustomer, type PublicCustomer } from "../types.js";
import { ConflictError, NotFoundError } from "../types.js";
import { normalizeEmail, normalizeThaiPhone } from "../customer/phone.js";
import {
  customerLineLinkFailedEvent,
  customerLoginFailedEvent,
  type CustomerActor,
} from "../customer/audit-events.js";
import {
  DisabledLineProvider,
  LineDeauthorizeError,
  LineNotConfiguredError,
  type LineProvider,
} from "../line/adapter.js";
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateState,
  LINE_STATE_TTL_MS,
} from "../line/pkce.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: PublicCustomer;
      customerId?: string;
      customerSessionId?: string;
    }
  }
}

export interface CustomerMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  /** Owner/Admin เท่านั้น — ใช้ซ้ำกับจัดการร้าน (บทบาทเดียวกัน) */
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface CustomerRouterDeps {
  store: Store;
  middleware: CustomerMiddleware;
  clientIp: (req: Request) => string;
  /** LINE provider ที่ฉีดได้ (default: disabled → fail-fast 503; tests ใช้ fake) */
  line?: LineProvider;
  /** callback URL ที่ลงทะเบียนกับ LINE (ใช้ค่าเดียวทั้ง authorize และแลก code) */
  lineRedirectUri?: string;
  /** นาฬิกาแบบฉีดได้ (default: เวลาจริง) — เทสต์กำหนดหมดอายุ state ผ่าน seam นี้ */
  clock?: () => Date;
  cookieSecure?: boolean;
  /** จำนวนครั้งสูงสุดของ register+login ลูกค้าต่อ 15 นาทีต่อ IP (default 30) */
  customerRateMax?: number;
  /**
   * P2: base URL ของ customer web UI สำหรับ redirect หลัง LINE callback
   * (เช่น https://shop.example.com หรือ http://localhost:5173 — อ่านจาก CUSTOMER_UI_URL)
   * ไม่ตั้ง = same-origin fallback (redirect ไป path ภายใน + query status)
   */
  customerUiBaseUrl?: string;
}

/**
 * ปลายทาง redirect หลัง LINE callback — รับเฉพาะ internal allowlist
 * ห้ามรับ arbitrary URL จาก request เด็ดขาด
 */
export const LINE_REDIRECT_ALLOWLIST = ["/profile", "/customer/profile", "/line", "/customer/login", "/"] as const;
export const LINE_DEFAULT_REDIRECT = "/profile";

export function sanitizeLineRedirect(input: unknown): string {
  if (typeof input !== "string") return LINE_DEFAULT_REDIRECT;
  const v = input.trim();
  if ((LINE_REDIRECT_ALLOWLIST as readonly string[]).includes(v)) return v;
  return LINE_DEFAULT_REDIRECT;
}

/** reason codes ทั่วไปสำหรับ query หลัง callback — ห้ามใส่ code/token/secret/state/nonce/sub */
export type LineCallbackReason =
  | "cancelled"
  | "invalid_response"
  | "expired_or_used"
  | "exchange_failed"
  | "verify_failed"
  | "conflict"
  | "unavailable"
  | "internal";

/**
 * P2: สร้างเป้าหมาย redirect หลัง LINE callback
 * - path มาจาก allowlist ที่ sanitize แล้วเท่านั้น (redirectAfter)
 * - query มีเฉพาะ `line=linked` (สำเร็จ) หรือ `line=error&reason=<code>` (ล้มเหลว)
 * - ห้ามใส่ code/token/secret/state/nonce/sub ใน query เด็ดขาด
 * - ถ้า base (CUSTOMER_UI_URL) เป็น http(s) ที่ valid ให้ redirect ไป absolute URL
 *   ของ customer UI; ไม่เช่นนั้นใช้ same-origin fallback (relative path)
 */
export function buildLineCallbackRedirect(
  base: string | undefined,
  redirectAfter: string,
  outcome: { line: "linked" } | { line: "error"; reason: LineCallbackReason },
): string {
  const path = sanitizeLineRedirect(redirectAfter);
  const q = outcome.line === "linked" ? "line=linked" : `line=error&reason=${outcome.reason}`;
  const trimmedBase = (base ?? "").trim().replace(/\/+$/, "");
  if (trimmedBase) {
    try {
      const u = new URL(trimmedBase);
      if (u.protocol === "http:" || u.protocol === "https:") {
        const url = new URL(path, `${u.origin}/`);
        // เก็บเฉพาะ path ใน allowlist + query ที่ควบคุม — ไม่สะท้อน query ดิบจาก request
        return `${url.origin}${path}?${q}`;
      }
    } catch {
      // base ใช้ไม่ได้ → ตกไปใช้ same-origin fallback ด้านล่าง
    }
  }
  return `${path}?${q}`;
}

/** ปิดบังเบอร์ใน audit/log: 0812345678 → 08******78 (ไม่เก็บ PII เต็มในประวัติ) */
export function maskPhone(phone: string): string {
  if (phone.length < 4) return "****";
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

// bcrypt ตัดรหัสผ่านที่ 72 ไบต์แบบเงียบ — บังคับขีดเดียวกันทุกจุดเหมือนบัญชีพนักงาน
const MAX_PASSWORD_BYTES = 72;
const passwordTooLong = "รหัสผ่านต้องไม่เกิน 72 ไบต์";

const passwordSchema = z
  .string()
  .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
  .max(128, "รหัสผ่านต้องไม่เกิน 128 ตัวอักษร")
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_PASSWORD_BYTES, passwordTooLong);

const loginPasswordSchema = z
  .string()
  .min(1, "กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน")
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_PASSWORD_BYTES, passwordTooLong);

const nameSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุชื่อ")
  .max(120, "ชื่อต้องไม่เกิน 120 ตัวอักษร");

const CSID_COOKIE = "csid";

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

export function createCustomerRouter(deps: CustomerRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireCsrf, requireShopManager } = middleware;
  const line: LineProvider = deps.line ?? new DisabledLineProvider();
  const clock = deps.clock ?? (() => new Date());
  const cookieSecure = deps.cookieSecure ?? process.env["COOKIE_SECURE"] === "true";
  const lineRedirectUri = (deps.lineRedirectUri ?? process.env["LINE_REDIRECT_URI"] ?? "").trim();
  // P2: base URL ของ customer UI สำหรับ redirect หลัง callback (ไม่ตั้ง = same-origin fallback)
  const customerUiBaseUrl = (deps.customerUiBaseUrl ?? process.env["CUSTOMER_UI_URL"] ?? "").trim();
  const router = express.Router();

  const customerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: deps.customerRateMax ?? Number(process.env["CUSTOMER_RATE_MAX"] ?? 30),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "พยายามทำรายการมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  function setCustomerCookie(res: Response, sid: string): void {
    res.cookie(CSID_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  function clearCustomerCookie(res: Response): void {
    res.clearCookie(CSID_COOKIE, { path: "/", sameSite: "lax", secure: cookieSecure });
  }

  function customerActor(req: Request, customerId?: string): CustomerActor {
    return { actorId: customerId ?? null, actorUsername: null, ip: clientIp(req) };
  }

  /** session ลูกค้าแยกจาก staff โดยสิ้นเชิง (คุกกี้ csid vs sid, ตารางแยก, ไม่สวมสิทธิ์ข้ามกัน) */
  async function requireCustomerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sid = req.cookies?.[CSID_COOKIE] as string | undefined;
      if (!sid) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
        return;
      }
      const session = await store.findCustomerSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
        if (session) await store.deleteCustomerSession(sid);
        res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      const customer = await store.findCustomerById(session.customerId);
      if (!customer || !customer.isActive || customer.isDeleted) {
        await store.deleteCustomerSession(sid);
        res.status(401).json({ error: "บัญชีถูกปิดใช้งานหรือไม่มีอยู่ กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      if (session.passwordVersion !== customer.passwordVersion) {
        await store.deleteCustomerSession(sid);
        res.status(401).json({ error: "เซสชันถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      req.customer = toPublicCustomer(customer);
      req.customerId = customer.id;
      req.customerSessionId = session.id;
      next();
    } catch (err) {
      next(err);
    }
  }

  // ---------- สมัคร/เข้า-ออก/ตรวจ session ----------
  router.post("/api/customers/register", customerLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z
        .object({ name: nameSchema, phone: z.unknown(), password: passwordSchema, email: z.unknown().optional() })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let phone: string;
      let email: string | null;
      try {
        phone = normalizeThaiPhone(parsed.data.phone);
        email = normalizeEmail(parsed.data.email);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
        return;
      }
      const hash = await bcrypt.hash(parsed.data.password, 10);
      // P1 atomic: customer + initial session + audit (registered + login_success)
      // ใน Store seam เดียว — ห้ามแยกเรียกหลายขั้น
      const { customer: created, session } = await store.registerCustomerWithSession(
        { name: parsed.data.name, phone, email, passwordHash: hash },
        { ip: clientIp(req) },
      );
      setCustomerCookie(res, session.id);
      res.status(201).json({ customer: toPublicCustomer(created) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/customers/login", customerLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z.object({ phone: z.unknown(), password: loginPasswordSchema }).safeParse(req.body);
      if (!parsed.success) {
        const tooLong = parsed.error.issues.some((i) => i.message === passwordTooLong);
        res.status(400).json({ error: tooLong ? passwordTooLong : "กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน" });
        return;
      }
      let phone: string;
      try {
        phone = normalizeThaiPhone(parsed.data.phone);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
        return;
      }
      const masked = maskPhone(phone);
      const fail = async (detail: string, targetId?: string | null) => {
        await store.audit(
          customerLoginFailedEvent(detail, { actorUsername: masked, targetId, ip: clientIp(req) }),
        );
      };
      const customer = await store.findCustomerByPhone(phone);
      if (!customer || customer.isDeleted) {
        await fail("ไม่พบบัญชีลูกค้า");
        res.status(401).json({ error: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      if (!customer.isActive) {
        await fail("บัญชีถูกปิดใช้งาน", customer.id);
        res.status(403).json({ error: "บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อร้าน" });
        return;
      }
      const ok = await bcrypt.compare(parsed.data.password, customer.passwordHash);
      if (!ok) {
        await fail("รหัสผ่านไม่ถูกต้อง", customer.id);
        res.status(401).json({ error: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      // ปิด race แบบเดียวกับ staff: อ่านสดซ้ำหลัง compare หลักฐาน stale ถูกปฏิเสธ
      const fresh = await store.findCustomerById(customer.id);
      if (!fresh || !fresh.isActive || fresh.isDeleted || fresh.passwordHash !== customer.passwordHash) {
        await fail("ข้อมูล credential เปลี่ยนระหว่างเข้าสู่ระบบ", customer.id);
        res.status(401).json({ error: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      const session = await store.createCustomerSessionWithAudit(
        customer.id,
        fresh.passwordVersion,
        customerActor(req, customer.id),
      );
      setCustomerCookie(res, session.id);
      res.json({ customer: toPublicCustomer(customer) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/customers/logout", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      // P1 atomic: ลบ session + audit (customer_logout) ใน Store seam เดียว —
      // audit ล้มเหลว session ต้องคงอยู่ (ห้ามแยกเรียกหลายขั้น)
      await store.logoutCustomerSessionWithAudit(
        req.customerSessionId!,
        req.customerId!,
        customerActor(req, req.customerId),
      );
      clearCustomerCookie(res);
      res.json({ ok: true, message: "ออกจากระบบแล้ว" });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/customers/me", requireCustomerAuth, (req, res) => {
    res.json({ customer: req.customer });
  });

  /**
   * "ตอนนี้มี session ลูกค้าอยู่ไหม" — ตอบ 200 เสมอ
   *
   * `/api/customers/me` ตอบ 401 เมื่อไม่มี session ซึ่งถูกต้องสำหรับ endpoint
   * ที่ต้องล็อกอิน แต่หน้าเว็บสาธารณะต้องถามคำถามนี้ทุกครั้งที่โหลด และ
   * เบราว์เซอร์จะ log 401 เป็น error เสมอไม่ว่า JS จะจัดการแล้วหรือไม่ —
   * console ของ guest จึงเต็มไปด้วย error ปลอมจนกลบ error จริง
   *
   * ตัวนี้แยก "ไม่ได้ล็อกอิน" (คำตอบปกติ) ออกจาก "เข้าถึงไม่ได้" (error จริง)
   * session เสีย/หมดอายุถือว่ายังไม่ได้ล็อกอิน และเคลียร์คุกกี้ให้เลย
   */
  router.get("/api/customers/session", async (req, res, next) => {
    try {
      const sid = req.cookies?.[CSID_COOKIE] as string | undefined;
      if (!sid) {
        res.json({ customer: null });
        return;
      }
      const session = await store.findCustomerSession(sid);
      const customer = session ? await store.findCustomerById(session.customerId) : null;
      const valid =
        session !== null &&
        new Date(session.expiresAt).getTime() >= Date.now() &&
        customer !== null &&
        customer.isActive &&
        !customer.isDeleted &&
        session.passwordVersion === customer.passwordVersion;
      if (!valid) {
        // คุกกี้ค้างที่ใช้ไม่ได้แล้ว: ล้างทิ้ง ไม่ต้องให้ผู้ใช้ไปหาเองว่าทำไม
        if (session) await store.deleteCustomerSession(sid);
        clearCustomerCookie(res);
        res.json({ customer: null });
        return;
      }
      res.json({ customer: toPublicCustomer(customer) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- โปรไฟล์/รหัสผ่าน/ลบบัญชี ----------
  router.patch("/api/customers/me", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z
        .object({ name: nameSchema.optional(), email: z.unknown().optional() })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      if (parsed.data.name === undefined && parsed.data.email === undefined) {
        res.status(400).json({ error: "กรุณาระบุชื่อหรืออีเมลที่ต้องการแก้ไข" });
        return;
      }
      let email: string | null | undefined;
      if (parsed.data.email !== undefined) {
        try {
          email = normalizeEmail(parsed.data.email);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
          return;
        }
      }
      const updated = await store.updateCustomerProfile(
        req.customerId!,
        { ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}), ...(email !== undefined ? { email } : {}) },
        { actorId: req.customerId, ip: clientIp(req) },
      );
      res.json({ customer: toPublicCustomer(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/customers/change-password", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z
        .object({ currentPassword: z.string(), newPassword: passwordSchema })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const current = await store.findCustomerById(req.customerId!);
      if (!current || current.isDeleted) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      const ok = await bcrypt.compare(parsed.data.currentPassword, current.passwordHash);
      if (!ok) {
        res.status(400).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
        return;
      }
      const hash = await bcrypt.hash(parsed.data.newPassword, 10);
      await store.setCustomerPassword(current.id, hash, { actorId: current.id, ip: clientIp(req) });
      clearCustomerCookie(res);
      res.json({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่" });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/api/customers/me", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId!;
      const link = await store.getLineLink(customerId);
      if (link) {
        // P1: เรียก provider deauthorize ก่อนเสมอ — ล้มเหลวต้องคง local link ไว้
        // (ลบเฉพาะหลัง success) ยกเว้น Disabled provider (ไม่เคยตั้งค่าเลย ไม่มี
        // external auth ให้ revoke) ที่อนุญาตให้ทำความสะอาดภายในต่อได้
        try {
          await line.deauthorize(link.providerSubject);
        } catch (err) {
          if (err instanceof LineNotConfiguredError) {
            // ผู้ให้บริการถูกถอดการตั้งค่าภายหลัง — ลบความสัมพันธ์ภายในต่อได้
          } else {
            await store.audit(
              customerLineLinkFailedEvent(customerId, "แจ้งยกเลิกสิทธิ์กับ LINE ไม่สำเร็จ", customerActor(req, customerId)),
            );
            const status = err instanceof LineDeauthorizeError ? 502 : 500;
            res.status(status).json({ error: err instanceof Error ? err.message : "ลบบัญชีไม่สำเร็จ" });
            return;
          }
        }
      }
      await store.deleteCustomer(customerId, { actorId: customerId, ip: clientIp(req) });
      clearCustomerCookie(res);
      res.json({ ok: true, message: "ลบบัญชีแล้ว ข้อมูลส่วนบุคคลถูกทำเป็นนิรนาม" });
    } catch (err) {
      next(err);
    }
  });

  // ---------- LINE: เริ่ม/ callback /สถานะ/ยกเลิก ----------
  router.post("/api/customers/line/start", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId!;
      if (await store.getLineLink(customerId)) {
        res.status(409).json({ error: "บัญชีนี้เชื่อม LINE ไว้แล้ว" });
        return;
      }
      if (!lineRedirectUri) {
        res.status(503).json({ error: "ยังไม่เปิดใช้งานการเชื่อม LINE กรุณาลองใหม่ภายหลัง" });
        return;
      }
      const redirectAfter = sanitizeLineRedirect((req.body as { redirect?: unknown } | undefined)?.redirect);
      const state = generateState();
      const nonce = generateNonce();
      const codeVerifier = generateCodeVerifier();
      const now = clock();
      // fail-fast ก่อนเขียน state ใด ๆ: provider ไม่พร้อม → 503 โดยไม่มี tx/audit ค้าง
      let authorizeUrl: string;
      try {
        authorizeUrl = line.buildAuthorizeUrl({
          state,
          nonce,
          codeChallenge: codeChallengeS256(codeVerifier),
          redirectUri: lineRedirectUri,
        });
      } catch (err) {
        if (err instanceof LineNotConfiguredError) {
          res.status(503).json({ error: "ยังไม่เปิดใช้งานการเชื่อม LINE กรุณาลองใหม่ภายหลัง" });
          return;
        }
        throw err;
      }
      await store.createLineLoginTxWithAudit(
        {
          customerId,
          state,
          nonce,
          codeVerifier,
          redirectAfter,
          expiresAt: new Date(now.getTime() + LINE_STATE_TTL_MS).toISOString(),
        },
        customerActor(req, customerId),
      );
      res.status(201).json({ authorizeUrl });
    } catch (err) {
      next(err);
    }
  });

  // callback จาก LINE (public — ระบุตัวตนจาก state ที่ consume แบบ atomic, ห้ามเชื่อ body)
  // P2: ตอบเป็น redirect 302 ไป customer UI (CUSTOMER_UI_URL + allowlist path) หรือ
  // same-origin fallback พร้อม query `line=linked` / `line=error&reason=<code>` เท่านั้น —
  // ห้ามค้างเป็น JSON (stranded) และห้ามใส่ code/token/secret/state/nonce/sub ใน query
// P1 atomic: pre-check ด้วย peek (ไม่เปลี่ยน state) ก่อนแลก code; consume เกิดพร้อม
// audit ของผลลัพธ์ใน seam เดียวเท่านั้น (ล้มเหลว→consumeLineTxWithAudit,
// สำเร็จ→linkLineIdentityWithConsume ที่ผูก link + success audit + consume ใน
// transaction/seam เดียว) — ห้าม link แล้วค่อย consume แยกสองขั้น
// (consume แยก = linked-แต่-replay-ได้ / audit แยก = consumed-แต่-no-audit)
  router.get("/api/customers/line/callback", async (req, res, next) => {
    const go = (redirectAfter: string | null | undefined, outcome: { line: "linked" } | { line: "error"; reason: LineCallbackReason }) => {
      res.redirect(302, buildLineCallbackRedirect(customerUiBaseUrl, redirectAfter ?? LINE_DEFAULT_REDIRECT, outcome));
    };
    try {
      const now = clock();
      const state = typeof req.query["state"] === "string" ? req.query["state"] : "";
      const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
      const error = typeof req.query["error"] === "string" ? req.query["error"] : "";
      const failureActor = { ip: clientIp(req) };
      if (error || !state) {
        let redirectAfter: string | null = null;
        if (state) {
          const tx = await store.consumeLineTxWithAudit(state, now, failureActor, "ผู้ใช้ยกเลิกการเชื่อม LINE");
          if (tx) redirectAfter = tx.redirectAfter;
        }
        go(redirectAfter, { line: "error", reason: "cancelled" });
        return;
      }
      if (!code) {
        // consume state ทิ้งแบบ one-time พร้อม failure audit ใน seam เดียว (กัน replay)
        const tx = await store.consumeLineTxWithAudit(state, now, failureActor, "ข้อมูลจาก LINE ไม่ครบถ้วน");
        go(tx ? tx.redirectAfter : null, { line: "error", reason: "invalid_response" });
        return;
      }
      // pre-check แบบไม่ consume ก่อนแลก code (ใช้ซ้ำ/หมดอายุ → ปฏิเสธโดยไม่เขียน audit)
      const peeked = await store.peekLineTx(state, now);
      if (!peeked) {
        go(null, { line: "error", reason: "expired_or_used" });
        return;
      }
      // failure ทุกขั้นต่อจากนี้ต้อง consume พร้อม failure audit ใน seam เดียว (กัน consumed-แต่-no-audit)
      const failConsume = (detail: string) => store.consumeLineTxWithAudit(state, now, failureActor, detail);
      let idToken: string;
      try {
        const exchanged = await line.exchangeCode({ code, codeVerifier: peeked.codeVerifier, redirectUri: lineRedirectUri });
        idToken = exchanged.idToken;
        // accessToken ที่ได้ใช้แล้วทิ้งทันที — ห้าม persist (ไม่มีที่เก็บระยะยาวในรุ่นนี้)
      } catch (err) {
        const tx = await failConsume("แลก authorization code ไม่สำเร็จ");
        const redirectAfter = tx ? tx.redirectAfter : null;
        if (err instanceof LineNotConfiguredError) {
          go(redirectAfter, { line: "error", reason: "unavailable" });
          return;
        }
        go(redirectAfter, { line: "error", reason: "exchange_failed" });
        return;
      }
      let sub: string;
      let displayName: string | null;
      try {
        const claims = await line.verifyIdToken(idToken, peeked.nonce);
        sub = claims.sub;
        displayName = claims.name ?? null;
      } catch {
        const tx = await failConsume("ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ");
        go(tx ? tx.redirectAfter : null, { line: "error", reason: "verify_failed" });
        return;
      }
      // ห้ามรับ sub จาก request body — ใช้เฉพาะ claims ที่ adapter ยืนยันแล้ว
      // สำเร็จ: link + success audit + consume ใน seam เดียว (linkLineIdentityWithConsume)
      // ล้มเหลว→consume พร้อม failure audit ผ่าน consumeLineTxWithAudit
      try {
        const done = await store.linkLineIdentityWithConsume(
          state,
          now,
          { providerSubject: sub, displayName },
          { actorId: peeked.customerId, ip: clientIp(req) },
        );
        if (!done) {
          // แพ้ race: state ถูกใช้/หมดอายุหลัง peek — แยกสองกรณี ห้ามเดาว่าสำเร็จ
          // ชนะแล้วได้ link → success; แพ้โดยไม่มี link → expired_or_used (ไม่เขียน audit/consume ซ้ำ)
          const link = await store.getLineLink(peeked.customerId);
          if (link) {
            go(peeked.redirectAfter, { line: "linked" });
            return;
          }
          go(null, { line: "error", reason: "expired_or_used" });
          return;
        }
        go(done.tx.redirectAfter, { line: "linked" });
        return;
      } catch (err) {
        if (err instanceof ConflictError || err instanceof NotFoundError) {
          const tx = await failConsume(err instanceof Error ? err.message : "เชื่อม LINE ไม่สำเร็จ");
          const redirectAfter = tx ? tx.redirectAfter : null;
          go(redirectAfter, { line: "error", reason: err instanceof ConflictError ? "conflict" : "unavailable" });
          return;
        }
        // internal: failure audit ใช้ detail ทั่วไปเท่านั้น (ห้ามรั่วไหล error ภายใน)
        // (failConsume โยน error ต่อเมื่อ audit infra พัง → outer catch ตอบ 302 internal
        // โดย state ยังไม่ถูกใช้ จึง retry ได้)
        const tx = await failConsume("เชื่อม LINE ไม่สำเร็จ");
        go(tx ? tx.redirectAfter : null, { line: "error", reason: "internal" });
        return;
      }
    } catch {
      // callback ห้ามค้างเป็น JSON — redirect กลับพร้อม reason ทั่วไป (ไม่รั่วไหลรายละเอียดภายใน)
      go(null, { line: "error", reason: "internal" });
    }
  });

  router.get("/api/customers/line/status", requireCustomerAuth, async (req, res, next) => {
    try {
      const link = await store.getLineLink(req.customerId!);
      if (!link) {
        res.json({ linked: false });
        return;
      }
      res.json({ linked: true, displayName: link.displayName, linkedAt: link.linkedAt });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/customers/line/unlink", requireCustomerAuth, requireCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId!;
      const link = await store.getLineLink(customerId);
      if (!link) {
        res.status(404).json({ error: "บัญชีนี้ยังไม่ได้เชื่อม LINE" });
        return;
      }
      // P1: deauthorize ก่อนเสมอ — ล้มเหลวต้องคง local link ไว้ (ลบเฉพาะหลัง success)
      // ยกเว้น Disabled provider (LineNotConfiguredError) ที่ไม่มี external auth ให้ revoke
      try {
        await line.deauthorize(link.providerSubject);
      } catch (err) {
        if (!(err instanceof LineNotConfiguredError)) {
          await store.audit(
            customerLineLinkFailedEvent(customerId, "แจ้งยกเลิกสิทธิ์กับ LINE ไม่สำเร็จ", customerActor(req, customerId)),
          );
          const status = err instanceof LineDeauthorizeError ? 502 : 500;
          res.status(status).json({ error: err instanceof Error ? err.message : "ยกเลิกการเชื่อมไม่สำเร็จ" });
          return;
        }
      }
      await store.unlinkLineIdentity(customerId, { actorId: customerId, ip: clientIp(req) });
      res.json({ ok: true, message: "ยกเลิกการเชื่อม LINE แล้ว" });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: Owner/Admin จัดการบัญชีลูกค้า (safe fields เท่านั้น) ----------
  router.get("/api/admin/customers", middleware.requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20) || 20, 1), 100);
      const customers = await store.listCustomers(q, limit);
      const items = await Promise.all(
        customers.map(async (c) => ({ ...toPublicCustomer(c), lineLinked: (await store.getLineLink(c.id)) !== null })),
      );
      res.json({ customers: items });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/admin/customers/:id", middleware.requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const customer = await store.findCustomerById(req.params.id);
      if (!customer) {
        res.status(404).json({ error: "ไม่พบบัญชีลูกค้า" });
        return;
      }
      const link = await store.getLineLink(customer.id);
      res.json({
        customer: toPublicCustomer(customer),
        line: link ? { linked: true, displayName: link.displayName, linkedAt: link.linkedAt } : { linked: false },
      });
    } catch (err) {
      next(err);
    }
  });

  async function setCustomerActive(req: Request, res: Response, next: NextFunction, active: boolean) {
    try {
      const actor = req.user!;
      const updated = await store.setCustomerActive(req.params.id, active, {
        actorId: actor.id,
        actorUsername: actor.username,
        ip: clientIp(req),
      });
      res.json({ customer: toPublicCustomer(updated) });
    } catch (err) {
      next(err);
    }
  }

  router.post(
    "/api/admin/customers/:id/deactivate",
    middleware.requireAuth,
    requireCsrf,
    requireShopManager,
    (req, res, next) => setCustomerActive(req, res, next, false),
  );
  router.post(
    "/api/admin/customers/:id/activate",
    middleware.requireAuth,
    requireCsrf,
    requireShopManager,
    (req, res, next) => setCustomerActive(req, res, next, true),
  );

  router.get("/api/audit/customers", middleware.requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("customer_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
