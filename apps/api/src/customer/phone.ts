/**
 * กฎ normalize เบอร์โทรไทย (Ticket 03) — บันทึกชัดเจนที่นี่ที่เดียว
 * routes ห้าม duplicate กฎ: เรียก `normalizeThaiPhone` เท่านั้น
 *
 * กฎ:
 * 1. ตัดช่องว่าง ขีดกลาง วงเล็บ และจุดออกทั้งหมด (รับ "08-1234-5678", "+66 81 234 5678")
 * 2. อนุญาตอักขระเฉพาะตัวเลขกับเครื่องหมาย + นำหน้าเท่านั้น
 * 3. แปลงรหัสประเทศเป็นรูปแบบในประเทศ:
 *    - ขึ้นต้น "+66" → แทนด้วย "0" (เช่น "+66812345678" → "0812345678")
 *    - ขึ้นต้น "66" ยาว 11 หลัก → แทนด้วย "0" (เช่น "66812345678" → "0812345678")
 * 4. ผลลัพธ์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย "0" เท่านั้น (เช่น "0812345678")
 *    ไม่ผ่าน → โยน Error ข้อความไทยให้ route ตอบ 400
 *
 * หมายเหตุ: บัญชีที่ลบแล้ว (`isDeleted`) จะตั้ง phone เป็น null เพื่อให้เบอร์เดิม
 * นำกลับมาใช้สมัครใหม่ได้ ส่วน id ภายในคงอยู่เพื่อความถูกต้องของประวัติธุรกรรม
 */

const ALLOWED_RE = /^\+?[0-9\s\-().]+$/;

export function normalizeThaiPhone(input: unknown): string {
  if (typeof input !== "string") throw new Error("กรุณาระบุเบอร์โทรศัพท์");
  const raw = input.trim();
  if (raw.length === 0) throw new Error("กรุณาระบุเบอร์โทรศัพท์");
  if (!ALLOWED_RE.test(raw)) {
    throw new Error("เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0 (เช่น 0812345678)");
  }
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+66")) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith("66") && digits.length === 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (!/^0[0-9]{9}$/.test(digits)) {
    throw new Error("เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0 (เช่น 0812345678)");
  }
  return digits;
}

/**
 * กฎอีเมล (optional):
 * - ค่าว่าง/เว้นวรรคอย่างเดียว → null (ไม่เก็บ)
 * - trim + ตัวพิมพ์เล็กทั้งหมด, ยาวไม่เกิน 254, รูปแบบพื้นฐาน local@domain.tld
 * - ไม่ผ่าน → โยน Error ข้อความไทย
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
  const email = input.trim().toLowerCase();
  if (email.length === 0) return null;
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
  }
  return email;
}
