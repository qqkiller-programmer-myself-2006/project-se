import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Store } from "../store.js";
import { normalizeThaiPhone } from "../customer/phone.js";
import {
  normalizePaymentMethod,
  normalizePaymentReason,
  normalizeProviderEventId,
  normalizeProviderOutcome,
} from "../payments/validation.js";
import { isFakePaymentMode } from "../payments/provider.js";
import type { OrderDetail } from "../types.js";
import { enqueueBestEffort } from "./notifications.js";
import { paymentManualReviewEvent, paymentPaidEvent } from "../notify/events.js";
import type { ShopActor } from "../store.js";

export interface PaymentMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface PaymentRouterDeps {
  store: Store;
  middleware: PaymentMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const createBodySchema = z.object({
  orderId: z.unknown(),
  method: z.unknown(),
  idempotencyKey: z.unknown(),
  receivedAmount: z.unknown().optional(),
  slipRef: z.unknown().optional(),
});

const cashBodySchema = z.object({
  receivedAmount: z.unknown(),
  reason: z.unknown().optional(),
});

const webhookBodySchema = z.object({
  providerEventId: z.unknown(),
  outcome: z.unknown(),
  summary: z.unknown().optional(),
});

const slipBodySchema = z.object({
  slipRef: z.unknown(),
});

const resolveBodySchema = z.object({
  decision: z.unknown(),
  reason: z.unknown(),
});

const refundBodySchema = z.object({
  reason: z.unknown(),
});

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(["pending", "paid", "manual_review", "failed", "expired", "refunded", "cancelled"]).optional(),
  method: z.enum(["cash", "promptpay"]).optional(),
  limit: z.string().max(10).optional(),
});

const receiptQuerySchema = z.object({
  q: z.string().max(120).optional(),
  date: z.string().max(10).optional(),
  limit: z.string().max(10).optional(),
});

/**
 * Ticket 08 routes: สร้างคำขอชำระ ยืนยันเงินสด webhook/slip fake ตัดสิน manual_review
 * หมดอายุ ใบเสร็จ และคืนเงิน (Owner)
 * - กฎธุรกิจอยู่ใน payments/validation.ts (domain) และ store.ts (state machine + audit + receipt)
 * - router ทำแค่ validate รูปทรง input, แยก customer/guest/staff, ประกอบ DTO
 * - SlipOK/provider จริงเป็น contract-only: นอก fake mode ตอบ 503 (ไม่แตะ credentials จริง)
 */
