import type { DaySchedule, WeekdayKey, WeeklySchedule } from "./api";
import { WEEKDAY_KEYS } from "./api";

export const WEEKDAY_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

export function weekdayLabel(key: WeekdayKey): string {
  return WEEKDAY_LABELS[Number(key)] ?? key;
}

export function fmtBangkok(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

export function blankWeek(): WeeklySchedule {
  const w = {} as WeeklySchedule;
  for (const key of WEEKDAY_KEYS) {
    w[key] = { closed: false, intervals: [{ open: "09:00", close: "21:00" }] };
  }
  return w;
}

interface DayShape {
  closed: boolean;
  intervals: { open: string; close: string }[];
}

/** เติมวันขาดด้วยค่าเริ่มต้น กัน schedule ที่ไม่ครบจาก server/mock */
export function mergeWeek(sched: WeeklySchedule | null | undefined): WeeklySchedule {
  const base = blankWeek();
  if (!sched || typeof sched !== "object") return base;
  for (const key of WEEKDAY_KEYS) {
    const day = (sched as Record<string, DayShape | undefined>)[key];
    if (day && typeof day.closed === "boolean" && Array.isArray(day.intervals)) {
      const intervals = day.intervals
        .filter((iv) => iv && typeof iv.open === "string" && typeof iv.close === "string")
        .map((iv) => ({ open: iv.open, close: iv.close }));
      base[key] = { closed: day.closed, intervals } as DaySchedule;
    }
  }
  return base;
}
