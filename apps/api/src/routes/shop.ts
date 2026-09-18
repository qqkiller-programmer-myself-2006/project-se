import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { Store } from "../store.js";
import { TABLE_ZONES } from "../types.js";
import {
  bangkokParts,
  effectiveOverride,
  evaluateSchedule,
  evaluateShop,
  normalizeWeeklySchedule,
  type WeeklySchedule,
  type WeekdayKey,
} from "../shop/schedule.js";
import {
  sanitizeOccupancy,
  zeroOccupancyProvider,
  type OccupancyProvider,
} from "../shop/occupancy.js";

export interface ShopMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface ShopRouterDeps {
  store: Store;
  /** นาฬิกาแบบฉีดได้ (default: เวลาจริง) — เทสต์กำหนดเวลาตายตัวผ่าน seam นี้ */
  clock?: () => Date;
  /** snapshot โต๊ะที่ใช้ + ผู้ใช้บริการ (default: zero) */
  occupancy?: OccupancyProvider;
  middleware: ShopMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "เวลาไม่ถูกต้อง (ต้องเป็น HH:MM 00:00–23:59)");
const intervalSchema = z.object({ open: timeSchema, close: timeSchema });
const daySchema = z.object({
  closed: z.boolean({ invalid_type_error: "closed ต้องเป็น true/false" }),
  intervals: z.array(intervalSchema).max(4, "หนึ่งวันมีช่วงเวลาได้ไม่เกิน 4 ช่วง"),
});
const weeklyScheduleSchema = z.object({
  "0": daySchema,
  "1": daySchema,
  "2": daySchema,
  "3": daySchema,
  "4": daySchema,
  "5": daySchema,
  "6": daySchema,
});
const shopNameSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุชื่อร้าน")
  .max(120, "ชื่อร้านต้องไม่เกิน 120 ตัวอักษร");
const tableNameSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุชื่อโต๊ะ")
  .max(64, "ชื่อโต๊ะต้องไม่เกิน 64 ตัวอักษร");
const capacitySchema = z
  .number({ invalid_type_error: "ความจุต้องเป็นตัวเลข 1–50" })
  .int("ความจุต้องเป็นจำนวนเต็ม 1–50")
  .min(1, "ความจุต้องมากกว่าศูนย์")
  .max(50, "ความจุต้องไม่เกิน 50");
const zoneSchema = z.enum(TABLE_ZONES, {
  errorMap: () => ({ message: `โซนต้องเป็นหนึ่งใน ${TABLE_ZONES.join(", ")}` }),
});

/**
 * รับเฉพาะ ISO 8601 ที่มี timezone ชัดเจน (ลงท้าย Z/z หรือ ±HH:MM)
 * แล้ว canonicalize เป็น UTC ISO เสมอ — ไม่พึ่ง timezone ของเครื่อง server
 * ค่าไม่มี timezone (เช่น 2026-09-12T18:30) ถูกปฏิเสธ เพราะ new Date
 * จะตีความตาม TZ server ซึ่งแต่ละเครื่องอาจไม่ตรงกัน
 */
const TZ_SUFFIX_RE = /([zZ]|([+-])(\d{2}):(\d{2}))$/;

export const MISSING_TIMEZONE_ERROR =
  "วันเวลาต้องระบุ timezone ให้ชัดเจน (ลงท้ายด้วย Z หรือ ±HH:MM เช่น 2026-09-12T11:30:00.000Z)";

function parseIsoDatetime(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  const s = value.trim();
  const m = TZ_SUFFIX_RE.exec(s);
  if (!m) throw new Error(MISSING_TIMEZONE_ERROR);
  if (m[2]) {
    const hh = Number(m[3]);
    const mm = Number(m[4]);
    if (hh > 23 || mm > 59) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  }
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  return new Date(s).toISOString();
}

/**
 * Ticket 02 routes: สถานะร้านสาธารณะ + จัดการร้าน/โต๊ะ (Owner/Admin)
 * - กฎธุรกิจอยู่ใน shop/schedule.ts (domain) และ store.ts (atomic mutation + audit)
 * - router ทำแค่ validate รูปทรง input, เรียก store, ประกอบ DTO
 */
