import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  bangkokDayStartUtc,
  bangkokWallParts,
  maskName,
  maskPhone,
  type Store,
} from "../store.js";
import {
  normalizeBangkokDateOnly,
  normalizeFinanceAmount,
  normalizeFinanceCategory,
  normalizeFinanceCsvKind,
  normalizeFinanceGranularity,
  normalizeFinanceKind,
  normalizeFinanceNote,
  normalizeFinanceOccurredAt,
  normalizeFinanceRange,
  normalizeFinanceReason,
} from "../finance/validation.js";
import { ConflictError, FINANCE_CATEGORY_LABELS, NotFoundError } from "../types.js";

export interface FinanceMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface FinanceRouterDeps {
  store: Store;
  middleware: FinanceMiddleware;
  clientIp: (req: Request) => string;
  clock?: () => Date;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

/**
 * FINANCE_CSV_FORMAT (documented):
 * - Encoding: UTF-8 with BOM (\uFEFF) เพื่อให้ Excel ภาษาไทยเปิดแล้วอ่านออกเลย
 * - Line endings: CRLF (\r\n)
 * - Header ภาษาอังกฤษแถวแรกเสมอ; วันที่เป็น wall-clock กรุงเทพ (Asia/Bangkok)
 * - PII masking: เบอร์โทร → 08******12 (2 หลักแรก + 2 หลักสุดท้าย),
 *   ชื่อ → อักษรแรก + *** (เช่น ก***); บัญชีสมาชิกอ้างด้วยรหัสย่อ ไม่เปิดชื่อ/เบอร์
 * - kinds: sales (รายรับจาก paid payments หัก refunds), orders (คำสั่งซื้อ),
 *   finance (รายการเงินมือ), stock (วัตถุดิบคงเหลือ), queue (งานคิว)
 * - หมายเหตุขีดจำกัด: CSV อ่านสูงสุด 200 แถวต่อ kind (large datasets deferred —
 *   บันทึกเป็นงานภายหลัง ไม่รองรับ streaming/pagination เต็มรูปแบบในรุ่นนี้)
 */

const BKK_WALL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * รับ occurredAt ได้ 2 รูป:
 * - wall-clock กรุงเทพ "YYYY-MM-DDTHH:mm" (จาก input datetime-local) → แปลง −7 ชม. เป็น UTC ISO
 * - UTC ISO เต็ม (ลงท้าย Z หรือมี offset) → ใช้ instant นั้นตรง ๆ
 */
function parseOccurredAt(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) throw new Error("กรุณาระบุวันที่เกิดรายการ");
  const v = raw.trim();
  if (BKK_WALL_RE.test(v)) {
    const [d, t] = v.split("T") as [string, string];
    const [y, mo, dd] = d.split("-").map(Number) as [number, number, number];
    const [hh, mm] = t.split(":").map(Number) as [number, number];
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mm > 59) {
      throw new Error("วันเวลาที่ระบุเป็นไปไม่ได้ กรุณาตรวจสอบอีกครั้ง");
    }
    const probe = new Date(Date.UTC(y, mo - 1, dd, hh, mm));
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== dd ||
      probe.getUTCHours() !== hh ||
      probe.getUTCMinutes() !== mm
    ) {
      throw new Error("วันเวลาที่ระบุเป็นไปไม่ได้ กรุณาตรวจสอบอีกครั้ง");
    }
    return new Date(probe.getTime() - 7 * 3600_000).toISOString();
  }
  return normalizeFinanceOccurredAt(v);
}

