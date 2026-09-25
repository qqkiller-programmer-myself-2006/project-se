import {
  MENU_CATEGORY_MAX,
  MENU_DESCRIPTION_MAX,
  MENU_IMAGE_URL_MAX,
  MENU_NAME_MAX,
  MENU_PRICE_MAX,
  MENU_SORT_ORDER_MAX,
  MENU_SORT_ORDER_MIN,
  type MenuKind,
  type MenuStatus,
} from "../types.js";

/**
 * Ticket 04: กฎ validation เมนู (pure — ใช้ร่วมกันทั้ง memory/MySQL adapter ผ่าน store)
 * - category/name: trim แล้วต้องไม่ว่าง, จำกัดความยาว
 * - description: optional (null/"" → null), ยาวไม่เกิน 500
 * - imageUrl: optional (null/"" → null); ถ้าระบุต้องเป็น absolute http/https URL หรือ path
 *   ภายในเว็บเดียวกันที่ขึ้นต้นด้วย "/" (เช่น /menu/items/cha-tai.png ที่ migration 016 seed ไว้)
 *   ยาวไม่เกิน 2048
 *   (ยังไม่รองรับอัปโหลดไฟล์จริง — เก็บ URL อย่างเดียว)
 * - price: ตัวเลข finite, >= 0, <= 1,000,000, ทศนิยมไม่เกิน 2 ตำแหน่ง
 * - kind: food | drink; status: available | unavailable
 * - sortOrder: จำนวนเต็ม 0–10000 (default 0)
 */

export interface MenuInput {
  category: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  kind: MenuKind;
  status?: MenuStatus;
  sortOrder?: number;
}

export interface NormalizedMenuInput {
  category: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  kind: MenuKind;
  status: MenuStatus;
  sortOrder: number;
}

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeCategory(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุหมวดหมู่");
  const v = value.trim();
  if (!v) fail("กรุณาระบุหมวดหมู่");
  if (v.length > MENU_CATEGORY_MAX) fail(`หมวดหมู่ต้องไม่เกิน ${MENU_CATEGORY_MAX} ตัวอักษร`);
  return v;
}

export function normalizeMenuName(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุชื่อเมนู");
  const v = value.trim();
  if (!v) fail("กรุณาระบุชื่อเมนู");
  if (v.length > MENU_NAME_MAX) fail(`ชื่อเมนูต้องไม่เกิน ${MENU_NAME_MAX} ตัวอักษร`);
  return v;
}

export function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("รายละเอียดเมนูต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > MENU_DESCRIPTION_MAX) fail(`รายละเอียดเมนูต้องไม่เกิน ${MENU_DESCRIPTION_MAX} ตัวอักษร`);
  return v;
}

export function normalizeImageUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("URL รูปภาพต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > MENU_IMAGE_URL_MAX) fail(`URL รูปภาพต้องไม่เกิน ${MENU_IMAGE_URL_MAX} ตัวอักษร`);
  if (/\s/.test(v)) fail("URL รูปภาพต้องไม่มีช่องว่าง");
  // path ภายในเว็บ (ไฟล์ใน apps/web/public) — เมนูที่ seed ด้วย path แบบนี้ต้องแก้ไขต่อได้
  // ห้าม "//host" (protocol-relative ชี้ออกนอกเว็บ) และ "\" ที่เบราว์เซอร์ตีความเป็น "/"
  if (v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    fail("URL รูปภาพต้องเป็น http:// หรือ https:// ที่ถูกต้อง");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("URL รูปภาพต้องเป็น http:// หรือ https:// ที่ถูกต้อง");
  }
  return v;
}

export function normalizePrice(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("ราคาต้องเป็นตัวเลข");
  if (n < 0) fail("ราคาต้องไม่ติดลบ");
  if (n > MENU_PRICE_MAX) fail(`ราคาต้องไม่เกิน ${MENU_PRICE_MAX.toLocaleString("th-TH")} บาท`);
  if (Math.round(n * 100) !== n * 100) fail("ราคามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  return n;
}

export function normalizeKind(value: unknown): MenuKind {
  if (value !== "food" && value !== "drink") fail("ประเภทเมนูต้องเป็น อาหาร หรือ เครื่องดื่ม");
  return value;
}

export function normalizeMenuStatus(value: unknown): MenuStatus {
  if (value !== "available" && value !== "unavailable") fail("สถานะเมนูต้องเป็น เปิดขาย หรือ ปิดขาย");
  return value;
}

export function normalizeSortOrder(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("ลำดับการแสดงผลต้องเป็นจำนวนเต็ม");
  if (n < MENU_SORT_ORDER_MIN || n > MENU_SORT_ORDER_MAX) {
    fail(`ลำดับการแสดงผลต้องอยู่ระหว่าง ${MENU_SORT_ORDER_MIN}–${MENU_SORT_ORDER_MAX}`);
  }
  return n;
}

/** normalize สำหรับสร้างเมนูใหม่ (status default available, sortOrder default 0) */
export function normalizeMenuInput(input: MenuInput): NormalizedMenuInput {
  return {
    category: normalizeCategory(input.category),
    name: normalizeMenuName(input.name),
    description: normalizeDescription(input.description ?? null),
    imageUrl: normalizeImageUrl(input.imageUrl ?? null),
    price: normalizePrice(input.price),
    kind: normalizeKind(input.kind),
    status: input.status === undefined ? "available" : normalizeMenuStatus(input.status),
    sortOrder: normalizeSortOrder(input.sortOrder ?? 0),
  };
}

/** จัดเรียงสำหรับแสดงผล: หมวดหมู่ (ไทย) → sortOrder → ชื่อ (ไทย) */
export function compareMenuCategory(a: string, b: string): number {
  return a.localeCompare(b, "th");
}
