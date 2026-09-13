/**
 * ตัวช่วยฝั่ง web สำหรับเบอร์โทรไทย (mirror กฎ server แบบเบา ๆ เพื่อ UX เท่านั้น)
 * กฎจริงอยู่ที่ `apps/api/src/customer/phone.ts` — server ตรวจซ้ำเสมอ
 * กฎ: ตัดขีด/ช่องว่าง/วงเล็บ, +66/66 → 0, ต้องได้ 10 หลักขึ้นต้น 0
 */
export function previewThaiPhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!/^\+?[0-9\s\-().]+$/.test(raw)) return null;
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+66")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("66") && digits.length === 11) digits = `0${digits.slice(2)}`;
  return /^0[0-9]{9}$/.test(digits) ? digits : null;
}
