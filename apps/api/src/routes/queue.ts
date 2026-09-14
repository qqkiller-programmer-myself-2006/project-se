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
  normalizeCapacityPerSlot,
  normalizeQueueQty,
  normalizeQueueReason,
  normalizeQueueStatus,
  normalizeStation,
} from "../queue/validation.js";
import type { OrderDetail, QueueStation } from "../types.js";

export interface QueueMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface QueueRouterDeps {
  store: Store;
  middleware: QueueMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const listQuerySchema = z.object({
  station: z.enum(["kitchen", "drink"]).optional(),
  status: z
    .enum(["queued", "claimed", "preparing", "ready", "delivered", "cancelled"])
    .optional(),
  orderId: z.string().max(36).optional(),
  limit: z.string().max(10).optional(),
});

const qtyBodySchema = z.object({ qty: z.unknown() });
const reasonBodySchema = z.object({ reason: z.unknown() });
const remakeBodySchema = z.object({ reason: z.unknown(), quantity: z.unknown().optional() });
const capacityBodySchema = z.object({ station: z.unknown(), perSlot: z.unknown() });
const slotsQuerySchema = z.object({
  station: z.enum(["kitchen", "drink"]),
  date: z.string().max(10),
});
const nextSlotQuerySchema = z.object({
  station: z.enum(["kitchen", "drink"]),
  after: z.string().max(64),
});

/**
 * Ticket 09 routes: คิวครัว/เครื่องดื่ม + ส่งมอบ + กำลังผลิต/slot
 * - กฎธุรกิจอยู่ใน queue/validation.ts (domain) และ store.ts (lifecycle + audit + idempotency)
 * - router ทำแค่ validate รูปทรง input, แยกสิทธิ์ station, ประกอบ DTO
 * - role isolation ฝั่ง server: kitchen เห็น/ทำได้เฉพาะงานครัว, drink เฉพาะงานเครื่องดื่ม;
 *   owner/admin เห็นทั้งสองฝ่าย; ลูกค้า/Guest เห็นเฉพาะคำสั่งซื้อตนเอง
 */
export function createQueueRouter(deps: QueueRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  const queueLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["QUEUE_RATE_MAX"] ?? 180),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอคิวงานมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
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

  /** ฝ่ายของพนักงาน (kitchen/drink) — owner/admin คืน null = ทุกฝ่าย */
  function staffStation(roles: string[]): QueueStation | null {
    if (isManager(roles)) return null;
    if (roles.includes("kitchen") && roles.includes("drink")) return null;
    if (roles.includes("kitchen")) return "kitchen";
    if (roles.includes("drink")) return "drink";
    return null;
  }

  function staffActor(staff: { id: string; username: string }) {
    return { actorId: staff.id, actorUsername: staff.username, ip: clientIp };
  }

  /** ตรวจว่า caller มีสิทธิ์แตะ order นี้ (เจ้าของ / Guest เจ้าของเบอร์ / Owner/Admin) */
  async function canAccessOrder(
    req: Request,
    order: OrderDetail,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const staff = await resolveStaff(req);
    if (staff && isManager(staff.roles)) return { ok: true };
    const customer = await resolveCustomer(req);
    if (customer) {
      if (order.customerId !== customer.id) {
        return { ok: false, status: 403, error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของคำสั่งซื้อเท่านั้น" };
      }
      return { ok: true };
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
      return { ok: true };
    } catch {
      return { ok: false, status: 401, error: "กรุณาเข้าสู่ระบบหรือระบุเบอร์โทรที่ใช้สั่งซื้อ" };
    }
  }

  function requireStationStaff(
    req: Request,
    res: Response,
  ): Promise<{ id: string; username: string; roles: string[] } | null> {
    return resolveStaff(req).then((staff) => {
      if (!staff) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
        return null;
      }
      return staff;
    });
  }

  /**
   * บังคับ station isolation สำหรับ mutation งานคิว:
   * - owner/admin หรือมีทั้งสองฝ่าย → ทำได้ทุกงาน
   * - kitchen/drink เดี่ยว → ได้เฉพาะงานฝ่ายตน (ข้ามฝ่าย 403)
   */
  function assertStationAccess(
    roles: string[],
    jobStation: QueueStation,
    res: Response,
  ): boolean {
    const own = staffStation(roles);
    if (own && own !== jobStation) {
      res.status(403).json({ error: `สิทธิ์ไม่เพียงพอ งานนี้เป็นของฝ่าย${own === "kitchen" ? "เครื่องดื่ม" : "ครัว"}` });
      return false;
    }
    return true;
  }

