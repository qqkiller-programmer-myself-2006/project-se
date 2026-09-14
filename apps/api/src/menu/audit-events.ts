import type { AuditInput, ShopActor } from "../store.js";
import type { MenuItem } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 04 — Memory และ MySQL ใช้ชุดเดียวกัน
 * detail เก็บค่าก่อน/หลังเมื่อแก้ไข (ไม่มีข้อมูลลับ — เมนูไม่มี password/token/secret)
 */

function base(actor: ShopActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

function summarize(m: {
  category: string;
  name: string;
  price: number;
  kind: string;
  status: string;
  sortOrder: number;
}): string {
  return `${m.category}/${m.name} ${m.price} บาท ${m.kind} ${m.status} ลำดับ ${m.sortOrder}`;
}

export function menuCreatedEvent(item: MenuItem, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_created",
    targetId: item.id,
    targetUsername: null,
    detail: `เพิ่มเมนู: ${summarize(item)}`,
  };
}

export function menuUpdatedEvent(before: MenuItem, after: MenuItem, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_updated",
    targetId: after.id,
    targetUsername: null,
    detail: `แก้เมนู: ก่อน [${summarize(before)}] → หลัง [${summarize(after)}]`,
  };
}

export function menuStatusChangedEvent(before: MenuItem, after: MenuItem, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail: `เปลี่ยนสถานะเมนู ${after.category}/${after.name}: ${before.status} → ${after.status}`,
  };
}

export function menuArchivedEvent(item: MenuItem, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_archived",
    targetId: item.id,
    targetUsername: null,
    detail: `archive เมนู: ${summarize(item)}`,
  };
}

export function menuRestoredEvent(item: MenuItem, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_restored",
    targetId: item.id,
    targetUsername: null,
    detail: `นำเมนูกลับมาขาย: ${summarize(item)}`,
  };
}
