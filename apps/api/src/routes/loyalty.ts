import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Store } from "../store.js";
import {
  normalizeLoyaltyIdempotencyKey,
  normalizeLoyaltyReason,
  normalizeRewardImageUrl,
  normalizeRewardName,
  normalizeRewardPointsCost,
  normalizeRewardQuotaTotal,
  normalizeWalkinCode,
} from "../loyalty/validation.js";

export interface LoyaltyMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface LoyaltyRouterDeps {
  store: Store;
  middleware: LoyaltyMiddleware;
  clientIp: (req: Request) => string;
  clock?: () => Date;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const CSID_COOKIE = "csid";
const SID_COOKIE = "sid";

const limitQuerySchema = z.object({ limit: z.string().max(10).optional() });

const rewardBodySchema = z.object({
  name: z.unknown(),
  imageUrl: z.unknown().optional(),
  menuId: z.unknown(),
  pointsCost: z.unknown(),
  quotaTotal: z.unknown().optional(),
  startsAt: z.unknown().optional(),
  endsAt: z.unknown().optional(),
  isActive: z.unknown().optional(),
});

const rewardPatchSchema = z.object({
  name: z.unknown().optional(),
  imageUrl: z.unknown().optional(),
  pointsCost: z.unknown().optional(),
  quotaTotal: z.unknown().optional(),
  startsAt: z.unknown().optional(),
  endsAt: z.unknown().optional(),
  isActive: z.unknown().optional(),
});

const redeemBodySchema = z.object({ idempotencyKey: z.unknown(), reason: z.unknown().optional() });
const releaseBodySchema = z.object({ reason: z.unknown() });
const walkinScanSchema = z.object({ code: z.unknown() });
const guestLinkSchema = z.object({ orderId: z.unknown() });
const mergeBodySchema = z.object({ sourceCustomerId: z.unknown(), targetCustomerId: z.unknown() });
const reverseBodySchema = z.object({ orderId: z.unknown(), refundId: z.unknown() });

function parseLimit(raw: unknown, fallback: number): number {
  return Math.min(Math.max(Number(raw ?? fallback) || fallback, 1), 200);
}

function parseOptionalDate(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  return d.toISOString();
}

function parseId(raw: unknown, label: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.trim().length > 36) {
    throw new Error(label);
  }
  return raw.trim();
}

/**
 * Ticket 10 routes: คะแนนสะสม + รางวัล + QR Walk-in + ผูก Guest + รวมบัญชี + กลับรายการ
 * - กฎธุรกิจอยู่ใน loyalty/validation.ts (domain) และ store.ts (ledger + idempotency + audit)
 * - router ทำแค่ validate รูปทรง input, แยกสิทธิ์, ประกอบ DTO
 * - role isolation ฝั่ง server: ลูกค้าเห็นเฉพาะของตนเอง (ผ่าน csid);
 *   drink ออก QR + รับ/ปฏิเสธ redemption ฝ่ายเครื่องดื่มได้; Admin/Owner จัดการรางวัล +
 *   อนุมัติ merge/reverse; kitchen/Guest/ลูกค้ารายอื่นถูกปฏิเสธ
 */
