import { describe, expect, it } from "vitest";
import {
  buildBookingDays,
  buildTimeSlots,
  pickDefaultSlot,
  slotToDate,
  toDateKey,
} from "../src/lib/reservationSlots";

describe("ช่องวันเวลาสำหรับจองโต๊ะ", () => {
  it("วันนี้เหลือเฉพาะเวลาที่ห่างจากตอนนี้อย่างน้อย 60 นาที ถึง 19:00", () => {
    const now = new Date(2026, 8, 17, 16, 10);
    expect(buildTimeSlots("2026-09-17", now)).toEqual(["17:30", "18:00", "18:30", "19:00"]);
  });

  it("วันถัดไปเริ่ม 09:00 ทุก 30 นาที และตัดช่องที่เกิน 3 วัน", () => {
    const now = new Date(2026, 8, 17, 10, 0);
    expect(buildTimeSlots("2026-09-18", now)).toHaveLength(21);
    expect(buildTimeSlots("2026-09-20", now)).toEqual(["09:00", "09:30", "10:00"]);
    expect(buildTimeSlots("2026-09-21", now)).toEqual([]);
  });

  it("รายการวันข้ามวันนี้เมื่อไม่เหลือเวลาจอง และตั้งชื่อวันที่อ่านง่าย", () => {
    const late = new Date(2026, 8, 17, 18, 30);
    const days = buildBookingDays(late);
    expect(days[0]!.key).toBe("2026-09-18");
    expect(days[0]!.label).toBe("พรุ่งนี้");
    const morning = buildBookingDays(new Date(2026, 8, 17, 8, 0));
    expect(morning.map((d) => d.label).slice(0, 3)).toEqual(["วันนี้", "พรุ่งนี้", "มะรืนนี้"]);
  });

  it("ช่องเริ่มต้นเว้นอย่างน้อย 2 ชั่วโมง", () => {
    expect(pickDefaultSlot(new Date(2026, 8, 17, 10, 5))).toEqual({ dateKey: "2026-09-17", time: "12:30" });
    expect(pickDefaultSlot(new Date(2026, 8, 17, 17, 50))).toEqual({ dateKey: "2026-09-18", time: "09:00" });
  });

  it("แปลงวันและเวลาเป็นเวลาท้องถิ่น", () => {
    const d = slotToDate("2026-09-18", "12:30");
    expect(toDateKey(d)).toBe("2026-09-18");
    expect([d.getHours(), d.getMinutes()]).toEqual([12, 30]);
  });
});
