import { ConflictError, type OrderStatus } from "../types.js";

/**
 * Issue #42: แก้ไขรายการในคำสั่งซื้อ (pure — ใช้ร่วมกันทั้ง memory/MySQL ผ่าน store)
 *
 * กติกา: แก้ได้เฉพาะคำสั่งซื้อที่ "รอชำระเงิน" และยังไม่มีคำขอชำระเงินใด ๆ
 * เพราะหลังมีคำขอชำระ ยอดถูกผูกกับ payment แล้ว และหลังจ่ายออเดอร์เข้าคิวครัว/ตัดสต๊อก
 * แก้แล้วจะไม่ตรงกับของจริง
 *
 * Idempotency: การแก้ไขเป็น "แทนที่ทั้งรายการ" (PUT) — ส่งรายการเดิมซ้ำจึงได้ผลลัพธ์เดิม
 * และ store จะไม่เขียน audit/ledger ซ้ำเมื่อรายการใหม่เหมือนรายการปัจจุบันทุกประการ
 */

export function assertOrderEditable(
  order: { status: OrderStatus; stockConsumed: boolean },
  hasPayment: boolean,
): void {
  if (order.status !== "pending_payment") {
    throw new ConflictError("แก้ไขได้เฉพาะคำสั่งซื้อที่รอชำระเงิน");
  }
  if (hasPayment || order.stockConsumed) {
    throw new ConflictError("คำสั่งซื้อนี้มีคำขอชำระเงินแล้ว แก้ไขไม่ได้ กรุณายกเลิกแล้วสั่งใหม่");
  }
}

export interface EditableLine {
  menuId: string;
  quantity: number;
  note?: string | null;
  optionIds?: readonly string[] | null;
  specialRequest?: string | null;
}

/** ลายเซ็นของชุดรายการ (ไม่สนลำดับบรรทัด/ลำดับตัวเลือก) ไว้เทียบว่าแก้ไขแล้วเปลี่ยนจริงหรือไม่ */
export function orderLinesSignature(lines: readonly EditableLine[]): string {
  return JSON.stringify(
    lines
      .map((l) => JSON.stringify([l.menuId, l.quantity, l.note ?? "", [...(l.optionIds ?? [])].sort(), l.specialRequest ?? ""]))
      .sort(),
  );
}
