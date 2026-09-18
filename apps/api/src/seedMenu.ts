/**
 * Seed เมนูอาหารจานเดียว 60 รายการของ "ร้านป้าอ้อ" แบบ idempotent
 * - ใช้เฉพาะ Store/API layer (createMenuItem/listMenuItems/createMenuOptionGroup/
 *   listMenuOptionGroups/createMenuOption/listMenuOptions) ห้าม SQL/Prisma ตรง
 * - ข้อมูลตรงกับ fixture ฝั่งเว็บ (DEMO_MENU_GROUPS หมวดอาหารจานเดียว):
 *   names/descriptions/prices/kinds/sortOrder/option groups/options
 * - Idempotent: หาเมนูเดิมด้วยชื่อ+หมวดแบบตรงตัวก่อนสร้าง ถ้ามีแล้วไม่สร้างซ้ำ
 *   และไม่แตะข้อมูลเดิม สร้างเฉพาะ group/option ที่ยังขาดตามชื่อเท่านั้น
 * - รูปใน fixture เป็น local path แต่ API รับเฉพาะ absolute http/https URL
 *   จึง map ผ่าน MENU_SEED_PUBLIC_ASSET_BASE_URL (default https ตัวอย่าง)
 *   ค่าที่ตั้งเองต้องเป็น http(s) เท่านั้น
 *
 * วิธีรันดู docs/menu-seed.md (ห้ามรันตรงใน production)
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadProjectEnv } from "./env.js";
import { createStoreFromEnv, type ShopActor, type Store } from "./store.js";

export const MENU_SEED_SHOP = "ร้านป้าอ้อ";
export const MENU_SEED_CATEGORY = "อาหารจานเดียว";
export const MENU_SEED_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const DEFAULT_MENU_SEED_ASSET_BASE_URL = "https://pub-7a91d6a7755b49f093c799ef30557d7d.r2.dev";

export interface MenuSeedOption {
  name: string;
  priceDelta: number;
  sortOrder: number;
}

export interface MenuSeedOptionGroup {
  name: string;
  sortOrder: number;
  options: MenuSeedOption[];
}

export interface MenuSeedItem {
  category: string;
  name: string;
  description: string;
  /** local path ตาม fixture (เช่น /venue/...) — map เป็น absolute URL ตอน seed */
  imagePath: string;
  price: number;
  kind: "food";
  sortOrder: number;
  optionGroups: MenuSeedOptionGroup[];
}

const SIZE_GROUP: MenuSeedOptionGroup = {
  name: "ขนาด",
  sortOrder: 1,
  options: [
    { name: "ธรรมดา", priceDelta: 0, sortOrder: 1 },
    { name: "พิเศษ", priceDelta: 15, sortOrder: 2 },
  ],
};

const EGG_GROUP: MenuSeedOptionGroup = {
  name: "เพิ่มไข่",
  sortOrder: 2,
  options: [
    { name: "ไม่เพิ่มไข่", priceDelta: 0, sortOrder: 1 },
    { name: "เพิ่มไข่ดาว", priceDelta: 10, sortOrder: 2 },
    { name: "เพิ่มไข่เจียว", priceDelta: 10, sortOrder: 3 },
  ],
};

function food(category: string, name: string, slug: string, price: number, sortOrder: number): MenuSeedItem {
  return {
    category,
    name,
    description: `${name} ผัดสดใหม่ตามสั่ง ปรับระดับความเผ็ดและเพิ่มไข่ได้ — ร้านป้าอ้อ`,
    imagePath: `/food-menu/${String(sortOrder).padStart(2, "0")}-${slug}.png`,
    price,
    kind: "food",
    sortOrder,
    // ไม่มีกลุ่ม "เนื้อสัตว์": ชื่อจานระบุเนื้อไว้แล้ว (ข้าวผัดหมู/ข้าวผัดไก่ เป็นคนละเมนู)
    // ถ้ามีจะสั่ง "ข้าวผัดหมู" แล้วเลือก "ไก่" ได้ ซึ่งขัดกันเอง
    optionGroups: [{ ...SIZE_GROUP, options: [...SIZE_GROUP.options] }, { ...EGG_GROUP, options: [...EGG_GROUP.options] }],
  };
}

interface FoodDefinition {
  category: string;
  name: string;
  slug: string;
  price: number;
}

