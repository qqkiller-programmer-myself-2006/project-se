import type {
  CapacityOverview,
  NotificationItem,
  OrderDetail,
  PublicCustomer,
  PublicMenuGroupWithOptions,
  QueueJob,
  ReservationDetail,
  Reward,
  RewardRedemption,
  LoyaltyTransaction,
} from "./api";

/** Exact demo-mode label required by the brief — use everywhere, verbatim. */
export const DEMO_MODE_LABEL = "โหมดสาธิต · ข้อมูลตัวอย่าง";

/** Demo customer shown when the customer session endpoint is unreachable. */
export const DEMO_CUSTOMER: PublicCustomer = {
  id: "demo-customer-1",
  name: "ลูกค้าตัวอย่าง",
  phone: "0812345678",
  email: null,
  isActive: true,
  isDeleted: false,
  createdAt: "2026-09-01T00:00:00+07:00",
};

/** True only for network-level failures (API unreachable), not HTTP error bodies. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|network error|fetch failed|load failed|timed out|timeout/i.test(msg);
}

/**
 * Safe dev-only demo-mode flag.
 *
 * Enabled ONLY when ALL hold:
 * - `VITE_DEMO_MODE === "true"` (explicit opt-in, baked at Vite build time), AND
 * - non-production runtime (`import.meta.env.DEV === true`,
 *   `MODE !== "production"`, `PROD !== true`).
 *
 * Never true in production builds — even if the flag was baked as "true",
 * the PROD/MODE guards force it off. Demo mode only swaps READ fallbacks to
 * local fixtures with a visible label; it never bypasses auth, CSRF, or
 * mutations (all writes still call the real API and fail without server/auth).
 */
