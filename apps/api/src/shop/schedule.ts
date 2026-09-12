/**
 * Deep domain module สำหรับตารางเวลาเปิดประจำสัปดาห์ (Ticket 02)
 * - normalize/validate: ตรวจรูปแบบเวลา HH:MM, ช่วงเวลาถูกต้อง, ไม่ซ้อนทับ, overnight ถูกต้องชัดเจน
 * - evaluate: คำนวณเปิด/ปิดตามเวลา Asia/Bangkok + override ชั่วคราว
 * - route/controller ห้าม duplicate กฎที่นี่: เรียกใช้ฟังก์ชันเหล่านี้เท่านั้น
 */

/** คีย์วัน 0 (อาทิตย์) .. 6 (เสาร์) ตรงกับ getDay ฝั่ง Asia/Bangkok */
export type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["0", "1", "2", "3", "4", "5", "6"];

export interface TimeInterval {
  open: string;
  close: string;
}

export interface DaySchedule {
  closed: boolean;
  intervals: TimeInterval[];
}

export type WeeklySchedule = Record<WeekdayKey, DaySchedule>;

export type OverrideMode = "open" | "closed";

export interface ShopOverride {
  mode: OverrideMode;
  reason: string | null;
  expectedReopenAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export const SHOP_TIMEZONE = "Asia/Bangkok";
export const MAX_INTERVALS_PER_DAY = 4;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeToMinutes(t: string): number {
  const m = TIME_RE.exec(t);
  if (!m) throw new Error(`รูปแบบเวลาไม่ถูกต้อง: ${t} (ต้องเป็น HH:MM 00:00–23:59)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isOvernight(iv: TimeInterval): boolean {
  return parseTimeToMinutes(iv.close) <= parseTimeToMinutes(iv.open);
}

export function defaultWeeklySchedule(): WeeklySchedule {
  const days = {} as WeeklySchedule;
  for (const key of WEEKDAY_KEYS) {
    days[key] = { closed: false, intervals: [{ open: "09:00", close: "21:00" }] };
  }
  return days;
}

export const DEFAULT_SHOP_NAME = "ร้านป้าอ้ออาหารตามสั่ง";

/**
 * ตรวจและ normalize ตารางทั้งสัปดาห์ (full replace: ต้องมีครบ 7 วัน)
 * โยน Error ข้อความไทยเมื่อไม่ผ่าน
 */
export function normalizeWeeklySchedule(input: unknown): WeeklySchedule {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("ตารางเวลาต้องเป็น object ที่มีวัน 0–6 ครบ 7 วัน");
  }
  const src = input as Record<string, unknown>;
  const out = {} as WeeklySchedule;
  for (const key of WEEKDAY_KEYS) {
    const day = src[key];
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new Error(`วันที่ ${key} ต้องมี { closed, intervals }`);
    }
    const { closed, intervals } = day as { closed?: unknown; intervals?: unknown };
    if (typeof closed !== "boolean") throw new Error(`วันที่ ${key} ต้องระบุ closed เป็น true/false`);
    if (!Array.isArray(intervals)) throw new Error(`วันที่ ${key} ต้องมี intervals เป็น array`);
    if (closed && intervals.length > 0) {
      throw new Error(`วันที่ ${key} ปิดทั้งวันต้องไม่มีช่วงเวลา`);
    }
    if (!closed && intervals.length === 0) {
      throw new Error(`วันที่ ${key} เปิดทำการต้องมีช่วงเวลาอย่างน้อย 1 ช่วง`);
    }
    if (intervals.length > MAX_INTERVALS_PER_DAY) {
      throw new Error(`วันที่ ${key} มีช่วงเวลาได้ไม่เกิน ${MAX_INTERVALS_PER_DAY} ช่วง`);
    }
    const list: TimeInterval[] = intervals.map((iv, i) => {
      if (!iv || typeof iv !== "object" || Array.isArray(iv)) {
        throw new Error(`วันที่ ${key} ช่วงที่ ${i + 1} รูปแบบไม่ถูกต้อง`);
      }
      const { open, close } = iv as { open?: unknown; close?: unknown };
      if (typeof open !== "string" || !TIME_RE.test(open)) {
        throw new Error(`วันที่ ${key} ช่วงที่ ${i + 1} เวลาเปิดไม่ถูกต้อง (HH:MM)`);
      }
      if (typeof close !== "string" || !TIME_RE.test(close)) {
        throw new Error(`วันที่ ${key} ช่วงที่ ${i + 1} เวลาปิดไม่ถูกต้อง (HH:MM)`);
      }
      if (open === close) {
        throw new Error(`วันที่ ${key} ช่วงที่ ${i + 1} เวลาเปิดและปิดต้องไม่เท่ากัน`);
      }
      return { open, close };
    });
    // เรียงตามเวลาเปิด แล้วตรวจซ้อนทับ + overnight ต้องเป็นช่วงสุดท้ายช่วงเดียว
    list.sort((a, b) => parseTimeToMinutes(a.open) - parseTimeToMinutes(b.open));
    const overnightIdx = list.map((iv) => isOvernight(iv));
    const overnightCount = overnightIdx.filter(Boolean).length;
    if (overnightCount > 1) {
      throw new Error(`วันที่ ${key} มีช่วงข้ามเที่ยงคืนได้เพียง 1 ช่วง และต้องเป็นช่วงสุดท้าย`);
    }
    if (overnightCount === 1 && !overnightIdx[list.length - 1]) {
      throw new Error(`วันที่ ${key} ช่วงข้ามเที่ยงคืนต้องเป็นช่วงสุดท้ายของวัน`);
    }
    for (let i = 0; i < list.length - 1; i += 1) {
      const cur = list[i]!;
      const next = list[i + 1]!;
      const curEnd = parseTimeToMinutes(cur.close);
      const nextStart = parseTimeToMinutes(next.open);
      // cur ไม่ใช่ overnight ที่นี่ (overnight อยู่ท้ายสุดเท่านั้น)
      if (nextStart < curEnd) {
        throw new Error(`วันที่ ${key} ช่วงเวลาซ้อนทับกัน`);
      }
    }
    out[key] = { closed, intervals: list };
  }
  // ตรวจข้ามวัน: overnight ของวัน D ต้องไม่ซ้อนกับช่วงเช้าของวัน D+1
  for (const key of WEEKDAY_KEYS) {
    const d = Number(key);
    const day = out[key]!;
    if (day.closed || day.intervals.length === 0) continue;
    const last = day.intervals[day.intervals.length - 1]!;
    if (!isOvernight(last)) continue;
    const spillEnd = parseTimeToMinutes(last.close);
    const next = out[String((d + 1) % 7) as WeekdayKey]!;
    if (next.closed) continue;
    const firstStart = parseTimeToMinutes(next.intervals[0]!.open);
    if (firstStart < spillEnd) {
      throw new Error(`ช่วงข้ามเที่ยงคืนของวันที่ ${d} ซ้อนทับกับวันถัดไป`);
    }
  }
  return out;
}

/** แปลง Date เป็นส่วนประกอบฝั่ง Asia/Bangkok แบบ deterministic */
export function bangkokParts(now: Date): { weekday: number; minutes: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = wd[get("weekday")] ?? 0;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { weekday, minutes, date };
}

/** รอบบริการที่กำลังเปิดอยู่จริง — สำคัญตอน overnight ลากจากเมื่อวาน (sourceWeekday อาจไม่ใช่วันนี้) */
export interface ServiceWindow {
  sourceWeekday: WeekdayKey;
  open: string;
  close: string;
  overnight: boolean;
}

export interface ScheduleEvaluation {
  isOpen: boolean;
  weekday: number;
  minutes: number;
  date: string;
  /** null เมื่อปิด — ที่ขอบเขตเวลาปิดตรงตัว (end-exclusive) ถือว่าปิดแล้ว */
  serviceWindow: ServiceWindow | null;
}

/** คำนวณจากตารางล้วน ๆ (ยังไม่รวม override) */
export function evaluateSchedule(now: Date, schedule: WeeklySchedule): ScheduleEvaluation {
  const { weekday, minutes, date } = bangkokParts(now);
  const todayKey = String(weekday) as WeekdayKey;
  const yesterdayKey = String((weekday + 6) % 7) as WeekdayKey;
  const today = schedule[todayKey]!;
  const yesterday = schedule[yesterdayKey]!;

  if (!today.closed) {
    for (const iv of today.intervals) {
      const s = parseTimeToMinutes(iv.open);
      const e = parseTimeToMinutes(iv.close);
      if (e > s) {
        if (minutes >= s && minutes < e) {
          return {
            isOpen: true,
            weekday,
            minutes,
            date,
            serviceWindow: { sourceWeekday: todayKey, open: iv.open, close: iv.close, overnight: false },
          };
        }
      } else if (minutes >= s) {
        // overnight ส่วนของคืนวันนี้
        return {
          isOpen: true,
          weekday,
          minutes,
          date,
          serviceWindow: { sourceWeekday: todayKey, open: iv.open, close: iv.close, overnight: true },
        };
      }
    }
  }
  // overnight ที่ลากมาจากเมื่อวาน (แม้วันนี้ปิดทั้งวันก็ยังนับว่าต่อเนื่อง)
  if (!yesterday.closed && yesterday.intervals.length > 0) {
    const last = yesterday.intervals[yesterday.intervals.length - 1]!;
    if (isOvernight(last) && minutes < parseTimeToMinutes(last.close)) {
      return {
        isOpen: true,
        weekday,
        minutes,
        date,
        serviceWindow: { sourceWeekday: yesterdayKey, open: last.open, close: last.close, overnight: true },
      };
    }
  }
  return { isOpen: false, weekday, minutes, date, serviceWindow: null };
}

export function isOverrideExpired(now: Date, override: Pick<ShopOverride, "expiresAt"> | null): boolean {
  if (!override?.expiresAt) return false;
  const t = new Date(override.expiresAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() >= t;
}

/** override ที่ยังมีผล ณ เวลา now (หมดอายุแล้วถือว่าไม่มี — ใช้ที่เดียวกันทั้ง public/management) */
export function effectiveOverride(now: Date, override: ShopOverride | null): ShopOverride | null {
  if (!override || isOverrideExpired(now, override)) return null;
  return override;
}

/** override ชั่วคราวชนะตารางเสมอ (ถ้ายังไม่หมดอายุ) */
export function evaluateShop(
  now: Date,
  schedule: WeeklySchedule,
  override: ShopOverride | null,
): { isOpen: boolean; isTemporary: boolean } {
  if (effectiveOverride(now, override)) {
    return { isOpen: override!.mode === "open", isTemporary: true };
  }
  return { isOpen: evaluateSchedule(now, schedule).isOpen, isTemporary: false };
}
