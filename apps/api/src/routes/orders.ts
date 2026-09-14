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
  normalizeGuestName,
  normalizeIdempotencyKey,
  normalizeOrderLines,
  normalizeOrderStatus,
  normalizeScheduledAt,
  normalizeServiceType,
  normalizeStatusReason,
} from "../orders/validation.js";
import type { OrderDetail, OrderStatus } from "../types.js";

export interface OrderMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface OrderRouterDeps {
  store: Store;
  middleware: OrderMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const orderItemSchema = z.object({
  menuId: z.unknown(),
  quantity: z.unknown(),
  note: z.unknown().optional(),
});

const orderBodySchema = z.object({
  serviceType: z.unknown(),
  scheduledAt: z.unknown().optional(),
  items: z.array(orderItemSchema),
  guestName: z.unknown().optional(),
  guestPhone: z.unknown().optional(),
  idempotencyKey: z.unknown(),
  /** Ticket 06: ผูกคำสั่งซื้อที่โต๊ะกับรอบที่เปิดอยู่ (เฉพาะ dine_in) */
  tableId: z.unknown().optional(),
  roundId: z.unknown().optional(),
});

const statusPatchSchema = z.object({
  status: z.unknown(),
  reason: z.unknown(),
});

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(["pending_payment", "completed", "cancelled"]).optional(),
  limit: z.string().max(10).optional(),
});

/**
 * Ticket 05 routes: ตะกร้ายืนยันเป็นคำสั่งซื้อ + ติดตามสถานะ + จัดการหลังร้าน
 * - ตะกร้าเป็นข้อมูลชั่วคราวฝั่งเว็บ (localStorage) — server รับเฉพาะคำขอยืนยัน
 * - กฎธุรกิจอยู่ใน orders/validation.ts (domain) และ store.ts (snapshot + idempotency + audit)
 * - router ทำแค่ validate รูปทรง input, แยก customer/guest/staff, ประกอบ DTO
 */