export function isDemoModeEnabled(): boolean {
  try {
    // ต้องเขียน import.meta.env ตรง ๆ — `import.meta?.env` Vite ไม่แทนค่า เบราว์เซอร์จะอ่านได้ undefined เสมอ
    const env = import.meta.env as unknown as Record<string, unknown> | undefined;
    if (!env) return false;
    const flag = String(env["VITE_DEMO_MODE"] ?? "").toLowerCase() === "true";
    if (!flag) return false;
    if (env["PROD"] === true) return false;
    if (typeof env["MODE"] === "string" && env["MODE"] === "production") return false;
    if (env["DEV"] !== true) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a read failure should fall back to local demo fixtures.
 * Preserves existing offline behavior; when the dev-only demo flag is on,
 * ANY read failure (empty API, 500, 401, …) falls back so the UI stays
 * inspectable. Mutations are never faked — they still surface real errors.
 */
export function shouldFallbackToDemo(err: unknown): boolean {
  return isOfflineError(err) || isDemoModeEnabled();
}

const T = (iso: string) => iso;

function drinkItem(
  id: string,
  category: string,
  name: string,
  description: string,
  imageStem: string,
  price: number,
  sortOrder: number,
) {
  return {
    id,
    category,
    name,
    description,
    imageUrl: `/menu/items/${imageStem}.png`,
    price,
    kind: "drink" as const,
    sortOrder,
    inStock: true,
    optionGroups: [
      {
        id: `${id}-og-sweet`,
        name: "ระดับความหวาน",
        sortOrder: 1,
        options: [
          { id: `${id}-opt-sw100`, name: "หวานปกติ", priceDelta: 0, sortOrder: 1 },
          { id: `${id}-opt-sw50`, name: "หวานน้อย", priceDelta: 0, sortOrder: 2 },
          { id: `${id}-opt-sw0`, name: "ไม่หวาน", priceDelta: 0, sortOrder: 3 },
        ],
      },
      {
        id: `${id}-og-size`,
        name: "ขนาด",
        sortOrder: 1,
        options: [
          { id: `${id}-opt-regular`, name: "แก้วปกติ", priceDelta: 0, sortOrder: 1 },
          { id: `${id}-opt-large`, name: "แก้วใหญ่", priceDelta: 10, sortOrder: 2 },
        ],
      },
    ],
  };
}

function foodItem(
  id: string,
  category: string,
  name: string,
  slug: string,
  price: number,
  sortOrder: number,
) {
  return {
    id,
    category,
    name,
    description: `${name} ผัดสดใหม่ตามสั่ง ปรับระดับความเผ็ดและเพิ่มไข่ได้ — ร้านป้าอ้อ`,
    imageUrl: `/food-menu/${String(sortOrder).padStart(2, "0")}-${slug}.png`,
    price,
    kind: "food" as const,
    sortOrder,
    inStock: true,
    optionGroups: [
      {
        id: `${id}-og-size`,
        name: "ขนาด",
        sortOrder: 1,
        options: [
          { id: `${id}-opt-regular`, name: "ธรรมดา", priceDelta: 0, sortOrder: 1 },
          { id: `${id}-opt-special`, name: "พิเศษ", priceDelta: 15, sortOrder: 2 },
        ],
      },
      {
        id: `${id}-og-egg`,
        name: "เพิ่มไข่",
        sortOrder: 2,
        options: [
          { id: `${id}-opt-no-egg`, name: "ไม่เพิ่มไข่", priceDelta: 0, sortOrder: 1 },
          { id: `${id}-opt-fried-egg`, name: "เพิ่มไข่ดาว", priceDelta: 10, sortOrder: 2 },
          { id: `${id}-opt-omelet`, name: "เพิ่มไข่เจียว", priceDelta: 10, sortOrder: 3 },
        ],
      },
    ],
  };
}

const DEMO_FOOD_DEFINITIONS: Array<readonly [category: string, name: string, slug: string, price: number]> = [
  ["ไก่อบซอส", "ไก่อบซอส", "kai-ob-sauce", 60],
  ["ข้าวผัด", "ข้าวผัดหมู", "khao-phad-moo", 55],
  ["ข้าวผัด", "ข้าวผัดไก่", "khao-phad-kai", 55],
  ["ข้าวผัด", "ข้าวผัดกุ้ง", "khao-phad-kung", 70],
  ["ข้าวผัด", "ข้าวผัดปลาหมึก", "khao-phad-pla-muek", 70],
  ["ข้าวผัด", "ข้าวผัดปู", "khao-phad-pu", 70],
  ["ข้าวผัด", "ข้าวผัดทะเล", "khao-phad-talay", 70],
  ["ข้าวผัด", "ข้าวผัดแหนม", "khao-phad-naem", 65],
  ["ข้าวผัด", "ข้าวผัดกุนเชียง", "khao-phad-kun-chiang", 65],
  ["ข้าวกระเพรา", "ข้าวกระเพราหมู", "khao-krapao-moo", 55],
  ["ข้าวกระเพรา", "ข้าวกระเพราไก่", "khao-krapao-kai", 55],
  ["ข้าวกระเพรา", "ข้าวกระเพรากุ้ง", "khao-krapao-kung", 70],
  ["ข้าวกระเพรา", "ข้าวกระเพราหมึก", "khao-krapao-squid", 70],
  ["ข้าวกระเพรา", "ข้าวกระเพราหมูกรอบ", "khao-krapao-crispy-pork", 65],
  ["ข้าวกระเพรา", "ข้าวกระเพราปลาดุก", "khao-krapao-catfish", 65],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้หมู", "pad-prik-kaeng-southern-pork", 55],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้ไก่", "pad-prik-kaeng-southern-chicken", 55],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้กุ้ง", "pad-prik-kaeng-southern-prawn", 70],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้หมึก", "southern-red-curry-stir-fried-squid", 70],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้หมูกรอบ", "southern-red-curry-stir-fried-crispy-pork", 65],
  ["ผัดพริกแกงใต้", "ผัดพริกแกงใต้ปลาดุก", "southern-red-curry-stir-fried-catfish", 65],
  ["ผัดพริกหยวก", "ผัดพริกหยวกหมู", "stir-fried-pork-with-green-peppers", 55],
  ["ผัดพริกหยวก", "ผัดพริกหยวกไก่", "stir-fried-chicken-with-green-peppers", 55],
  ["ผัดพริกหยวก", "ผัดพริกหยวกกุ้ง", "stir-fried-shrimp-with-green-peppers", 70],
  ["ผัดพริกหยวก", "ผัดพริกหยวกหมึก", "phad-prik-yuak-pla-meuk", 70],
  ["ผัดพริกเผา", "ผัดพริกเผาหมู", "phad-prik-pao-moo", 55],
  ["ผัดพริกเผา", "ผัดพริกเผาไก่", "phad-prik-pao-kai", 55],
  ["ผัดพริกเผา", "ผัดพริกเผากุ้ง", "phad-prik-pao-kung", 70],
  ["ผัดพริกเผา", "ผัดพริกเผาหมึก", "phad-prik-pao-pla-meuk", 70],
  ["ผัดคะน้า", "คะน้าหมูกรอบ", "kana-moo-krob", 65],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่หมู", "rad-na-sen-yai-moo", 55],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่ไก่", "rad-na-sen-yai-gai", 55],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่กุ้ง", "rad-na-sen-yai-kung", 70],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่หมึก", "rad-na-sen-yai-muek", 70],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่ทะเล", "rad-na-sen-yai-thale", 70],
  ["ราดหน้าเส้นใหญ่", "ราดหน้าเส้นใหญ่รวม", "rad-na-sen-yai-ruam", 75],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบหมู", "rad-na-mee-krop-moo", 55],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบไก่", "rad-na-mee-krop-gai", 55],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบกุ้ง", "rad-na-mee-krop-goong", 70],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบหมึก", "rad-na-mee-krop-muek", 70],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบทะเล", "rad-na-mee-krop-thale", 70],
  ["ราดหน้าหมี่กรอบ", "ราดหน้าหมี่กรอบรวม", "rad-na-mee-krop-ruam", 75],
  ["สุกี้น้ำ", "สุกี้น้ำหมู", "suki-nam-moo", 55],
  ["สุกี้น้ำ", "สุกี้น้ำไก่", "suki-nam-gai", 55],
  ["สุกี้น้ำ", "สุกี้น้ำกุ้ง", "suki-nam-goong", 70],
  ["สุกี้น้ำ", "สุกี้น้ำหมึก", "suki-nam-muek", 70],
  ["สุกี้น้ำ", "สุกี้น้ำทะเล", "suki-nam-talay", 70],
  ["สุกี้น้ำ", "สุกี้น้ำรวม", "suki-nam-ruam", 75],
  ["สุกี้แห้ง", "สุกี้แห้งหมู", "dry-suki-pork", 55],
  ["สุกี้แห้ง", "สุกี้แห้งไก่", "dry-suki-chicken", 55],
  ["สุกี้แห้ง", "สุกี้แห้งกุ้ง", "dry-suki-shrimp", 70],
  ["สุกี้แห้ง", "สุกี้แห้งหมึก", "dry-suki-squid", 70],
  ["สุกี้แห้ง", "สุกี้แห้งทะเล", "dry-suki-seafood", 70],
  ["สุกี้แห้ง", "สุกี้แห้งรวม", "dry-suki-mixed", 75],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วหมู", "pad-see-ew-moo", 55],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วไก่", "pad-see-ew-gai", 55],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วกุ้ง", "pad-see-ew-goong", 70],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วหมึก", "pad-see-ew-muek", 70],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วทะเล", "pad-see-ew-talay", 70],
  ["ผัดซีอิ๊ว", "ผัดซีอิ๊วรวม", "pad-see-ew-ruam", 75],
];