const FOOD_DEFINITIONS: FoodDefinition[] = [
  { category: "ไก่อบซอส", name: "ไก่อบซอส", slug: "kai-ob-sauce", price: 60 },
  { category: "ข้าวผัด", name: "ข้าวผัดหมู", slug: "khao-phad-moo", price: 55 },
  { category: "ข้าวผัด", name: "ข้าวผัดไก่", slug: "khao-phad-kai", price: 55 },
  { category: "ข้าวผัด", name: "ข้าวผัดกุ้ง", slug: "khao-phad-kung", price: 70 },
  { category: "ข้าวผัด", name: "ข้าวผัดปลาหมึก", slug: "khao-phad-pla-muek", price: 70 },
  { category: "ข้าวผัด", name: "ข้าวผัดปู", slug: "khao-phad-pu", price: 70 },
  { category: "ข้าวผัด", name: "ข้าวผัดทะเล", slug: "khao-phad-talay", price: 70 },
  { category: "ข้าวผัด", name: "ข้าวผัดแหนม", slug: "khao-phad-naem", price: 65 },
  { category: "ข้าวผัด", name: "ข้าวผัดกุนเชียง", slug: "khao-phad-kun-chiang", price: 65 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพราหมู", slug: "khao-krapao-moo", price: 55 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพราไก่", slug: "khao-krapao-kai", price: 55 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพรากุ้ง", slug: "khao-krapao-kung", price: 70 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพราหมึก", slug: "khao-krapao-squid", price: 70 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพราหมูกรอบ", slug: "khao-krapao-crispy-pork", price: 65 },
  { category: "ข้าวกระเพรา", name: "ข้าวกระเพราปลาดุก", slug: "khao-krapao-catfish", price: 65 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้หมู", slug: "pad-prik-kaeng-southern-pork", price: 55 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้ไก่", slug: "pad-prik-kaeng-southern-chicken", price: 55 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้กุ้ง", slug: "pad-prik-kaeng-southern-prawn", price: 70 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้หมึก", slug: "southern-red-curry-stir-fried-squid", price: 70 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้หมูกรอบ", slug: "southern-red-curry-stir-fried-crispy-pork", price: 65 },
  { category: "ผัดพริกแกงใต้", name: "ผัดพริกแกงใต้ปลาดุก", slug: "southern-red-curry-stir-fried-catfish", price: 65 },
  { category: "ผัดพริกหยวก", name: "ผัดพริกหยวกหมู", slug: "stir-fried-pork-with-green-peppers", price: 55 },
  { category: "ผัดพริกหยวก", name: "ผัดพริกหยวกไก่", slug: "stir-fried-chicken-with-green-peppers", price: 55 },
  { category: "ผัดพริกหยวก", name: "ผัดพริกหยวกกุ้ง", slug: "stir-fried-shrimp-with-green-peppers", price: 70 },
  { category: "ผัดพริกหยวก", name: "ผัดพริกหยวกหมึก", slug: "phad-prik-yuak-pla-meuk", price: 70 },
  { category: "ผัดพริกเผา", name: "ผัดพริกเผาหมู", slug: "phad-prik-pao-moo", price: 55 },
  { category: "ผัดพริกเผา", name: "ผัดพริกเผาไก่", slug: "phad-prik-pao-kai", price: 55 },
  { category: "ผัดพริกเผา", name: "ผัดพริกเผากุ้ง", slug: "phad-prik-pao-kung", price: 70 },
  { category: "ผัดพริกเผา", name: "ผัดพริกเผาหมึก", slug: "phad-prik-pao-pla-meuk", price: 70 },
  { category: "ผัดคะน้า", name: "คะน้าหมูกรอบ", slug: "kana-moo-krob", price: 65 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่หมู", slug: "rad-na-sen-yai-moo", price: 55 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่ไก่", slug: "rad-na-sen-yai-gai", price: 55 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่กุ้ง", slug: "rad-na-sen-yai-kung", price: 70 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่หมึก", slug: "rad-na-sen-yai-muek", price: 70 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่ทะเล", slug: "rad-na-sen-yai-thale", price: 70 },
  { category: "ราดหน้าเส้นใหญ่", name: "ราดหน้าเส้นใหญ่รวม", slug: "rad-na-sen-yai-ruam", price: 75 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบหมู", slug: "rad-na-mee-krop-moo", price: 55 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบไก่", slug: "rad-na-mee-krop-gai", price: 55 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบกุ้ง", slug: "rad-na-mee-krop-goong", price: 70 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบหมึก", slug: "rad-na-mee-krop-muek", price: 70 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบทะเล", slug: "rad-na-mee-krop-thale", price: 70 },
  { category: "ราดหน้าหมี่กรอบ", name: "ราดหน้าหมี่กรอบรวม", slug: "rad-na-mee-krop-ruam", price: 75 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำหมู", slug: "suki-nam-moo", price: 55 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำไก่", slug: "suki-nam-gai", price: 55 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำกุ้ง", slug: "suki-nam-goong", price: 70 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำหมึก", slug: "suki-nam-muek", price: 70 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำทะเล", slug: "suki-nam-talay", price: 70 },
  { category: "สุกี้น้ำ", name: "สุกี้น้ำรวม", slug: "suki-nam-ruam", price: 75 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งหมู", slug: "dry-suki-pork", price: 55 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งไก่", slug: "dry-suki-chicken", price: 55 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งกุ้ง", slug: "dry-suki-shrimp", price: 70 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งหมึก", slug: "dry-suki-squid", price: 70 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งทะเล", slug: "dry-suki-seafood", price: 70 },
  { category: "สุกี้แห้ง", name: "สุกี้แห้งรวม", slug: "dry-suki-mixed", price: 75 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วหมู", slug: "pad-see-ew-moo", price: 55 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วไก่", slug: "pad-see-ew-gai", price: 55 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วกุ้ง", slug: "pad-see-ew-goong", price: 70 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วหมึก", slug: "pad-see-ew-muek", price: 70 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วทะเล", slug: "pad-see-ew-talay", price: 70 },
  { category: "ผัดซีอิ๊ว", name: "ผัดซีอิ๊วรวม", slug: "pad-see-ew-ruam", price: 75 },
];

/**
 * 60 เมนูอาหาร แบ่งตามหมวด; ไข่ดาว/ไข่เจียวอยู่ในกลุ่มตัวเลือก ไม่ถูกนับเป็นเมนู
 *
 * ลำดับและ slug ต้องตรงกับชื่อไฟล์รูปใน apps/web/public/food-menu/ (อัปขึ้น R2 แล้ว)
 * เพราะ path รูปสร้างจาก `NN-slug.png` — ชุดรูปคือแหล่งความจริง รายการนี้ตามรูป
 * เทสต์ตรวจว่ารูปทุกใบมีอยู่จริง กันรายการกับรูปหลุดกันอีก
 */
export const MENU_SEED_ITEMS: MenuSeedItem[] = FOOD_DEFINITIONS.map((definition, index) =>
  food(definition.category, definition.name, definition.slug, definition.price, index + 1),
);

/** ชื่อผู้ใช้ actor: ต้องระบุชัดเจนและผ่าน pattern เดียวกับ bootstrap */
export function resolveMenuSeedUsername(argvUsername?: string, envUsername?: string): string {
  const username = (argvUsername ?? envUsername ?? "").trim();
  if (!username) {
    throw new Error("ต้องระบุชื่อผู้ใช้ผ่าน --username หรือ MENU_SEED_USERNAME (ไม่มีค่าเริ่มต้น)");
  }
  if (!MENU_SEED_USERNAME_PATTERN.test(username)) {
    throw new Error("ชื่อผู้ใช้ไม่ถูกต้อง (a-z 0-9 _ . - ยาว 3-32)");
  }
  return username;
}

/**
 * Base URL สำหรับ map รูป local → absolute http(s) URL
 * - ไม่ระบุ = default ฐานตัวอย่างแบบ https
 * - ค่าที่ตั้งเองต้องเป็น absolute http/https URL เท่านั้น (มีช่องว่าง/โปรโตคอลอื่น → throw)
 */
export function resolveMenuSeedAssetBaseUrl(raw?: string): string {
  const value = (raw ?? process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"] ?? DEFAULT_MENU_SEED_ASSET_BASE_URL).trim();
  if (!value) {
    throw new Error("MENU_SEED_PUBLIC_ASSET_BASE_URL ต้องไม่ว่างเปล่า");
  }
  if (/\s/.test(value)) {
    throw new Error("MENU_SEED_PUBLIC_ASSET_BASE_URL ต้องไม่มีช่องว่าง");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MENU_SEED_PUBLIC_ASSET_BASE_URL ต้องเป็น http:// หรือ https:// ที่ถูกต้อง");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MENU_SEED_PUBLIC_ASSET_BASE_URL ต้องเป็น http:// หรือ https:// ที่ถูกต้อง");
  }
  return value.replace(/\/+$/, "");
}

/** map local path (เช่น /venue/...) ใต้ base URL; ค่าว่าง → null */
export function resolveMenuSeedImageUrl(localPath: string | null | undefined, baseUrl: string): string | null {
  if (localPath === null || localPath === undefined) return null;
  const p = localPath.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const base = baseUrl.replace(/\/+$/, "");
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${base}${path}`;
}

export interface MenuSeedPlannedOption {
  name: string;
  priceDelta: number;
  sortOrder: number;
}

export interface MenuSeedPlannedGroup {
  name: string;
  sortOrder: number;
  options: MenuSeedPlannedOption[];
}

export interface MenuSeedPlannedItem {
  category: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: number;
  kind: "food";
  status: "available";
  sortOrder: number;
  optionGroups: MenuSeedPlannedGroup[];
}

/** pure plan: แปลง fixture + map รูปเป็น absolute URL — เทสต์ได้โดยไม่ต้องมี DB */
export function buildMenuSeedPlan(baseUrl: string): MenuSeedPlannedItem[] {
  return MENU_SEED_ITEMS.map((m) => ({
    category: m.category,
    name: m.name,
    description: m.description,
    imageUrl: resolveMenuSeedImageUrl(m.imagePath, baseUrl),
    price: m.price,
    kind: m.kind,
    status: "available" as const,
    sortOrder: m.sortOrder,
    optionGroups: m.optionGroups.map((g) => ({
      name: g.name,
      sortOrder: g.sortOrder,
      options: g.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta, sortOrder: o.sortOrder })),
    })),
  }));
}

export interface MenuSeedSummary {
  totalMenus: number;
  menusCreated: number;
  menusSkipped: number;
  groupsCreated: number;
  optionsCreated: number;
  /** เมนูเดิมที่รูปไม่ตรงแผน แล้วถูกชี้ไปรูปจริง */
  imagesRepaired: number;
  /** เมนูตกค้างจาก seed รุ่นเก่าที่รูปชี้โดเมนตัวอย่าง แล้วถูก archive */
  placeholdersRetired: number;
}

/**
 * host ของรูป placeholder ที่ seed รุ่นแรกเขียนลงฐานข้อมูล (base URL ตอนนั้น
 * default เป็นโดเมนตัวอย่าง และชี้รูปร้านแทนรูปอาหาร) — ไม่มีวันโหลดได้
 */
export const RETIRED_PLACEHOLDER_IMAGE_PREFIX = "https://example.com/";

/**
 * ใช้ plan กับ Store แบบ idempotent:
 * - เมนูเดิม (ชื่อ+หมวดตรงตัว) ข้ามการสร้าง; sync เฉพาะ group/option ที่ขาดตามชื่อ
 * - เมนูเดิมที่ `imageUrl` ไม่ตรงแผน → ชี้ไปรูปจริง (แก้เฉพาะฟิลด์นี้ ฟิลด์อื่นไม่แตะ
 *   เพราะราคา/สถานะ/คำอธิบายอาจถูกทางร้านแก้เองแล้ว)
 * - เมนูที่ยังไม่ archive และรูปชี้ {@link RETIRED_PLACEHOLDER_IMAGE_PREFIX} → archive
 *   (ของตกค้างจาก seed รุ่นเก่า; archive ย้อนคืนได้และมี audit ไม่ใช่ลบทิ้ง)
 * - เมนูที่ถูก archive แล้วข้ามการ sync ลูก (จัดการต่อไม่ได้ + ห้าม mutate)
 */
export async function applyMenuSeed(
  store: Store,
  actor: ShopActor,
  opts?: { assetBaseUrl?: string },
): Promise<MenuSeedSummary> {
  const baseUrl = resolveMenuSeedAssetBaseUrl(opts?.assetBaseUrl ?? process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"]);
  const plan = buildMenuSeedPlan(baseUrl);
  const summary: MenuSeedSummary = {
    totalMenus: plan.length,
    menusCreated: 0,
    menusSkipped: 0,
    groupsCreated: 0,
    optionsCreated: 0,
    imagesRepaired: 0,
    placeholdersRetired: 0,
  };

  const existing = await store.listMenuItems({ includeArchived: true });
  const plannedKeys = new Set(plan.map((p) => `${p.category}\u0000${p.name}`));

  // เก็บของตกค้างก่อน — ไม่งั้นหน้าเมนูจะมีทั้งจานใหม่ที่รูปถูก และจานเก่าที่รูปพัง
  for (const m of existing) {
    if (m.isArchived) continue;
    if (plannedKeys.has(`${m.category}\u0000${m.name}`)) continue;
    if (!m.imageUrl?.startsWith(RETIRED_PLACEHOLDER_IMAGE_PREFIX)) continue;
    await store.archiveMenuItem(m.id, actor);
    summary.placeholdersRetired += 1;
  }
  const byKey = new Map(existing.map((m) => [`${m.category}\u0000${m.name}`, m]));

  for (const item of plan) {
    const key = `${item.category}\u0000${item.name}`;
    let menu = byKey.get(key);
    if (!menu) {
      menu = await store.createMenuItem(
        {
          category: item.category,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          price: item.price,
          kind: item.kind,
          status: item.status,
          sortOrder: item.sortOrder,
        },
        actor,
      );
      byKey.set(key, menu);
      summary.menusCreated += 1;
    } else {
      summary.menusSkipped += 1;
      if (menu.isArchived) continue;
      if (menu.imageUrl !== item.imageUrl) {
        menu = await store.updateMenuItem(menu.id, { imageUrl: item.imageUrl }, actor);
        byKey.set(key, menu);
        summary.imagesRepaired += 1;
      }
    }

    const groups = await store.listMenuOptionGroups(menu.id);
    const groupByName = new Map(groups.map((g) => [g.name, g]));
    const allOptions = await store.listMenuOptions(menu.id);
    const optionKeys = new Set(allOptions.map((o) => `${o.groupId}\u0000${o.name}`));

    for (const planned of item.optionGroups) {
      let group = groupByName.get(planned.name);
      if (!group) {
        group = await store.createMenuOptionGroup(menu.id, { name: planned.name, sortOrder: planned.sortOrder }, actor);
        groupByName.set(group.name, group);
        summary.groupsCreated += 1;
      }
      for (const opt of planned.options) {
        const okey = `${group.id}\u0000${opt.name}`;
        if (!optionKeys.has(okey)) {
          await store.createMenuOption(
            group.id,
            { name: opt.name, priceDelta: opt.priceDelta, sortOrder: opt.sortOrder },
            actor,
          );
          optionKeys.add(okey);
          summary.optionsCreated += 1;
        }
      }
    }
  }

  return summary;
}

function cliArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === `--${name}`) return args[i + 1];
  }
  return undefined;
}

/** กันรันตรงใน production โดยไม่ตั้งใจ — ต้อง opt-in ชัดเจน */
export function assertMenuSeedAllowedInEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env["NODE_ENV"] === "production" && env["MENU_SEED_ALLOW_PRODUCTION"] !== "true") {
    throw new Error("ห้ามรัน menu seed ตรงใน production (ตั้ง MENU_SEED_ALLOW_PRODUCTION=true เมื่อตั้งใจจริงเท่านั้น)");
  }
}

async function runMenuSeedCli(): Promise<void> {
  loadProjectEnv();
  assertMenuSeedAllowedInEnv();
  const username = resolveMenuSeedUsername(cliArg("username"), process.env["MENU_SEED_USERNAME"]);
  const baseUrl = resolveMenuSeedAssetBaseUrl(
    cliArg("asset-base-url") ?? process.env["MENU_SEED_PUBLIC_ASSET_BASE_URL"],
  );
  // createStoreFromEnv โยน error เองเมื่อไม่มี DATABASE_URL (ไม่พิมพ์ค่า secret ใด ๆ)
  const store = await createStoreFromEnv();
  try {
    const actor: ShopActor = { actorId: null, actorUsername: username, ip: null };
    const summary = await applyMenuSeed(store, actor, { assetBaseUrl: baseUrl });
    console.log(
      `[menu-seed] ${MENU_SEED_SHOP}: menus=${summary.totalMenus} created=${summary.menusCreated} skipped=${summary.menusSkipped} imagesRepaired=${summary.imagesRepaired} placeholdersRetired=${summary.placeholdersRetired} groupsCreated=${summary.groupsCreated} optionsCreated=${summary.optionsCreated}`,
    );
  } finally {
    await store.close?.();
  }
}

function isDirectRun(): boolean {
  try {
    const current = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ?? "";
    if (!invoked) return false;
    if (invoked === current) return true;
    const invokedHref = pathToFileURL(invoked).href;
    if (invokedHref === import.meta.url) return true;
    return (
      invoked.endsWith("seedMenu.ts") || invoked.endsWith("seedMenu.js") || current.endsWith(invoked.slice(-14))
    );
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  await runMenuSeedCli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err ?? "menu seed ล้มเหลว"));
    process.exit(1);
  });
}