export function createShopRouter(deps: ShopRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const clock = deps.clock ?? (() => new Date());
  const occupancyProvider: OccupancyProvider = deps.occupancy ?? zeroOccupancyProvider;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  // Public snapshot: ไม่ต้อง login — DTO แคบ ๆ ไม่มีข้อมูลหลังร้าน/ส่วนบุคคล
  // อ่านจาก snapshot คงเส้นคงวาชุดเดียวของ store (occupancy มาจาก provider ภายนอก)
  router.get("/api/shop/status", async (_req, res, next) => {
    try {
      const now = clock();
      const snap = await store.getShopSnapshot();
      const occ = sanitizeOccupancy(await occupancyProvider());
      const { isOpen, isTemporary } = evaluateShop(now, snap.schedule, snap.override);
      const effective = effectiveOverride(now, snap.override);
      const { weekday, date } = bangkokParts(now);
      const today = snap.schedule[String(weekday) as WeekdayKey]!;
      const { serviceWindow } = evaluateSchedule(now, snap.schedule);
      const enabled = snap.tables.filter((t) => t.isEnabled).length;
      const occupied = Math.min(occ.occupiedTables, enabled);
      const free = Math.max(0, enabled - occ.occupiedTables);
      res.json({
        shopName: snap.shopName,
        isOpen,
        isTemporary,
        reason: isTemporary ? (effective?.reason ?? null) : null,
        expectedReopenAt: isTemporary ? (effective?.expectedReopenAt ?? null) : null,
        today: { date, weekday, closed: today.closed, intervals: today.intervals },
        serviceWindow,
        tables: { enabled, free, occupied },
        customerCount: occ.customerCount,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * สถานะโต๊ะแบบสาธารณะ — ให้เว็บที่มาจาก QR บนโต๊ะรู้ตั้งแต่ต้นว่าสั่งที่โต๊ะนี้ได้ไหม
   * แทนที่จะปล่อยให้ลูกค้าเลือกเมนูจนครบแล้วค่อยโดน 409 ตอนกดยืนยัน
   *
   * DTO แคบมาก: ชื่อโต๊ะ โซน และพร้อมสั่งหรือไม่ — ไม่มีชื่อลูกค้า จำนวนคน
   * รหัสจอง หรือ roundId (รหัสรอบยังเป็นของหลังร้านเหมือนเดิม)
   */
  router.get("/api/tables/:id/public-status", async (req, res, next) => {
    try {
      const id = String(req.params["id"] ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "ไม่ได้ระบุโต๊ะ" });
        return;
      }
      const table = (await store.listTables()).find((t) => t.id === id);
      if (!table) {
        res.status(404).json({ error: "ไม่พบโต๊ะนี้" });
        return;
      }
      const [open] = await store.listTableRounds({ status: "open", tableId: table.id, limit: 1 });
      res.json({
        table: { id: table.id, name: table.name, zone: table.zone },
        // งดใช้งานโต๊ะไว้ก็สั่งที่โต๊ะนี้ไม่ได้ แม้จะมีรอบค้างอยู่
        ready: table.isEnabled && open !== undefined,
        openedAt: open?.openedAt ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/shop/schedule", requireAuth, requireShopManager, async (_req, res, next) => {
    try {
      const now = clock();
      const [shopName, schedule, stored] = await Promise.all([
        store.getShopName(),
        store.getSchedule(),
        store.getOverride(),
      ]);
      const override = effectiveOverride(now, stored);
      res.json({
        shopName,
        schedule,
        override,
        expiredOverride: stored && !override ? stored : null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    "/api/shop/schedule",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const body = (req.body ?? {}) as { shopName?: unknown; schedule?: unknown };
        let shopName: string | undefined;
        if (body.shopName !== undefined) {
          const parsedName = shopNameSchema.safeParse(body.shopName);
          if (!parsedName.success) {
            res.status(400).json({ error: zodMessage(parsedName.error) });
            return;
          }
          shopName = parsedName.data;
        }
        const parsed = weeklyScheduleSchema.safeParse(body.schedule);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let normalized: WeeklySchedule;
        try {
          normalized = normalizeWeeklySchedule(parsed.data);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ตารางเวลาไม่ถูกต้อง" });
          return;
        }
        const actor = req.user!;
        // state + audit เขียนแบบ all-or-nothing ใน store (transaction ฝั่ง MySQL)
        const saved = await store.saveShopConfig(
          { shopName, schedule: normalized },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        );
        const now = clock();
        const override = effectiveOverride(now, saved.override);
        res.json({
          shopName: saved.shopName,
          schedule: saved.schedule,
          override,
          expiredOverride: saved.override && !override ? saved.override : null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/api/shop/override",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            mode: z.enum(["open", "closed"], {
              errorMap: () => ({ message: "โหมดต้องเป็น open หรือ closed" }),
            }),
            reason: z.string().trim().max(300, "เหตุผลต้องไม่เกิน 300 ตัวอักษร").optional().nullable(),
            expectedReopenAt: z.string().optional().nullable(),
            expiresAt: z.string().optional().nullable(),
          })
          .safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const { mode } = parsed.data;
        const reason = (parsed.data.reason ?? "")?.trim() ? (parsed.data.reason as string).trim() : null;
        if (mode === "closed" && !reason) {
          res.status(400).json({ error: "ปิดร้านชั่วคราวต้องระบุเหตุผล" });
          return;
        }
        let expectedReopenAt: string | null = null;
        let expiresAt: string | null = null;
        try {
          expectedReopenAt = parseIsoDatetime(parsed.data.expectedReopenAt ?? null);
          expiresAt = parseIsoDatetime(parsed.data.expiresAt ?? null);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "รูปแบบวันเวลาไม่ถูกต้อง" });
          return;
        }
        // expiresAt (หมดอายุคำสั่ง = มีผลจริง) ต้องอยู่ในอนาคตเท่านั้น;
        // expectedReopenAt (คาดว่าจะเปิด = แสดงผล) ไม่บังคับอนาคต
        if (expiresAt && new Date(expiresAt).getTime() <= clock().getTime()) {
          res.status(400).json({ error: "เวลาสิ้นสุดคำสั่งต้องอยู่ในอนาคต" });
          return;
        }
        const actor = req.user!;
        const saved = await store.setShopOverride(
          {
            mode,
            reason,
            expectedReopenAt,
            expiresAt,
            createdBy: actor.username,
          },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        );
        res.status(201).json({ override: saved });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    "/api/shop/override",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const actor = req.user!;
        const cleared = await store.clearShopOverride({
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.json({ ok: true, cleared });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/api/tables", requireAuth, requireShopManager, async (_req, res, next) => {
    try {
      res.json({ tables: await store.listTables() });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/api/tables",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = z
          .object({ name: tableNameSchema, capacity: capacitySchema, zone: zoneSchema.nullable().optional() })
          .safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const actor = req.user!;
        const created = await store.createShopTable(parsed.data, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.status(201).json({ table: created });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    "/api/tables/:id",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            name: tableNameSchema.optional(),
            capacity: capacitySchema.optional(),
            isEnabled: z.boolean({ invalid_type_error: "isEnabled ต้องเป็น true/false" }).optional(),
            zone: zoneSchema.nullable().optional(),
          })
          .safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        if (
          parsed.data.name === undefined &&
          parsed.data.capacity === undefined &&
          parsed.data.isEnabled === undefined &&
          parsed.data.zone === undefined
        ) {
          res.status(400).json({ error: "กรุณาระบุชื่อ ความจุ โซน หรือสถานะพร้อมใช้งานอย่างน้อย 1 อย่าง" });
          return;
        }
        const actor = req.user!;
        const updated = await store.updateShopTable(req.params.id, parsed.data, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.json({ table: updated });
      } catch (err) {
        next(err);
      }
    },
  );

  // ตั้งใจไม่มี DELETE /api/tables/:id — ห้ามลบข้อมูลแบบทำลายประวัติ (งดใช้งานแทน)

  router.get("/api/audit/shop", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("shop_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