const DEMO_FOOD_ITEMS = DEMO_FOOD_DEFINITIONS.map(([category, name, slug, price], index) =>
  foodItem(`demo-food-${String(index + 1).padStart(2, "0")}`, category, name, slug, price, index + 1),
);

export const DEMO_MENU_GROUPS: PublicMenuGroupWithOptions[] = [
  {
    category: "ชาและโกโก้",
    items: [
      drinkItem("demo-menu-cha-tai", "ชาและโกโก้", "ชาใต้", "ชาใต้หอมเข้มข้น หวานมัน — ข้อมูลตัวอย่าง", "cha-tai", 29, 1),
      drinkItem("demo-menu-green-tea", "ชาและโกโก้", "ชาเขียว", "ชาเขียวหอมหวาน เย็นชื่นใจ — ข้อมูลตัวอย่าง", "green-tea", 29, 2),
      drinkItem("demo-menu-lemon-tea", "ชาและโกโก้", "ชามะนาว", "ชามะนาวเปรี้ยวสดชื่น — ข้อมูลตัวอย่าง", "lemon-tea", 29, 3),
      drinkItem("demo-menu-green-lemon-tea", "ชาและโกโก้", "ชาเขียวมะนาว", "ชาเขียวผสมมะนาวสด หอมเปรี้ยวลงตัว — ข้อมูลตัวอย่าง", "green-lemon-tea", 29, 4),
      drinkItem("demo-menu-black-tea", "ชาและโกโก้", "ชาดำเย็น", "ชาดำเย็นเข้มข้น ดื่มง่าย — ข้อมูลตัวอย่าง", "black-tea", 19, 5),
      drinkItem("demo-menu-cocoa", "ชาและโกโก้", "โกโก้", "โกโก้เข้มข้น หวานมัน — ข้อมูลตัวอย่าง", "cocoa", 29, 6),
    ],
  },
  {
    category: "นม",
    items: [
      drinkItem("demo-menu-honey-milk", "นม", "นมสดน้ำผึ้ง", "นมสดหวานน้ำผึ้ง หอมละมุน — ข้อมูลตัวอย่าง", "honey-milk", 29, 1),
      drinkItem("demo-menu-caramel-milk", "นม", "นมสดคาราเมล", "นมสดคาราเมลหอมหวาน — ข้อมูลตัวอย่าง", "caramel-milk", 29, 2),
      drinkItem("demo-menu-pink-milk", "นม", "นมชมพู", "นมชมพูหวานหอม สีสวย — ข้อมูลตัวอย่าง", "pink-milk", 29, 3),
      drinkItem("demo-menu-fresh-milk", "นม", "นมสด", "นมสดรสธรรมชาติ เย็นชื่นใจ — ข้อมูลตัวอย่าง", "fresh-milk", 29, 4),
    ],
  },
  {
    category: "โซดา",
    items: [
      drinkItem("demo-menu-honey-lemon-soda", "โซดา", "น้ำผึ้งมะนาวโซดา", "น้ำผึ้งมะนาวโซดาซ่า สดชื่น — ข้อมูลตัวอย่าง", "honey-lemon-soda", 29, 1),
      drinkItem("demo-menu-red-lemon-soda", "โซดา", "แดงมะนาวโซดา", "น้ำแดงมะนาวโซดา เปรี้ยวซ่า — ข้อมูลตัวอย่าง", "red-lemon-soda", 29, 2),
      drinkItem("demo-menu-red-soda", "โซดา", "แดงโซดา", "น้ำแดงโซดา หอมหวานซ่า — ข้อมูลตัวอย่าง", "red-soda", 19, 3),
    ],
  },
  {
    category: "กาแฟและมัทฉะ",
    items: [
      drinkItem("demo-menu-espresso", "กาแฟและมัทฉะ", "เอสเพรสโซ่", "เอสเพรสโซ่เข้มข้น หอมเมล็ดกาแฟ — ข้อมูลตัวอย่าง", "espresso", 39, 1),
      drinkItem("demo-menu-latte", "กาแฟและมัทฉะ", "ลาเต้", "ลาเต้นมนุ่มละมุน — ข้อมูลตัวอย่าง", "latte", 39, 2),
      drinkItem("demo-menu-cappuccino", "กาแฟและมัทฉะ", "คาปูชิโน่", "คาปูชิโน่ฟองนมนุ่ม เข้มกำลังดี — ข้อมูลตัวอย่าง", "cappuccino", 39, 3),
      drinkItem("demo-menu-mocha", "กาแฟและมัทฉะ", "มอคค่า", "มอคค่ากาแฟผสมโกโก้ — ข้อมูลตัวอย่าง", "mocha", 39, 4),
      drinkItem("demo-menu-matcha-latte", "กาแฟและมัทฉะ", "มัจฉะลาเต้", "มัจฉะลาเต้ชาเขียวมัทฉะกับนมสด — ข้อมูลตัวอย่าง", "matcha-latte", 49, 5),
    ],
  },
];

