import { describe, expect, it } from "vitest";
import {
  buildBookingDays,
  buildTimeSlots,
  firstOpenDay,
  pickDefaultSlot,
  slotToDate,
  toDateKey,
} from "../src/lib/reservationSlots";

/** instant ของเวลากรุงเทพ (UTC+7) — เทสต์ต้องไม่ขึ้นกับ timezone ของเครื่องที่รัน */
function bkk(y: number, monthIndex: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, monthIndex, d, h - 7, mi));
}

describe("ช่องวันเวลาสำหรับจองโต๊ะ", () => {
  it("วันนี้เหลือเฉพาะเวลาที่ห่างจากตอนนี้อย่างน้อย 60 นาที ถึง 19:00", () => {
    const now = bkk(2026, 8, 17, 16, 10);
    expect(buildTimeSlots("2026-09-17", now)).toEqual(["17:30", "18:00", "18:30", "19:00"]);
  });

  it("วันถัดไปเริ่ม 09:00 ทุก 30 นาที และตัดช่องที่เกิน 3 วัน", () => {
    const now = bkk(2026, 8, 17, 10, 0);
    expect(buildTimeSlots("2026-09-18", now)).toHaveLength(21);
    expect(buildTimeSlots("2026-09-20", now)).toEqual(["09:00", "09:30", "10:00"]);
    expect(buildTimeSlots("2026-09-21", now)).toEqual([]);
  });

  it("วันนี้ยังแสดงแม้หมดเวลาจอง (ปิดรับ) และตั้งชื่อวันที่อ่านง่าย", () => {
    const late = bkk(2026, 8, 17, 21, 59);
    const days = buildBookingDays(late);
    expect(days.map((d) => d.label)).toEqual(["วันนี้", "พรุ่งนี้", "มะรืนนี้", "อีก 3 วัน"]);
    expect(days[0]).toMatchObject({ key: "2026-09-17", closed: true });
    expect(days.slice(1).every((d) => !d.closed)).toBe(true);
    expect(firstOpenDay(days)!.key).toBe("2026-09-18");
    expect(new Set(days.map((d) => d.dateLabel)).size).toBe(4);
    const morning = buildBookingDays(bkk(2026, 8, 17, 8, 0));
    expect(morning.map((d) => d.label).slice(0, 3)).toEqual(["วันนี้", "พรุ่งนี้", "มะรืนนี้"]);
    expect(morning[0]!.closed).toBeUndefined();
    expect(firstOpenDay(morning)!.key).toBe("2026-09-17");
  });

  it("ช่องเริ่มต้นเว้นอย่างน้อย 2 ชั่วโมง", () => {
    expect(pickDefaultSlot(bkk(2026, 8, 17, 10, 5))).toEqual({ dateKey: "2026-09-17", time: "12:30" });
    expect(pickDefaultSlot(bkk(2026, 8, 17, 17, 50))).toEqual({ dateKey: "2026-09-18", time: "09:00" });
  });

  it("แปลงวันและเวลาเป็นเวลากรุงเทพ ไม่ขึ้นกับ timezone ของเครื่อง", () => {
    const d = slotToDate("2026-09-18", "12:30");
    expect(toDateKey(d)).toBe("2026-09-18");
    expect(d.toISOString()).toBe("2026-09-18T05:30:00.000Z");
    // 23:30 กรุงเทพ = 16:30Z วันเดียวกัน — วันที่ต้องยังเป็นของกรุงเทพ
    expect(toDateKey(new Date("2026-09-18T17:30:00.000Z"))).toBe("2026-09-19");
  });
});