export function createOrderRouter(deps: OrderRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["ORDER_RATE_MAX"] ?? 120),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำสั่งซื้อมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  /** อ่าน session ลูกค้าแบบ read-only (ไม่ลบ session — ไว้แยก customer/guest อย่างเดียว) */
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

  /** อ่าน session พนักงานแบบ read-only (ไว้ตรวจสิทธิ์ดูคำสั่งซื้อ — ไม่ลบ session) */
  async function resolveStaff(req: Request): Promise<{ id: string; roles: string[] } | null> {
    try {
      const sid = req.cookies?.[SID_COOKIE] as string | undefined;
      if (!sid) return null;
      const session = await store.findSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
      const user = await store.findById(session.userId);
      if (!user || !user.isActive) return null;
      if (session.passwordVersion !== user.passwordVersion) return null;
      return { id: user.id, roles: user.roles };
    } catch {
      return null;
    }
  }

  function isManager(roles: string[]): boolean {
    return roles.includes("owner") || roles.includes("admin");
  }

  async function requireCustomerStrict(req: Request, res: Response): Promise<string | null> {
    const c = await resolveCustomer(req);
    if (!c) {
      res.status(401).json({ error: "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน" });
      return null;
    }
    return c.id;
  }

  // ---------- ยืนยันตะกร้าเป็นคำสั่งซื้อ (public: สมาชิกหรือ Guest) ----------
  router.post("/api/orders", orderLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = orderBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      const now = new Date();
      // normalize ด้วย domain rules — error ไทยชัดเจน (ห้ามส่ง stack ภายใน)
      let input: {
        customerId: string | null;
        guestName?: string | null;
        guestPhone?: string | null;
        serviceType: "dine_in" | "takeaway" | "preorder";
        scheduledAt?: string | null;
        idempotencyKey: string;
        items: { menuId: string; quantity: number; note?: string | null }[];
        tableId?: string | null;
        roundId?: string | null;
      };
      try {
        const serviceType = normalizeServiceType(b.serviceType);
        const lines = normalizeOrderLines(b.items);
        const scheduledAt = normalizeScheduledAt(serviceType, b.scheduledAt ?? null, now);
        const idempotencyKey = normalizeIdempotencyKey(b.idempotencyKey);
        const customer = await resolveCustomer(req);
        // Ticket 06: linkage โต๊ะ/รอบส่งต่อให้ store ตรวจ (รอบต้องเปิด โต๊ะต้องตรงรอบ)
        const tableId = typeof b.tableId === "string" && b.tableId.trim() ? b.tableId.trim() : null;
        const roundId = typeof b.roundId === "string" && b.roundId.trim() ? b.roundId.trim() : null;
        if (customer) {
          input = {
            customerId: customer.id,
            serviceType,
            scheduledAt,
            idempotencyKey,
            items: lines.map((l) => ({ menuId: l.menuId, quantity: l.quantity, note: l.note })),
            tableId,
            roundId,
          };
        } else {
          // Guest: ต้องมีชื่อ+เบอร์ (normalize เบอร์ด้วยกฎ Ticket 03 เดียวกับสมัครสมาชิก)
          const guestName = normalizeGuestName(b.guestName);
          const guestPhone = normalizeThaiPhone(b.guestPhone ?? "");
          input = {
            customerId: null,
            guestName,
            guestPhone,
            serviceType,
            scheduledAt,
            idempotencyKey,
            items: lines.map((l) => ({ menuId: l.menuId, quantity: l.quantity, note: l.note })),
            tableId,
            roundId,
          };
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลคำสั่งซื้อไม่ถูกต้อง" });
        return;
      }
      const actor = input.customerId
        ? { actorId: input.customerId, ip: clientIp(req) }
        : { ip: clientIp(req) };
      const { order, deduplicated } = await store.createOrder(input, actor, now);
      res.status(deduplicated ? 200 : 201).json({ order, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- คำสั่งซื้อของฉัน (สมาชิก login แล้ว) ----------
  router.get("/api/orders/mine", async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50) || 50, 1), 200);
      res.json({ orders: await store.listCustomerOrders(customerId, limit) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ค้นหาคำสั่งซื้อ Guest ด้วยเลข + เบอร์ (เบอร์ไม่ตรงตอบ 404 เหมือนไม่พบ) ----------
  router.get("/api/orders/lookup", async (req, res, next) => {
    try {
      const number = typeof req.query["number"] === "string" ? req.query["number"].trim() : "";
      const phoneRaw = req.query["phone"];
      if (!number) {
        res.status(400).json({ error: "กรุณาระบุเลขคำสั่งซื้อ" });
        return;
      }
      let phone: string;
      try {
        phone = normalizeThaiPhone(phoneRaw ?? "");
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "เบอร์โทรศัพท์ไม่ถูกต้อง" });
        return;
      }
      const order: OrderDetail | null = await store.getOrderByNumber(number);
      if (!order || order.guestPhone !== phone) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ กรุณาตรวจเลขและเบอร์โทรอีกครั้ง" });
        return;
      }
      res.json({ order });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ดูคำสั่งซื้อเดียว (เจ้าของ / Guest เจ้าของเบอร์ / Owner/Admin) ----------
  router.get("/api/orders/:id", async (req, res, next) => {
    try {
      const order: OrderDetail | null = await store.getOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const staff = await resolveStaff(req);
      if (staff && isManager(staff.roles)) {
        res.json({ order });
        return;
      }
      const customer = await resolveCustomer(req);
      if (customer) {
        if (order.customerId !== customer.id) {
          res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของคำสั่งซื้อเท่านั้น" });
          return;
        }
        res.json({ order });
        return;
      }
      // พนักงานที่ไม่ใช่ Owner/Admin (kitchen/drink) ดูคำสั่งซื้อไม่ได้ — ปฏิเสธก่อนช่องทาง Guest
      if (staff) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะ Owner หรือ Admin เท่านั้น" });
        return;
      }
      // Guest ไม่มี session: ต้องแนบเบอร์เจ้าของมาด้วย (กันเห็นคำสั่งซื้อของผู้อื่น)
      const phoneRaw = req.query["phone"];
      if (order.customerId !== null || order.guestPhone === null) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
        return;
      }
      let phone: string;
      try {
        phone = normalizeThaiPhone(phoneRaw ?? "");
      } catch {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบหรือระบุเบอร์โทรที่ใช้สั่งซื้อ" });
        return;
      }
      if (order.guestPhone !== phone) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของคำสั่งซื้อเท่านั้น" });
        return;
      }
      res.json({ order });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: ค้นหา/ดูทั้งหมด (Owner/Admin — kitchen/drink/guest ถูกปฏิเสธที่ server) ----------
  router.get("/api/orders", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      const status = parsed.data.status as OrderStatus | undefined;
      res.json({
        orders: await store.listOrders({ q: parsed.data.q ?? "", status, limit }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: เปลี่ยนสถานะพร้อมเหตุผล + audit ก่อน/หลัง ----------
  router.patch(
    "/api/orders/:id/status",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = statusPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let status: OrderStatus;
        let reason: string;
        try {
          status = normalizeOrderStatus(parsed.data.status);
          if (status === "pending_payment") throw new Error("สถานะคำสั่งซื้อไม่ถูกต้อง");
          reason = normalizeStatusReason(parsed.data.reason);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
          return;
        }
        const actor = req.user!;
        const order = await store.updateOrderStatus(
          req.params.id,
          { status, reason },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        );
        res.json({ order });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/api/audit/orders", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("order_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
