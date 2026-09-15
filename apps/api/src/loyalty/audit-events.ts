import type { AuditInput, ShopActor } from "../store.js";
import type {
  LoyaltyTransaction,
  Reward,
  RewardRedemption,
  WalkinQrToken,
} from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 10 — Memory และ MySQL ใช้ชุดเดียวกัน
 * detail เก็บ actor/reason/before→after ทุกครั้ง (ไม่มี password/token/secret/credentials)
 */

function base(actor: ShopActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function loyaltyEarnedEvent(tx: LoyaltyTransaction, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_earned",
    targetId: tx.customerId,
    targetUsername: null,
    detail:
      `รับคะแนน ${tx.points} แต้ม (ยอดสะสมจากธุรกรรม) ` +
      `แหล่ง: ${tx.orderId ? `คำสั่งซื้อ ${tx.orderId}` : tx.walkinTokenId ? "QR Walk-in" : tx.source}` +
      (tx.reason ? ` เหตุผล: ${tx.reason}` : ""),
  };
}

export function redemptionReservedEvent(r: RewardRedemption, balanceAfter: number, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_redeemed_reserved",
    targetId: r.id,
    targetUsername: null,
    detail:
      `ยืนยันแลก ${r.rewardName} (${r.code}) กันคะแนน ${r.pointsCost} แต้ม ` +
      `(คงเหลือใช้ได้ ${balanceAfter} แต้ม) เหตุผล: ${r.reason ?? "แลกคะแนนเป็นเครื่องดื่ม"}`,
  };
}

export function redemptionConsumedEvent(
  r: RewardRedemption,
  queueJobId: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_redeemed_consumed",
    targetId: r.id,
    targetUsername: null,
    detail:
      `ร้านรับรายการแลก ${r.rewardName} (${r.code}) หักคะแนน ${r.pointsCost} แต้มถาวร ` +
      `สร้างงานคิวเครื่องดื่ม ${queueJobId} (ราคา 0 ไม่สร้างรายรับ)`,
  };
}

export function redemptionReleasedEvent(r: RewardRedemption, reason: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_redeemed_released",
    targetId: r.id,
    targetUsername: null,
    detail: `คืนคะแนนแลก ${r.rewardName} (${r.code}) ${r.pointsCost} แต้ม เหตุผล: ${reason}`,
  };
}

export function walkinIssuedEvent(token: WalkinQrToken, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_walkin_issued",
    targetId: token.id,
    targetUsername: null,
    detail: `ออก QR Walk-in ${token.code} (อายุ 10 นาที ใช้ครั้งเดียว)`,
  };
}

export function walkinRedeemedEvent(
  token: WalkinQrToken,
  customerId: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_walkin_redeemed",
    targetId: token.id,
    targetUsername: null,
    detail: `ลูกค้า ${customerId} สแกน QR ${token.code} รับคะแนน 1 แต้ม`,
  };
}

export function guestLinkedEvent(orderId: string, customerId: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_guest_linked",
    targetId: orderId,
    targetUsername: null,
    detail: `ผูกคำสั่งซื้อ ${orderId} เข้าบัญชี ${customerId} (ยืนยันเบอร์เดียวกันภายใน 24 ชม.)`,
  };
}

export function accountMergedEvent(
  sourceCustomerId: string,
  targetCustomerId: string,
  movedPoints: number,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_account_merged",
    targetId: targetCustomerId,
    targetUsername: null,
    detail:
      `รวมบัญชี ${sourceCustomerId} → ${targetCustomerId} ` +
      `ย้ายธุรกรรมคะแนนสุทธิ ${movedPoints} แต้ม (บัญชีต้นทางถูกปิด)`,
  };
}

export function pointsReversedEvent(
  orderId: string,
  customerId: string,
  points: number,
  refundId: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "loyalty_points_reversed",
    targetId: orderId,
    targetUsername: null,
    detail:
      `ย้อนคะแนนคำสั่งซื้อ ${orderId} ของ ${customerId} ${points} แต้ม ` +
      `(คืนเงิน ${refundId} — รักษาประวัติเดิม ไม่ลบธุรกรรม)`,
  };
}

export function rewardCreatedEvent(reward: Reward, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "reward_created",
    targetId: reward.id,
    targetUsername: null,
    detail:
      `สร้างรางวัล ${reward.name} (${reward.menuName}) ` +
      `ใช้ ${reward.pointsCost} แต้ม` +
      (reward.quotaTotal !== null ? ` สิทธิ์ ${reward.quotaTotal}` : " ไม่จำกัดสิทธิ์"),
  };
}

export function rewardUpdatedEvent(
  before: { pointsCost: number; quotaTotal: number | null },
  after: Reward,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "reward_updated",
    targetId: after.id,
    targetUsername: null,
    detail:
      `แก้ไขรางวัล ${after.name}: ` +
      `คะแนน ${before.pointsCost} → ${after.pointsCost} แต้ม, ` +
      `สิทธิ์ ${before.quotaTotal ?? "ไม่จำกัด"} → ${after.quotaTotal ?? "ไม่จำกัด"}`,
  };
}

export function rewardStatusChangedEvent(after: Reward, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "reward_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail: `เปลี่ยนสถานะรางวัล ${after.name} เป็น${after.isActive ? "เปิดรับแลก" : "ปิดรับแลก"}`,
  };
}
