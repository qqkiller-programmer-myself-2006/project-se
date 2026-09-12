import type { DaySchedule, WeekdayKey } from "../lib/api";
import { weekdayLabel } from "../lib/shop-week";
import { inputClass, secondaryButtonClass } from "./ui";

export interface ScheduleDayFieldProps {
  dayKey: WeekdayKey;
  day: DaySchedule;
  onToggleClosed: (dayKey: WeekdayKey, closed: boolean) => void;
  onChangeInterval: (dayKey: WeekdayKey, index: number, key: "open" | "close", value: string) => void;
  onAddInterval: (dayKey: WeekdayKey) => void;
  onRemoveInterval: (dayKey: WeekdayKey, index: number) => void;
}

/** ฟอร์มช่วงเวลาของหนึ่งวัน (สกัดจาก ShopPage — markup และ accessible name เดิม) */
export function ScheduleDayField({
  dayKey,
  day,
  onToggleClosed,
  onChangeInterval,
  onAddInterval,
  onRemoveInterval,
}: ScheduleDayFieldProps) {
  const label = weekdayLabel(dayKey);
  return (
    <fieldset className="rounded-xl border border-ink-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="px-1 text-sm font-bold text-ink-900">วัน{label}</legend>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-ink-300 px-3 py-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-5 w-5 accent-orange-700"
            checked={day.closed}
            onChange={(e) => onToggleClosed(dayKey, e.target.checked)}
            aria-label={`ปิดทั้งวัน วัน${label}`}
          />
          ปิดทั้งวัน
        </label>
      </div>
      {!day.closed && (
        <div className="mt-2 space-y-2">
          {day.intervals.map((iv, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-ink-700">
                เปิด{" "}
                <input
                  type="time"
                  className={`${inputClass} w-32`}
                  value={iv.open}
                  onChange={(e) => onChangeInterval(dayKey, i, "open", e.target.value)}
                  aria-label={`เวลาเปิด ช่วงที่ ${i + 1} วัน${label}`}
                />
              </label>
              <label className="text-sm font-medium text-ink-700">
                ปิด{" "}
                <input
                  type="time"
                  className={`${inputClass} w-32`}
                  value={iv.close}
                  onChange={(e) => onChangeInterval(dayKey, i, "close", e.target.value)}
                  aria-label={`เวลาปิด ช่วงที่ ${i + 1} วัน${label}`}
                />
              </label>
              <span className="text-xs text-ink-500">
                {iv.close <= iv.open ? "(ข้ามเที่ยงคืน ต้องเป็นช่วงสุดท้าย)" : ""}
              </span>
              {day.intervals.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveInterval(dayKey, i)}
                  className={secondaryButtonClass}
                  aria-label={`ลบช่วงที่ ${i + 1} วัน${label}`}
                >
                  ลบช่วงนี้
                </button>
              )}
            </div>
          ))}
          {day.intervals.length < 4 && (
            <button type="button" onClick={() => onAddInterval(dayKey)} className={secondaryButtonClass}>
              เพิ่มช่วงเวลา
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
