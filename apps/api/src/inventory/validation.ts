import {
  INGREDIENT_COST_MAX,
  INGREDIENT_NAME_MAX,
  INGREDIENT_STOCK_MAX,
  INGREDIENT_UNIT_MAX,
  MANUAL_STOCK_OPS,
  OPTION_GROUP_NAME_MAX,
  OPTION_NAME_MAX,
  OPTION_PRICE_DELTA_MAX,
  OPTION_SORT_ORDER_MAX,
  OPTION_SORT_ORDER_MIN,
  RECIPE_MAX_LINES,
  RECIPE_QTY_MAX,
  SPECIAL_REQUEST_MAX,
  STOCK_QTY_DECIMALS,
  STOCK_REASON_MAX,
  ConflictError,
  type ManualStockOp,
  type RecipeLine,
  type RecipeTargetType,
} from "../types.js";

/**
 * Ticket 07: กฎ validation ตัวเลือกเมนู/วัตถุดิบ/สูตร/สต๊อก (pure —
 * ใช้ร่วมกันทั้ง memory/MySQL ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store;
 * ห้าม duplicate semantics ที่ router)
 * - กลุ่มตัวเลือก: ชื่อ 1–64 (trim), ลำดับจำนวนเต็ม 0–10000
 * - ตัวเลือก: ชื่อ 1–120 (trim), ส่วนต่างราคา ±1,000,000 ทศนิยม ≤2, enabled boolean,
 *   ลำดับจำนวนเต็ม 0–10000; เลือกได้กลุ่มละไม่เกิน 1 ตัวเลือกต่อรายการ
 * - ความต้องการเฉพาะ: ข้อความล้วน ไม่เปลี่ยนราคา (null/"" → null) ยาวไม่เกิน 200
 * - วัตถุดิบ: ชื่อ 1–120, หน่วย 1–32 (กำหนดตอนสร้าง เปลี่ยนไม่ได้),
 *   ปริมาณทศนิยม ≤3 ตำแหน่ง ≥0, ทุน ≥0 ≤1,000,000 ทศนิยม ≤2
 * - สูตร: 1–50 บรรทัด, วัตถุดิบไม่ซ้ำ, ปริมาณ >0 ทศนิยม ≤3
 * - สต๊อก: ปริมาณ >0 ทศนิยม ≤3, เหตุผล 1–500, manual op เฉพาะ
 *   receive/return/waste/expire/personal_use/adjust
 */

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeOptionGroupName(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุชื่อกลุ่มตัวเลือก");
  const v = value.trim();
  if (!v) fail("กรุณาระบุชื่อกลุ่มตัวเลือก");
  if (v.length > OPTION_GROUP_NAME_MAX) fail(`ชื่อกลุ่มตัวเลือกต้องไม่เกิน ${OPTION_GROUP_NAME_MAX} ตัวอักษร`);
  return v;
}

export function normalizeOptionName(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุชื่อตัวเลือก");
  const v = value.trim();
  if (!v) fail("กรุณาระบุชื่อตัวเลือก");
  if (v.length > OPTION_NAME_MAX) fail(`ชื่อตัวเลือกต้องไม่เกิน ${OPTION_NAME_MAX} ตัวอักษร`);
  return v;
}

/** ส่วนต่างราคา: บวกเพิ่มหรือลดราคาได้ ทศนิยมไม่เกิน 2 ตำแหน่ง */
export function normalizePriceDelta(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("ส่วนต่างราคาต้องเป็นตัวเลข");
  if (n < -OPTION_PRICE_DELTA_MAX || n > OPTION_PRICE_DELTA_MAX) {
    fail(`ส่วนต่างราคาต้องอยู่ระหว่าง -${OPTION_PRICE_DELTA_MAX.toLocaleString("th-TH")} ถึง ${OPTION_PRICE_DELTA_MAX.toLocaleString("th-TH")} บาท`);
  }
  if (Math.round(n * 100) !== n * 100) fail("ส่วนต่างราคามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  return n;
}

export function normalizeOptionSortOrder(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("ลำดับการแสดงผลต้องเป็นจำนวนเต็ม");
  if (n < OPTION_SORT_ORDER_MIN || n > OPTION_SORT_ORDER_MAX) {
    fail(`ลำดับการแสดงผลต้องอยู่ระหว่าง ${OPTION_SORT_ORDER_MIN}–${OPTION_SORT_ORDER_MAX}`);
  }
  return n;
}

export function normalizeEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") fail("สถานะเปิดขายต้องเป็น true หรือ false");
  return value;
}

