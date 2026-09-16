import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { Store } from "../store.js";
import { normalizeThaiPhone } from "../customer/phone.js";
import {
  normalizePartySize,
  normalizeReservationCode,
  normalizeReservationNote,
  normalizeReservationReason,
  normalizeReservationStatus,
  normalizeReservedAt,
} from "../reservations/validation.js";
import { FakeReservationQrProvider, type ReservationQrProvider } from "../reservations/qr.js";
import type { ReservationStatus } from "../types.js";
import { enqueueBestEffort, toBangkokShort } from "./notifications.js";
import { reservationCancelledEvent, reservationCreatedEvent } from "../notify/events.js";

export interface ReservationMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface ReservationRouterDeps {
  store: Store;
  middleware: ReservationMiddleware;
  clientIp: (req: Request) => string;
  /** นาฬิกาแบบฉีดได้ (default: เวลาจริง) — เทสต์กำหนดเวลาตายตัวผ่าน seam นี้ */
  clock?: () => Date;
  /** QR provider สำหรับการจอง (default: fake/local เท่านั้น — ห้ามใช้ provider จริง) */
  qr?: ReservationQrProvider;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const createBodySchema = z.object({
  tableId: z.unknown().optional(),
  partySize: z.unknown(),
  reservedAt: z.unknown(),
  note: z.unknown().optional(),
  idempotencyKey: z.unknown().optional(),
});

const recommendQuerySchema = z.object({
  partySize: z.unknown(),
  reservedAt: z.unknown(),
});

const adminListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"]).optional(),
  limit: z.string().max(10).optional(),
});

const statusPatchSchema = z.object({
  status: z.unknown(),
  reason: z.unknown(),
});

const reasonBodySchema = z.object({
  reason: z.unknown().optional(),
});

const checkinBodySchema = z.object({
  code: z.unknown().optional(),
  phone: z.unknown().optional(),
  reservationId: z.unknown().optional(),
  partySize: z.unknown(),
  tableId: z.unknown().optional(),
  qr: z.unknown().optional(),
});

const roundsQuerySchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  tableId: z.string().max(64).optional(),
  limit: z.string().max(10).optional(),
});

/**
 * Ticket 06 routes: การจองของลูกค้า + ค้นหา/จัดการหลังร้าน + เช็กอิน/รอบโต๊ะ
 * - กฎธุรกิจอยู่ใน reservations/validation.ts (domain) และ store.ts (atomic + audit)
 * - router ทำแค่ validate รูปทรง input, แยก customer/staff, ประกอบ DTO
 * - QR เป็น fake/local seam เท่านั้น (encode รหัสจองสำหรับเช็กอินหน้าร้าน)
 */
