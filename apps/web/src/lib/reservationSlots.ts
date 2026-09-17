/**
 * ช่องวัน/เวลาสำหรับจองโต๊ะ (ฝั่งลูกค้า)
 * - กฎเดียวกับ API: จองล่วงหน้าอย่างน้อย 60 นาที และไม่เกิน 3 วัน
 * - ร้านเปิด 09:00–21:00 และถือโต๊ะให้ 120 นาที จึงเริ่มนัดได้ถึง 19:00 ทุก 30 นาที
 * - เวลาเป็นเวลาท้องถิ่นของเครื่อง (ร้านและลูกค้าอยู่ในเขตเวลาไทย)
 */
export const RESERVATION_MIN_LEAD_MINUTES = 60;
export const RESERVATION_MAX_ADVANCE_DAYS = 3;
export const FIRST_SLOT_MINUTES = 9 * 60;
export const LAST_SLOT_MINUTES = 19 * 60;
export const SLOT_STEP_MINUTES = 30;

export interface BookingDay {
  key: string;
  label: string;
  dateLabel: string;
  /** วันนี้แต่หมดเวลาจองแล้ว — ยังแสดงให้เห็น แต่เลือกไม่ได้ */
  closed?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slotToDate(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

function isBookable(at: Date, now: Date): boolean {
  const t = at.getTime();
  return (
    t >= now.getTime() + RESERVATION_MIN_LEAD_MINUTES * 60_000 &&
    t <= now.getTime() + RESERVATION_MAX_ADVANCE_DAYS * 24 * 60 * 60_000
  );
}

/** เวลาที่ยังจองได้ของวันนั้น (รูปแบบ HH:MM) */
export function buildTimeSlots(dateKey: string, now: Date): string[] {
  const slots: string[] = [];
  for (let m = FIRST_SLOT_MINUTES; m <= LAST_SLOT_MINUTES; m += SLOT_STEP_MINUTES) {
    const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (isBookable(slotToDate(dateKey, time), now)) slots.push(time);
  }
  return slots;
}

const DAY_NAMES = ["วันนี้", "พรุ่งนี้", "มะรืนนี้"];

/**
 * วันนี้ถึงอีก 3 วัน — วันนี้แสดงเสมอ (ถ้าหมดเวลาจองจะเป็น closed)
 * วันอื่นที่ไม่มีช่องเวลาเหลือจะไม่แสดง
 */
export function buildBookingDays(now: Date): BookingDay[] {
  const days: BookingDay[] = [];
  for (let offset = 0; offset <= RESERVATION_MAX_ADVANCE_DAYS; offset += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = toDateKey(d);
    const closed = buildTimeSlots(key, now).length === 0;
    if (closed && offset > 0) continue;
    const dateLabel = d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
    const day: BookingDay = { key, label: DAY_NAMES[offset] ?? `อีก ${offset} วัน`, dateLabel };
    if (closed) day.closed = true;
    days.push(day);
  }
  return days;
}

/** วันแรกที่ยังเลือกจองได้ */
export function firstOpenDay(days: BookingDay[]): BookingDay | undefined {
  return days.find((d) => !d.closed);
}

/** ช่องแรกที่จองได้โดยเว้นอย่างน้อย 2 ชั่วโมง (ถ้าไม่มีก็ใช้ช่องแรกที่จองได้) */
export function pickDefaultSlot(now: Date): { dateKey: string; time: string } | null {
  let fallback: { dateKey: string; time: string } | null = null;
  for (const day of buildBookingDays(now)) {
    for (const time of buildTimeSlots(day.key, now)) {
      fallback ??= { dateKey: day.key, time };
      if (slotToDate(day.key, time).getTime() >= now.getTime() + 2 * 60 * 60_000) {
        return { dateKey: day.key, time };
      }
    }
  }
  return fallback;
}

export function formatBookingDateTime(at: Date): string {
  return at.toLocaleString("th-TH", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
