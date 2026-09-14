import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Store } from "./store.js";
import { toPublicUser, type PublicUser, type Role } from "./types.js";
import { ConflictError, NotFoundError } from "./types.js";
import { createShopRouter } from "./routes/shop.js";
import { createCustomerRouter } from "./routes/customers.js";
import { createMenuRouter } from "./routes/menu.js";
import { createOrderRouter } from "./routes/orders.js";
import { createPaymentRouter } from "./routes/payments.js";
import { createQueueRouter } from "./routes/queue.js";
import { createInventoryRouter } from "./routes/inventory.js";
import { createReservationRouter } from "./routes/reservations.js";
import type { OccupancyProvider } from "./shop/occupancy.js";
import type { LineProvider } from "./line/adapter.js";

export interface AppOptions {
  store: Store;
  /** จำนวนครั้งสูงสุดที่ login ได้ต่อ 15 นาทีต่อ IP (ค่าเริ่มต้น 10) */
  loginRateMax?: number;
  cookieSecure?: boolean;
  /**
   * ที่อยู่ proxy ที่ไว้ใจให้อ่าน IP จริง (เช่น หลัง reverse proxy)
   * ค่าเริ่มต้น false (ไม่ไว้ใจ X-Forwarded-For ใด ๆ) ป้องกันการปลอม IP
   */
  trustedProxy?: string | string[] | boolean;
  /** นาฬิกาแบบฉีดได้สำหรับ Ticket 02 (default: เวลาจริง) — เทสต์กำหนดเวลาตายตัวผ่าน seam นี้ */
  now?: () => Date;
  /** snapshot จำนวนโต๊ะที่ใช้ + ผู้ใช้บริการ (default: zero — ยังไม่มี module รอบการใช้โต๊ะ) */
  occupancy?: OccupancyProvider;
  /** LINE provider สำหรับ Ticket 03 (default: disabled → fail-fast 503; tests ฉีด fake) */
  line?: LineProvider;
  /** callback URL ที่ลงทะเบียนกับ LINE (default: อ่าน LINE_REDIRECT_URI) */
  lineRedirectUri?: string;
  /**
   * P2: base URL ของ customer web UI สำหรับ redirect หลัง LINE callback
   * (default: อ่าน CUSTOMER_UI_URL; ไม่ตั้ง = same-origin fallback)
   */
  customerUiBaseUrl?: string;
  /** จำนวนครั้งสูงสุดของ register+login ลูกค้าต่อ 15 นาทีต่อ IP (default 30) */
  customerRateMax?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      userId?: string;
      sessionId?: string;
    }
  }
}

const usernameSchema = z
  .string()
  .min(3, "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร")
  .max(32, "ชื่อผู้ใช้ต้องไม่เกิน 32 ตัวอักษร")
  .regex(/^[A-Za-z0-9_.-]+$/, "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 _ . -");

// bcrypt ตัดรหัสผ่านที่ 72 ไบต์แบบเงียบ ๆ จึงบังคับขีดจำกัดระดับไบต์ (UTF-8)
// ให้สอดคล้องกันทุกจุดที่รับรหัสผ่าน เพื่อไม่ให้รหัสผ่านยาวถูกตัดโดยไม่รู้ตัว
const MAX_PASSWORD_BYTES = 72;
const passwordTooLong = "รหัสผ่านต้องไม่เกิน 72 ไบต์";

const passwordSchema = z
  .string()
  .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
  .max(128, "รหัสผ่านต้องไม่เกิน 128 ตัวอักษร")
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_PASSWORD_BYTES, passwordTooLong);

// ตอน login ไม่บังคับความยาวขั้นต่ำ (รหัสผิดให้ตอบ 401 ตามเดิม) แต่บังคับขีดไบต์เดียวกัน
const loginPasswordSchema = z
  .string()
  .min(1, "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน")
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_PASSWORD_BYTES, passwordTooLong);

// ชื่อผู้ใช้ตอน login จำกัดความยาวเพื่อกัน audit row โตเกินคอลัมน์ (VARCHAR 64)
const loginUsernameSchema = z
  .string()
  .min(1, "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน")
  .max(64, "ชื่อผู้ใช้ยาวเกินไป");

