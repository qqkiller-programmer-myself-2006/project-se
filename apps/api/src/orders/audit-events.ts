import type { AuditInput, ShopActor } from "../store.js";
import type { OrderDetail, OrderStatus } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 05 — Memory และ MySQL ใช้ชุดเดียวกัน
 * detail เก็บเหตุผลและค่าก่อน/หลังเมื่อเปลี่ยนสถานะ (เบอร์โทรถูกปกปิดบางส่วน)
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
function maskPhone(phone: string | null): string {
  if (!phone) return "-";
  if (phone.length < 4) return "****";
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

const SERVICE_LABELS: Record<string, string> = {
  dine_in: "รับประทานที่ร้าน",
  takeaway: "กลับบ้าน",
  preorder: "ล่วงหน้า",
};

export function orderCreatedEvent(order: OrderDetail, actor: ShopActor): AuditInput {
  const owner =
    order.customerId !== null ? `สมาชิก:${order.customerId}` : `Guest:${order.guestName} ${maskPhone(order.guestPhone)}`;
  return {
    ...base(actor),
    action: "order_created",
    targetId: order.id,
    targetUsername: null,
    detail:
      `สร้างคำสั่งซื้อ ${order.orderNumber} (${SERVICE_LABELS[order.serviceType] ?? order.serviceType}) ` +
      `ยอด ${order.total} บาท ${order.items.length} รายการ โดย ${owner}`,
  };
}

export function orderStatusChangedEvent(
  before: { status: OrderStatus; total: number },
  after: OrderDetail,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "order_status_changed",
    targetId: after.id,
    targetUsername: null,
    detail:
      `เปลี่ยนสถานะ ${after.orderNumber}: ${before.status} → ${after.status} ` +
      `(ยอด ${before.total} → ${after.total} บาท) เหตุผล: ${reason}`,
  };
}