/**
 * รหัสตัวเลือกที่ลูกค้าเลือกในหนึ่งรายการ: ต้องเป็น array ของ string ไม่ว่าง
 * ไม่ซ้ำกัน (ตรวจว่ากลุ่มละ 1 ตัวเลือกที่ store ซึ่งรู้ผังกลุ่ม)
 */
export function normalizeSelectedOptionIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("ตัวเลือกเมนูไม่ถูกต้อง");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || raw.trim().length === 0) fail("ตัวเลือกเมนูไม่ถูกต้อง");
    const id = raw.trim();
    if (seen.has(id)) fail("มีตัวเลือกซ้ำกันในรายการ กรุณาเลือกอย่างละครั้งเดียว");
    seen.add(id);
    out.push(id);
  }
  if (out.length > 20) fail("ตัวเลือกในหนึ่งรายการมีได้ไม่เกิน 20 ตัวเลือก");
  return out;
}

/** ความต้องการเฉพาะ: ข้อความล้วน ไม่เปลี่ยนราคา (null/"" → null) */
export function normalizeSpecialRequest(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("ความต้องการเฉพาะต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > SPECIAL_REQUEST_MAX) fail(`ความต้องการเฉพาะต้องไม่เกิน ${SPECIAL_REQUEST_MAX} ตัวอักษร`);
  return v;
}

export function normalizeIngredientName(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุชื่อวัตถุดิบ");
  const v = value.trim();
  if (!v) fail("กรุณาระบุชื่อวัตถุดิบ");
  if (v.length > INGREDIENT_NAME_MAX) fail(`ชื่อวัตถุดิบต้องไม่เกิน ${INGREDIENT_NAME_MAX} ตัวอักษร`);
  return v;
}

/** หน่วยของวัตถุดิบ (เช่น กรัม ฟอง มิลลิลิตร ถุง) — กำหนดตอนสร้าง เปลี่ยนไม่ได้ */
export function normalizeIngredientUnit(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุหน่วยของวัตถุดิบ (เช่น กรัม ฟอง มิลลิลิตร ถุง)");
  const v = value.trim();
  if (!v) fail("กรุณาระบุหน่วยของวัตถุดิบ (เช่น กรัม ฟอง มิลลิลิตร ถุง)");
  if (v.length > INGREDIENT_UNIT_MAX) fail(`หน่วยต้องไม่เกิน ${INGREDIENT_UNIT_MAX} ตัวอักษร`);
  return v;
}

/** ปริมาณสต๊อก: ≥0 ทศนิยมไม่เกิน 3 ตำแหน่ง */
export function normalizeStockQty(value: unknown, label = "ปริมาณ"): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail(`${label}ต้องเป็นตัวเลข`);
  if (n < 0) fail(`${label}ต้องไม่ติดลบ`);
  if (n > INGREDIENT_STOCK_MAX) fail(`${label}ต้องไม่เกิน ${INGREDIENT_STOCK_MAX.toLocaleString("th-TH")}`);
  if (Math.round(n * 1000) !== n * 1000) fail(`${label}มีทศนิยมได้ไม่เกิน ${STOCK_QTY_DECIMALS} ตำแหน่ง`);
  return n;
}

/** ปริมาณเคลื่อนไหว: >0 ทศนิยมไม่เกิน 3 ตำแหน่ง (รับเข้า/ตัดใช้/ปรับยอด) */
export function normalizeMovementQty(value: unknown): number {
  const n = normalizeStockQty(value, "ปริมาณ");
  if (n <= 0) fail("ปริมาณต้องมากกว่าศูนย์");
  return n;
}

