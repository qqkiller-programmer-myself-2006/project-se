import type { AuditInput, ShopActor } from "../store.js";
import type { Ingredient, MenuOption, MenuOptionGroup, Recipe, StockLedgerEntry } from "../types.js";
import { STOCK_OP_LABELS } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 07 — Memory และ MySQL ใช้ชุดเดียวกัน
 * detail เก็บค่าก่อน/หลังเมื่อแก้ไข (ไม่มี password/token/secret)
 */

function base(actor: ShopActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function optionGroupCreatedEvent(g: MenuOptionGroup, menuName: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_option_group_created",
    targetId: g.id,
    targetUsername: null,
    detail: `เพิ่มกลุ่มตัวเลือก "${g.name}" ของเมนู ${menuName} (ลำดับ ${g.sortOrder})`,
  };
}

export function optionGroupUpdatedEvent(
  before: MenuOptionGroup,
  after: MenuOptionGroup,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "menu_option_group_updated",
    targetId: after.id,
    targetUsername: null,
    detail: `แก้กลุ่มตัวเลือก: ก่อน ["${before.name}" ลำดับ ${before.sortOrder}] → หลัง ["${after.name}" ลำดับ ${after.sortOrder}]`,
  };
}

export function optionCreatedEvent(o: MenuOption, groupName: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_option_created",
    targetId: o.id,
    targetUsername: null,
    detail: `เพิ่มตัวเลือก "${o.name}" ในกลุ่ม ${groupName} (ส่วนต่าง ${o.priceDelta} บาท ลำดับ ${o.sortOrder})`,
  };
}

export function optionUpdatedEvent(before: MenuOption, after: MenuOption, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_option_updated",
    targetId: after.id,
    targetUsername: null,
    detail:
      `แก้ตัวเลือก: ก่อน ["${before.name}" ${before.priceDelta} บาท ลำดับ ${before.sortOrder}] → ` +
      `หลัง ["${after.name}" ${after.priceDelta} บาท ลำดับ ${after.sortOrder}]`,
  };
}

export function optionStatusChangedEvent(before: MenuOption, after: MenuOption, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "menu_option_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail: `เปลี่ยนสถานะตัวเลือก ${after.name}: ${before.isEnabled ? "เปิดขาย" : "ปิดขาย"} → ${after.isEnabled ? "เปิดขาย" : "ปิดขาย"}`,
  };
}

function summarizeIngredient(i: Ingredient): string {
  return `${i.name} (${i.unit}) คงเหลือ ${i.onHand} จอง ${i.reserved} เตือนที่ ${i.reorderThreshold} ทุน ${i.latestCost} บาท`;
}

export function ingredientCreatedEvent(i: Ingredient, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "ingredient_created",
    targetId: i.id,
    targetUsername: null,
    detail: `เพิ่มวัตถุดิบ: ${summarizeIngredient(i)}`,
  };
}

export function ingredientUpdatedEvent(before: Ingredient, after: Ingredient, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "ingredient_updated",
    targetId: after.id,
    targetUsername: null,
    detail: `แก้วัตถุดิบ: ก่อน [${summarizeIngredient(before)}] → หลัง [${summarizeIngredient(after)}]`,
  };
}

export function ingredientStatusChangedEvent(
  before: Ingredient,
  after: Ingredient,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "ingredient_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail: `เปลี่ยนสถานะวัตถุดิบ ${after.name}: ${before.isEnabled ? "เปิดใช้" : "งดใช้"} → ${after.isEnabled ? "เปิดใช้" : "งดใช้"}`,
  };
}

export function recipeCreatedEvent(r: Recipe, targetName: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "recipe_created",
    targetId: r.id,
    targetUsername: null,
    detail:
      `สร้างสูตร ${r.targetType === "menu" ? "เมนู" : "ตัวเลือก"} ${targetName} ` +
      `เวอร์ชัน ${r.version} (${r.lines.length} วัตถุดิบ ต้นทุนประมาณ ${r.estimatedCostPerUnit} บาท/หน่วย)`,
  };
}

export function stockUpdatedEvent(e: StockLedgerEntry, ingredientName: string, unit: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "stock_updated",
    targetId: e.ingredientId,
    targetUsername: null,
    detail:
      `${STOCK_OP_LABELS[e.op]} ${ingredientName}: คงเหลือ ${e.beforeOnHand} → ${e.afterOnHand} ${unit}, ` +
      `จอง ${e.beforeReserved} → ${e.afterReserved} ${unit} เหตุผล: ${e.reason}`,
  };
}

export function orderStockReservedEvent(orderNumber: string, orderId: string, count: number, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "order_stock_reserved",
    targetId: orderId,
    targetUsername: null,
    detail: `จองสต๊อกให้ ${orderNumber} (${count} วัตถุดิบ) ก่อนรับชำระ`,
  };
}

export function orderStockReleasedEvent(orderNumber: string, orderId: string, reason: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "order_stock_released",
    targetId: orderId,
    targetUsername: null,
    detail: `คืนยอดจองของ ${orderNumber} เหตุผล: ${reason}`,
  };
}

export function orderStockConsumedEvent(orderNumber: string, orderId: string, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "order_stock_consumed",
    targetId: orderId,
    targetUsername: null,
    detail: `ตัดสต๊อกจริงของ ${orderNumber} เมื่อเริ่มทำ`,
  };
}
