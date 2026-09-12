import { describe, expect, it } from "vitest";
import {
  BANGKOK_OFFSET_MINUTES,
  parseBangkokWall,
  utcIsoToBangkokWall,
} from "../src/lib/bangkok-time";

describe("bangkok-time (pure, ไม่พึ่ง timezone เครื่อง)", () => {
  it("offset กรุงเทพคงที่ +07:00", () => {
    expect(BANGKOK_OFFSET_MINUTES).toBe(420);
  });

  it("ตัวอย่าง exact: 2026-09-12T18:30 กรุงเทพ => 2026-09-12T11:30:00.000Z", () => {
    const r = parseBangkokWall("2026-09-12T18:30");
    expect(r).toEqual({ ok: true, iso: "2026-09-12T11:30:00.000Z" });
  });

  it("ข้ามวัน: 00:30 กรุงเทพ => 17:30Z ของวันก่อน", () => {
    expect(parseBangkokWall("2026-09-13T00:30")).toEqual({ ok: true, iso: "2026-09-12T17:30:00.000Z" });
  });

  it("29 ก.พ. ปีอธิกสุรทินใช้ได้ แต่ปีไม่ leap ถูกปฏิเสธ", () => {
    expect(parseBangkokWall("2024-02-29T10:00")).toEqual({ ok: true, iso: "2024-02-29T03:00:00.000Z" });
    const bad = parseBangkokWall("2025-02-29T10:00");
    expect(bad.ok).toBe(false);
  });

  it("วัน/เดือน/ชั่วโมง/นาทีที่เป็นไปไม่ได้ถูกปฏิเสธพร้อมข้อความไทย", () => {
    for (const bad of [
      "",
      "2026-13-01T10:00",
      "2026-00-10T10:00",
      "2026-09-31T10:00",
      "2026-09-12T24:00",
      "2026-09-12T10:60",
      "not-a-date",
      "2026-09-12",
      "2026-09-12T10:00:00",
    ]) {
      const r = parseBangkokWall(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/วันเวลา/);
    }
  });

  it("UTC ISO -> Bangkok wall สำหรับตั้งค่าฟิลด์", () => {
    expect(utcIsoToBangkokWall("2026-09-12T11:30:00.000Z")).toBe("2026-09-12T18:30");
    expect(utcIsoToBangkokWall("2026-09-12T17:30:00.000Z")).toBe("2026-09-13T00:30");
    expect(utcIsoToBangkokWall("not-a-date")).toBeNull();
  });

  it("round-trip wall -> ISO -> wall คงเดิม", () => {
    for (const wall of ["2026-01-01T00:00", "2026-09-12T18:30", "2026-12-31T23:59"]) {
      const parsed = parseBangkokWall(wall);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(utcIsoToBangkokWall(parsed.iso)).toBe(wall);
    }
  });
});