/** แปลง UTC ISO เป็น wall-clock กรุงเทพ "YYYY-MM-DDTHH:mm" สำหรับ CSV */
function toBangkokWall(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const b = new Date(t + 7 * 3600_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}` +
    `T${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`
  );
}

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvBuild(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const entryBodySchema = z.object({
  kind: z.unknown(),
  category: z.unknown(),
  amount: z.unknown(),
  occurredAt: z.unknown(),
  note: z.unknown().optional(),
  reason: z.unknown(),
});

const entryPatchSchema = z.object({
  category: z.unknown().optional(),
  amount: z.unknown().optional(),
  occurredAt: z.unknown().optional(),
  note: z.unknown().optional(),
  reason: z.unknown(),
});

const entriesQuerySchema = z.object({
  kind: z.enum(["income", "expense"]).optional(),
  category: z.string().max(32).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  limit: z.string().max(10).optional(),
});

const reportQuerySchema = z.object({
  granularity: z.string().max(10).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

const dashboardQuerySchema = z.object({
  date: z.string().max(10).optional(),
});

const topMenusQuerySchema = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  limit: z.string().max(10).optional(),
});

const exportQuerySchema = z.object({
  kind: z.string().max(16).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

/**
 * Ticket 11 routes: รายการเงินมือ + รายงาน + Dashboard + วิเคราะห์ + CSV export
 * - กฎธุรกิจอยู่ใน finance/validation.ts (domain) และ store.ts (aggregation + audit)
 * - router ทำแค่ validate รูปทรง input, แปลง wall-clock กรุงเทพ ↔ UTC, ประกอบ DTO/CSV
 * - สิทธิ์: Owner/Admin เท่านั้น (requireShopManager) — Customer/kitchen/drink/Guest ถูกปฏิเสธที่ server
 */
export function createFinanceRouter(deps: FinanceRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const clock = deps.clock ?? (() => new Date());
  const router = express.Router();

  const financeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["FINANCE_RATE_MAX"] ?? 180),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอการเงินมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  function actorOf(req: Request): { actorId: string | null; actorUsername: string | null; ip: string | null } {
    return {
      actorId: (req.userId as string | undefined) ?? null,
      actorUsername: req.user?.username ?? null,
      ip: clientIp(req),
    };
  }

  /**
   * แยก error 2 ชั้นตาม convention ของ routes อื่น (เช่น payments/inventory):
   * - ConflictError/NotFoundError จาก store → next() (409/404 ผ่าน error handler กลาง)
   * - Error ทั่วไปจาก normalize/validation → 400 พร้อมข้อความไทย
   */
  function handleRouteError(res: Response, next: NextFunction, err: unknown): void {
    if (err instanceof ConflictError || err instanceof NotFoundError) {
      next(err);
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
  }

  function parseLimit(raw: unknown, fallback: number): number {
    return Math.min(Math.max(Number(raw ?? fallback) || fallback, 1), 200);
  }

  function rangeToOccurredAt(from?: string, to?: string): { fromOccurredAt?: string; toOccurredAt?: string } {
    if (from === undefined && to === undefined) return {};
    const today = bangkokWallParts(clock().toISOString()).date;
    const range = normalizeFinanceRange(from ?? today, to ?? from ?? today);
    return {
      fromOccurredAt: new Date(bangkokDayStartUtc(range.from)).toISOString(),
      toOccurredAt: new Date(new Date(bangkokDayStartUtc(range.to)).getTime() + 86400000 - 1).toISOString(),
    };
  }

  // ---------- รายการเงินมือ ----------
  router.post(
    "/api/finance/entries",
    financeLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = entryBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const kind = normalizeFinanceKind(parsed.data.kind);
        const entry = await store.createFinanceEntry(
          {
            kind,
            category: normalizeFinanceCategory(kind, parsed.data.category),
            amount: normalizeFinanceAmount(parsed.data.amount),
            occurredAt: parseOccurredAt(parsed.data.occurredAt),
            note: normalizeFinanceNote(parsed.data.note ?? null),
            reason: normalizeFinanceReason(parsed.data.reason),
          },
          actorOf(req),
          clock(),
        );
        res.status(201).json({ entry });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/finance/entries",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = entriesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const q = parsed.data;
        let kind: "income" | "expense" | undefined;
        if (q.kind) kind = normalizeFinanceKind(q.kind);
        let category: string | undefined;
        if (q.category) {
          const v = q.category.trim();
          if (!v) {
            res.status(400).json({ error: "กรุณาระบุหมวดหมู่" });
            return;
          }
          category = v;
        }
        const window = rangeToOccurredAt(q.from, q.to);
        const entries = await store.listFinanceEntries({
          kind,
          category: category as never,
          ...window,
          limit: parseLimit(q.limit, 50),
        });
        res.json({ entries });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/finance/entries/:id",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const entry = await store.getFinanceEntry(req.params.id);
        if (!entry) {
          res.status(404).json({ error: "ไม่พบรายการเงิน" });
          return;
        }
        res.json({ entry });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.patch(
    "/api/finance/entries/:id",
    financeLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = entryPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const current = await store.getFinanceEntry(req.params.id);
        if (!current) {
          res.status(404).json({ error: "ไม่พบรายการเงิน" });
          return;
        }
        const patch: {
          category?: never;
          amount?: number;
          occurredAt?: string;
          note?: string | null;
          reason: string;
        } = { reason: normalizeFinanceReason(parsed.data.reason) };
        if (parsed.data.category !== undefined) {
          patch.category = normalizeFinanceCategory(current.kind, parsed.data.category) as never;
        }
        if (parsed.data.amount !== undefined) {
          patch.amount = normalizeFinanceAmount(parsed.data.amount);
        }
        if (parsed.data.occurredAt !== undefined) {
          patch.occurredAt = parseOccurredAt(parsed.data.occurredAt);
        }
        if (parsed.data.note !== undefined) {
          patch.note = normalizeFinanceNote(parsed.data.note);
        }
        const entry = await store.updateFinanceEntry(req.params.id, patch, actorOf(req), clock());
        res.json({ entry });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.delete(
    "/api/finance/entries/:id",
    financeLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = z.object({ reason: z.unknown() }).safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        await store.deleteFinanceEntry(
          req.params.id,
          { reason: normalizeFinanceReason(parsed.data.reason) },
          actorOf(req),
        );
        res.json({ ok: true, message: "ลบรายการเงินแล้ว" });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- รายงาน ----------
  router.get(
    "/api/finance/reports",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = reportQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const today = bangkokWallParts(clock().toISOString()).date;
        const granularity = normalizeFinanceGranularity(parsed.data.granularity ?? "day");
        const range = normalizeFinanceRange(parsed.data.from ?? today, parsed.data.to ?? parsed.data.from ?? today);
        const report = await store.getFinanceReport({ granularity, ...range });
        res.json({ report });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- Dashboard ----------
  router.get(
    "/api/finance/dashboard",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = dashboardQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const date =
          parsed.data.date === undefined
            ? bangkokWallParts(clock().toISOString()).date
            : normalizeBangkokDateOnly(parsed.data.date, "วันที่");
        const dashboard = await store.getFinanceDashboard(date, clock());
        res.json({ dashboard });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- วิเคราะห์ ----------
  router.get(
    "/api/finance/analytics/top-menus",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = topMenusQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const today = bangkokWallParts(clock().toISOString()).date;
        const range = normalizeFinanceRange(parsed.data.from ?? today, parsed.data.to ?? parsed.data.from ?? today);
        const items = await store.getFinanceTopMenus({ ...range, limit: parseLimit(parsed.data.limit, 10) });
        res.json({ items });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/finance/analytics/peak-hours",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = topMenusQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const today = bangkokWallParts(clock().toISOString()).date;
        const range = normalizeFinanceRange(parsed.data.from ?? today, parsed.data.to ?? parsed.data.from ?? today);
        const hours = await store.getFinancePeakHours(range);
        res.json({ hours });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- CSV export (UTF-8 BOM + PII masking — ดู FINANCE_CSV_FORMAT) ----------
  router.get(
    "/api/finance/export",
    financeLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = exportQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const kind = normalizeFinanceCsvKind(parsed.data.kind ?? "sales");
        const today = bangkokWallParts(clock().toISOString()).date;
        const range = normalizeFinanceRange(parsed.data.from ?? today, parsed.data.to ?? parsed.data.from ?? today);
        const fromStart = new Date(bangkokDayStartUtc(range.from)).getTime();
        const toEnd = new Date(bangkokDayStartUtc(range.to)).getTime() + 86400000 - 1;
        const inWindow = (iso: string | null): boolean => {
          if (!iso) return false;
          const t = new Date(iso).getTime();
          return t >= fromStart && t <= toEnd;
        };

        let csv = "";
        let filename = `paor-${kind}-${range.from}_${range.to}.csv`;
        if (kind === "sales") {
          const payments = (await store.listPayments({ limit: 200 }))
            .filter((p) => (p.status === "paid" || p.status === "refunded") && inWindow(p.paidAt))
            .sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? ""));
          const refunds = await store.listRefunds(200);
          const refundByPayment = new Map(refunds.map((r) => [r.paymentId, r]));
          csv = csvBuild(
            ["order_number", "paid_at_bangkok", "method", "gross_amount", "refunded_amount", "net_amount", "receipt_number"],
            payments.map((p) => {
              const refund = refundByPayment.get(p.id);
              const refunded = refund && inWindow(refund.approvedAt) ? refund.amount : 0;
              return [
                p.orderNumber,
                toBangkokWall(p.paidAt ?? ""),
                p.method,
                p.amount,
                refunded,
                Math.round((p.amount - refunded) * 100) / 100,
                p.receiptNumber ?? "",
              ];
            }),
          );
        } else if (kind === "orders") {
          const orders = (await store.listOrders({ limit: 200 }))
            .filter((o) => inWindow(o.createdAt))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          csv = csvBuild(
            ["order_number", "created_at_bangkok", "service_type", "status", "customer_ref", "phone_masked", "total", "estimated_cost"],
            orders.map((o) => [
              o.orderNumber,
              toBangkokWall(o.createdAt),
              o.serviceType,
              o.status,
              o.customerId ? `member-${o.customerId.slice(-4)}` : maskName(o.guestName),
              maskPhone(o.guestPhone),
              o.total,
              o.estimatedCost,
            ]),
          );
        } else if (kind === "finance") {
          const window = rangeToOccurredAt(range.from, range.to);
          const entries = await store.listFinanceEntries({ ...window, limit: 200 });
          csv = csvBuild(
            ["id", "kind", "category", "category_th", "amount", "occurred_at_bangkok", "note", "reason", "actor"],
            entries.map((e) => [
              e.id,
              e.kind,
              e.category,
              FINANCE_CATEGORY_LABELS[e.category] ?? e.category,
              e.amount,
              toBangkokWall(e.occurredAt),
              e.note ?? "",
              e.reason,
              e.actorUsername ?? "",
            ]),
          );
        } else if (kind === "stock") {
          const items = await store.listIngredients({ includeDisabled: true });
          csv = csvBuild(
            ["ingredient", "unit", "on_hand", "reserved", "available", "reorder_threshold", "latest_cost", "enabled"],
            items.map((g) => [
              g.name,
              g.unit,
              g.onHand,
              g.reserved,
              Math.round((g.onHand - g.reserved) * 1000) / 1000,
              g.reorderThreshold,
              g.latestCost,
              g.isEnabled ? "yes" : "no",
            ]),
          );
          void range;
        } else {
          const jobs = (await store.listQueueJobs({ limit: 200 }))
            .filter((j) => inWindow(j.createdAt))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          csv = csvBuild(
            ["order_number", "station", "menu", "quantity", "ready_qty", "delivered_qty", "status", "ready_at_bangkok", "is_remake", "is_priority"],
            jobs.map((j) => [
              j.orderNumber,
              j.station,
              j.menuName,
              j.quantity,
              j.readyQty,
              j.deliveredQty,
              j.status,
              toBangkokWall(j.readyAt),
              j.isRemake ? "yes" : "no",
              j.isPriority ? "yes" : "no",
            ]),
          );
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get("/api/audit/finance", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("finance_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