export function createLoyaltyRouter(deps: LoyaltyRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const clock = deps.clock ?? (() => new Date());
  const router = express.Router();

  const loyaltyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env["LOYALTY_RATE_MAX"] ?? 180),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "ส่งคำขอคะแนนสะสมมากเกินไป กรุณารอสักครู่แล้วลองใหม่" },
  });

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

  async function requireCustomerStrict(req: Request, res: Response): Promise<string | null> {
    const c = await resolveCustomer(req);
    if (!c) {
      res.status(401).json({ error: "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน" });
      return null;
    }
    return c.id;
  }

  function isManager(roles: string[]): boolean {
    return roles.includes("owner") || roles.includes("admin");
  }

  /** drink ทำ redemption ฝ่ายเครื่องดื่มได้; kitchen ทำไม่ได้ (station isolation) */
  function canHandleRedemption(roles: string[]): boolean {
    return roles.includes("drink") || isManager(roles);
  }

  async function requireRedemptionStaff(req: Request, res: Response): Promise<{ id: string; username: string; roles: string[] } | null> {
    const staff = await resolveStaff(req);
    if (!staff) {
      res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
      return null;
    }
    if (!canHandleRedemption(staff.roles)) {
      res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะฝ่ายเครื่องดื่ม Owner หรือ Admin เท่านั้น" });
      return null;
    }
    return staff;
  }

  // ---------- ลูกค้า: ยอดคงเหลือ (derived) ----------
  router.get("/api/loyalty/balance", loyaltyLimiter, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      res.json({ balance: await store.getLoyaltyBalance(customerId) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: ประวัติธุรกรรมคะแนน ----------
  router.get("/api/loyalty/ledger", loyaltyLimiter, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = limitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = parseLimit(parsed.data.limit, 50);
      res.json({
        entries: await store.listLoyaltyLedger(customerId, limit),
        balance: await store.getLoyaltyBalance(customerId),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- สาธารณะ: รางวัลพร้อมแลก (เฉพาะเปิดขาย + อยู่ในช่วงเวลา) ----------
  router.get("/api/rewards/redeemable", loyaltyLimiter, async (_req, res, next) => {
    try {
      res.json({ rewards: await store.listRedeemableRewards(clock()) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: ยืนยันแลก (reserve — กันคะแนน + กัน quota) ----------
  router.post("/api/rewards/:id/redeem", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = redeemBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let idempotencyKey: string;
      let reason: string | null = null;
      try {
        idempotencyKey = normalizeLoyaltyIdempotencyKey(parsed.data.idempotencyKey);
        if (parsed.data.reason !== undefined && parsed.data.reason !== null && String(parsed.data.reason).trim() !== "") {
          reason = normalizeLoyaltyReason(parsed.data.reason);
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลแลกคะแนนไม่ถูกต้อง" });
        return;
      }
      const { redemption, deduplicated } = await store.redeemReserve(
        { customerId, rewardId: req.params.id, idempotencyKey, reason },
        { actorId: customerId, ip: clientIp(req) },
        clock(),
      );
      res.status(deduplicated ? 200 : 201).json({ redemption, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: รายการแลกของตนเอง ----------
  router.get("/api/loyalty/redemptions/mine", loyaltyLimiter, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = limitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      res.json({ redemptions: await store.listCustomerRedemptions(customerId, parseLimit(parsed.data.limit, 50)) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: สร้างรางวัล ----------
  router.post("/api/rewards", loyaltyLimiter, requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = rewardBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let input: {
        name: string;
        imageUrl: string | null;
        menuId: string;
        pointsCost: number;
        quotaTotal: number | null;
        startsAt: string | null;
        endsAt: string | null;
        isActive: boolean;
      };
      try {
        input = {
          name: normalizeRewardName(parsed.data.name),
          imageUrl: normalizeRewardImageUrl(parsed.data.imageUrl ?? null),
          menuId: parseId(parsed.data.menuId, "กรุณาระบุเมนูเครื่องดื่มอ้างอิง"),
          pointsCost: normalizeRewardPointsCost(parsed.data.pointsCost),
          quotaTotal: normalizeRewardQuotaTotal(parsed.data.quotaTotal ?? null),
          startsAt: parseOptionalDate(parsed.data.startsAt) ?? null,
          endsAt: parseOptionalDate(parsed.data.endsAt) ?? null,
          isActive: parsed.data.isActive === undefined ? true : parsed.data.isActive !== false,
        };
        if (typeof parsed.data.isActive !== "undefined" && typeof parsed.data.isActive !== "boolean") {
          throw new Error("สถานะรางวัลไม่ถูกต้อง");
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลรางวัลไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      const reward = await store.createReward(input, {
        actorId: actor.id,
        actorUsername: actor.username,
        ip: clientIp(req),
      });
      res.status(201).json({ reward });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: รายการรางวัลทั้งหมด (รวมที่ปิดขาย) ----------
  router.get("/api/rewards", loyaltyLimiter, requireAuth, requireShopManager, async (_req, res, next) => {
    try {
      res.json({ rewards: await store.listRewards() });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: แก้ไขรางวัล ----------
  router.patch("/api/rewards/:id", loyaltyLimiter, requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = rewardPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let patch: {
        name?: string;
        imageUrl?: string | null;
        pointsCost?: number;
        quotaTotal?: number | null;
        startsAt?: string | null;
        endsAt?: string | null;
        isActive?: boolean;
      };
      try {
        patch = {};
        if (parsed.data.name !== undefined) patch.name = normalizeRewardName(parsed.data.name);
        if (parsed.data.imageUrl !== undefined) patch.imageUrl = normalizeRewardImageUrl(parsed.data.imageUrl);
        if (parsed.data.pointsCost !== undefined) patch.pointsCost = normalizeRewardPointsCost(parsed.data.pointsCost);
        if (parsed.data.quotaTotal !== undefined) patch.quotaTotal = normalizeRewardQuotaTotal(parsed.data.quotaTotal);
        if (parsed.data.startsAt !== undefined) patch.startsAt = parseOptionalDate(parsed.data.startsAt) ?? null;
        if (parsed.data.endsAt !== undefined) patch.endsAt = parseOptionalDate(parsed.data.endsAt) ?? null;
        if (parsed.data.isActive !== undefined) {
          if (typeof parsed.data.isActive !== "boolean") throw new Error("สถานะรางวัลไม่ถูกต้อง");
          patch.isActive = parsed.data.isActive;
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลรางวัลไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      res.json({
        reward: await store.updateReward(req.params.id, patch, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ฝ่ายเครื่องดื่ม/Owner/Admin: รายการแลกที่รอรับ ----------
  router.get("/api/redemptions/pending", loyaltyLimiter, async (req, res, next) => {
    try {
      const staff = await requireRedemptionStaff(req, res);
      if (!staff) return;
      const parsed = limitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      res.json({ redemptions: await store.listPendingRedemptions(parseLimit(parsed.data.limit, 50)) });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ฝ่ายเครื่องดื่ม/Owner/Admin: รับรายการ (consume — สร้างงานคิวราคา 0 ครั้งเดียว) ----------
  router.post("/api/redemptions/:id/consume", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const staff = await requireRedemptionStaff(req, res);
      if (!staff) return;
      const { redemption, job } = await store.redeemConsume(
        req.params.id,
        { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) },
        clock(),
      );
      res.json({ redemption, job });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ปฏิเสธ/ยกเลิก (release — ฝ่ายเครื่องดื่ม/Owner/Admin หรือเจ้าของแต้ม) ----------
  router.post("/api/redemptions/:id/release", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const parsed = releaseBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let reason: string;
      try {
        reason = normalizeLoyaltyReason(parsed.data.reason);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุเหตุผล" });
        return;
      }
      const staff = await resolveStaff(req);
      const privilegedStaff = staff && canHandleRedemption(staff.roles) ? staff : null;
      const customer = await resolveCustomer(req);
      if (!privilegedStaff && !customer) {
        if (staff) {
          res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะฝ่ายเครื่องดื่ม Owner Admin หรือเจ้าของแต้มเท่านั้น" });
        } else {
          res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
        }
        return;
      }
      // เจ้าของแต้มปล่อยรายการของตนเองได้ — รายอื่นถูกปฏิเสธ (staff ข้ามสิทธิ์ใช้ช่องทางนี้ไม่ได้)
      const current = await store.getRedemption(req.params.id);
      if (!current) {
        res.status(404).json({ error: "ไม่พบรายการแลก" });
        return;
      }
      if (!privilegedStaff && current.customerId !== customer!.id) {
        res.status(403).json({ error: "สิทธิ์ไม่เพียงพอ เฉพาะเจ้าของแต้มเท่านั้น" });
        return;
      }
      const actor = privilegedStaff
        ? { actorId: privilegedStaff.id, actorUsername: privilegedStaff.username, ip: clientIp(req) }
        : { actorId: customer!.id, ip: clientIp(req) };
      const { redemption, deduplicated } = await store.redeemRelease(req.params.id, { reason }, actor, clock());
      res.json({ redemption, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ฝ่ายเครื่องดื่ม/Owner/Admin: ออก QR Walk-in (ครั้งเดียว อายุ 10 นาที) ----------
  router.post("/api/loyalty/walkin/issue", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const staff = await requireRedemptionStaff(req, res);
      if (!staff) return;
      const token = await store.issueWalkinQr(
        { actorId: staff.id, actorUsername: staff.username, ip: clientIp(req) },
        clock(),
      );
      res.status(201).json({ token });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: สแกน QR Walk-in รับคะแนน ----------
  router.post("/api/loyalty/walkin/scan", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = walkinScanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let code: string;
      try {
        code = normalizeWalkinCode(parsed.data.code);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "รหัส QR ไม่ถูกต้อง" });
        return;
      }
      const { token, earned } = await store.redeemWalkinQr(
        { code, customerId },
        { actorId: customerId, ip: clientIp(req) },
        clock(),
      );
      res.json({ token, earned });
    } catch (err) {
      next(err);
    }
  });

  // ---------- ลูกค้า: ผูกคำสั่งซื้อ Guest เข้าบัญชี (ภายใน 24 ชม. เบอร์เดียวกัน) ----------
  router.post("/api/loyalty/guest/link", loyaltyLimiter, requireCsrf, async (req, res, next) => {
    try {
      const customerId = await requireCustomerStrict(req, res);
      if (!customerId) return;
      const parsed = guestLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let orderId: string;
      try {
        orderId = parseId(parsed.data.orderId, "กรุณาระบุคำสั่งซื้อ");
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "กรุณาระบุคำสั่งซื้อ" });
        return;
      }
      const { order, earned } = await store.linkGuestOrder(
        { orderId, customerId },
        { actorId: customerId, ip: clientIp(req) },
        clock(),
      );
      res.json({ order, earned });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: รวมบัญชี (atomic + audit + กันย้ายซ้ำ) ----------
  router.post("/api/loyalty/merge", loyaltyLimiter, requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = mergeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let sourceCustomerId: string;
      let targetCustomerId: string;
      try {
        sourceCustomerId = parseId(parsed.data.sourceCustomerId, "กรุณาระบุบัญชีต้นทาง");
        targetCustomerId = parseId(parsed.data.targetCustomerId, "กรุณาระบุบัญชีปลายทาง");
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลบัญชีไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      const { record, movedPoints, deduplicated } = await store.mergeCustomerAccounts(
        { sourceCustomerId, targetCustomerId },
        { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        clock(),
      );
      res.json({ record, movedPoints, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: กลับรายการคะแนนเมื่อคืนเงิน (กัน double-reversal) ----------
  router.post("/api/loyalty/reverse", loyaltyLimiter, requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = reverseBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      let orderId: string;
      let refundId: string;
      try {
        orderId = parseId(parsed.data.orderId, "กรุณาระบุคำสั่งซื้อ");
        refundId = parseId(parsed.data.refundId, "กรุณาระบุรายการคืนเงิน");
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลกลับรายการไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      const { reversal, deduplicated } = await store.reversePointsOnRefund(
        orderId,
        refundId,
        { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) },
        clock(),
      );
      res.json({ reversal, deduplicated });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Owner/Admin: ประวัติคะแนน/รางวัล (ดูได้เฉพาะหลังร้าน — ไม่มีข้อมูลลับ) ----------
  router.get("/api/audit/loyalty", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("loyalty_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
