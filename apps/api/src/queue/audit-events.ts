import type { AuditInput, ShopActor } from "../store.js";
import { QUEUE_STATION_LABELS, QUEUE_STATUS_LABELS, type QueueJob, type QueueStation } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 09 — Memory และ MySQL ใช้ชุดเดียวกัน
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

function summarize(job: QueueJob): string {
  return `${job.orderNumber} ${job.menuName} ×${job.quantity} (${QUEUE_STATION_LABELS[job.station]})`;
}

export function queueCreatedEvent(job: QueueJob, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "queue_created",
    targetId: job.id,
    targetUsername: null,
    detail: `สร้างงานคิว ${summarize(job)} พร้อมทำ ${job.readyAt}`,
  };
}

export function queueStatusChangedEvent(
  before: { status: string },
  after: QueueJob,
  reason: string,
  actor: ShopActor,
): AuditInput {
  const action =
    after.status === "claimed"
      ? "queue_claimed"
      : after.status === "preparing"
        ? "queue_started"
        : after.status === "ready"
          ? "queue_ready"
          : after.status === "delivered"
            ? "queue_delivered"
            : "queue_cancelled";
  const beforeLabel = QUEUE_STATUS_LABELS[before.status as keyof typeof QUEUE_STATUS_LABELS] ?? before.status;
  return {
    ...base(actor),
    action,
    targetId: after.id,
    targetUsername: null,
    detail:
      `งานคิว ${summarize(after)}: ${beforeLabel} → ${QUEUE_STATUS_LABELS[after.status]} ` +
      `(ทำเสร็จ ${after.readyQty}/${after.quantity} ส่งมอบ ${after.deliveredQty}/${after.quantity})` +
      (reason ? ` เหตุผล: ${reason}` : ""),
  };
}

export function queuePriorityEvent(job: QueueJob, reason: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "queue_priority",
    targetId: job.id,
    targetUsername: null,
    detail: `เร่งงานคิว ${summarize(job)} เหตุผล: ${reason}`,
  };
}

export function queueRemadeEvent(
  original: QueueJob,
  remake: QueueJob,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "queue_remade",
    targetId: remake.id,
    targetUsername: null,
    detail:
      `ทำใหม่จากงานคิว ${summarize(original)} เป็นงาน ${remake.id} ` +
      `จำนวน ${remake.quantity} (ไม่คิดเงินซ้ำ) เหตุผล: ${reason}`,
  };
}

export function queueCapacityUpdatedEvent(
  station: QueueStation,
  before: number,
  after: number,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "queue_capacity_updated",
    targetId: station,
    targetUsername: null,
    detail:
      `ปรับกำลังผลิตฝ่าย${QUEUE_STATION_LABELS[station]} ` +
      `ต่อช่วง 15 นาที: ${before} → ${after} งาน`,
  };
}
