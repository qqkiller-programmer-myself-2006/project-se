import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_SEED_ASSET_BASE_URL,
  MENU_SEED_ITEMS,
  RETIRED_PLACEHOLDER_IMAGE_PREFIX,
  applyMenuSeed,
  assertMenuSeedAllowedInEnv,
  buildMenuSeedPlan,
  resolveMenuSeedAssetBaseUrl,
  resolveMenuSeedImageUrl,
  resolveMenuSeedUsername,
} from "../src/seedMenu.js";
import { createMemoryStore, type Store } from "../src/store.js";

const ACTOR = { actorId: null, actorUsername: "owner1", ip: null };
const BASE = "https://cdn.example.com/paor";

/**
 * ชุดรูปเมนูอาหารจริง — แหล่งความจริงของรายการเมนู
 * ไฟล์ชุดเดียวกันถูกอัปขึ้น R2 ใต้ key `food-menu/<ชื่อไฟล์>`
 *
 * ต้นฉบับ (~140 MB) ไม่อยู่ใน git — มีเฉพาะเครื่องที่ทำงานกับรูป
 * เทสต์ที่ต้องเห็นไฟล์จริงจึงรันเฉพาะเมื่อมีโฟลเดอร์นี้ (clone ใหม่/CI จะข้าม)
 */
const FOOD_PHOTO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "public", "food-menu");
const HAS_PHOTOS = existsSync(FOOD_PHOTO_DIR);
const PHOTO_FILES = HAS_PHOTOS
  ? readdirSync(FOOD_PHOTO_DIR)
      .filter((f) => /^\d\d-.+\.png$/.test(f))
      .sort()
  : [];
/** ชื่อไฟล์รูปที่แต่ละจานอ้าง — ใช้ในเทสต์ที่ไม่ต้องมีไฟล์จริง */
const planFile = (index: number): string => MENU_SEED_ITEMS[index]!.imagePath!.replace("/food-menu/", "");

