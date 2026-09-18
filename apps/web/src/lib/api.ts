export type Role = "owner" | "admin" | "kitchen" | "drink";

export interface PublicUser {
  id: string;
  username: string;
  roles: Role[];
  isActive: boolean;
  createdAt: string;
}

export interface AuditItem {
  id: number;
  at: string;
  actorUsername: string | null;
  action: string;
  targetUsername: string | null;
  detail: string | null;
  ip: string | null;
  success: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "เจ้าของร้าน",
  admin: "ผู้ดูแลระบบ",
  kitchen: "ครัว",
  drink: "เครื่องดื่ม",
};

// ---------- Ticket 02: สถานะร้านและโต๊ะ ----------
/** คีย์วัน 0 (อาทิตย์) .. 6 (เสาร์) ตรงกับ server */
export type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["0", "1", "2", "3", "4", "5", "6"];

export interface TimeInterval {
  open: string;
  close: string;
}

export interface DaySchedule {
  closed: boolean;
  intervals: TimeInterval[];
}

export type WeeklySchedule = Record<WeekdayKey, DaySchedule>;

/** รอบบริการที่กำลังเปิดอยู่จริง (อาจมาจาก overnight ของเมื่อวาน) */
export interface ServiceWindow {
  sourceWeekday: WeekdayKey;
  open: string;
  close: string;
  overnight: boolean;
}

