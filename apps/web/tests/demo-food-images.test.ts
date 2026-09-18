import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_FOOD_MENU_GROUPS } from "../src/lib/demo";

/**
 * เมนูอาหารตัวอย่างต้องชี้รูปที่มีอยู่จริง
 *
 * รายการเมนูกับชุดรูปเคยหลุดกัน: fixture เขียน `khao-kaprao-moo-sap` แต่ไฟล์จริงชื่อ
 * `khao-krapao-moo` — รูปพัง 56 จาก 59 จานโดยไม่มีเทสต์ไหนจับได้
 * seed ฝั่ง API ใช้รายการเดียวกันและมีเทสต์คู่กันใน apps/api/tests/menu-seed.test.ts
 */
const FOOD_PHOTO_DIR = join(process.cwd(), "public", "food-menu");
// ต้นฉบับ (~140 MB) ไม่อยู่ใน git — เทสต์ที่ต้องเห็นไฟล์จริงรันเฉพาะเครื่องที่มีรูป
const HAS_PHOTOS = existsSync(FOOD_PHOTO_DIR);
const PHOTO_FILES = HAS_PHOTOS
  ? readdirSync(FOOD_PHOTO_DIR)
      .filter((f) => /^\d\d-.+\.png$/.test(f))
      .sort()
  : [];

describe("รูปเมนูอาหารตัวอย่าง", () => {
  const items = DEMO_FOOD_MENU_GROUPS.flatMap((g) => g.items).sort((a, b) => a.sortOrder - b.sortOrder);

  it("ครบ 60 จาน และเลขไฟล์รูปตรงลำดับจาน", () => {
    expect(items).toHaveLength(60);
    items.forEach((item, index) => {
      expect(item.imageUrl).toMatch(new RegExp(`^/food-menu/${String(index + 1).padStart(2, "0")}-[a-z0-9-]+\\.png$`));
    });
  });

  it.skipIf(!HAS_PHOTOS)("รูปทุกใบมีอยู่จริงในชุดรูป", () => {
    expect(PHOTO_FILES).toHaveLength(60);
    expect(items).toHaveLength(PHOTO_FILES.length);
    items.forEach((item, index) => {
      expect(item.imageUrl).toBe(`/food-menu/${PHOTO_FILES[index]}`);
      expect(existsSync(join(FOOD_PHOTO_DIR, PHOTO_FILES[index]!)), item.name).toBe(true);
    });
  });

  it("ไม่มีตัวเลือกเนื้อสัตว์ — ชื่อจานบอกเนื้อไว้แล้ว", () => {
    for (const item of items) {
      expect(item.optionGroups.map((g) => g.name)).toEqual(["ขนาด", "เพิ่มไข่"]);
    }
  });
});