/** ราคาทุนล่าสุดต่อหน่วย: ≥0 ทศนิยม ≤2 */
export function normalizeLatestCost(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("ราคาทุนต้องเป็นตัวเลข");
  if (n < 0) fail("ราคาทุนต้องไม่ติดลบ");
  if (n > INGREDIENT_COST_MAX) fail(`ราคาทุนต้องไม่เกิน ${INGREDIENT_COST_MAX.toLocaleString("th-TH")} บาท`);
  if (Math.round(n * 100) !== n * 100) fail("ราคาทุนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  return n;
}

export function normalizeReorderThreshold(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  return normalizeStockQty(value, "ระดับเตือนสต๊อก");
}

export function normalizeRecipeTargetType(value: unknown): RecipeTargetType {
  if (value !== "menu" && value !== "option") fail("เป้าหมายสูตรต้องเป็น เมนู หรือ ตัวเลือก");
  return value;
}

export function normalizeTargetId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("เป้าหมายสูตรไม่ถูกต้อง");
  return value.trim();
}

/** สูตร 1–50 บรรทัด วัตถุดิบไม่ซ้ำ ปริมาณ >0 ทศนิยม ≤3 */
export function normalizeRecipeLines(value: unknown): RecipeLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
  }
  if (value.length > RECIPE_MAX_LINES) {
    fail(`สูตรหนึ่งมีวัตถุดิบได้ไม่เกิน ${RECIPE_MAX_LINES} รายการ`);
  }
  const seen = new Set<string>();
  return (value as unknown[]).map((raw) => {
    const row = raw as { ingredientId?: unknown; qty?: unknown };
    if (typeof row?.ingredientId !== "string" || row.ingredientId.trim().length === 0) {
      fail("สูตรอ้างอิงวัตถุดิบไม่ถูกต้อง");
    }
    const ingredientId = row.ingredientId.trim();
    if (seen.has(ingredientId)) fail("สูตรมีวัตถุดิบซ้ำกัน กรุณารวมเป็นบรรทัดเดียว");
    seen.add(ingredientId);
    const n = typeof row?.qty === "string" && row.qty.trim() !== "" ? Number(row.qty) : (row?.qty as number);
    if (typeof n !== "number" || !Number.isFinite(n)) fail("ปริมาณในสูตรต้องเป็นตัวเลข");
    if (n <= 0) fail("ปริมาณในสูตรต้องมากกว่าศูนย์");
    if (n > RECIPE_QTY_MAX) fail("ปริมาณในสูตรมากเกินไป");
    if (Math.round(n * 1000) !== n * 1000) fail("ปริมาณในสูตรมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง");
    return { ingredientId, qty: n };
  });
}

export function normalizeManualStockOp(value: unknown): ManualStockOp {
  if (typeof value !== "string" || !(MANUAL_STOCK_OPS as string[]).includes(value)) {
    fail("ประเภทสต๊อกต้องเป็น รับเข้า รับคืน ของเสีย หมดอายุ ใช้ส่วนตัว หรือปรับยอดตรวจนับ");
  }
  return value as ManualStockOp;
}

export function normalizeStockReason(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุเหตุผลของธุรกรรมสต๊อก");
  const v = value.trim();
  if (!v) fail("กรุณาระบุเหตุผลของธุรกรรมสต๊อก");
  if (v.length > STOCK_REASON_MAX) fail(`เหตุผลต้องไม่เกิน ${STOCK_REASON_MAX} ตัวอักษร`);
  return v;
}

export function normalizeStockReference(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("เลขอ้างอิงต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > 120) fail("เลขอ้างอิงต้องไม่เกิน 120 ตัวอักษร");
  return v;
}

/** ปัดทศนิยมสต๊อก 3 ตำแหน่ง (กัน floating point เพี้ยน) */
export function roundStock(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * กันขายเกิน: พร้อมขาย (onHand − reserved) ต้องพอสำหรับยอดที่ขอ
 * โยน ConflictError (409) เมื่อไม่พอ — ไม่ใช่ 400 (รูปทรงถูกแล้ว)
 */
export function assertAvailableStock(
  ingredientName: string,
  unit: string,
  onHand: number,
  reserved: number,
  required: number,
): void {
  if (roundStock(onHand - reserved) < required) {
    throw new ConflictError(
      `วัตถุดิบ "${ingredientName}" ไม่พอ (พร้อมขาย ${roundStock(onHand - reserved)} ${unit} ต้องการ ${required} ${unit}) กรุณาปรับรายการแล้วยืนยันใหม่อีกครั้ง`,
    );
  }
}