export interface ShopOverride {
  mode: "open" | "closed";
  reason: string | null;
  expectedReopenAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** สถานะโต๊ะแบบสาธารณะ: พอให้รู้ว่าสั่งที่โต๊ะนี้ได้ไหม ไม่มีข้อมูลลูกค้าหรือรหัสรอบ */
export interface PublicTableStatus {
  table: { id: string; name: string; zone: TableZone | null };
  /** โต๊ะเปิดใช้งานอยู่และมีรอบที่เช็กอินแล้ว */
  ready: boolean;
  openedAt: string | null;
}

export interface ShopStatus {
  shopName: string;
  isOpen: boolean;
  isTemporary: boolean;
  reason: string | null;
  expectedReopenAt: string | null;
  today: { date: string; weekday: number; closed: boolean; intervals: TimeInterval[] };
  serviceWindow: ServiceWindow | null;
  tables: { enabled: number; free: number; occupied: number };
  customerCount: number;
}

export interface ShopConfig {
  shopName: string;
  schedule: WeeklySchedule;
  /** override ที่ยังมีผล (null เมื่อไม่มีหรือหมดอายุแล้ว) */
  override: ShopOverride | null;
  /** override ที่เก็บไว้แต่หมดอายุแล้ว (ให้ UI แสดงว่าไม่ active แทน) */
  expiredOverride: ShopOverride | null;
}

/** โซนที่นั่งของร้าน (ตรงกับ TABLE_ZONES ฝั่ง API) */
export const TABLE_ZONES = ["front", "dining", "kitchen", "sala"] as const;
export type TableZone = (typeof TABLE_ZONES)[number];
export const TABLE_ZONE_LABELS: Record<TableZone, string> = {
  front: "โซนหน้าร้าน (ใต้กันสาด)",
  dining: "โซนห้องอาหาร",
  kitchen: "โซนบาร์หน้าครัว",
  sala: "โซนศาลากลางแจ้ง",
};

export interface ShopTable {
  id: string;
  name: string;
  capacity: number;
  isEnabled: boolean;
  /** null = ยังไม่กำหนดโซน */
  zone?: TableZone | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Ticket 03: บัญชีลูกค้า + LINE (แยกจากบัญชีพนักงานโดยสิ้นเชิง) ----------

export interface PublicCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: string;
}

export interface AdminCustomerItem extends PublicCustomer {
  lineLinked: boolean;
}

export interface LineStatus {
  linked: boolean;
  displayName?: string | null;
  linkedAt?: string;
}

export interface AdminCustomerDetail {
  customer: PublicCustomer;
  line: LineStatus;
}

// ---------- Ticket 04: แคตตาล็อกเมนู ----------

export type MenuKind = "food" | "drink";
export type MenuStatus = "available" | "unavailable";

export const MENU_KIND_LABELS: Record<MenuKind, string> = {
  food: "อาหาร",
  drink: "เครื่องดื่ม",
};

export const MENU_STATUS_LABELS: Record<MenuStatus, string> = {
  available: "เปิดขาย",
  unavailable: "ปิดขาย",
};

export interface PublicMenuItem {
  id: string;
  category: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  kind: MenuKind;
  sortOrder: number;
}

// ---------- Ticket 07: ตัวเลือกเมนู ----------

export interface PublicMenuOption {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
}

export interface PublicMenuOptionGroup {
  id: string;
  name: string;
  sortOrder: number;
  options: PublicMenuOption[];
}

export interface PublicMenuItemWithOptions extends PublicMenuItem {
  optionGroups: PublicMenuOptionGroup[];
  /** พร้อมขายจากสต๊อก (false = วัตถุดิบหมดชั่วคราว) */
  inStock: boolean;
}

export interface PublicMenuGroupWithOptions {
  category: string;
  items: PublicMenuItemWithOptions[];
}

export interface MenuOptionGroup {
  id: string;
  menuId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuOption {
  id: string;
  groupId: string;
  menuId: string;
  name: string;
  priceDelta: number;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuOptionGroupDetail extends MenuOptionGroup {
  options: MenuOption[];
}

// ---------- Ticket 07: วัตถุดิบ/สูตร/สต๊อก ----------

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  reserved: number;
  /** พร้อมขาย = คงเหลือจริง − ยอดจอง */
  available: number;
  reorderThreshold: number;
  latestCost: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StockOp =
  | "receive"
  | "reserve"
  | "release"
  | "consume"
  | "return"
  | "waste"
  | "expire"
  | "personal_use"
  | "adjust";

export type ManualStockOp = "receive" | "return" | "waste" | "expire" | "personal_use" | "adjust";

export const STOCK_OP_LABELS: Record<StockOp, string> = {
  receive: "รับเข้า",
  reserve: "จองสต๊อก",
  release: "คืนยอดจอง",
  consume: "ตัดใช้จริง",
  return: "รับคืน",
  waste: "ของเสีย",
  expire: "หมดอายุ",
  personal_use: "ใช้ส่วนตัว",
  adjust: "ปรับยอดตรวจนับ",
};

export const MANUAL_STOCK_OPS: ManualStockOp[] = ["receive", "return", "waste", "expire", "personal_use", "adjust"];

export interface StockLedgerEntry {
  id: string;
  ingredientId: string;
  op: StockOp;
  deltaOnHand: number;
  deltaReserved: number;
  beforeOnHand: number;
  afterOnHand: number;
  beforeReserved: number;
  afterReserved: number;
  reason: string;
  actorId: string | null;
  actorUsername: string | null;
  orderId: string | null;
  reference: string | null;
  createdAt: string;
}

export interface RecipeLine {
  ingredientId: string;
  qty: number;
}

export interface Recipe {
  id: string;
  targetType: "menu" | "option";
  targetId: string;
  version: number;
  lines: RecipeLine[];
  estimatedCostPerUnit: number;
  createdBy: string | null;
  createdAt: string;
}

export interface MenuGroup {
  category: string;
  items: PublicMenuItem[];
}

export interface MenuItem extends PublicMenuItem {
  status: MenuStatus;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuInput {
  category: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  kind: MenuKind;
  status?: MenuStatus;
  sortOrder?: number;
}

export interface MenuPatch {
  category?: string;
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  price?: number;
  kind?: MenuKind;
  status?: MenuStatus;
  sortOrder?: number;
}

export interface MenuListQuery {
  includeArchived?: boolean;
  category?: string;
  kind?: MenuKind;
  status?: MenuStatus;
  q?: string;
}

// ---------- Ticket 05: ตะกร้าและคำสั่งซื้อพื้นฐาน ----------

export type OrderServiceType = "dine_in" | "takeaway" | "preorder";
export type OrderStatus = "pending_payment" | "completed" | "cancelled";

export const ORDER_SERVICE_LABELS: Record<OrderServiceType, string> = {
  dine_in: "รับประทานที่ร้าน",
  takeaway: "กลับบ้าน",
  preorder: "ล่วงหน้า (นัดเวลารับ)",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "รอชำระเงิน",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิกแล้ว",
};

export interface OrderItem {
  id: string;
  orderId: string;
  menuId: string;
  /** snapshot ชื่อเมนูตอนยืนยัน (ไม่เปลี่ยนตามเมนูภายหลัง) */
  menuName: string;
  /** snapshot ราคาต่อหน่วยตอนยืนยัน */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  note: string | null;
  /** Ticket 07: snapshot ตัวเลือกที่เลือก (ชื่อ+ส่วนต่างราคาตอนยืนยัน) */
  selectedOptions: { groupId: string; groupName: string; optionId: string; optionName: string; priceDelta: number }[];
  /** Ticket 07: ความต้องการเฉพาะ — ข้อความล้วน ไม่เปลี่ยนราคา */
  specialRequest: string | null;
  /** Ticket 07: ต้นทุนวัตถุดิบประมาณการของรายการนี้ */
  estimatedCost: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  channel: "web";
  serviceType: OrderServiceType;
  status: OrderStatus;
  subtotal: number;
  total: number;
  scheduledAt: string | null;
  /** Ticket 06: ผูกกับโต๊ะ/รอบที่เปิดอยู่ (null เมื่อไม่ได้ผูก) */
  tableId?: string | null;
  roundId?: string | null;
  /** Ticket 07: จองสต๊อกแล้ว / ตัดสต๊อกจริงแล้ว / ต้นทุนประมาณการรวม */
  stockReserved?: boolean;
  stockConsumed?: boolean;
  estimatedCost?: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface CreateOrderRequest {
  serviceType: OrderServiceType;
  scheduledAt?: string | null;
  items: { menuId: string; quantity: number; note?: string | null; options?: string[] | null; specialRequest?: string | null }[];
  guestName?: string;
  guestPhone?: string;
  idempotencyKey: string;
  /** Ticket 06: ผูกคำสั่งซื้อที่โต๊ะกับรอบที่เปิดอยู่ (เฉพาะ dine_in) */
  tableId?: string | null;
  roundId?: string | null;
}

// ---------- Ticket 06: การจองโต๊ะและรอบการใช้โต๊ะ ----------

export type ReservationStatus = "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";
export type TableRoundStatus = "open" | "closed";

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "รอการยืนยัน",
  confirmed: "ยืนยันแล้ว",
  seated: "เช็กอินแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิกแล้ว",
  no_show: "ไม่มาตามนัด",
};

export const TABLE_ROUND_STATUS_LABELS: Record<TableRoundStatus, string> = {
  open: "เปิดอยู่",
  closed: "ปิดแล้ว",
};

export interface ReservationDetail {
  id: string;
  code: string;
  customerId: string;
  tableId: string;
  tableName: string;
  partySize: number;
  reservedAt: string;
  status: ReservationStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** payload QR สำหรับเช็กอินหน้าร้าน (fake/local — มีเฉพาะใน detail ที่เป็นเจ้าของ) */
  qr?: string;
}

export interface TableRoundDetail {
  id: string;
  reservationId: string | null;
  tableId: string;
  tableName: string;
  partySize: number;
  status: TableRoundStatus;
  openedAt: string;
  closedAt: string | null;
}

export interface PublicTableRound {
  tableId: string;
  tableName: string;
  partySize: number;
  openedAt: string;
}

export interface RecommendedTable {
  id: string;
  name: string;
  capacity: number;
}

export type TableAvailabilityStatus = "available" | "booked" | "too_small";

/** สถานะโต๊ะ ณ เวลานัด สำหรับผังเลือกโต๊ะ (GET /api/reservations/availability) */
export interface TableAvailability {
  id: string;
  name: string;
  capacity: number;
  zone: TableZone | null;
  status: TableAvailabilityStatus;
}

// ---------- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน ----------

export type PaymentMethod = "cash" | "promptpay";
export type PaymentStatus =
  | "pending"
  | "paid"
  | "manual_review"
  | "failed"
  | "expired"
  | "refunded"
  | "cancelled";

export type OrderPaymentState =
  | "pending_payment"
  | "paid"
  | "manual_review"
  | "failed"
  | "expired"
  | "refunded";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  promptpay: "พร้อมเพย์",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "รอชำระ",
  paid: "ชำระสำเร็จ",
  manual_review: "รอตรวจสอบการชำระเงิน",
  failed: "ชำระไม่สำเร็จ",
  expired: "หมดอายุ",
  refunded: "คืนเงินแล้ว",
  cancelled: "ยกเลิก",
};

export const ORDER_PAYMENT_STATE_LABELS: Record<OrderPaymentState, string> = {
  pending_payment: "รอชำระเงิน",
  paid: "ชำระสำเร็จ",
  manual_review: "รอตรวจสอบการชำระเงิน",
  failed: "ชำระไม่สำเร็จ",
  expired: "หมดอายุ",
  refunded: "คืนเงินแล้ว",
};

export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  method: PaymentMethod;
  amount: number;
  receivedAmount: number | null;
  changeAmount: number;
  status: PaymentStatus;
  providerRef: string | null;
  slipRef: string | null;
  receiptNumber: string | null;
  idempotencyKey: string;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  receiptNumber: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  shopName: string;
  method: PaymentMethod;
  amount: number;
  receivedAmount: number | null;
  changeAmount: number;
  paidAt: string;
  items: { menuName: string; quantity: number; unitPrice: number; lineTotal: number }[];
  createdAt: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  reason: string;
  approvedBy: string | null;
  approvedAt: string;
  createdAt: string;
}

// ---------- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ ----------

export type QueueStation = "kitchen" | "drink";

export type QueueStatus =
  | "queued"
  | "claimed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export const QUEUE_STATION_LABELS: Record<QueueStation, string> = {
  kitchen: "ครัว",
  drink: "เครื่องดื่ม",
};

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  queued: "รอรับงาน",
  claimed: "รับงานแล้ว",
  preparing: "กำลังทำ",
  ready: "พร้อมส่งมอบ",
  delivered: "ส่งมอบแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

export interface QueueJob {
  id: string;
  orderId: string;
  orderNumber: string;
  paymentId: string;
  orderItemId: string;
  menuId: string;
  menuName: string;
  station: QueueStation;
  quantity: number;
  readyQty: number;
  deliveredQty: number;
  status: QueueStatus;
  readyAt: string;
  tableId: string | null;
  roundId: string | null;
  isRemake: boolean;
  isPriority: boolean;
  reason: string | null;
  claimedBy: string | null;
  createdAt: string;
  updatedAt: string;
  tableName: string | null;
}

export interface StationCapacity {
  station: QueueStation;
  perSlot: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface QueueSlot {
  station: QueueStation;
  slotStart: string;
  slotEnd: string;
  used: number;
  capacity: number;
  available: number;
}

// ---------- Ticket 10: คะแนนสะสมและรางวัล ----------

export type LoyaltySource =
  | "order"
  | "walkin"
  | "guest_link"
  | "reward_reserve"
  | "reward_consume"
  | "reward_release"
  | "refund"
  | "merge"
  | "adjust";

export const LOYALTY_SOURCE_LABELS: Record<LoyaltySource, string> = {
  order: "คำสั่งซื้อ",
  walkin: "Walk-in (QR)",
  guest_link: "ผูกคำสั่งซื้อ Guest",
  reward_reserve: "กันคะแนนแลก reward",
  reward_consume: "แลก reward",
  reward_release: "คืนคะแนนแลก reward",
  refund: "คืนเงิน/ยกเลิก",
  merge: "รวมบัญชี",
  adjust: "ปรับปรุงโดยร้าน",
};

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  points: number;
  source: LoyaltySource;
  orderId: string | null;
  paymentId: string | null;
  orderItemId: string | null;
  redemptionId: string | null;
  walkinTokenId: string | null;
  reason: string;
  actorId: string | null;
  actorUsername: string | null;
  createdAt: string;
}

export interface Reward {
  id: string;
  name: string;
  imageUrl: string | null;
  menuId: string;
  menuName: string;
  pointsCost: number;
  quotaTotal: number | null;
  quotaUsed: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RedemptionStatus = "reserved" | "consumed" | "released";

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  reserved: "รอร้านรับรายการ",
  consumed: "รับรายการแล้ว",
  released: "คืนคะแนนแล้ว",
};

export interface RewardRedemption {
  id: string;
  code: string;
  customerId: string;
  rewardId: string;
  rewardName: string;
  menuId: string;
  menuName: string;
  pointsCost: number;
  status: RedemptionStatus;
  idempotencyKey: string;
  queueJobId: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalkinQrToken {
  id: string;
  code: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
}

export interface RewardInput {
  name: string;
  imageUrl?: string | null;
  menuId: string;
  pointsCost: number;
  quotaTotal?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

export interface RewardPatch {
  name?: string;
  imageUrl?: string | null;
  pointsCost?: number;
  quotaTotal?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

// ---------- Ticket 11: การเงิน รายงาน Dashboard และ CSV ----------

export type FinanceKind = "income" | "expense";

export type FinanceCategory =
  | "ingredients"
  | "labor"
  | "utilities"
  | "rent"
  | "maintenance"
  | "marketing"
  | "other_expense"
  | "other_income"
  | "catering"
  | "adjustment";

export const FINANCE_CATEGORY_LABELS: Record<FinanceCategory, string> = {
  ingredients: "วัตถุดิบ",
  labor: "ค่าแรง",
  utilities: "ค่าสาธารณูปโภค",
  rent: "ค่าเช่า",
  maintenance: "ซ่อมบำรุง",
  marketing: "การตลาด",
  other_expense: "อื่น ๆ (รายจ่าย)",
  other_income: "รายรับอื่น",
  catering: "รับจัดเลี้ยง",
  adjustment: "ปรับปรุงยอด",
};

export const FINANCE_EXPENSE_CATEGORIES: FinanceCategory[] = [
  "ingredients",
  "labor",
  "utilities",
  "rent",
  "maintenance",
  "marketing",
  "other_expense",
];

export const FINANCE_INCOME_CATEGORIES: FinanceCategory[] = [
  "other_income",
  "catering",
  "adjustment",
];

export interface FinanceEntry {
  id: string;
  kind: FinanceKind;
  category: FinanceCategory;
  amount: number;
  occurredAt: string;
  note: string | null;
  reason: string;
  actorId: string | null;
  actorUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FinanceGranularity = "day" | "month" | "year";

export interface FinanceReportBucket {
  bucket: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  manualIncome: number;
  actualExpense: number;
  grossProfit: number;
  paidOrders: number;
  estimatedCost: number;
}

export interface FinanceReport {
  granularity: FinanceGranularity;
  from: string;
  to: string;
  buckets: FinanceReportBucket[];
  total: FinanceReportBucket;
}

export interface FinanceTopMenu {
  menuId: string;
  menuName: string;
  quantity: number;
  revenue: number;
}

export interface FinancePeakHour {
  hour: number;
  paidOrders: number;
  revenue: number;
}

export interface FinanceOccupancy {
  enabledTables: number;
  freeTables: number;
  occupiedTables: number;
  customerCount: number;
}

export interface FinanceDashboard {
  date: string;
  netSales: number;
  grossRevenue: number;
  refunds: number;
  paidOrders: number;
  averageTicket: number;
  manualIncome: number;
  actualExpense: number;
  grossProfit: number;
  estimatedCost: number;
  topMenus: FinanceTopMenu[];
  peakHours: FinancePeakHour[];
  occupancy: FinanceOccupancy | null;
  lowStockCount: number;
}

export type FinanceCsvKind = "sales" | "orders" | "finance" | "stock" | "queue";

// ---------- Ticket 12: LINE notifications outbox + web fallback ----------

export type NotificationKind =
  | "reservation_created"
  | "reservation_cancelled"
  | "reservation_reminder"
  | "payment_paid"
  | "payment_manual_review"
  | "order_ready"
  | "order_delivered"
  | "loyalty_earned"
  | "loyalty_redeemed";

export type NotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "dead_letter"
  | "skipped";

export interface NotificationItem {
  id: string;
  eventKey: string;
  kind: NotificationKind;
  customerId: string | null;
  orderId: string | null;
  reservationId: string | null;
  paymentId: string | null;
  message: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationFlushResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  deadLetter: number;
}

export interface NotificationReminderResult {
  checked: number;
  queued: number;
  deduplicated: number;
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  reservation_created: "ยืนยันการจอง",
  reservation_cancelled: "ยกเลิกการจอง",
  reservation_reminder: "เตือนก่อนเวลานัด",
  payment_paid: "รับชำระแล้ว",
  payment_manual_review: "รอตรวจสอบการชำระ",
  order_ready: "อาหารพร้อมรับ",
  order_delivered: "ส่งมอบครบแล้ว",
  loyalty_earned: "ได้รับคะแนน",
  loyalty_redeemed: "ใช้คะแนนแล้ว",
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: "รอส่ง",
  sending: "กำลังส่ง",
  sent: "ส่งแล้ว",
  failed: "รอส่งซ้ำ",
  dead_letter: "ส่งไม่สำเร็จ",
  skipped: "ข้าม (ดูในเว็บ)",
};

// ---------- Ticket 13: Capacity + พยากรณ์เวลารอ ----------

export type PredictionSource = "baseline" | "model";

export const PREDICTION_SOURCE_LABELS: Record<PredictionSource, string> = {
  baseline: "เวลามาตรฐาน",
  model: "โมเดลพยากรณ์",
};

export interface CapacityStationSummary {
  station: QueueStation;
  perSlot: number;
  activeJobs: number;
  unitsAhead: number;
  estimatedWaitMin: number;
  rangeMin: number;
  rangeMax: number;
  source: PredictionSource;
}

export interface CapacityOverview {
  at: string;
  stations: CapacityStationSummary[];
  enabledTables: number;
  freeTables: number;
  occupiedTables: number;
  customerCount: number;
}

export interface WaitStationBreakdown {
  station: QueueStation;
  jobs: number;
  queueAhead: number;
  unitsAhead: number;
  estimatedWaitMin: number;
}

export interface WaitEstimate {
  orderId: string | null;
  station: QueueStation | null;
  partySize: number;
  perStation: WaitStationBreakdown[];
  estimatedWaitMin: number;
  rangeMin: number;
  rangeMax: number;
  readyAtSlowest: string | null;
  source: PredictionSource;
  modelVersion: string;
  predictedAt: string;
  timeoutMs: number;
  nonGuarantee: string;
}

export interface QueueSlotInfo {
  station: QueueStation;
  slotStart: string;
  slotEnd: string;
  used: number;
  capacity: number;
  available: number;
}

export interface PreorderSlotCheck {
  station: QueueStation;
  scheduledAt: string;
  slotStart: string;
  slotEnd: string;
  used: number;
  capacity: number;
  available: boolean;
  estimatedWaitMin: number;
  rangeMin: number;
  rangeMax: number;
  suggestedSlot: QueueSlotInfo | null;
}

export interface PredictionModel {
  version: string;
  kind: "baseline" | "external";
  enabled: boolean;
  thresholdMinutes: number;
  timeoutMs: number;
  samples: number;
  maeBaseline: number | null;
  maeModel: number | null;
  trainedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PredictionAccuracy {
  samples: number;
  maeBaseline: number | null;
  maeModel: number | null;
  meetsThreshold: boolean;
  thresholdMinutes: number;
  gatheringSamples: boolean;
  fixtures: {
    name: string;
    samples: number;
    maeBaseline: number;
    maeModel: number;
    modelWins: boolean;
  };
  evaluatedAt: string;
}

export interface PredictionFeature {
  id: string;
  orderId: string | null;
  station: QueueStation | null;
  partySize: number;
  queueAhead: number;
  unitsAhead: number;
  hourOfDay: number;
  dayOfWeek: number;
  isRemake: boolean;
  isPriority: boolean;
  slotKey: string | null;
  baselineMin: number;
  predictedMin: number | null;
  modelVersion: string;
  source: PredictionSource;
  actualMin: number | null;
  errorBaseline: number | null;
  errorModel: number | null;
  createdAt: string;
  completedAt: string | null;
}

/** ประวัติร้านใช้ AuditItem ชุดเดียวกับประวัติบัญชี (shape เดียวกัน ไม่ duplicate type) */

const BASE = import.meta.env["VITE_API_URL"] ?? "";
const CSRF_COOKIE = "csrf";
const CSRF_HEADER = "x-csrf-token";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${CSRF_COOKIE}=`)) {
      try {
        return decodeURIComponent(trimmed.slice(CSRF_COOKIE.length + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function csrfToken(): Promise<string> {
  // อ่านคุกกี้ปัจจุบันทุกครั้ง ไม่ cache ข้าม tab — รองรับหลาย tab และการ rotate token
  const current = readCsrfCookie();
  if (current) return current;
  const res = await fetch(`${BASE}/api/auth/csrf`, { credentials: "include" });
  if (!res.ok) throw new Error("เตรียมความปลอดภัยไม่สำเร็จ กรุณาโหลดหน้าใหม่");
  const data = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  // เบราว์เซอร์จริงจะได้ค่าจากคุกกี้ที่ server เพิ่งตั้ง; สำรองด้วย body สำหรับ client ที่อ่านคุกกี้ไม่ได้
  const after = readCsrfCookie() ?? data.csrfToken;
  if (!after) throw new Error("เตรียมความปลอดภัยไม่สำเร็จ กรุณาโหลดหน้าใหม่");
  return after;
}

async function req<T>(path: string, init?: RequestInit, withCsrf = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withCsrf) headers[CSRF_HEADER] = await csrfToken();
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  // ตั้งใจไม่ retry mutation อัตโนมัติเมื่อ CSRF ล้มเหลว (กันส่งซ้ำ) ให้ผู้ใช้โหลดหน้าใหม่
  if (!res.ok) throw new Error(data.error ?? `เกิดข้อผิดพลาด (${res.status})`);
  return data as T;
}

export const api = {
  // login ต้องแนบ CSRF token (double-submit) เช่นเดียวกับ mutation อื่น
  login: (username: string, password: string) =>
    req<{ user: PublicUser }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
      true,
    ),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }, true),
  me: () => req<{ user: PublicUser }>("/api/auth/me"),
  /**
   * "ตอนนี้มีพนักงานล็อกอินไหม" — ตอบ 200 เสมอ (ไม่มี → user: null)
   * ใช้ตอนเปิดแอปเลือกเชลล์ลูกค้า/หลังร้าน แทน me ซึ่งตอบ 401 ให้ลูกค้าทุกคนทุกครั้ง
   */
  staffSession: () => req<{ user: PublicUser | null }>("/api/auth/session"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean; message: string }>(
      "/api/auth/change-password",
      { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) },
      true,
    ),
  listUsers: () => req<{ users: PublicUser[] }>("/api/users"),
  createUser: (username: string, password: string, roles: Role[]) =>
    req<{ user: PublicUser }>(
      "/api/users",
      { method: "POST", body: JSON.stringify({ username, password, roles }) },
      true,
    ),
  setRoles: (id: string, roles: Role[]) =>
    req<{ user: PublicUser }>(`/api/users/${id}/roles`, { method: "PATCH", body: JSON.stringify({ roles }) }, true),
  deactivate: (id: string) =>
    req<{ user: PublicUser }>(`/api/users/${id}/deactivate`, { method: "POST" }, true),
  activate: (id: string) =>
    req<{ user: PublicUser }>(`/api/users/${id}/activate`, { method: "POST" }, true),
  resetPassword: (id: string, newPassword: string) =>
    req<{ ok: boolean; message: string }>(
      `/api/users/${id}/reset-password`,
      { method: "POST", body: JSON.stringify({ newPassword }) },
      true,
    ),
  loginAudit: () => req<{ items: AuditItem[] }>("/api/audit/logins?limit=100"),
  accountAudit: () => req<{ items: AuditItem[] }>("/api/audit/accounts?limit=100"),
  // Ticket 02
  shopStatus: () => req<ShopStatus>("/api/shop/status"),
  shopConfig: () => req<ShopConfig>("/api/shop/schedule"),
  saveSchedule: (shopName: string | undefined, schedule: WeeklySchedule) =>
    req<ShopConfig>(
      "/api/shop/schedule",
      { method: "PUT", body: JSON.stringify(shopName === undefined ? { schedule } : { shopName, schedule }) },
      true,
    ),
  setOverride: (body: { mode: "open" | "closed"; reason?: string; expectedReopenAt?: string; expiresAt?: string }) =>
    req<{ override: ShopOverride }>("/api/shop/override", { method: "POST", body: JSON.stringify(body) }, true),
  clearOverride: () => req<{ ok: boolean; cleared: boolean }>("/api/shop/override", { method: "DELETE" }, true),
  listTables: () => req<{ tables: ShopTable[] }>("/api/tables"),
  /** สถานะโต๊ะแบบสาธารณะ (ใช้ตอนลูกค้าสแกน QR ที่โต๊ะ) — ไม่ต้อง login */
  tablePublicStatus: (tableId: string) =>
    req<PublicTableStatus>(`/api/tables/${encodeURIComponent(tableId)}/public-status`),
  createTable: (name: string, capacity: number, zone?: TableZone | null) =>
    req<{ table: ShopTable }>(
      "/api/tables",
      { method: "POST", body: JSON.stringify(zone === undefined ? { name, capacity } : { name, capacity, zone }) },
      true,
    ),
  updateTable: (id: string, patch: { name?: string; capacity?: number; isEnabled?: boolean; zone?: TableZone | null }) =>
    req<{ table: ShopTable }>(`/api/tables/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  shopAudit: () => req<{ items: AuditItem[] }>("/api/audit/shop?limit=100"),
  // Ticket 03: ลูกค้า (session แยกจากพนักงาน ใช้คุกกี้ csid ฝั่ง server)
  customerRegister: (name: string, phone: string, password: string, email?: string) =>
    req<{ customer: PublicCustomer }>(
      "/api/customers/register",
      { method: "POST", body: JSON.stringify(email ? { name, phone, password, email } : { name, phone, password }) },
      true,
    ),
  customerLogin: (phone: string, password: string) =>
    req<{ customer: PublicCustomer }>(
      "/api/customers/login",
      { method: "POST", body: JSON.stringify({ phone, password }) },
      true,
    ),
  customerLogout: () => req<{ ok: boolean }>("/api/customers/logout", { method: "POST" }, true),
  customerMe: () => req<{ customer: PublicCustomer }>("/api/customers/me"),
  /**
   * "ตอนนี้มี session ลูกค้าไหม" — ตอบ 200 เสมอ (guest ได้ customer: null)
   * ใช้แทน customerMe ในหน้าสาธารณะ เพื่อไม่ให้ guest เห็น 401 กองใน console
   */
  customerSession: () => req<{ customer: PublicCustomer | null }>("/api/customers/session"),
  updateCustomerProfile: (patch: { name?: string; email?: string | null }) =>
    req<{ customer: PublicCustomer }>("/api/customers/me", { method: "PATCH", body: JSON.stringify(patch) }, true),
  changeCustomerPassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean; message: string }>(
      "/api/customers/change-password",
      { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) },
      true,
    ),
  deleteCustomerMe: () => req<{ ok: boolean; message: string }>("/api/customers/me", { method: "DELETE" }, true),
  lineStart: (redirect = "/profile") =>
    req<{ authorizeUrl: string }>("/api/customers/line/start", { method: "POST", body: JSON.stringify({ redirect }) }, true),
  lineStatus: () => req<LineStatus>("/api/customers/line/status"),
  lineUnlink: () => req<{ ok: boolean; message: string }>("/api/customers/line/unlink", { method: "POST" }, true),
  adminCustomers: (q = "", limit = 20) =>
    req<{ customers: AdminCustomerItem[] }>(`/api/admin/customers?q=${encodeURIComponent(q)}&limit=${limit}`),
  adminCustomerDetail: (id: string) => req<AdminCustomerDetail>(`/api/admin/customers/${id}`),
  adminCustomerDeactivate: (id: string) =>
    req<{ customer: PublicCustomer }>(`/api/admin/customers/${id}/deactivate`, { method: "POST" }, true),
  adminCustomerActivate: (id: string) =>
    req<{ customer: PublicCustomer }>(`/api/admin/customers/${id}/activate`, { method: "POST" }, true),
  customerAudit: () => req<{ items: AuditItem[] }>("/api/audit/customers?limit=100"),
  // Ticket 04: เมนู (public ไม่ต้อง login; หลังร้านเฉพาะ Owner/Admin)
  // Ticket 07: public แนบกลุ่มตัวเลือกที่เปิดขาย + สถานะพร้อมขายจากสต๊อก
  menuPublic: () => req<{ groups: PublicMenuGroupWithOptions[] }>("/api/menu/public"),
  menuList: (q: MenuListQuery = {}) => {
    const params = new URLSearchParams();
    if (q.includeArchived) params.set("includeArchived", "1");
    if (q.category) params.set("category", q.category);
    if (q.kind) params.set("kind", q.kind);
    if (q.status) params.set("status", q.status);
    if (q.q) params.set("q", q.q);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return req<{ items: MenuItem[] }>(`/api/menu${suffix}`);
  },
  menuGet: (id: string) => req<{ item: MenuItem }>(`/api/menu/${id}`),
  menuCreate: (input: MenuInput) =>
    req<{ item: MenuItem }>("/api/menu", { method: "POST", body: JSON.stringify(input) }, true),
  menuUpdate: (id: string, patch: MenuPatch) =>
    req<{ item: MenuItem }>(`/api/menu/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  menuArchive: (id: string) => req<{ item: MenuItem }>(`/api/menu/${id}/archive`, { method: "POST" }, true),
  menuRestore: (id: string) => req<{ item: MenuItem }>(`/api/menu/${id}/restore`, { method: "POST" }, true),
  menuAudit: () => req<{ items: AuditItem[] }>("/api/audit/menu?limit=100"),
  // Ticket 05: คำสั่งซื้อ (ยืนยันตะกร้า public; ติดตามของฉัน/Guest lookup; จัดการหลังร้าน Owner/Admin)
  orderCreate: (body: CreateOrderRequest) =>
    req<{ order: OrderDetail; deduplicated: boolean }>(
      "/api/orders",
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  myOrders: (limit = 50) => req<{ orders: OrderDetail[] }>(`/api/orders/mine?limit=${limit}`),
  orderLookup: (number: string, phone: string) =>
    req<{ order: OrderDetail }>(`/api/orders/lookup?number=${encodeURIComponent(number)}&phone=${encodeURIComponent(phone)}`),
  orderGet: (id: string, phone?: string) =>
    req<{ order: OrderDetail }>(`/api/orders/${id}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`),
  ordersList: (q = "", status?: OrderStatus, limit = 50) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("limit", String(limit));
    return req<{ orders: OrderDetail[] }>(`/api/orders?${params.toString()}`);
  },
  orderSetStatus: (id: string, status: OrderStatus, reason: string) =>
    req<{ order: OrderDetail }>(
      `/api/orders/${id}/status`,
      { method: "PATCH", body: JSON.stringify({ status, reason }) },
      true,
    ),
  orderAudit: () => req<{ items: AuditItem[] }>("/api/audit/orders?limit=100"),
  // Ticket 07: ตัดสต๊อกจริงเมื่อเริ่มทำ (พนักงานหลังร้าน; เรียกซ้ำเป็น no-op)
  orderConsume: (id: string) =>
    req<{ order: OrderDetail; deduplicated: boolean }>(`/api/orders/${id}/consume`, { method: "POST", body: JSON.stringify({}) }, true),
  // Ticket 07: กลุ่มตัวเลือก + ตัวเลือกของเมนู (หลังร้าน Owner/Admin)
  menuOptionGroups: (menuId: string) =>
    req<{ groups: MenuOptionGroupDetail[] }>(`/api/menu/${menuId}/option-groups`),
  menuOptionGroupCreate: (menuId: string, body: { name: string; sortOrder?: number }) =>
    req<{ group: MenuOptionGroup }>(`/api/menu/${menuId}/option-groups`, { method: "POST", body: JSON.stringify(body) }, true),
  menuOptionGroupUpdate: (groupId: string, patch: { name?: string; sortOrder?: number }) =>
    req<{ group: MenuOptionGroup }>(
      `/api/menu/option-groups/${groupId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
      true,
    ),
  menuOptionCreate: (groupId: string, body: { name: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }) =>
    req<{ option: MenuOption }>(
      `/api/menu/option-groups/${groupId}/options`,
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  menuOptionUpdate: (optionId: string, patch: { name?: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }) =>
    req<{ option: MenuOption }>(
      `/api/menu/options/${optionId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
      true,
    ),
  // Ticket 07: วัตถุดิบ/สต๊อก/สูตร/ledger (หลังร้าน Owner/Admin)
  ingredients: (includeDisabled = false) =>
    req<{ items: Ingredient[] }>(`/api/inventory/ingredients${includeDisabled ? "?includeDisabled=1" : ""}`),
  ingredientGet: (id: string) =>
    req<{ item: Ingredient }>(`/api/inventory/ingredients/${id}`),
  ingredientCreate: (body: { name: string; unit: string; reorderThreshold?: number; latestCost?: number; initialOnHand?: number }) =>
    req<{ item: Ingredient }>("/api/inventory/ingredients", { method: "POST", body: JSON.stringify(body) }, true),
  ingredientUpdate: (id: string, patch: { name?: string; reorderThreshold?: number; latestCost?: number; isEnabled?: boolean }) =>
    req<{ item: Ingredient }>(`/api/inventory/ingredients/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  stockMove: (id: string, body: { op: ManualStockOp; qty: number; reason: string; reference?: string | null }) =>
    req<{ ingredient: Ingredient; entry: StockLedgerEntry }>(
      `/api/inventory/ingredients/${id}/stock`,
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  stockLedger: (q: { ingredientId?: string; orderId?: string; op?: StockOp; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.ingredientId) params.set("ingredientId", q.ingredientId);
    if (q.orderId) params.set("orderId", q.orderId);
    if (q.op) params.set("op", q.op);
    params.set("limit", String(q.limit ?? 50));
    return req<{ entries: StockLedgerEntry[] }>(`/api/inventory/ledger?${params.toString()}`);
  },
  recipeCreate: (body: { targetType: "menu" | "option"; targetId: string; lines: RecipeLine[] }) =>
    req<{ recipe: Recipe }>("/api/inventory/recipes", { method: "POST", body: JSON.stringify(body) }, true),
  recipes: (targetType: "menu" | "option", targetId: string) =>
    req<{ recipes: Recipe[] }>(
      `/api/inventory/recipes?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
    ),
  recipeLatest: (targetType: "menu" | "option", targetId: string) =>
    req<{ recipe: Recipe }>(
      `/api/inventory/recipes/latest?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
    ),
  inventoryAudit: () => req<{ items: AuditItem[] }>("/api/audit/inventory?limit=100"),
  // Ticket 06: การจอง (ลูกค้า) + เช็กอิน/รอบโต๊ะ + จัดการหลังร้าน (Owner/Admin)
  reservationRecommend: (partySize: number, reservedAt: string) =>
    req<{ table: RecommendedTable | null }>(
      `/api/reservations/recommend?partySize=${partySize}&reservedAt=${encodeURIComponent(reservedAt)}`,
    ),
  reservationAvailability: (partySize: number, reservedAt: string) =>
    req<{ tables: TableAvailability[]; recommendedTableId: string | null }>(
      `/api/reservations/availability?partySize=${partySize}&reservedAt=${encodeURIComponent(reservedAt)}`,
    ),
  reservationCreate: (body: { tableId?: string | null; partySize: number; reservedAt: string; note?: string | null; idempotencyKey: string }) =>
    req<{ reservation: ReservationDetail; deduplicated: boolean }>(
      "/api/reservations",
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  myReservations: (limit = 50) => req<{ reservations: ReservationDetail[] }>(`/api/reservations/mine?limit=${limit}`),
  myReservationGet: (id: string) => req<{ reservation: ReservationDetail }>(`/api/reservations/mine/${id}`),
  reservationCancel: (id: string, reason?: string) =>
    req<{ reservation: ReservationDetail }>(
      `/api/reservations/mine/${id}/cancel`,
      { method: "POST", body: JSON.stringify(reason ? { reason } : {}) },
      true,
    ),
  checkin: (body: { code?: string; phone?: string; reservationId?: string; qr?: string; partySize: number; tableId?: string }) =>
    req<{ reservation: ReservationDetail; round: TableRoundDetail }>(
      "/api/checkin",
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  roundsList: (status?: TableRoundStatus, tableId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (tableId) params.set("tableId", tableId);
    params.set("limit", String(limit));
    return req<{ rounds: TableRoundDetail[] }>(`/api/rounds?${params.toString()}`);
  },
  roundClose: (id: string) =>
    req<{ round: TableRoundDetail }>(`/api/rounds/${id}/close`, { method: "POST", body: JSON.stringify({}) }, true),
  adminReservations: (q = "", status?: ReservationStatus, limit = 50) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("limit", String(limit));
    return req<{ reservations: ReservationDetail[] }>(`/api/admin/reservations?${params.toString()}`);
  },
  adminReservationSetStatus: (id: string, status: ReservationStatus, reason: string) =>
    req<{ reservation: ReservationDetail }>(
      `/api/admin/reservations/${id}/status`,
      { method: "PATCH", body: JSON.stringify({ status, reason }) },
      true,
    ),
  reservationAudit: () => req<{ items: AuditItem[] }>("/api/audit/reservations?limit=100"),
  shopTableRounds: () => req<{ rounds: PublicTableRound[] }>("/api/shop/table-rounds"),
  // Ticket 08: ชำระเงิน (สร้าง intent public; ยืนยันเงินสด/ตัดสิน/หมดอายุ/คืนเงินหลังร้าน)
  paymentCreate: (body: { orderId: string; method: PaymentMethod; idempotencyKey: string; receivedAmount?: number | null; slipRef?: string | null; phone?: string }) =>
    req<{ payment: Payment; qrPayload: string | null; deduplicated: boolean }>(
      `/api/payments${body.phone ? `?phone=${encodeURIComponent(body.phone)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(
          body.receivedAmount !== undefined && body.receivedAmount !== null
            ? { orderId: body.orderId, method: body.method, idempotencyKey: body.idempotencyKey, receivedAmount: body.receivedAmount, slipRef: body.slipRef ?? undefined, phone: body.phone ?? undefined }
            : { orderId: body.orderId, method: body.method, idempotencyKey: body.idempotencyKey, slipRef: body.slipRef ?? undefined, phone: body.phone ?? undefined },
        ),
      },
      true,
    ),
  orderPayment: (orderId: string, phone?: string) =>
    req<{ payment: Payment | null; paymentState: OrderPaymentState }>(
      `/api/orders/${orderId}/payment${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
    ),
  paymentGet: (id: string, phone?: string) =>
    req<{ payment: Payment; receipt: Receipt | null }>(
      `/api/payments/${id}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
    ),
  paymentConfirmCash: (id: string, receivedAmount: number, reason?: string) =>
    req<{ payment: Payment; receipt: Receipt; deduplicated: boolean }>(
      `/api/payments/${id}/confirm-cash`,
      { method: "POST", body: JSON.stringify(reason ? { receivedAmount, reason } : { receivedAmount }) },
      true,
    ),
  paymentSlip: (id: string, slipRef: string, phone?: string) =>
    req<{ payment: Payment; receipt: Receipt | null; deduplicated: boolean }>(
      `/api/payments/${id}/slip${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
      { method: "POST", body: JSON.stringify(phone ? { slipRef, phone } : { slipRef }) },
      true,
    ),
  paymentResolve: (id: string, decision: "paid" | "failed" | "cancelled", reason: string) =>
    req<{ payment: Payment; receipt: Receipt | null }>(
      `/api/payments/${id}/resolve`,
      { method: "POST", body: JSON.stringify({ decision, reason }) },
      true,
    ),
  paymentExpire: (id: string) =>
    req<{ payment: Payment; deduplicated: boolean }>(
      `/api/payments/${id}/expire`,
      { method: "POST", body: JSON.stringify({}) },
      true,
    ),
  paymentRefund: (id: string, reason: string) =>
    req<{ payment: Payment; refund: Refund }>(
      `/api/payments/${id}/refund`,
      { method: "POST", body: JSON.stringify({ reason }) },
      true,
    ),
  paymentsList: (q = "", status?: PaymentStatus, method?: PaymentMethod, limit = 50) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (method) params.set("method", method);
    params.set("limit", String(limit));
    return req<{ payments: Payment[] }>(`/api/payments?${params.toString()}`);
  },
  receiptByPayment: (paymentId: string, phone?: string) =>
    req<{ receipt: Receipt }>(
      `/api/receipts/by-payment/${paymentId}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
    ),
  receiptsList: (q = "", date?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (date) params.set("date", date);
    params.set("limit", String(limit));
    return req<{ receipts: Receipt[] }>(`/api/receipts?${params.toString()}`);
  },
  refundsList: (limit = 50) => req<{ refunds: Refund[] }>(`/api/refunds?limit=${limit}`),
  paymentAudit: () => req<{ items: AuditItem[] }>("/api/audit/payments?limit=100"),
  // Ticket 09: คิวครัว/เครื่องดื่ม (พนักงานหลังร้าน) + ติดตามของลูกค้า
  queueList: (q: { station?: QueueStation; status?: QueueStatus; orderId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.station) params.set("station", q.station);
    if (q.status) params.set("status", q.status);
    if (q.orderId) params.set("orderId", q.orderId);
    params.set("limit", String(q.limit ?? 50));
    return req<{ jobs: QueueJob[] }>(`/api/queue?${params.toString()}`);
  },
  queueOrder: (orderId: string, phone?: string) =>
    req<{ jobs: QueueJob[]; orderNumber: string }>(
      `/api/queue/order/${orderId}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
    ),
  queueEnsure: (paymentId: string) =>
    req<{ jobs: QueueJob[]; deduplicated: boolean }>(
      "/api/queue/ensure",
      { method: "POST", body: JSON.stringify({ paymentId }) },
      true,
    ),
  queueClaim: (id: string) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/claim`, { method: "POST", body: JSON.stringify({}) }, true),
  queueStart: (id: string) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/start`, { method: "POST", body: JSON.stringify({}) }, true),
  queueReady: (id: string, qty: number) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/ready`, { method: "POST", body: JSON.stringify({ qty }) }, true),
  queueDeliver: (id: string, qty: number) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/deliver`, { method: "POST", body: JSON.stringify({ qty }) }, true),
  queuePriority: (id: string, reason: string) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/priority`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  queueRemake: (id: string, reason: string, quantity?: number) =>
    req<{ job: QueueJob }>(
      `/api/queue/${id}/remake`,
      { method: "POST", body: JSON.stringify(quantity ? { reason, quantity } : { reason }) },
      true,
    ),
  queueCancel: (id: string, reason: string) =>
    req<{ job: QueueJob }>(`/api/queue/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  queueCapacities: () => req<{ capacities: StationCapacity[] }>("/api/queue/capacity"),
  queueSetCapacity: (station: QueueStation, perSlot: number) =>
    req<{ capacity: StationCapacity }>(
      "/api/queue/capacity",
      { method: "PUT", body: JSON.stringify({ station, perSlot }) },
      true,
    ),
  queueSlots: (station: QueueStation, date: string) =>
    req<{ slots: QueueSlot[] }>(`/api/queue/slots?station=${station}&date=${encodeURIComponent(date)}`),
  queueNextSlot: (station: QueueStation, after: string) =>
    req<{ slot: QueueSlot | null }>(
      `/api/queue/slots/next?station=${station}&after=${encodeURIComponent(after)}`,
    ),
  queueAudit: () => req<{ items: AuditItem[] }>("/api/audit/queue?limit=100"),
  // Ticket 10: คะแนนสะสมและรางวัล
  // ฝั่งลูกค้า (session ลูกค้า csid) — ไม่แตะ endpoint หลังร้าน
  loyaltyBalance: () => req<{ balance: number }>("/api/loyalty/balance"),
  loyaltyLedger: (limit = 50) =>
    req<{ entries: LoyaltyTransaction[]; balance: number }>(`/api/loyalty/ledger?limit=${limit}`),
  rewardsRedeemable: () => req<{ rewards: Reward[] }>("/api/rewards/redeemable"),
  rewardRedeem: (id: string, idempotencyKey: string, reason?: string) =>
    req<{ redemption: RewardRedemption; deduplicated: boolean }>(
      `/api/rewards/${id}/redeem`,
      { method: "POST", body: JSON.stringify(reason ? { idempotencyKey, reason } : { idempotencyKey }) },
      true,
    ),
  myRedemptions: (limit = 50) => req<{ redemptions: RewardRedemption[] }>(`/api/loyalty/redemptions/mine?limit=${limit}`),
  redemptionReleaseMine: (id: string, reason: string) =>
    req<{ redemption: RewardRedemption; deduplicated: boolean }>(
      `/api/redemptions/${id}/release`,
      { method: "POST", body: JSON.stringify({ reason }) },
      true,
    ),
  walkinScan: (code: string) =>
    req<{ token: WalkinQrToken; earned: boolean }>(
      "/api/loyalty/walkin/scan",
      { method: "POST", body: JSON.stringify({ code }) },
      true,
    ),
  guestLink: (orderId: string) =>
    req<{ order: OrderDetail; earned: boolean }>(
      "/api/loyalty/guest/link",
      { method: "POST", body: JSON.stringify({ orderId }) },
      true,
    ),
  // ฝั่งหลังร้าน (session พนักงาน sid) — ไม่แตะ endpoint ลูกค้า
  rewardsList: () => req<{ rewards: Reward[] }>("/api/rewards"),
  rewardCreate: (input: RewardInput) =>
    req<{ reward: Reward }>("/api/rewards", { method: "POST", body: JSON.stringify(input) }, true),
  rewardUpdate: (id: string, patch: RewardPatch) =>
    req<{ reward: Reward }>(`/api/rewards/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  pendingRedemptions: (limit = 50) =>
    req<{ redemptions: RewardRedemption[] }>(`/api/redemptions/pending?limit=${limit}`),
  redemptionConsume: (id: string) =>
    req<{ redemption: RewardRedemption; job: QueueJob }>(
      `/api/redemptions/${id}/consume`,
      { method: "POST", body: JSON.stringify({}) },
      true,
    ),
  redemptionRelease: (id: string, reason: string) =>
    req<{ redemption: RewardRedemption; deduplicated: boolean }>(
      `/api/redemptions/${id}/release`,
      { method: "POST", body: JSON.stringify({ reason }) },
      true,
    ),
  walkinIssue: () =>
    req<{ token: WalkinQrToken }>(
      "/api/loyalty/walkin/issue",
      { method: "POST", body: JSON.stringify({}) },
      true,
    ),
  loyaltyMerge: (sourceCustomerId: string, targetCustomerId: string) =>
    req<{ record: { id: string }; movedPoints: number; deduplicated: boolean }>(
      "/api/loyalty/merge",
      { method: "POST", body: JSON.stringify({ sourceCustomerId, targetCustomerId }) },
      true,
    ),
  loyaltyReverse: (orderId: string, refundId: string) =>
    req<{ reversal: { id: string; points: number }; deduplicated: boolean }>(
      "/api/loyalty/reverse",
      { method: "POST", body: JSON.stringify({ orderId, refundId }) },
      true,
    ),
  loyaltyAudit: () => req<{ items: AuditItem[] }>("/api/audit/loyalty?limit=100"),
  // Ticket 11: การเงิน รายงาน Dashboard และ CSV (Owner/Admin เท่านั้น)
  financeEntries: (q: { kind?: FinanceKind; category?: string; from?: string; to?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.kind) params.set("kind", q.kind);
    if (q.category) params.set("category", q.category);
    if (q.from) params.set("from", q.from);
    if (q.to) params.set("to", q.to);
    params.set("limit", String(q.limit ?? 50));
    return req<{ entries: FinanceEntry[] }>(`/api/finance/entries?${params.toString()}`);
  },
  financeEntryCreate: (body: { kind: FinanceKind; category: string; amount: number; occurredAt: string; note?: string | null; reason: string }) =>
    req<{ entry: FinanceEntry }>("/api/finance/entries", { method: "POST", body: JSON.stringify(body) }, true),
  financeEntryUpdate: (id: string, body: { category?: string; amount?: number; occurredAt?: string; note?: string | null; reason: string }) =>
    req<{ entry: FinanceEntry }>(`/api/finance/entries/${id}`, { method: "PATCH", body: JSON.stringify(body) }, true),
  financeEntryDelete: (id: string, reason: string) =>
    req<{ ok: boolean; message: string }>(`/api/finance/entries/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }, true),
  financeReport: (q: { granularity?: FinanceGranularity; from: string; to: string }) => {
    const params = new URLSearchParams();
    if (q.granularity) params.set("granularity", q.granularity);
    params.set("from", q.from);
    params.set("to", q.to);
    return req<{ report: FinanceReport }>(`/api/finance/reports?${params.toString()}`);
  },
  financeDashboard: (date?: string) =>
    req<{ dashboard: FinanceDashboard }>(`/api/finance/dashboard${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  financeTopMenus: (from: string, to: string, limit = 10) =>
    req<{ items: FinanceTopMenu[] }>(
      `/api/finance/analytics/top-menus?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${limit}`,
    ),
  financePeakHours: (from: string, to: string) =>
    req<{ hours: FinancePeakHour[] }>(
      `/api/finance/analytics/peak-hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  financeExportUrl: (kind: FinanceCsvKind, from: string, to: string) =>
    `/api/finance/export?kind=${kind}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  financeAudit: () => req<{ items: AuditItem[] }>("/api/audit/finance?limit=100"),
  // Ticket 12: LINE notifications outbox + web fallback
  notificationsList: (q: { status?: NotificationStatus; kind?: NotificationKind; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.status) params.set("status", q.status);
    if (q.kind) params.set("kind", q.kind);
    params.set("limit", String(q.limit ?? 50));
    return req<{ items: NotificationItem[]; kindLabels: Record<string, string>; statusLabels: Record<string, string> }>(
      `/api/notifications?${params.toString()}`,
    );
  },
  notificationRetry: (id: string, reason?: string) =>
    req<{ notification: NotificationItem; message: string }>(
      `/api/notifications/${id}/retry`,
      { method: "POST", body: JSON.stringify(reason ? { reason } : {}) },
      true,
    ),
  notificationsRunOutbox: (limit = 50) =>
    req<{ result: NotificationFlushResult; message: string }>(
      "/api/notifications/run-outbox",
      { method: "POST", body: JSON.stringify({ limit }) },
      true,
    ),
  notificationsRunReminders: () =>
    req<{ result: NotificationReminderResult; message: string }>(
      "/api/notifications/run-reminders",
      { method: "POST", body: JSON.stringify({}) },
      true,
    ),
  notificationConsentGet: (customerId: string) =>
    req<{ customerId: string; enabled: boolean }>(`/api/notification-consents/${customerId}`),
  notificationConsentSet: (customerId: string, enabled: boolean) =>
    req<{ customerId: string; enabled: boolean; message: string }>(
      "/api/notification-consents",
      { method: "POST", body: JSON.stringify({ customerId, enabled }) },
      true,
    ),
  notificationAudit: () => req<{ items: AuditItem[] }>("/api/audit/notifications?limit=100"),
  // ฝั่งลูกค้า: web fallback — อ่านข้อความของตนเองในเว็บ + เปิด/ปิดรับแจ้งเตือน
  myNotifications: (limit = 50) =>
    req<{
      items: NotificationItem[];
      consentEnabled: boolean;
      lineLinked: boolean;
      kindLabels: Record<string, string>;
      statusLabels: Record<string, string>;
    }>(`/api/notifications/mine/list?limit=${limit}`),
  myNotificationConsent: (enabled: boolean) =>
    req<{ enabled: boolean; message: string }>(
      "/api/notifications/mine/consent",
      { method: "PATCH", body: JSON.stringify({ enabled }) },
      true,
    ),
  // Ticket 13: Capacity + พยากรณ์เวลารอ
  capacityOverview: (station?: QueueStation) =>
    req<{ overview: CapacityOverview; sourceLabels: Record<string, string>; nonGuarantee: string }>(
      `/api/capacity/overview${station ? `?station=${station}` : ""}`,
    ),
  capacityWaitOrder: (orderId: string, partySize = 2, phone?: string) => {
    const params = new URLSearchParams({ orderId, partySize: String(partySize) });
    if (phone) params.set("phone", phone);
    return req<{ estimate: WaitEstimate; featureId: string; sourceLabels: Record<string, string> }>(
      `/api/capacity/wait?${params.toString()}`,
    );
  },
  capacityWaitStation: (station: QueueStation, partySize = 2) =>
    req<{ estimate: WaitEstimate; featureId: string; sourceLabels: Record<string, string> }>(
      `/api/capacity/wait?station=${station}&partySize=${partySize}`,
    ),
  preorderCheck: (body: { station: QueueStation; scheduledAt: string; partySize?: number }) =>
    req<{ check: PreorderSlotCheck; nonGuarantee: string }>(
      "/api/capacity/preorder-check",
      { method: "POST", body: JSON.stringify(body) },
      true,
    ),
  predictionModelGet: () =>
    req<{ model: PredictionModel; sourceLabels: Record<string, string> }>("/api/predictions/model"),
  predictionModelSet: (patch: { version?: string; kind?: "baseline" | "external"; enabled?: boolean; thresholdMinutes?: number; timeoutMs?: number }) =>
    req<{ model: PredictionModel }>(
      "/api/predictions/model",
      { method: "PUT", body: JSON.stringify(patch) },
      true,
    ),
  predictionAccuracy: () =>
    req<{ accuracy: PredictionAccuracy; sourceLabels: Record<string, string> }>("/api/predictions/accuracy"),
  predictionEvaluate: () =>
    req<{ accuracy: PredictionAccuracy }>("/api/predictions/evaluate", { method: "POST", body: JSON.stringify({}) }, true),
  predictionFeatures: (limit = 50) =>
    req<{ features: PredictionFeature[] }>(`/api/predictions/features?limit=${limit}`),
  predictionComplete: (id: string, actualMin: number) =>
    req<{ feature: PredictionFeature; deduplicated: boolean }>(
      `/api/predictions/features/${id}/complete`,
      { method: "POST", body: JSON.stringify({ actualMin }) },
      true,
    ),
  predictionAudit: () => req<{ items: AuditItem[] }>("/api/audit/predictions?limit=100"),
};
