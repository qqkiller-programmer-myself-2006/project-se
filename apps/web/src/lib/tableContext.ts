/**
 * บริบท "กำลังนั่งอยู่ที่โต๊ะไหน" จากการสแกน QR ที่โต๊ะ
 *
 * QR ที่ติดบนโต๊ะพาลูกค้ามาที่ `/?table=<รหัสโต๊ะ>` หน้าเว็บจำค่านี้ไว้
 * ตลอดแท็บ (sessionStorage) เพื่อให้หน้าเมนู/ตะกร้ารู้ว่าเป็นการสั่งกินที่ร้าน
 *
 * ขอบเขตตอนนี้: ใช้ "แสดงบริบท + ตั้งค่าเริ่มต้นเป็นกินที่ร้าน" เท่านั้น
 * ยังไม่ส่ง tableId ไปกับคำสั่งซื้อ เพราะ server ปฏิเสธ tableId ที่ไม่มี roundId
 * (409 ต้องเช็กอินเปิดรอบก่อน) และยังไม่มี endpoint สาธารณะให้เว็บหารอบที่เปิดของโต๊ะ
 */

export const TABLE_CONTEXT_STORAGE_KEY = "paor-table-v1";
const MAX_LENGTH = 40;

/** รหัสโต๊ะที่ยอมรับ: ตัวอักษร/ตัวเลข/ขีด/ขีดล่าง — กัน HTML และ path แปลกปลอม */
export function sanitizeTableCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return null;
  return /^[A-Za-z0-9ก-๙_-]+$/.test(trimmed) ? trimmed : null;
}

/** อ่านรหัสโต๊ะจาก query string (รับทั้ง ?table= และ ?t= ให้ QR สั้นลงได้) */
export function tableCodeFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    return sanitizeTableCode(params.get("table") ?? params.get("t"));
  } catch {
    return null;
  }
}

export function loadTableContext(storage?: Pick<Storage, "getItem">): string | null {
  try {
    const source = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    return sanitizeTableCode(source?.getItem(TABLE_CONTEXT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveTableContext(
  code: string | null,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): void {
  try {
    const target = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    if (!target) return;
    const clean = sanitizeTableCode(code);
    if (!clean) {
      target.removeItem(TABLE_CONTEXT_STORAGE_KEY);
      return;
    }
    target.setItem(TABLE_CONTEXT_STORAGE_KEY, clean);
  } catch {
    // storage ใช้ไม่ได้ (โหมดส่วนตัว) — หน้าเว็บยังสั่งได้ แค่ไม่จำโต๊ะข้ามหน้า
  }
}

/**
 * รหัสโต๊ะที่ควรใช้ตอนนี้: query string ชนะค่าที่จำไว้ (สแกน QR โต๊ะใหม่ = ย้ายโต๊ะ)
 * และบันทึกค่าที่ได้ลง storage ให้หน้าถัดไปอ่านต่อ
 */
export function resolveTableContext(search: string): string | null {
  const fromUrl = tableCodeFromSearch(search);
  if (fromUrl) {
    saveTableContext(fromUrl);
    return fromUrl;
  }
  return loadTableContext();
}