/** Fixture อาหาร 60 รายการ; แยก export เพื่อคง DEMO_MENU_GROUPS เครื่องดื่มเดิมที่ผู้ใช้/เทสต์ใช้อยู่ */
export const DEMO_FOOD_MENU_GROUPS: PublicMenuGroupWithOptions[] = Array.from(
  new Set(DEMO_FOOD_ITEMS.map((item) => item.category)),
  (category) => ({ category, items: DEMO_FOOD_ITEMS.filter((item) => item.category === category) }),
);

/** ชุด fixture สำหรับ fallback ของหน้าเมนู: อาหาร 60 + เครื่องดื่มเดิม */
export const DEMO_MENU_GROUPS_WITH_FOOD: PublicMenuGroupWithOptions[] = [
  ...DEMO_FOOD_MENU_GROUPS,
  ...DEMO_MENU_GROUPS,
];

export const DEMO_ORDERS: OrderDetail[] = [
  {
    id: "demo-order-1",
    orderNumber: "ORD-DEMO-0001",
    customerId: "demo-customer-1",
    guestName: null,
    guestPhone: null,
    channel: "web",
    serviceType: "dine_in",
    status: "pending_payment",
    subtotal: 110,
    total: 110,
    scheduledAt: null,
    tableId: "demo-table-a1",
    roundId: "demo-round-1",
    stockReserved: true,
    stockConsumed: false,
    estimatedCost: 42,
    createdAt: T("2026-09-15T10:30:00+07:00"),
    updatedAt: T("2026-09-15T10:32:00+07:00"),
    items: [
      {
        id: "demo-item-1",
        orderId: "demo-order-1",
        menuId: "demo-menu-khaophad",
        menuName: "ข้าวผัดป้าอ้อ (ตัวอย่าง)",
        unitPrice: 55,
        quantity: 2,
        lineTotal: 110,
        note: null,
        selectedOptions: [],
        specialRequest: "เผ็ดน้อย",
        estimatedCost: 42,
      },
    ],
  },
  {
    id: "demo-order-2",
    orderNumber: "ORD-DEMO-0002",
    customerId: null,
    guestName: "คุณมินตรา (ตัวอย่าง)",
    guestPhone: "0812345678",
    channel: "web",
    serviceType: "takeaway",
    status: "completed",
    subtotal: 80,
    total: 80,
    scheduledAt: null,
    tableId: null,
    roundId: null,
    stockReserved: true,
    stockConsumed: true,
    estimatedCost: 28,
    createdAt: T("2026-09-14T17:05:00+07:00"),
    updatedAt: T("2026-09-14T17:25:00+07:00"),
    items: [
      {
        id: "demo-item-2",
        orderId: "demo-order-2",
        menuId: "demo-menu-kaprao",
        menuName: "กะเพราหมูสับราดข้าว (ตัวอย่าง)",
        unitPrice: 50,
        quantity: 1,
        lineTotal: 50,
        note: null,
        selectedOptions: [],
        specialRequest: null,
        estimatedCost: 18,
      },
      {
        id: "demo-item-3",
        orderId: "demo-order-2",
        menuId: "demo-menu-chayen",
        menuName: "ชาเย็นป้าอ้อ (ตัวอย่าง)",
        unitPrice: 30,
        quantity: 1,
        lineTotal: 30,
        note: null,
        selectedOptions: [],
        specialRequest: null,
        estimatedCost: 10,
      },
    ],
  },
];

