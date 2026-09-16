import type { AuditInput, ShopActor, ShopOverrideInput } from "../store.js";
import { TABLE_ZONE_LABELS, type TableZone } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 02 — Memory และ MySQL ใช้ชุดเดียวกัน
 * action/detail semantics จะได้ไม่ drift ระหว่าง adapter (transaction writer ยังอยู่ที่ store)
 */

function base(actor: ShopActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function shopNameUpdatedEvent(shopName: string, actor: ShopActor): AuditInput {
  return { ...base(actor), action: "shop_name_updated", detail: `ชื่อร้าน: ${shopName}` };
}

export function shopScheduleUpdatedEvent(actor: ShopActor): AuditInput {
  return { ...base(actor), action: "shop_schedule_updated", detail: "ปรับตารางเวลาเปิดประจำสัปดาห์" };
}

export function shopOverrideSetEvent(input: ShopOverrideInput, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "shop_override_set",
    detail: input.mode === "closed" ? `ปิดชั่วคราว: ${input.reason ?? ""}` : "เปิดชั่วคราว",
  };
}

export function shopOverrideClearedEvent(actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "shop_override_cleared",
    detail: "ล้างคำสั่งเปิด–ปิดชั่วคราว กลับไปใช้ตารางประจำสัปดาห์",
  };
}

function zoneText(zone: TableZone | null | undefined): string {
  return zone ? ` ${TABLE_ZONE_LABELS[zone]}` : "";
}

export function shopTableCreatedEvent(
  name: string,
  capacity: number,
  actor: ShopActor,
  zone?: TableZone | null,
): AuditInput {
  return { ...base(actor), action: "shop_table_created", detail: `โต๊ะ ${name} ความจุ ${capacity}${zoneText(zone)}` };
}

export function shopTableUpdatedEvent(
  name: string,
  capacity: number,
  isEnabled: boolean,
  actor: ShopActor,
  zone?: TableZone | null,
): AuditInput {
  return {
    ...base(actor),
    action: "shop_table_updated",
    detail: `โต๊ะ ${name} ความจุ ${capacity}${zoneText(zone)} ${isEnabled ? "พร้อมใช้งาน" : "งดใช้งาน"}`,
  };
}
