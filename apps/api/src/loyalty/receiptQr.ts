import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Issue #55: QR รับแต้มที่ผูกกับใบเสร็จ (pure — ใช้ร่วมกันทั้ง route และทดสอบ)
 *
 * token = `RCPT-<paymentId ไม่มีขีด 32 hex>-<ลายเซ็น 24 hex>` (ตัวพิมพ์ใหญ่ทั้งหมด จึงเข้า QR โหมด alphanumeric)
 * ลายเซ็น = HMAC-SHA256(secret, "receipt-qr:v1:" + paymentId) ตัดเหลือ 12 ไบต์
 *
 * ทำไมไม่เก็บ token ในตาราง: ไม่ต้องมี migration (ซึ่งรันอัตโนมัติตอน deploy) และใบเสร็จใบเดียวได้ token เดียวเสมอ
 * (deterministic = idempotent) — แต่ **ไม่ใช่ตัวคุมสถานะ**: ใช้ครั้งเดียวมาจากฝั่งคำสั่งซื้อ
 * (ออเดอร์ที่ผูกเจ้าของแต้มแล้วผูกซ้ำไม่ได้), หมดอายุจาก paid_at ของใบเสร็จ, ยกเลิกเมื่อคืนเงิน
 */

/** อายุของ QR ใบเสร็จ นับจากเวลาชำระเงิน (ชั่วโมง) — เท่ากับ window ผูกคำสั่งซื้อ Guest */
export const RECEIPT_QR_WINDOW_HOURS = 24;

const PREFIX = "RCPT";
const CODE_PATTERN = /^RCPT-([0-9A-F]{32})-([0-9A-F]{24})$/;

function compact(paymentId: string): string | null {
  const hex = paymentId.replace(/-/g, "").toUpperCase();
  return /^[0-9A-F]{32}$/.test(hex) ? hex : null;
}

function expand(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sign(secret: string, paymentId: string): string {
  return createHmac("sha256", secret).update(`receipt-qr:v1:${paymentId}`).digest("hex").slice(0, 24).toUpperCase();
}

/**
 * secret สำหรับเซ็น token — production ต้องตั้ง RECEIPT_QR_SECRET เอง (ไม่ตั้ง = ปิดฟีเจอร์: คืน null)
 * นอก production ถ้าไม่ตั้ง จะสุ่มต่อ process (token เก่าใช้ไม่ได้หลังรีสตาร์ท — พอสำหรับ dev/test)
 */
export function resolveReceiptQrSecret(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env["RECEIPT_QR_SECRET"]?.trim();
  if (configured) {
    if (configured.length < 16) throw new Error("RECEIPT_QR_SECRET ต้องยาวอย่างน้อย 16 ตัวอักษร");
    return configured;
  }
  if (env["NODE_ENV"] === "production") return null;
  return randomBytes(32).toString("hex");
}

/** ออก token ของใบเสร็จ (payment id รูปแบบ UUID) — payment id ผิดรูปแบบ → throw */
export function issueReceiptQrCode(paymentId: string, secret: string): string {
  const hex = compact(paymentId);
  if (!hex) throw new Error("รหัสการชำระเงินไม่ถูกต้อง");
  return `${PREFIX}-${hex}-${sign(secret, expand(hex))}`;
}

/** ตรวจ token: คืน payment id เมื่อรูปแบบถูกและลายเซ็นตรง ไม่เช่นนั้นคืน null (ไม่บอกว่าผิดตรงไหน) */
export function verifyReceiptQrCode(code: unknown, secret: string): { paymentId: string } | null {
  if (typeof code !== "string") return null;
  const m = CODE_PATTERN.exec(code.trim().toUpperCase());
  if (!m) return null;
  const paymentId = expand(m[1]!);
  const expected = Buffer.from(sign(secret, paymentId));
  const given = Buffer.from(m[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { paymentId };
}

/** รูปแบบ token ที่ลูกค้ากรอก/สแกน (ยังไม่ตรวจลายเซ็น) — ใช้แยกประเภทก่อนเรียก endpoint */
export function looksLikeReceiptQrCode(value: unknown): boolean {
  return typeof value === "string" && CODE_PATTERN.test(value.trim().toUpperCase());
}

/** เวลาหมดอายุของ QR (ISO) จากเวลาชำระเงิน */
export function receiptQrExpiresAt(paidAtIso: string): string {
  return new Date(new Date(paidAtIso).getTime() + RECEIPT_QR_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

/** ยังไม่หมดอายุ ณ เวลา now (นับถึงขอบเขตพอดีว่ายังใช้ได้) */
export function isReceiptQrActive(paidAtIso: string, now: Date): boolean {
  return now.getTime() <= new Date(receiptQrExpiresAt(paidAtIso)).getTime();
}
