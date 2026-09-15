import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ShopActor, Store } from "../store.js";
import { ConflictError, NOTIFICATION_KIND_LABELS, NOTIFICATION_STATUS_LABELS, NotFoundError } from "../types.js";
import {
  computeNotificationBackoff,
  normalizeNotificationId,
  normalizeNotificationKind,
  normalizeNotificationStatus,
  sanitizeNotificationError,
} from "../notify/validation.js";
import {
  LineMessagingNotConfiguredError,
  type LineMessagingProvider,
} from "../notify/messaging.js";
import { DisabledLineMessagingProvider } from "../notify/messaging.js";
import { reservationReminderEvent, type NotificationEventInput } from "../notify/events.js";

export interface NotificationMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface NotificationRouterDeps {
  store: Store;
  middleware: NotificationMiddleware;
  clientIp: (req: Request) => string;
  clock?: () => Date;
  /** LINE Messaging provider (default: disabled → flush เก็บ failed ไว้ retry ได้ ไม่พัง) */
  messaging?: LineMessagingProvider;
}

const CSID_COOKIE = "csid";

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

/**
 * enqueue แบบ best-effort สำหรับ business routes:
 * สำเร็จหรือไม่สำเร็จต้องไม่กระทบ business transaction — กลืน error เสมอ
 * (caller เรียกหลัง business commit แล้วเท่านั้น)
 */
export async function enqueueBestEffort(
  store: Store,
  event: NotificationEventInput,
  actor: ShopActor,
  now?: Date,
): Promise<void> {
  try {
    await store.queueNotification(
      {
        eventKey: event.eventKey,
        kind: event.kind,
        customerId: event.customerId,
        orderId: event.orderId,
        reservationId: event.reservationId,
        paymentId: event.paymentId,
        message: event.message,
      },
      actor,
      now,
    );
  } catch {
    // ตั้งใจกลืน: LINE ล้มเหลวต้องไม่ยกเลิกงาน (AT15/D08)
  }
}

/** แปลง UTC ISO → wall-clock กรุงเทพแบบย่อ "วว/ดด/ปปปป ชช:นน" (deterministic สำหรับเทมเพลต) */
export function toBangkokShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const b = new Date(t + 7 * 3600_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(b.getUTCDate())}/${pad(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
}

export interface FlushResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  deadLetter: number;
}

/**
 * flush outbox รอบหนึ่ง (pure ต่อ store+provider — เรียกจาก route run-outbox เท่านั้น):
 * claim → ตรวจผู้รับ → ส่งผ่าน provider → mark sent/failed(dead_letter)/skipped
 * provider ทุก error ถือว่า retryable จนครบ maxAttempts (รวม timeout และ disabled)
 */
export async function flushOutbox(
  store: Store,
  provider: LineMessagingProvider,
  now: Date,
  limit: number,
  actor: ShopActor,
): Promise<FlushResult> {
  const due = await store.listDueNotifications(now, Math.min(Math.max(limit, 1), 200));
  const result: FlushResult = { checked: due.length, sent: 0, failed: 0, skipped: 0, deadLetter: 0 };
  for (const item of due) {
    const claimed = await store.claimNotification(item.id, now);
    if (!claimed) continue;
    // ---- recipient + consent checks (ตอนส่งจริงเท่านั้น) ----
    const skipReason = await recipientSkipReason(store, claimed.customerId);
    if (skipReason) {
      await store.skipNotification(claimed.id, skipReason, actor, now);
      result.skipped += 1;
      continue;
    }
    const link = await store.getLineLink(claimed.customerId!);
    if (!link) {
      await store.skipNotification(claimed.id, "ยังไม่เชื่อม LINE อ่านข้อความในเว็บแทนได้", actor, now);
      result.skipped += 1;
      continue;
    }
    try {
      await provider.sendPush({ to: link.providerSubject, message: claimed.message });
      await store.completeNotificationSend(claimed.id, actor, now);
      result.sent += 1;
    } catch (err) {
      const backoff = computeNotificationBackoff(claimed.attempts, now, claimed.maxAttempts);
      const message = err instanceof LineMessagingNotConfiguredError
        ? "ยังไม่เปิดใช้งานผู้ให้บริการ LINE"
        : sanitizeNotificationError(err);
      await store.failNotificationSend(claimed.id, { error: message, nextRetryAt: backoff }, actor, now);
      if (backoff) result.failed += 1;
      else result.deadLetter += 1;
    }
  }
  return result;
}

/** คืนเหตุผลข้าม (null = ผ่าน — มีตัวตน + เปิด consent) */
async function recipientSkipReason(store: Store, customerId: string | null): Promise<string | null> {
  if (!customerId) return "ไม่พบผู้รับ (คำสั่งซื้อ Guest — ดูใบเสร็จในเว็บแทนได้)";
  const customer = await store.findCustomerById(customerId);
  if (!customer || customer.isDeleted || !customer.isActive) return "บัญชีลูกค้าไม่พร้อมใช้งาน";
  const enabled = await store.isNotificationEnabled(customerId);
  if (!enabled) return "ลูกค้าปิดรับแจ้งเตือนผ่าน LINE";
  return null;
}