export function createPaymentRouter(deps: PaymentRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["PAYMENT_RATE_MAX"] ?? 120),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอชำระเงินมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  /** อ่าน session ลูกค้าแบบ read-only (แยก customer/guest — ไม่ลบ session) */
  async function resolveCustomer(req: Request): Promise<{ id: string } | null> {
    try {
      const sid = req.cookies?.[CSID_COOKIE] as string | undefined;
      if (!sid) return null;
      const session = await store.findCustomerSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
      const customer = await store.findCustomerById(session.customerId);
      if (!customer || !customer.isActive || customer.isDeleted) return null;
      if (session.passwordVersion !== customer.passwordVersion) return null;
      return { id: customer.id };
    } catch {
      return null;
    }
  }

  /** อ่าน session พนักงานแบบ read-only */
  async function resolveStaff(req: Request): Promise<{ id: string; username: string; roles: string[] } | null> {
    try {
      const sid = req.cookies?.[SID_COOKIE] as string | undefined;
      if (!sid) return null;
      const session = await store.findSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
      const user = await store.findById(session.userId);
      if (!user || !user.isActive) return null;
      if (session.passwordVersion !== user.passwordVersion) return null;
      return { id: user.id, username: user.username, roles: user.roles };
    } catch {
      return null;
    }
  }

  function isManager(roles: string[]): boolean {
    return roles.includes("owner") || roles.includes("admin");
  }

  function isOwner(roles: string[]): boolean {
    return roles.includes("owner");
  }

  /**
   * Ticket 12: แจ้งเตือนผลชำระแบบ best-effort (ล้มเหลวไม่ rollback การชำระ):
   * paid → payment_paid, manual_review → payment_manual_review; สถานะอื่นไม่แจ้ง
   */
  async function notifyPaymentState(paymentId: string, actor: ShopActor, now: Date): Promise<void> {
    try {
      const payment = await store.getPayment(paymentId);
      if (!payment) return;
      if (payment.status !== "paid" && payment.status !== "manual_review") return;
      const order = await store.getOrder(payment.orderId);
      const customerId = order?.customerId ?? null;
      if (payment.status === "paid") {
        await enqueueBestEffort(
          store,
          paymentPaidEvent({
            paymentId: payment.id,
            orderId: payment.orderId,
            orderNumber: payment.orderNumber,
            amount: payment.amount,
            receiptNumber: payment.receiptNumber,
            customerId,
          }),
          actor,
          now,
        );
      } else {
        await enqueueBestEffort(
          store,
          paymentManualReviewEvent({
            paymentId: payment.id,
            orderId: payment.orderId,
            orderNumber: payment.orderNumber,
            customerId,
          }),
          actor,
          now,
        );
      }
    } catch {
      // ตั้งใจกลืน: ความล้มเหลวของ notify ต้องไม่กระทบ response การชำระ
    }
  }

  /** ตรวจว่า caller มีสิทธิ์แตะ payment ของออเดอร์นี้ (เจ้าของ / Guest เจ้าของเบอร์ / Owner/Admin) */
  async function canAccessOrder(
    req: Request,
    order: OrderDetail,
  ): Promise<{ ok: true; customerId: string | null } | { ok: false; status: number; error: string }> {
    const staff = await resolveStaff(req);
    if (staff && isManager(staff.roles)) return { ok: true, customerId: null };
    const customer = await resolveCustomer(req);
    if (customer) {
      if (order.customerId !== customer.id) {
        return { ok: false, status: 403, error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของคำสั่งซื้อเท่านั้น" };
      }
      return { ok: true, customerId: customer.id };
    }
    if (staff) {
      return { ok: false, status: 403, error: "สิทธิ์ไม่เพียงพอ เฉพาะ Owner หรือ Admin เท่านั้น" };
    }
    if (order.customerId !== null || order.guestPhone === null) {
      return { ok: false, status: 401, error: "กรุณาเข้าสู่ระบบก่อน" };
    }
    try {
      const phone = normalizeThaiPhone(req.query["phone"] ?? req.body?.phone ?? "");
      if (order.guestPhone !== phone) {
        return { ok: false, status: 403, error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของคำสั่งซื้อเท่านั้น" };
      }
      return { ok: true, customerId: null };
    } catch {
      return { ok: false, status: 401, error: "กรุณาเข้าสู่ระบบหรือระบุเบอร์โทรที่ใช้สั่งซื้อ" };
    }
  }

  // ---------- สร้างคำขอชำระ (ลูกค้าเจ้าของ/Guest เจ้าของเบอร์ หรือหลังร้าน) ----------
  router.post("/api/payments", paymentLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      if (typeof b.orderId !== "string" || !b.orderId.trim()) {
        res.status(400).json({ error: "กรุณาระบุคำสั่งซื้อที่ต้องการชำระ" });
        return;
      }
      let method: "cash" | "promptpay";
      try {
        method = normalizePaymentMethod(b.method);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "วิธีชำระเงินไม่ถูกต้อง" });
        return;
      }
      const order = await store.getOrder(b.orderId.trim());
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      let receivedAmount: number | null = null;
      if (b.receivedAmount !== undefined && b.receivedAmount !== null) {
        const n = typeof b.receivedAmount === "string" && b.receivedAmount.trim() !== "" ? Number(b.receivedAmount) : (b.receivedAmount as number);
        if (!Number.isFinite(n)) {
          res.status(400).json({ error: "จำนวนเงินที่รับมาต้องเป็นตัวเลข" });
          return;
        }
        receivedAmount = n;
      }
      const slipRef = typeof b.slipRef === "string" && b.slipRef.trim() ? b.slipRef.trim() : null;
      // ตรวจเงินสดเบื้องต้นที่ route (ยอดรู้แล้วจากคำสั่งซื้อ) ให้ได้ 400 แทน 500
      if (method === "cash" && receivedAmount !== null) {
        const tendered = Math.round(receivedAmount * 100) / 100;
        if (!(tendered > 0)) {
          res.status(400).json({ error: "จำนวนเงินที่รับมาต้องมากกว่าศูนย์" });
          return;
        }
        if (tendered < order.total) {
          res.status(400).json({ error: `เงินที่รับมา (${tendered} บาท) น้อยกว่ายอดชำระ (${order.total} บาท)` });
          return;
        }
      }
      const customer = await resolveCustomer(req);
      const staff = await resolveStaff(req);
      const actor = staff
        ? { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) }
        : customer
          ? { actorId: customer.id, ip: clientIp(req) }
          : { ip: clientIp(req) };
      const { payment, qrPayload, deduplicated } = await store.createPayment(
        {
          orderId: order.id,
          method,
          idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey : "",
          receivedAmount,
          slipRef,
        },
        actor,
        new Date(),
      );
      res.status(deduplicated ? 200 : 201).json({ payment, qrPayload, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ดู payment + สถานะการชำระของออเดอร์ ----------
  router.get("/api/orders/:id/payment", async (req, res, next) => {
    try {
      const order = await store.getOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const payment = await store.getOrderPayment(order.id);
      const paymentState = await store.getOrderPaymentState(order.id);
      res.json({ payment, paymentState });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/payments/:id", async (req, res, next) => {
    try {
      const payment = await store.getPayment(req.params.id);
      if (!payment) {
        res.status(404).json({ error: "ไม่พบรายการชำระเงิน" });
        return;
      }
      const order = await store.getOrder(payment.orderId);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const receipt = await store.getReceiptByPayment(payment.id);
      res.json({ payment, receipt });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ยืนยันรับเงินสด (หลังร้าน Owner/Admin) ----------
  router.post(
    "/api/payments/:id/confirm-cash",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = cashBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const n =
          typeof parsed.data.receivedAmount === "string" && parsed.data.receivedAmount.trim() !== ""
            ? Number(parsed.data.receivedAmount)
            : (parsed.data.receivedAmount as number);
        if (!Number.isFinite(n)) {
          res.status(400).json({ error: "จำนวนเงินที่รับมาต้องเป็นตัวเลข" });
          return;
        }
        // ตรวจเงินทอนติดลบที่ route ให้ได้ 400 (store ตรวจซ้ำแบบกันพลาด)
        const existing = await store.getPayment(req.params.id);
        if (existing && Math.round(n * 100) / 100 < existing.amount) {
          res.status(400).json({ error: `เงินที่รับมา (${n} บาท) น้อยกว่ายอดชำระ (${existing.amount} บาท)` });
          return;
        }
        const actor = req.user!;
        const { payment, receipt, deduplicated } = await store.confirmCashPayment(
          req.params.id,
          {
            receivedAmount: n,
            reason: typeof parsed.data.reason === "string" ? parsed.data.reason : null,
          },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        await notifyPaymentState(
          payment.id,
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        res.json({ payment, receipt, deduplicated });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- webhook ผู้ให้บริการ (fake signature seam — ไม่มี credentials จริง) ----------
  router.post("/api/payments/:id/webhook", paymentLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = webhookBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let providerEventId: string;
      let outcome: "success" | "ambiguous" | "fail";
      try {
        providerEventId = normalizeProviderEventId(parsed.data.providerEventId);
        outcome = normalizeProviderOutcome(parsed.data.outcome);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูล webhook ไม่ถูกต้อง" });
        return;
      }
      // fake mode ตรวจ header ลายเซ็นปลอม (ห้ามใช้ credentials จริง — มีเฉพาะโหมด fake)
      if (isFakePaymentMode()) {
        const sig = req.headers["x-fake-signature"];
        if (sig !== "fake") {
          res.status(401).json({ error: "ลายเซ็น webhook ไม่ถูกต้อง" });
          return;
        }
      } else {
        res.status(503).json({ error: "ผู้ให้บริการชำระเงินจริงยังไม่เปิดใช้งาน" });
        return;
      }
      const staff = await resolveStaff(req);
      const customer = await resolveCustomer(req);
      const actor = staff
        ? { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) }
        : customer
          ? { actorId: customer.id, ip: clientIp(req) }
          : { ip: clientIp(req) };
      const { payment, receipt, deduplicated } = await store.handlePaymentWebhook(
        req.params.id,
        {
          providerEventId,
          outcome,
          summary: typeof parsed.data.summary === "string" ? parsed.data.summary.slice(0, 500) : null,
        },
        actor,
        new Date(),
      );
      await notifyPaymentState(payment.id, actor, new Date());
      res.json({ payment, receipt, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ส่ง slip (fake verify — dev fake mode เท่านั้น) ----------
  router.post("/api/payments/:id/slip", paymentLimiter, requireCsrf, async (req, res, next) => {
    try {
      if (!isFakePaymentMode()) {
        res.status(503).json({ error: "ผู้ให้บริการตรวจ slip จริงยังไม่เปิดใช้งาน" });
        return;
      }
      const parsed = slipBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      if (typeof parsed.data.slipRef !== "string" || !parsed.data.slipRef.trim()) {
        res.status(400).json({ error: "กรุณาระบุเลขอ้างอิง slip" });
        return;
      }
      const payment = await store.getPayment(req.params.id);
      if (!payment) {
        res.status(404).json({ error: "ไม่พบรายการชำระเงิน" });
        return;
      }
      const order = await store.getOrder(payment.orderId);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const staff = await resolveStaff(req);
      const customer = await resolveCustomer(req);
      const actor = staff
        ? { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) }
        : customer
          ? { actorId: customer.id, ip: clientIp(req) }
          : { ip: clientIp(req) };
      const result = await store.submitPaymentSlip(
        req.params.id,
        { slipRef: parsed.data.slipRef.trim() },
        actor,
        new Date(),
      );
      await notifyPaymentState(result.payment.id, actor, new Date());
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ---------- ตัดสิน manual_review (หลังร้าน Owner/Admin) ----------
  router.post(
    "/api/payments/:id/resolve",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = resolveBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        if (parsed.data.decision !== "paid" && parsed.data.decision !== "failed" && parsed.data.decision !== "cancelled") {
          res.status(400).json({ error: "ผลการตัดสินไม่ถูกต้อง (สำเร็จ/ไม่สำเร็จ/ยกเลิก)" });
          return;
        }
        let reason: string;
        try {
          reason = normalizePaymentReason(parsed.data.reason);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุเหตุผล" });
          return;
        }
        const actor = req.user!;
        const { payment, receipt } = await store.resolveManualReview(
          req.params.id,
          { decision: parsed.data.decision, reason },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        await notifyPaymentState(
          payment.id,
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        res.json({ payment, receipt });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- หมดอายุ intent (หลังร้าน Owner/Admin) ----------
  router.post(
    "/api/payments/:id/expire",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const actor = req.user!;
        const { payment, deduplicated } = await store.expirePayment(
          req.params.id,
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        res.json({ payment, deduplicated });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- ใบเสร็จ: ของฉัน/Guest (เจ้าของเท่านั้น) ----------
  router.get("/api/receipts/by-payment/:paymentId", async (req, res, next) => {
    try {
      const payment = await store.getPayment(req.params.paymentId);
      if (!payment) {
        res.status(404).json({ error: "ไม่พบรายการชำระเงิน" });
        return;
      }
      const order = await store.getOrder(payment.orderId);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const receipt = await store.getReceiptByPayment(payment.id);
      if (!receipt) {
        res.status(404).json({ error: "รายการนี้ยังไม่มีใบเสร็จ (ยังชำระไม่สำเร็จ)" });
        return;
      }
      res.json({ receipt });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: ค้นหา payments/receipts/refunds + audit (Owner/Admin) ----------
  router.get("/api/payments", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      res.json({
        payments: await store.listPayments({
          q: parsed.data.q ?? "",
          status: parsed.data.status,
          method: parsed.data.method,
          limit,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/receipts", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = receiptQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      const date = typeof parsed.data.date === "string" && parsed.data.date.trim() ? parsed.data.date.trim() : undefined;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)" });
        return;
      }
      res.json({ receipts: await store.listReceipts({ q: parsed.data.q ?? "", date, limit }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/refunds", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50) || 50, 1), 200);
      res.json({ refunds: await store.listRefunds(limit) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- อนุมัติคืนเงิน (Owner เท่านั้น) ----------
  router.post(
    "/api/payments/:id/refund",
    requireAuth,
    requireCsrf,
    async (req, res, next) => {
      try {
        const roles = req.user?.roles ?? [];
        if (!roles.includes("owner")) {
          res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะ Owner เท่านั้นที่อนุมัติคืนเงินได้" });
          return;
        }
        const parsed = refundBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let reason: string;
        try {
          reason = normalizePaymentReason(parsed.data.reason);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุเหตุผล" });
          return;
        }
        const actor = req.user!;
        const { payment, refund } = await store.approveRefund(
          req.params.id,
          { reason },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        res.json({ payment, refund });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/api/audit/payments", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("payment_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
