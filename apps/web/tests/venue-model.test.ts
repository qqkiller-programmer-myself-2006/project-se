import { describe, expect, it } from "vitest";
import type { TableAvailability } from "../src/lib/api";
import {
  demoAvailability,
  getZoneView,
  OVERVIEW_VIEW,
  isDemoTableId,
  placeTables,
  summarizeZones,
  venueZones,
} from "../src/components/venueModel";

function t(name: string, zone: TableAvailability["zone"], status: TableAvailability["status"] = "available"): TableAvailability {
  return { id: `id-${name}`, name, capacity: 4, zone, status };
}

describe("ผังร้านสำหรับโมเดลสามมิติ", () => {
  it("มี 4 โซนตามลำดับ และทุกโซนมีรูปจริง (พร้อมมุมกล้อง) กับช่องวางโต๊ะ", () => {
    expect(venueZones.map((z) => z.id)).toEqual(["front", "dining", "kitchen", "sala"]);
    const allPhotos = venueZones.flatMap((z) => z.photos.map((p) => p.src));
    for (const zone of venueZones) {
      expect(zone.photos.length).toBeGreaterThan(0);
      for (const photo of zone.photos) {
        expect(photo.src).toMatch(/^\/venue\/.+\.jpg$/);
        expect(photo.alt.length).toBeGreaterThan(10);
        const { position: p, target: t } = photo.view;
        expect(Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)).toBeGreaterThan(2);
      }
      expect(zone.slots.length).toBeGreaterThan(0);
    }
    // รูปถ่ายร้านที่ลูกค้าส่งมาต้องถูกใช้ครบทุกรูป
    expect(new Set(allPhotos).size).toBe(9);
  });

  it("ช่องวางโต๊ะในโซนเดียวกันไม่ซ้อนกัน (ห่างกันพอสำหรับโต๊ะพร้อมเก้าอี้)", () => {
    for (const zone of venueZones) {
      zone.slots.forEach((a, i) => {
        zone.slots.slice(i + 1).forEach((b) => {
          expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(2.3);
        });
      });
    }
  });

  it("วางโต๊ะลงช่องตามลำดับ โต๊ะเกินช่องหรือไม่มีโซนไม่ถูกวาง", () => {
    const tables = [t("S1", "sala"), t("S2", "sala"), t("S3", "sala"), t("S4", "sala"), t("X1", null), t("D1", "dining")];
    const { placed, unplaced } = placeTables(tables);
    expect(placed.map((p) => p.name)).toEqual(["S1", "S2", "S3", "D1"]);
    expect(placed[0]!.slot).toBe(venueZones[3]!.slots[0]);
    expect(placed[1]!.slot).toBe(venueZones[3]!.slots[1]);
    expect(placed[3]!.slot).toBe(venueZones[1]!.slots[0]);
    expect(unplaced.map((p) => p.name)).toEqual(["S4", "X1"]);
  });

  it("สรุปจำนวนโต๊ะว่างต่อโซน และแสดงโซนอื่นเฉพาะเมื่อมีโต๊ะไม่มีโซน", () => {
    const summary = summarizeZones([t("F1", "front"), t("F2", "front", "booked"), t("D1", "dining", "too_small")]);
    expect(summary).toEqual([
      { zone: "front", total: 2, available: 1 },
      { zone: "dining", total: 1, available: 0 },
      { zone: "kitchen", total: 0, available: 0 },
      { zone: "sala", total: 0, available: 0 },
    ]);
    expect(summarizeZones([t("X", null)]).at(-1)).toEqual({ zone: null, total: 1, available: 1 });
  });

  it("ผังตัวอย่างคำนวณที่นั่งไม่พอและโต๊ะแนะนำตามจำนวนคน", () => {
    const demo = demoAvailability(5);
    expect(demo.tables).toHaveLength(13);
    expect(demo.tables.every((x) => isDemoTableId(x.id))).toBe(true);
    expect(demo.tables.find((x) => x.name === "D1")!.status).toBe("too_small");
    expect(demo.tables.find((x) => x.name === "F2")!.status).toBe("booked");
    expect(demo.recommendedTableId).toBe("demo-d4");
    expect(isDemoTableId("real-uuid")).toBe(false);
  });

  it("มุมกล้องตามรูปที่เลือก และภาพรวมเมื่อไม่ได้เลือกโซน", () => {
    expect(getZoneView(null)).toBe(OVERVIEW_VIEW);
    expect(getZoneView("front", 1)).toBe(venueZones[0]!.photos[1]!.view);
    expect(getZoneView("front", 99)).toBe(venueZones[0]!.photos[0]!.view);
  });
});
