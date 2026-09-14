import type { AuditInput, ShopActor } from "../store.js";
import type { Payment, PaymentStatus } from "../types.js";

/**
 * Pure audit-event factories สำหรับ Ticket 08 — Memory และ MySQL ใช้ชุดเดียวกัน
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

const METHOD_LABELS: Record<string, string> = {
  cash: "เงินสด",
  promptpay: "พร้อมเพย์",
};

function summarize(p: Payment): string {
  return `${p.orderNumber} (${METHOD_LABELS[p.method] ?? p.method}) ยอด ${p.amount} บาท สถานะ ${p.status}`;
}

export function paymentCreatedEvent(p: Payment, actor: ShopActor): AuditInput {
  return {
    ...base(actor),
    action: "payment_created",
    targetId: p.id,
    targetUsername: null,
    detail: `สร้างคำขอชำระ ${summarize(p)}`,
  };
}

export function paymentStatusChangedEvent(
  before: { status: PaymentStatus },
  after: Payment,
  reason: string,
  actor: ShopActor,
): AuditInput {
  const action =
    after.status === "paid"
      ? "payment_paid"
      : after.status === "manual_review"
        ? "payment_manual_review"
        : after.status === "failed"
          ? "payment_failed"
          : after.status === "expired"
            ? "payment_expired"
            : "payment_cash_confirmed";
  return {
    ...base(actor),
    action,
    targetId: after.id,
    targetUsername: null,
    detail:
      `เปลี่ยนสถานะชำระ ${after.orderNumber}: ${before.status} → ${after.status} ` +
      `(${METHOD_LABELS[after.method] ?? after.method} ยอด ${after.amount} บาท` +
      (after.receiptNumber ? ` ใบเสร็จ ${after.receiptNumber}` : "") +
      `) เหตุผล: ${reason}`,
  };
}

export function paymentRefundApprovedEvent(
  payment: Payment,
  refundId: string,
  reason: string,
  actor: ShopActor,
): AuditInput {
  return {
    ...base(actor),
    action: "payment_refund_approved",
    targetId: payment.id,
    targetUsername: null,
    detail:
      `อนุมัติคืนเงิน ${payment.orderNumber} ยอด ${payment.amount} บาท ` +
      `(paid → refunded, คำขอ ${refundId}) เหตุผล: ${reason}`,
  };
}
