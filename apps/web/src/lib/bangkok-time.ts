/**
 * แปลงเวลาระหว่าง wall-clock กรุงเทพ (Asia/Bangkok) กับ UTC ISO แบบ pure
 * - กรุงเทพ = UTC+07:00 ตลอดปี ไม่มี DST จึงบวกลบ offset ตายตัวได้อย่าง deterministic
 * - ใช้ Date.UTC/getUTC* เท่านั้น จึงให้ผลเดียวกันไม่ว่าเครื่อง/runner อยู่ timezone ไหน
 * - ห้ามใช้ new Date("2026-09-12T18:30") กับค่า datetime-local เพราะเบราว์เซอร์/OS
 *   จะตีความเป็น local timezone ของเครื่องนั้น (ไม่ใช่กรุงเทพเสมอไป)
 */

export const BANGKOK_OFFSET_MINUTES = 7 * 60;

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const BANGKOK_WALL_FORMAT_ERROR =
  "รูปแบบวันเวลาไม่ถูกต้อง (ต้องเป็น ปปปป-ดด-วว ชช:นน เช่น 2026-09-12T18:30 เวลากรุงเทพฯ)";

export type BangkokWallParse = { ok: true; iso: string } | { ok: false; error: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * แปลงค่า datetime-local (wall-clock กรุงเทพ) เป็น UTC ISO
 * ตัวอย่าง exact: "2026-09-12T18:30" => "2026-09-12T11:30:00.000Z" เสมอ
 * คืน ok:false พร้อมข้อความไทยเมื่อรูปแบบผิดหรือวันเวลาที่เป็นไปไม่ได้ (เช่น 30 ก.พ.)
 */
export function parseBangkokWall(wall: string): BangkokWallParse {
  const m = WALL_RE.exec(wall);
  if (!m) return { ok: false, error: BANGKOK_WALL_FORMAT_ERROR };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, error: "วันเวลาที่ระบุเป็นไปไม่ได้ กรุณาตรวจสอบอีกครั้ง" };
  }
  // ตรวจปฏิทินจริง (เช่น ก.พ. มี 30 วันไม่ได้, leap year) ด้วยการประกอบกลับแล้วเทียบ
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute
  ) {
    return { ok: false, error: "วันเวลาที่ระบุเป็นไปไม่ได้ กรุณาตรวจสอบอีกครั้ง" };
  }
  const utc = new Date(probe.getTime() - BANGKOK_OFFSET_MINUTES * 60_000);
  return { ok: true, iso: utc.toISOString() };
}

/**
 * แปลง UTC ISO กลับเป็นค่า datetime-local ฝั่งกรุงเทพ (สำหรับตั้งค่าฟิลด์แก้ไข)
 * ตัวอย่าง: "2026-09-12T11:30:00.000Z" => "2026-09-12T18:30"
 * คืน null เมื่อ parse ไม่ได้
 */
export function utcIsoToBangkokWall(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const bkk = new Date(t + BANGKOK_OFFSET_MINUTES * 60_000);
  return (
    `${bkk.getUTCFullYear()}-${pad(bkk.getUTCMonth() + 1)}-${pad(bkk.getUTCDate())}` +
    `T${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}`
  );
}
