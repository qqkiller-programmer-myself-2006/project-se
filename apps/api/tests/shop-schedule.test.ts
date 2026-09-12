import { describe, expect, it } from "vitest";
import {
  WEEKDAY_KEYS,
  defaultWeeklySchedule,
  effectiveOverride,
  evaluateSchedule,
  type ShopOverride,
  type WeeklySchedule,
  type WeekdayKey,
} from "../src/shop/schedule.js";

function weekWith(days: Partial<Record<WeekdayKey, { closed: boolean; intervals: { open: string; close: string }[] }>>): WeeklySchedule {
  const base = defaultWeeklySchedule();
  for (const [k, v] of Object.entries(days)) {
    base[k as WeekdayKey] = v!;
  }
  return base;
}

const overrideAt = (expiresAt: string | null): ShopOverride => ({
  mode: "closed",
  reason: "ทดสอบ",
  expectedReopenAt: null,
  expiresAt,
  createdAt: "2026-09-07T00:00:00.000Z",
  createdBy: "owner",
});

describe("schedule domain (Ticket 02 review)", () => {
  it("WEEKDAY_KEYS ครบ 7 วันตามลำดับ", () => {
    expect([...WEEKDAY_KEYS]).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });

  it("serviceWindow ชี้ช่วงของวันนี้เมื่อเปิดตามปกติ", () => {
    const ev = evaluateSchedule(new Date("2026-09-07T03:00:00.000Z"), defaultWeeklySchedule()); // จันทร์ 10:00 BKK
    expect(ev.isOpen).toBe(true);
    expect(ev.serviceWindow).toEqual({ sourceWeekday: "1", open: "09:00", close: "21:00", overnight: false });
  });

  it("serviceWindow ชี้ overnight ของเมื่อวานตอน 01:00 และปิดตรงขอบ 02:00", () => {
    const sched = weekWith({
      "5": { closed: false, intervals: [{ open: "18:00", close: "02:00" }] },
      "6": { closed: true, intervals: [] },
    });
    const spill = evaluateSchedule(new Date("2026-09-04T18:00:00.000Z"), sched); // เสาร์ 01:00 BKK
    expect(spill.isOpen).toBe(true);
    expect(spill.serviceWindow).toEqual({ sourceWeekday: "5", open: "18:00", close: "02:00", overnight: true });
    // เสาร์วันนี้ปิดทั้งวัน แต่รอบ overnight ยังชี้ของเมื่อวาน (ไม่ใช่ตารางวันนี้)
    expect(spill.weekday).toBe(6);

    const boundary = evaluateSchedule(new Date("2026-09-04T19:00:00.000Z"), sched); // เสาร์ 02:00 ตรง
    expect(boundary.isOpen).toBe(false);
    expect(boundary.serviceWindow).toBeNull();
  });

  it("serviceWindow เป็น null เมื่อปิด และชี้ช่วงเย็นของ overnight วันนี้", () => {
    const sched = weekWith({
      "5": { closed: false, intervals: [{ open: "18:00", close: "02:00" }] },
    });
    const evening = evaluateSchedule(new Date("2026-09-04T16:00:00.000Z"), sched); // ศุกร์ 23:00 BKK
    expect(evening.isOpen).toBe(true);
    expect(evening.serviceWindow).toEqual({ sourceWeekday: "5", open: "18:00", close: "02:00", overnight: true });

    const closed = evaluateSchedule(new Date("2026-09-04T10:00:00.000Z"), sched); // ศุกร์ 17:00 BKK
    expect(closed.isOpen).toBe(false);
    expect(closed.serviceWindow).toBeNull();
  });

  it("effectiveOverride คืน null เมื่อหมดอายุ/ไม่มี และคืนค่าเมื่อยังไม่หมด", () => {
    const now = new Date("2026-09-07T03:00:00.000Z");
    expect(effectiveOverride(now, null)).toBeNull();
    expect(effectiveOverride(now, overrideAt(new Date(now.getTime() - 1000).toISOString()))).toBeNull();
    expect(effectiveOverride(now, overrideAt(new Date(now.getTime()).toISOString()))).toBeNull(); // ตรงเวลาพอดี = หมด
    const live = overrideAt(new Date(now.getTime() + 3600_000).toISOString());
    expect(effectiveOverride(now, live)).toBe(live);
    expect(effectiveOverride(now, overrideAt(null))).not.toBeNull(); // ไม่มี expiry = มีผล
  });
});
