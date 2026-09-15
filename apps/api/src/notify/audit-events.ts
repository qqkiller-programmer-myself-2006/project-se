import type { AuditInput } from "../store.js";
import type { Notification } from "../types.js";

/**
 * Ticket 12: audit events การแจ้งเตือน (mutation เขียนพร้อม audit แบบ all-or-nothing)
 * - detail เก็บเฉพาะ kind/eventKey/status/attempts — ไม่มี message เต็ม ไม่มี token/secret/PII
 */

interface NotifyActor {
  actorId?: string | null;
  actorUsername?: string | null;
  ip?: string | null;
}

function summary(n: Notification): string {
  return `${n.kind}/${n.eventKey}`;
}

export function notificationQueuedEvent(n: Notification, actor: NotifyActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_queued",
    targetId: n.id,
    detail: `เข้าคิว ${summary(n)}`,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function notificationSentEvent(n: Notification, actor: NotifyActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_sent",
    targetId: n.id,
    detail: `ส่งแล้ว ${summary(n)} ครั้งที่ ${n.attempts + 1}`,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function notificationFailedEvent(
  n: Notification,
  reason: string,
  actor: NotifyActor,
): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_failed",
    targetId: n.id,
    detail: `ส่งไม่สำเร็จ ${summary(n)} ครั้งที่ ${n.attempts}: ${reason}`.slice(0, 500),
    ip: actor.ip ?? null,
    success: false,
  };
}

export function notificationDeadLetterEvent(n: Notification, actor: NotifyActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_dead_letter",
    targetId: n.id,
    detail: `เลิกส่ง ${summary(n)} หลัง ${n.attempts} ครั้ง`,
    ip: actor.ip ?? null,
    success: false,
  };
}

export function notificationRetriedEvent(n: Notification, reason: string, actor: NotifyActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_retried",
    targetId: n.id,
    detail: `สั่งส่งซ้ำ ${summary(n)} เหตุผล: ${reason}`.slice(0, 500),
    ip: actor.ip ?? null,
    success: true,
  };
}

export function notificationSkippedEvent(n: Notification, reason: string, actor: NotifyActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "notification_skipped",
    targetId: n.id,
    detail: `ข้าม ${summary(n)}: ${reason}`.slice(0, 500),
    ip: actor.ip ?? null,
    success: true,
  };
}
