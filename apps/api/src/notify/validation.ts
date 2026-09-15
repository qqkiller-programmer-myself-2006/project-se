import {
  NOTIFICATION_EVENT_KEY_MAX,
  NOTIFICATION_KINDS,
  NOTIFICATION_LAST_ERROR_MAX,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_MESSAGE_MAX,
  NOTIFICATION_STATUSES,
  type NotificationKind,
  type NotificationStatus,
} from "../types.js";

/**
 * Ticket 12: กฎ validation/pure helpers ของ outbox (ใช้ร่วม Memory/MySQL/route)
 * - ห้าม duplicate semantics ที่ router/store — เรียก normalize ที่นี่ที่เดียว
 */

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeNotificationKind(value: unknown): NotificationKind {
  if (typeof value !== "string" || !(NOTIFICATION_KINDS as string[]).includes(value)) {
    fail("ชนิดการแจ้งเตือนไม่ถูกต้อง");
  }
  return value as NotificationKind;
}

export function normalizeNotificationStatus(value: unknown): NotificationStatus {
  if (typeof value !== "string" || !(NOTIFICATION_STATUSES as string[]).includes(value)) {
    fail("สถานะการแจ้งเตือนไม่ถูกต้อง");
  }
  return value as NotificationStatus;
}

export function normalizeNotificationEventKey(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุคีย์กันซ้ำของเหตุการณ์");
  const v = value.trim();
  if (!v) fail("กรุณาระบุคีย์กันซ้ำของเหตุการณ์");
  if (v.length > NOTIFICATION_EVENT_KEY_MAX) {
    fail(`คีย์กันซ้ำต้องไม่เกิน ${NOTIFICATION_EVENT_KEY_MAX} ตัวอักษร`);
  }
  return v;
}

export function normalizeNotificationMessage(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุข้อความแจ้งเตือน");
  const v = value.trim();
  if (!v) fail("กรุณาระบุข้อความแจ้งเตือน");
  if (v.length > NOTIFICATION_MESSAGE_MAX) {
    fail(`ข้อความแจ้งเตือนต้องไม่เกิน ${NOTIFICATION_MESSAGE_MAX} ตัวอักษร`);
  }
  return v;
}

export function normalizeNotificationId(value: unknown, label = "รหัสการแจ้งเตือนไม่ถูกต้อง"): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 36) {
    fail(label);
  }
  return value.trim();
}

/**
 * sanitize ข้อผิดพลาดก่อนเก็บลง outbox/audit:
 * - ตัดเหลือ 500 อักษร, บรรทัดเดียว
 * - ตัดค่าที่หน้าตาเหมือน token/secret (authorization code, bearer, access/refresh/id token)
 *   ทิ้งแล้วแทนด้วย `[redacted]` — กันหลุด secret ลง log/dead-letter
 */
export function sanitizeNotificationError(raw: unknown): string {
  const base = raw instanceof Error ? raw.message : String(raw ?? "ส่งไม่สำเร็จ");
  const redacted = base
    .replace(/[A-Za-z0-9_-]{16,}/g, (m) =>
      /token|secret|bearer|auth|code|key|password/i.test(base) ? "[redacted]" : m,
    )
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const cleaned = redacted.length === 0 ? "ส่งข้อความไม่สำเร็จ" : redacted;
  return cleaned.length > NOTIFICATION_LAST_ERROR_MAX
    ? cleaned.slice(0, NOTIFICATION_LAST_ERROR_MAX)
    : cleaned;
}

/**
 * backoff หลังล้มเหลวครั้งที่ `attempt` (นับครั้งที่ล้มเหลวแล้ว เริ่ม 1):
 * 1 → +1 นาที, 2 → +5 นาที, 3 → +15 นาที, 4+ → +30 นาที
 * คืน null เมื่อ attempt ครบ maxAttempts แล้ว (ต้องเป็น dead_letter)
 */
export function computeNotificationBackoff(
  attempt: number,
  now: Date,
  maxAttempts: number = NOTIFICATION_MAX_ATTEMPTS,
): string | null {
  if (attempt >= maxAttempts) return null;
  const minutes = attempt <= 1 ? 1 : attempt === 2 ? 5 : attempt === 3 ? 15 : 30;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function maxNotificationAttempts(value: unknown): number {
  if (value === undefined || value === null) return NOTIFICATION_MAX_ATTEMPTS;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n) || n < 1 || n > 10) fail("จำนวนครั้งสูงสุดต้องเป็นจำนวนเต็ม 1–10");
  return n;
}
