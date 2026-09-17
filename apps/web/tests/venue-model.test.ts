import { describe, expect, it } from "vitest";
import type { TableAvailability } from "../src/lib/api";
import {
  demoAvailability,
  getZoneView,
  isDemoTableId,
  landmarks,
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
    expect(venueZones.map((z) => z.number)).toEqual([1, 2, 3, 4]);
    for (const zone of venueZones) {
      expect(zone.photos.length).toBeGreaterThan(0);
      for (const photo of zone.photos) {
        expect(photo.src).toMatch(/^\/venue\/.+\.jpg$/);
        expect(photo.caption.length).toBeGreaterThan(5);
        expect(photo.alt.length).toBeGreaterThan(10);
        const { position: p, target: t } = photo.view;
        expect(Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)).toBeGreaterThan(2);
      }
      expect(zone.slots.length).toBeGreaterThan(0);
    }
    // รูปถ่ายร้านที่เจ้าของร้านส่งมาต้องถูกใช้ครบทุกรูป (ชุดแรก 9 + ชุดสำรวจหน้างาน 10)
    expect(new Set(allPhotos).size).toBe(19);
    expect(allPhotos.filter((src) => src.startsWith("/venue/site/"))).toHaveLength(10);
    for (const zone of venueZones) {
      const { position: p, target: t } = zone.overview;
      expect(p.y).toBeGreaterThan(t.y + 4);
    }
  });

  it("ผังตามแบบของร้าน: โต๊ะหน้าร้าน 2 ห้องอาหาร 6 บาร์หน้าครัว 3 ศาลา 4 และทุกช่องอยู่ในขอบเขตโซน", () => {
    expect(venueZones.map((z) => [z.id, z.slots.length])).toEqual([
      ["front", 2],
      ["dining", 6],
      ["kitchen", 3],
      ["sala", 4],
    ]);
    for (const zone of venueZones) {
      const b = zone.bounds;
      for (const slot of zone.slots) {
        expect(slot.position.x).toBeGreaterThan(b.x0);
        expect(slot.position.x).toBeLessThan(b.x1);
        expect(slot.position.z).toBeGreaterThan(b.z0);
        expect(slot.position.z).toBeLessThan(b.z1);
      }
    }
  });

  it("จุดสำคัญตามสีในผัง: ครัว บาร์น้ำ น้ำแข็ง/แก้ว ห้องน้ำ อยู่ในโซนที่ถูกต้อง", () => {
    expect(landmarks.map((l) => [l.id, l.zone])).toEqual([
      ["kitchen", "kitchen"],
      ["drinks", "dining"],
      ["ice", "sala"],
      ["restroom", "dining"],
    ]);
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
    const tables = [t("F1", "front"), t("F2", "front"), t("F3", "front"), t("X1", null), t("D1", "dining")];
    const { placed, unplaced } = placeTables(tables);
    expect(placed.map((p) => p.name)).toEqual(["F1", "F2", "D1"]);
    expect(placed[0]!.slot).toBe(venueZones[0]!.slots[0]);
    expect(placed[1]!.slot).toBe(venueZones[0]!.slots[1]);
    expect(placed[2]!.slot).toBe(venueZones[1]!.slots[0]);
    expect(unplaced.map((p) => p.name)).toEqual(["F3", "X1"]);
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
    expect(demo.tables).toHaveLength(15);
    expect(demo.tables.every((x) => isDemoTableId(x.id))).toBe(true);
    expect(demo.tables.find((x) => x.name === "D1")!.status).toBe("too_small");
    expect(demo.tables.find((x) => x.name === "F2")!.status).toBe("booked");
    expect(demo.recommendedTableId).toBe("demo-d4");
    expect(isDemoTableId("real-uuid")).toBe(false);
  });

  it("มุมกล้องตามรูปที่เลือก (รูปที่ไม่มีใช้มุมรูปแรก)", () => {
    expect(getZoneView("dining", 1)).toBe(venueZones[1]!.photos[1]!.view);
    expect(getZoneView("dining", 99)).toBe(venueZones[1]!.photos[0]!.view);
  });
});