export interface ReminderRunResult {
  checked: number;
  queued: number;
  deduplicated: number;
}

/**
 * scheduler เตือนการจองก่อนนัด 30 นาที (เรียกด้วย fake clock ใน tests):
 * กวาดการจอง pending/confirmed ที่เวลานัดอยู่ใน [now+20 นาที, now+40 นาที]
 * eventKey `reservation_reminder:<id>` ทำให้รันซ้ำเป็น no-op
 */
export async function enqueueDueReminders(
  store: Store,
  now: Date,
  actor: ShopActor,
): Promise<ReminderRunResult> {
  const from = new Date(now.getTime() + 20 * 60_000).toISOString();
  const to = new Date(now.getTime() + 40 * 60_000).toISOString();
  const upcoming = await store.listUpcomingReservations(from, to, 200);
  const result: ReminderRunResult = { checked: upcoming.length, queued: 0, deduplicated: 0 };
  for (const r of upcoming) {
    const { notification, deduplicated } = await store.queueNotification(
      reservationReminderEvent({
        reservationId: r.id,
        code: r.code,
        customerId: r.customerId,
        tableName: r.tableName,
        partySize: r.partySize,
        reservedAtBangkok: toBangkokShort(r.reservedAt),
        checkinCode: r.code,
      }),
      actor,
      now,
    );
    void notification;
    if (deduplicated) result.deduplicated += 1;
    else result.queued += 1;
  }
  return result;
}

const listQuerySchema = z.object({
  status: z.string().max(16).optional(),
  kind: z.string().max(32).optional(),
  limit: z.string().max(10).optional(),
});

const retryBodySchema = z.object({ reason: z.unknown() });
const consentBodySchema = z.object({ customerId: z.unknown(), enabled: z.unknown() });
const myConsentBodySchema = z.object({ enabled: z.unknown() });
const runBodySchema = z.object({ limit: z.unknown().optional() });

function normalizeReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "สั่งส่งซ้ำด้วยมือ";
  if (value.trim().length > 500) throw new Error("เหตุผลต้องไม่เกิน 500 ตัวอักษร");
  return value.trim();
}

function normalizeLimit(raw: unknown, fallback: number): number {
  return Math.min(Math.max(Number(raw ?? fallback) || fallback, 1), 200);
}

/**
 * Ticket 12 routes: ดูสถานะ outbox + manual retry + flush/reminders + consent + web fallback
 * - กฎธุรกิจอยู่ใน notify/* (domain) และ store.ts (outbox + audit)
 * - สิทธิ์: outbox ทั้งหมด = Owner/Admin (requireShopManager);
 *   ลูกค้าอ่านเฉพาะของตนเองผ่าน csid (web fallback เมื่อ OA ส่งไม่สำเร็จ)
 */
