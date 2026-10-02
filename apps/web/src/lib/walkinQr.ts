/**
 * Issue #44: รหัส QR รับแต้ม (Walk-in) ที่สแกนจากกล้อง
 *
 * QR ของร้านมีเพียงรหัส `WALKIN-<token>` (ตรงกับ normalizeWalkinCode ฝั่ง server) —
 * ข้อความอื่นจาก QR ใด ๆ (ลิงก์ ข้อความทั่วไป) ถูกเมินทั้งหมด ไม่เปิดลิงก์และไม่ส่งไปที่ server
 * เพื่อไม่ให้การสแกน QR มั่วกลายเป็นช่องทางพาไปเว็บอื่นหรือยิงคำขอแปลก ๆ
 */
const WALKIN_CODE = /^WALKIN-[A-Z0-9]{4,32}$/;

/** Issue #55: รหัส QR ใบเสร็จ `RCPT-<32hex>-<24hex>` (ลายเซ็นตรวจที่ server) */
const RECEIPT_CODE = /^RCPT-[0-9A-F]{32}-[0-9A-F]{24}$/;

export function isReceiptQrCode(code: string): boolean {
  return RECEIPT_CODE.test(code.trim().toUpperCase());
}

/**
 * รหัสรับแต้มที่สแกน/กรอกได้ทั้งสองแบบ (QR พนักงาน WALKIN-… และ QR ใบเสร็จ RCPT-…) — คืนตัวพิมพ์ใหญ่
 * ข้อความอื่นทั้งหมดคืน null (ไม่เปิดลิงก์/ไม่ส่งไป server)
 */
export function extractRewardQrCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  return WALKIN_CODE.test(code) || RECEIPT_CODE.test(code) ? code : null;
}

/** คืนรหัสตัวพิมพ์ใหญ่เมื่อข้อความที่สแกนได้เป็นรหัสรับแต้มทั้งก้อน ไม่เช่นนั้นคืน null */
export function extractWalkinCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  return WALKIN_CODE.test(code) ? code : null;
}
