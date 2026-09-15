import {
  FINANCE_AMOUNT_MAX,
  FINANCE_GRANULARITIES,
  FINANCE_CSV_KINDS,
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_INCOME_CATEGORIES,
  FINANCE_KINDS,
  FINANCE_NOTE_MAX,
  FINANCE_REASON_MAX,
  type FinanceCategory,
  type FinanceCsvKind,
  type FinanceGranularity,
  type FinanceKind,
} from "../types.js";

/**
 * Ticket 11: กฎ validation การเงิน/รายงาน (pure — ใช้ร่วมกันทั้ง memory/MySQL
 * ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store; ห้าม duplicate semantics ที่ router)
 * - kind: income|expense เท่านั้น
 * - category ต้องตรงกับ kind (expense → หมวดรายจ่าย, income → หมวดรายรับมือ)
 * - amount >0 ≤100,000,000 ทศนิยม ≤2
 * - occurredAt: UTC ISO ที่ parse ได้ (route แปลงจาก wall-clock กรุงเทพก่อน)
 * - note: "" → null ยาว ≤500; reason บังคับ 1–500
 * - granularity: day|month|year; csv kind: sales|orders|finance|stock|queue
 * - from/to: YYYY-MM-DD wall-clock กรุงเทพ, from ≤ to, ช่วงไม่เกิน 366 วัน
 */

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeFinanceKind(value: unknown): FinanceKind {
  if (value !== "income" && value !== "expense") fail("ประเภทรายการต้องเป็น income หรือ expense");
  if (!FINANCE_KINDS.includes(value)) fail("ประเภทรายการไม่ถูกต้อง");
  return value;
}

export function normalizeFinanceCategory(kind: FinanceKind, value: unknown): FinanceCategory {
  if (typeof value !== "string" || value.trim().length === 0) fail("กรุณาระบุหมวดหมู่");
  const v = value.trim();
  if (kind === "expense") {
    if (!(FINANCE_EXPENSE_CATEGORIES as string[]).includes(v)) {
      fail("หมวดรายจ่ายไม่ถูกต้อง (ingredients/labor/utilities/rent/maintenance/marketing/other_expense)");
    }
    return v as FinanceCategory;
  }
  if (!(FINANCE_INCOME_CATEGORIES as string[]).includes(v)) {
    fail("หมวดรายรับไม่ถูกต้อง (other_income/catering/adjustment)");
  }
  return v as FinanceCategory;
}

export function normalizeFinanceAmount(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("จำนวนเงินต้องเป็นตัวเลข");
  if (n <= 0) fail("จำนวนเงินต้องมากกว่า 0");
  if (n > FINANCE_AMOUNT_MAX) fail(`จำนวนเงินต้องไม่เกิน ${FINANCE_AMOUNT_MAX.toLocaleString("th-TH")} บาท`);
  if (Math.round(n * 100) !== n * 100) fail("จำนวนเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  return n;
}

export function normalizeFinanceOccurredAt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("กรุณาระบุวันที่เกิดรายการ");
  const t = new Date(value.trim()).getTime();
  if (Number.isNaN(t)) fail("รูปแบบวันที่เกิดรายการไม่ถูกต้อง");
  return new Date(t).toISOString();
}

export function normalizeFinanceNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("หมายเหตุต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > FINANCE_NOTE_MAX) fail(`หมายเหตุต้องไม่เกิน ${FINANCE_NOTE_MAX} ตัวอักษร`);
  return v;
}

export function normalizeFinanceReason(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุเหตุผล");
  const v = value.trim();
  if (!v) fail("กรุณาระบุเหตุผล");
  if (v.length > FINANCE_REASON_MAX) fail(`เหตุผลต้องไม่เกิน ${FINANCE_REASON_MAX} ตัวอักษร`);
  return v;
}

const RANGE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertBangkokDate(value: string, label: string): void {
  if (!RANGE_RE.test(value)) fail(`${label}ต้องเป็นรูปแบบ ปปปป-ดด-วว (เช่น 2026-09-15)`);
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) fail(`${label}เป็นวันที่เป็นไปไม่ได้`);
  // ตรวจปฏิทินจริงด้วยการประกอบกลับ (กัน 30 ก.พ.)
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    fail(`${label}เป็นวันที่เป็นไปไม่ได้`);
  }
}

export function normalizeFinanceGranularity(value: unknown): FinanceGranularity {
  if (typeof value !== "string" || !(FINANCE_GRANULARITIES as string[]).includes(value)) {
    fail("ความละเอียดรายงานต้องเป็น day, month หรือ year");
  }
  return value as FinanceGranularity;
}

export function normalizeFinanceCsvKind(value: unknown): FinanceCsvKind {
  if (typeof value !== "string" || !(FINANCE_CSV_KINDS as string[]).includes(value)) {
    fail("ประเภท CSV ต้องเป็น sales, orders, finance, stock หรือ queue");
  }
  return value as FinanceCsvKind;
}

export interface FinanceRange {
  from: string;
  to: string;
}

/** ตรวจ from/to (YYYY-MM-DD กรุงเทพ): from ≤ to และช่วงไม่เกิน 366 วัน */
export function normalizeFinanceRange(from: unknown, to: unknown): FinanceRange {
  if (typeof from !== "string" || typeof to !== "string") fail("กรุณาระบุช่วงวันที่ from/to");
  assertBangkokDate(from, "วันที่เริ่มต้น");
  assertBangkokDate(to, "วันที่สิ้นสุด");
  if (from > to) fail("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด");
  const days =
    (Date.UTC(...to.split("-").map(Number) as [number, number, number]) -
      Date.UTC(...from.split("-").map(Number) as [number, number, number])) /
    86400000;
  if (days > 366) fail("ช่วงวันที่ต้องไม่เกิน 366 วัน");
  return { from, to };
}

export function normalizeBangkokDateOnly(value: unknown, label = "วันที่"): string {
  if (typeof value !== "string") fail(`${label}ต้องเป็นรูปแบบ ปปปป-ดด-วว`);
  assertBangkokDate(value, label);
  return value;
}