export function createNotificationRouter(deps: NotificationRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const clock = deps.clock ?? (() => new Date());
  const messaging = deps.messaging ?? new DisabledLineMessagingProvider();
  const router = express.Router();

  const notifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["NOTIFY_RATE_MAX"] ?? 180),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอแจ้งเตือนมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

  function actorOf(req: Request): ShopActor {
    return {
      actorId: (req.userId as string | undefined) ?? null,
      actorUsername: req.user?.username ?? null,
      ip: clientIp(req),
    };
  }

  function customerActor(id: string, req: Request): ShopActor {
    return { actorId: id, actorUsername: null, ip: clientIp(req) };
  }

  function handleRouteError(res: Response, next: NextFunction, err: unknown): void {
    if (err instanceof ConflictError || err instanceof NotFoundError) {
      next(err);
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลไม่ถูกต้อง" });
  }

  /** อ่าน session ลูกค้าแบบ read-only (แยก customer/staff — ไม่ลบ session) */
  async function resolveCustomer(req: Request): Promise<string | null> {
    try {
      const sid = req.cookies?.[CSID_COOKIE] as string | undefined;
      if (!sid) return null;
      const session = await store.findCustomerSession(sid);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
      const customer = await store.findCustomerById(session.customerId);
      if (!customer || !customer.isActive || customer.isDeleted) return null;
      if (session.passwordVersion !== customer.passwordVersion) return null;
      return customer.id;
    } catch {
      return null;
    }
  }

  // ---------- หลังร้าน: รายการ outbox ----------
  router.get(
    "/api/notifications",
    notifyLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = listQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const q = parsed.data;
        let status;
        let kind;
        try {
          if (q.status) status = normalizeNotificationStatus(q.status);
          if (q.kind) kind = normalizeNotificationKind(q.kind);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ตัวกรองไม่ถูกต้อง" });
          return;
        }
        const items = await store.listNotifications({
          status,
          kind,
          limit: normalizeLimit(q.limit, 50),
        });
        res.json({
          items,
          kindLabels: NOTIFICATION_KIND_LABELS,
          statusLabels: NOTIFICATION_STATUS_LABELS,
        });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/notifications/:id",
    notifyLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const n = await store.getNotification(req.params.id);
        if (!n) {
          res.status(404).json({ error: "ไม่พบการแจ้งเตือน" });
          return;
        }
        res.json({ notification: n });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- หลังร้าน: manual retry ----------
  router.post(
    "/api/notifications/:id/retry",
    notifyLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = retryBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let reason: string;
        try {
          reason = normalizeReason(parsed.data.reason);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "เหตุผลไม่ถูกต้อง" });
          return;
        }
        const notification = await store.retryNotification(req.params.id, { reason }, actorOf(req), clock());
        res.json({ notification, message: "รับคำสั่งส่งซ้ำแล้ว" });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- หลังร้าน: flush outbox ด้วยมือ ----------
  router.post(
    "/api/notifications/run-outbox",
    notifyLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = runBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const result = await flushOutbox(
          store,
          messaging,
          clock(),
          normalizeLimit(parsed.data.limit, 50),
          actorOf(req),
        );
        res.json({ result, message: `ตรวจ ${result.checked} รายการ ส่งแล้ว ${result.sent} รายการ` });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- หลังร้าน: scheduler เตือน 30 นาทีด้วยมือ ----------
  router.post(
    "/api/notifications/run-reminders",
    notifyLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (_req, res, next) => {
      try {
        const result = await enqueueDueReminders(store, clock(), {
          actorId: null,
          actorUsername: "scheduler",
          ip: null,
        });
        res.json({ result, message: `ตรวจ ${result.checked} การจอง เข้าคิวใหม่ ${result.queued} รายการ` });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  // ---------- หลังร้าน: consent ของลูกค้า ----------
  router.post(
    "/api/notification-consents",
    notifyLimiter,
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = consentBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        let customerId: string;
        try {
          customerId = normalizeNotificationId(parsed.data.customerId, "รหัสลูกค้าไม่ถูกต้อง");
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "รหัสลูกค้าไม่ถูกต้อง" });
          return;
        }
        if (typeof parsed.data.enabled !== "boolean") {
          res.status(400).json({ error: "ค่า consent ต้องเป็น true หรือ false" });
          return;
        }
        const customer = await store.findCustomerById(customerId);
        if (!customer || customer.isDeleted) {
          res.status(404).json({ error: "ไม่พบบัญชีลูกค้า" });
          return;
        }
        await store.setNotificationConsent(customerId, parsed.data.enabled, actorOf(req));
        res.json({
          customerId,
          enabled: parsed.data.enabled,
          message: parsed.data.enabled ? "เปิดรับแจ้งเตือนแล้ว" : "ปิดรับแจ้งเตือนแล้ว",
        });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get(
    "/api/notification-consents/:customerId",
    notifyLimiter,
    requireAuth,
    requireShopManager,
    async (req, res, next) => {
      try {
        const customerId = normalizeNotificationId(req.params.customerId, "รหัสลูกค้าไม่ถูกต้อง");
        res.json({ customerId, enabled: await store.isNotificationEnabled(customerId) });
      } catch (err) {
        handleRouteError(res, next, err);
      }
    },
  );

  router.get("/api/audit/notifications", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("notification_", limit) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: web fallback (อ่านข้อความของตนเองในเว็บเมื่อ OA ส่งไม่สำเร็จ) ----------
  router.get("/api/notifications/mine/list", notifyLimiter, async (req, res, next) => {
    try {
      const customerId = await resolveCustomer(req);
      if (!customerId) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน" });
        return;
      }
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const items = await store.listNotifications({
        customerId,
        limit: normalizeLimit(parsed.data.limit, 50),
      });
      const enabled = await store.isNotificationEnabled(customerId);
      const link = await store.getLineLink(customerId);
      res.json({
        items,
        consentEnabled: enabled,
        lineLinked: !!link,
        kindLabels: NOTIFICATION_KIND_LABELS,
        statusLabels: NOTIFICATION_STATUS_LABELS,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: เปิด/ปิดรับแจ้งเตือนของตนเอง ----------
  router.patch("/api/notifications/mine/consent", notifyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const customerId = await resolveCustomer(req);
      if (!customerId) {
        res.status(401).json({ error: "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน" });
        return;
      }
      const parsed = myConsentBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      if (typeof parsed.data.enabled !== "boolean") {
        res.status(400).json({ error: "ค่า consent ต้องเป็น true หรือ false" });
        return;
      }
      await store.setNotificationConsent(customerId, parsed.data.enabled, customerActor(customerId, req));
      res.json({
        enabled: parsed.data.enabled,
        message: parsed.data.enabled ? "เปิดรับแจ้งเตือนแล้ว" : "ปิดรับแจ้งเตือนแล้ว",
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