export const DEMO_RESERVATIONS: ReservationDetail[] = [
  {
    id: "demo-res-1",
    code: "RSV-DEMO01",
    customerId: "demo-customer-1",
    tableId: "demo-table-a1",
    tableName: "A1",
    partySize: 4,
    reservedAt: T("2026-09-16T18:00:00+07:00"),
    status: "confirmed",
    note: "ขอโต๊ะริมหน้าต่าง (ตัวอย่าง)",
    createdAt: T("2026-09-15T09:00:00+07:00"),
    updatedAt: T("2026-09-15T09:05:00+07:00"),
  },
  {
    id: "demo-res-2",
    code: "RSV-DEMO02",
    customerId: "demo-customer-1",
    tableId: "demo-table-b2",
    tableName: "B2",
    partySize: 2,
    reservedAt: T("2026-09-17T12:00:00+07:00"),
    status: "pending",
    note: null,
    createdAt: T("2026-09-15T09:10:00+07:00"),
    updatedAt: T("2026-09-15T09:10:00+07:00"),
  },
];

export const DEMO_REWARDS: Reward[] = [
  {
    id: "demo-reward-1",
    name: "ชาเย็นฟรี 1 แก้ว (ตัวอย่าง)",
    imageUrl: null,
    menuId: "demo-menu-chayen",
    menuName: "ชาเย็นป้าอ้อ",
    pointsCost: 10,
    quotaTotal: 50,
    quotaUsed: 12,
    startsAt: null,
    endsAt: null,
    isActive: true,
    createdAt: T("2026-09-01T00:00:00+07:00"),
    updatedAt: T("2026-09-10T00:00:00+07:00"),
  },
  {
    id: "demo-reward-2",
    name: "น้ำมะนาวฟรี 1 แก้ว (ตัวอย่าง)",
    imageUrl: null,
    menuId: "demo-menu-lime",
    menuName: "น้ำมะนาวสด",
    pointsCost: 8,
    quotaTotal: null,
    quotaUsed: 3,
    startsAt: null,
    endsAt: null,
    isActive: true,
    createdAt: T("2026-09-01T00:00:00+07:00"),
    updatedAt: T("2026-09-10T00:00:00+07:00"),
  },
];