  // ---------- รายการคิวของฝ่าย (พนักงานหลังร้าน — station isolation ฝั่ง server) ----------
  router.get("/api/queue", queueLimiter, async (req, res, next) => {
    try {
      const staff = await requireStationStaff(req, res);
      if (!staff) return;
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const own = staffStation(staff.roles);
      let station: QueueStation | undefined;
      try {
        if (parsed.data.station) station = normalizeStation(parsed.data.station);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ฝ่ายงานคิวไม่ถูกต้อง" });
        return;
      }
      // kitchen/drink เดี่ยว: ล็อกฝ่ายของตน; ขอฝ่ายอื่น → 403
      if (own) {
        if (station && station !== own) {
          res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ ดูได้เฉพาะคิวฝ่ายของตนเอง" });
          return;
        }
        station = own;
      }
      let status: ReturnType<typeof normalizeQueueStatus> | undefined;
      try {
        if (parsed.data.status) status = normalizeQueueStatus(parsed.data.status);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "สถานะงานคิวไม่ถูกต้อง" });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      const jobs = await store.listQueueJobs({
        station,
        status,
        orderId: parsed.data.orderId,
        limit,
      });
      res.json({ jobs });
    } catch (err) {
      next(err);
    }
  });

  // ---------- งานคิวของคำสั่งซื้อ (เจ้าของ/Guest เจ้าของเบอร์/Owner/Admin; station staff เห็นเฉพาะฝ่ายตน) ----------
  router.get("/api/queue/order/:orderId", queueLimiter, async (req, res, next) => {
    try {
      const order = await store.getOrder(req.params.orderId);
      if (!order) {
        res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
        return;
      }
      const access = await canAccessOrder(req, order);
      const staff = await resolveStaff(req);
      const stationStaff = staff && !isManager(staff.roles) ? staff : null;
      if (!access.ok && !stationStaff) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      let jobs = await store.listOrderQueueJobs(order.id);
      if (stationStaff) {
        const own = staffStation(stationStaff.roles);
        if (own) jobs = jobs.filter((j) => j.station === own);
      }
      res.json({ jobs, orderNumber: order.orderNumber });
    } catch (err) {
      next(err);
    }
  });

  // ---------- สร้าง jobs จาก payment ที่ paid แล้ว (idempotent — พนักงานหลังร้าน) ----------
  router.post(
    "/api/queue/ensure",
    queueLimiter,
    requireAuth,
    requireCsrf,
    async (req, res, next) => {
      try {
        const paymentId = typeof req.body?.paymentId === "string" ? req.body.paymentId.trim() : "";
        if (!paymentId) {
          res.status(400).json({ error: "กรุณาระบุรายการชำระเงิน" });
          return;
        }
        const actor = req.user!;
        const { jobs, deduplicated } = await store.ensureQueueJobs(
          paymentId,
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          new Date(),
        );
        res.status(deduplicated ? 200 : 201).json({ jobs, deduplicated });
      } catch (err) {
        next(err);
      }
    },
  );

  async function mutateJob(
    req: Request,
    res: Response,
    next: NextFunction,
    fn: (id: string, actor: { actorId: string; actorUsername: string; ip: string }) => Promise<unknown>,
    okKey: string,
  ): Promise<void> {
    try {
      const staff = await requireStationStaff(req, res);
      if (!staff) return;
      const job = await store.getQueueJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: "ไม่พบงานคิว" });
        return;
      }
      if (!assertStationAccess(staff.roles, job.station, res)) return;
      const out = await fn(
        req.params.id,
        { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) },
      );
      res.json({ [okKey]: out });
    } catch (err) {
      next(err);
    }
  }

  // ---------- รับงาน: queued → claimed ----------
  router.post("/api/queue/:id/claim", queueLimiter, requireCsrf, (req, res, next) =>
    mutateJob(req, res, next, (id, actor) => store.claimQueueJob(id, actor, new Date()), "job"),
  );

  // ---------- เริ่มทำ: claimed → preparing (+ ตัดสต๊อกจริงครั้งแรก ครั้งเดียว) ----------
  router.post("/api/queue/:id/start", queueLimiter, requireCsrf, (req, res, next) =>
    mutateJob(req, res, next, (id, actor) => store.startQueueJob(id, actor, new Date()), "job"),
  );

  // ---------- ทำเสร็จ (ทยอยได้): { qty } ----------
  router.post("/api/queue/:id/ready", queueLimiter, requireCsrf, async (req, res, next) => {
    const parsed = qtyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    let qty: number;
    try {
      qty = normalizeQueueQty(parsed.data.qty);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "จำนวนไม่ถูกต้อง" });
      return;
    }
    await mutateJob(req, res, next, (id, actor) => store.completeQueueJob(id, { qty }, actor, new Date()), "job");
  });

  // ---------- ส่งมอบ (ทยอยได้): { qty } ----------
  router.post("/api/queue/:id/deliver", queueLimiter, requireCsrf, async (req, res, next) => {
    const parsed = qtyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    let qty: number;
    try {
      qty = normalizeQueueQty(parsed.data.qty);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "จำนวนไม่ถูกต้อง" });
      return;
    }
    await mutateJob(req, res, next, (id, actor) => store.deliverQueueJob(id, { qty }, actor, new Date()), "job");
  });

  // ---------- เร่งงาน: { reason } ----------
  router.post("/api/queue/:id/priority", queueLimiter, requireCsrf, async (req, res, next) => {
    const parsed = reasonBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    let reason: string;
    try {
      reason = normalizeQueueReason(parsed.data.reason);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุเหตุผล" });
      return;
    }
    await mutateJob(req, res, next, (id, actor) => store.prioritizeQueueJob(id, { reason }, actor, new Date()), "job");
  });

  // ---------- ทำใหม่: { reason, quantity? } (ไม่คิดเงินซ้ำ) ----------
  router.post("/api/queue/:id/remake", queueLimiter, requireCsrf, async (req, res, next) => {
    const parsed = remakeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    let reason: string;
    let quantity: number | null = null;
    try {
      reason = normalizeQueueReason(parsed.data.reason);
      if (parsed.data.quantity !== undefined && parsed.data.quantity !== null) {
        quantity = normalizeQueueQty(parsed.data.quantity);
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลทำใหม่ไม่ถูกต้อง" });
      return;
    }
    await mutateJob(
      req,
      res,
      next,
      (id, actor) => store.remakeQueueJob(id, { reason, quantity }, actor, new Date()),
      "job",
    );
  });

  // ---------- ยกเลิกงานคิวบางรายการ: { reason } (เฉพาะก่อนเริ่มทำ) ----------
  router.post("/api/queue/:id/cancel", queueLimiter, requireCsrf, async (req, res, next) => {
    const parsed = reasonBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    let reason: string;
    try {
      reason = normalizeQueueReason(parsed.data.reason);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุเหตุผล" });
      return;
    }
    await mutateJob(req, res, next, (id, actor) => store.cancelQueueJob(id, { reason }, actor, new Date()), "job");
  });

  // ---------- กำลังผลิตต่อฝ่าย (พนักงานดูได้; ตั้งค่าเฉพาะ Owner/Admin) ----------
  router.get("/api/queue/capacity", queueLimiter, async (req, res, next) => {
    try {
      const staff = await requireStationStaff(req, res);
      if (!staff) return;
      res.json({
        capacities: [await store.getStationCapacity("kitchen"), await store.getStationCapacity("drink")],
      });
    } catch (err) {
      next(err);
    }
  });

  router.put("/api/queue/capacity", queueLimiter, requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = capacityBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let station: QueueStation;
      let perSlot: number;
      try {
        station = normalizeStation(parsed.data.station);
        perSlot = normalizeCapacityPerSlot(parsed.data.perSlot);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลกำลังผลิตไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      const capacity = await store.setStationCapacity(
        station,
        perSlot,
        { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        new Date(),
      );
      res.json({ capacity });
    } catch (err) {
      next(err);
    }
  });

  // ---------- สล็อต preorder 15 นาที + สล็อตว่างถัดไป (พนักงานหลังร้าน) ----------
  router.get("/api/queue/slots", queueLimiter, async (req, res, next) => {
    try {
      const staff = await requireStationStaff(req, res);
      if (!staff) return;
      const parsed = slotsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const own = staffStation(staff.roles);
      if (own && parsed.data.station !== own) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ ดูได้เฉพาะคิวฝ่ายของตนเอง" });
        return;
      }
      res.json({ slots: await store.listQueueSlots(parsed.data.station, parsed.data.date, new Date()) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/queue/slots/next", queueLimiter, async (req, res, next) => {
    try {
      const staff = await requireStationStaff(req, res);
      if (!staff) return;
      const parsed = nextSlotQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const own = staffStation(staff.roles);
      if (own && parsed.data.station !== own) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ ดูได้เฉพาะคิวฝ่ายของตนเอง" });
        return;
      }
      res.json({ slot: await store.suggestNextSlot(parsed.data.station, parsed.data.after, new Date()) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/audit/queue", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("queue_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