const rolesSchema = z
  .array(z.enum(["owner", "admin", "kitchen", "drink"]))
  .min(1, "ต้องกำหนดอย่างน้อย 1 บทบาท")
  .refine((roles) => new Set(roles).size === roles.length, "ห้ามกำหนดบทบาทซ้ำกัน");

const SID_COOKIE = "sid";
const CSRF_COOKIE = "csrf";
const CSRF_HEADER = "x-csrf-token";

function clientIp(req: Request): string {
  // ตั้งใจไม่แตะ X-Forwarded-For ดิบ: ใช้ req.ip ที่ Express คำนวณจากการตั้ง trust proxy เท่านั้น
  return req.ip ?? "unknown";
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

export function createApp(opts: AppOptions): express.Express {
  const { store } = opts;
  const app = express();
  app.disable("x-powered-by");
  // ค่าเริ่มต้นไม่ไว้ใจ proxy ใด ๆ; กำหนด explicit ผ่าน opts.trustedProxy เท่านั้นเมื่อจำเป็น
  app.set("trust proxy", opts.trustedProxy ?? false);
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: opts.loginRateMax ?? Number(process.env["LOGIN_RATE_MAX"] ?? 10),
    standardHeaders: true,
    legacyHeaders: false,
    // key เริ่มต้นของ express-rate-limit คือ req.ip (ไม่รวม X-Forwarded-For ดิบเมื่อ trust proxy=false)
    // ปิด validation ข้อนี้อย่างจงใจ: เราเพิกเฉย XFF เสมอเว้นแต่ตั้ง trustedProxy ชัดเจน
    validate: { xForwardedForHeader: false },
    message: { error: "พยายามเข้าสู่ระบบมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  function setSessionCookie(res: Response, sid: string): void {
    res.cookie(SID_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: opts.cookieSecure ?? process.env["COOKIE_SECURE"] === "true",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  function clearSessionCookie(res: Response): void {
    // ต้องตรงกับ setSessionCookie (path/sameSite/secure) ไม่เช่นนั้นเบราว์เซอร์
    // อาจไม่ลบคุกกี้ Secure ทิ้งเมื่อ COOKIE_SECURE=true
    res.clearCookie(SID_COOKIE, {
      path: "/",
      sameSite: "lax",
      secure: opts.cookieSecure ?? process.env["COOKIE_SECURE"] === "true",
    });
  }

  async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sid = req.cookies?.[SID_COOKIE] as string | undefined;
      if (!sid) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
        return;
      }
      const session = await store.findSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
        if (session) await store.deleteSession(sid);
        res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      const user = await store.findById(session.userId);
      if (!user || !user.isActive) {
        await store.deleteSession(sid);
        res.status(401).json({ error: "บัญชีถูกปิดใช้งานหรือไม่มีอยู่ กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      // เซสชันผูกกับรุ่น credential: reset/เปลี่ยนรหัสหลังสร้างเซสชันทำให้เซสชันเดิมใช้ไม่ได้
      // แม้แถว session จะยังไม่ถูกลบ (กัน reset/login race)
      if (session.passwordVersion !== user.passwordVersion) {
        await store.deleteSession(sid);
        res.status(401).json({ error: "เซสชันถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      req.user = toPublicUser(user);
      req.userId = user.id;
      req.sessionId = session.id;
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireCsrf(req: Request, res: Response, next: NextFunction): void {
    const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const headerToken = req.headers[CSRF_HEADER] as string | undefined;
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      res.status(403).json({ error: "โทเค็น CSRF ไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" });
      return;
    }
    next();
  }

  function requireOwner(req: Request, res: Response, next: NextFunction): void {
    if (!req.user?.roles.includes("owner")) {
      res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะ Owner เท่านั้น" });
      return;
    }
    next();
  }

  // Ticket 02: จัดการร้าน/โต๊ะ — Owner และ Admin เท่านั้น (kitchen/drink/guest ถูกปฏิเสธที่ server)
  function requireShopManager(req: Request, res: Response, next: NextFunction): void {
    const roles = req.user?.roles ?? [];
    if (!roles.includes("owner") && !roles.includes("admin")) {
      res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะ Owner หรือ Admin เท่านั้น" });
      return;
    }
    next();
  }

  const clock = opts.now ?? (() => new Date());

  // ---------- CSRF ----------
  app.get("/api/auth/csrf", (_req, res) => {
    const token = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: opts.cookieSecure ?? process.env["COOKIE_SECURE"] === "true",
      path: "/",
    });
    res.json({ csrfToken: token });
  });

  // ---------- Auth ----------
  // login ต้องมี CSRF token ด้วย (double-submit cookie) ป้องกัน login CSRF
  app.post("/api/auth/login", loginLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z
        .object({ username: loginUsernameSchema, password: loginPasswordSchema })
        .safeParse(req.body);
      if (!parsed.success) {
        const tooLong = parsed.error.issues.some((i) => i.message === passwordTooLong);
        res
          .status(400)
          .json({ error: tooLong ? passwordTooLong : "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
        return;
      }
      const { username, password } = parsed.data;
      const user = await store.findByUsername(username);
      if (!user) {
        await store.audit({
          actorUsername: username,
          action: "login_failed",
          targetUsername: username,
          detail: "ไม่พบชื่อผู้ใช้",
          ip: clientIp(req),
          success: false,
        });
        res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      if (!user.isActive) {
        await store.audit({
          actorId: user.id,
          actorUsername: user.username,
          action: "login_failed",
          targetId: user.id,
          targetUsername: user.username,
          detail: "บัญชีถูกปิดใช้งาน",
          ip: clientIp(req),
          success: false,
        });
        res.status(403).json({ error: "บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อ Owner" });
        return;
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        await store.audit({
          actorId: user.id,
          actorUsername: user.username,
          action: "login_failed",
          targetId: user.id,
          targetUsername: user.username,
          detail: "รหัสผ่านไม่ถูกต้อง",
          ip: clientIp(req),
          success: false,
        });
        res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      // ปิด reset/login race: อ่าน user สดอีกรอบหลัง compare ถ้า hash เปลี่ยนไป
      // (มี reset/เปลี่ยนรหัสคั่นกลาง) ให้ถือว่าหลักฐาน stale แล้วปฏิเสธ
      const fresh = await store.findById(user.id);
      if (!fresh || !fresh.isActive || fresh.passwordHash !== user.passwordHash) {
        await store.audit({
          actorId: user.id,
          actorUsername: user.username,
          action: "login_failed",
          targetId: user.id,
          targetUsername: user.username,
          detail: "ข้อมูล credential เปลี่ยนระหว่างเข้าสู่ระบบ",
          ip: clientIp(req),
          success: false,
        });
        res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        return;
      }
      // ผูกเซสชันกับรุ่น credential สด: ถ้ามี reset คั่นระหว่าง re-read กับการสร้าง
      // เซสชันนี้จะมี version เก่าและถูก requireAuth ปฏิเสธทันที (ใช้ไม่ได้)
      const session = await store.createSession(user.id, fresh.passwordVersion);
      setSessionCookie(res, session.id);
      await store.audit({
        actorId: user.id,
        actorUsername: user.username,
        action: "login_success",
        targetId: user.id,
        targetUsername: user.username,
        ip: clientIp(req),
        success: true,
      });
      res.json({ user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/logout", requireAuth, requireCsrf, async (req, res, next) => {
    try {
      if (req.sessionId) await store.deleteSession(req.sessionId);
      await store.audit({
        actorId: req.userId,
        actorUsername: req.user?.username,
        action: "logout",
        targetId: req.userId,
        targetUsername: req.user?.username,
        ip: clientIp(req),
        success: true,
      });
      clearSessionCookie(res);
      res.json({ ok: true, message: "ออกจากระบบแล้ว" });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  app.post("/api/auth/change-password", requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const parsed = z
        .object({ currentPassword: z.string(), newPassword: passwordSchema })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const current = await store.findById(req.userId!);
      if (!current) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" });
        return;
      }
      const ok = await bcrypt.compare(parsed.data.currentPassword, current.passwordHash);
      if (!ok) {
        res.status(400).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
        return;
      }
      const hash = await bcrypt.hash(parsed.data.newPassword, 10);
      await store.setPassword(current.id, hash);
      await store.deleteSessionsForUser(current.id);
      await store.audit({
        actorId: current.id,
        actorUsername: current.username,
        action: "password_changed",
        targetId: current.id,
        targetUsername: current.username,
        detail: "เปลี่ยนรหัสผ่านตนเอง",
        ip: clientIp(req),
        success: true,
      });
      clearSessionCookie(res);
      res.json({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่" });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Staff management (Owner คนเดียวเท่านั้น) ----------
  app.get("/api/users", requireAuth, requireOwner, async (_req, res, next) => {
    try {
      const users = await store.listUsers();
      res.json({ users: users.map(toPublicUser) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/users", requireAuth, requireCsrf, requireOwner, async (req, res, next) => {
    try {
      const parsed = z
        .object({
          username: usernameSchema,
          password: passwordSchema,
          roles: rolesSchema,
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const actor = req.user!;
      const roles = parsed.data.roles as Role[];
      if (roles.includes("owner")) {
        res.status(403).json({ error: "ไม่อนุญาตให้สร้าง Owner ผ่าน API สาธารณะ" });
        return;
      }
      const hash = await bcrypt.hash(parsed.data.password, 10);
      const created = await store.createUser({
        username: parsed.data.username,
        passwordHash: hash,
        roles,
      });
      await store.audit({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "user_created",
        targetId: created.id,
        targetUsername: created.username,
        detail: `บทบาท: ${roles.join(",")}`,
        ip: clientIp(req),
        success: true,
      });
      res.status(201).json({ user: toPublicUser(created) });
    } catch (err) {
      next(err);
    }
  });

  app.patch(
    "/api/users/:id/roles",
    requireAuth,
    requireCsrf,
    requireOwner,
    async (req, res, next) => {
      try {
        const parsed = rolesSchema.safeParse(req.body?.roles);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const actor = req.user!;
        const roles = parsed.data as Role[];
        const target = await store.findById(req.params.id);
        if (!target) {
          res.status(404).json({ error: "ไม่พบบัญชีผู้ใช้" });
          return;
        }
        if (roles.includes("owner")) {
          res.status(403).json({ error: "ไม่อนุญาตให้กำหนดบทบาท Owner ผ่าน API" });
          return;
        }
        if (target.roles.includes("owner") && !roles.includes("owner")) {
          const owners = await store.countOwners();
          if (owners <= 1) {
            res.status(403).json({ error: "ไม่สามารถถอดสิทธิ์ Owner คนสุดท้ายได้" });
            return;
          }
        }
        const updated = await store.updateUser(target.id, { roles });
        // บทบาทมีผลทันที: ยกเลิกเซสชันเดิมทั้งหมดของเป้าหมาย
        await store.deleteSessionsForUser(target.id);
        await store.audit({
          actorId: actor.id,
          actorUsername: actor.username,
          action: "roles_changed",
          targetId: target.id,
          targetUsername: target.username,
          detail: `${target.roles.join(",")} -> ${roles.join(",")}`,
          ip: clientIp(req),
          success: true,
        });
        res.json({ user: toPublicUser(updated) });
      } catch (err) {
        next(err);
      }
    },
  );

  async function setActive(req: Request, res: Response, next: NextFunction, active: boolean) {
    try {
      const actor = req.user!;
      const target = await store.findById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "ไม่พบบัญชีผู้ใช้" });
        return;
      }
      if (!active && target.roles.includes("owner")) {
        const owners = await store.countOwners();
        if (owners <= 1) {
          res.status(403).json({ error: "ไม่สามารถปิดบัญชี Owner คนสุดท้ายได้" });
          return;
        }
      }
      if (!active && target.id === actor.id) {
        res.status(403).json({ error: "ไม่สามารถปิดบัญชีของตนเองได้" });
        return;
      }
      const updated = await store.updateUser(target.id, { isActive: active });
      if (!active) await store.deleteSessionsForUser(target.id);
      await store.audit({
        actorId: actor.id,
        actorUsername: actor.username,
        action: active ? "user_activated" : "user_deactivated",
        targetId: target.id,
        targetUsername: target.username,
        ip: clientIp(req),
        success: true,
      });
      res.json({ user: toPublicUser(updated) });
    } catch (err) {
      next(err);
    }
  }

  app.post(
    "/api/users/:id/deactivate",
    requireAuth,
    requireCsrf,
    requireOwner,
    (req, res, next) => setActive(req, res, next, false),
  );
  app.post("/api/users/:id/activate", requireAuth, requireCsrf, requireOwner, (req, res, next) =>
    setActive(req, res, next, true),
  );

  app.post(
    "/api/users/:id/reset-password",
    requireAuth,
    requireCsrf,
    requireOwner,
    async (req, res, next) => {
      try {
        const parsed = z.object({ newPassword: passwordSchema }).safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const actor = req.user!;
        const target = await store.findById(req.params.id);
        if (!target) {
          res.status(404).json({ error: "ไม่พบบัญชีผู้ใช้" });
          return;
        }
        const hash = await bcrypt.hash(parsed.data.newPassword, 10);
        await store.setPassword(target.id, hash);
        await store.deleteSessionsForUser(target.id);
        await store.audit({
          actorId: actor.id,
          actorUsername: actor.username,
          action: "password_reset",
          targetId: target.id,
          targetUsername: target.username,
          detail: "Owner รีเซ็ตรหัสผ่าน",
          ip: clientIp(req),
          success: true,
        });
        res.json({ ok: true, message: "รีเซ็ตรหัสผ่านแล้ว เซสชันเดิมทั้งหมดถูกยกเลิก" });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- Audit (Owner เท่านั้น) ----------
  app.get("/api/audit/logins", requireAuth, requireOwner, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("login_", limit) });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/audit/accounts", requireAuth, requireOwner, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("account_", limit) });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Ticket 02 routes อยู่ใน routes/shop.ts (กฎธุรกิจอยู่ domain/store ห้าม duplicate ที่นี่)
  app.use(
    createShopRouter({
      store,
      clock,
      occupancy: opts.occupancy,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 04 routes อยู่ใน routes/menu.ts (validation อยู่ menu/validation.ts ห้าม duplicate ที่นี่)
  app.use(
    createMenuRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 05 routes อยู่ใน routes/orders.ts (validation อยู่ orders/validation.ts ห้าม duplicate ที่นี่)
  app.use(
    createOrderRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 06 routes อยู่ใน routes/reservations.ts (กฎธุรกิจอยู่ reservations/validation.ts + store)
  app.use(
    createReservationRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
      clock,
    }),
  );

  // Ticket 07 routes อยู่ใน routes/inventory.ts (กฎธุรกิจอยู่ inventory/validation.ts + store)
  app.use(
    createInventoryRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 08 routes อยู่ใน routes/payments.ts (กฎธุรกิจอยู่ payments/validation.ts + store)
  app.use(
    createPaymentRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 09 routes อยู่ใน routes/queue.ts (กฎธุรกิจอยู่ queue/validation.ts + store)
  app.use(
    createQueueRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
    }),
  );

  // Ticket 03 routes อยู่ใน routes/customers.ts (เบอร์ไทย/PKCE/claims อยู่ domain/adapters)
  app.use(
    createCustomerRouter({
      store,
      middleware: { requireAuth, requireCsrf, requireShopManager },
      clientIp,
      line: opts.line,
      lineRedirectUri: opts.lineRedirectUri,
      customerUiBaseUrl: opts.customerUiBaseUrl,
      clock,
      cookieSecure: opts.cookieSecure,
      customerRateMax: opts.customerRateMax,
    }),
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err && typeof err === "object" && "status" in err) {
      const status = Number((err as { status: number }).status) || 403;
      const message =
        "message" in err && typeof err.message === "string" ? err.message : "สิทธิ์ไม่เพียงพอ";
      res.status(status).json({ error: message });
      return;
    }
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  });

  return app;
}