export const DEMO_REDEMPTIONS: RewardRedemption[] = [
  {
    id: "demo-red-1",
    code: "RDM-DEMO01",
    customerId: "demo-customer-1",
    rewardId: "demo-reward-1",
    rewardName: "ชาเย็นฟรี 1 แก้ว (ตัวอย่าง)",
    menuId: "demo-menu-chayen",
    menuName: "ชาเย็นป้าอ้อ",
    pointsCost: 10,
    status: "reserved",
    idempotencyKey: "demo-red-1",
    queueJobId: null,
    reason: null,
    createdAt: T("2026-09-15T08:00:00+07:00"),
    updatedAt: T("2026-09-15T08:00:00+07:00"),
  },
];

export const DEMO_LEDGER: LoyaltyTransaction[] = [
  {
    id: "demo-tx-1",
    customerId: "demo-customer-1",
    points: 2,
    source: "order",
    orderId: "demo-order-2",
    paymentId: null,
    orderItemId: null,
    redemptionId: null,
    walkinTokenId: null,
    reason: "รับเครื่องดื่มแล้ว 2 หน่วย (ตัวอย่าง)",
    actorId: null,
    actorUsername: null,
    createdAt: T("2026-09-14T17:25:00+07:00"),
  },
  {
    id: "demo-tx-2",
    customerId: "demo-customer-1",
    points: -10,
    source: "reward_reserve",
    orderId: null,
    paymentId: null,
    orderItemId: null,
    redemptionId: "demo-red-1",
    walkinTokenId: null,
    reason: "กันคะแนนแลกชาเย็นฟรี (ตัวอย่าง)",
    actorId: null,
    actorUsername: null,
    createdAt: T("2026-09-15T08:00:00+07:00"),
  },
];

export const DEMO_BALANCE = 12;

