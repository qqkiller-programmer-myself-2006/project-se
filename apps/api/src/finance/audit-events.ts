import type { AuditInput } from "../store.js";
import type { FinanceEntry } from "../types.js";

/**
 * Ticket 11: audit events การเงิน (mutation เขียนพร้อม audit แบบ all-or-nothing)
 * - ไม่มีข้อมูลลับ/PII ลูกค้า (actor เป็นพนักงานหลังร้านเท่านั้น)
 * - detail เก็บ kind/category/amount/occurredAt ก่อน→หลังแบบย่อ
 */

interface ShopActor {
  actorId?: string | null;
  actorUsername?: string | null;
  ip?: string | null;
}

function summary(e: FinanceEntry): string {
  return `${e.kind}/${e.category}/${e.amount}`;
}

export function financeEntryCreatedEvent(entry: FinanceEntry, actor: ShopActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "finance_entry_created",
    targetId: entry.id,
    detail: `สร้างรายการ ${summary(entry)} @${entry.occurredAt}`,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function financeEntryUpdatedEvent(
  before: FinanceEntry,
  after: FinanceEntry,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "finance_entry_updated",
    targetId: after.id,
    detail: `${summary(before)} -> ${summary(after)} เหตุผล: ${reason}`,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function financeEntryDeletedEvent(entry: FinanceEntry, reason: string, actor: ShopActor): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "finance_entry_deleted",
    targetId: entry.id,
    detail: `ลบรายการ ${summary(entry)} เหตุผล: ${reason}`,
    ip: actor.ip ?? null,
    success: true,
  };
}
