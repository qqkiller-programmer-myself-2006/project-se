import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ShopActor, Store } from "../store.js";
import { normalizeThaiPhone } from "../customer/phone.js";
import { normalizeStation } from "../queue/validation.js";
import {
  normalizeModelVersion,
  normalizePredictionPartySize,
  normalizePredictionScheduledAt,
  normalizePredictionThreshold,
  normalizePredictionTimeoutMs,
  normalizeActualMinutes,
  waitRangeOf,
  computeStationWaitMin,
} from "../predict/validation.js";
import {
  DisabledPredictionProvider,
  predictWithFallback,
  type PredictionProvider,
} from "../predict/adapter.js";
import {
  ConflictError,
  NotFoundError,
  PREDICTION_NON_GUARANTEE,
  PREDICTION_SOURCE_LABELS,
  type OrderDetail,
  type QueueStation,
} from "../types.js";

export interface CapacityMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface CapacityRouterDeps {
  store: Store;
  middleware: CapacityMiddleware;
  clientIp: (req: Request) => string;
  clock?: () => Date;
  /** prediction adapter (default: disabled → fallback baseline; tests ฉีด fake) */
  predictor?: PredictionProvider | null;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const overviewQuerySchema = z.object({
  station: z.enum(["kitchen", "drink"]).optional(),
});

const waitQuerySchema = z.object({
  orderId: z.string().max(36).optional(),
  station: z.enum(["kitchen", "drink"]).optional(),
  partySize: z.unknown().optional(),
  phone: z.string().max(32).optional(),
});

const preorderCheckSchema = z.object({
  station: z.unknown(),
  scheduledAt: z.unknown(),
  partySize: z.unknown().optional(),
});

const modelBodySchema = z.object({
  version: z.unknown().optional(),
  kind: z.unknown().optional(),
  enabled: z.unknown().optional(),
  thresholdMinutes: z.unknown().optional(),
  timeoutMs: z.unknown().optional(),
});

const completeBodySchema = z.object({ actualMin: z.unknown() });

/**
 * Ticket 13 routes: ภาพรวมกำลังผลิต + เวลารอ + โมเดล/accuracy
 * - กฎธุรกิจอยู่ใน predict/validation.ts (pure) และ store.ts (seams + audit)
 * - router ทำแค่ validate รูปทรง input, แยกสิทธิ์, เรียก adapter พร้อม fallback
 * - role isolation ฝั่ง server: overview/model/accuracy เฉพาะ Owner/Admin
 *   (kitchen/drink ดู overview ฝ่ายตนได้); wait รายคำสั่งซื้อเฉพาะเจ้าของ/Guest เจ้าของเบอร์
 */
export function createCapacityRouter(deps: CapacityRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const clock = deps.clock ?? (() => new Date());
  const predictor = deps.predictor ?? new DisabledPredictionProvider();
  const router = express.Router();

  const capacityLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["CAPACITY_RATE_MAX"] ?? 180),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอข้อมูลความหนาแน่นมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  function handleRouteError(res: Response, next: NextFunction, err: unknown): void {
    if (err instanceof ConflictError || err instanceof NotFoundError) {
      next(err);
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
  }

  function staffActor(req: Request): ShopActor {
    return {
      actorId: (req.userId as string | undefined) ?? null,
      actorUsername: req.user?.username ?? null,
      ip: clientIp(req),
    };
  }

  /** อ่าน session ลูกค้าแบบ read-only (แยก customer/staff — ไม่ลบ session) */
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

  /** ตรวจว่า caller มีสิทธิ์ดูคำสั่งซื้อนี้ (เจ้าของ / Guest เจ้าของเบอร์ / Owner/Admin) */
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

  // ---------- ภาพรวมกำลังผลิต (พนักงานหลังร้าน — station isolation ฝั่ง server) ----------
  router.get("/api/capacity/overview", capacityLimiter, requireAuth, async (req, res, next) => {
    try {
      const roles = req.user?.roles ?? [];
      const own = staffStation(roles);
      const parsed = overviewQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let station: QueueStation | undefined;
      try {
        if (parsed.data.station) station = normalizeStation(parsed.data.station);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ฝ่ายงานไม่ถูกต้อง" });
        return;
      }
      // kitchen/drink เดี่ยว: ล็อกฝ่ายของตน; ขอฝ่ายอื่น → 403
      if (own) {
        if (station && station !== own) {
          res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ ดูได้เฉพาะข้อมูลฝ่ายของตนเอง" });
          return;
        }
        station = own;
      }
      const now = clock();
      const overview = await store.getCapacityOverview(now);
      res.json({
        overview: station ? { ...overview, stations: overview.stations.filter((s) => s.station === station) } : overview,
        sourceLabels: PREDICTION_SOURCE_LABELS,
        nonGuarantee: PREDICTION_NON_GUARANTEE,
      });
    } catch (err) {
      handleRouteError(res, next, err);
    }
  });

  // ---------- เวลารอ (รายคำสั่งซื้อสำหรับเจ้าของ / รายฝ่ายสาธารณะแบบไม่ระบุตัวตน) ----------
  router.get("/api/capacity/wait", capacityLimiter, async (req, res, next) => {
    try {
      const parsed = waitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const now = clock();
      let partySize = 2;
      try {
        partySize = normalizePredictionPartySize(parsed.data.partySize);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "จำนวนผู้ใช้บริการไม่ถูกต้อง" });
        return;
      }

      // รายคำสั่งซื้อ: ต้องเป็นเจ้าของ/Guest เจ้าของเบอร์/Owner/Admin
      if (parsed.data.orderId) {
        const order = await store.getOrder(parsed.data.orderId);
        if (!order) {
          res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
          return;
        }
        const access = await canAccessOrder(req, order);
        if (!access.ok) {
          res.status(access.status).json({ error: access.error });
          return;
        }
        const baseline = await store.estimateOrderWaitBaseline(order.id, partySize, now);
        const model = await store.getPredictionModel();
        const totalAhead = baseline.perStation.reduce((s, p) => s + p.queueAhead, 0);
        const totalUnits = baseline.perStation.reduce((s, p) => s + p.unitsAhead, 0);
        const decided = await predictWithFallback(
          predictor,
          model.enabled,
          {
            orderId: order.id,
            station: null,
            partySize,
            queueAhead: totalAhead,
            unitsAhead: totalUnits,
            baselineMin: baseline.estimatedWaitMin,
          },
          { timeoutMs: model.timeoutMs },
        );
        const { rangeMin, rangeMax } = waitRangeOf(decided.waitMin);
        const staff = await resolveStaff(req);
        const customer = staff ? null : await resolveCustomer(req);
        const actor: ShopActor = staff
          ? { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) }
          : customer
            ? { actorId: customer.id, actorUsername: null, ip: clientIp(req) }
            : { actorId: null, actorUsername: null, ip: clientIp(req) };
        const recorded = await store.recordPredictionFeature(
          {
            orderId: order.id,
            station: null,
            partySize,
            baselineMin: baseline.estimatedWaitMin,
            predictedMin: decided.source === "model" ? decided.waitMin : null,
            source: decided.source,
            modelVersion: decided.modelVersion,
          },
          actor,
          now,
        );
        res.json({
          estimate: {
            ...baseline,
            estimatedWaitMin: decided.waitMin,
            rangeMin,
            rangeMax,
            source: decided.source,
            modelVersion: decided.modelVersion,
            predictedAt: now.toISOString(),
            timeoutMs: model.timeoutMs,
          },
          featureId: recorded.id,
          sourceLabels: PREDICTION_SOURCE_LABELS,
        });
        return;
      }

      // รายฝ่ายสาธารณะ: ไม่ต้อง login (ข้อมูลรวม ไม่มี PII)
      if (parsed.data.station) {
        let station: QueueStation;
        try {
          station = normalizeStation(parsed.data.station);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ฝ่ายงานไม่ถูกต้อง" });
          return;
        }
        const overview = await store.getCapacityOverview(now);
        const summary = overview.stations.find((s) => s.station === station)!;
        const model = await store.getPredictionModel();
        const decided = await predictWithFallback(
          predictor,
          model.enabled,
          {
            orderId: null,
            station,
            partySize,
            queueAhead: summary.activeJobs,
            unitsAhead: summary.unitsAhead,
            baselineMin: summary.estimatedWaitMin,
          },
          { timeoutMs: model.timeoutMs },
        );
        const { rangeMin, rangeMax } = waitRangeOf(decided.waitMin);
        const recorded = await store.recordPredictionFeature(
          {
            orderId: null,
            station,
            partySize,
            baselineMin: summary.estimatedWaitMin,
            predictedMin: decided.source === "model" ? decided.waitMin : null,
            source: decided.source,
            modelVersion: decided.modelVersion,
          },
          { actorId: null, actorUsername: null, ip: clientIp(req) },
          now,
        );
        res.json({
          estimate: {
            orderId: null,
            station,
            partySize,
            perStation: [
              {
                station,
                jobs: summary.activeJobs,
                queueAhead: summary.activeJobs,
                unitsAhead: summary.unitsAhead,
                estimatedWaitMin: summary.estimatedWaitMin,
              },
            ],
            estimatedWaitMin: decided.waitMin,
            rangeMin,
            rangeMax,
            readyAtSlowest: null,
            source: decided.source,
            modelVersion: decided.modelVersion,
            predictedAt: now.toISOString(),
            timeoutMs: model.timeoutMs,
            nonGuarantee: PREDICTION_NON_GUARANTEE,
          },
          featureId: recorded.id,
          sourceLabels: PREDICTION_SOURCE_LABELS,
        });
        return;
      }

      res.status(400).json({ error: "กรุณาระบุเลขคำสั่งซื้อ (orderId) หรือฝ่ายงาน (station)" });
    } catch (err) {
      handleRouteError(res, next, err);
    }
  });

  // ---------- ตรวจสล็อตล่วงหน้า (สาธารณะ — ใช้ประกอบการจอง/preorder) ----------
  router.post("/api/capacity/preorder-check", capacityLimiter, async (req, res, next) => {
    try {
      const parsed = preorderCheckSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const now = clock();
      let check;
      try {
        const station = normalizeStation(parsed.data.station);
        const scheduledAt = normalizePredictionScheduledAt(parsed.data.scheduledAt, now);
        const partySize = normalizePredictionPartySize(parsed.data.partySize);
        check = await store.checkPreorderSlot(station, scheduledAt, partySize, now);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลสล็อตไม่ถูกต้อง" });
        return;
      }
      res.json({ check, nonGuarantee: PREDICTION_NON_GUARANTEE });
    } catch (err) {
      handleRouteError(res, next, err);
    }
  });

  // ---------- รุ่นโมเดล (Owner/Admin) ----------
  router.get("/api/predictions/model", capacityLimiter, requireAuth, requireShopManager, async (_req, res, next) => {
    try {
      res.json({ model: await store.getPredictionModel(), sourceLabels: PREDICTION_SOURCE_LABELS });
    } catch (err) {
      handleRouteError(res, next, err);
    }
  });

  router.put(
    "/api/predictions/model",
    capacityLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = modelBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const patch: { version?: string; kind?: "baseline" | "external"; enabled?: boolean; thresholdMinutes?: number; timeoutMs?: number } = {};
        try {
          if (parsed.data.version !== undefined) patch.version = normalizeModelVersion(parsed.data.version);
          if (parsed.data.kind !== undefined) {
            if (parsed.data.kind !== "baseline" && parsed.data.kind !== "external") {
              res.status(400).json({ error: "ชนิดโมเดลต้องเป็น baseline หรือ external" });
              return;
            }
            patch.kind = parsed.data.kind;
          }
          if (parsed.data.enabled !== undefined) {
            if (typeof parsed.data.enabled !== "boolean") {
              res.status(400).json({ error: "ค่า enabled ต้องเป็น true หรือ false" });
              return;
            }
            patch.enabled = parsed.data.enabled;
          }
          if (parsed.data.thresholdMinutes !== undefined) {
            patch.thresholdMinutes = normalizePredictionThreshold(parsed.data.thresholdMinutes);
          }
          if (parsed.data.timeoutMs !== undefined) {
            patch.timeoutMs = normalizePredictionTimeoutMs(parsed.data.timeoutMs);
          }
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลโมเดลไม่ถูกต้อง" });
          return;
        }
        // เปิด external ต้องผ่านเกณฑ์ accuracy ก่อน (AT18: ดีกว่า baseline บนชุดเดียวกัน)
        const nextEnabled = patch.enabled ?? (await store.getPredictionModel()).enabled;
        const nextKind = patch.kind ?? (await store.getPredictionModel()).kind;
        if (nextKind === "external" && nextEnabled) {
          const accuracy = await store.getPredictionAccuracy(clock());
          if (!accuracy.meetsThreshold) {
            res.status(409).json({
              error: "โมเดลยังไม่ผ่านเกณฑ์ (ต้องดีกว่า baseline บนชุดทดสอบเดียวกันก่อนเปิดใช้)",
              accuracy: {
                samples: accuracy.samples,
                maeBaseline: accuracy.maeBaseline,
                maeModel: accuracy.maeModel,
              },
            });
            return;
          }
        }
        const model = await store.setPredictionModel(patch, staffActor(req), clock());
        res.json({ model });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- ความแม่นยำ + features (Owner/Admin) ----------
  router.get(
    "/api/predictions/accuracy",
    capacityLimiter,
    requireAuth,
    requireShopManager,
    async (_req, res, next) => {
      try {
        res.json({ accuracy: await store.getPredictionAccuracy(clock()), sourceLabels: PREDICTION_SOURCE_LABELS });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.post(
    "/api/predictions/evaluate",
    capacityLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        res.json({ accuracy: await store.evaluatePredictions(staffActor(req), clock()) });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/predictions/features",
    capacityLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50) || 50, 1), 200);
        res.json({ features: await store.listPredictionFeatures(limit) });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.post(
    "/api/predictions/features/:id/complete",
    capacityLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = completeBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let actualMin: number;
        try {
          actualMin = normalizeActualMinutes(parsed.data.actualMin);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "เวลาจริงไม่ถูกต้อง" });
          return;
        }
        const out = await store.completePredictionFeature(req.params.id, actualMin, staffActor(req), clock());
        res.json(out);
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get("/api/audit/predictions", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("prediction_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** baseline ต่อฝ่ายสำหรับ UI ที่ไม่ผ่าน store (เช่น preorder-check fallback) — export ให้ tests ใช้ */
export function stationBaselineForUi(station: QueueStation, queueAhead: number, partySize: number): number {
  return computeStationWaitMin(station, queueAhead, partySize);
}