export const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "demo-notif-1",
    eventKey: "demo-reservation-created",
    kind: "reservation_created",
    customerId: "demo-customer-1",
    orderId: null,
    reservationId: "demo-res-1",
    paymentId: null,
    message: "ยืนยันการจอง RSV-DEMO01 โต๊ะ A1 จำนวน 4 ท่าน วันที่ 16 ก.ย. 18:00 น. (ตัวอย่าง)",
    status: "sent",
    attempts: 1,
    maxAttempts: 5,
    nextRetryAt: null,
    lastError: null,
    sentAt: T("2026-09-15T09:05:00+07:00"),
    createdAt: T("2026-09-15T09:05:00+07:00"),
    updatedAt: T("2026-09-15T09:05:00+07:00"),
  },
  {
    id: "demo-notif-2",
    eventKey: "demo-order-ready",
    kind: "order_ready",
    customerId: "demo-customer-1",
    orderId: "demo-order-1",
    reservationId: null,
    paymentId: null,
    message: "คำสั่งซื้อ ORD-DEMO-0001 พร้อมส่งมอบแล้ว พนักงานกำลังนำไปเสิร์ฟที่โต๊ะ A1 (ตัวอย่าง)",
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    lastError: null,
    sentAt: null,
    createdAt: T("2026-09-15T10:40:00+07:00"),
    updatedAt: T("2026-09-15T10:40:00+07:00"),
  },
];

export const DEMO_QUEUE_JOBS: QueueJob[] = [
  {
    id: "demo-job-1",
    orderId: "demo-order-1",
    orderNumber: "ORD-DEMO-0001",
    paymentId: "demo-pay-1",
    orderItemId: "demo-item-1",
    menuId: "demo-menu-khaophad",
    menuName: "ข้าวผัดป้าอ้อ (ตัวอย่าง)",
    station: "kitchen",
    quantity: 2,
    readyQty: 1,
    deliveredQty: 0,
    status: "preparing",
    readyAt: T("2026-09-15T10:50:00+07:00"),
    tableId: "demo-table-a1",
    roundId: "demo-round-1",
    isRemake: false,
    isPriority: false,
    reason: null,
    claimedBy: null,
    createdAt: T("2026-09-15T10:33:00+07:00"),
    updatedAt: T("2026-09-15T10:35:00+07:00"),
    tableName: "A1",
  },
  {
    id: "demo-job-2",
    orderId: "demo-order-1",
    orderNumber: "ORD-DEMO-0001",
    paymentId: "demo-pay-1",
    orderItemId: "demo-item-3",
    menuId: "demo-menu-chayen",
    menuName: "ชาเย็นป้าอ้อ (ตัวอย่าง)",
    station: "drink",
    quantity: 2,
    readyQty: 2,
    deliveredQty: 0,
    status: "ready",
    readyAt: T("2026-09-15T10:38:00+07:00"),
    tableId: "demo-table-a1",
    roundId: "demo-round-1",
    isRemake: false,
    isPriority: false,
    reason: null,
    claimedBy: null,
    createdAt: T("2026-09-15T10:33:00+07:00"),
    updatedAt: T("2026-09-15T10:38:00+07:00"),
    tableName: "A1",
  },
];

export const DEMO_CAPACITY: CapacityOverview = {
  at: T("2026-09-15T10:45:00+07:00"),
  stations: [
    {
      station: "kitchen",
      perSlot: 12,
      activeJobs: 5,
      unitsAhead: 9,
      estimatedWaitMin: 15,
      rangeMin: 10,
      rangeMax: 20,
      source: "baseline",
    },
    {
      station: "drink",
      perSlot: 20,
      activeJobs: 2,
      unitsAhead: 3,
      estimatedWaitMin: 5,
      rangeMin: 3,
      rangeMax: 8,
      source: "baseline",
    },
  ],
  enabledTables: 12,
  freeTables: 7,
  occupiedTables: 5,
  customerCount: 18,
};

export const DEMO_NON_GUARANTEE = "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน (ข้อมูลตัวอย่าง)";
