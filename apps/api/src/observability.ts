import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Ticket 14 — Observability seams (local-first, ไม่พึ่งบริการภายนอก).
 *
 * - Correlation/request ID ผ่าน header `x-request-id` (รับค่าที่ client ส่งมา
 *   เมื่ออยู่ในรูปแบบที่ปลอดภัย มิฉะนั้นสร้างใหม่) แล้วสะท้อนกลับทุก response
 * - Error taxonomy แบบคงที่ (เพิ่ม field `code` โดยไม่เปลี่ยนข้อความ `error`
 *   ภาษาไทยเดิม — backward compatible กับ tests/contract เดิม)
 * - ตัวช่วย redaction สำหรับ log/audit (ห้ามบันทึก secret/token/PII เต็มรูป)
 */

export const REQUEST_ID_HEADER = "x-request-id";

/** Service version สำหรับ health/ready/metrics (ตรงกับ package.json หลัก) */
export const SERVICE_VERSION = "0.1.0";

/** จำนวน migration ที่ release นี้ต้องมี (001–016, ตรงกับ MIGRATION_FILES ใน store.ts และ scripts/verify-restore.mjs) */
export const RELEASE_MIGRATION_COUNT = 16;

const startedAt = Date.now();

export function serviceUptimeSec(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

export type ErrorCode =
  | "VALIDATION"
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL";

export function statusToErrorCode(status: number): ErrorCode {
  if (status === 400) return "VALIDATION";
  if (status === 401) return "AUTH";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "UNAVAILABLE";
  if (status >= 500) return "INTERNAL";
  return "INTERNAL";
}

export function toErrorBody(code: ErrorCode, message: string): { error: string; code: ErrorCode } {
  return { error: message, code };
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** อ่าน request ID ที่ client ส่งมา (ถ้าถูกต้อง) มิฉะนั้นสร้างใหม่ */
export function resolveRequestId(incoming: unknown): string {
  if (typeof incoming === "string" && REQUEST_ID_RE.test(incoming)) return incoming;
  return randomUUID();
}

/**
 * Express middleware: ผูก request ID กับ request/response ทุกตัว
 * (เก็บใน `(req as any).requestId` + response header — ไม่ log secret ใด ๆ)
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  (req as unknown as { requestId?: string }).requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return (req as unknown as { requestId?: string }).requestId;
}

/** คำที่ถือว่าเป็นความลับ — ห้ามปรากฏใน log/audit/error detail เต็มรูป */
const REDACTED_KEY_PARTS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "verifier",
  "nonce",
  "authorization",
  "cookie",
  "session",
  "sid",
  "csid",
  "apikey",
  "api_key",
  "clientsecret",
  "client_secret",
  "usersub",
  "providersubject",
  "provider_subject",
  "idtoken",
  "id_token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "code_verifier",
  "line_sub",
];

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return REDACTED_KEY_PARTS.some((part) => lower.includes(part.replace(/[^a-z0-9]/g, "")));
}

/** ปกปิดเบอร์โทรไทยเหลือรูป `08******78` (ใช้ใน log/audit เท่านั้น) */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

/**
 * Sanitize object ก่อน log: แทนค่าของ key ที่เป็นความลับด้วย `[REDACTED]`
 * (recursive, ไม่ mutate input; รับมือ circular ด้วยการแทน `[Circular]`)
 */
export function sanitizeForLog(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // เบอร์ไทย 10 หลักขึ้นต้น 0 ใน string อิสระ → mask หยาบกัน PII หลุดใน log
    if (/^0\d{9}$/.test(value.trim())) return maskPhoneForLog(value.trim());
    return value;
  }
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => sanitizeForLog(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isRedactedKey(k) ? "[REDACTED]" : sanitizeForLog(v, seen);
  }
  return out;
}

/**
 * Taxonomy ของ audit event ต่อ domain (ตรงกับ AuditAction ใน types.ts)
 * ใช้ใน docs/OBSERVABILITY.md และ release test (assert ไม่มี event นอก catalog
 * ที่ไม่มี prefix ที่รู้จัก — กัน typo ของ action ใหม่)
 */
export const AUDIT_EVENT_PREFIXES = [
  "login_",
  "logout",
  "user_",
  "account_",
  "roles_changed",
  "password_",
  "shop_",
  "customer_",
  "menu_",
  "order_",
  "reservation_",
  "table_round_",
  "ingredient_",
  "recipe_",
  "stock_",
  "payment_",
  "queue_",
  "loyalty_",
  "reward_",
  "finance_",
  "notification_",
  "prediction_",
] as const;

export function isKnownAuditAction(action: string): boolean {
  return AUDIT_EVENT_PREFIXES.some((p) => action === p || action.startsWith(p));
}
