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
    const env = (import.meta as unknown as { env?: Record<string, unknown> })?.env;
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

export const DEMO_MENU_GROUPS: PublicMenuGroupWithOptions[] = [
  {
    category: "อาหารจานเดียว",
    items: [
      {
        id: "demo-menu-khaophad",
        category: "อาหารจานเดียว",
        name: "ข้าวผัดป้าอ้อ (ตัวอย่าง)",
        description: "ข้าวผัดหอมกระทะ หมูชิ้น ไข่ดาว — ข้อมูลตัวอย่างสำหรับดูดีไซน์",
        imageUrl: null,
        price: 55,
        kind: "food",
        sortOrder: 1,
        inStock: true,
        optionGroups: [
          {
            id: "demo-og-size",
            name: "ขนาด",
            sortOrder: 1,
            options: [
              { id: "demo-opt-regular", name: "ธรรมดา", priceDelta: 0, sortOrder: 1 },
              { id: "demo-opt-special", name: "พิเศษ", priceDelta: 15, sortOrder: 2 },
            ],
          },
        ],
      },
      {
        id: "demo-menu-kaprao",
        category: "อาหารจานเดียว",
        name: "กะเพราหมูสับราดข้าว (ตัวอย่าง)",
        description: "เผ็ดกำลังดี ใบกะเพราสด — ข้อมูลตัวอย่าง",
        imageUrl: null,
        price: 50,
        kind: "food",
        sortOrder: 2,
        inStock: true,
        optionGroups: [],
      },
    ],
  },
  {
    category: "เครื่องดื่ม",
    items: [
      {
        id: "demo-menu-chayen",
        category: "เครื่องดื่ม",
        name: "ชาเย็นป้าอ้อ (ตัวอย่าง)",
        description: "หวานมัน เข้มข้น — ข้อมูลตัวอย่าง",
        imageUrl: null,
        price: 30,
        kind: "drink",
        sortOrder: 1,
        inStock: true,
        optionGroups: [
          {
            id: "demo-og-sweet",
            name: "ระดับความหวาน",
            sortOrder: 1,
            options: [
              { id: "demo-opt-sw100", name: "หวานปกติ", priceDelta: 0, sortOrder: 1 },
              { id: "demo-opt-sw50", name: "หวานน้อย", priceDelta: 0, sortOrder: 2 },
            ],
          },
        ],
      },
      {
        id: "demo-menu-lime",
        category: "เครื่องดื่ม",
        name: "น้ำมะนาวสด (ตัวอย่าง)",
        description: "เปรี้ยวสดชื่น — วัตถุดิบหมดชั่วคราว (ตัวอย่าง)",
        imageUrl: null,
        price: 25,
        kind: "drink",
        sortOrder: 2,
        inStock: false,
        optionGroups: [],
      },
    ],
  },
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