export function createReservationRouter(deps: ReservationRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const clock = deps.clock ?? (() => new Date());
  const qr: ReservationQrProvider = deps.qr ?? new FakeReservationQrProvider();
  const router = express.Router();

  /** อ่าน session ลูกค้าแบบ read-only (ไม่ลบ session — ไว้แยกเจ้าของการจอง) */
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

  async function requireCustomerStrict(req: Request, res: Response): Promise<string | null> {
    const c = await resolveCustomer(req);
    if (!c) {
      res.status(401).json({ error: "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน (Guest จองโต๊ะไม่ได้)" });
      return null;
    }
    return c.id;
  }

  function withQr<T extends { code: string }>(detail: T): T & { qr: string } {
    return { ...detail, qr: qr.encode(detail.code) };
  }

  // ---------- สาธารณะ: แนะนำโต๊ะว่าง (ไม่ต้อง login — คืนเฉพาะ id/ชื่อ/ความจุ) ----------
  router.get("/api/reservations/recommend", async (req, res, next) => {
    try {
      const parsed = recommendQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let partySize: number;
      try {
        partySize = normalizePartySize(parsed.data.partySize);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "จำนวนผู้ใช้บริการไม่ถูกต้อง" });
        return;
      }
      const rawAt = parsed.data.reservedAt;
      if (typeof rawAt !== "string" || rawAt.trim().length === 0) {
        res.status(400).json({ error: "กรุณาระบุวันเวลานัดหมาย" });
        return;
      }
      const d = new Date(rawAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "รูปแบบวันเวลานัดไม่ถูกต้อง" });
        return;
      }
      const found = await store.recommendReservationTable(partySize, d.toISOString());
      res.json({
        table: found ? { id: found.id, name: found.name, capacity: found.capacity } : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- สาธารณะ: ผังสถานะโต๊ะ ณ เวลานัด (ไม่ต้อง login — ไม่มีข้อมูลการจอง/ลูกค้า) ----------
  router.get("/api/reservations/availability", async (req, res, next) => {
    try {
      const parsed = recommendQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let partySize: number;
      try {
        partySize = normalizePartySize(parsed.data.partySize);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "จำนวนผู้ใช้บริการไม่ถูกต้อง" });
        return;
      }
      const rawAt = parsed.data.reservedAt;
      if (typeof rawAt !== "string" || rawAt.trim().length === 0) {
        res.status(400).json({ error: "กรุณาระบุวันเวลานัดหมาย" });
        return;
      }
      const d = new Date(rawAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "รูปแบบวันเวลานัดไม่ถูกต้อง" });
        return;
      }
      const result = await store.listReservationAvailability(partySize, d.toISOString());
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ---------- สาธารณะ: รอบโต๊ะที่เปิดอยู่แบบ sanitize (ไม่มีข้อมูลลูกค้า/รหัสจอง) ----------
  router.get("/api/shop/table-rounds", async (_req, res, next) => {
    try {
      const rounds = await store.listTableRounds({ status: "open", limit: 200 });
      res.json({
        rounds: rounds.map((r) => ({
          tableId: r.tableId,
          tableName: r.tableName,
          partySize: r.partySize,
          openedAt: r.openedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: สร้างการจอง ----------
  router.post("/api/reservations", requireCsrf, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      const now = clock();
      try {
        // normalize เบื้องต้นที่ router (store ตรวจซ้ำด้วยกฎเดียวกัน)
        if (b.tableId !== undefined && b.tableId !== null && b.tableId !== "") {
          if (typeof b.tableId !== "string" || b.tableId.trim().length === 0) {
            throw new Error("กรุณาเลือกโต๊ะสำหรับการจอง");
          }
        }
        normalizePartySize(b.partySize);
        normalizeReservedAt(b.reservedAt, now);
        normalizeReservationNote(b.note ?? null);
        const { reservation, deduplicated } = await store.createReservation(
          {
            customerId,
            tableId: typeof b.tableId === "string" && b.tableId.trim() ? b.tableId.trim() : null,
            partySize: Number(b.partySize),
            reservedAt: String(b.reservedAt),
            note: (b.note as string | null | undefined) ?? null,
            idempotencyKey: (b.idempotencyKey as string | null | undefined) ?? null,
          },
          { actorId: customerId, ip: clientIp(req) },
          now,
        );
        // Ticket 12: เข้าคิว LINE แจ้งยืนยัน (best-effort — ล้มเหลวไม่ rollback การจอง)
        await enqueueBestEffort(
          store,
          reservationCreatedEvent({
            reservationId: reservation.id,
            code: reservation.code,
            customerId: reservation.customerId,
            tableName: reservation.tableName,
            partySize: reservation.partySize,
            reservedAtBangkok: toBangkokShort(reservation.reservedAt),
          }),
          { actorId: customerId, ip: clientIp(req) },
          now,
        );
        res.status(deduplicated ? 200 : 201).json({ reservation: withQr(reservation), deduplicated });
      } catch (err) {
        // domain validation (400) แยกจาก state conflict (409 — โยนให้ middleware จัดการ)
        const { ConflictError, NotFoundError } = await import("../types.js");
        if (err instanceof ConflictError || err instanceof NotFoundError) throw err;
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลการจองไม่ถูกต้อง" });
      }
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: การจองของฉัน ----------
  router.get("/api/reservations/mine", async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50) || 50, 1), 200);
      const items = await store.listCustomerReservations(customerId, limit);
      res.json({ reservations: items.map(withQr) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/reservations/mine/:id", async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const r = await store.getReservation(req.params.id);
      if (!r) {
        res.status(404).json({ error: "ไม่พบการจอง" });
        return;
      }
      if (r.customerId !== customerId) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของการจองเท่านั้น" });
        return;
      }
      res.json({ reservation: withQr(r) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: ยกเลิกการจองของตนเอง ----------
  router.post("/api/reservations/mine/:id/cancel", requireCsrf, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = reasonBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const r = await store.getReservation(req.params.id);
      if (!r) {
        res.status(404).json({ error: "ไม่พบการจอง" });
        return;
      }
      if (r.customerId !== customerId) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของการจองเท่านั้น" });
        return;
      }
      let reason: string;
      try {
        reason = normalizeReservationReason(
          parsed.data.reason === undefined || parsed.data.reason === null || parsed.data.reason === ""
            ? "ลูกค้ายกเลิกเอง"
            : parsed.data.reason,
        );
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "เหตุผลไม่ถูกต้อง" });
        return;
      }
      const cancelled = await store.cancelReservation(
        r.id,
        { reason },
        { actorId: customerId, ip: clientIp(req) },
        clock(),
      );
      // Ticket 12: เข้าคิว LINE แจ้งยกเลิก (best-effort)
      await enqueueBestEffort(
        store,
        reservationCancelledEvent({
          reservationId: cancelled.id,
          code: cancelled.code,
          customerId: cancelled.customerId,
        }),
        { actorId: customerId, ip: clientIp(req) },
        clock(),
      );
      res.json({ reservation: withQr(cancelled) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: ค้นหา/ดูการจอง (Owner/Admin) ----------
  router.get("/api/admin/reservations", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = adminListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      res.json({
        reservations: await store.listReservations({
          q: parsed.data.q ?? "",
          status: parsed.data.status as ReservationStatus | undefined,
          limit,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/admin/reservations/:id", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const r = await store.getReservation(req.params.id);
      if (!r) {
        res.status(404).json({ error: "ไม่พบการจอง" });
        return;
      }
      res.json({ reservation: withQr(r) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: เปลี่ยนสถานะพร้อมเหตุผล + audit ก่อน/หลัง ----------
  router.patch(
    "/api/admin/reservations/:id/status",
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
        let status: ReservationStatus;
        let reason: string;
        try {
          status = normalizeReservationStatus(parsed.data.status);
          if (status === "seated" || status === "completed" || status === "pending") {
            throw new Error(`เปลี่ยนสถานะการจองเป็น ${status} ผ่านช่องทางนี้ไม่ได้`);
          }
          reason = normalizeReservationReason(parsed.data.reason);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
          return;
        }
        const actor = (req as Request & { user?: { id: string; username: string } }).user!;
        const updated = await store.updateReservationStatus(
          req.params.id,
          { status, reason },
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        );
        // Ticket 12: หลังร้านยกเลิก → เข้าคิว LINE แจ้งยกเลิก (best-effort)
        if (status === "cancelled") {
          await enqueueBestEffort(
            store,
            reservationCancelledEvent({
              reservationId: updated.id,
              code: updated.code,
              customerId: updated.customerId,
            }),
            { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
            clock(),
          );
        }
        res.json({ reservation: withQr(updated) });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- หลังร้าน: เช็กอินด้วยรหัสจอง/เบอร์โทร/QR + เปิดรอบโต๊ะ ----------
  router.post("/api/checkin", requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = checkinBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      let code: string | null = null;
      let phone: string | null = null;
      try {
        // รองรับสแกน QR (payload แบบ fake/local) — ถอดเป็น code ก่อนค้นหา
        const qrRaw = b.qr as string | null | undefined;
        const codeRaw = (b.code as string | null | undefined) ?? (qrRaw ? qr.decode(String(qrRaw)) : null);
        if (codeRaw !== null && codeRaw !== undefined && String(codeRaw).trim() !== "") {
          code = normalizeReservationCode(codeRaw);
        }
        const phoneRaw = b.phone as string | null | undefined;
        if (phoneRaw !== null && phoneRaw !== undefined && String(phoneRaw).trim() !== "") {
          phone = normalizeThaiPhone(phoneRaw);
        }
        if (!code && !phone && !(b.reservationId as string | undefined)?.trim()) {
          throw new Error("กรุณาระบุรหัสการจองหรือเบอร์โทร");
        }
        normalizePartySize(b.partySize);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลเช็กอินไม่ถูกต้อง" });
        return;
      }
      const actor = (req as Request & { user?: { id: string; username: string } }).user!;
      const { reservation, round } = await store.checkinReservation(
        {
          code,
          phone,
          reservationId:
            typeof b.reservationId === "string" && b.reservationId.trim() ? b.reservationId.trim() : null,
          partySize: Number(b.partySize),
          tableId: typeof b.tableId === "string" && b.tableId.trim() ? b.tableId.trim() : null,
        },
        { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        clock(),
      );
      res.status(201).json({ reservation: withQr(reservation), round });
    } catch (err) {
      next(err);
    }
  });

  // ---------- หลังร้าน: รอบการใช้โต๊ะ ----------
  router.get("/api/rounds", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = roundsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      res.json({
        rounds: await store.listTableRounds({
          status: parsed.data.status,
          tableId: parsed.data.tableId,
          limit,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/rounds/:id", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const round = await store.getTableRound(req.params.id);
      if (!round) {
        res.status(404).json({ error: "ไม่พบรอบการใช้โต๊ะ" });
        return;
      }
      res.json({ round });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/api/rounds/:id/close",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const actor = (req as Request & { user?: { id: string; username: string } }).user!;
        const round = await store.closeTableRound(
          req.params.id,
          { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
          clock(),
        );
        res.json({ round });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/api/audit/reservations", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      const [a, b] = await Promise.all([
        store.listAudit("reservation_", limit),
        store.listAudit("round_", limit),
      ]);
      const items = [...a, ...b].sort((x, y) => y.id - x.id).slice(0, limit);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
