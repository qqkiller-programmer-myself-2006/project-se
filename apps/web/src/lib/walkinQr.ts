/**
 * Issue #44: รหัส QR รับแต้ม (Walk-in) ที่สแกนจากกล้อง
 *
 * QR ของร้านมีเพียงรหัส `WALKIN-<token>` (ตรงกับ normalizeWalkinCode ฝั่ง server) —
 * ข้อความอื่นจาก QR ใด ๆ (ลิงก์ ข้อความทั่วไป) ถูกเมินทั้งหมด ไม่เปิดลิงก์และไม่ส่งไปที่ server
 * เพื่อไม่ให้การสแกน QR มั่วกลายเป็นช่องทางพาไปเว็บอื่นหรือยิงคำขอแปลก ๆ
 */
const WALKIN_CODE = /^WALKIN-[A-Z0-9]{4,32}$/;

/** คืนรหัสตัวพิมพ์ใหญ่เมื่อข้อความที่สแกนได้เป็นรหัสรับแต้มทั้งก้อน ไม่เช่นนั้นคืน null */
export function extractWalkinCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  return WALKIN_CODE.test(code) ? code : null;
}
