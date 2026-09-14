/**
 * QR adapter seam สำหรับการจอง (Ticket 06)
 * - รุ่นแรกมีเฉพาะ fake/local เท่านั้น — ห้ามเรียกผู้ให้บริการ QR ภายนอก
 * - QR เก็บแค่รหัสการจอง (`code`) สำหรับเช็กอินหน้าร้าน ไม่เก็บ PII ใด ๆ
 * - production และ tests ใช้ `FakeReservationQrProvider` ตัวเดียวกัน
 */

export interface ReservationQrProvider {
  readonly kind: "fake";
  /** เข้ารหัส code เป็น payload สำหรับแสดงเป็น QR หน้าร้าน */
  encode(code: string): string;
  /** ถอด payload กลับเป็น code — ผิดรูปโยน Error ข้อความไทย */
  decode(payload: string): string;
}

const PREFIX = "PAOR-RSV:";

export class FakeReservationQrProvider implements ReservationQrProvider {
  readonly kind = "fake" as const;

  encode(code: string): string {
    const c = code.trim().toUpperCase();
    if (!c) throw new Error("รหัสการจองไม่ถูกต้อง");
    return `${PREFIX}${c}`;
  }

  decode(payload: string): string {
    if (typeof payload !== "string") throw new Error("QR การจองไม่ถูกต้อง");
    const v = payload.trim().toUpperCase();
    if (!v.startsWith(PREFIX) || v.length <= PREFIX.length) {
      throw new Error("QR การจองไม่ถูกต้อง");
    }
    return v.slice(PREFIX.length);
  }
}
