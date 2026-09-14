import { createHash, randomUUID } from "node:crypto";
import {
  PAYMENT_REASON_MAX,
  PAYMENT_REFERENCE_MAX,
  ConflictError,
  type PaymentMethod,
  type PaymentStatus,
} from "../types.js";

/**
 * Ticket 08: กฎ validation การชำระเงิน (pure — ใช้ร่วมกันทั้ง memory/MySQL
 * ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store; ห้าม duplicate semantics ที่ router)
 * - method: cash | promptpay
 * - amount ต้องตรงยอดคำสั่งซื้อพอดี (FR-PAY-001 — ตรึงไว้กับคำสั่งซื้อเมื่อส่งคำขอชำระเงิน)
 * - cash: receivedAmount ≥ amount (ทอน = รับมา − ยอด); น้อยกว่ายอด → 400
 * - reason: 1–500 ตัวอักษร (ใช้กับ manual review/resolve/refund/cancel)
 * - idempotencyKey: UUID ต่อการกดชำระหนึ่งครั้ง
 * - providerEventId: 1–120 ตัวอักษร (dedupe webhook)
 */

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  if (value !== "cash" && value !== "promptpay") {
    throw new Error("กรุณาเลือกวิธีชำระเงิน (เงินสด หรือ พร้อมเพย์)");
  }
  return value;
}

export function normalizePaymentStatus(value: unknown): PaymentStatus {
  const allowed: PaymentStatus[] = [
    "pending",
    "paid",
    "manual_review",
    "failed",
    "expired",
    "refunded",
    "cancelled",
  ];
  if (typeof value !== "string" || !(allowed as string[]).includes(value)) {
    throw new Error("สถานะการชำระเงินไม่ถูกต้อง");
  }
  return value as PaymentStatus;
}

export function normalizePaymentReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("กรุณาระบุเหตุผล");
  const v = value.trim();
  if (!v) throw new Error("กรุณาระบุเหตุผล");
  if (v.length > PAYMENT_REASON_MAX) throw new Error(`เหตุผลต้องไม่เกิน ${PAYMENT_REASON_MAX} ตัวอักษร`);
  return v;
}

export function normalizePaymentReference(value: unknown, label = "เลขอ้างอิง"): string {
  if (typeof value !== "string") throw new Error(`${label}ต้องเป็นข้อความ`);
  const v = value.trim();
  if (!v) throw new Error(`กรุณาระบุ${label}`);
  if (v.length > PAYMENT_REFERENCE_MAX) throw new Error(`${label}ต้องไม่เกิน ${PAYMENT_REFERENCE_MAX} ตัวอักษร`);
  return v;
}

/** รหัสเหตุการณ์ provider สำหรับ dedupe webhook (1–120 ตัวอักษร) */
export function normalizeProviderEventId(value: unknown): string {
  if (typeof value !== "string") throw new Error("รหัสเหตุการณ์การชำระเงินไม่ถูกต้อง");
  const v = value.trim();
  if (!v) throw new Error("รหัสเหตุการณ์การชำระเงินไม่ถูกต้อง");
  if (v.length > PAYMENT_REFERENCE_MAX) throw new Error("รหัสเหตุการณ์การชำระเงินยาวเกินไป");
  return v;
}

export function normalizePaymentIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("คำขอขาดรหัสป้องกันการส่งซ้ำ กรุณาลองใหม่อีกครั้ง");
  }
  const v = value.trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    throw new Error("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  return v.toLowerCase();
}

/** สร้าง idempotency key ใหม่ (ฝั่ง web ใช้ตอนกดชำระเงิน) */
export function generatePaymentIdempotencyKey(): string {
  return randomUUID();
}

/**
 * ตรวจเงินสด: รับมาต้องไม่น้อยกว่ายอด (กันทอนติดลบ)
 * คืนเงินทอนที่ปัด 2 ตำแหน่ง; โยน 400 (Error ธรรมดา) เมื่อยอดไม่ถูกต้อง
 */
export function assertCashTendered(total: number, received: number): number {
  if (!Number.isFinite(received) || received <= 0) {
    throw new Error("จำนวนเงินที่รับมาต้องมากกว่าศูนย์");
  }
  const tendered = Math.round(received * 100) / 100;
  if (tendered < total) {
    throw new Error(`เงินที่รับมา (${tendered} บาท) น้อยกว่ายอดชำระ (${total} บาท)`);
  }
  return Math.round((tendered - total) * 100) / 100;
}

/** เลขอ้างอิงใบเสร็จ: RCP-YYYYMMDD-XXXX (XXXX สุ่ม A–Z0–9 กันชนด้วยการ retry ที่ store) */
export function generateReceiptNumber(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i += 1) {
    rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RCP-${date}-${rand}`;
}

/**
 * hash ของข้อมูล intent สำหรับตรวจ idempotency:
 * key เดิม + payload เดิม = ส่งซ้ำ → คืน payment เดิม
 * key เดิม + payload ต่างกัน = ขัดแย้ง → 409
 */
export function paymentPayloadHash(payload: {
  orderId: string;
  method: PaymentMethod;
  amount: number;
  receivedAmount: number | null;
}): string {
  const canonical = JSON.stringify({
    orderId: payload.orderId,
    method: payload.method,
    amount: payload.amount,
    receivedAmount: payload.receivedAmount,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * ตรวจ transition ของ payment state machine (ขัดกัน → ConflictError = 409):
 * - pending → paid/manual_review/failed/expired/cancelled
 * - manual_review → paid/failed/cancelled (แอดมินตรวจมือแล้วตัดสิน)
 * - สถานะปลายทาง (paid/failed/expired/refunded/cancelled) ห้ามเปลี่ยนต่อ
 *   ยกเว้น paid → refunded ผ่านช่องทางคืนเงินเท่านั้น
 */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === "pending") {
    if (to === "paid" || to === "manual_review" || to === "failed" || to === "expired" || to === "cancelled") return;
    throw new ConflictError("สถานะการชำระเงินปลายทางไม่ถูกต้อง");
  }
  if (from === "manual_review") {
    if (to === "paid" || to === "failed" || to === "cancelled") return;
    throw new ConflictError("รายการรอตรวจสอบต้องให้ผู้ดูแลระบบตัดสิน (สำเร็จ/ไม่สำเร็จ/ยกเลิก) เท่านั้น");
  }
  throw new ConflictError("การชำระเงินนี้ปิดงานแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก");
}

/** ผลลัพธ์จาก provider (webhook/slip) — ambiguous/timeout ต้องเข้า manual_review */
export type ProviderOutcome = "success" | "ambiguous" | "fail";

export function normalizeProviderOutcome(value: unknown): ProviderOutcome {
  if (value !== "success" && value !== "ambiguous" && value !== "fail") {
    throw new Error("ผลการชำระเงินจากผู้ให้บริการไม่ถูกต้อง");
  }
  return value;
}

/** แปลง outcome เป็นสถานะปลายทาง (success → paid, ambiguous → manual_review, fail → failed) */
export function outcomeToStatus(outcome: ProviderOutcome): PaymentStatus {
  if (outcome === "success") return "paid";
  if (outcome === "ambiguous") return "manual_review";
  return "failed";
}
