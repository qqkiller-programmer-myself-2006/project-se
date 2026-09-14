import type { AuditInput, ShopActor } from "../store.js";
import type { ReservationDetail, TableRoundDetail } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 06 — Memory และ MySQL ใช้ชุดเดียวกัน
 * detail เก็บ actor/reason/before/after (เบอร์โทรถูกปกปิดบางส่วน)
 */

function base(actor: ShopActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

/** ปิดบังเบอร์ใน audit/log: 0812345678 → 08******78 */
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  if (phone.length < 4) return "****";
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

export function reservationCreatedEvent(r: ReservationDetail, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "reservation_created",
    targetId: r.id,
    targetUsername: null,
    detail:
      `สร้างการจอง ${r.code} โต๊ะ ${r.tableName} ` +
      `นัด ${r.reservedAt} จำนวน ${r.partySize} คน (ลูกค้า:${r.customerId})`,
  };
}

export function reservationCancelledEvent(
  r: ReservationDetail,
  before: string,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "reservation_cancelled",
    targetId: r.id,
    targetUsername: null,
    detail: `ยกเลิกการจอง ${r.code}: ${before} → cancelled เหตุผล: ${reason}`,
  };
}

export function reservationStatusChangedEvent(
  before: string,
  after: ReservationDetail,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "reservation_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail: `เปลี่ยนสถานะ ${after.code}: ${before} → ${after.status} เหตุผล: ${reason}`,
  };
}

export function reservationCheckedInEvent(
  r: ReservationDetail,
  round: TableRoundDetail,
  actualParty: number,
  actor: ShopActor,
  customerPhone: string | null = null,
): AuditInput {
  return {
    ...base(actor),
    action: "reservation_checked_in",
    targetId: r.id,
    targetUsername: null,
    detail:
      `เช็กอิน ${r.code} (${maskPhone(customerPhone)}) จำนวนจริง ${actualParty} คน ` +
      `เปิดรอบ ${round.id} โต๊ะ ${round.tableName}`,
  };
}

export function tableRoundOpenedEvent(round: TableRoundDetail, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "table_round_opened",
    targetId: round.id,
    targetUsername: null,
    detail: `เปิดรอบการใช้โต๊ะ ${round.tableName} จำนวน ${round.partySize} คน`,
  };
}

export function tableRoundClosedEvent(round: TableRoundDetail, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "table_round_closed",
    targetId: round.id,
    targetUsername: null,
    detail: `ปิดรอบการใช้โต๊ะ ${round.tableName} (เปิด ${round.openedAt} → ปิด ${round.closedAt})`,
  };
}