describe("menu seed helper (pure, ไม่ต้องมี DB)", () => {
  it.skipIf(!HAS_PHOTOS)("รายการเมนูตรงกับชุดรูปจริงทีละจาน — ไม่มีจานไหนรูปพัง", () => {
    expect(PHOTO_FILES).toHaveLength(60);
    expect(MENU_SEED_ITEMS).toHaveLength(PHOTO_FILES.length);
    MENU_SEED_ITEMS.forEach((item, index) => {
      // ลำดับเมนูคือเลขนำหน้าไฟล์รูป และ path รูปต้องชี้ไฟล์ที่มีอยู่จริง
      expect(item.sortOrder).toBe(index + 1);
      expect(item.imagePath).toBe(`/food-menu/${PHOTO_FILES[index]}`);
      expect(existsSync(join(FOOD_PHOTO_DIR, PHOTO_FILES[index]!)), item.imagePath).toBe(true);
    });
  });

  it("ทุกจานมีชื่อ หมวด ราคา และคำอธิบาย ชื่อไม่ซ้ำกัน", () => {
    const names = MENU_SEED_ITEMS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const item of MENU_SEED_ITEMS) {
      expect(item.kind).toBe("food");
      expect(item.name.trim()).not.toBe("");
      expect(item.category.trim()).not.toBe("");
      expect(item.description).toContain(item.name);
      expect(Number.isInteger(item.price)).toBe(true);
      expect(item.price).toBeGreaterThanOrEqual(50);
      expect(item.price).toBeLessThanOrEqual(80);
    }
    const byName = new Map(MENU_SEED_ITEMS.map((m) => [m.name, m]));
    expect(byName.get("ไก่อบซอส")?.price).toBe(60);
    expect(byName.get("ข้าวผัดหมู")?.category).toBe("ข้าวผัด");
    expect(byName.get("ผัดซีอิ๊วรวม")?.price).toBe(75);
  });

  it("ไม่มีกลุ่มตัวเลือกเนื้อสัตว์ — ชื่อจานบอกเนื้อไว้แล้ว (ข้าวผัดหมู ≠ ข้าวผัดไก่)", () => {
    for (const item of MENU_SEED_ITEMS) {
      expect(item.optionGroups.map((g) => g.name)).toEqual(["ขนาด", "เพิ่มไข่"]);
      expect(item.optionGroups[0]?.options.map((o) => [o.name, o.priceDelta])).toEqual([
        ["ธรรมดา", 0],
        ["พิเศษ", 15],
      ]);
      expect(item.optionGroups[1]?.options.map((o) => [o.name, o.priceDelta])).toEqual([
        ["ไม่เพิ่มไข่", 0],
        ["เพิ่มไข่ดาว", 10],
        ["เพิ่มไข่เจียว", 10],
      ]);
    }
  });

  it("plan map รูปเป็น absolute URL ใต้ base และ key เดียวกับที่อยู่บน R2", () => {
    const plan = buildMenuSeedPlan(BASE);
    expect(plan).toHaveLength(60);
    plan.forEach((item, index) => {
      // key บน R2 คือ food-menu/NN-slug.png — เลขนำหน้าต้องตรงลำดับจาน
      expect(planFile(index)).toMatch(new RegExp(`^${String(index + 1).padStart(2, "0")}-[a-z0-9-]+\\.png$`));
      expect(item.imageUrl).toBe(`${BASE}/food-menu/${planFile(index)}`);
      expect(item.status).toBe("available");
    });
  });

  it("base URL: default เป็น R2 public URL, ปฏิเสธค่าที่ไม่ใช่ http(s)", () => {
    const saved = process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"];
    try {
      delete process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"];
      expect(resolveMenuSeedAssetBaseUrl()).toBe(DEFAULT_MENU_SEED_ASSET_BASE_URL);
      // default ต้องไม่ใช่โดเมนตัวอย่างอีก — seed รุ่นแรกเขียนรูปพังลงฐานข้อมูลเพราะแบบนี้
      expect(DEFAULT_MENU_SEED_ASSET_BASE_URL).not.toContain("example.com");
      expect(() => resolveMenuSeedAssetBaseUrl("ftp://example.com/x")).toThrow(/http/);
      expect(() => resolveMenuSeedAssetBaseUrl("/relative/path")).toThrow(/http/);
      expect(() => resolveMenuSeedAssetBaseUrl("https://exa mple.com")).toThrow(/ช่องว่าง/);
      expect(resolveMenuSeedAssetBaseUrl("https://cdn.example.com/paor/")).toBe("https://cdn.example.com/paor");
    } finally {
      if (saved === undefined) delete process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"];
      else process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"] = saved;
    }
  });

  it("resolve รูป: ค่าว่าง → null, absolute คงเดิม, local ต่อใต้ base", () => {
    expect(resolveMenuSeedImageUrl(null, BASE)).toBeNull();
    expect(resolveMenuSeedImageUrl("   ", BASE)).toBeNull();
    expect(resolveMenuSeedImageUrl("https://other.example/x.jpg", BASE)).toBe("https://other.example/x.jpg");
    expect(resolveMenuSeedImageUrl("/venue/a.jpg", `${BASE}/`)).toBe(`${BASE}/venue/a.jpg`);
  });

  it("username: ต้องระบุและผ่าน pattern เดียวกับ bootstrap", () => {
    expect(() => resolveMenuSeedUsername(undefined, undefined)).toThrow(/MENU_SEED_USERNAME/);
    expect(() => resolveMenuSeedUsername("ab", undefined)).toThrow(/ไม่ถูกต้อง/);
    expect(() => resolveMenuSeedUsername("bad name!", undefined)).toThrow(/ไม่ถูกต้อง/);
    expect(resolveMenuSeedUsername(undefined, "owner1")).toBe("owner1");
    expect(resolveMenuSeedUsername("--flag-wins", "owner1")).toBe("--flag-wins");
  });

  it("production guard: กันรันตรงใน production โดยไม่ตั้งใจ", () => {
    expect(() => assertMenuSeedAllowedInEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/production/);
    expect(() =>
      assertMenuSeedAllowedInEnv({ NODE_ENV: "production", MENU_SEED_ALLOW_PRODUCTION: "true" } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() => assertMenuSeedAllowedInEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("menu seed กับ Store (memory, idempotent)", () => {
  async function freshStore(): Promise<Store> {
    return createMemoryStore();
  }

  it("รันครั้งแรกสร้าง 60 เมนู + 120 กลุ่ม + 300 ตัวเลือก, รันซ้ำไม่สร้างเพิ่มและไม่แก้อะไร", async () => {
    const store = await freshStore();
    const first = await applyMenuSeed(store, ACTOR, { assetBaseUrl: BASE });
    expect(first).toMatchObject({
      totalMenus: 60,
      menusCreated: 60,
      menusSkipped: 0,
      groupsCreated: 120,
      optionsCreated: 300,
      imagesRepaired: 0,
      placeholdersRetired: 0,
    });

    const menus = await store.listMenuItems({ includeArchived: true });
    expect(menus).toHaveLength(60);
    for (const item of buildMenuSeedPlan(BASE)) {
      const found = menus.find((m) => m.category === item.category && m.name === item.name);
      expect(found, `ขาด ${item.name}`).toBeDefined();
      expect(found?.price).toBe(item.price);
      expect(found?.imageUrl).toBe(item.imageUrl);
    }

    const second = await applyMenuSeed(store, ACTOR, { assetBaseUrl: BASE });
    expect(second).toMatchObject({
      menusCreated: 0,
      menusSkipped: 60,
      groupsCreated: 0,
      optionsCreated: 0,
      imagesRepaired: 0,
      placeholdersRetired: 0,
    });
    expect(await store.listMenuItems({ includeArchived: true })).toHaveLength(60);
  });

  it("เมนูเดิมที่รูปผิด: แก้เฉพาะรูป ราคาและคำอธิบายที่ร้านแก้เองคงเดิม", async () => {
    const store = await freshStore();
    const pre = await store.createMenuItem(
      {
        category: "ไก่อบซอส",
        name: "ไก่อบซอส",
        description: "ร้านแก้คำอธิบายเอง ห้ามทับ",
        imageUrl: `${RETIRED_PLACEHOLDER_IMAGE_PREFIX}venue/site/pa-or-menu-hero.png`,
        price: 999,
        kind: "food",
        status: "available",
        sortOrder: 1,
      },
      ACTOR,
    );

    const summary = await applyMenuSeed(store, ACTOR, { assetBaseUrl: BASE });
    expect(summary.menusCreated).toBe(59);
    expect(summary.menusSkipped).toBe(1);
    expect(summary.imagesRepaired).toBe(1);
    // จานนี้อยู่ในแผน จึงถูกซ่อมรูป ไม่ใช่ถูกเก็บเข้าคลัง
    expect(summary.placeholdersRetired).toBe(0);

    const kept = await store.getMenuItem(pre.id);
    expect(kept?.imageUrl).toBe(`${BASE}/food-menu/${planFile(0)}`);
    expect(kept?.price).toBe(999);
    expect(kept?.description).toBe("ร้านแก้คำอธิบายเอง ห้ามทับ");
    expect(kept?.isArchived).toBe(false);
  });

  it("เมนูตกค้างจาก seed รุ่นเก่าที่รูปชี้โดเมนตัวอย่าง ถูกเก็บเข้าคลัง (ไม่ลบ)", async () => {
    const store = await freshStore();
    const stale = await store.createMenuItem(
      {
        category: "อาหารจานเดียว",
        name: "ข้าวผัดป้าอ้อ (ตัวอย่าง)",
        description: null,
        imageUrl: `${RETIRED_PLACEHOLDER_IMAGE_PREFIX}venue/latest/real-menu-counter.jpg`,
        price: 55,
        kind: "food",
        status: "available",
        sortOrder: 2,
      },
      ACTOR,
    );
    // เมนูที่ร้านเพิ่มเอง รูปถูกต้อง ต้องไม่ถูกแตะแม้ไม่อยู่ในแผน
    const own = await store.createMenuItem(
      {
        category: "เมนูพิเศษ",
        name: "ต้มยำของร้าน",
        description: null,
        imageUrl: "https://cdn.shop.test/tomyum.jpg",
        price: 80,
        kind: "food",
        status: "available",
        sortOrder: 99,
      },
      ACTOR,
    );

    const summary = await applyMenuSeed(store, ACTOR, { assetBaseUrl: BASE });
    expect(summary.placeholdersRetired).toBe(1);

    const retired = await store.getMenuItem(stale.id);
    expect(retired?.isArchived).toBe(true);
    const untouched = await store.getMenuItem(own.id);
    expect(untouched?.isArchived).toBe(false);
    expect(untouched?.imageUrl).toBe("https://cdn.shop.test/tomyum.jpg");

    // รันซ้ำ: เก็บไปแล้วไม่นับซ้ำ
    const again = await applyMenuSeed(store, ACTOR, { assetBaseUrl: BASE });
    expect(again.placeholdersRetired).toBe(0);
  });
});
