import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConnection } from "mysql2/promise";
import type {
  AuditAction,
  AuditEntry,
  Customer,
  CustomerLineLink,
  CustomerSession,
  FinanceCategory,
  FinanceDashboard,
  FinanceEntry,
  FinanceGranularity,
  FinanceKind,
  FinanceOccupancy,
  FinancePeakHour,
  FinanceReport,
  FinanceReportBucket,
  FinanceTopMenu,
  Ingredient,
  LineLoginTx,
  ManualStockOp,
  Notification,
  NotificationKind,
  NotificationStatus,
  MenuItem,
  MenuOption,
  MenuOptionGroup,
  CapacityOverview,
  Order,
  OrderDetail,
  OrderItem,
  OrderItemOptionSnapshot,
  OrderPaymentState,
  OrderServiceType,
  OrderStatus,
  PredictionAccuracy,
  PredictionFeature,
  PredictionModel,
  PreorderSlotCheck,
  WaitEstimate,
  Payment,
  PaymentEvent,
  PaymentMethod,
  PaymentStatus,
  PublicMenuItemWithOptions,
  PublicMenuOptionGroup,
  QueueJobDetail,
  QueueSlot,
  QueueStatus,
  Receipt,
  Recipe,
  RecipeLine,
  RecipeTargetType,
  Refund,
  Reservation,
  ReservationDetail,
  ReservationStatus,
  Role,
  Session,
  ShopTable,
  StationCapacity,
  StockLedgerEntry,
  StockOp,
  TableRound,
  TableRoundDetail,
  TableRoundStatus,
  User,
} from "./types.js";
import { ConflictError, NotFoundError, RESERVATION_STATUSES } from "./types.js";
import {
  DEFAULT_SHOP_NAME,
  defaultWeeklySchedule,
  normalizeWeeklySchedule,
  WEEKDAY_KEYS,
  type ShopOverride,
  type WeeklySchedule,
} from "./shop/schedule.js";
import {
  customerActivatedEvent,
  customerDeactivatedEvent,
  customerDeletedEvent,
  customerLineLinkedEvent,
  customerLineLinkFailedEvent,
  customerLineLinkStartedEvent,
  customerLineUnlinkedEvent,
  customerLoginSuccessEvent,
  customerLogoutEvent,
  customerPasswordChangedEvent,
  customerProfileUpdatedEvent,
  customerRegisteredEvent,
  type CustomerActor,
} from "./customer/audit-events.js";
import {
  shopNameUpdatedEvent,
  shopOverrideClearedEvent,
  shopOverrideSetEvent,
  shopScheduleUpdatedEvent,
  shopTableCreatedEvent,
  shopTableUpdatedEvent,
} from "./shop/audit-events.js";
import {
  menuArchivedEvent,
  menuCreatedEvent,
  menuRestoredEvent,
  menuStatusChangedEvent,
  menuUpdatedEvent,
} from "./menu/audit-events.js";
import {
  compareMenuCategory,
  normalizeMenuInput,
  type MenuInput,
} from "./menu/validation.js";
import type { MenuKind, MenuStatus } from "./types.js";
import {
  assertNormalizedPhone,
  assertOrderStatusTransition,
  generateOrderNumber,
  normalizeGuestName,
  normalizeIdempotencyKey,
  normalizeOrderLines,
  normalizeOrderNote,
  normalizeQuantity,
  normalizeScheduledAt,
  normalizeServiceType,
  normalizeStatusReason,
  orderPayloadHash,
  orderPayloadHashWithoutOptions,
  roundBaht,
  type NormalizedOrderLine,
} from "./orders/validation.js";
import { orderCreatedEvent, orderStatusChangedEvent } from "./orders/audit-events.js";
import {
  assertCancellable,
  assertReservationStatusTransition,
  generateReservationCode,
  isReservationOverlapping,
  normalizePartySize,
  normalizeReservationIdempotencyKey,
  normalizeReservationNote,
  normalizeReservationReason,
  normalizeReservationStatus,
  normalizeReservedAt,
  normalizeTableId,
  recommendTable,
  reservationPayloadHash,
  RESERVATION_SLOT_MINUTES,
} from "./reservations/validation.js";import {
  reservationCancelledEvent,
  reservationCheckedInEvent,
  reservationCreatedEvent,
  reservationStatusChangedEvent,
  tableRoundClosedEvent,
  tableRoundOpenedEvent,
} from "./reservations/audit-events.js";
import {
  assertAvailableStock,
  normalizeEnabled,
  normalizeIngredientName,
  normalizeIngredientUnit,
  normalizeLatestCost,
  normalizeManualStockOp,
  normalizeMovementQty,
  normalizeOptionGroupName,
  normalizeOptionName,
  normalizeOptionSortOrder,
  normalizePriceDelta,
  normalizeRecipeLines,
  normalizeReorderThreshold,
  normalizeSelectedOptionIds,
  normalizeSpecialRequest,
  normalizeStockQty,
  normalizeStockReason,
  normalizeStockReference,
  normalizeTargetId,
  roundStock,
} from "./inventory/validation.js";
import {
  ingredientCreatedEvent,
  ingredientStatusChangedEvent,
  ingredientUpdatedEvent,
  optionCreatedEvent,
  optionGroupCreatedEvent,
  optionGroupUpdatedEvent,
  optionStatusChangedEvent,
  optionUpdatedEvent,
  orderStockConsumedEvent,
  orderStockReleasedEvent,
  orderStockReservedEvent,
  recipeCreatedEvent,
  stockUpdatedEvent,
} from "./inventory/audit-events.js";
import {
  assertCashTendered,
  assertPaymentTransition,
  generateReceiptNumber,
  normalizePaymentIdempotencyKey,
  normalizePaymentMethod,
  normalizePaymentReason,
  normalizeProviderEventId,
  normalizeProviderOutcome,
  outcomeToStatus,
  paymentPayloadHash,
  type ProviderOutcome,
} from "./payments/validation.js";
import {
  paymentCreatedEvent,
  paymentRefundApprovedEvent,
  paymentStatusChangedEvent,
} from "./payments/audit-events.js";
import {
  queueCapacityUpdatedEvent,
  queueCreatedEvent,
  queuePriorityEvent,
  queueRemadeEvent,
  queueStatusChangedEvent,
} from "./queue/audit-events.js";
import {
  assertQueueTransition,
  classifyStation,
  compareQueueJobs,
  computeReadyAt,
  normalizeCapacityPerSlot,
  normalizeQueueQty,
  normalizeQueueReason,
  normalizeQueueStatus,
  normalizeStation,
  slotStartOf,
} from "./queue/validation.js";
import { FakePromptPayProvider, isFakePaymentMode } from "./payments/provider.js";
import {
  GUEST_LINK_WINDOW_HOURS,
  LOYALTY_POINTS_PER_DRINK_UNIT,
  PAYMENT_PROMPTPAY_TTL_MINUTES,
  WALKIN_QR_TTL_MINUTES,
} from "./types.js";
import { normalizeThaiPhone } from "./customer/phone.js";
import { ingredientAvailable, isMenuSellable, STOCK_OPS } from "./types.js";
import {
  PREDICTION_BASELINE_VERSION,
  PREDICTION_DEFAULT_THRESHOLD_MINUTES,
  PREDICTION_DEFAULT_TIMEOUT_MS,
  PREDICTION_NON_GUARANTEE,
  PREDICTION_RANGE_PLUS_MINUTES,
  QUEUE_DEFAULT_CAPACITY_PER_SLOT,
  QUEUE_SLOT_MINUTES,
  type CapacityStationSummary,
  type CustomerMergeRecord,
  type PredictionSource,
  type WaitStationBreakdown,
  type GuestLinkClaim,
  type LoyaltyReversal,
  type LoyaltySource,
  type LoyaltyTransaction,
  type QueueJob,
  type QueueStation,
  type RedemptionStatus,
  type Reward,
  type RewardRedemption,
  type WalkinQrToken,
} from "./types.js";
import {
  accountMergedEvent,
  guestLinkedEvent,
  loyaltyEarnedEvent,
  pointsReversedEvent,
  redemptionConsumedEvent,
  redemptionReleasedEvent,
  redemptionReservedEvent,
  rewardCreatedEvent,
  rewardStatusChangedEvent,
  rewardUpdatedEvent,
  walkinIssuedEvent,
  walkinRedeemedEvent,
} from "./loyalty/audit-events.js";
import {
  bangkokHourParts,
  computeStationWaitMin,
  evaluateAccuracySamples,
  evaluateFixtureAccuracy,
  normalizeActualMinutes,
  normalizeModelVersion,
  normalizePredictionPartySize,
  normalizePredictionScheduledAt,
  normalizePredictionThreshold,
  normalizePredictionTimeoutMs,
  predictionSlotKey,
  waitRangeOf,
} from "./predict/validation.js";
import {
  predictionCompletedEvent,
  predictionEvaluatedEvent,
  predictionModelUpdatedEvent,
  predictionRequestedEvent,
} from "./predict/audit-events.js";
import {
  financeEntryCreatedEvent,
  financeEntryDeletedEvent,
  financeEntryUpdatedEvent,
} from "./finance/audit-events.js";
import {
  normalizeFinanceAmount,
  normalizeFinanceCategory,
  normalizeFinanceKind,
  normalizeFinanceNote,
  normalizeFinanceOccurredAt,
  normalizeFinanceReason,
} from "./finance/validation.js";
import {
  notificationDeadLetterEvent,
  notificationFailedEvent,
  notificationQueuedEvent,
  notificationRetriedEvent,
  notificationSentEvent,
  notificationSkippedEvent,
} from "./notify/audit-events.js";
import {
  computeNotificationBackoff,
  maxNotificationAttempts,
  normalizeNotificationEventKey,
  normalizeNotificationId,
  normalizeNotificationKind,
  normalizeNotificationMessage,
  sanitizeNotificationError,
} from "./notify/validation.js";
import {
  assertRedemptionTransition,
  buildWalkinCode,
  generateRedemptionCode,
  generateWalkinToken,
  normalizeLoyaltyIdempotencyKey,
  normalizeLoyaltyReason,
  normalizeRewardImageUrl,
  normalizeRewardName,
  normalizeRewardPointsCost,
  normalizeRewardQuotaTotal,
  normalizeWalkinCode,
  redemptionPayloadHash,
  rewardBlockReason,
} from "./loyalty/validation.js";

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  roles: Role[];
}

export type FirstOwnerResult =
  | { created: true; user: User }
  | { created: false; reason: "owner-exists" };

export interface AuditInput {
  actorId?: string | null;
  actorUsername?: string | null;
  action: AuditAction | string;
  targetId?: string | null;
  targetUsername?: string | null;
  detail?: string | null;
  ip?: string | null;
  success?: boolean;
}

export interface ShopOverrideInput {
  mode: "open" | "closed";
  reason?: string | null;
  expectedReopenAt?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
}

export interface CreateTableInput {
  name: string;
  capacity: number;
}

export interface UpdateTablePatch {
  name?: string;
  capacity?: number;
  isEnabled?: boolean;
}

/** ผู้กระทำสำหรับ audit ที่ผูกกับ mutation — state เปลี่ยนได้ต้องมี audit นี้เสมอ */
export interface ShopActor {
  actorId?: string | null;
  actorUsername?: string | null;
  ip?: string | null;
}

// ---------- Ticket 03: บัญชีลูกค้า ----------

export interface CreateCustomerInput {
  name: string;
  /** เบอร์ที่ normalize แล้ว (normalizeThaiPhone) */
  phone: string;
  /** อีเมลที่ normalize แล้ว หรือ null */
  email: string | null;
  passwordHash: string;
}

export interface CustomerProfilePatch {
  name?: string;
  /** ส่ง null เพื่อล้างอีเมล */
  email?: string | null;
}

export interface CreateLineTxInput {
  customerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectAfter: string | null;
  expiresAt: string;
}

export interface LinkLineIdentityInput {
  providerSubject: string;
  displayName?: string | null;
}

/** ชื่อนิรนามที่ใช้แทน PII ของบัญชีที่ลบแล้ว (คง id ภายในไว้) */
export const DELETED_CUSTOMER_NAME = "ลูกค้าที่ลบบัญชี";

/** snapshot คงเส้นคงวาชุดเดียวสำหรับ public status (อ่านจาก transaction เดียวฝั่ง MySQL) */
export interface ShopSnapshot {
  shopName: string;
  schedule: WeeklySchedule;
  override: ShopOverride | null;
  tables: ShopTable[];
}

/** snapshot เฉพาะ config (ไม่มี tables) — ผลลัพธ์ saveShopConfig ไม่แตะ table state */
export interface ShopConfigSnapshot {
  shopName: string;
  schedule: WeeklySchedule;
  override: ShopOverride | null;
}

export interface SaveShopConfigInput {
  shopName?: string;
  schedule: WeeklySchedule;
}

export interface SaveShopConfigResult extends ShopConfigSnapshot {
  nameChanged: boolean;
}

export interface Store {
  createUser(input: CreateUserInput): Promise<User>;
  /**
   * สร้าง Owner คนแรกแบบ atomic (กันแข่งกันสร้างซ้ำ)
   * คืน created:false เมื่อมี Owner อยู่แล้ว
   */
  createFirstOwner(input: CreateUserInput): Promise<FirstOwnerResult>;
  findByUsername(username: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUser(
    id: string,
    patch: { roles?: Role[]; isActive?: boolean },
  ): Promise<User>;
  setPassword(id: string, passwordHash: string): Promise<User>;
  countOwners(): Promise<number>;
  createSession(userId: string, passwordVersion: number): Promise<Session>;
  findSession(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  audit(input: AuditInput): Promise<void>;
  listAudit(
    prefix: "login_" | "account_" | "shop_" | "customer_" | "menu_" | "order_" | "reservation_" | "round_" | "inventory_" | "payment_" | "queue_" | "loyalty_" | "finance_" | "notification_" | "prediction_" | "all",
    limit: number,
  ): Promise<AuditEntry[]>;
  // ---- Ticket 02: สถานะร้านและโต๊ะ (อ่านเดี่ยว + mutation แบบ atomic พร้อม audit) ----
  getShopName(): Promise<string>;
  getSchedule(): Promise<WeeklySchedule>;
  getOverride(): Promise<ShopOverride | null>;
  listTables(): Promise<ShopTable[]>;
  /** อ่าน shopName/schedule/override/tables จาก snapshot คงเส้นคงวาชุดเดียว */
  getShopSnapshot(): Promise<ShopSnapshot>;
  /**
   * บันทึกชื่อร้าน (ถ้าเปลี่ยน) + ตารางทั้งสัปดาห์ + audit แบบ all-or-nothing
   * MySQL ใช้ transaction บน connection เดียว; memory rollback ทั้ง state และลำดับ audit
   */
  saveShopConfig(input: SaveShopConfigInput, actor: ShopActor): Promise<SaveShopConfigResult>;
  /** ตั้ง override + audit แบบ all-or-nothing */
  setShopOverride(input: ShopOverrideInput, actor: ShopActor): Promise<ShopOverride>;
  /** ล้าง override + audit แบบ all-or-nothing; คืน true เมื่อมี override ถูกเคลียร์ */
  clearShopOverride(actor: ShopActor): Promise<boolean>;
  /** สร้างโต๊ะ + audit แบบ all-or-nothing */
  createShopTable(input: CreateTableInput, actor: ShopActor): Promise<ShopTable>;
  /** แก้โต๊ะ + audit แบบ all-or-nothing */
  updateShopTable(id: string, patch: UpdateTablePatch, actor: ShopActor): Promise<ShopTable>;
  // ---- Ticket 03: บัญชีลูกค้า + เซสชัน + LINE (mutation เขียนพร้อม audit แบบ all-or-nothing) ----
  /** สมัครลูกค้า + audit แบบ all-or-nothing (เบอร์/อีเมลซ้ำ → ConflictError) */
  createCustomer(input: CreateCustomerInput, actor: CustomerActor): Promise<Customer>;
  findCustomerById(id: string): Promise<Customer | null>;
  findCustomerByPhone(phone: string): Promise<Customer | null>;
  /** ค้นหาด้วยชื่อ/เบอร์/อีเมล (LIKE) — คืนเฉพาะฟิลด์ที่ store เก็บ (route ตัดเป็น safe fields) */
  listCustomers(q: string, limit: number): Promise<Customer[]>;
  /** แก้ชื่อ/อีเมล + audit แบบ all-or-nothing */
  updateCustomerProfile(id: string, patch: CustomerProfilePatch, actor: CustomerActor): Promise<Customer>;
  /** เปลี่ยนรหัส + ล้างเซสชันทั้งหมด + audit แบบ all-or-nothing */
  setCustomerPassword(id: string, passwordHash: string, actor: CustomerActor): Promise<Customer>;
  /** ปิด/เปิดบัญชี + (ตอนปิด) ล้างเซสชันทั้งหมด + audit แบบ all-or-nothing */
  setCustomerActive(id: string, active: boolean, actor: CustomerActor): Promise<Customer>;
  /**
   * ลบบัญชี: ทำ PII เป็นนิรนาม (ชื่อ/เบอร์/อีเมล/hash) คง id ภายในไว้
   * + ล้างเซสชัน + ถอนการเชื่อม LINE + audit ทั้งหมดแบบ all-or-nothing
   */
  deleteCustomer(id: string, actor: CustomerActor): Promise<Customer>;
  createCustomerSession(customerId: string, passwordVersion: number): Promise<CustomerSession>;
  findCustomerSession(id: string): Promise<CustomerSession | null>;
  deleteCustomerSession(id: string): Promise<void>;
  deleteCustomerSessionsForCustomer(customerId: string): Promise<void>;
  createLineTx(input: CreateLineTxInput): Promise<void>;
  /**
   * consume state แบบ atomic ครั้งเดียว: คืน tx พร้อม mark used
   * คืน null เมื่อไม่พบ/ใช้แล้ว/หมดอายุ (ห้ามแลก code ต่อ)
   */
  consumeLineTx(state: string, now: Date): Promise<LineLoginTx | null>;
  /**
   * อ่าน tx แบบไม่ consume (ไม่ mark used) — pre-check ก่อนแลก code เท่านั้น
   * คืน null เมื่อไม่พบ/ใช้แล้ว/หมดอายุ; route ต้อง consume ผ่าน seam ที่มี audit
   * ของผลลัพธ์ (consumeLineTxWithAudit หรือ consume+link) หลังทราบผลเสมอ
   */
  peekLineTx(state: string, now: Date): Promise<LineLoginTx | null>;
  /**
   * consume state + เขียน audit customer_line_link_failed แบบ atomic ใน seam เดียว
   * คืน tx ที่ consume แล้ว; คืน null (ไม่เขียน audit/ไม่เปลี่ยน state)
   * เมื่อไม่พบ/ใช้แล้ว/หมดอายุ — audit ล้มเหลวต้อง rollback การ consume แล้วโยน error
   * (กัน consumed-แต่-no-audit; retry ได้เพราะ state ยังไม่ถูกใช้)
   * ห้ามส่ง code/token/secret/state/nonce/sub ผ่าน failureDetail เด็ดขาด
   */
  consumeLineTxWithAudit(
    state: string,
    now: Date,
    actor: CustomerActor,
    failureDetail: string,
  ): Promise<LineLoginTx | null>;
  /**
   * ผูก LINE identity + consume state + เขียน audit customer_line_linked แบบ atomic ใน seam เดียว
   * (success path ของ LINE callback — ตรงข้ามกับ consumeLineTxWithAudit ที่เป็น failure path)
   * คืน { link, tx } ที่ consume แล้ว; คืน null (ไม่เขียน audit/ไม่เปลี่ยน state)
   * เมื่อไม่พบ/ใช้แล้ว/หมดอายุ — audit ล้มเหลวหรือ link ขัดแย้งต้อง rollback ทั้ง
   * link/audit/consume แล้วโยน error (state ยังไม่ถูกใช้ → retry ได้)
   * ห้ามส่ง code/token/secret/state/nonce/sub ผ่าน actor/detail เด็ดขาด
   */
  linkLineIdentityWithConsume(
    state: string,
    now: Date,
    input: LinkLineIdentityInput,
    actor: CustomerActor,
  ): Promise<{ link: CustomerLineLink; tx: LineLoginTx } | null>;
  getLineLink(customerId: string): Promise<CustomerLineLink | null>;
  findLineLinkBySubject(provider: string, subject: string): Promise<CustomerLineLink | null>;
  /** ผูก LINE identity + audit แบบ all-or-nothing (ผูกซ้ำขัดแย้ง → ConflictError) */
  linkLineIdentity(customerId: string, input: LinkLineIdentityInput, actor: CustomerActor): Promise<CustomerLineLink>;
  /** ถอนการเชื่อม LINE + audit แบบ all-or-nothing (ไม่มีการเชื่อม → NotFoundError) */
  unlinkLineIdentity(customerId: string, actor: CustomerActor): Promise<void>;
  // ---- Ticket 03 P1: narrow atomic seams ที่ route ต้องใช้ (ห้ามแยกเรียกหลายขั้น) ----
  /**
   * สมัครสำเร็จแบบ atomic: customer + initial customer session + audit
   * (customer_registered + customer_login_success) ใน transaction/seam เดียว
   * ล้มเหลวตรงไหนต้อง rollback ทั้ง state/session/audit
   */
  registerCustomerWithSession(
    input: CreateCustomerInput,
    actor: CustomerActor,
  ): Promise<{ customer: Customer; session: CustomerSession }>;
  /**
   * login สำเร็จแบบ atomic: session + login audit ใน seam เดียว
   * ล้มเหลวต้องไม่เหลือ session ค้างโดยไม่มี audit (และกลับกัน)
   */
  createCustomerSessionWithAudit(
    customerId: string,
    passwordVersion: number,
    actor: CustomerActor,
  ): Promise<CustomerSession>;
  /**
   * ออกจากระบบแบบ atomic: ลบ customer session + audit (customer_logout) ใน seam เดียว
   * audit ล้มเหลว → session ต้องคงอยู่และไม่มี audit logout (และกลับกัน)
   * ลบแบบ idempotent ตาม sessionId ภายในขอบเขต customerId (กันลบ session ของบัญชีอื่น)
   */
  logoutCustomerSessionWithAudit(
    sessionId: string,
    customerId: string,
    actor: CustomerActor,
  ): Promise<void>;
  /**
   * เริ่มเชื่อม LINE แบบ atomic: line state tx + audit (customer_line_link_started)
   * ใน seam เดียว — ล้มเหลวต้องไม่มี tx ค้างโดยไม่มี audit (และกลับกัน)
   */
  createLineLoginTxWithAudit(input: CreateLineTxInput, actor: CustomerActor): Promise<void>;
  // ---- Ticket 04: แคตตาล็อกเมนู (mutation เขียนพร้อม audit แบบ all-or-nothing) ----
  /** รายการเมนูทั้งหมดสำหรับหลังร้าน (รวม archive ตาม flag) เรียงหมวด → ลำดับ → ชื่อ */
  listMenuItems(options?: { includeArchived?: boolean }): Promise<MenuItem[]>;
  /** เฉพาะเมนูพร้อมขาย (available + ไม่ archive) สำหรับหน้าสาธารณะ */
  listPublicMenuItems(): Promise<MenuItem[]>;
  getMenuItem(id: string): Promise<MenuItem | null>;
  /** สร้างเมนู + audit menu_created (ชื่อซ้ำในหมวดเดียวกัน → ConflictError) */
  createMenuItem(input: MenuInput, actor: ShopActor): Promise<MenuItem>;
  /** แก้เมนู + audit (เปลี่ยน status อย่างเดียว → menu_status_changed, อื่น ๆ → menu_updated) */
  updateMenuItem(id: string, patch: MenuPatch, actor: ShopActor): Promise<MenuItem>;
  /** archive (ซ่อนจากหน้าขาย คงประวัติ) + audit menu_archived */
  archiveMenuItem(id: string, actor: ShopActor): Promise<MenuItem>;
  /** นำกลับจาก archive + audit menu_restored */
  restoreMenuItem(id: string, actor: ShopActor): Promise<MenuItem>;
  // ---- Ticket 05: คำสั่งซื้อพื้นฐาน (snapshot ราคา + idempotency + audit แบบ all-or-nothing) ----
  /**
   * สร้างคำสั่งซื้อจากตะกร้า:
   * - ตรวจราคา/สถานะเมนูอีกครั้ง (เฉพาะพร้อมขาย) แล้ว snapshot ชื่อ+ราคาต่อยูนิต
   * - idempotency: key เดิม + payload เดิม → คืนคำสั่งซื้อเดิม (ไม่สร้างซ้ำ ไม่เขียน audit ซ้ำ);
   *   key เดิม + payload ต่างกัน → ConflictError
   * - Guest ต้องมีชื่อ+เบอร์ (normalize ด้วยกฎ Ticket 03); สมาชิกต้องมีตัวตนใช้งานได้
   */
  createOrder(input: CreateOrderInput, actor: ShopActor, now?: Date): Promise<{ order: OrderDetail; deduplicated: boolean }>;
  getOrder(id: string): Promise<OrderDetail | null>;
  getOrderByNumber(orderNumber: string): Promise<OrderDetail | null>;
  findOrderByIdempotencyKey(key: string): Promise<OrderDetail | null>;
  /** คำสั่งซื้อของสมาชิกคนเดียว (เรียงใหม่สุดก่อน) */
  listCustomerOrders(customerId: string, limit?: number): Promise<OrderDetail[]>;
  /** ค้นหาหลังร้าน: เลขคำสั่งซื้อ/ชื่อ/เบอร์ (LIKE) + กรองสถานะ */
  listOrders(filter: ListOrdersFilter): Promise<OrderDetail[]>;
  /**
   * เปลี่ยนสถานะ (Owner/Admin เท่านั้น — route เป็นผู้ตรวจสิทธิ์):
   * pending_payment → completed/cancelled พร้อมเหตุผล + audit ก่อน/หลัง แบบ all-or-nothing
   */
  updateOrderStatus(id: string, patch: { status: OrderStatus; reason: string }, actor: ShopActor): Promise<OrderDetail>;
  // ---- Ticket 06: การจองโต๊ะและรอบการใช้โต๊ะ ----
  /**
   * สร้างการจอง (ลูกค้าที่ login แล้ว):
   * - ตรวจเวลานัด (ล่วงหน้า 60 นาที – 3 วัน), โต๊ะพร้อมใช้งาน + ความจุพอ,
   *   ไม่ทับซ้อนกับการจอง active (pending/confirmed) บนโต๊ะเดียวกัน
   *   ในหน้าต่าง 120 นาที (isReservationOverlapping เดียวกันทั้ง Memory/MySQL)
   * - idempotency (optional): key เดิม + payload เดิม → คืนของเดิม (ไม่เขียน audit ซ้ำ);
   *   key เดิม + payload ต่างกัน → ConflictError
   * - กันแข่งกันจองชน (concurrent): Memory ใช้คิว serialize ต่อโต๊ะ,
   *   MySQL ล็อกแถว shop_tables ของโต๊ะ (SELECT ... FOR UPDATE) ใน transaction เดียว
   */
  createReservation(input: CreateReservationInput, actor: ShopActor, now?: Date): Promise<{ reservation: ReservationDetail; deduplicated: boolean }>;
  getReservation(id: string): Promise<ReservationDetail | null>;
  getReservationByCode(code: string): Promise<ReservationDetail | null>;
  /** การจองของสมาชิกคนเดียว (เรียงเวลานัดใกล้สุดก่อน) */
  listCustomerReservations(customerId: string, limit?: number): Promise<ReservationDetail[]>;
  /** ค้นหาหลังร้าน: รหัสจอง (LIKE) + กรองสถานะ */
  listReservations(filter: ListReservationsFilter): Promise<ReservationDetail[]>;
  /** ผู้สมัครเช็กอินด้วยเบอร์: การจอง active (pending/confirmed) ของเบอร์นั้น (เรียงเวลานัดใกล้สุดก่อน) */
  listReservationsByPhone(phone: string, limit?: number): Promise<ReservationDetail[]>;
  /** แนะนำโต๊ะว่างที่เล็กที่สุดซึ่งรองรับจำนวนคนในช่วงเวลานัด */
  recommendReservationTable(partySize: number, reservedAt: string): Promise<ShopTable | null>;
  /**
   * ลูกค้ายกเลิกการจองของตนเอง (pending/confirmed เท่านั้น + ก่อนนัด ≥60 นาที)
   * + audit แบบ all-or-nothing
   */
  cancelReservation(id: string, patch: { reason: string }, actor: ShopActor, now?: Date): Promise<ReservationDetail>;
  /**
   * หลังร้านเปลี่ยนสถานะ (Owner/Admin — route ตรวจสิทธิ์):
   * pending → confirmed/cancelled, confirmed → cancelled/no_show พร้อมเหตุผล
   * + audit ก่อน/หลัง แบบ all-or-nothing (seated → completed ผ่านปิดรอบเท่านั้น)
   */
  updateReservationStatus(id: string, patch: { status: ReservationStatus; reason: string }, actor: ShopActor): Promise<ReservationDetail>;
  /**
   * เช็กอิน (Owner/Admin — route ตรวจสิทธิ์):
   * - ค้นหาด้วยรหัสจองหรือเบอร์โทร ตรวจจำนวนคนจริง (1–50)
   * - เปิดรอบการใช้โต๊ะได้เพียงครั้งเดียวต่อการจอง และหนึ่งรอบต่อหนึ่งโต๊ะ
   *   (โต๊ะต้องพร้อมใช้งาน + ไม่มีรอบ open ค้าง + ความจุพอจำนวนจริง)
   * - โต๊ะตามจองจุไม่พอ → ใช้ tableId ที่ระบุมาแทนได้ (ต้องว่างเช่นกัน);
   *   หาโต๊ะเหมาะไม่ได้เลย → ConflictError ข้อความรอจัดโต๊ะ (ไม่เปลี่ยนสถานะ)
   * - สำเร็จ: การจอง → seated + เปิด round + audit ทั้งหมดแบบ all-or-nothing
   */
  checkinReservation(input: CheckinInput, actor: ShopActor, now?: Date): Promise<{ reservation: ReservationDetail; round: TableRoundDetail }>;
  /** รอบการใช้โต๊ะ (หลังร้าน): กรองสถานะ + จำกัดจำนวน เรียงเปิดล่าสุดก่อน */
  listTableRounds(filter: ListTableRoundsFilter): Promise<TableRoundDetail[]>;
  getTableRound(id: string): Promise<TableRoundDetail | null>;
  /**
   * ปิดรอบ (Owner/Admin — route ตรวจสิทธิ์):
   * - รอบต้อง open อยู่; ปิดได้เมื่อไม่มีคำสั่งซื้อ pending_payment ผูกอยู่
   * - สำเร็จ: round → closed + การจองต้นทาง (ถ้ามี) → completed + audit แบบ all-or-nothing
   * - รอบที่ปิดแล้วรับคำสั่งซื้อใหม่ไม่ได้ (ตรวจที่ createOrder)
   */
  closeTableRound(id: string, actor: ShopActor, now?: Date): Promise<TableRoundDetail>;
  // ---- Ticket 07: ตัวเลือกเมนู สูตร และสต๊อก ----
  /**
   * กลุ่มตัวเลือกของเมนู (Owner/Admin — route ตรวจสิทธิ์):
   * - เมนูต้องมีอยู่ (archive แล้วจัดการต่อไม่ได้); ชื่อซ้ำในเมนูเดียวกัน → ConflictError
   */
  createMenuOptionGroup(menuId: string, input: { name: string; sortOrder?: number }, actor: ShopActor): Promise<MenuOptionGroup>;
  /** กลุ่มตัวเลือกทั้งหมดของเมนู (เรียงลำดับแสดงผล) */
  listMenuOptionGroups(menuId: string): Promise<MenuOptionGroup[]>;
  /** แก้ชื่อ/ลำดับกลุ่ม + audit ก่อน/หลัง แบบ all-or-nothing */
  updateMenuOptionGroup(id: string, patch: { name?: string; sortOrder?: number }, actor: ShopActor): Promise<MenuOptionGroup>;
  /**
   * ตัวเลือกในกลุ่ม (Owner/Admin):
   * - กลุ่มต้องมีอยู่; ชื่อซ้ำในกลุ่มเดียวกัน → ConflictError
   */
  createMenuOption(groupId: string, input: { name: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }, actor: ShopActor): Promise<MenuOption>;
  /**
   * แก้ตัวเลือก + audit (เปลี่ยน isEnabled อย่างเดียว → menu_option_status_changed,
   * อื่น ๆ → menu_option_updated) แบบ all-or-nothing
   */
  updateMenuOption(id: string, patch: { name?: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }, actor: ShopActor): Promise<MenuOption>;
  /** ตัวเลือกทั้งหมดของเมนู (รวมที่ปิดขาย — หลังร้านใช้จัดการ; หน้าขายกรองเฉพาะเปิดขาย) */
  listMenuOptions(menuId: string): Promise<MenuOption[]>;
  /** แคตตาล็อกสาธารณะพร้อมกลุ่มตัวเลือก (เฉพาะที่เปิดขาย) + สถานะพร้อมขายจากสต๊อก */
  listPublicMenuWithOptions(): Promise<PublicMenuItemWithOptions[]>;
  // ---- Ticket 07: วัตถุดิบ (Owner/Admin — route ตรวจสิทธิ์) ----
  /**
   * สร้างวัตถุดิบ (ชื่อ unique, หน่วยกำหนดตอนสร้างเปลี่ยนไม่ได้):
   * - initialOnHand (optional, default 0) บันทึกเป็นธุรกรรม receive "ยอดเริ่มต้น" ใน seam เดียว
   */
  createIngredient(input: { name: string; unit: string; reorderThreshold?: number; latestCost?: number; initialOnHand?: number }, actor: ShopActor): Promise<Ingredient>;
  listIngredients(options?: { includeDisabled?: boolean }): Promise<Ingredient[]>;
  getIngredient(id: string): Promise<Ingredient | null>;
  /**
   * แก้ชื่อ/ระดับเตือน/ทุนล่าสุด + audit ก่อน/หลัง (เปลี่ยน isEnabled อย่างเดียว →
   * ingredient_status_changed) แบบ all-or-nothing; หน่วยเปลี่ยนไม่ได้
   */
  updateIngredient(id: string, patch: { name?: string; reorderThreshold?: number; latestCost?: number; isEnabled?: boolean }, actor: ShopActor): Promise<Ingredient>;
  /**
   * ธุรกรรมสต๊อกแบบ manual (receive/return/waste/expire/personal_use/adjust):
   * - receive/return เพิ่มคงเหลือจริง; waste/expire/personal_use ลดคงเหลือจริง;
   *   adjust ปรับด้วย delta (บวก/ลด) — ห้ามทำให้คงเหลือติดลบหรือพร้อมขายติดลบ
   * - ทุกครั้งบันทึก ledger (ก่อน/หลัง, delta, เหตุผล, ผู้ทำ, เวลา) + audit แบบ all-or-nothing
   * - reserve/release/consume ผ่านช่องทางนี้ไม่ได้ (เป็นของระบบจากคำสั่งซื้อเท่านั้น)
   */
  recordStockMovement(ingredientId: string, input: { op: ManualStockOp; qty: number; reason: string; reference?: string | null }, actor: ShopActor): Promise<{ ingredient: Ingredient; entry: StockLedgerEntry }>;
  /** ประวัติธุรกรรมสต๊อก (ใหม่สุดก่อน, กรองวัตถุดิบ/คำสั่งซื้อ/ประเภทได้) */
  listStockLedger(filter: { ingredientId?: string; orderId?: string; op?: StockOp; limit: number }): Promise<StockLedgerEntry[]>;
  // ---- Ticket 07: สูตรแบบ versioned (Owner/Admin) ----
  /**
   * สร้างสูตรเวอร์ชันใหม่ (แก้ไข = สร้างเวอร์ชันใหม่อย่างเดียว ห้ามแก้/ลบของเก่า):
   * - เป้าหมาย menu → เมนูต้องมีอยู่; option → ตัวเลือกต้องมีอยู่
   * - วัตถุดิบทุกบรรทัดต้องมีอยู่และเปิดใช้; คำนวณต้นทุนประมาณการต่อหน่วยจากทุนล่าสุด
   */
  createRecipe(input: { targetType: RecipeTargetType; targetId: string; lines: RecipeLine[] }, actor: ShopActor): Promise<Recipe>;
  /** ประวัติเวอร์ชันของเป้าหมาย (เก่าสุดก่อน) */
  listRecipes(targetType: RecipeTargetType, targetId: string): Promise<Recipe[]>;
  /** สูตรล่าสุดของเป้าหมาย (null เมื่อยังไม่มีสูตร — สั่งได้โดยไม่ตรวจสต๊อก) */
  getLatestRecipe(targetType: RecipeTargetType, targetId: string): Promise<Recipe | null>;
  // ---- Ticket 07: วงจรจอง/ตัดสต๊อกผูกกับคำสั่งซื้อ ----
  /**
   * ตัดสต๊อกจริงเมื่อเริ่มทำ (Owner/Admin/kitchen/drink ตามสิทธิ์ที่ route กำหนด):
   * - ต้องจองไว้แล้วและยังไม่ตัด; ลดคงเหลือจริง+ยอดจองพร้อมกัน + ledger consume + audit
   * - ตัดแล้วเรียกซ้ำเป็น no-op (คืนคำสั่งซื้อเดิม ไม่เขียน ledger/audit ซ้ำ)
   * - ยังไม่จอง (ไม่มีสูตรเลย) → ConflictError; ยกเลิกแล้ว → ConflictError
   */
  consumeOrderStock(id: string, actor: ShopActor): Promise<{ order: OrderDetail; deduplicated: boolean }>;
  // ---- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน (local-first state machine) ----
  /**
   * สร้างคำขอชำระ (intent) สำหรับคำสั่งซื้อที่ pending_payment เท่านั้น:
   * - ยอดชำระตรึงเท่ายอดคำสั่งซื้อ (FR-PAY-001); cash ต้องมี receivedAmount ≥ ยอด (คำนวณเงินทอน)
   * - promptpay สร้าง QR payload ผ่าน fake provider + expiresAt (default 15 นาที)
   * - idempotency: key เดิม + payload เดิม → คืน payment เดิม (ไม่เขียน audit ซ้ำ);
   *   key เดิม + payload ต่างกัน → ConflictError
   * - มี payment ที่ยังไม่ปิดงาน (pending/manual_review) หรือ paid อยู่แล้ว → ConflictError
   *   (terminal failed/expired/cancelled สร้างใหม่ได้)
   */
  createPayment(
    input: CreatePaymentInput,
    actor: ShopActor,
    now?: Date,
  ): Promise<{ payment: Payment; qrPayload: string | null; deduplicated: boolean }>;
  getPayment(id: string): Promise<Payment | null>;
  /** payment ล่าสุดของคำสั่งซื้อ (null เมื่อยังไม่เคยชำระ) */
  getOrderPayment(orderId: string): Promise<Payment | null>;
  /** สถานะการชำระแบบ derived ฝั่งคำสั่งซื้อ (pending_payment เมื่อยังไม่มี payment) */
  getOrderPaymentState(orderId: string): Promise<OrderPaymentState>;
  /** ค้นหาหลังร้าน: เลขคำสั่งซื้อ/เลขใบเสร็จ (LIKE) + กรองสถานะ/วิธีชำระ */
  listPayments(filter: ListPaymentsFilter): Promise<Payment[]>;
  /**
   * ยืนยันรับเงินสด (Owner/Admin — route ตรวจสิทธิ์):
   * pending/manual_review → paid + ออกใบเสร็จ (เลข RCP-*) แบบ all-or-nothing
   * (ไม่แตะสต๊อกซ้ำ — จองไว้แล้วตอนยืนยันคำสั่งซื้อ; queue/points เป็น no-op มี idempotency guard)
   */
  confirmCashPayment(id: string, input: { receivedAmount: number; reason?: string | null }, actor: ShopActor, now?: Date): Promise<{ payment: Payment; receipt: Receipt; deduplicated: boolean }>;
  /**
   * รับ webhook จากผู้ให้บริการ (fake signature seam):
   * - dedupe ด้วย providerEventId (replay → deduplicated:true ไม่เขียน audit/ledger/receipt ซ้ำ)
   * - success → paid + ใบเสร็จ (payment ที่ paid อยู่แล้วถูกปฏิเสธก่อน — กัน success ซ้ำ)
   * - ambiguous → manual_review (รอ Admin ตรวจมือ)
   * - fail → failed; intent หมดอายุแล้ว → expired (จ่ายต่อไม่ได้)
   * - ไม่แตะสต๊อก/คิว/คะแนนซ้ำ (side effects มี idempotency guard)
   */
  handlePaymentWebhook(
    paymentId: string,
    input: { providerEventId: string; outcome: ProviderOutcome; summary?: string | null },
    actor: ShopActor,
    now?: Date,
  ): Promise<{ payment: Payment; receipt: Receipt | null; deduplicated: boolean }>;
  /**
   * ส่ง slip ให้ fake provider ตรวจ (dev fake mode เท่านั้น):
   * VALID-* → paid + ใบเสร็จ; AMBIGUOUS-* → manual_review; อื่น → failed
   */
  submitPaymentSlip(id: string, input: { slipRef: string }, actor: ShopActor, now?: Date): Promise<{ payment: Payment; receipt: Receipt | null; deduplicated: boolean }>;
  /**
   * Admin ตัดสินรายการรอตรวจสอบ (Owner/Admin — route ตรวจสิทธิ์):
   * manual_review → paid (ออกใบเสร็จ) หรือ failed/cancelled พร้อมเหตุผล
   */
  resolveManualReview(id: string, input: { decision: "paid" | "failed" | "cancelled"; reason: string }, actor: ShopActor, now?: Date): Promise<{ payment: Payment; receipt: Receipt | null }>;
  /**
   * หมดอายุ intent (Owner/Admin/staff — route ตรวจสิทธิ์):
   * pending → expired (เรียกซ้ำเป็น no-op); หมดอายุแล้วจ่ายต่อไม่ได้
   */
  expirePayment(id: string, actor: ShopActor, now?: Date): Promise<{ payment: Payment; deduplicated: boolean }>;
  /** ใบเสร็จของ payment (null เมื่อยังไม่ paid) — ลูกค้าเห็นเฉพาะของตนเอง (route ตรวจสิทธิ์) */
  getReceiptByPayment(paymentId: string): Promise<Receipt | null>;
  getReceiptByNumber(receiptNumber: string): Promise<Receipt | null>;
  /** ค้นหาใบเสร็จหลังร้าน (เลขใบเสร็จ/เลขคำสั่งซื้อ LIKE + ช่วงวันที่) */
  listReceipts(filter: ListReceiptsFilter): Promise<Receipt[]>;
  /**
   * อนุมัติคืนเงิน (Owner เท่านั้น — route ตรวจสิทธิ์):
   * - เฉพาะ payment ที่ paid; ออเดอร์ต้องยังไม่ตัดสต๊อกจริง (ตัดแล้วปฏิเสธ)
   * - สำเร็จ: payment → refunded + ออเดอร์ → cancelled (คืนยอดจองตาม Ticket 07 contract —
   *   ทำให้รอบโต๊ะปิดได้ตาม Ticket 06 contract) + audit ทั้งหมดแบบ all-or-nothing
   * - ซ้ำถูกปฏิเสธ (409)
   */
  approveRefund(paymentId: string, input: { reason: string }, actor: ShopActor, now?: Date): Promise<{ payment: Payment; refund: Refund }>;
  listRefunds(limit: number): Promise<Refund[]>;
  // ---- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ (local-first, สร้างจาก paid เท่านั้น) ----
  /**
   * สร้าง queue jobs จาก payment ที่ paid แล้ว (หนึ่ง payment → หนึ่งชุด jobs):
   * - หนึ่ง OrderItem → หนึ่ง job; แยกฝ่ายจาก menu kind (food → kitchen, drink → drink)
   * - readyAt: งานทั่วไป = paidAt; preorder = scheduledAt − เวลาทำประมาณการของฝ่าย
   * - idempotency: payment นี้เคยสร้างแล้ว → คืนชุดเดิม (deduplicated:true ไม่เขียน audit ซ้ำ)
   * - payment ยังไม่ paid / ออเดอร์ถูกยกเลิก/คืนเงินแล้ว → ConflictError
   * - ถูกเรียกอัตโนมัติเมื่อชำระสำเร็จ (confirm-cash/webhook/slip/resolve) แบบ no-op guard
   */
  ensureQueueJobs(paymentId: string, actor: ShopActor, now?: Date): Promise<{ jobs: QueueJobDetail[]; deduplicated: boolean }>;
  /** งานคิวของคำสั่งซื้อ (ลูกค้าติดตามของตนเอง — route ตรวจสิทธิ์) */
  listOrderQueueJobs(orderId: string): Promise<QueueJobDetail[]>;
  getQueueJob(id: string): Promise<QueueJobDetail | null>;
  /**
   * รายการคิวของฝ่าย (เรียง FIFO ตาม readyAt ต่อฝ่าย — route กรองสิทธิ์ข้ามฝ่าย):
   * station ว่าง = ทุกฝ่าย (เฉพาะ owner/admin); status กรองสถานะได้
   */
  listQueueJobs(filter: ListQueueJobsFilter): Promise<QueueJobDetail[]>;
  /** รับงาน: queued → claimed (ต้องเป็นฝ่ายตน — route ตรวจ) */
  claimQueueJob(id: string, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /**
   * เริ่มทำ: claimed → preparing + ตัดสต๊อกจริงของคำสั่งซื้อครั้งแรก (ครั้งเดียว idempotent —
   * เรียกซ้ำ/งานอื่นของออเดอร์เดียวกันเป็น no-op ผ่าน consumeOrderStock contract)
   */
  startQueueJob(id: string, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /**
   * ทำเสร็จ (ทยอยได้): readyQty += qty (ไม่เกินยอดงาน); ครบ → preparing/claimed → ready
   * (ยังไม่ครบคงสถานะเดิม แต่บันทึกยอด + audit)
   */
  completeQueueJob(id: string, input: { qty: number }, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /**
   * ส่งมอบ (ทยอยได้): deliveredQty += qty (ไม่เกินทำเสร็จและยอดงาน); ครบ → ready → delivered
   * (ยังไม่ครบคง ready แต่บันทึกยอด + audit)
   */
  deliverQueueJob(id: string, input: { qty: number }, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /** เร่งงาน: ต้องมีเหตุผล + audit (สิทธิ์เฉพาะฝ่ายตน — route ตรวจ) */
  prioritizeQueueJob(id: string, input: { reason: string }, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /**
   * ทำใหม่: สร้าง job ใหม่จาก job เดิม (จำนวน ≤ คงเหลือที่ยังไม่ส่งมอบ, มีเหตุผล + audit,
   * ไม่คิดเงินซ้ำ — readyAt = เวลาทำใหม่)
   */
  remakeQueueJob(id: string, input: { reason: string; quantity?: number | null }, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /**
   * ยกเลิกงานคิวบางรายการ (เฉพาะ queued/claimed + ออเดอร์ยังไม่ตัดสต๊อกจริง):
   * ต้องมีเหตุผล + audit; คืนเงินแล้ว/ตัดจริงแล้ว → ConflictError (ตาม Ticket 08 contract)
   */
  cancelQueueJob(id: string, input: { reason: string }, actor: ShopActor, now?: Date): Promise<QueueJobDetail>;
  /** กำลังผลิตต่อช่วง 15 นาทีของฝ่าย (default ตาม QUEUE_DEFAULT_CAPACITY_PER_SLOT) */
  getStationCapacity(station: QueueStation): Promise<StationCapacity>;
  /** ตั้งกำลังผลิต (Owner/Admin — route ตรวจสิทธิ์) + audit ก่อน/หลัง */
  setStationCapacity(station: QueueStation, perSlot: number, actor: ShopActor, now?: Date): Promise<StationCapacity>;
  /**
   * ภาพสล็อต 15 นาทีของฝ่ายในวันนั้น (Asia/Bangkok) — เต็มเสนอช่วงถัดไป
   * (contract สำหรับ Ticket 13: preorder slots + capacity)
   */
  listQueueSlots(station: QueueStation, date: string, now?: Date): Promise<QueueSlot[]>;
  /** สล็อตว่างถัดไปของฝ่ายตั้งแต่เวลาที่กำหนด (null เมื่อเต็มทั้งวัน) */
  suggestNextSlot(station: QueueStation, after: string, now?: Date): Promise<QueueSlot | null>;
  // ---- Ticket 10: คะแนนสะสมและรางวัล (immutable ledger + idempotent seams) ----
  /**
   * สะสมคะแนนให้คำสั่งซื้อ (exactly-once ต่อ order/payment/job event):
   * - เครื่องดื่มที่ร่วมรายการ 1 หน่วย = 1 คะแนน เฉพาะเมื่อชำระสำเร็จ (paid)
   *   และส่งมอบแล้ว (delivered ครบ/ทยอยของ jobs ฝ่าย drink) หรือปิดงาน completed
   * - รางวัลราคา 0 (unitPrice 0) ไม่ได้คะแนน; เรียกซ้ำเป็น no-op
   *   (ไม่เขียน ledger/audit ซ้ำ) — ถูกเรียกอัตโนมัติเมื่อชำระสำเร็จ ส่งมอบ
   *   และปิดคำสั่งซื้อ แบบ no-op guard
   */
  earnPointsForOrder(orderId: string, actor: ShopActor, now?: Date): Promise<{ earned: number; deduplicated: boolean }>;
  /** ยอดคงเหลือของลูกค้า (derived = ผลรวมธุรกรรมที่มีผล) */
  getLoyaltyBalance(customerId: string): Promise<number>;
  /** ประวัติธุรกรรมคะแนนของลูกค้า (ใหม่สุดก่อน) */
  listLoyaltyLedger(customerId: string, limit: number): Promise<LoyaltyTransaction[]>;
  /**
   * สร้างรางวัล (Owner/Admin — route ตรวจสิทธิ์):
   * - menuId ต้องเป็นเมนูเครื่องดื่มที่มีอยู่ (food ถูกปฏิเสธ)
   */
  createReward(
    input: { name: string; imageUrl?: string | null; menuId: string; pointsCost: number; quotaTotal?: number | null; startsAt?: string | null; endsAt?: string | null; isActive?: boolean },
    actor: ShopActor,
  ): Promise<Reward>;
  /** รายการรางวัลทั้งหมด (หลังร้าน — รวมที่ปิดขาย) */
  listRewards(): Promise<Reward[]>;
  /** รางวัลพร้อมแลกสำหรับลูกค้า (เปิดขาย + อยู่ในช่วงเวลา; quota/สต๊อกตรวจตอนแลก) */
  listRedeemableRewards(now?: Date): Promise<Reward[]>;
  getReward(id: string): Promise<Reward | null>;
  /**
   * แก้ไขรางวัล (Owner/Admin): ชื่อ/รูป/คะแนน/quota/ช่วงเวลา/สถานะ
   * (เปลี่ยน isActive อย่างเดียว → reward_status_changed, อื่น ๆ → reward_updated)
   */
  updateReward(
    id: string,
    patch: { name?: string; imageUrl?: string | null; pointsCost?: number; quotaTotal?: number | null; startsAt?: string | null; endsAt?: string | null; isActive?: boolean },
    actor: ShopActor,
  ): Promise<Reward>;
  /**
   * ยืนยันแลก (reserve — กันคะแนน + กัน quota, idempotency key):
   * - ตรวจยอดคงเหลือพอ, รางวัลพร้อมแลก (quota/ช่วงเวลา/สถานะ),
   *   สต๊อกพร้อมขายพอสำหรับ 1 หน่วย
   * - key เดิม + payload เดิม → คืนรายการเดิม (ไม่เขียน audit ซ้ำ);
   *   key เดิม + payload ต่างกัน → ConflictError
   * - แลกพร้อมกันต้องไม่ใช้คะแนน/quota เกิน (serialize ผ่าน runOrderExclusive/named lock)
   */
  redeemReserve(
    input: { customerId: string; rewardId: string; idempotencyKey: string; reason?: string | null },
    actor: ShopActor,
    now?: Date,
  ): Promise<{ redemption: RewardRedemption; deduplicated: boolean }>;
  getRedemption(id: string): Promise<RewardRedemption | null>;
  /** รายการแลกของลูกค้า (ใหม่สุดก่อน) */
  listCustomerRedemptions(customerId: string, limit: number): Promise<RewardRedemption[]>;
  /** รายการแลกที่รอร้านรับ (reserved — drink/admin/owner ดูฝ่ายเครื่องดื่ม) */
  listPendingRedemptions(limit: number): Promise<RewardRedemption[]>;
  /**
   * ร้านรับรายการ (consume — drink/admin/owner):
   * reserved → consumed: หักคะแนนถาวร + สร้างงานคิวเครื่องดื่มราคา 0
   * ครั้งเดียว (idempotent — เรียกซ้ำคืนงานเดิม) + ตัดสต๊อกจริง 1 หน่วย
   * สต๊อกหมดตอนรับ → ConflictError (ให้ใช้ release คืนคะแนนแทน)
   */
  redeemConsume(id: string, actor: ShopActor, now?: Date): Promise<{ redemption: RewardRedemption; job: QueueJobDetail }>;
  /**
   * ปฏิเสธ/ยกเลิก (release — drink/admin/owner หรือเจ้าของแต้ม):
   * reserved → released: คืนคะแนนที่กันไว้ + คืน quota (เรียกซ้ำ no-op)
   */
  redeemRelease(id: string, input: { reason: string }, actor: ShopActor, now?: Date): Promise<{ redemption: RewardRedemption; deduplicated: boolean }>;
  /**
   * ออก QR Walk-in (drink/admin/owner):
   * payload แบบ deterministic `WALKIN-<token>` อายุ 10 นาที ใช้ครั้งเดียว
   */
  issueWalkinQr(actor: ShopActor, now?: Date): Promise<WalkinQrToken>;
  /**
   * สแกนรับคะแนน Walk-in (ลูกค้า):
   * 1 แต้มต่อ QR; ใช้ซ้ำ/หมดอายุ/ข้ามลูกค้าถูกปฏิเสธ (409/404)
   */
  redeemWalkinQr(input: { code: string; customerId: string }, actor: ShopActor, now?: Date): Promise<{ token: WalkinQrToken; earned: number }>;
  /**
   * ผูกคำสั่งซื้อ Guest เข้าบัญชีลูกค้า (ลูกค้าเจ้าของเบอร์):
   * - ภายใน 24 ชม. หลังคำสั่งซื้อยืนยัน + เบอร์ Guest ตรงกับบัญชี (normalize แล้ว)
   * - รับได้เฉพาะคะแนนที่ยังไม่มีผู้รับ (กัน double-earn); ผูกซ้ำ/เบอร์คนอื่น → 409
   */
  linkGuestOrder(input: { orderId: string; customerId: string }, actor: ShopActor, now?: Date): Promise<{ order: OrderDetail; earned: number }>;
  /**
   * รวมบัญชี (Owner/Admin อนุมัติ — route ตรวจสิทธิ์):
   * ย้าย ledger/redemption/claims ไปบัญชีปลายทางแบบ atomic + audit;
   * บัญชีต้นทางถูกปิด; คู่เดิมเรียกซ้ำเป็น no-op (idempotent)
   */
  mergeCustomerAccounts(
    input: { sourceCustomerId: string; targetCustomerId: string },
    actor: ShopActor,
    now?: Date,
  ): Promise<{ record: CustomerMergeRecord; movedPoints: number; deduplicated: boolean }>;
  /**
   * กลับรายการคะแนนเมื่อคืนเงิน/ยกเลิก (Owner/Admin — route ตรวจสิทธิ์):
   * ย้อนคะแนน earn ที่เกี่ยวข้อง (append-only รักษาประวัติ) + audit;
   * refund เดิมเรียกซ้ำเป็น no-op (กัน double-reversal)
   */
  reversePointsOnRefund(orderId: string, refundId: string, actor: ShopActor, now?: Date): Promise<{ reversal: LoyaltyReversal; deduplicated: boolean }>;
  // ---- Ticket 11: การเงิน รายจ่ายจริง/รายรับมือ + รายงาน/Dashboard (local-first) ----
  /**
   * สร้างรายการเงินมือ (Owner/Admin — route ตรวจสิทธิ์):
   * kind=expense → หมวดรายจ่าย; kind=income → หมวดรายรับมือ + audit แบบ all-or-nothing
   */
  createFinanceEntry(
    input: { kind: FinanceKind; category: FinanceCategory; amount: number; occurredAt: string; note?: string | null; reason: string },
    actor: ShopActor,
    now?: Date,
  ): Promise<FinanceEntry>;
  getFinanceEntry(id: string): Promise<FinanceEntry | null>;
  /** รายการเงินมือ (ใหม่สุดก่อน, กรอง kind/category/ช่วง occurredAt ได้) */
  listFinanceEntries(filter: ListFinanceEntriesFilter): Promise<FinanceEntry[]>;
  /** แก้ไขรายการเงินมือ + audit ก่อน/หลัง แบบ all-or-nothing */
  updateFinanceEntry(
    id: string,
    patch: { category?: FinanceCategory; amount?: number; occurredAt?: string; note?: string | null; reason: string },
    actor: ShopActor,
    now?: Date,
  ): Promise<FinanceEntry>;
  /** ลบรายการเงินมือ + audit แบบ all-or-nothing (ต้องมีเหตุผล) */
  deleteFinanceEntry(id: string, input: { reason: string }, actor: ShopActor): Promise<void>;
  /**
   * รายงานการเงินตาม granularity (buckets ฝั่ง Asia/Bangkok):
   * - รายรับ = paid payments ครั้งเดียวตาม paidAt; คืนเงิน = refunds ครั้งเดียวตาม approvedAt
   * - รายรับมือ/รายจ่ายจริงจาก finance_entries ตาม occurredAt; ต้นทุนประมาณการแยกวิเคราะห์
   */
  getFinanceReport(input: { granularity: FinanceGranularity; from: string; to: string }): Promise<FinanceReport>;
  /**
   * KPI Dashboard รายวัน (Asia/Bangkok):
   * ยอดขายสุทธิ, จำนวนคำสั่งซื้อที่ชำระ, บิลเฉลี่ย, top5 เมนูขายดี,
   * ชั่วโมงหนาแน่น 24 ชม., occupancy (ถ้ามี), จำนวนวัตถุดิบสต๊อกต่ำ
   */
  getFinanceDashboard(date: string, now?: Date): Promise<FinanceDashboard>;
  /** เมนูขายดีในช่วงวันที่ (นับเฉพาะรายการในคำสั่งซื้อที่ชำระสำเร็จ) */
  getFinanceTopMenus(input: { from: string; to: string; limit: number }): Promise<FinanceTopMenu[]>;
  /** ชั่วโมงหนาแน่นในช่วงวันที่ (0–23 ฝั่งกรุงเทพ) */
  getFinancePeakHours(input: { from: string; to: string }): Promise<FinancePeakHour[]>;
  // ---- Ticket 12: LINE notifications outbox (local-first, exactly-once ด้วย eventKey) ----
  /**
   * เข้าคิวแจ้งเตือน (producer เรียกหลัง business commit เสมอ — ห้าม rollback งานหลัก):
   * - eventKey เดิม → คืนแถวเดิม (deduplicated:true ไม่เขียน audit ซ้ำ)
   * - แถวใหม่เริ่ม pending + nextRetryAt=now (รอ flush ส่ง)
   */
  queueNotification(
    input: QueueNotificationInput,
    actor: ShopActor,
    now?: Date,
  ): Promise<{ notification: Notification; deduplicated: boolean }>;
  getNotification(id: string): Promise<Notification | null>;
  getNotificationByEventKey(eventKey: string): Promise<Notification | null>;
  /** รายการ outbox (ใหม่สุดก่อน, กรอง status/kind/customer ได้) */
  listNotifications(filter: ListNotificationsFilter): Promise<Notification[]>;
  /**
   * งานที่ถึงเวลาส่ง (pending ทั้งหมด + failed ที่ nextRetryAt ≤ now) เรียงเก่าสุดก่อน
   * — flush ใช้ดึงงานรอบละ limit แถว
   */
  listDueNotifications(now: Date, limit: number): Promise<Notification[]>;
  /**
   * claim งานส่ง (กัน flush ซ้อนส่งซ้ำ): pending หรือ failed ที่ถึงเวลาแล้ว →
   * sending + attempts+1; สถานะอื่น/ยังไม่ถึงเวลา → null
   */
  claimNotification(id: string, now?: Date): Promise<Notification | null>;
  /** ส่งสำเร็จ: sending → sent + sentAt + audit (สถานะอื่น → ConflictError) */
  completeNotificationSend(id: string, actor: ShopActor, now?: Date): Promise<Notification>;
  /**
   * ส่งล้มเหลว: sending → failed (มี nextRetryAt) หรือ dead_letter (null)
   * + audit; error ถูก sanitize ก่อนเก็บเสมอ
   */
  failNotificationSend(
    id: string,
    input: { error: string; nextRetryAt: string | null },
    actor: ShopActor,
    now?: Date,
  ): Promise<Notification>;
  /** ข้ามการส่ง (ไม่มี consent/LINE link/ลูกค้าไม่ valid): → skipped + audit */
  skipNotification(id: string, reason: string, actor: ShopActor, now?: Date): Promise<Notification>;
  /**
   * สั่งส่งซ้ำด้วยมือ (Owner/Admin — route ตรวจสิทธิ์):
   * failed/dead_letter/skipped → pending (attempts=0, nextRetryAt=now) + audit;
   * pending/sending/sent → ConflictError
   */
  retryNotification(
    id: string,
    input: { reason: string },
    actor: ShopActor,
    now?: Date,
  ): Promise<Notification>;
  /** ตั้งค่า consent รับแจ้งเตือนของลูกค้า (default เปิดเมื่อไม่มีแถว) */
  setNotificationConsent(customerId: string, enabled: boolean, actor: ShopActor): Promise<void>;
  isNotificationEnabled(customerId: string): Promise<boolean>;
  /**
   * การจอง pending/confirmed ที่เวลานัดอยู่ใน [fromIso, toIso] (เรียงนัดใกล้สุดก่อน)
   * — scheduler เตือน 30 นาทีกวาดผ่าน seam นี้
   */
  listUpcomingReservations(fromIso: string, toIso: string, limit: number): Promise<ReservationDetail[]>;
  // ---- Ticket 13: Capacity + wait-time prediction (local-first, baseline deterministic) ----
  /**
   * ภาพรวมกำลังผลิต: กำลังผลิตต่อฝ่าย + งาน active + โต๊ะว่าง + เวลารอ baseline
   * (partySize ใช้ 2 คนสำหรับภาพรวม — ไม่ผูกคำสั่งซื้อใด)
   */
  getCapacityOverview(now?: Date): Promise<CapacityOverview>;
  /**
   * เวลารอ baseline ของคำสั่งซื้อ (deterministic):
   * ต่อฝ่าย wait = prep × (1 + queueAhead) + partyAdj; ระดับออเดอร์ = งานช้าที่สุด
   * + readyAtSlowest + ช่วง [wait, wait+5]
   */
  estimateOrderWaitBaseline(orderId: string, partySize: number, now?: Date): Promise<WaitEstimate>;
  /**
   * ตรวจสล็อตล่วงหน้า (preorder/reservation slot validation):
   * เทียบยอดจองสล็อตกับกำลังผลิต — เต็มเสนอช่วงถัดไป (reuse suggestNextSlot)
   */
  checkPreorderSlot(station: QueueStation, scheduledAt: string, partySize: number, now?: Date): Promise<PreorderSlotCheck>;
  /** รุ่นโมเดลปัจจุบัน (singleton — default baseline-v1) */
  getPredictionModel(): Promise<PredictionModel>;
  /**
   * ตั้งค่ารุ่นโมเดล (Owner/Admin — route ตรวจสิทธิ์) + audit ก่อน/หลัง
   * (เปิด external ได้เฉพาะเมื่อ accuracy ผ่านเกณฑ์ — route ตรวจผ่าน getPredictionAccuracy)
   */
  setPredictionModel(
    patch: { version?: string; kind?: "baseline" | "external"; enabled?: boolean; thresholdMinutes?: number; timeoutMs?: number },
    actor: ShopActor,
    now?: Date,
  ): Promise<PredictionModel>;
  /**
   * บันทึก feature ณ จุดพยากรณ์ (no leakage — ไม่มีอนาคต ไม่มี PII) + audit requested
   * predictedMin null = baseline ล้วน; source/modelVersion มาจาก adapter fallback เสมอ
   */
  recordPredictionFeature(
    input: { orderId?: string | null; station?: QueueStation | null; partySize: number; baselineMin: number; predictedMin?: number | null; source: PredictionSource; modelVersion?: string | null },
    actor: ShopActor,
    now?: Date,
  ): Promise<PredictionFeature>;
  /** รายการ features ล่าสุด (ใหม่สุดก่อน — Owner/Admin ดู/ตรวจ no-leakage) */
  listPredictionFeatures(limit: number): Promise<PredictionFeature[]>;
  /**
   * บันทึกเวลาจริงเมื่อส่งมอบครบ (actual) + คำนวณ error baseline/model + audit completed
   * (เรียกซ้ำ id เดิมเป็น no-op — กัน double-complete)
   */
  completePredictionFeature(id: string, actualMin: number, actor: ShopActor, now?: Date): Promise<{ feature: PredictionFeature; deduplicated: boolean }>;
  /** เทียบ MAE baseline vs model บนตัวอย่างที่วัดจริงแล้ว + fixtures (AT18) */
  getPredictionAccuracy(now?: Date): Promise<PredictionAccuracy>;
  /**
   * ประเมินและบันทึก audit evaluated (Owner/Admin — route ตรวจสิทธิ์):
   * คืนค่าเดียวกับ getPredictionAccuracy
   */
  evaluatePredictions(actor: ShopActor, now?: Date): Promise<PredictionAccuracy>;
  close?(): Promise<void>;
}

// ---- Ticket 13: input การตั้งค่าโมเดล ----
export interface SetPredictionModelInput {
  version?: string;
  kind?: "baseline" | "external";
  enabled?: boolean;
  thresholdMinutes?: number;
  timeoutMs?: number;
}

// ---- Ticket 12: input/ตัวกรอง outbox ----
export interface QueueNotificationInput {
  eventKey: string;
  kind: NotificationKind;
  customerId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
  paymentId?: string | null;
  message: string;
  maxAttempts?: number | null;
}

export interface ListNotificationsFilter {
  status?: NotificationStatus;
  kind?: NotificationKind;
  customerId?: string;
  limit: number;
}

// ---- Ticket 11: ตัวกรองรายการเงินมือ ----
export interface ListFinanceEntriesFilter {
  kind?: FinanceKind;
  category?: FinanceCategory;
  /** กรอง occurredAt ฝั่ง UTC ISO (route แปลงจาก wall-clock กรุงเทพก่อนส่ง) */
  fromOccurredAt?: string;
  toOccurredAt?: string;
  limit: number;
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
  isArchived?: boolean;
}

// ---------- Ticket 05: ตะกร้าและคำสั่งซื้อพื้นฐาน ----------

export interface CreateOrderLineInput {
  menuId: string;
  quantity: number;
  note?: string | null;
  /** Ticket 07: รหัสตัวเลือกที่เลือกในรายการนี้ (ตรวจว่าเป็นของเมนูนี้และเปิดขาย) */
  options?: string[] | null;
  /** Ticket 07: ความต้องการเฉพาะ — ข้อความล้วน ไม่เปลี่ยนราคา */
  specialRequest?: string | null;
}

export interface CreateOrderInput {
  /** ผูกกับบัญชีลูกค้าเมื่อ login แล้ว — ระบุพร้อม guest ไม่ได้ */
  customerId?: string | null;
  /** ตัวตนขั้นต่ำของ Guest (ต้องมาคู่กับ guestPhone เมื่อไม่มี customerId) */
  guestName?: string | null;
  /** เบอร์ดิบหรือ normalize แล้วก็ได้ — store normalize ซ้ำด้วยกฎ Ticket 03 */
  guestPhone?: string | null;
  serviceType: OrderServiceType;
  /** ISO string (เฉพาะ preorder) */
  scheduledAt?: string | null;
  /** UUID ต่อการกดยืนยันหนึ่งครั้ง — กันยืนยันซ้ำ */
  idempotencyKey: string;
  items: CreateOrderLineInput[];
  /** ผูกกับโต๊ะ (เฉพาะ dine_in ที่เช็กอินแล้ว — ต้องตรงกับโต๊ะของรอบ) */
  tableId?: string | null;
  /** ผูกกับรอบการใช้โต๊ะที่เปิดอยู่ (เฉพาะ dine_in — รอบปิดรับคำสั่งซื้อใหม่ไม่ได้) */
  roundId?: string | null;
}

export interface ListOrdersFilter {
  q?: string;
  status?: OrderStatus;
  limit: number;
}

// ---------- Ticket 06: การจองโต๊ะและรอบการใช้โต๊ะ ----------

export interface CreateReservationInput {
  customerId: string;
  tableId?: string | null;
  /** ว่าง = ให้ระบบแนะนำโต๊ะว่างที่เล็กที่สุดซึ่งรองรับจำนวนคน */
  partySize: number;
  /** ISO string (เวลานัด) */
  reservedAt: string;
  note?: string | null;
  /** UUID ต่อการกดจองหนึ่งครั้ง (optional — กันจองซ้ำ) */
  idempotencyKey?: string | null;
}

export interface ListReservationsFilter {
  q?: string;
  status?: ReservationStatus;
  limit: number;
}

export interface ListTableRoundsFilter {
  status?: TableRoundStatus;
  tableId?: string;
  limit: number;
}

export interface CheckinInput {
  /** รหัสจอง (หรือ qr payload ที่ถอดแล้ว — route ถอดก่อนส่ง) */
  code?: string | null;
  /** เบอร์โทรลูกค้า (normalize แล้วด้วยกฎ Ticket 03 — route normalize ก่อนส่ง) */
  phone?: string | null;
  /** รหัสการจองตรง ๆ (ทางเลือกเมื่อระบุ id มาเลย) */
  reservationId?: string | null;
  /** จำนวนผู้ใช้บริการจริงตอนเช็กอิน (บังคับ) */
  partySize: number;
  /** เปลี่ยนโต๊ะจากที่จอง (optional — ต้องว่างและจุพอเช่นกัน) */
  tableId?: string | null;
}

// ---------- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน ----------

export interface CreatePaymentInput {
  orderId: string;
  method: PaymentMethod;
  /** UUID ต่อการกดชำระหนึ่งครั้ง — กันชำระซ้ำ */
  idempotencyKey: string;
  /** เงินที่รับมาจริง (บังคับเฉพาะ cash — ต้อง ≥ ยอดคำสั่งซื้อ) */
  receivedAmount?: number | null;
  /** อ้างอิง slip (optional — ใช้ submitPaymentSlip ทีหลังก็ได้) */
  slipRef?: string | null;
}

export interface ListPaymentsFilter {
  q?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  limit: number;
}

export interface ListReceiptsFilter {
  q?: string;
  /** กรองวันที่ออกใบเสร็จ (YYYY-MM-DD, Asia/Bangkok) */
  date?: string;
  limit: number;
}

// ---------- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ ----------

export interface ListQueueJobsFilter {
  station?: QueueStation;
  status?: QueueStatus;
  orderId?: string;
  limit: number;
}

const nowIso = () => new Date().toISOString();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * mysql2 อาจคืนคอลัมน์ JSON เป็น string หรือ object ที่ deserialize แล้ว
 * ขึ้นกับเวอร์ชัน/ไดรเวอร์ จึงรองรับทั้งสองแบบ
 */
export function parseRoles(value: unknown): Role[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    raw = JSON.parse(raw) as unknown;
  }
  if (!Array.isArray(raw)) throw new Error("รูปแบบบทบาทในฐานข้อมูลไม่ถูกต้อง");
  const allowed = new Set(["owner", "admin", "kitchen", "drink"]);
  const roles = raw.filter((r): r is Role => typeof r === "string" && allowed.has(r));
  if (roles.length !== raw.length || roles.length === 0) {
    throw new Error("รูปแบบบทบาทในฐานข้อมูลไม่ถูกต้อง");
  }
  // ป้องกันข้อมูลเก่าที่มีบทบาทซ้ำ: normalize ให้เหลือค่าที่ไม่ซ้ำโดยไม่เปลี่ยน contract ภายนอก
  return [...new Set(roles)];
}

/** กันชั้น persistence รับบทบาทซ้ำจาก caller โดยตรง: ตัดค่าซ้ำแบบคงลำดับเดิม */
export function normalizeRoles(roles: Role[]): Role[] {
  return [...new Set(roles)];
}

// ---------- Ticket 11: helpers ฝั่ง Asia/Bangkok (deterministic, ไม่มี DST) ----------

/** เที่ยงคืนกรุงเทพของวัน YYYY-MM-DD ในรูป UTC ISO (กรุงเทพ = UTC+7 ตลอดปี) */
export function bangkokDayStartUtc(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600_000).toISOString();
}

function isoToMysqlDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * หน้าต่าง UTC สำหรับ from..to (wall-clock กรุงเทพ, ปลายรวม):
 * [startMysql, endExclusiveMysql) — ใช้กับคอลัมน์ DATETIME (pool timezone Z)
 */
export function financeWindowMysql(from: string, to: string): { startMysql: string; endExclusiveMysql: string } {
  const startIso = bangkokDayStartUtc(from);
  const parts = to.split("-").map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + 86400000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const nextDate = `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}`;
  return { startMysql: isoToMysqlDatetime(startIso), endExclusiveMysql: isoToMysqlDatetime(bangkokDayStartUtc(nextDate)) };
}

/** แปลง UTC ISO เป็นส่วนประกอบ wall-clock กรุงเทพแบบ deterministic (ไม่พึ่ง Intl) */
export function bangkokWallParts(iso: string): { date: string; month: string; year: string; hour: number } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  const b = new Date(t + 7 * 3600_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`;
  return {
    date,
    month: date.slice(0, 7),
    year: date.slice(0, 4),
    hour: b.getUTCHours(),
  };
}

/** คีย์ bucket ตาม granularity จาก UTC ISO */
export function financeBucketKey(granularity: FinanceGranularity, iso: string): string {
  const p = bangkokWallParts(iso);
  if (granularity === "day") return p.date;
  if (granularity === "month") return p.month;
  return p.year;
}

/** สร้างรายการ bucket ตาม granularity ครอบคลุม from..to (wall-clock กรุงเทพ) */
export function financeBucketKeys(granularity: FinanceGranularity, from: string, to: string): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    for (let cur = from; cur <= to; cur = nextBangkokDay(cur)) keys.push(cur);
    return keys;
  }
  if (granularity === "month") {
    let cur = from.slice(0, 7);
    const end = to.slice(0, 7);
    while (cur <= end) {
      keys.push(cur);
      cur = nextBangkokMonth(cur);
    }
    return keys;
  }
  const startY = Number(from.slice(0, 4));
  const endY = Number(to.slice(0, 4));
  for (let y = startY; y <= endY; y += 1) keys.push(String(y));
  return keys;
}

function nextBangkokDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function nextBangkokMonth(month: string): string {
  let [y, m] = month.split("-").map(Number) as [number, number];
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function emptyFinanceBucket(bucket: string): FinanceReportBucket {
  return {
    bucket,
    grossRevenue: 0,
    refunds: 0,
    netRevenue: 0,
    manualIncome: 0,
    actualExpense: 0,
    grossProfit: 0,
    paidOrders: 0,
    estimatedCost: 0,
  };
}

export function roundBaht2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * มาสก์ PII สำหรับ CSV/รายงาน:
 * - เบอร์โทร: แสดง 2 หลักแรก + 2 หลักสุดท้าย ที่เหลือเป็น * (เช่น 08******12)
 * - ชื่อ: แสดงอักษรแรก + *** (เช่น ก***)
 */
export function maskPhone(phone: string | null): string {
  if (!phone) return "-";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

export function maskName(name: string | null): string {
  if (!name) return "-";
  const t = name.trim();
  if (!t) return "-";
  return `${[...t][0]}***`;
}

// ---------- Ticket 11: aggregation บริสุทธิ์ (ใช้ร่วม memory/MySQL/route) ----------

export interface FinanceReportSource {
  granularity: FinanceGranularity;
  from: string;
  to: string;
  paidPayments: { amount: number; paidAt: string | null; orderId: string }[];
  allRefunds: { amount: number; approvedAt: string }[];
  allEntries: { kind: FinanceKind; amount: number; occurredAt: string }[];
  orderById: (orderId: string) => { estimatedCost: number } | null;
}

/**
 * สร้างรายงานการเงิน: paid นับครั้งเดียวตาม paidAt, refunds ครั้งเดียวตาม approvedAt
 * (caller กรอง status=paid|refunded มาแล้ว — เงินที่รับมาแล้วนับเป็นรายรับแม้คืนภายหลัง
 * ยอดคืนแสดงแยกใน refunds; ฟังก์ชันนี้ไม่ตีความสถานะเอง กันนับซ้ำสองชั้น)
 */
export function buildFinanceReport(src: FinanceReportSource): FinanceReport {
  const keys = financeBucketKeys(src.granularity, src.from, src.to);
  const buckets = new Map<string, FinanceReportBucket>(keys.map((k) => [k, emptyFinanceBucket(k)]));
  for (const p of src.paidPayments) {
    if (!p.paidAt) continue;
    const key = financeBucketKey(src.granularity, p.paidAt);
    const b = buckets.get(key);
    if (!b) continue;
    b.grossRevenue = roundBaht2(b.grossRevenue + p.amount);
    b.paidOrders += 1;
    const order = src.orderById(p.orderId);
    if (order) b.estimatedCost = roundBaht2(b.estimatedCost + order.estimatedCost);
  }
  for (const r of src.allRefunds) {
    const key = financeBucketKey(src.granularity, r.approvedAt);
    const b = buckets.get(key);
    if (!b) continue;
    b.refunds = roundBaht2(b.refunds + r.amount);
  }
  for (const e of src.allEntries) {
    const key = financeBucketKey(src.granularity, e.occurredAt);
    const b = buckets.get(key);
    if (!b) continue;
    if (e.kind === "income") b.manualIncome = roundBaht2(b.manualIncome + e.amount);
    else b.actualExpense = roundBaht2(b.actualExpense + e.amount);
  }
  const ordered = keys.map((k) => buckets.get(k)!);
  for (const b of ordered) {
    b.netRevenue = roundBaht2(b.grossRevenue - b.refunds);
    b.grossProfit = roundBaht2(b.netRevenue + b.manualIncome - b.actualExpense);
  }
  const total = emptyFinanceBucket(`${src.from}..${src.to}`);
  for (const b of ordered) {
    total.grossRevenue = roundBaht2(total.grossRevenue + b.grossRevenue);
    total.refunds = roundBaht2(total.refunds + b.refunds);
    total.manualIncome = roundBaht2(total.manualIncome + b.manualIncome);
    total.actualExpense = roundBaht2(total.actualExpense + b.actualExpense);
    total.paidOrders += b.paidOrders;
    total.estimatedCost = roundBaht2(total.estimatedCost + b.estimatedCost);
  }
  total.netRevenue = roundBaht2(total.grossRevenue - total.refunds);
  total.grossProfit = roundBaht2(total.netRevenue + total.manualIncome - total.actualExpense);
  return { granularity: src.granularity, from: src.from, to: src.to, buckets: ordered, total };
}

export interface FinanceTopMenuSource {
  from: string;
  to: string;
  limit: number;
  paidPayments: { paidAt: string | null; orderId: string }[];
  itemsByOrder: (orderId: string) => { menuId: string; menuName: string; quantity: number; unitPrice: number; lineTotal: number }[];
}

export function buildFinanceTopMenus(src: FinanceTopMenuSource): FinanceTopMenu[] {
  const limit = Math.min(Math.max(src.limit || 10, 1), 50);
  const fromStart = new Date(bangkokDayStartUtc(src.from)).getTime();
  const toEnd = new Date(bangkokDayStartUtc(src.to)).getTime() + 86400000 - 1;
  const paidOrderIds = new Set(
    src.paidPayments
      .filter((p) => {
        if (!p.paidAt) return false;
        const t = new Date(p.paidAt).getTime();
        return t >= fromStart && t <= toEnd;
      })
      .map((p) => p.orderId),
  );
  const agg = new Map<string, { menuName: string; quantity: number; revenue: number }>();
  for (const oid of paidOrderIds) {
    for (const item of src.itemsByOrder(oid)) {
      // รางวัลราคา 0 ไม่สร้างรายรับ — ข้ามรายการราคา 0 จากยอดขาย
      if (item.unitPrice <= 0) continue;
      const cur = agg.get(item.menuId) ?? { menuName: item.menuName, quantity: 0, revenue: 0 };
      cur.quantity += item.quantity;
      cur.revenue = roundBaht2(cur.revenue + item.lineTotal);
      agg.set(item.menuId, cur);
    }
  }
  return [...agg.entries()]
    .map(([menuId, v]) => ({ menuId, menuName: v.menuName, quantity: v.quantity, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, limit);
}

export interface FinancePeakHourSource {
  from: string;
  to: string;
  paidPayments: { amount: number; paidAt: string | null }[];
}

export function buildFinancePeakHours(src: FinancePeakHourSource): FinancePeakHour[] {
  const fromStart = new Date(bangkokDayStartUtc(src.from)).getTime();
  const toEnd = new Date(bangkokDayStartUtc(src.to)).getTime() + 86400000 - 1;
  const hours: { paidOrders: number; revenue: number }[] = Array.from({ length: 24 }, () => ({
    paidOrders: 0,
    revenue: 0,
  }));
  for (const p of src.paidPayments) {
    if (!p.paidAt) continue;
    const t = new Date(p.paidAt).getTime();
    if (t < fromStart || t > toEnd) continue;
    const h = bangkokWallParts(p.paidAt).hour;
    hours[h]!.paidOrders += 1;
    hours[h]!.revenue = roundBaht2(hours[h]!.revenue + p.amount);
  }
  // คืนเฉพาะชั่วโมงที่มีกิจกรรม (dashboard เติม 0 เองเมื่อต้องการครบ 24 ชม.)
  return hours
    .map((h, hour) => ({ hour, paidOrders: h.paidOrders, revenue: h.revenue }))
    .filter((h) => h.paidOrders > 0);
}

export interface MemoryStoreOptions {
  /**
   * seam สำหรับทดสอบ atomicity: คืน true แล้ว audit() จะโยน error
   * (ใช้พิสูจน์ว่าไม่มี partial state/audit เมื่อ audit ล้มเหลว)
   */
  failAudit?: (input: AuditInput) => boolean;
}

export function createMemoryStore(opts?: MemoryStoreOptions): Store {
  const failAudit = opts?.failAudit;
  const users = new Map<string, User>();
  const byName = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const audits: AuditEntry[] = [];
  let auditSeq = 1;
  // ---- Ticket 02 memory state (tests เท่านั้น) ----
  let shopName = DEFAULT_SHOP_NAME;
  let schedule: WeeklySchedule = defaultWeeklySchedule();
  let override: ShopOverride | null = null;
  const tables = new Map<string, ShopTable>();
  // ---- Ticket 04 memory state: เมนู (tests + dev ที่ไม่มี MySQL) ----
  const menuItems = new Map<string, MenuItem>();
  // ---- Ticket 05 memory state: คำสั่งซื้อ (tests เท่านั้น — runtime จริงใช้ MySQL) ----
  const orders = new Map<string, Order>();
  const orderItems = new Map<string, OrderItem[]>();
  const ordersByNumber = new Map<string, string>();
  const ordersByIdemKey = new Map<string, string>();
  // ---- Ticket 06 memory state: การจอง + รอบการใช้โต๊ะ ----
  const reservations = new Map<string, Reservation>();
  const reservationsByCode = new Map<string, string>();
  const reservationsByIdemKey = new Map<string, string>();
  const tableRounds = new Map<string, TableRound>();
  const roundsByReservation = new Map<string, string>();
  /**
   * คิว serialize สำหรับ mutation การจอง/เช็กอินฝั่ง memory (กัน concurrent
   * ชนกันแบบ Promise.all: ตรวจแล้วแทรกต้องเกิดทีละรายการ)
   */
  let reservationQueue: Promise<unknown> = Promise.resolve();
  // ---- Ticket 07 memory state: ตัวเลือกเมนู/วัตถุดิบ/สูตร/ledger/ยอดจองของคำสั่งซื้อ ----
  const optionGroups = new Map<string, MenuOptionGroup>();
  const menuOptions = new Map<string, MenuOption>();
  const ingredients = new Map<string, Ingredient>();
  const ingredientByName = new Map<string, string>();
  const recipes = new Map<string, Recipe>();
  const recipeVersionsByTarget = new Map<string, Recipe[]>();
  const stockLedger: StockLedgerEntry[] = [];
  /** ยอดวัตถุดิบที่จองให้แต่ละคำสั่งซื้อ (คงที่ตอนยืนยัน — ไม่เปลี่ยนตามสูตรภายหลัง) */
  const orderStockUsage = new Map<string, { ingredientId: string; qty: number }[]>();
  // ---- Ticket 08 memory state: การชำระเงิน/ใบเสร็จ/คืนเงิน (local-first, ไม่มี network) ----
  const payments = new Map<string, Payment>();
  const paymentsByOrder = new Map<string, string>();
  const paymentsByIdemKey = new Map<string, string>();
  const paymentEvents: PaymentEvent[] = [];
  const paymentEventsByProviderKey = new Map<string, string>();
  const receipts = new Map<string, Receipt>();
  const receiptsByNumber = new Map<string, string>();
  const refunds = new Map<string, Refund>();
  // ---- Ticket 09 memory state: งานคิวครัว/เครื่องดื่ม + กำลังผลิตต่อฝ่าย ----
  const queueJobs = new Map<string, QueueJob>();
  /** หนึ่ง payment สร้าง jobs ได้ชุดเดียว (idempotency guard — เรียกซ้ำเป็น no-op) */
  const queueByPayment = new Map<string, string[]>();
  const queueByOrder = new Map<string, string[]>();
  const stationCapacity = new Map<QueueStation, { perSlot: number; updatedBy: string | null; updatedAt: string }>();
  // ---- Ticket 10 memory state: คะแนนสะสม + รางวัล (ledger append-only) ----
  const loyaltyLedger: LoyaltyTransaction[] = [];
  const rewards = new Map<string, Reward>();
  const redemptions = new Map<string, RewardRedemption>();
  const redemptionsByIdem = new Map<string, string>();
  const redemptionsByCode = new Map<string, string>();
  const walkinTokens = new Map<string, WalkinQrToken>();
  const walkinsByCode = new Map<string, string>();
  const guestClaims = new Map<string, GuestLinkClaim>();
  const guestClaimsByOrder = new Map<string, string>();
  const merges = new Map<string, CustomerMergeRecord>();
  const mergesByPair = new Map<string, string>();
  const reversals = new Map<string, LoyaltyReversal>();
  const reversalsByRefund = new Map<string, string>();
  /** งานคิวรางวัลผูก redemption (consume ครั้งเดียว — เรียกซ้ำคืนงานเดิม) */
  const rewardJobsByRedemption = new Map<string, string>();
  /**
   * คิว serialize สำหรับ mutation คำสั่งซื้อ+สต๊อกฝั่ง memory (กัน concurrent
   * แย่งวัตถุดิบชิ้นสุดท้าย: ตรวจพร้อมขายแล้วจองต้องเกิดทีละรายการ)
   */
  let orderQueue: Promise<unknown> = Promise.resolve();
  // ---- Ticket 03 memory state: บัญชีลูกค้า + เซสชัน + LINE (แยกจาก staff โดยสิ้นเชิง) ----
  const customers = new Map<string, Customer>();
  const customersByPhone = new Map<string, string>();
  const customersByEmail = new Map<string, string>();
  const customerSessions = new Map<string, CustomerSession>();
  const lineLinks = new Map<string, CustomerLineLink>();
  const lineLinksBySubject = new Map<string, string>();
  const lineTx = new Map<string, LineLoginTx>();
  // ---- Ticket 11 memory state: รายการเงินมือ (รายรับจาก paid orders  derived ไม่เก็บที่นี่) ----
  const financeEntries = new Map<string, FinanceEntry>();
  // ---- Ticket 12 memory state: outbox แจ้งเตือน LINE + consent (tests เท่านั้น) ----
  const notifications = new Map<string, Notification>();
  /** หนึ่ง eventKey → หนึ่งแถว (exactly-once เชิงตรรกะ) */
  const notificationsByEventKey = new Map<string, string>();
  /** opt-out รับแจ้งเตือน (ไม่มีแถว = เปิด) */
  const notificationConsents = new Map<string, boolean>();
  // ---- Ticket 13 memory state: โมเดลพยากรณ์ + features (tests เท่านั้น) ----
  let predictionModel: PredictionModel = {
    version: PREDICTION_BASELINE_VERSION,
    kind: "baseline",
    enabled: true,
    thresholdMinutes: PREDICTION_DEFAULT_THRESHOLD_MINUTES,
    timeoutMs: PREDICTION_DEFAULT_TIMEOUT_MS,
    samples: 0,
    maeBaseline: null,
    maeModel: null,
    trainedAt: null,
    updatedBy: null,
    updatedAt: nowIso(),
  };
  const predictionFeatures = new Map<string, PredictionFeature>();

  function cloneSchedule(s: WeeklySchedule): WeeklySchedule {
    return normalizeWeeklySchedule(JSON.parse(JSON.stringify(s)) as unknown);
  }

  function cloneTables(): Map<string, ShopTable> {
    return new Map([...tables].map(([id, t]) => [id, { ...t }] as const));
  }

  interface ShopStateBackup {
    shopName: string;
    schedule: WeeklySchedule;
    override: ShopOverride | null;
    tables: Map<string, ShopTable>;
    auditsLen: number;
    auditSeq: number;
  }

  /** all-or-nothing ฝั่ง memory: เก็บ backup ก่อน mutate; พังตรงไหนก็ restore ทั้งหมด */
  function backupShop(): ShopStateBackup {
    return {
      shopName,
      schedule: cloneSchedule(schedule),
      override: override ? { ...override } : null,
      tables: cloneTables(),
      auditsLen: audits.length,
      auditSeq,
    };
  }

  function restoreShop(b: ShopStateBackup): void {
    shopName = b.shopName;
    schedule = b.schedule;
    override = b.override;
    tables.clear();
    for (const [id, t] of b.tables) tables.set(id, t);
    audits.length = b.auditsLen;
    auditSeq = b.auditSeq;
  }

  interface MenuStateBackup extends ShopStateBackup {
    menu: Map<string, MenuItem>;
  }

  /** backup รวม shop audit + เมนู (mutation เมนูต้อง rollback audit ด้วยเสมอ) */
  function backupMenu(): MenuStateBackup {
    return {
      ...backupShop(),
      menu: new Map([...menuItems].map(([id, m]) => [id, { ...m }] as const)),
    };
  }

  function restoreMenu(b: MenuStateBackup): void {
    restoreShop({ shopName: b.shopName, schedule: b.schedule, override: b.override, tables: b.tables, auditsLen: b.auditsLen, auditSeq: b.auditSeq });
    menuItems.clear();
    for (const [id, m] of b.menu) menuItems.set(id, m);
  }

  interface OrderStateBackup extends ShopStateBackup {
    orders: Map<string, Order>;
    items: Map<string, OrderItem[]>;
    byNumber: Map<string, string>;
    byIdemKey: Map<string, string>;
    // Ticket 07: คำสั่งซื้อแตะสต๊อก (จอง/คืนยอดจอง) จึงต้อง rollback พร้อมกัน
    ingredients: Map<string, Ingredient>;
    byIngredientName: Map<string, string>;
    recipes: Map<string, Recipe>;
    recipesByTarget: Map<string, Recipe[]>;
    ledger: StockLedgerEntry[];
    usage: Map<string, { ingredientId: string; qty: number }[]>;
  }

  /** backup รวม shop audit + คำสั่งซื้อ + สต๊อก (mutation คำสั่งซื้อต้อง rollback audit ด้วยเสมอ) */
  function backupOrders(): OrderStateBackup {
    return {
      ...backupShop(),
      orders: new Map([...orders].map(([id, o]) => [id, { ...o }] as const)),
      items: new Map([...orderItems].map(([id, list]) => [id, list.map((i) => ({ ...i, selectedOptions: i.selectedOptions.map((s) => ({ ...s })) }))] as const)),
      byNumber: new Map(ordersByNumber),
      byIdemKey: new Map(ordersByIdemKey),
      ingredients: new Map([...ingredients].map(([id, g]) => [id, { ...g }] as const)),
      byIngredientName: new Map(ingredientByName),
      recipes: new Map([...recipes].map(([id, r]) => [id, { ...r, lines: r.lines.map((l) => ({ ...l })) }] as const)),
      recipesByTarget: new Map([...recipeVersionsByTarget].map(([k, list]) => [k, list.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) }))] as const)),
      ledger: stockLedger.map((e) => ({ ...e })),
      usage: new Map([...orderStockUsage].map(([k, list]) => [k, list.map((u) => ({ ...u }))] as const)),
    };
  }

  function restoreOrders(b: OrderStateBackup): void {
    restoreShop({ shopName: b.shopName, schedule: b.schedule, override: b.override, tables: b.tables, auditsLen: b.auditsLen, auditSeq: b.auditSeq });
    orders.clear();
    for (const [id, o] of b.orders) orders.set(id, o);
    orderItems.clear();
    for (const [id, list] of b.items) orderItems.set(id, list);
    ordersByNumber.clear();
    for (const [k, v] of b.byNumber) ordersByNumber.set(k, v);
    ordersByIdemKey.clear();
    for (const [k, v] of b.byIdemKey) ordersByIdemKey.set(k, v);
    ingredients.clear();
    for (const [id, g] of b.ingredients) ingredients.set(id, g);
    ingredientByName.clear();
    for (const [k, v] of b.byIngredientName) ingredientByName.set(k, v);
    recipes.clear();
    for (const [id, r] of b.recipes) recipes.set(id, r);
    recipeVersionsByTarget.clear();
    for (const [k, list] of b.recipesByTarget) recipeVersionsByTarget.set(k, list);
    stockLedger.length = 0;
    for (const e of b.ledger) stockLedger.push(e);
    orderStockUsage.clear();
    for (const [k, list] of b.usage) orderStockUsage.set(k, list);
  }

  interface PaymentStateBackup extends ShopStateBackup {
    orders: Map<string, Order>;
    payments: Map<string, Payment>;
    byOrder: Map<string, string>;
    byIdemKey: Map<string, string>;
    events: PaymentEvent[];
    eventsByKey: Map<string, string>;
    receipts: Map<string, Receipt>;
    receiptsByNumber: Map<string, string>;
    refunds: Map<string, Refund>;
    // refund แตะสต๊อก (คืนยอดจอง) จึงต้อง rollback พร้อมกัน
    ingredients: Map<string, Ingredient>;
    ledger: StockLedgerEntry[];
    usage: Map<string, { ingredientId: string; qty: number }[]>;
    // Ticket 09: ชำระสำเร็จสร้าง queue jobs ใน seam เดียวกัน — rollback พร้อมกัน
    queue: Map<string, QueueJob>;
    queueByPayment: Map<string, string[]>;
    queueByOrder: Map<string, string[]>;
    capacity: Map<QueueStation, { perSlot: number; updatedBy: string | null; updatedAt: string }>;
    // Ticket 10: hooks สะสม/ย้อนคะแนนเขียน ledger ใน seam เดียวกัน — rollback พร้อมกัน
    customers: Map<string, Customer>;
    customersByPhone: Map<string, string>;
    customersByEmail: Map<string, string>;
    lineLinks: Map<string, CustomerLineLink>;
    lineLinksBySubject: Map<string, string>;
    loyalty: LoyaltyTransaction[];
    rewardMap: Map<string, Reward>;
    redemptionMap: Map<string, RewardRedemption>;
    redemptionByIdem: Map<string, string>;
    redemptionByCode: Map<string, string>;
    walkinMap: Map<string, WalkinQrToken>;
    walkinByCode: Map<string, string>;
    guestClaimMap: Map<string, GuestLinkClaim>;
    guestClaimByOrder: Map<string, string>;
    mergeMap: Map<string, CustomerMergeRecord>;
    mergeByPair: Map<string, string>;
    reversalMap: Map<string, LoyaltyReversal>;
    reversalByRefund: Map<string, string>;
    rewardJobs: Map<string, string>;
  }

  /** backup สำหรับ mutation การชำระเงิน (payment + order status + stock + audit แบบ all-or-nothing) */
  function backupPayments(): PaymentStateBackup {
    return {
      ...backupShop(),
      orders: new Map([...orders].map(([id, o]) => [id, { ...o }] as const)),
      payments: new Map([...payments].map(([id, p]) => [id, { ...p }] as const)),
      byOrder: new Map(paymentsByOrder),
      byIdemKey: new Map(paymentsByIdemKey),
      events: paymentEvents.map((e) => ({ ...e })),
      eventsByKey: new Map(paymentEventsByProviderKey),
      receipts: new Map([...receipts].map(([id, r]) => [id, { ...r, items: r.items.map((i) => ({ ...i })) }] as const)),
      receiptsByNumber: new Map(receiptsByNumber),
      refunds: new Map([...refunds].map(([id, r]) => [id, { ...r }] as const)),
      ingredients: new Map([...ingredients].map(([id, g]) => [id, { ...g }] as const)),
      ledger: stockLedger.map((e) => ({ ...e })),
      usage: new Map([...orderStockUsage].map(([k, list]) => [k, list.map((u) => ({ ...u }))] as const)),
      queue: new Map([...queueJobs].map(([id, j]) => [id, { ...j }] as const)),
      queueByPayment: new Map([...queueByPayment].map(([k, v]) => [k, [...v]] as const)),
      queueByOrder: new Map([...queueByOrder].map(([k, v]) => [k, [...v]] as const)),
      capacity: new Map([...stationCapacity].map(([k, v]) => [k, { ...v }] as const)),
      customers: new Map([...customers].map(([id, c]) => [id, { ...c }] as const)),
      customersByPhone: new Map(customersByPhone),
      customersByEmail: new Map(customersByEmail),
      lineLinks: new Map([...lineLinks].map(([k, v]) => [k, { ...v }] as const)),
      lineLinksBySubject: new Map(lineLinksBySubject),
      loyalty: loyaltyLedger.map((e) => ({ ...e })),
      rewardMap: new Map([...rewards].map(([id, r]) => [id, { ...r }] as const)),
      redemptionMap: new Map([...redemptions].map(([id, r]) => [id, { ...r }] as const)),
      redemptionByIdem: new Map(redemptionsByIdem),
      redemptionByCode: new Map(redemptionsByCode),
      walkinMap: new Map([...walkinTokens].map(([id, t]) => [id, { ...t }] as const)),
      walkinByCode: new Map(walkinsByCode),
      guestClaimMap: new Map([...guestClaims].map(([id, c]) => [id, { ...c }] as const)),
      guestClaimByOrder: new Map(guestClaimsByOrder),
      mergeMap: new Map([...merges].map(([id, m]) => [id, { ...m }] as const)),
      mergeByPair: new Map(mergesByPair),
      reversalMap: new Map([...reversals].map(([id, r]) => [id, { ...r }] as const)),
      reversalByRefund: new Map(reversalsByRefund),
      rewardJobs: new Map(rewardJobsByRedemption),
    };
  }

  function restorePayments(b: PaymentStateBackup): void {
    restoreShop({ shopName: b.shopName, schedule: b.schedule, override: b.override, tables: b.tables, auditsLen: b.auditsLen, auditSeq: b.auditSeq });
    orders.clear();
    for (const [id, o] of b.orders) orders.set(id, o);
    payments.clear();
    for (const [id, p] of b.payments) payments.set(id, p);
    paymentsByOrder.clear();
    for (const [k, v] of b.byOrder) paymentsByOrder.set(k, v);
    paymentsByIdemKey.clear();
    for (const [k, v] of b.byIdemKey) paymentsByIdemKey.set(k, v);
    paymentEvents.length = 0;
    for (const e of b.events) paymentEvents.push(e);
    paymentEventsByProviderKey.clear();
    for (const [k, v] of b.eventsByKey) paymentEventsByProviderKey.set(k, v);
    receipts.clear();
    for (const [id, r] of b.receipts) receipts.set(id, r);
    receiptsByNumber.clear();
    for (const [k, v] of b.receiptsByNumber) receiptsByNumber.set(k, v);
    refunds.clear();
    for (const [id, r] of b.refunds) refunds.set(id, r);
    ingredients.clear();
    for (const [id, g] of b.ingredients) ingredients.set(id, g);
    stockLedger.length = 0;
    for (const e of b.ledger) stockLedger.push(e);
    orderStockUsage.clear();
    for (const [k, list] of b.usage) orderStockUsage.set(k, list);
    queueJobs.clear();
    for (const [id, j] of b.queue) queueJobs.set(id, j);
    queueByPayment.clear();
    for (const [k, v] of b.queueByPayment) queueByPayment.set(k, v);
    queueByOrder.clear();
    for (const [k, v] of b.queueByOrder) queueByOrder.set(k, v);
    stationCapacity.clear();
    for (const [k, v] of b.capacity) stationCapacity.set(k, v);
    customers.clear();
    for (const [id, c] of b.customers) customers.set(id, c);
    customersByPhone.clear();
    for (const [k, v] of b.customersByPhone) customersByPhone.set(k, v);
    customersByEmail.clear();
    for (const [k, v] of b.customersByEmail) customersByEmail.set(k, v);
    lineLinks.clear();
    for (const [k, v] of b.lineLinks) lineLinks.set(k, v);
    lineLinksBySubject.clear();
    for (const [k, v] of b.lineLinksBySubject) lineLinksBySubject.set(k, v);
    loyaltyLedger.length = 0;
    for (const e of b.loyalty) loyaltyLedger.push(e);
    rewards.clear();
    for (const [id, r] of b.rewardMap) rewards.set(id, r);
    redemptions.clear();
    for (const [id, r] of b.redemptionMap) redemptions.set(id, r);
    redemptionsByIdem.clear();
    for (const [k, v] of b.redemptionByIdem) redemptionsByIdem.set(k, v);
    redemptionsByCode.clear();
    for (const [k, v] of b.redemptionByCode) redemptionsByCode.set(k, v);
    walkinTokens.clear();
    for (const [id, t] of b.walkinMap) walkinTokens.set(id, t);
    walkinsByCode.clear();
    for (const [k, v] of b.walkinByCode) walkinsByCode.set(k, v);
    guestClaims.clear();
    for (const [id, c] of b.guestClaimMap) guestClaims.set(id, c);
    guestClaimsByOrder.clear();
    for (const [k, v] of b.guestClaimByOrder) guestClaimsByOrder.set(k, v);
    merges.clear();
    for (const [id, m] of b.mergeMap) merges.set(id, m);
    mergesByPair.clear();
    for (const [k, v] of b.mergeByPair) mergesByPair.set(k, v);
    reversals.clear();
    for (const [id, r] of b.reversalMap) reversals.set(id, r);
    reversalsByRefund.clear();
    for (const [k, v] of b.reversalByRefund) reversalsByRefund.set(k, v);
    rewardJobsByRedemption.clear();
    for (const [k, v] of b.rewardJobs) rewardJobsByRedemption.set(k, v);
  }

  /** สถานะ derived ฝั่งคำสั่งซื้อจาก payment ล่าสุด (ไม่เปลี่ยน OrderStatus contract) */
  function orderPaymentStateOf(orderId: string): OrderPaymentState {
    const pid = paymentsByOrder.get(orderId);
    if (!pid) return "pending_payment";
    const p = payments.get(pid);
    if (!p) return "pending_payment";
    if (p.status === "paid") return "paid";
    if (p.status === "manual_review") return "manual_review";
    if (p.status === "failed" || p.status === "cancelled") return "failed";
    if (p.status === "expired") return "expired";
    if (p.status === "refunded") return "refunded";
    return "pending_payment";
  }

  /** สร้างใบเสร็จอย่างง่ายจาก payment ที่ paid แล้ว (เลข RCP กันชนด้วยการ retry ที่ caller) */
  function buildReceipt(p: Payment, detail: OrderDetail, now: Date): Receipt {
    return {
      receiptNumber: p.receiptNumber!,
      paymentId: p.id,
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      shopName,
      method: p.method,
      amount: p.amount,
      receivedAmount: p.receivedAmount,
      changeAmount: p.changeAmount,
      paidAt: p.paidAt!,
      items: detail.items.map((i) => ({
        menuName: i.menuName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      createdAt: now.toISOString(),
    };
  }

  /**
   * Ticket 08 memory helpers (ใช้ใน seams ชำระเงิน — ห้ามเรียกนอก runOrderExclusive):
   * - expireIfDue: intent เกินเวลาชำระ → expired + audit (ambiguous timeout ตรวจมือผ่าน manual_review แยกต่างหาก)
   * - recordPaymentEvent: บันทึก event แบบ append-only (dedupe ด้วย providerEventId)
   * - markPaymentPaid: pending/manual_review → paid + ออกใบเสร็จ (เลข RCP กันชน)
   *   ไม่แตะสต๊อกซ้ำ (จองไว้แล้วตอนยืนยัน); queue (Ticket 09) / points (Ticket 10)
   *   เป็น no-op ที่มี idempotency guard (payment id เป็นคีย์กันซ้ำ)
   */
  function expireIfDue(p: Payment, now: Date, actor: ShopActor): void {
    if (p.status !== "pending") return;
    if (new Date(p.expiresAt).getTime() >= now.getTime()) return;
    const input = {
      actorId: actor.actorId ?? null,
      actorUsername: actor.actorUsername ?? null,
      action: "payment_expired",
      targetId: p.id,
      targetUsername: null,
      detail: `คำขอชำระ ${p.orderNumber} หมดอายุ (เกินเวลาชำระ)`,
      ip: actor.ip ?? null,
      success: true,
    };
    // seam เดียวกับ writeAudit (failAudit ใน tests ต้อง rollback ทั้ง state เช่นกัน)
    if (failAudit?.(input)) throw new Error("บันทึก audit ล้มเหลว (จำลองสำหรับทดสอบ)");
    p.status = "expired";
    p.updatedAt = now.toISOString();
    audits.push({ id: auditSeq++, at: now.toISOString(), ...input });
  }

  function recordPaymentEvent(
    paymentId: string,
    providerEventId: string,
    outcome: ProviderOutcome,
    summary: string | null,
    now: Date,
  ): void {
    const kind = outcome === "success" ? "success" : outcome === "ambiguous" ? "ambiguous" : "fail";
    const ev: PaymentEvent = {
      id: randomUUID(),
      paymentId,
      providerEventId,
      kind,
      summary: summary ?? `ผล ${outcome} จากผู้ให้บริการ`,
      createdAt: now.toISOString(),
    };
    paymentEvents.push(ev);
    paymentEventsByProviderKey.set(providerEventId, ev.id);
  }

  async function markPaymentPaid(
    p: Payment,
    order: Order,
    reason: string,
    actor: ShopActor,
    now: Date,
  ): Promise<Receipt> {
    assertPaymentTransition(p.status, "paid");
    const before = { status: p.status as PaymentStatus };
    let receiptNumber = generateReceiptNumber(now);
    for (let i = 0; i < 5 && receiptsByNumber.has(receiptNumber); i += 1) {
      receiptNumber = generateReceiptNumber(now);
    }
    if (receiptsByNumber.has(receiptNumber)) {
      throw new ConflictError("สร้างเลขใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    p.status = "paid";
    p.paidAt = now.toISOString();
    p.receiptNumber = receiptNumber;
    p.updatedAt = now.toISOString();
    const detail = toDetail(order.id)!;
    const receipt = buildReceipt(p, detail, now);
    receipts.set(p.id, { ...receipt, items: receipt.items.map((i) => ({ ...i })) });
    receiptsByNumber.set(receiptNumber, p.id);
    await writeAudit(paymentStatusChangedEvent(before, { ...p }, reason, actor));
    // Ticket 09: ชำระสำเร็จสร้าง queue jobs แบบ exactly-once (payment นี้ชุดเดียว — เรียกซ้ำ no-op)
    await ensureQueueJobsInternal(p, detail, actor, now);
    // Ticket 10: สะสมคะแนนอัตโนมัติแบบ no-op (ยังไม่ส่งมอบ = ไม่เข้าเงื่อนไข ยังไม่เขียน ledger)
    await tryAutoEarnForOrderInternal(order.id, actor, now);
    return { ...receipt, items: receipt.items.map((i) => ({ ...i })) };
  }

  // ---- Ticket 09 memory helpers: งานคิวครัว/เครื่องดื่ม (เรียกใน runOrderExclusive เท่านั้น) ----

  function toQueueDetail(id: string): QueueJobDetail | null {
    const j = queueJobs.get(id);
    if (!j) return null;
    const tableName = j.tableId ? (tables.get(j.tableId)?.name ?? null) : null;
    return { ...j, tableName };
  }

  function capacityOf(station: QueueStation): { perSlot: number; updatedBy: string | null; updatedAt: string } {
    const c = stationCapacity.get(station);
    if (c) return { ...c };
    return { perSlot: QUEUE_DEFAULT_CAPACITY_PER_SLOT, updatedBy: null, updatedAt: nowIso() };
  }

  /**
   * สร้าง jobs จาก payment ที่ paid แล้วแบบ exactly-once (guard ด้วย queueByPayment):
   * - มีแล้ว → คืนชุดเดิม (ไม่เขียน audit ซ้ำ)
   * - หนึ่ง OrderItem → หนึ่ง job; ฝ่ายจาก menu kind; readyAt ทั่วไป = paidAt
   *   preorder = scheduledAt − เวลาทำประมาณการของฝ่าย
   */
  async function ensureQueueJobsInternal(
    p: Payment,
    detail: OrderDetail,
    actor: ShopActor,
    now: Date,
  ): Promise<QueueJob[]> {
    const existing = queueByPayment.get(p.id);
    if (existing) {
      return existing.map((id) => ({ ...queueJobs.get(id)! }));
    }
    const paidAt = p.paidAt ? new Date(p.paidAt) : now;
    const created: QueueJob[] = [];
    for (const item of detail.items) {
      const menu = menuItems.get(item.menuId);
      const station = classifyStation(menu?.kind ?? "food");
      const readyAt = computeReadyAt({
        serviceType: detail.serviceType,
        scheduledAt: detail.scheduledAt,
        paidAt,
        station,
      });
      const at = now.toISOString();
      const job: QueueJob = {
        id: randomUUID(),
        orderId: detail.id,
        orderNumber: detail.orderNumber,
        paymentId: p.id,
        orderItemId: item.id,
        menuId: item.menuId,
        menuName: item.menuName,
        station,
        quantity: item.quantity,
        readyQty: 0,
        deliveredQty: 0,
        status: "queued",
        readyAt,
        tableId: detail.tableId,
        roundId: detail.roundId,
        isRemake: false,
        isPriority: false,
        reason: null,
        claimedBy: null,
        rewardRedemptionId: null,
        createdAt: at,
        updatedAt: at,
      };
      queueJobs.set(job.id, job);
      created.push(job);
    }
    queueByPayment.set(p.id, created.map((j) => j.id));
    const orderList = queueByOrder.get(detail.id) ?? [];
    queueByOrder.set(detail.id, [...orderList, ...created.map((j) => j.id)]);
    for (const job of created) {
      await writeAudit(queueCreatedEvent({ ...job }, actor));
    }
    return created.map((j) => ({ ...j }));
  }

  /** นับงานในสล็อต 15 นาทีของฝ่าย (ไม่นับงานที่ยกเลิกแล้ว) */
  function countJobsInSlot(station: QueueStation, slotStart: Date): number {
    let n = 0;
    for (const j of queueJobs.values()) {
      if (j.station !== station || j.status === "cancelled") continue;
      if (slotStartOf(new Date(j.readyAt)).getTime() === slotStart.getTime()) n += 1;
    }
    return n;
  }

  // ---- Ticket 13 memory helpers: งาน active สำหรับพยากรณ์ + occupancy โต๊ะ ----

  /** งานที่กินกำลังผลิตจริง: queued/claimed/preparing ที่ readyAt ถึงแล้ว (ไม่นับ ready/delivered/cancelled) */
  function activePredictionJobs(now: Date): QueueJob[] {
    const t = now.getTime();
    return [...queueJobs.values()].filter(
      (j) =>
        (j.status === "queued" || j.status === "claimed" || j.status === "preparing") &&
        new Date(j.readyAt).getTime() <= t,
    );
  }

  function memoryTableOccupancy(): { enabledTables: number; freeTables: number; occupiedTables: number; customerCount: number } {
    const enabledTables = [...tables.values()].filter((x) => x.isEnabled);
    const openRounds = [...tableRounds.values()].filter((r) => r.status === "open");
    const occupied = new Set(openRounds.map((r) => r.tableId)).size;
    return {
      enabledTables: enabledTables.length,
      freeTables: enabledTables.length - occupied,
      occupiedTables: occupied,
      customerCount: openRounds.reduce((s, r) => s + r.partySize, 0),
    };
  }

  /**
   * ตรวจว่า payment/order หยุดเดินต่อหรือยัง (คืนเงิน/ยกเลิกแล้ว)
   * orderId null = งานรางวัล (ไม่ผูกคำสั่งซื้อ — ข้ามการตรวจ)
   */
  function assertQueueOrderActive(orderId: string | null): Order | null {
    if (orderId === null) return null;
    const order = orders.get(orderId);
    if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
    if (order.status === "cancelled") {
      throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว งานคิวหยุดเดินต่อ");
    }
    const pid = paymentsByOrder.get(orderId);
    if (pid) {
      const pay = payments.get(pid);
      if (pay && pay.status === "refunded") {
        throw new ConflictError("คำสั่งซื้อนี้คืนเงินแล้ว งานคิวหยุดเดินต่อ");
      }
    }
    return order;
  }

  // ---- Ticket 10 memory helpers: คะแนน/รางวัล (เรียกใน runOrderExclusive เท่านั้น) ----

  /** ยอดคงเหลือ derived = ผลรวมธุรกรรม (reserve กันวงเงินแยก ไม่หักจนกว่า consume) */
  function loyaltyBalanceOf(customerId: string): number {
    let sum = 0;
    for (const e of loyaltyLedger) {
      if (e.customerId === customerId) sum += e.points;
    }
    return sum;
  }

  /** คะแนนที่กันไว้จากรายการแลกสถานะ reserved (ยังไม่หักถาวร) */
  function loyaltyHeldOf(customerId: string): number {
    let sum = 0;
    for (const r of redemptions.values()) {
      if (r.customerId === customerId && r.status === "reserved") sum += r.pointsCost;
    }
    return sum;
  }

  /** จำนวนสิทธิ์ที่กันไว้ของรางวัล (reserved ยังไม่นับใน quotaUsed) */
  function rewardHeldCount(rewardId: string): number {
    let n = 0;
    for (const r of redemptions.values()) {
      if (r.rewardId === rewardId && r.status === "reserved") n += 1;
    }
    return n;
  }

  /** คะแนนที่สะสมแล้วของ order item นี้ (source order เท่านั้น — ไม่นับ reversal) */
  function earnedForOrderItem(orderItemId: string): number {
    let sum = 0;
    for (const e of loyaltyLedger) {
      if (e.orderItemId === orderItemId && e.source === "order") sum += e.points;
    }
    return sum;
  }

  function appendLoyaltyTx(
    tx: Omit<LoyaltyTransaction, "id" | "createdAt">,
    now: Date,
  ): LoyaltyTransaction {
    const row: LoyaltyTransaction = { ...tx, id: randomUUID(), createdAt: now.toISOString() };
    loyaltyLedger.push(row);
    return { ...row };
  }

  /**
   * สะสมคะแนนให้คำสั่งซื้อแบบ exactly-once (no-op เมื่อยังไม่เข้าเงื่อนไขหรือสะสมครบแล้ว):
   * - ต้องมี payment paid + ไม่ถูกยกเลิก + ผูกบัญชีลูกค้าที่ใช้งานได้
   * - นับเฉพาะรายการเครื่องดื่ม (kind drink) ที่ราคา > 0 (รางวัลราคา 0 ไม่ได้คะแนน)
   * - ต่อหน่วย: ส่งมอบแล้ว (deliveredQty ของ jobs ฝ่าย drink) หรือปิดงาน completed
   *   ก็นับเต็มจำนวน; จำกัดไม่เกินจำนวนรายการ (กัน remake นับซ้ำ)
   */
  async function tryAutoEarnForOrderInternal(
    orderId: string,
    actor: ShopActor,
    now: Date,
  ): Promise<number> {
    const order = orders.get(orderId);
    if (!order || order.status === "cancelled") return 0;
    if (!order.customerId) return 0;
    const customer = customers.get(order.customerId);
    if (!customer || customer.isDeleted || !customer.isActive) return 0;
    const pid = paymentsByOrder.get(order.id);
    const pay = pid ? payments.get(pid) : undefined;
    if (!pay || pay.status !== "paid") return 0;
    const items = orderItems.get(order.id) ?? [];
    let earned = 0;
    for (const item of items) {
      const menu = menuItems.get(item.menuId);
      if (!menu || menu.kind !== "drink") continue;
      if (item.unitPrice <= 0) continue;
      let eligible: number;
      if (order.status === "completed") {
        eligible = item.quantity;
      } else {
        let delivered = 0;
        for (const j of queueJobs.values()) {
          if (
            j.orderId === order.id &&
            j.orderItemId === item.id &&
            j.station === "drink" &&
            j.rewardRedemptionId === null &&
            j.status !== "cancelled"
          ) {
            delivered += j.deliveredQty;
          }
        }
        eligible = Math.min(item.quantity, delivered);
      }
      const todo = eligible - earnedForOrderItem(item.id);
      if (todo <= 0) continue;
      const points = todo * LOYALTY_POINTS_PER_DRINK_UNIT;
      const tx = appendLoyaltyTx(
        {
          customerId: customer.id,
          points,
          source: "order",
          orderId: order.id,
          paymentId: pay.id,
          orderItemId: item.id,
          redemptionId: null,
          walkinTokenId: null,
          reason: `สะสมจากคำสั่งซื้อ ${order.orderNumber} (${item.menuName} ×${todo})`,
          actorId: actor.actorId ?? null,
          actorUsername: actor.actorUsername ?? null,
        },
        now,
      );
      await writeAudit(loyaltyEarnedEvent(tx, actor));
      earned += points;
    }
    return earned;
  }

  /**
   * ย้อนคะแนนเมื่อคืนเงินแบบ idempotent (refund เดิมเรียกซ้ำ = คืนของเดิม):
   * - ย้อนเฉพาะคะแนน earn (source order) ที่สะสมไปแล้วของคำสั่งซื้อนี้
   * - append-only (ติดลบได้) รักษาประวัติเดิม ไม่ลบธุรกรรม
   */
  async function reversePointsOnRefundInternal(
    orderId: string,
    refundId: string,
    actor: ShopActor,
    now: Date,
  ): Promise<{ reversal: LoyaltyReversal; deduplicated: boolean }> {
    const existingId = reversalsByRefund.get(refundId);
    if (existingId) {
      return { reversal: { ...reversals.get(existingId)! }, deduplicated: true };
    }
    const order = orders.get(orderId);
    if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
    const customerId = order.customerId ?? "";
    let earned = 0;
    if (customerId) {
      for (const e of loyaltyLedger) {
        if (e.orderId === orderId && e.source === "order" && e.customerId === customerId) {
          earned += e.points;
        }
      }
    }
    if (earned > 0 && customerId) {
      appendLoyaltyTx(
        {
          customerId,
          points: -earned,
          source: "refund",
          orderId,
          paymentId: null,
          orderItemId: null,
          redemptionId: null,
          walkinTokenId: null,
          reason: `ย้อนคะแนนจากคำสั่งซื้อ ${order.orderNumber} ที่คืนเงิน`,
          actorId: actor.actorId ?? null,
          actorUsername: actor.actorUsername ?? null,
        },
        now,
      );
    }
    const at = now.toISOString();
    const reversal: LoyaltyReversal = {
      id: randomUUID(),
      orderId,
      refundId,
      customerId,
      points: earned,
      createdAt: at,
    };
    reversals.set(reversal.id, { ...reversal });
    reversalsByRefund.set(refundId, reversal.id);
    await writeAudit(pointsReversedEvent(orderId, customerId || "-", earned, refundId, actor));
    return { reversal: { ...reversal }, deduplicated: false };
  }

  interface InventoryStateBackup extends ShopStateBackup {
    optionGroups: Map<string, MenuOptionGroup>;
    options: Map<string, MenuOption>;
    ingredients: Map<string, Ingredient>;
    byIngredientName: Map<string, string>;
    recipes: Map<string, Recipe>;
    recipesByTarget: Map<string, Recipe[]>;
    ledger: StockLedgerEntry[];
  }

  /** backup สำหรับ mutation ตัวเลือก/วัตถุดิบ/สูตร/ledger ล้วน (ไม่แตะคำสั่งซื้อ) */
  function backupInventory(): InventoryStateBackup {
    return {
      ...backupShop(),
      optionGroups: new Map([...optionGroups].map(([id, g]) => [id, { ...g }] as const)),
      options: new Map([...menuOptions].map(([id, o]) => [id, { ...o }] as const)),
      ingredients: new Map([...ingredients].map(([id, g]) => [id, { ...g }] as const)),
      byIngredientName: new Map(ingredientByName),
      recipes: new Map([...recipes].map(([id, r]) => [id, { ...r, lines: r.lines.map((l) => ({ ...l })) }] as const)),
      recipesByTarget: new Map([...recipeVersionsByTarget].map(([k, list]) => [k, list.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) }))] as const)),
      ledger: stockLedger.map((e) => ({ ...e })),
    };
  }

  function restoreInventory(b: InventoryStateBackup): void {
    restoreShop({ shopName: b.shopName, schedule: b.schedule, override: b.override, tables: b.tables, auditsLen: b.auditsLen, auditSeq: b.auditSeq });
    optionGroups.clear();
    for (const [id, g] of b.optionGroups) optionGroups.set(id, g);
    menuOptions.clear();
    for (const [id, o] of b.options) menuOptions.set(id, o);
    ingredients.clear();
    for (const [id, g] of b.ingredients) ingredients.set(id, g);
    ingredientByName.clear();
    for (const [k, v] of b.byIngredientName) ingredientByName.set(k, v);
    recipes.clear();
    for (const [id, r] of b.recipes) recipes.set(id, r);
    recipeVersionsByTarget.clear();
    for (const [k, list] of b.recipesByTarget) recipeVersionsByTarget.set(k, list);
    stockLedger.length = 0;
    for (const e of b.ledger) stockLedger.push(e);
  }

  /** รัน mutation คำสั่งซื้อ+สต๊อกทีละรายการ (serialize กัน concurrent แย่งวัตถุดิบ) */
  function runOrderExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = orderQueue.then(fn, fn);
    orderQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---- Ticket 07 memory helpers: ตัวเลือก/สูตร/สต๊อก ----

  /** กลุ่มตัวเลือกของเมนู เรียงลำดับแสดงผล (ใช้ตรวจว่าตัวเลือกเป็นของเมนูนี้) */
  function groupsOfMenu(menuId: string): MenuOptionGroup[] {
    return [...optionGroups.values()]
      .filter((g) => g.menuId === menuId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"));
  }

  function optionsOfGroup(groupId: string): MenuOption[] {
    return [...menuOptions.values()]
      .filter((o) => o.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"));
  }

  function latestRecipeOf(targetType: RecipeTargetType, targetId: string): Recipe | null {
    const list = recipeVersionsByTarget.get(`${targetType}:${targetId}`);
    if (!list || list.length === 0) return null;
    return { ...list[list.length - 1]!, lines: list[list.length - 1]!.lines.map((l) => ({ ...l })) };
  }

  function recipeKey(targetType: RecipeTargetType, targetId: string): string {
    return `${targetType}:${targetId}`;
  }

  /**
   * Ticket 07: เมนูรับคำสั่งซื้อใหม่ได้หรือไม่ (สูตรฐานล่าสุดมีพร้อมขายพอสำหรับ n หน่วย)
   * ไม่มีสูตร = ไม่ตรวจสต๊อก (สั่งได้ — คงพฤติกรรมเดิมของเมนูที่ยังไม่ผูกสูตร)
   */
  function isMenuOrderable(menuId: string, units: number): boolean {
    const recipe = latestRecipeOf("menu", menuId);
    if (!recipe) return true;
    for (const line of recipe.lines) {
      const ing = ingredients.get(line.ingredientId);
      if (!ing || !ing.isEnabled) return false;
      if (ingredientAvailable(ing) < roundStock(line.qty * units)) return false;
    }
    return true;
  }

  function toDetail(id: string): OrderDetail | null {
    const o = orders.get(id);
    if (!o) return null;
    return { ...o, items: (orderItems.get(id) ?? []).map((i) => ({ ...i })) };
  }

  // ---- Ticket 06 memory helpers: การจอง + รอบการใช้โต๊ะ ----

  interface ReservationStateBackup extends ShopStateBackup {
    reservations: Map<string, Reservation>;
    byCode: Map<string, string>;
    byIdemKey: Map<string, string>;
    rounds: Map<string, TableRound>;
    roundsByRes: Map<string, string>;
    orders: Map<string, Order>;
  }

  /** backup รวม shop audit + การจอง/รอบ + orders (ปิดรอบแตะ orders ด้วย) */
  function backupReservations(): ReservationStateBackup {
    return {
      ...backupShop(),
      reservations: new Map([...reservations].map(([id, r]) => [id, { ...r }] as const)),
      byCode: new Map(reservationsByCode),
      byIdemKey: new Map(reservationsByIdemKey),
      rounds: new Map([...tableRounds].map(([id, r]) => [id, { ...r }] as const)),
      roundsByRes: new Map(roundsByReservation),
      orders: new Map([...orders].map(([id, o]) => [id, { ...o }] as const)),
    };
  }

  function restoreReservations(b: ReservationStateBackup): void {
    restoreShop({ shopName: b.shopName, schedule: b.schedule, override: b.override, tables: b.tables, auditsLen: b.auditsLen, auditSeq: b.auditSeq });
    reservations.clear();
    for (const [id, r] of b.reservations) reservations.set(id, r);
    reservationsByCode.clear();
    for (const [k, v] of b.byCode) reservationsByCode.set(k, v);
    reservationsByIdemKey.clear();
    for (const [k, v] of b.byIdemKey) reservationsByIdemKey.set(k, v);
    tableRounds.clear();
    for (const [id, r] of b.rounds) tableRounds.set(id, r);
    roundsByReservation.clear();
    for (const [k, v] of b.roundsByRes) roundsByReservation.set(k, v);
    orders.clear();
    for (const [id, o] of b.orders) orders.set(id, o);
  }

  /** รัน mutation การจองทีละรายการ (serialize กัน concurrent ชนใน memory) */
  function runReservationExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = reservationQueue.then(fn, fn);
    // เก็บหางคิวต่อแม้ fn พัง (catch กลืนเฉพาะในหางคิว ไม่กลืนผลลัพธ์ให้ caller)
    reservationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const ACTIVE_RESERVATION: Reservation["status"][] = ["pending", "confirmed"];

  function tableNameOf(id: string): string {
    return tables.get(id)?.name ?? "-";
  }

  function toReservationDetail(r: Reservation): ReservationDetail {
    return { ...r, tableName: tableNameOf(r.tableId) };
  }

  function toRoundDetail(r: TableRound): TableRoundDetail {
    return { ...r, tableName: tableNameOf(r.tableId) };
  }

  /** โต๊ะที่ถูกบล็อกในช่วงเวลานัด = มีการจอง active ทับซ้อน (หน้าต่าง 120 นาที) */
  function blockedTablesAt(reservedAt: string, ignoreId?: string): Set<string> {
    const blocked = new Set<string>();
    for (const r of reservations.values()) {
      if (r.id === ignoreId) continue;
      if (!ACTIVE_RESERVATION.includes(r.status)) continue;
      if (isReservationOverlapping(r.reservedAt, reservedAt)) blocked.add(r.tableId);
    }
    return blocked;
  }

  // ---- Ticket 05 helpers (ใช้ร่วมกันใน memory seams ด้านล่าง) ----
  // Ticket 07: snapshot ราคา+ชื่อเมนู พร้อมตรวจตัวเลือก (ต้องเป็นของเมนูนี้และเปิดขาย)
  // คำนวณราคาต่อยูนิต = ราคาเมนู + Σ ส่วนต่างตัวเลือก และ snapshot ชื่อ/ส่วนต่างตอนยืนยัน
  async function buildOrderSnapshot(
    lines: NormalizedOrderLine[],
  ): Promise<{ name: string; price: number; menuId: string; quantity: number; note: string | null; options: OrderItemOptionSnapshot[]; specialRequest: string | null }[]> {
    const out: { name: string; price: number; menuId: string; quantity: number; note: string | null; options: OrderItemOptionSnapshot[]; specialRequest: string | null }[] = [];
    for (const line of lines) {
      const menu = menuItems.get(line.menuId);
      if (!menu || !isMenuSellable(menu)) {
        throw new ConflictError(
          `เมนู${menu ? ` "${menu.name}"` : ""} ไม่พร้อมขายแล้ว กรุณาปรับตะกร้าแล้วยืนยันใหม่อีกครั้ง`,
        );
      }
      // quantity/note ผ่าน normalizeOrderLines จาก router แล้ว — ตรวจซ้ำแบบกันพลาด
      const quantity = normalizeQuantity(line.quantity);
      const note = normalizeOrderNote(line.note);
      const specialRequest = normalizeSpecialRequest(line.specialRequest);
      const optionIds = normalizeSelectedOptionIds(line.optionIds ?? []);
      const snapshots: OrderItemOptionSnapshot[] = [];
      let deltaSum = 0;
      if (optionIds.length > 0) {
        const groups = groupsOfMenu(menu.id);
        const groupById = new Map(groups.map((g) => [g.id, g]));
        const seenGroups = new Set<string>();
        for (const optionId of optionIds) {
          const opt = menuOptions.get(optionId);
          if (!opt || opt.menuId !== menu.id) {
            throw new ConflictError(`ตัวเลือกของเมนู "${menu.name}" ไม่ถูกต้อง กรุณาเลือกใหม่`);
          }
          const group = groupById.get(opt.groupId);
          if (!group) throw new ConflictError(`ตัวเลือกของเมนู "${menu.name}" ไม่ถูกต้อง กรุณาเลือกใหม่`);
          if (!opt.isEnabled) {
            throw new ConflictError(`ตัวเลือก "${opt.name}" ปิดขายแล้ว กรุณาเลือกใหม่`);
          }
          if (seenGroups.has(opt.groupId)) {
            throw new ConflictError(`กลุ่ม "${group.name}" เลือกได้เพียง 1 ตัวเลือกต่อรายการ`);
          }
          seenGroups.add(opt.groupId);
          snapshots.push({
            groupId: group.id,
            groupName: group.name,
            optionId: opt.id,
            optionName: opt.name,
            priceDelta: opt.priceDelta,
          });
          deltaSum = roundBaht(deltaSum + opt.priceDelta);
        }
      }
      out.push({
        name: menu.name,
        price: roundBaht(menu.price + deltaSum),
        menuId: menu.id,
        quantity,
        note,
        options: snapshots,
        specialRequest,
      });
    }
    return out;
  }

  /**
   * Ticket 07: รวมความต้องการวัตถุดิบของทั้งคำสั่งซื้อจากสูตรล่าสุด
   * (สูตรฐานของเมนู + สูตรเพิ่มเติมของแต่ละตัวเลือกที่เลือก) คูณจำนวน
   * คืน用量ต่อวัตถุดิบ (ข้ามเมนู/ตัวเลือกที่ไม่มีสูตร — ไม่ตรวจสต๊อกรายการนั้น)
   * พร้อมต้นทุนประมาณการต่อหน่วยขายของแต่ละบรรทัด
   */
  function aggregateRequirements(
    priced: { menuId: string; quantity: number; options: OrderItemOptionSnapshot[] }[],
  ): { usage: Map<string, number>; unitCostOf: (menuId: string, optionIds: string[]) => number } {
    const usage = new Map<string, number>();
    const unitCostCache = new Map<string, number>();
    const add = (ingredientId: string, qty: number): void => {
      usage.set(ingredientId, roundStock((usage.get(ingredientId) ?? 0) + qty));
    };
    const costOfRecipe = (recipe: Recipe): number => {
      let cost = 0;
      for (const line of recipe.lines) {
        const ing = ingredients.get(line.ingredientId);
        // วัตถุดิบในสูตรถูกลบ/งดใช้หลังสร้างสูตรไม่ได้ (validate ตอนสร้างสูตรแล้ว)
        // เหลือเพียงกันข้อมูลเพี้ยนแบบ fail-fast
        if (!ing) throw new ConflictError("สูตรอ้างอิงวัตถุดิบที่ไม่พบ กรุณาติดต่อ Admin");
        if (!ing.isEnabled) {
          throw new ConflictError(
            `วัตถุดิบ "${ing.name}" งดใช้ชั่วคราว ทำให้เมนูบางรายการสั่งไม่ได้ กรุณาปรับรายการแล้วยืนยันใหม่อีกครั้ง`,
          );
        }
        cost = roundBaht(cost + roundBaht(line.qty * ing.latestCost));
      }
      return cost;
    };
    for (const line of priced) {
      const cacheKey = `${line.menuId}|${line.options.map((o) => o.optionId).sort().join(",")}`;
      let unitCost = unitCostCache.get(cacheKey);
      if (unitCost === undefined) {
        unitCost = 0;
        const menuRecipe = latestRecipeOf("menu", line.menuId);
        if (menuRecipe) unitCost = roundBaht(unitCost + costOfRecipe(menuRecipe));
        for (const sel of line.options) {
          const optRecipe = latestRecipeOf("option", sel.optionId);
          if (optRecipe) unitCost = roundBaht(unitCost + costOfRecipe(optRecipe));
        }
        unitCostCache.set(cacheKey, unitCost);
      }
      const menuRecipe = latestRecipeOf("menu", line.menuId);
      if (menuRecipe) {
        for (const rl of menuRecipe.lines) add(rl.ingredientId, roundStock(rl.qty * line.quantity));
      }
      for (const sel of line.options) {
        const optRecipe = latestRecipeOf("option", sel.optionId);
        if (optRecipe) {
          for (const rl of optRecipe.lines) add(rl.ingredientId, roundStock(rl.qty * line.quantity));
        }
      }
    }
    return {
      usage,
      unitCostOf: (menuId: string, optionIds: string[]) => {
        const key = `${menuId}|${[...optionIds].sort().join(",")}`;
        const hit = unitCostCache.get(key);
        if (hit !== undefined) return hit;
        // ไม่เคยคำนวณ (ไม่ควรเกิด) — คำนวณใหม่แบบกันพลาด
        let cost = 0;
        const menuRecipe = latestRecipeOf("menu", menuId);
        if (menuRecipe) cost = roundBaht(cost + costOfRecipe(menuRecipe));
        for (const optionId of optionIds) {
          const optRecipe = latestRecipeOf("option", optionId);
          if (optRecipe) cost = roundBaht(cost + costOfRecipe(optRecipe));
        }
        return cost;
      },
    };
  }

  /** เขียน ledger จองสต๊อก (กันขายเกิน: ตรวจพร้อมขายก่อน แล้วเพิ่มยอดจองแบบ atomic ใน seam เดียว) */
  async function reserveStockForOrder(
    orderId: string,
    orderNumber: string,
    usage: Map<string, number>,
    actor: ShopActor,
  ): Promise<void> {
    for (const [ingredientId, qty] of usage) {
      const ing = ingredients.get(ingredientId);
      if (!ing) throw new ConflictError("สูตรอ้างอิงวัตถุดิบที่ไม่พบ กรุณาติดต่อ Admin");
      assertAvailableStock(ing.name, ing.unit, ing.onHand, ing.reserved, qty);
    }
    for (const [ingredientId, qty] of usage) {
      const ing = ingredients.get(ingredientId)!;
      const beforeReserved = ing.reserved;
      ing.reserved = roundStock(ing.reserved + qty);
      ing.updatedAt = nowIso();
      stockLedger.push({
        id: randomUUID(),
        ingredientId,
        op: "reserve",
        deltaOnHand: 0,
        deltaReserved: qty,
        beforeOnHand: ing.onHand,
        afterOnHand: ing.onHand,
        beforeReserved,
        afterReserved: ing.reserved,
        reason: `จองสต๊อกให้คำสั่งซื้อ ${orderNumber}`,
        actorId: actor.actorId ?? null,
        actorUsername: actor.actorUsername ?? null,
        orderId,
        reference: orderNumber,
        createdAt: nowIso(),
      });
    }
    orderStockUsage.set(
      orderId,
      [...usage].map(([ingredientId, qty]) => ({ ingredientId, qty })),
    );
  }

  /** คืนยอดจอง (ยกเลิกก่อนเริ่มทำ) — ใช้ยอดที่จองไว้ตอนยืนยัน ไม่คำนวณจากสูตรใหม่ */
  async function releaseStockForOrder(
    orderId: string,
    orderNumber: string,
    reason: string,
    actor: ShopActor,
  ): Promise<void> {
    const usage = orderStockUsage.get(orderId) ?? [];
    for (const u of usage) {
      const ing = ingredients.get(u.ingredientId);
      if (!ing) continue;
      const beforeReserved = ing.reserved;
      ing.reserved = roundStock(Math.max(0, ing.reserved - u.qty));
      ing.updatedAt = nowIso();
      stockLedger.push({
        id: randomUUID(),
        ingredientId: u.ingredientId,
        op: "release",
        deltaOnHand: 0,
        deltaReserved: -u.qty,
        beforeOnHand: ing.onHand,
        afterOnHand: ing.onHand,
        beforeReserved,
        afterReserved: ing.reserved,
        reason: `คืนยอดจองของคำสั่งซื้อ ${orderNumber}: ${reason}`,
        actorId: actor.actorId ?? null,
        actorUsername: actor.actorUsername ?? null,
        orderId,
        reference: orderNumber,
        createdAt: nowIso(),
      });
    }
  }

  async function normalizeCreateOrderInput(
    input: CreateOrderInput,
    now: Date,
  ): Promise<{
    customerId: string | null;
    guestName: string | null;
    guestPhone: string | null;
    serviceType: OrderServiceType;
    scheduledAt: string | null;
    idempotencyKey: string;
    lines: NormalizedOrderLine[];
    tableId: string | null;
    roundId: string | null;
    hash: string;
  }> {
    const serviceType = normalizeServiceType(input.serviceType);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const lines = normalizeOrderLines(
      input.items.map((i) => ({
        menuId: i.menuId,
        quantity: i.quantity,
        note: i.note ?? null,
        // Ticket 07: ตัวเลือก + ความต้องการเฉพาะเป็นส่วนหนึ่งของ payload กัน key ชน
        options: i.options ?? null,
        specialRequest: i.specialRequest ?? null,
      })),
    );
    const scheduledAt = normalizeScheduledAt(serviceType, input.scheduledAt ?? null, now);
    const tableId = normalizeOrderLinkage(input.tableId ?? null);
    const roundId = normalizeOrderLinkage(input.roundId ?? null);
    let customerId: string | null = null;
    let guestName: string | null = null;
    let guestPhone: string | null = null;
    if (input.customerId) {
      if (input.guestName ?? input.guestPhone) {
        throw new ConflictError("ข้อมูลผู้สั่งไม่ถูกต้อง (ระบุทั้งสมาชิกและ Guest ไม่ได้)");
      }
      const c = customers.get(input.customerId);
      if (!c || c.isDeleted || !c.isActive) throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
      customerId = c.id;
    } else {
      guestName = normalizeGuestName(input.guestName);
      // รับได้ทั้งเบอร์ดิบและ normalize แล้ว — normalize ซ้ำด้วยกฎ Ticket 03 ที่นี่
      guestPhone = normalizeThaiPhone(input.guestPhone ?? "");
      assertNormalizedPhone(guestPhone);
    }
    return {
      customerId,
      guestName,
      guestPhone,
      serviceType,
      scheduledAt,
      idempotencyKey,
      lines,
      tableId,
      roundId,
      hash: orderHashWithLinkage({ customerId, guestName, guestPhone, serviceType, scheduledAt, items: lines }, tableId, roundId),
    };
  }

  /** idempotency hash ของคำสั่งซื้อรวม linkage โต๊ะ/รอบ (Ticket 06 ต่อยอดจาก orderPayloadHash) */
  function orderHashWithLinkage(
    payload: { customerId: string | null; guestName: string | null; guestPhone: string | null; serviceType: OrderServiceType; scheduledAt: string | null; items: NormalizedOrderLine[] },
    tableId: string | null,
    roundId: string | null,
  ): string {
    const base = orderPayloadHash(payload);
    return createHash("sha256").update(`${base}|${tableId ?? ""}|${roundId ?? ""}`).digest("hex");
  }

  /** id โต๊ะ/รอบที่แนบมากับคำสั่งซื้อ: ว่างได้, มีค่าต้องเป็น string ไม่ว่าง */
  function normalizeOrderLinkage(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ConflictError("ข้อมูลโต๊ะ/รอบการใช้โต๊ะไม่ถูกต้อง");
    }
    return value.trim();
  }

  /**
   * ตรวจ linkage โต๊ะ/รอบก่อนสร้างคำสั่งซื้อ (ใช้ร่วมกันใน memory seam):
   * - ระบุ roundId ได้เฉพาะ dine_in; รอบต้องมีอยู่และเปิดอยู่; tableId (ถ้าระบุ)
   *   ต้องตรงกับโต๊ะของรอบ; ไม่ระบุ tableId ให้ใช้โต๊ะของรอบ
   * - ระบุ tableId อย่างเดียวโดยไม่มี roundId → 409 (ต้องเช็กอินเปิดรอบก่อน)
   */
  function resolveOrderRoundLinkage(
    serviceType: OrderServiceType,
    tableId: string | null,
    roundId: string | null,
  ): { tableId: string | null; roundId: string | null } {
    if (roundId === null && tableId === null) return { tableId: null, roundId: null };
    if (roundId === null) {
      throw new ConflictError("กรุณาเช็กอินเพื่อเปิดรอบการใช้โต๊ะก่อนสั่งที่โต๊ะ");
    }
    if (serviceType !== "dine_in") {
      throw new ConflictError("ผูกคำสั่งซื้อกับรอบโต๊ะได้เฉพาะแบบรับประทานที่ร้าน");
    }
    const round = tableRounds.get(roundId);
    if (!round) throw new NotFoundError("ไม่พบรอบการใช้โต๊ะ");
    if (round.status !== "open") {
      throw new ConflictError("รอบการใช้โต๊ะนี้ปิดแล้ว ไม่รับคำสั่งซื้อใหม่");
    }
    if (tableId !== null && tableId !== round.tableId) {
      throw new ConflictError("โต๊ะไม่ตรงกับรอบการใช้โต๊ะที่เปิดอยู่");
    }
    return { tableId: round.tableId, roundId: round.id };
  }

  async function writeAudit(input: AuditInput): Promise<void> {
    if (failAudit?.(input)) throw new Error("บันทึก audit ล้มเหลว (จำลองสำหรับทดสอบ)");
    audits.push({
      id: auditSeq++,
      at: nowIso(),
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername ?? null,
      action: input.action,
      targetId: input.targetId ?? null,
      targetUsername: input.targetUsername ?? null,
      detail: input.detail ?? null,
      ip: input.ip ?? null,
      success: input.success ?? true,
    });
  }

  async function countOwnersInner(): Promise<number> {
    let n = 0;
    for (const u of users.values()) if (u.roles.includes("owner")) n += 1;
    return n;
  }

  // ---- Ticket 03 helpers: backup/restore ลูกค้า+เซสชัน+LINE พร้อม shop/audit (all-or-nothing) ----
  const cloneCustomer = (c: Customer): Customer => ({ ...c });

  function backupCustomers() {
    return {
      shop: backupShop(),
      customers: new Map([...customers].map(([id, c]) => [id, { ...c }] as const)),
      customersByPhone: new Map(customersByPhone),
      customersByEmail: new Map(customersByEmail),
      sessions: new Map(customerSessions),
      links: new Map(lineLinks),
      linksBySubject: new Map(lineLinksBySubject),
      tx: new Map(lineTx),
    };
  }

  function restoreCustomers(b: ReturnType<typeof backupCustomers>): void {
    restoreShop(b.shop);
    customers.clear();
    for (const [id, c] of b.customers) customers.set(id, c);
    customersByPhone.clear();
    for (const [k, v] of b.customersByPhone) customersByPhone.set(k, v);
    customersByEmail.clear();
    for (const [k, v] of b.customersByEmail) customersByEmail.set(k, v);
    customerSessions.clear();
    for (const [k, v] of b.sessions) customerSessions.set(k, v);
    lineLinks.clear();
    for (const [k, v] of b.links) lineLinks.set(k, v);
    lineLinksBySubject.clear();
    for (const [k, v] of b.linksBySubject) lineLinksBySubject.set(k, v);
    lineTx.clear();
    for (const [k, v] of b.tx) lineTx.set(k, v);
  }

  function liveCustomer(id: string): Customer {
    const c = customers.get(id);
    if (!c || c.isDeleted) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
    return c;
  }

  const memoryStore: Store = {
    async createUser(input) {
      if (byName.has(input.username)) throw new ConflictError("ชื่อผู้ใช้นี้มีอยู่แล้ว");
      const now = nowIso();
      const user: User = {
        id: randomUUID(),
        username: input.username,
        passwordHash: input.passwordHash,
        roles: normalizeRoles([...input.roles]),
        isActive: true,
        passwordVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);
      byName.set(user.username, user.id);
      return { ...user, roles: [...user.roles] };
    },
    async createFirstOwner(input) {
      // memory store รัน single-threaded: check-then-insert จึง atomic ในตัว
      if ((await countOwnersInner()) > 0) return { created: false, reason: "owner-exists" };
      const user = await memoryStore.createUser(input);
      return { created: true, user };
    },
    async findByUsername(username) {
      const id = byName.get(username);
      if (!id) return null;
      const u = users.get(id);
      return u ? { ...u, roles: [...u.roles] } : null;
    },
    async findById(id) {
      const u = users.get(id);
      return u ? { ...u, roles: [...u.roles] } : null;
    },
    async listUsers() {
      return [...users.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((u) => ({ ...u, roles: [...u.roles] }));
    },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (!u) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
      if (patch.roles) u.roles = normalizeRoles([...patch.roles]);
      if (patch.isActive !== undefined) u.isActive = patch.isActive;
      u.updatedAt = nowIso();
      return { ...u, roles: [...u.roles] };
    },
    async setPassword(id, passwordHash) {
      const u = users.get(id);
      if (!u) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
      u.passwordHash = passwordHash;
      u.passwordVersion += 1;
      u.updatedAt = nowIso();
      return { ...u, roles: [...u.roles] };
    },
    async countOwners() {
      return countOwnersInner();
    },
    async createSession(userId, passwordVersion) {
      const now = new Date();
      const s: Session = {
        id: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        userId,
        passwordVersion,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      };
      sessions.set(s.id, s);
      return { ...s };
    },
    async findSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
    async deleteSessionsForUser(userId) {
      for (const [sid, s] of sessions) if (s.userId === userId) sessions.delete(sid);
    },
    async audit(input) {
      await writeAudit(input);
    },
    async listAudit(prefix, limit) {
      const items = [...audits].reverse().filter((a) => {
        if (prefix === "all") return true;
        if (prefix === "login_") return a.action.startsWith("login_");
        if (prefix === "shop_") return a.action.startsWith("shop_");
        if (prefix === "customer_") return a.action.startsWith("customer_");
        if (prefix === "menu_") return a.action.startsWith("menu_");
        if (prefix === "order_") return a.action.startsWith("order_");
        if (prefix === "reservation_") return a.action.startsWith("reservation_");
        if (prefix === "round_") return a.action.startsWith("table_round_");
        if (prefix === "inventory_") {
          return (
            a.action.startsWith("ingredient_") ||
            a.action.startsWith("recipe_") ||
            a.action.startsWith("stock_")
          );
        }
        if (prefix === "payment_") return a.action.startsWith("payment_");
        if (prefix === "queue_") return a.action.startsWith("queue_");
        if (prefix === "loyalty_") {
          return a.action.startsWith("loyalty_") || a.action.startsWith("reward_");
        }
        return !a.action.startsWith("login_");
      });
      return items.slice(0, limit);
    },
    // ---- Ticket 03: บัญชีลูกค้า + LINE (ใช้ customers state/helpers ด้านบน) ----
    async createCustomer(input, actor) {
      const backup = backupCustomers();
      try {
        if (customersByPhone.has(input.phone)) throw new ConflictError("เบอร์โทรศัพท์นี้ถูกใช้สมัครแล้ว");
        if (input.email && customersByEmail.has(input.email)) throw new ConflictError("อีเมลนี้ถูกใช้สมัครแล้ว");
        const now = nowIso();
        const c: Customer = {
          id: randomUUID(),
          name: input.name,
          phone: input.phone,
          email: input.email,
          passwordHash: input.passwordHash,
          isActive: true,
          isDeleted: false,
          passwordVersion: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        customers.set(c.id, c);
        customersByPhone.set(c.phone!, c.id);
        if (c.email) customersByEmail.set(c.email, c.id);
        await writeAudit(customerRegisteredEvent(c.id, actor));
        return cloneCustomer(c);
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async findCustomerById(id) {
      const c = customers.get(id);
      return c ? cloneCustomer(c) : null;
    },
    async findCustomerByPhone(phone) {
      const id = customersByPhone.get(phone);
      if (!id) return null;
      const c = customers.get(id);
      return c ? cloneCustomer(c) : null;
    },
    async listCustomers(q, limit) {
      const needle = q.trim().toLowerCase();
      const all = [...customers.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!needle) return all.slice(0, limit).map(cloneCustomer);
      return all
        .filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.phone ?? "").includes(needle) ||
            (c.email ?? "").toLowerCase().includes(needle),
        )
        .slice(0, limit)
        .map(cloneCustomer);
    },
    async updateCustomerProfile(id, patch, actor) {
      const backup = backupCustomers();
      try {
        const c = liveCustomer(id);
        if (patch.name !== undefined) c.name = patch.name;
        if (patch.email !== undefined) {
          if (patch.email && customersByEmail.has(patch.email) && customersByEmail.get(patch.email) !== id) {
            throw new ConflictError("อีเมลนี้ถูกใช้แล้ว");
          }
          if (c.email) customersByEmail.delete(c.email);
          c.email = patch.email;
          if (c.email) customersByEmail.set(c.email, id);
        }
        c.updatedAt = nowIso();
        await writeAudit(customerProfileUpdatedEvent(id, actor));
        return cloneCustomer(c);
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async setCustomerPassword(id, passwordHash, actor) {
      const backup = backupCustomers();
      try {
        const c = liveCustomer(id);
        if (!c.isActive) throw new ConflictError("บัญชีนี้ถูกปิดใช้งานแล้ว");
        c.passwordHash = passwordHash;
        c.passwordVersion += 1;
        c.updatedAt = nowIso();
        for (const [sid, s] of customerSessions) if (s.customerId === id) customerSessions.delete(sid);
        await writeAudit(customerPasswordChangedEvent(id, actor));
        return cloneCustomer(c);
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async setCustomerActive(id, active, actor) {
      const backup = backupCustomers();
      try {
        const c = liveCustomer(id);
        c.isActive = active;
        c.updatedAt = nowIso();
        if (!active) {
          for (const [sid, s] of customerSessions) if (s.customerId === id) customerSessions.delete(sid);
          await writeAudit(customerDeactivatedEvent(id, actor));
        } else {
          await writeAudit(customerActivatedEvent(id, actor));
        }
        return cloneCustomer(c);
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async deleteCustomer(id, actor) {
      const backup = backupCustomers();
      try {
        const c = liveCustomer(id);
        if (c.phone) customersByPhone.delete(c.phone);
        if (c.email) customersByEmail.delete(c.email);
        c.name = DELETED_CUSTOMER_NAME;
        c.phone = null;
        c.email = null;
        c.passwordHash = "deleted";
        c.isActive = false;
        c.isDeleted = true;
        c.deletedAt = nowIso();
        c.updatedAt = c.deletedAt;
        for (const [sid, s] of customerSessions) if (s.customerId === id) customerSessions.delete(sid);
        const link = lineLinks.get(id);
        if (link) {
          lineLinks.delete(id);
          lineLinksBySubject.delete(`line:${link.providerSubject}`);
        }
        await writeAudit(customerDeletedEvent(id, actor));
        return cloneCustomer(c);
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async createCustomerSession(customerId, passwordVersion) {
      const now = new Date();
      const s: CustomerSession = {
        id: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        customerId,
        passwordVersion,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      };
      customerSessions.set(s.id, s);
      return { ...s };
    },
    async findCustomerSession(id) {
      const s = customerSessions.get(id);
      return s ? { ...s } : null;
    },
    async deleteCustomerSession(id) {
      customerSessions.delete(id);
    },
    async deleteCustomerSessionsForCustomer(customerId) {
      for (const [sid, s] of customerSessions) if (s.customerId === customerId) customerSessions.delete(sid);
    },
    async createLineTx(input) {
      if (lineTx.has(input.state)) throw new ConflictError("state นี้ถูกใช้แล้ว");
      const now = nowIso();
      lineTx.set(input.state, {
        state: input.state,
        customerId: input.customerId,
        nonce: input.nonce,
        codeVerifier: input.codeVerifier,
        redirectAfter: input.redirectAfter,
        createdAt: now,
        expiresAt: input.expiresAt,
        usedAt: null,
      });
    },
    async consumeLineTx(state, now) {
      const tx = lineTx.get(state);
      if (!tx || tx.usedAt !== null) return null;
      if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
      tx.usedAt = now.toISOString();
      return { ...tx };
    },
    async peekLineTx(state, now) {
      const tx = lineTx.get(state);
      if (!tx || tx.usedAt !== null) return null;
      if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
      return { ...tx };
    },
    async consumeLineTxWithAudit(state, now, actor, failureDetail) {
      const backup = backupCustomers();
      try {
        const current = lineTx.get(state);
        if (!current || current.usedAt !== null) return null;
        if (new Date(current.expiresAt).getTime() <= now.getTime()) return null;
        // แทนที่ object ทั้งก้อน (ห้าม mutate in-place — backup เก็บ reference เดิมไว้ rollback)
        const consumed: LineLoginTx = { ...current, usedAt: now.toISOString() };
        lineTx.set(state, consumed);
        await writeAudit(customerLineLinkFailedEvent(consumed.customerId, failureDetail, actor));
        return { ...consumed };
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async getLineLink(customerId) {
      const l = lineLinks.get(customerId);
      return l ? { ...l } : null;
    },
    async findLineLinkBySubject(provider, subject) {
      const id = lineLinksBySubject.get(`${provider}:${subject}`);
      if (!id) return null;
      const l = lineLinks.get(id);
      return l ? { ...l } : null;
    },
    async linkLineIdentity(customerId, input, actor) {
      const backup = backupCustomers();
      try {
        liveCustomer(customerId);
        if (lineLinks.has(customerId)) throw new ConflictError("บัญชีนี้เชื่อม LINE ไว้แล้ว");
        const key = `line:${input.providerSubject}`;
        if (lineLinksBySubject.has(key)) throw new ConflictError("LINE นี้ถูกเชื่อมกับบัญชีอื่นแล้ว");
        const link: CustomerLineLink = {
          customerId,
          provider: "line",
          providerSubject: input.providerSubject,
          displayName: input.displayName ?? null,
          linkedAt: nowIso(),
        };
        lineLinks.set(customerId, link);
        lineLinksBySubject.set(key, customerId);
        await writeAudit(customerLineLinkedEvent(customerId, actor));
        return { ...link };
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async linkLineIdentityWithConsume(state, now, input, actor) {
      const backup = backupCustomers();
      try {
        const current = lineTx.get(state);
        if (!current || current.usedAt !== null) return null;
        if (new Date(current.expiresAt).getTime() <= now.getTime()) return null;
        const customerId = current.customerId;
        liveCustomer(customerId);
        if (lineLinks.has(customerId)) throw new ConflictError("บัญชีนี้เชื่อม LINE ไว้แล้ว");
        const key = `line:${input.providerSubject}`;
        if (lineLinksBySubject.has(key)) throw new ConflictError("LINE นี้ถูกเชื่อมกับบัญชีอื่นแล้ว");
        // แทนที่ object ทั้งก้อน (ห้าม mutate in-place — backup เก็บ reference เดิมไว้ rollback)
        const consumed: LineLoginTx = { ...current, usedAt: now.toISOString() };
        lineTx.set(state, consumed);
        const link: CustomerLineLink = {
          customerId,
          provider: "line",
          providerSubject: input.providerSubject,
          displayName: input.displayName ?? null,
          linkedAt: nowIso(),
        };
        lineLinks.set(customerId, link);
        lineLinksBySubject.set(key, customerId);
        await writeAudit(customerLineLinkedEvent(customerId, actor));
        return { link: { ...link }, tx: { ...consumed } };
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async unlinkLineIdentity(customerId, actor) {
      const backup = backupCustomers();
      try {
        const link = lineLinks.get(customerId);
        if (!link) throw new NotFoundError("บัญชีนี้ยังไม่ได้เชื่อม LINE");
        lineLinks.delete(customerId);
        lineLinksBySubject.delete(`line:${link.providerSubject}`);
        await writeAudit(customerLineUnlinkedEvent(customerId, actor));
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    // ---- P1 narrow atomic seams (route ต้องใช้ตัวนี้ ห้ามแยกเรียกหลายขั้น) ----
    async registerCustomerWithSession(input, actor) {
      const backup = backupCustomers();
      try {
        if (customersByPhone.has(input.phone)) throw new ConflictError("เบอร์โทรศัพท์นี้ถูกใช้สมัครแล้ว");
        if (input.email && customersByEmail.has(input.email)) throw new ConflictError("อีเมลนี้ถูกใช้สมัครแล้ว");
        const now = nowIso();
        const c: Customer = {
          id: randomUUID(),
          name: input.name,
          phone: input.phone,
          email: input.email,
          passwordHash: input.passwordHash,
          isActive: true,
          isDeleted: false,
          passwordVersion: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        customers.set(c.id, c);
        customersByPhone.set(c.phone!, c.id);
        if (c.email) customersByEmail.set(c.email, c.id);
        await writeAudit(customerRegisteredEvent(c.id, actor));
        // initial session + login audit ใน seam เดียวกัน — พังตรงไหน rollback ทั้งหมด
        const sNow = new Date();
        const s: CustomerSession = {
          id: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
          customerId: c.id,
          passwordVersion: c.passwordVersion,
          createdAt: sNow.toISOString(),
          expiresAt: new Date(sNow.getTime() + SESSION_TTL_MS).toISOString(),
        };
        customerSessions.set(s.id, s);
        await writeAudit(customerLoginSuccessEvent(c.id, actor));
        return { customer: cloneCustomer(c), session: { ...s } };
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async createCustomerSessionWithAudit(customerId, passwordVersion, actor) {
      const backup = backupCustomers();
      try {
        // กันสร้าง session ให้บัญชีที่ไม่มี/ถูกลบ (parity กับ MySQL FK + check)
        liveCustomer(customerId);
        const sNow = new Date();
        const s: CustomerSession = {
          id: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
          customerId,
          passwordVersion,
          createdAt: sNow.toISOString(),
          expiresAt: new Date(sNow.getTime() + SESSION_TTL_MS).toISOString(),
        };
        customerSessions.set(s.id, s);
        await writeAudit(customerLoginSuccessEvent(customerId, actor));
        return { ...s };
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async logoutCustomerSessionWithAudit(sessionId, customerId, actor) {
      const backup = backupCustomers();
      try {
        const s = customerSessions.get(sessionId);
        // ลบเฉพาะ session ของบัญชีตัวเอง (idempotent เมื่อไม่มี/หมดอายุไปก่อนแล้ว)
        if (s && s.customerId === customerId) customerSessions.delete(sessionId);
        await writeAudit(customerLogoutEvent(customerId, actor));
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async createLineLoginTxWithAudit(input, actor) {
      const backup = backupCustomers();
      try {
        if (lineTx.has(input.state)) throw new ConflictError("state นี้ถูกใช้แล้ว");
        const now = nowIso();
        lineTx.set(input.state, {
          state: input.state,
          customerId: input.customerId,
          nonce: input.nonce,
          codeVerifier: input.codeVerifier,
          redirectAfter: input.redirectAfter,
          createdAt: now,
          expiresAt: input.expiresAt,
          usedAt: null,
        });
        await writeAudit(customerLineLinkStartedEvent(input.customerId, actor));
      } catch (err) {
        restoreCustomers(backup);
        throw err;
      }
    },
    async getShopName() {
      return shopName;
    },
    async getSchedule() {
      return cloneSchedule(schedule);
    },
    async getOverride() {
      return override ? { ...override } : null;
    },
    async listTables() {
      return [...tables.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "th"))
        .map((t) => ({ ...t }));
    },
    async getShopSnapshot() {
      return {
        shopName,
        schedule: cloneSchedule(schedule),
        override: override ? { ...override } : null,
        tables: [...tables.values()]
          .sort((a, b) => a.name.localeCompare(b.name, "th"))
          .map((t) => ({ ...t })),
      };
    },
    async saveShopConfig(input, actor) {
      // validate ก่อน mutate: ไม่ผ่าน = ไม่เปลี่ยนอะไรเลยและไม่เขียน audit
      const normalized = cloneSchedule(input.schedule);
      const backup = backupShop();
      try {
        let nameChanged = false;
        if (input.shopName !== undefined && input.shopName !== shopName) {
          shopName = input.shopName;
          nameChanged = true;
          await writeAudit(shopNameUpdatedEvent(input.shopName, actor));
        }
        schedule = normalized;
        await writeAudit(shopScheduleUpdatedEvent(actor));
        return {
          shopName,
          schedule: cloneSchedule(schedule),
          override: override ? { ...override } : null,
          nameChanged,
        };
      } catch (err) {
        restoreShop(backup);
        throw err;
      }
    },
    async setShopOverride(input, actor) {
      const backup = backupShop();
      try {
        override = {
          mode: input.mode,
          reason: input.reason ?? null,
          expectedReopenAt: input.expectedReopenAt ?? null,
          expiresAt: input.expiresAt ?? null,
          createdAt: nowIso(),
          createdBy: input.createdBy ?? null,
        };
        await writeAudit(shopOverrideSetEvent(input, actor));
        return { ...override };
      } catch (err) {
        restoreShop(backup);
        throw err;
      }
    },
    async clearShopOverride(actor) {
      if (override === null) return false;
      const backup = backupShop();
      try {
        override = null;
        await writeAudit(shopOverrideClearedEvent(actor));
        return true;
      } catch (err) {
        restoreShop(backup);
        throw err;
      }
    },
    async createShopTable(input, actor) {
      const backup = backupShop();
      try {
        const name = input.name.trim();
        for (const t of tables.values()) {
          if (t.name === name) throw new ConflictError("ชื่อโต๊ะนี้มีอยู่แล้ว");
        }
        const now = nowIso();
        const table: ShopTable = {
          id: randomUUID(),
          name,
          capacity: input.capacity,
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        };
        tables.set(table.id, table);
        await writeAudit(shopTableCreatedEvent(name, input.capacity, actor));
        return { ...table };
      } catch (err) {
        restoreShop(backup);
        throw err;
      }
    },
    async updateShopTable(id, patch, actor) {
      const backup = backupShop();
      try {
        const t = tables.get(id);
        if (!t) throw new NotFoundError("ไม่พบโต๊ะ");
        if (patch.name !== undefined) {
          const name = patch.name.trim();
          for (const other of tables.values()) {
            if (other.id !== id && other.name === name) {
              throw new ConflictError("ชื่อโต๊ะนี้มีอยู่แล้ว");
            }
          }
          t.name = name;
        }
        if (patch.capacity !== undefined) t.capacity = patch.capacity;
        if (patch.isEnabled !== undefined) t.isEnabled = patch.isEnabled;
        t.updatedAt = nowIso();
        await writeAudit(shopTableUpdatedEvent(t.name, t.capacity, t.isEnabled, actor));
        return { ...t };
      } catch (err) {
        restoreShop(backup);
        throw err;
      }
    },
    // ---- Ticket 04 memory: เมนู (all-or-nothing ผ่าน backupShop + menu state) ----
    async listMenuItems(options) {
      const includeArchived = options?.includeArchived ?? false;
      return [...menuItems.values()]
        .filter((m) => includeArchived || !m.isArchived)
        .sort(
          (a, b) =>
            compareMenuCategory(a.category, b.category) ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name, "th"),
        )
        .map((m) => ({ ...m }));
    },
    async listPublicMenuItems() {
      return [...menuItems.values()]
        .filter((m) => m.status === "available" && !m.isArchived)
        .sort(
          (a, b) =>
            compareMenuCategory(a.category, b.category) ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name, "th"),
        )
        .map((m) => ({ ...m }));
    },
    async getMenuItem(id) {
      const m = menuItems.get(id);
      return m ? { ...m } : null;
    },
    async createMenuItem(input, actor) {
      const backup = backupMenu();
      try {
        const n = normalizeMenuInput(input);
        for (const other of menuItems.values()) {
          if (other.category === n.category && other.name === n.name) {
            throw new ConflictError("ชื่อเมนูนี้มีอยู่ในหมวดหมู่นี้แล้ว");
          }
        }
        const now = nowIso();
        const item: MenuItem = {
          id: randomUUID(),
          category: n.category,
          name: n.name,
          description: n.description,
          imageUrl: n.imageUrl,
          price: n.price,
          kind: n.kind,
          status: n.status,
          isArchived: false,
          sortOrder: n.sortOrder,
          createdAt: now,
          updatedAt: now,
        };
        menuItems.set(item.id, item);
        await writeAudit(menuCreatedEvent(item, actor));
        return { ...item };
      } catch (err) {
        restoreMenu(backup);
        throw err;
      }
    },
    async updateMenuItem(id, patch, actor) {
      const backup = backupMenu();
      try {
        const current = menuItems.get(id);
        if (!current) throw new NotFoundError("ไม่พบเมนู");
        if (current.isArchived && patch.isArchived !== false) {
          throw new ConflictError("เมนูนี้ถูก archive แล้ว นำกลับมาก่อนจึงจะแก้ไขได้");
        }
        const before: MenuItem = { ...current };
        // ประกอบร่าง candidate แล้ว normalize ทั้งก้อน (กันค่าบางส่วนไม่ผ่านแล้วค้าง)
        const candidate: MenuInput = {
          category: patch.category !== undefined ? patch.category : current.category,
          name: patch.name !== undefined ? patch.name : current.name,
          description: patch.description !== undefined ? patch.description : current.description,
          imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : current.imageUrl,
          price: patch.price !== undefined ? patch.price : current.price,
          kind: patch.kind !== undefined ? patch.kind : current.kind,
          status: patch.status !== undefined ? patch.status : current.status,
          sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder,
        };
        const n = normalizeMenuInput(candidate);
        for (const other of menuItems.values()) {
          if (other.id !== id && other.category === n.category && other.name === n.name) {
            throw new ConflictError("ชื่อเมนูนี้มีอยู่ในหมวดหมู่นี้แล้ว");
          }
        }
        const keys = Object.keys(patch) as (keyof typeof patch)[];
        const onlyStatusChanged =
          keys.length === 1 && keys[0] === "status" && patch.status !== undefined;
        current.category = n.category;
        current.name = n.name;
        current.description = n.description;
        current.imageUrl = n.imageUrl;
        current.price = n.price;
        current.kind = n.kind;
        current.status = n.status;
        current.sortOrder = n.sortOrder;
        if (patch.isArchived !== undefined) current.isArchived = patch.isArchived;
        current.updatedAt = nowIso();
        const after: MenuItem = { ...current };
        await writeAudit(
          onlyStatusChanged
            ? menuStatusChangedEvent(before, after, actor)
            : menuUpdatedEvent(before, after, actor),
        );
        return { ...current };
      } catch (err) {
        restoreMenu(backup);
        throw err;
      }
    },
    async archiveMenuItem(id, actor) {
      const backup = backupMenu();
      try {
        const current = menuItems.get(id);
        if (!current) throw new NotFoundError("ไม่พบเมนู");
        if (current.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว");
        current.isArchived = true;
        current.updatedAt = nowIso();
        await writeAudit(menuArchivedEvent({ ...current }, actor));
        return { ...current };
      } catch (err) {
        restoreMenu(backup);
        throw err;
      }
    },
    async restoreMenuItem(id, actor) {
      const backup = backupMenu();
      try {
        const current = menuItems.get(id);
        if (!current) throw new NotFoundError("ไม่พบเมนู");
        if (!current.isArchived) throw new ConflictError("เมนูนี้ไม่ได้ถูก archive");
        current.isArchived = false;
        current.updatedAt = nowIso();
        await writeAudit(menuRestoredEvent({ ...current }, actor));
        return { ...current };
      } catch (err) {
        restoreMenu(backup);
        throw err;
      }
    },
    // ---- Ticket 05 memory: คำสั่งซื้อพื้นฐาน (snapshot + idempotency + audit แบบ all-or-nothing) ----
    // Ticket 07: ยืนยัน = ตรวจสูตรล่าสุด + จองสต๊อกแบบ atomic ก่อนรับชำระ (serialize กันขายเกิน)
    async createOrder(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupOrders();
        try {
          const n = await normalizeCreateOrderInput(input, now);
          // ผูกโต๊ะ/รอบ (Ticket 06): รอบต้องเปิดอยู่ โต๊ะต้องตรงรอบ
          const linkage = resolveOrderRoundLinkage(n.serviceType, n.tableId, n.roundId);
          const hash = orderHashWithLinkage(
            { customerId: n.customerId, guestName: n.guestName, guestPhone: n.guestPhone, serviceType: n.serviceType, scheduledAt: n.scheduledAt, items: n.lines },
            linkage.tableId,
            linkage.roundId,
          );
          // idempotency: key เดิม → คืนของเดิม (payload เดิม) หรือ 409 (payload ต่างกัน)
          const existingId = ordersByIdemKey.get(n.idempotencyKey);
          if (existingId) {
            const existing = toDetail(existingId)!;
            const existingHash = orderHashWithLinkage({
              customerId: existing.customerId,
              guestName: existing.guestName,
              guestPhone: existing.guestPhone,
              serviceType: existing.serviceType,
              scheduledAt: existing.scheduledAt,
              // Ticket 07: เทียบตัวเลือก/ความต้องการเฉพาะจาก snapshot ด้วย (กัน key เดิมคนละตัวเลือก)
              items: existing.items.map((i) => ({
                menuId: i.menuId,
                quantity: i.quantity,
                note: i.note,
                optionIds: i.selectedOptions.map((s) => s.optionId),
                specialRequest: i.specialRequest,
              })),
            }, existing.tableId, existing.roundId);
            if (existingHash !== hash) {
              throw new ConflictError("คำขอนี้ถูกใช้ยืนยันไปแล้ว กรุณาสร้างตะกร้าใหม่");
            }
            return { order: existing, deduplicated: true };
          }
          const snapshot = await buildOrderSnapshot(n.lines);
          const subtotal = roundBaht(snapshot.reduce((s, l) => s + l.price * l.quantity, 0));
          // Ticket 07: รวมความต้องการวัตถุดิบจากสูตรล่าสุด (ฐานเมนู + ตัวเลือก) — ข้ามรายการที่ไม่มีสูตร
          const { usage, unitCostOf } = aggregateRequirements(
            snapshot.map((s) => ({ menuId: s.menuId, quantity: s.quantity, options: s.options })),
          );
          // เลขคำสั่งซื้อกันชน (memory: ตรวจ map; MySQL: unique index + retry)
          let orderNumber = generateOrderNumber(now);
          for (let i = 0; i < 5 && ordersByNumber.has(orderNumber); i += 1) {
            orderNumber = generateOrderNumber(now);
          }
          if (ordersByNumber.has(orderNumber)) {
            throw new ConflictError("สร้างเลขคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          }
          const at = now.toISOString();
          const estimatedCost = roundBaht(
            snapshot.reduce((s, l) => s + unitCostOf(l.menuId, l.options.map((o) => o.optionId)) * l.quantity, 0),
          );
          const orderId = randomUUID();
          const header: Order = {
            id: orderId,
            orderNumber,
            customerId: n.customerId,
            guestName: n.guestName,
            guestPhone: n.guestPhone,
            channel: "web",
            serviceType: n.serviceType,
            status: "pending_payment",
            subtotal,
            total: subtotal,
            scheduledAt: n.scheduledAt,
            tableId: linkage.tableId,
            roundId: linkage.roundId,
            idempotencyKey: n.idempotencyKey,
            stockReserved: usage.size > 0,
            stockConsumed: false,
            estimatedCost,
            createdAt: at,
            updatedAt: at,
          };
          const items: OrderItem[] = snapshot.map((s) => ({
            id: randomUUID(),
            orderId: header.id,
            menuId: s.menuId,
            menuName: s.name,
            unitPrice: s.price,
            quantity: s.quantity,
            lineTotal: roundBaht(s.price * s.quantity),
            note: s.note,
            selectedOptions: s.options,
            specialRequest: s.specialRequest,
            estimatedCost: roundBaht(unitCostOf(s.menuId, s.options.map((o) => o.optionId)) * s.quantity),
          }));
          orders.set(header.id, { ...header });
          orderItems.set(header.id, items);
          ordersByNumber.set(header.orderNumber, header.id);
          ordersByIdemKey.set(header.idempotencyKey, header.id);
          // Ticket 07: จองสต๊อกแบบ atomic ใน seam เดียวกัน (ไม่พอ → 409 + rollback ทั้งคำสั่งซื้อ)
          if (usage.size > 0) {
            await reserveStockForOrder(header.id, header.orderNumber, usage, actor);
          }
          const order = toDetail(header.id)!;
          await writeAudit(orderCreatedEvent(order, actor));
          if (usage.size > 0) {
            await writeAudit(orderStockReservedEvent(order.orderNumber, order.id, usage.size, actor));
          }
          return { order, deduplicated: false };
        } catch (err) {
          restoreOrders(backup);
          throw err;
        }
      });
    },
    async getOrder(id) {
      return toDetail(id);
    },
    async getOrderByNumber(orderNumber) {
      const id = ordersByNumber.get(orderNumber.trim());
      return id ? toDetail(id) : null;
    },
    async findOrderByIdempotencyKey(key) {
      const id = ordersByIdemKey.get(key);
      return id ? toDetail(id) : null;
    },
    async listCustomerOrders(customerId, limit = 50) {
      return [...orders.values()]
        .filter((o) => o.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.min(Math.max(limit, 1), 200))
        .map((o) => toDetail(o.id)!);
    },
    async listOrders(filter) {
      const needle = (filter.q ?? "").trim().toLowerCase();
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...orders.values()]
        .filter((o) => (filter.status ? o.status === filter.status : true))
        .filter((o) =>
          needle
            ? o.orderNumber.toLowerCase().includes(needle) ||
              (o.guestName ?? "").toLowerCase().includes(needle) ||
              (o.guestPhone ?? "").includes(needle)
            : true,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((o) => toDetail(o.id)!);
    },
    async updateOrderStatus(id, patch, actor) {
      return runOrderExclusive(async () => {
        // ใช้ backupPayments (superset ของ backupOrders) เพราะ hook สะสมคะแนน
        // ตอน completed เขียน loyalty ledger ใน seam เดียวกัน
        const backup = backupPayments();
        try {
          const current = orders.get(id);
          if (!current) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          const reason = normalizeStatusReason(patch.reason);
          const to = patch.status;
          if (to !== "completed" && to !== "cancelled") throw new ConflictError("สถานะคำสั่งซื้อไม่ถูกต้อง");
          assertOrderStatusTransition(current.status, to);
          const before = { status: current.status, total: current.total };
          current.status = to;
          current.updatedAt = new Date().toISOString();
          // Ticket 07: ยกเลิกก่อนเริ่มทำ → คืนยอดจอง (ตัดจริงแล้วไม่คืน — ของใช้ไปแล้ว)
          if (to === "cancelled" && current.stockReserved && !current.stockConsumed) {
            await releaseStockForOrder(current.id, current.orderNumber, reason, actor);
          }
          // ยอดตรึงแล้ว — เปลี่ยนเฉพาะสถานะ (กันราคาเมนูภายหลังกระทบยอดเดิม)
          const after = toDetail(id)!;
          await writeAudit(orderStatusChangedEvent(before, after, reason, actor));
          if (to === "cancelled" && before.status === "pending_payment" && current.stockReserved && !current.stockConsumed) {
            await writeAudit(orderStockReleasedEvent(after.orderNumber, after.id, reason, actor));
          }
          // Ticket 10: ปิดงาน completed เข้าเงื่อนไขสะสมคะแนนส่วนที่เหลือ (exactly-once)
          if (to === "completed") {
            await tryAutoEarnForOrderInternal(current.id, actor, new Date());
          }
          return after;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    // ---- Ticket 07 memory: ตัวเลือกเมนู (all-or-nothing ผ่าน backupInventory + audit) ----
    async createMenuOptionGroup(menuId, input, actor) {
      const backup = backupInventory();
      try {
        const menu = menuItems.get(menuId);
        if (!menu) throw new NotFoundError("ไม่พบเมนู");
        if (menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        const name = normalizeOptionGroupName(input.name);
        const sortOrder = normalizeOptionSortOrder(input.sortOrder ?? 0);
        for (const g of optionGroups.values()) {
          if (g.menuId === menuId && g.name === name) {
            throw new ConflictError("ชื่อกลุ่มตัวเลือกนี้มีอยู่ในเมนูนี้แล้ว");
          }
        }
        const now = nowIso();
        const group: MenuOptionGroup = { id: randomUUID(), menuId, name, sortOrder, createdAt: now, updatedAt: now };
        optionGroups.set(group.id, group);
        await writeAudit(optionGroupCreatedEvent(group, menu.name, actor));
        return { ...group };
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async listMenuOptionGroups(menuId) {
      return groupsOfMenu(menuId).map((g) => ({ ...g }));
    },
    async updateMenuOptionGroup(id, patch, actor) {
      const backup = backupInventory();
      try {
        const current = optionGroups.get(id);
        if (!current) throw new NotFoundError("ไม่พบกลุ่มตัวเลือก");
        const before = { ...current };
        if (patch.name !== undefined) {
          const name = normalizeOptionGroupName(patch.name);
          for (const other of optionGroups.values()) {
            if (other.id !== id && other.menuId === current.menuId && other.name === name) {
              throw new ConflictError("ชื่อกลุ่มตัวเลือกนี้มีอยู่ในเมนูนี้แล้ว");
            }
          }
          current.name = name;
        }
        if (patch.sortOrder !== undefined) current.sortOrder = normalizeOptionSortOrder(patch.sortOrder);
        current.updatedAt = nowIso();
        await writeAudit(optionGroupUpdatedEvent(before, { ...current }, actor));
        return { ...current };
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async createMenuOption(groupId, input, actor) {
      const backup = backupInventory();
      try {
        const group = optionGroups.get(groupId);
        if (!group) throw new NotFoundError("ไม่พบกลุ่มตัวเลือก");
        const menu = menuItems.get(group.menuId);
        if (!menu) throw new NotFoundError("ไม่พบเมนู");
        if (menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        const name = normalizeOptionName(input.name);
        const priceDelta = normalizePriceDelta(input.priceDelta ?? 0);
        const isEnabled = input.isEnabled === undefined ? true : normalizeEnabled(input.isEnabled);
        const sortOrder = normalizeOptionSortOrder(input.sortOrder ?? 0);
        for (const o of menuOptions.values()) {
          if (o.groupId === groupId && o.name === name) {
            throw new ConflictError("ชื่อตัวเลือกนี้มีอยู่ในกลุ่มนี้แล้ว");
          }
        }
        const now = nowIso();
        const option: MenuOption = {
          id: randomUUID(), groupId, menuId: group.menuId, name, priceDelta, isEnabled, sortOrder, createdAt: now, updatedAt: now,
        };
        menuOptions.set(option.id, option);
        await writeAudit(optionCreatedEvent(option, group.name, actor));
        return { ...option };
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async updateMenuOption(id, patch, actor) {
      const backup = backupInventory();
      try {
        const current = menuOptions.get(id);
        if (!current) throw new NotFoundError("ไม่พบตัวเลือก");
        const menu = menuItems.get(current.menuId);
        if (!menu || menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        const before = { ...current };
        if (patch.name !== undefined) {
          const name = normalizeOptionName(patch.name);
          for (const other of menuOptions.values()) {
            if (other.id !== id && other.groupId === current.groupId && other.name === name) {
              throw new ConflictError("ชื่อตัวเลือกนี้มีอยู่ในกลุ่มนี้แล้ว");
            }
          }
          current.name = name;
        }
        if (patch.priceDelta !== undefined) current.priceDelta = normalizePriceDelta(patch.priceDelta);
        if (patch.isEnabled !== undefined) current.isEnabled = normalizeEnabled(patch.isEnabled);
        if (patch.sortOrder !== undefined) current.sortOrder = normalizeOptionSortOrder(patch.sortOrder);
        current.updatedAt = nowIso();
        const after = { ...current };
        const keys = Object.keys(patch) as (keyof typeof patch)[];
        const onlyEnabledChanged = keys.length === 1 && keys[0] === "isEnabled";
        await writeAudit(
          onlyEnabledChanged
            ? optionStatusChangedEvent(before, after, actor)
            : optionUpdatedEvent(before, after, actor),
        );
        return after;
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async listMenuOptions(menuId) {
      return [...menuOptions.values()]
        .filter((o) => o.menuId === menuId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"))
        .map((o) => ({ ...o }));
    },
    async listPublicMenuWithOptions() {
      const sellable = [...menuItems.values()]
        .filter((m) => m.status === "available" && !m.isArchived)
        .sort(
          (a, b) =>
            compareMenuCategory(a.category, b.category) ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name, "th"),
        );
      return sellable.map((m) => {
        const groups: PublicMenuOptionGroup[] = groupsOfMenu(m.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            sortOrder: g.sortOrder,
            options: optionsOfGroup(g.id)
              .filter((o) => o.isEnabled)
              .map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta, sortOrder: o.sortOrder })),
          }))
          .filter((g) => g.options.length > 0);
        return {
          id: m.id,
          category: m.category,
          name: m.name,
          description: m.description,
          imageUrl: m.imageUrl,
          price: m.price,
          kind: m.kind,
          sortOrder: m.sortOrder,
          optionGroups: groups,
          inStock: isMenuOrderable(m.id, 1),
        };
      });
    },
    // ---- Ticket 07 memory: วัตถุดิบ/สต๊อก/สูตร ----
    async createIngredient(input, actor) {
      const backup = backupInventory();
      try {
        const name = normalizeIngredientName(input.name);
        const unit = normalizeIngredientUnit(input.unit);
        const reorderThreshold = normalizeReorderThreshold(input.reorderThreshold ?? 0);
        const latestCost = normalizeLatestCost(input.latestCost ?? 0);
        const initialOnHand = normalizeStockQty(input.initialOnHand ?? 0, "ยอดเริ่มต้น");
        if (ingredientByName.has(name.toLowerCase())) {
          throw new ConflictError("ชื่อวัตถุดิบนี้มีอยู่แล้ว");
        }
        const now = nowIso();
        const ing: Ingredient = {
          id: randomUUID(), name, unit, onHand: initialOnHand, reserved: 0,
          reorderThreshold, latestCost, isEnabled: true, createdAt: now, updatedAt: now,
        };
        ingredients.set(ing.id, ing);
        ingredientByName.set(name.toLowerCase(), ing.id);
        if (initialOnHand > 0) {
          stockLedger.push({
            id: randomUUID(),
            ingredientId: ing.id,
            op: "receive",
            deltaOnHand: initialOnHand,
            deltaReserved: 0,
            beforeOnHand: 0,
            afterOnHand: initialOnHand,
            beforeReserved: 0,
            afterReserved: 0,
            reason: "ยอดเริ่มต้น",
            actorId: actor.actorId ?? null,
            actorUsername: actor.actorUsername ?? null,
            orderId: null,
            reference: null,
            createdAt: now,
          });
        }
        await writeAudit(ingredientCreatedEvent({ ...ing }, actor));
        return { ...ing };
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async listIngredients(options) {
      const includeDisabled = options?.includeDisabled ?? false;
      return [...ingredients.values()]
        .filter((g) => includeDisabled || g.isEnabled)
        .sort((a, b) => a.name.localeCompare(b.name, "th"))
        .map((g) => ({ ...g }));
    },
    async getIngredient(id) {
      const g = ingredients.get(id);
      return g ? { ...g } : null;
    },
    async updateIngredient(id, patch, actor) {
      const backup = backupInventory();
      try {
        const current = ingredients.get(id);
        if (!current) throw new NotFoundError("ไม่พบวัตถุดิบ");
        const before = { ...current };
        if (patch.name !== undefined) {
          const name = normalizeIngredientName(patch.name);
          const key = name.toLowerCase();
          if (ingredientByName.has(key) && ingredientByName.get(key) !== id) {
            throw new ConflictError("ชื่อวัตถุดิบนี้มีอยู่แล้ว");
          }
          ingredientByName.delete(before.name.toLowerCase());
          current.name = name;
          ingredientByName.set(key, id);
        }
        if (patch.reorderThreshold !== undefined) {
          current.reorderThreshold = normalizeReorderThreshold(patch.reorderThreshold);
        }
        if (patch.latestCost !== undefined) current.latestCost = normalizeLatestCost(patch.latestCost);
        if (patch.isEnabled !== undefined) current.isEnabled = normalizeEnabled(patch.isEnabled);
        current.updatedAt = nowIso();
        const after = { ...current };
        const keys = Object.keys(patch) as (keyof typeof patch)[];
        const onlyEnabledChanged = keys.length === 1 && keys[0] === "isEnabled";
        await writeAudit(
          onlyEnabledChanged
            ? ingredientStatusChangedEvent(before, after, actor)
            : ingredientUpdatedEvent(before, after, actor),
        );
        return after;
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async recordStockMovement(ingredientId, input, actor) {
      // ธุรกรรม manual แตะยอดคงเหลือ — serialize ร่วมกับคิวคำสั่งซื้อกันแข่งกับจองสต๊อก
      return runOrderExclusive(async () => {
        const backup = backupOrders();
        try {
          const ing = ingredients.get(ingredientId);
          if (!ing) throw new NotFoundError("ไม่พบวัตถุดิบ");
          const op = normalizeManualStockOp(input.op);
          const qty = normalizeMovementQty(input.qty);
          const reason = normalizeStockReason(input.reason);
          const reference = normalizeStockReference(input.reference ?? null);
          const beforeOnHand = ing.onHand;
          const beforeReserved = ing.reserved;
          let deltaOnHand = 0;
          if (op === "receive" || op === "return") {
            ing.onHand = roundStock(ing.onHand + qty);
            deltaOnHand = qty;
          } else if (op === "waste" || op === "expire" || op === "personal_use") {
            // ห้ามทำให้พร้อมขายติดลบ (ของที่จองให้คำสั่งซื้อแล้วต้องเหลือพอ)
            if (roundStock(ing.onHand - qty) < ing.reserved) {
              throw new ConflictError(
                `คงเหลือไม่พอ (มี ${ing.onHand} ${ing.unit} แต่จองให้คำสั่งซื้อแล้ว ${ing.reserved} ${ing.unit})`,
              );
            }
            ing.onHand = roundStock(ing.onHand - qty);
            deltaOnHand = -qty;
          } else {
            // adjust: qty เป็น delta บวก/ลด — ห้ามติดลบทั้งคงเหลือและพร้อมขาย
            if (roundStock(ing.onHand + qty) < 0 || roundStock(ing.onHand + qty) < ing.reserved) {
              throw new ConflictError(
                `ปรับยอดไม่ได้ (คงเหลือ ${ing.onHand} ${ing.unit} จองแล้ว ${ing.reserved} ${ing.unit})`,
              );
            }
            ing.onHand = roundStock(ing.onHand + qty);
            deltaOnHand = qty;
          }
          ing.updatedAt = nowIso();
          const entry: StockLedgerEntry = {
            id: randomUUID(),
            ingredientId,
            op,
            deltaOnHand,
            deltaReserved: 0,
            beforeOnHand,
            afterOnHand: ing.onHand,
            beforeReserved,
            afterReserved: ing.reserved,
            reason,
            actorId: actor.actorId ?? null,
            actorUsername: actor.actorUsername ?? null,
            orderId: null,
            reference,
            createdAt: nowIso(),
          };
          stockLedger.push(entry);
          await writeAudit(stockUpdatedEvent(entry, ing.name, ing.unit, actor));
          return { ingredient: { ...ing }, entry: { ...entry } };
        } catch (err) {
          restoreOrders(backup);
          throw err;
        }
      });
    },
    async listStockLedger(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...stockLedger]
        .reverse()
        .filter((e) => (filter.ingredientId ? e.ingredientId === filter.ingredientId : true))
        .filter((e) => (filter.orderId ? e.orderId === filter.orderId : true))
        .filter((e) => (filter.op ? e.op === filter.op : true))
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },
    async createRecipe(input, actor) {
      const backup = backupInventory();
      try {
        const lines = normalizeRecipeLines(input.lines);
        const targetId = normalizeTargetId(input.targetId);
        let targetName = "";
        if (input.targetType === "menu") {
          const menu = menuItems.get(targetId);
          if (!menu) throw new NotFoundError("ไม่พบเมนูเป้าหมายของสูตร");
          targetName = menu.name;
        } else if (input.targetType === "option") {
          const opt = menuOptions.get(targetId);
          if (!opt) throw new NotFoundError("ไม่พบตัวเลือกเป้าหมายของสูตร");
          targetName = opt.name;
        } else {
          throw new Error("เป้าหมายสูตรต้องเป็น เมนู หรือ ตัวเลือก");
        }
        // วัตถุดิบทุกบรรทัดต้องมีอยู่และเปิดใช้ (กันสูตรอ้างของที่ใช้ไม่ได้)
        for (const line of lines) {
          const ing = ingredients.get(line.ingredientId);
          if (!ing) throw new NotFoundError("สูตรอ้างอิงวัตถุดิบที่ไม่พบ");
          if (!ing.isEnabled) throw new ConflictError(`วัตถุดิบ "${ing.name}" งดใช้อยู่ ใช้ในสูตรไม่ได้`);
        }
        const key = recipeKey(input.targetType, targetId);
        const existing = recipeVersionsByTarget.get(key) ?? [];
        const version = existing.length + 1;
        let estimated = 0;
        for (const line of lines) {
          const ing = ingredients.get(line.ingredientId)!;
          estimated = roundBaht(estimated + roundBaht(line.qty * ing.latestCost));
        }
        const recipe: Recipe = {
          id: randomUUID(),
          targetType: input.targetType,
          targetId,
          version,
          lines: lines.map((l) => ({ ...l })),
          estimatedCostPerUnit: estimated,
          createdBy: actor.actorUsername ?? actor.actorId ?? null,
          createdAt: nowIso(),
        };
        recipes.set(recipe.id, recipe);
        recipeVersionsByTarget.set(key, [...existing, recipe]);
        await writeAudit(recipeCreatedEvent(recipe, targetName, actor));
        return { ...recipe, lines: recipe.lines.map((l) => ({ ...l })) };
      } catch (err) {
        restoreInventory(backup);
        throw err;
      }
    },
    async listRecipes(targetType, targetId) {
      const list = recipeVersionsByTarget.get(recipeKey(targetType, targetId)) ?? [];
      return list.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) }));
    },
    async getLatestRecipe(targetType, targetId) {
      return latestRecipeOf(targetType, targetId);
    },
    async consumeOrderStock(id, actor) {
      return runOrderExclusive(async () => {
        const backup = backupOrders();
        try {
          const current = orders.get(id);
          if (!current) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (current.status === "cancelled") {
            throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว ตัดสต๊อกไม่ได้");
          }
          if (!current.stockReserved) {
            throw new ConflictError("คำสั่งซื้อนี้ไม่มีการจองสต๊อก (ไม่มีสูตร) ตัดสต๊อกไม่ได้");
          }
          // ตัดแล้วเรียกซ้ำเป็น no-op (ไม่เขียน ledger/audit ซ้ำ — กัน event ซ้ำ)
          if (current.stockConsumed) {
            return { order: toDetail(id)!, deduplicated: true };
          }
          const usage = orderStockUsage.get(id) ?? [];
          for (const u of usage) {
            const ing = ingredients.get(u.ingredientId);
            if (!ing) continue;
            const beforeOnHand = ing.onHand;
            const beforeReserved = ing.reserved;
            ing.reserved = roundStock(Math.max(0, ing.reserved - u.qty));
            ing.onHand = roundStock(ing.onHand - u.qty);
            ing.updatedAt = nowIso();
            stockLedger.push({
              id: randomUUID(),
              ingredientId: u.ingredientId,
              op: "consume",
              deltaOnHand: -u.qty,
              deltaReserved: -u.qty,
              beforeOnHand,
              afterOnHand: ing.onHand,
              beforeReserved,
              afterReserved: ing.reserved,
              reason: `ตัดใช้จริงให้คำสั่งซื้อ ${current.orderNumber} เมื่อเริ่มทำ`,
              actorId: actor.actorId ?? null,
              actorUsername: actor.actorUsername ?? null,
              orderId: id,
              reference: current.orderNumber,
              createdAt: nowIso(),
            });
          }
          current.stockConsumed = true;
          current.updatedAt = new Date().toISOString();
          const order = toDetail(id)!;
          await writeAudit(orderStockConsumedEvent(order.orderNumber, order.id, actor));
          return { order, deduplicated: false };
        } catch (err) {
          restoreOrders(backup);
          throw err;
        }
      });
    },
    // ---- Ticket 08 memory: การชำระเงิน ใบเสร็จ และคืนเงิน (local-first state machine) ----
    async createPayment(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const method = normalizePaymentMethod(input.method);
          const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
          const order = orders.get(input.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.status !== "pending_payment") {
            throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว ไม่สามารถชำระเงินได้อีก");
          }
          const amount = order.total;
          const hash = paymentPayloadHash({
            orderId: order.id,
            method,
            amount,
            receivedAmount: input.receivedAmount ?? null,
          });
          // idempotency: key เดิม → คืนของเดิม / ขัดแย้ง
          const existingIdem = paymentsByIdemKey.get(idempotencyKey);
          if (existingIdem) {
            const ex = payments.get(existingIdem)!;
            const exHash = paymentPayloadHash({
              orderId: ex.orderId,
              method: ex.method,
              amount: ex.amount,
              receivedAmount: ex.receivedAmount,
            });
            if (exHash !== hash) throw new ConflictError("คำขอนี้ถูกใช้ชำระไปแล้ว กรุณาสร้างคำขอใหม่");
            return {
              payment: { ...ex },
              qrPayload: ex.method === "promptpay" && ex.status === "pending" ? `PROMPTPAY-FAKE:${ex.id}:${ex.amount}` : null,
              deduplicated: true,
            };
          }
          // กัน intent ซ้อน: มีรายการค้าง (pending/manual_review) หรือสำเร็จ (paid/refunded) แล้วห้ามสร้างใหม่
          const activeId = paymentsByOrder.get(order.id);
          if (activeId) {
            const active = payments.get(activeId)!;
            if (active.status === "pending" || active.status === "manual_review") {
              throw new ConflictError("มีคำขอชำระที่ดำเนินการอยู่แล้ว กรุณารอผลหรือยกเลิกก่อน");
            }
            if (active.status === "paid" || active.status === "refunded") {
              throw new ConflictError("คำสั่งซื้อนี้ชำระสำเร็จแล้ว ไม่รับการชำระซ้ำ");
            }
          }
          let receivedAmount: number | null = null;
          let changeAmount = 0;
          let providerRef: string | null = null;
          let qrPayload: string | null = null;
          if (method === "cash") {
            if (input.receivedAmount === undefined || input.receivedAmount === null) {
              throw new Error("กรุณาระบุจำนวนเงินที่รับมา");
            }
            changeAmount = assertCashTendered(amount, input.receivedAmount);
            receivedAmount = Math.round(input.receivedAmount * 100) / 100;
          } else {
            providerRef = null; // ประกอบหลังมี payment id จริงด้านล่าง
            qrPayload = null;
          }
          const at = now.toISOString();
          const id = randomUUID();
          if (method === "promptpay") {
            const provider = new FakePromptPayProvider();
            const expiresAt = new Date(now.getTime() + PAYMENT_PROMPTPAY_TTL_MINUTES * 60 * 1000);
            const intent = await provider.createIntent(id, amount, expiresAt);
            providerRef = intent.providerRef;
            qrPayload = intent.qrPayload;
          }
          const payment: Payment = {
            id,
            orderId: order.id,
            orderNumber: order.orderNumber,
            method,
            amount,
            receivedAmount,
            changeAmount,
            status: "pending",
            providerRef,
            slipRef: typeof input.slipRef === "string" && input.slipRef.trim() ? input.slipRef.trim() : null,
            receiptNumber: null,
            idempotencyKey,
            paidAt: null,
            expiresAt: new Date(now.getTime() + PAYMENT_PROMPTPAY_TTL_MINUTES * 60 * 1000).toISOString(),
            createdAt: at,
            updatedAt: at,
          };
          payments.set(id, { ...payment });
          paymentsByOrder.set(order.id, id);
          paymentsByIdemKey.set(idempotencyKey, id);
          await writeAudit(paymentCreatedEvent({ ...payment }, actor));
          return { payment: { ...payment }, qrPayload, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async getPayment(id) {
      const p = payments.get(id);
      return p ? { ...p } : null;
    },
    async getOrderPayment(orderId) {
      const pid = paymentsByOrder.get(orderId);
      if (!pid) return null;
      const p = payments.get(pid);
      return p ? { ...p } : null;
    },
    async getOrderPaymentState(orderId) {
      return orderPaymentStateOf(orderId);
    },
    async listPayments(filter) {
      const needle = (filter.q ?? "").trim().toLowerCase();
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...payments.values()]
        .filter((p) => (filter.status ? p.status === filter.status : true))
        .filter((p) => (filter.method ? p.method === filter.method : true))
        .filter((p) =>
          needle
            ? p.orderNumber.toLowerCase().includes(needle) ||
              (p.receiptNumber ?? "").toLowerCase().includes(needle)
            : true,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
    async confirmCashPayment(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = payments.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          expireIfDue(current, now, actor);
          // จ่ายแล้วเรียกซ้ำเป็น no-op (คืนใบเสร็จเดิม ไม่เขียน audit ซ้ำ — กัน success ซ้ำ)
          if (current.status === "paid") {
            const receipt = receipts.get(id);
            if (!receipt) throw new Error("ไม่พบใบเสร็จของการชำระนี้");
            return { payment: { ...current }, receipt: { ...receipt, items: receipt.items.map((i) => ({ ...i })) }, deduplicated: true };
          }
          if (current.method !== "cash") throw new ConflictError("รายการนี้ไม่ใช่การชำระด้วยเงินสด");
          const order = orders.get(current.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว ยืนยันรับเงินไม่ได้");
          if (current.amount !== order.total) throw new ConflictError("ยอดชำระไม่ตรงกับยอดคำสั่งซื้อปัจจุบัน");
          const tendered = input.receivedAmount ?? current.receivedAmount;
          if (tendered === null || tendered === undefined) throw new Error("กรุณาระบุจำนวนเงินที่รับมา");
          current.changeAmount = assertCashTendered(current.amount, tendered);
          current.receivedAmount = Math.round(tendered * 100) / 100;
          const reason = input.reason?.trim() ? normalizePaymentReason(input.reason) : "รับเงินสดหน้าร้าน";
          const receipt = await markPaymentPaid(current, order, reason, actor, now);
          return { payment: { ...current }, receipt, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async handlePaymentWebhook(paymentId, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const eventId = normalizeProviderEventId(input.providerEventId);
          const outcome = normalizeProviderOutcome(input.outcome);
          // dedupe: event นี้เคยประมวลผลแล้ว → คืนผลเดิมโดยไม่ side effect ซ้ำ
          const seenEvent = paymentEventsByProviderKey.get(eventId);
          if (seenEvent) {
            const ev = paymentEvents.find((e) => e.id === seenEvent)!;
            const p = payments.get(ev.paymentId)!;
            const receipt = receipts.get(p.id) ?? null;
            return {
              payment: { ...p },
              receipt: receipt ? { ...receipt, items: receipt.items.map((i) => ({ ...i })) } : null,
              deduplicated: true,
            };
          }
          const current = payments.get(paymentId);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          // ปฏิเสธ success ซ้ำ: จ่ายสำเร็จแล้วไม่รับผล webhook อีก
          if (current.status === "paid" || current.status === "refunded") {
            throw new ConflictError("รายการนี้ชำระสำเร็จแล้ว ไม่รับผลการชำระซ้ำ");
          }
          expireIfDue(current, now, actor);
          if (current.status === "expired") {
            recordPaymentEvent(current.id, eventId, outcome, input.summary ?? null, now);
            return { payment: { ...current }, receipt: null, deduplicated: false };
          }
          const order = orders.get(current.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
          const target = outcomeToStatus(outcome);
          assertPaymentTransition(current.status, target);
          recordPaymentEvent(current.id, eventId, outcome, input.summary ?? null, now);
          if (target === "paid") {
            const receipt = await markPaymentPaid(current, order, `ผลยืนยันจากผู้ให้บริการ (${outcome})`, actor, now);
            return { payment: { ...current }, receipt, deduplicated: false };
          }
          const before = { status: current.status as PaymentStatus };
          current.status = target;
          current.updatedAt = now.toISOString();
          await writeAudit(paymentStatusChangedEvent(before, { ...current }, `ผลยืนยันจากผู้ให้บริการ (${outcome})`, actor));
          return { payment: { ...current }, receipt: null, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async submitPaymentSlip(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          if (!isFakePaymentMode()) {
            throw new Error("ผู้ให้บริการตรวจ slip จริงยังไม่เปิดใช้งาน (contract-only)");
          }
          const slipRef = input.slipRef.trim();
          if (!slipRef) throw new Error("กรุณาระบุเลขอ้างอิง slip");
          if (slipRef.length > 120) throw new Error("เลขอ้างอิง slip ยาวเกินไป");
          const provider = new FakePromptPayProvider();
          const outcome = await provider.verifySlip(slipRef);
          // slip เดิมส่งซ้ำ = event เดิม (dedupe ด้วย slip ref — กัน success ซ้ำ)
          const eventId = `slip:${slipRef}`;
          const seenEvent = paymentEventsByProviderKey.get(eventId);
          if (seenEvent) {
            const ev = paymentEvents.find((e) => e.id === seenEvent)!;
            const p = payments.get(ev.paymentId)!;
            const receipt = receipts.get(p.id) ?? null;
            return {
              payment: { ...p },
              receipt: receipt ? { ...receipt, items: receipt.items.map((i) => ({ ...i })) } : null,
              deduplicated: true,
            };
          }
          const current = payments.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          if (current.status === "paid" || current.status === "refunded") {
            throw new ConflictError("รายการนี้ชำระสำเร็จแล้ว ไม่รับผลการชำระซ้ำ");
          }
          expireIfDue(current, now, actor);
          if (current.status === "expired") {
            recordPaymentEvent(current.id, eventId, outcome, `ตรวจ slip ${slipRef}`, now);
            return { payment: { ...current }, receipt: null, deduplicated: false };
          }
          const order = orders.get(current.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
          current.slipRef = slipRef;
          const target = outcomeToStatus(outcome);
          assertPaymentTransition(current.status, target);
          recordPaymentEvent(current.id, eventId, outcome, `ตรวจ slip ${slipRef}`, now);
          if (target === "paid") {
            const receipt = await markPaymentPaid(current, order, `ตรวจ slip ผ่าน (${slipRef})`, actor, now);
            return { payment: { ...current }, receipt, deduplicated: false };
          }
          const before = { status: current.status as PaymentStatus };
          current.status = target;
          current.updatedAt = now.toISOString();
          await writeAudit(paymentStatusChangedEvent(before, { ...current }, `ตรวจ slip (${slipRef}) ผล ${outcome}`, actor));
          return { payment: { ...current }, receipt: null, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async resolveManualReview(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = payments.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          if (current.status !== "manual_review") throw new ConflictError("รายการนี้ไม่ได้รอตรวจสอบ");
          const reason = normalizePaymentReason(input.reason);
          const order = orders.get(current.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (input.decision === "paid") {
            if (order.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
            const receipt = await markPaymentPaid(current, order, reason, actor, now);
            return { payment: { ...current }, receipt };
          }
          const target: PaymentStatus = input.decision === "failed" ? "failed" : "cancelled";
          assertPaymentTransition(current.status, target);
          const before = { status: current.status as PaymentStatus };
          current.status = target;
          current.updatedAt = now.toISOString();
          await writeAudit(paymentStatusChangedEvent(before, { ...current }, reason, actor));
          return { payment: { ...current }, receipt: null };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async expirePayment(id, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = payments.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          if (current.status !== "pending") {
            return { payment: { ...current }, deduplicated: true };
          }
          const before = { status: current.status as PaymentStatus };
          current.status = "expired";
          current.updatedAt = now.toISOString();
          await writeAudit(paymentStatusChangedEvent(before, { ...current }, "intent หมดอายุ", actor));
          return { payment: { ...current }, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async getReceiptByPayment(paymentId) {
      const r = receipts.get(paymentId);
      return r ? { ...r, items: r.items.map((i) => ({ ...i })) } : null;
    },
    async getReceiptByNumber(receiptNumber) {
      const pid = receiptsByNumber.get(receiptNumber.trim());
      if (!pid) return null;
      const r = receipts.get(pid);
      return r ? { ...r, items: r.items.map((i) => ({ ...i })) } : null;
    },
    async listReceipts(filter) {
      const needle = (filter.q ?? "").trim().toLowerCase();
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...receipts.values()]
        .filter((r) => {
          if (filter.date) {
            const day = new Date(r.paidAt).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
            if (day !== filter.date) return false;
          }
          if (needle) {
            return (
              r.receiptNumber.toLowerCase().includes(needle) ||
              r.orderNumber.toLowerCase().includes(needle)
            );
          }
          return true;
        })
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .slice(0, limit)
        .map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) }));
    },
    async approveRefund(paymentId, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = payments.get(paymentId);
          if (!current) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          if (current.status !== "paid") throw new ConflictError("คืนเงินได้เฉพาะรายการที่ชำระสำเร็จแล้ว");
          const reason = normalizePaymentReason(input.reason);
          const order = orders.get(current.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.status !== "pending_payment") {
            throw new ConflictError("คำสั่งซื้อนี้ปิดงาน/เริ่มทำแล้ว คืนเงินไม่ได้");
          }
          if (order.stockConsumed) {
            throw new ConflictError("คำสั่งซื้อเริ่มทำ (ตัดสต๊อกจริง) แล้ว คืนเงินไม่ได้");
          }
          // คืนยอดจองตาม Ticket 07 contract (ยกเลิกก่อนเริ่มทำ)
          if (order.stockReserved) {
            await releaseStockForOrder(order.id, order.orderNumber, `คืนเงิน: ${reason}`, actor);
          }
          const beforeOrder = { status: order.status, total: order.total };
          order.status = "cancelled";
          order.updatedAt = now.toISOString();
          const detail = toDetail(order.id)!;
          await writeAudit(orderStatusChangedEvent(beforeOrder, detail, `คืนเงิน: ${reason}`, actor));
          if (order.stockReserved) {
            await writeAudit(orderStockReleasedEvent(order.orderNumber, order.id, `คืนเงิน: ${reason}`, actor));
          }
          const beforePay = { status: current.status as PaymentStatus };
          current.status = "refunded";
          current.updatedAt = now.toISOString();
          void beforePay;
          const at = now.toISOString();
          const refund: Refund = {
            id: randomUUID(),
            paymentId: current.id,
            orderId: order.id,
            orderNumber: order.orderNumber,
            amount: current.amount,
            reason,
            approvedBy: actor.actorUsername ?? actor.actorId ?? null,
            approvedAt: at,
            createdAt: at,
          };
          refunds.set(refund.id, { ...refund });
          await writeAudit(paymentRefundApprovedEvent({ ...current }, refund.id, reason, actor));
          // Ticket 10: คืนเงินต้องย้อนคะแนน earn ที่เกี่ยวข้อง (กัน double-reversal)
          await reversePointsOnRefundInternal(order.id, refund.id, actor, now);
          return { payment: { ...current }, refund: { ...refund } };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async listRefunds(limit) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      return [...refunds.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, n)
        .map((r) => ({ ...r }));
    },
    // ---- Ticket 09 memory: คิวครัว/เครื่องดื่มและการส่งมอบ ----
    async ensureQueueJobs(paymentId, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const p = payments.get(paymentId);
          if (!p) throw new NotFoundError("ไม่พบรายการชำระเงิน");
          if (p.status !== "paid") {
            throw new ConflictError("สร้างงานคิวได้เฉพาะคำสั่งซื้อที่ชำระสำเร็จแล้ว");
          }
          const detail = toDetail(p.orderId);
          if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (detail.status === "cancelled") {
            throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว สร้างงานคิวไม่ได้");
          }
          const existing = queueByPayment.get(p.id);
          if (existing) {
            return { jobs: existing.map((id) => toQueueDetail(id)!), deduplicated: true };
          }
          const created = await ensureQueueJobsInternal(p, detail, actor, now);
          return { jobs: created.map((j) => toQueueDetail(j.id)!), deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async listOrderQueueJobs(orderId) {
      const ids = queueByOrder.get(orderId) ?? [];
      return ids.map((id) => toQueueDetail(id)!).filter(Boolean);
    },
    async getQueueJob(id) {
      return toQueueDetail(id);
    },
    async listQueueJobs(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const now = new Date();
      return [...queueJobs.values()]
        .filter((j) => (filter.station ? j.station === filter.station : true))
        .filter((j) => (filter.status ? j.status === filter.status : true))
        .filter((j) => (filter.orderId ? j.orderId === filter.orderId : true))
        .sort((a, b) => compareQueueJobs(a, b, now))
        .slice(0, limit)
        .map((j) => toQueueDetail(j.id)!);
    },
    async claimQueueJob(id, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(job.orderId);
          assertQueueTransition(job.status, "claimed");
          const before = { status: job.status };
          job.status = "claimed";
          job.claimedBy = actor.actorUsername ?? actor.actorId ?? null;
          job.updatedAt = now.toISOString();
          await writeAudit(queueStatusChangedEvent(before, { ...job }, "รับงานเข้าทำ", actor));
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async startQueueJob(id, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(job.orderId);
          assertQueueTransition(job.status, "preparing");
          const before = { status: job.status };
          job.status = "preparing";
          job.claimedBy = actor.actorUsername ?? actor.actorId ?? null;
          job.updatedAt = now.toISOString();
          // ตัดสต๊อกจริงครั้งแรกของคำสั่งซื้อ (ครั้งเดียว — เรียกซ้ำ/งานอื่นเป็น no-op)
          // งานรางวัล (orderId null) ตัดสต๊อกแล้วตอนร้านรับแลก จึงข้ามขั้นนี้
          const order = job.orderId ? orders.get(job.orderId) : undefined;
          if (order && order.stockReserved && !order.stockConsumed) {
            const usage = orderStockUsage.get(order.id) ?? [];
            for (const u of usage) {
              const ing = ingredients.get(u.ingredientId);
              if (!ing) continue;
              const beforeOnHand = ing.onHand;
              const beforeReserved = ing.reserved;
              ing.reserved = Math.max(0, Math.round((ing.reserved - u.qty) * 1000) / 1000);
              ing.onHand = Math.round((ing.onHand - u.qty) * 1000) / 1000;
              ing.updatedAt = nowIso();
              stockLedger.push({
                id: randomUUID(),
                ingredientId: u.ingredientId,
                op: "consume",
                deltaOnHand: -u.qty,
                deltaReserved: -u.qty,
                beforeOnHand,
                afterOnHand: ing.onHand,
                beforeReserved,
                afterReserved: ing.reserved,
                reason: `ตัดใช้จริงให้คำสั่งซื้อ ${order.orderNumber} เมื่อเริ่มทำ (งานคิว ${job.id})`,
                actorId: actor.actorId ?? null,
                actorUsername: actor.actorUsername ?? null,
                orderId: order.id,
                reference: order.orderNumber,
                createdAt: nowIso(),
              });
            }
            order.stockConsumed = true;
            order.updatedAt = now.toISOString();
            await writeAudit(orderStockConsumedEvent(order.orderNumber, order.id, actor));
          }
          await writeAudit(queueStatusChangedEvent(before, { ...job }, "เริ่มทำ", actor));
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async completeQueueJob(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(job.orderId);
          if (job.status !== "claimed" && job.status !== "preparing") {
            throw new ConflictError("บันทึกทำเสร็จได้เฉพาะงานที่รับงานหรือกำลังทำอยู่");
          }
          const qty = normalizeQueueQty(input.qty);
          if (job.readyQty + qty > job.quantity) {
            throw new ConflictError(`จำนวนทำเสร็จเกินยอดงาน (ทำเสร็จแล้ว ${job.readyQty}/${job.quantity})`);
          }
          const before = { status: job.status };
          job.readyQty += qty;
          job.status = job.readyQty === job.quantity ? "ready" : "preparing";
          job.updatedAt = now.toISOString();
          await writeAudit(
            queueStatusChangedEvent(before, { ...job }, `ทำเสร็จ ${qty} รายการ`, actor),
          );
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async deliverQueueJob(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(job.orderId);
          if (job.status !== "ready") {
            throw new ConflictError("ส่งมอบได้เฉพาะงานที่พร้อมส่งมอบแล้ว");
          }
          const qty = normalizeQueueQty(input.qty);
          if (job.deliveredQty + qty > job.readyQty) {
            throw new ConflictError(
              `จำนวนส่งมอบเกินจำนวนที่ทำเสร็จ (ส่งมอบแล้ว ${job.deliveredQty}/${job.readyQty} ที่ทำเสร็จ)`,
            );
          }
          if (job.deliveredQty + qty > job.quantity) {
            throw new ConflictError(`จำนวนส่งมอบเกินยอดงาน (${job.quantity})`);
          }
          const before = { status: job.status };
          job.deliveredQty += qty;
          job.status = job.deliveredQty === job.quantity ? "delivered" : "ready";
          job.updatedAt = now.toISOString();
          await writeAudit(
            queueStatusChangedEvent(before, { ...job }, `ส่งมอบ ${qty} รายการ`, actor),
          );
          // Ticket 10: ส่งมอบแล้วเข้าเงื่อนไขสะสมคะแนน (exactly-once — ซ้ำเป็น no-op)
          // งานรางวัล (orderId null) ไม่ได้คะแนน — helper ข้ามเอง
          if (job.orderId !== null) {
            await tryAutoEarnForOrderInternal(job.orderId, actor, now);
          }
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async prioritizeQueueJob(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(job.orderId);
          if (job.status === "delivered" || job.status === "cancelled") {
            throw new ConflictError("งานคิวนี้ปิดงานแล้ว เร่งงานไม่ได้");
          }
          const reason = normalizeQueueReason(input.reason);
          job.isPriority = true;
          job.reason = reason;
          job.updatedAt = now.toISOString();
          await writeAudit(queuePriorityEvent({ ...job }, reason, actor));
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async remakeQueueJob(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const original = queueJobs.get(id);
          if (!original) throw new NotFoundError("ไม่พบงานคิว");
          assertQueueOrderActive(original.orderId);
          if (original.status === "cancelled") {
            throw new ConflictError("งานคิวนี้ถูกยกเลิกแล้ว ทำใหม่ไม่ได้");
          }
          const reason = normalizeQueueReason(input.reason);
          const remaining = original.quantity - original.deliveredQty;
          if (remaining <= 0) {
            throw new ConflictError("งานนี้ส่งมอบครบแล้ว ไม่ต้องทำใหม่");
          }
          const qty =
            input.quantity === undefined || input.quantity === null
              ? remaining
              : normalizeQueueQty(input.quantity);
          if (qty > remaining) {
            throw new ConflictError(`จำนวนทำใหม่เกินคงเหลือที่ยังไม่ส่งมอบ (${remaining})`);
          }
          const at = now.toISOString();
          const remake: QueueJob = {
            id: randomUUID(),
            orderId: original.orderId,
            orderNumber: original.orderNumber,
            paymentId: original.paymentId,
            orderItemId: original.orderItemId,
            menuId: original.menuId,
            menuName: original.menuName,
            station: original.station,
            quantity: qty,
            readyQty: 0,
            deliveredQty: 0,
            status: "queued",
            readyAt: at,
            tableId: original.tableId,
            roundId: original.roundId,
            isRemake: true,
            isPriority: false,
            reason,
            claimedBy: null,
            rewardRedemptionId: original.rewardRedemptionId,
            createdAt: at,
            updatedAt: at,
          };
          queueJobs.set(remake.id, remake);
          // งานรางวัล (orderId null) ไม่ผูกคำสั่งซื้อ — ข้ามดัชนีรายคำสั่งซื้อ
          if (remake.orderId !== null) {
            const orderList = queueByOrder.get(remake.orderId) ?? [];
            queueByOrder.set(remake.orderId, [...orderList, remake.id]);
          }
          await writeAudit(queueRemadeEvent({ ...original }, { ...remake }, reason, actor));
          return toQueueDetail(remake.id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async cancelQueueJob(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const job = queueJobs.get(id);
          if (!job) throw new NotFoundError("ไม่พบงานคิว");
          // งานรางวัล (ไม่ผูกคำสั่งซื้อ) ยกเลิกผ่านการคืนคะแนนแลก ไม่ใช่ช่องทางนี้
          if (job.orderId === null || job.rewardRedemptionId !== null) {
            throw new ConflictError("งานรางวัลยกเลิกได้ผ่านการคืนคะแนนแลกเท่านั้น");
          }
          const order = orders.get(job.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.stockConsumed) {
            throw new ConflictError("คำสั่งซื้อเริ่มทำ (ตัดสต๊อกจริง) แล้ว ยกเลิกงานคิวไม่ได้");
          }
          const pid = paymentsByOrder.get(order.id);
          if (pid) {
            const pay = payments.get(pid);
            if (pay && pay.status === "refunded") {
              throw new ConflictError("คำสั่งซื้อนี้คืนเงินแล้ว ยกเลิกงานคิวไม่ได้");
            }
          }
          if (job.status !== "queued" && job.status !== "claimed") {
            throw new ConflictError("ยกเลิกงานคิวได้เฉพาะก่อนเริ่มทำเท่านั้น");
          }
          const reason = normalizeQueueReason(input.reason);
          const before = { status: job.status };
          job.status = "cancelled";
          job.reason = reason;
          job.updatedAt = now.toISOString();
          await writeAudit(queueStatusChangedEvent(before, { ...job }, reason, actor));
          return toQueueDetail(id)!;
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async getStationCapacity(station) {
      const c = capacityOf(normalizeStation(station));
      return { station: normalizeStation(station), perSlot: c.perSlot, updatedBy: c.updatedBy, updatedAt: c.updatedAt };
    },
    async setStationCapacity(station, perSlot, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const st = normalizeStation(station);
          const n = normalizeCapacityPerSlot(perSlot);
          const before = capacityOf(st).perSlot;
          stationCapacity.set(st, {
            perSlot: n,
            updatedBy: actor.actorUsername ?? actor.actorId ?? null,
            updatedAt: now.toISOString(),
          });
          await writeAudit(queueCapacityUpdatedEvent(st, before, n, actor));
          const c = capacityOf(st);
          return { station: st, perSlot: c.perSlot, updatedBy: c.updatedBy, updatedAt: c.updatedAt };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async listQueueSlots(station, date, now = new Date()) {
      const st = normalizeStation(station);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)");
      const cap = capacityOf(st).perSlot;
      // คำนวณขอบวัน Asia/Bangkok: เที่ยงคืนกรุงเทพ = 17:00Z วันก่อนหน้า (ไม่มี DST)
      const dayStartUtc = new Date(`${date}T00:00:00+07:00`);
      if (Number.isNaN(dayStartUtc.getTime())) throw new Error("รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)");
      const slots: QueueSlot[] = [];
      const slotMs = QUEUE_SLOT_MINUTES * 60 * 1000;
      void now;
      for (let i = 0; i < (24 * 60) / QUEUE_SLOT_MINUTES; i += 1) {
        const start = new Date(dayStartUtc.getTime() + i * slotMs);
        const end = new Date(start.getTime() + slotMs);
        const used = countJobsInSlot(st, start);
        slots.push({
          station: st,
          slotStart: start.toISOString(),
          slotEnd: end.toISOString(),
          used,
          capacity: cap,
          available: Math.max(0, cap - used),
        });
      }
      return slots;
    },
    async suggestNextSlot(station, after, now = new Date()) {
      const st = normalizeStation(station);
      const afterDate = new Date(after);
      if (Number.isNaN(afterDate.getTime())) throw new Error("เวลาไม่ถูกต้อง");
      const cap = capacityOf(st).perSlot;
      const slotMs = QUEUE_SLOT_MINUTES * 60 * 1000;
      let cursor = slotStartOf(afterDate);
      void now;
      // สแกนไม่เกิน 7 วันข้างหน้า (96 สล็อต/วัน)
      for (let i = 0; i < 96 * 7; i += 1) {
        const start = new Date(cursor.getTime() + i * slotMs);
        if (countJobsInSlot(st, start) < cap) {
          return {
            station: st,
            slotStart: start.toISOString(),
            slotEnd: new Date(start.getTime() + slotMs).toISOString(),
            used: countJobsInSlot(st, start),
            capacity: cap,
            available: cap - countJobsInSlot(st, start),
          };
        }
      }
      return null;
    },
    // ---- Ticket 10 memory: คะแนนสะสมและรางวัล (immutable ledger + idempotent) ----
    async earnPointsForOrder(orderId, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const earned = await tryAutoEarnForOrderInternal(orderId, actor, now);
          return { earned, deduplicated: earned === 0 };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async getLoyaltyBalance(customerId) {
      if (!customers.has(customerId)) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
      return loyaltyBalanceOf(customerId);
    },
    async listLoyaltyLedger(customerId, limit) {
      if (!customers.has(customerId)) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
      const n = Math.min(Math.max(limit || 50, 1), 200);
      return [...loyaltyLedger]
        .filter((e) => e.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, n)
        .map((e) => ({ ...e }));
    },
    async createReward(input, actor) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const name = normalizeRewardName(input.name);
          const imageUrl = normalizeRewardImageUrl(input.imageUrl ?? null);
          const pointsCost = normalizeRewardPointsCost(input.pointsCost);
          const quotaTotal = normalizeRewardQuotaTotal(input.quotaTotal ?? null);
          const menu = menuItems.get(input.menuId);
          if (!menu) throw new NotFoundError("ไม่พบเมนูอ้างอิง");
          if (menu.kind !== "drink") throw new ConflictError("รางวัลแลกได้เฉพาะเมนูเครื่องดื่มเท่านั้น");
          if (menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว ใช้เป็นรางวัลไม่ได้");
          const startsAt = input.startsAt ?? null;
          const endsAt = input.endsAt ?? null;
          if (startsAt !== null && Number.isNaN(new Date(startsAt).getTime())) {
            throw new Error("วันเริ่มแลกไม่ถูกต้อง");
          }
          if (endsAt !== null && Number.isNaN(new Date(endsAt).getTime())) {
            throw new Error("วันหมดเขตแลกไม่ถูกต้อง");
          }
          if (startsAt !== null && endsAt !== null && new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
            throw new Error("วันเริ่มแลกต้องไม่หลังวันหมดเขตแลก");
          }
          const at = nowIso();
          const reward: Reward = {
            id: randomUUID(),
            name,
            imageUrl,
            menuId: menu.id,
            menuName: menu.name,
            pointsCost,
            quotaTotal,
            quotaUsed: 0,
            startsAt,
            endsAt,
            isActive: input.isActive ?? true,
            createdAt: at,
            updatedAt: at,
          };
          rewards.set(reward.id, reward);
          await writeAudit(rewardCreatedEvent({ ...reward }, actor));
          return { ...reward };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async listRewards() {
      return [...rewards.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r }));
    },
    async listRedeemableRewards(now = new Date()) {
      return [...rewards.values()]
        .filter((r) => rewardBlockReason(r, now) === null)
        .sort((a, b) => a.pointsCost - b.pointsCost || a.name.localeCompare(b.name, "th"))
        .map((r) => ({ ...r }));
    },
    async getReward(id) {
      const r = rewards.get(id);
      return r ? { ...r } : null;
    },
    async updateReward(id, patch, actor) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = rewards.get(id);
          if (!current) throw new NotFoundError("ไม่พบรางวัล");
          const before = { pointsCost: current.pointsCost, quotaTotal: current.quotaTotal };
          let touched = false;
          let statusOnly = true;
          if (patch.name !== undefined) {
            current.name = normalizeRewardName(patch.name);
            touched = true;
            statusOnly = false;
          }
          if (patch.imageUrl !== undefined) {
            current.imageUrl = normalizeRewardImageUrl(patch.imageUrl);
            touched = true;
            statusOnly = false;
          }
          if (patch.pointsCost !== undefined) {
            current.pointsCost = normalizeRewardPointsCost(patch.pointsCost);
            touched = true;
            statusOnly = false;
          }
          if (patch.quotaTotal !== undefined) {
            const q = normalizeRewardQuotaTotal(patch.quotaTotal);
            if (q !== null && q < current.quotaUsed) {
              throw new ConflictError(`จำนวนสิทธิ์ต้องไม่น้อยกว่าที่ใช้ไปแล้ว (${current.quotaUsed})`);
            }
            current.quotaTotal = q;
            touched = true;
            statusOnly = false;
          }
          if (patch.startsAt !== undefined) {
            const v = patch.startsAt;
            if (v !== null && Number.isNaN(new Date(v).getTime())) throw new Error("วันเริ่มแลกไม่ถูกต้อง");
            current.startsAt = v;
            touched = true;
            statusOnly = false;
          }
          if (patch.endsAt !== undefined) {
            const v = patch.endsAt;
            if (v !== null && Number.isNaN(new Date(v).getTime())) throw new Error("วันหมดเขตแลกไม่ถูกต้อง");
            current.endsAt = v;
            touched = true;
            statusOnly = false;
          }
          if (
            current.startsAt !== null &&
            current.endsAt !== null &&
            new Date(current.startsAt).getTime() > new Date(current.endsAt).getTime()
          ) {
            throw new Error("วันเริ่มแลกต้องไม่หลังวันหมดเขตแลก");
          }
          if (patch.isActive !== undefined) {
            if (typeof patch.isActive !== "boolean") throw new Error("สถานะรางวัลไม่ถูกต้อง");
            current.isActive = patch.isActive;
            touched = true;
          }
          if (!touched) return { ...current };
          current.updatedAt = nowIso();
          if (statusOnly) {
            await writeAudit(rewardStatusChangedEvent({ ...current }, actor));
          } else {
            await writeAudit(rewardUpdatedEvent(before, { ...current }, actor));
          }
          return { ...current };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async redeemReserve(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const key = normalizeLoyaltyIdempotencyKey(input.idempotencyKey);
          const hash = redemptionPayloadHash({ customerId: input.customerId, rewardId: input.rewardId });
          const existingId = redemptionsByIdem.get(key);
          if (existingId) {
            const ex = redemptions.get(existingId)!;
            if (redemptionPayloadHash({ customerId: ex.customerId, rewardId: ex.rewardId }) !== hash) {
              throw new ConflictError("คำขอนี้ถูกใช้แลกไปแล้ว กรุณาสร้างคำขอใหม่");
            }
            return { redemption: { ...ex }, deduplicated: true };
          }
          const customer = customers.get(input.customerId);
          if (!customer || customer.isDeleted || !customer.isActive) {
            throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
          }
          const reward = rewards.get(input.rewardId);
          if (!reward) throw new NotFoundError("ไม่พบรางวัล");
          const blocked = rewardBlockReason(reward, now);
          if (blocked) throw new ConflictError(blocked);
          if (reward.quotaTotal !== null && reward.quotaUsed + rewardHeldCount(reward.id) >= reward.quotaTotal) {
            throw new ConflictError("สิทธิ์แลกของรางวัลนี้หมดแล้ว");
          }
          const balance = loyaltyBalanceOf(customer.id);
          const held = loyaltyHeldOf(customer.id);
          if (balance - held < reward.pointsCost) {
            throw new ConflictError(
              `คะแนนไม่พอแลก (ใช้ ${reward.pointsCost} แต้ม คงเหลือใช้ได้ ${balance - held} แต้ม)`,
            );
          }
          if (!isMenuOrderable(reward.menuId, 1)) {
            throw new ConflictError("วัตถุดิบสำหรับรางวัลนี้ไม่พอชั่วคราว กรุณาลองใหม่ภายหลัง");
          }
          const reason = input.reason === undefined || input.reason === null || input.reason === ""
            ? "แลกคะแนนเป็นเครื่องดื่ม"
            : normalizeLoyaltyReason(input.reason);
          let code = generateRedemptionCode();
          for (let i = 0; i < 5 && redemptionsByCode.has(code); i += 1) {
            code = generateRedemptionCode();
          }
          if (redemptionsByCode.has(code)) {
            throw new ConflictError("สร้างรหัสแลกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          }
          const at = now.toISOString();
          const redemption: RewardRedemption = {
            id: randomUUID(),
            code,
            customerId: customer.id,
            rewardId: reward.id,
            rewardName: reward.name,
            menuId: reward.menuId,
            menuName: reward.menuName,
            pointsCost: reward.pointsCost,
            status: "reserved",
            idempotencyKey: key,
            queueJobId: null,
            reason,
            createdAt: at,
            updatedAt: at,
          };
          redemptions.set(redemption.id, redemption);
          redemptionsByIdem.set(key, redemption.id);
          redemptionsByCode.set(code, redemption.id);
          await writeAudit(redemptionReservedEvent({ ...redemption }, balance - held - reward.pointsCost, actor));
          return { redemption: { ...redemption }, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async getRedemption(id) {
      const r = redemptions.get(id);
      return r ? { ...r } : null;
    },
    async listCustomerRedemptions(customerId, limit) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      return [...redemptions.values()]
        .filter((r) => r.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, n)
        .map((r) => ({ ...r }));
    },
    async listPendingRedemptions(limit) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      return [...redemptions.values()]
        .filter((r) => r.status === "reserved")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, n)
        .map((r) => ({ ...r }));
    },
    async redeemConsume(id, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = redemptions.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการแลก");
          if (current.status === "consumed") {
            const jobId = rewardJobsByRedemption.get(current.id) ?? current.queueJobId;
            if (!jobId) throw new Error("งานคิวของรายการแลกนี้หายไป");
            return { redemption: { ...current }, job: toQueueDetail(jobId)! };
          }
          assertRedemptionTransition(current.status, "consumed");
          const reward = rewards.get(current.rewardId);
          if (!reward) throw new NotFoundError("ไม่พบรางวัล");
          if (!reward.isActive) throw new ConflictError("รางวัลนี้ปิดรับแลกแล้ว");
          if (!isMenuOrderable(current.menuId, 1)) {
            throw new ConflictError("วัตถุดิบหมดชั่วคราว รับรายการไม่ได้ กรุณาคืนคะแนนให้ลูกค้า");
          }
          // ตัดสต๊อกจริง 1 หน่วย (ครั้งเดียว — บันทึก ledger ผูก redemption)
          const recipe = latestRecipeOf("menu", current.menuId);
          if (recipe) {
            for (const line of recipe.lines) {
              const ing = ingredients.get(line.ingredientId);
              if (!ing) continue;
              const need = roundStock(line.qty);
              if (roundStock(ing.onHand - ing.reserved) < need || roundStock(ing.onHand - need) < 0) {
                throw new ConflictError("วัตถุดิบหมดชั่วคราว รับรายการไม่ได้ กรุณาคืนคะแนนให้ลูกค้า");
              }
            }
            for (const line of recipe.lines) {
              const ing = ingredients.get(line.ingredientId);
              if (!ing) continue;
              const need = roundStock(line.qty);
              const beforeOnHand = ing.onHand;
              const beforeReserved = ing.reserved;
              ing.onHand = roundStock(ing.onHand - need);
              ing.updatedAt = nowIso();
              stockLedger.push({
                id: randomUUID(),
                ingredientId: ing.id,
                op: "consume",
                deltaOnHand: -need,
                deltaReserved: 0,
                beforeOnHand,
                afterOnHand: ing.onHand,
                beforeReserved,
                afterReserved: ing.reserved,
                reason: `ตัดใช้จริงให้รางวัลแลก ${current.code} (${current.menuName} ×1)`,
                actorId: actor.actorId ?? null,
                actorUsername: actor.actorUsername ?? null,
                orderId: null,
                reference: current.code,
                createdAt: nowIso(),
              });
            }
          }
          const at = now.toISOString();
          const job: QueueJob = {
            id: randomUUID(),
            orderId: null,
            orderNumber: current.code,
            paymentId: null,
            orderItemId: "",
            menuId: current.menuId,
            menuName: current.menuName,
            station: "drink",
            quantity: 1,
            readyQty: 0,
            deliveredQty: 0,
            status: "queued",
            readyAt: at,
            tableId: null,
            roundId: null,
            isRemake: false,
            isPriority: false,
            reason: null,
            claimedBy: null,
            rewardRedemptionId: current.id,
            createdAt: at,
            updatedAt: at,
          };
          queueJobs.set(job.id, job);
          rewardJobsByRedemption.set(current.id, job.id);
          await writeAudit(queueCreatedEvent({ ...job }, actor));
          current.status = "consumed";
          current.queueJobId = job.id;
          current.updatedAt = at;
          reward.quotaUsed += 1;
          reward.updatedAt = at;
          appendLoyaltyTx(
            {
              customerId: current.customerId,
              points: -current.pointsCost,
              source: "reward_consume",
              orderId: null,
              paymentId: null,
              orderItemId: null,
              redemptionId: current.id,
              walkinTokenId: null,
              reason: `แลก ${current.rewardName} (${current.code})`,
              actorId: actor.actorId ?? null,
              actorUsername: actor.actorUsername ?? null,
            },
            now,
          );
          await writeAudit(redemptionConsumedEvent({ ...current }, job.id, actor));
          return { redemption: { ...current }, job: toQueueDetail(job.id)! };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async redeemRelease(id, input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const current = redemptions.get(id);
          if (!current) throw new NotFoundError("ไม่พบรายการแลก");
          if (current.status === "released") {
            return { redemption: { ...current }, deduplicated: true };
          }
          assertRedemptionTransition(current.status, "released");
          const reason = normalizeLoyaltyReason(input.reason);
          current.status = "released";
          current.reason = reason;
          current.updatedAt = now.toISOString();
          await writeAudit(redemptionReleasedEvent({ ...current }, reason, actor));
          return { redemption: { ...current }, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async issueWalkinQr(actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          let token = generateWalkinToken();
          let code = buildWalkinCode(token);
          for (let i = 0; i < 5 && walkinsByCode.has(code); i += 1) {
            token = generateWalkinToken();
            code = buildWalkinCode(token);
          }
          if (walkinsByCode.has(code)) {
            throw new ConflictError("สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          }
          const at = now.toISOString();
          const row: WalkinQrToken = {
            id: randomUUID(),
            code,
            createdBy: actor.actorUsername ?? actor.actorId ?? null,
            createdAt: at,
            expiresAt: new Date(now.getTime() + WALKIN_QR_TTL_MINUTES * 60 * 1000).toISOString(),
            redeemedAt: null,
            redeemedBy: null,
          };
          walkinTokens.set(row.id, row);
          walkinsByCode.set(code, row.id);
          await writeAudit(walkinIssuedEvent({ ...row }, actor));
          return { ...row };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async redeemWalkinQr(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const code = normalizeWalkinCode(input.code);
          const tokenId = walkinsByCode.get(code);
          if (!tokenId) throw new NotFoundError("ไม่พบรหัส QR นี้");
          const token = walkinTokens.get(tokenId)!;
          if (token.redeemedAt) throw new ConflictError("QR นี้ถูกใช้ไปแล้ว");
          if (new Date(token.expiresAt).getTime() < now.getTime()) {
            throw new ConflictError("QR นี้หมดอายุแล้ว (อายุ 10 นาที)");
          }
          const customer = customers.get(input.customerId);
          if (!customer || customer.isDeleted || !customer.isActive) {
            throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
          }
          token.redeemedAt = now.toISOString();
          token.redeemedBy = customer.id;
          const tx = appendLoyaltyTx(
            {
              customerId: customer.id,
              points: LOYALTY_POINTS_PER_DRINK_UNIT,
              source: "walkin",
              orderId: null,
              paymentId: null,
              orderItemId: null,
              redemptionId: null,
              walkinTokenId: token.id,
              reason: `สแกน QR Walk-in ${token.code}`,
              actorId: actor.actorId ?? null,
              actorUsername: actor.actorUsername ?? null,
            },
            now,
          );
          await writeAudit(walkinRedeemedEvent({ ...token }, customer.id, actor));
          await writeAudit(loyaltyEarnedEvent(tx, actor));
          return { token: { ...token }, earned: LOYALTY_POINTS_PER_DRINK_UNIT };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async linkGuestOrder(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          const order = orders.get(input.orderId);
          if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
          if (order.customerId !== null) throw new ConflictError("คำสั่งซื้อนี้ผูกบัญชีแล้ว");
          if (!order.guestPhone) throw new ConflictError("คำสั่งซื้อนี้ไม่ใช่ของ Guest");
          if (guestClaimsByOrder.has(order.id)) throw new ConflictError("คำสั่งซื้อนี้ถูกผูกบัญชีไปแล้ว");
          const customer = customers.get(input.customerId);
          if (!customer || customer.isDeleted || !customer.isActive) {
            throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
          }
          if (!customer.phone || normalizeThaiPhone(order.guestPhone) !== customer.phone) {
            throw new ConflictError("เบอร์โทรของคำสั่งซื้อนี้ไม่ตรงกับบัญชี กรุณาตรวจสอบอีกครั้ง");
          }
          const ageMs = now.getTime() - new Date(order.createdAt).getTime();
          if (ageMs > GUEST_LINK_WINDOW_HOURS * 60 * 60 * 1000) {
            throw new ConflictError("เกิน 24 ชั่วโมงหลังยืนยันคำสั่งซื้อ ผูกบัญชีไม่ได้แล้ว");
          }
          order.customerId = customer.id;
          order.updatedAt = now.toISOString();
          const at = now.toISOString();
          const claim: GuestLinkClaim = {
            id: randomUUID(),
            orderId: order.id,
            customerId: customer.id,
            guestPhone: customer.phone,
            claimedAt: at,
          };
          guestClaims.set(claim.id, claim);
          guestClaimsByOrder.set(order.id, claim.id);
          await writeAudit(guestLinkedEvent(order.id, customer.id, actor));
          // รับเฉพาะคะแนนที่ยังไม่มีผู้รับ (helper กัน double-earn เอง)
          const earned = await tryAutoEarnForOrderInternal(order.id, actor, now);
          return { order: toDetail(order.id)!, earned };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async mergeCustomerAccounts(input, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          if (input.sourceCustomerId === input.targetCustomerId) {
            throw new ConflictError("บัญชีต้นทางและปลายทางต้องเป็นคนละบัญชี");
          }
          const pairKey = `${input.sourceCustomerId}|${input.targetCustomerId}`;
          const dupId = mergesByPair.get(pairKey);
          if (dupId) {
            return { record: { ...merges.get(dupId)! }, movedPoints: 0, deduplicated: true };
          }
          const source = customers.get(input.sourceCustomerId);
          const target = customers.get(input.targetCustomerId);
          if (!source) throw new NotFoundError("ไม่พบบัญชีต้นทาง");
          if (!target || target.isDeleted || !target.isActive) {
            throw new ConflictError("บัญชีปลายทางใช้งานไม่ได้");
          }
          if (source.isDeleted || !source.isActive) {
            throw new ConflictError("บัญชีต้นทางถูกปิดหรือรวมไปแล้ว");
          }
          const movedPoints = loyaltyBalanceOf(source.id);
          for (const e of loyaltyLedger) {
            if (e.customerId === source.id) e.customerId = target.id;
          }
          for (const r of redemptions.values()) {
            if (r.customerId === source.id) r.customerId = target.id;
          }
          for (const c of guestClaims.values()) {
            if (c.customerId === source.id) c.customerId = target.id;
          }
          // ย้าย LINE link เฉพาะเมื่อปลายทางยังไม่มี (กันขัดแย้ง 1:1)
          const sourceLink = lineLinks.get(source.id);
          if (sourceLink && !lineLinks.get(target.id)) {
            lineLinksBySubject.delete(`line:${sourceLink.providerSubject}`);
            const moved: CustomerLineLink = { ...sourceLink, customerId: target.id };
            lineLinks.delete(source.id);
            lineLinks.set(target.id, moved);
            lineLinksBySubject.set(`line:${moved.providerSubject}`, target.id);
          } else if (sourceLink) {
            lineLinksBySubject.delete(`line:${sourceLink.providerSubject}`);
            lineLinks.delete(source.id);
          }
          // ปิดบัญชีต้นทางแบบนิรนาม (คง id ภายในไว้รักษาประวัติ)
          if (source.phone) customersByPhone.delete(source.phone);
          if (source.email) customersByEmail.delete(source.email);
          source.name = "ลูกค้าที่รวมบัญชีแล้ว";
          source.phone = null;
          source.email = null;
          source.passwordHash = `merged:${source.id}`;
          source.isActive = false;
          source.isDeleted = true;
          source.updatedAt = now.toISOString();
          source.deletedAt = now.toISOString();
          for (const [sid, s] of customerSessions) {
            if (s.customerId === source.id) customerSessions.delete(sid);
          }
          const at = now.toISOString();
          const record: CustomerMergeRecord = {
            id: randomUUID(),
            sourceCustomerId: source.id,
            targetCustomerId: target.id,
            approvedBy: actor.actorUsername ?? actor.actorId ?? null,
            createdAt: at,
          };
          merges.set(record.id, { ...record });
          mergesByPair.set(pairKey, record.id);
          await writeAudit(accountMergedEvent(source.id, target.id, movedPoints, actor));
          return { record: { ...record }, movedPoints, deduplicated: false };
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    async reversePointsOnRefund(orderId, refundId, actor, now = new Date()) {
      return runOrderExclusive(async () => {
        const backup = backupPayments();
        try {
          if (!refunds.has(refundId)) throw new NotFoundError("ไม่พบคำขอคืนเงิน");
          return await reversePointsOnRefundInternal(orderId, refundId, actor, now);
        } catch (err) {
          restorePayments(backup);
          throw err;
        }
      });
    },
    // ---- Ticket 11 memory: รายการเงินมือ + รายงาน/Dashboard (all-or-nothing + derived รายรับ) ----
    async createFinanceEntry(input, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const entriesBackup = new Map(financeEntries);
      try {
        const kind = normalizeFinanceKind(input.kind);
        const category = normalizeFinanceCategory(kind, input.category);
        const amount = normalizeFinanceAmount(input.amount);
        const occurredAt = normalizeFinanceOccurredAt(input.occurredAt);
        const note = normalizeFinanceNote(input.note ?? null);
        const reason = normalizeFinanceReason(input.reason);
        const at = now.toISOString();
        const entry: FinanceEntry = {
          id: randomUUID(),
          kind,
          category,
          amount: roundBaht2(amount),
          occurredAt,
          note,
          reason,
          actorId: actor.actorId ?? null,
          actorUsername: actor.actorUsername ?? null,
          createdAt: at,
          updatedAt: at,
        };
        financeEntries.set(entry.id, { ...entry });
        await writeAudit(financeEntryCreatedEvent(entry, actor));
        return { ...entry };
      } catch (err) {
        financeEntries.clear();
        for (const [id, e] of entriesBackup) financeEntries.set(id, e);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async getFinanceEntry(id) {
      const e = financeEntries.get(id);
      return e ? { ...e } : null;
    },
    async listFinanceEntries(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const fromT = filter.fromOccurredAt ? new Date(filter.fromOccurredAt).getTime() : null;
      const toT = filter.toOccurredAt ? new Date(filter.toOccurredAt).getTime() : null;
      return [...financeEntries.values()]
        .filter((e) => {
          if (filter.kind && e.kind !== filter.kind) return false;
          if (filter.category && e.category !== filter.category) return false;
          const t = new Date(e.occurredAt).getTime();
          if (fromT !== null && t < fromT) return false;
          if (toT !== null && t > toT) return false;
          return true;
        })
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },
    async updateFinanceEntry(id, patch, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const entriesBackup = new Map(financeEntries);
      try {
        const current = financeEntries.get(id);
        if (!current) throw new NotFoundError("ไม่พบรายการเงิน");
        const reason = normalizeFinanceReason(patch.reason);
        const before = { ...current };
        const next: FinanceEntry = { ...current };
        if (patch.category !== undefined) {
          next.category = normalizeFinanceCategory(current.kind, patch.category);
        }
        if (patch.amount !== undefined) {
          next.amount = roundBaht2(normalizeFinanceAmount(patch.amount));
        }
        if (patch.occurredAt !== undefined) {
          next.occurredAt = normalizeFinanceOccurredAt(patch.occurredAt);
        }
        if (patch.note !== undefined) {
          next.note = normalizeFinanceNote(patch.note);
        }
        next.updatedAt = now.toISOString();
        financeEntries.set(id, { ...next });
        await writeAudit(financeEntryUpdatedEvent(before, next, reason, actor));
        return { ...next };
      } catch (err) {
        financeEntries.clear();
        for (const [eid, e] of entriesBackup) financeEntries.set(eid, e);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async deleteFinanceEntry(id, input, actor) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const entriesBackup = new Map(financeEntries);
      try {
        const current = financeEntries.get(id);
        if (!current) throw new NotFoundError("ไม่พบรายการเงิน");
        const reason = normalizeFinanceReason(input.reason);
        financeEntries.delete(id);
        await writeAudit(financeEntryDeletedEvent(current, reason, actor));
      } catch (err) {
        financeEntries.clear();
        for (const [eid, e] of entriesBackup) financeEntries.set(eid, e);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async getFinanceReport(input) {
      return buildFinanceReport({
        granularity: input.granularity,
        from: input.from,
        to: input.to,
        paidPayments: [...payments.values()].filter(
          (p) => (p.status === "paid" || p.status === "refunded") && p.paidAt,
        ),
        allRefunds: [...refunds.values()],
        allEntries: [...financeEntries.values()],
        orderById: (oid) => {
          const o = orders.get(oid);
          return o ? { estimatedCost: o.estimatedCost } : null;
        },
      });
    },
    async getFinanceDashboard(date, now = new Date()) {
      void now;
      // รายรับ = เงินที่รับมาแล้ว (paid หรือ refunded ภายหลัง — ยอดคืนแสดงแยกใน refunds)
      const paidList = [...payments.values()].filter(
        (p) => (p.status === "paid" || p.status === "refunded") && p.paidAt,
      );
      const dayReport = buildFinanceReport({
        granularity: "day",
        from: date,
        to: date,
        paidPayments: paidList,
        allRefunds: [...refunds.values()],
        allEntries: [...financeEntries.values()],
        orderById: (oid) => {
          const o = orders.get(oid);
          return o ? { estimatedCost: o.estimatedCost } : null;
        },
      });
      const day = dayReport.buckets[0] ?? emptyFinanceBucket(date);
      const topMenus = buildFinanceTopMenus({
        from: date,
        to: date,
        limit: 5,
        paidPayments: paidList,
        itemsByOrder: (oid) => orderItems.get(oid) ?? [],
      });
      const peakHours = buildFinancePeakHours({ from: date, to: date, paidPayments: paidList });
      const enabledTables = [...tables.values()].filter((t) => t.isEnabled);
      const openRounds = [...tableRounds.values()].filter((r) => r.status === "open");
      const openTableIds = new Set(openRounds.map((r) => r.tableId));
      const occupancy: FinanceOccupancy | null =
        enabledTables.length === 0
          ? null
          : {
              enabledTables: enabledTables.length,
              occupiedTables: enabledTables.filter((t) => openTableIds.has(t.id)).length,
              freeTables: enabledTables.filter((t) => !openTableIds.has(t.id)).length,
              customerCount: openRounds.reduce((sum, r) => sum + r.partySize, 0),
            };
      const lowStockCount = [...ingredients.values()].filter(
        (g) => g.isEnabled && g.onHand - g.reserved < g.reorderThreshold,
      ).length;
      return {
        date,
        netSales: day.netRevenue,
        grossRevenue: day.grossRevenue,
        refunds: day.refunds,
        paidOrders: day.paidOrders,
        averageTicket: day.paidOrders === 0 ? 0 : roundBaht2(day.netRevenue / day.paidOrders),
        manualIncome: day.manualIncome,
        actualExpense: day.actualExpense,
        grossProfit: day.grossProfit,
        estimatedCost: day.estimatedCost,
        topMenus,
        peakHours,
        occupancy,
        lowStockCount,
      };
    },
    async getFinanceTopMenus(input) {
      return buildFinanceTopMenus({
        from: input.from,
        to: input.to,
        limit: input.limit,
        paidPayments: [...payments.values()].filter(
          (p) => (p.status === "paid" || p.status === "refunded") && p.paidAt,
        ),
        itemsByOrder: (oid) => orderItems.get(oid) ?? [],
      });
    },
    async getFinancePeakHours(input) {
      return buildFinancePeakHours({
        from: input.from,
        to: input.to,
        paidPayments: [...payments.values()].filter(
          (p) => (p.status === "paid" || p.status === "refunded") && p.paidAt,
        ),
      });
    },
    // ---- Ticket 06 memory: การจอง + รอบการใช้โต๊ะ (all-or-nothing + serialize กันชน) ----
    async createReservation(input, actor, now = new Date()) {
      return runReservationExclusive(async () => {
        const backup = backupReservations();
        try {
          const customer = customers.get(input.customerId);
          if (!customer || customer.isDeleted || !customer.isActive) {
            throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
          }
          const partySize = normalizePartySize(input.partySize);
          const reservedAt = normalizeReservedAt(input.reservedAt, now);
          const note = normalizeReservationNote(input.note ?? null);
          const idempotencyKey = normalizeReservationIdempotencyKey(input.idempotencyKey ?? null);
          const hash = reservationPayloadHash({ customerId: customer.id, tableId: input.tableId?.trim() ?? "", partySize, reservedAt, note });
          // idempotency: key เดิม → คืนของเดิม / ขัดแย้ง
          if (idempotencyKey) {
            const existingId = reservationsByIdemKey.get(idempotencyKey);
            if (existingId) {
              const ex = reservations.get(existingId)!;
              const exHash = reservationPayloadHash({ customerId: ex.customerId, tableId: ex.tableId, partySize: ex.partySize, reservedAt: ex.reservedAt, note: ex.note });
              if (exHash !== hash) throw new ConflictError("คำขอนี้ถูกใช้จองไปแล้ว กรุณาสร้างการจองใหม่");
              return { reservation: toReservationDetail(ex), deduplicated: true };
            }
          }
          // เลือกโต๊ะ: ระบุเองหรือแนะนำอัตโนมัติ
          const blocked = blockedTablesAt(reservedAt);
          let table: ShopTable | null = null;
          if (input.tableId?.trim()) {
            const t = tables.get(input.tableId.trim());
            if (!t) throw new NotFoundError("ไม่พบโต๊ะที่เลือก");
            if (!t.isEnabled) throw new ConflictError(`โต๊ะ ${t.name} งดใช้งานชั่วคราว กรุณาเลือกโต๊ะอื่น`);
            if (t.capacity < partySize) {
              throw new ConflictError(`โต๊ะ ${t.name} รองรับได้ ${t.capacity} คน ไม่พอสำหรับ ${partySize} คน`);
            }
            if (blocked.has(t.id)) {
              throw new ConflictError(`โต๊ะ ${t.name} ไม่ว่างในช่วงเวลานี้แล้ว กรุณาเลือกเวลาหรือโต๊ะอื่น`);
            }
            table = { ...t };
          } else {
            table = recommendTable([...tables.values()], partySize, blocked);
            if (!table) throw new ConflictError("ไม่มีโต๊ะว่างที่รองรับจำนวนคนในช่วงเวลานี้ กรุณาเปลี่ยนเวลาหรือจำนวนคน");
          }
          let code = generateReservationCode(now);
          for (let i = 0; i < 5 && reservationsByCode.has(code); i += 1) {
            code = generateReservationCode(now);
          }
          if (reservationsByCode.has(code)) {
            throw new ConflictError("สร้างรหัสการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          }
          const at = now.toISOString();
          const r: Reservation = {
            id: randomUUID(),
            code,
            customerId: customer.id,
            tableId: table.id,
            partySize,
            reservedAt,
            status: "pending",
            note,
            idempotencyKey,
            createdAt: at,
            updatedAt: at,
          };
          reservations.set(r.id, { ...r });
          reservationsByCode.set(code, r.id);
          if (idempotencyKey) reservationsByIdemKey.set(idempotencyKey, r.id);
          const detail = toReservationDetail(r);
          await writeAudit(reservationCreatedEvent(detail, actor));
          return { reservation: detail, deduplicated: false };
        } catch (err) {
          restoreReservations(backup);
          throw err;
        }
      });
    },
    async getReservation(id) {
      const r = reservations.get(id);
      return r ? toReservationDetail(r) : null;
    },
    async getReservationByCode(code) {
      const id = reservationsByCode.get(code.trim().toUpperCase());
      if (!id) return null;
      const r = reservations.get(id);
      return r ? toReservationDetail(r) : null;
    },
    async listCustomerReservations(customerId, limit = 50) {
      const n = Math.min(Math.max(limit, 1), 200);
      return [...reservations.values()]
        .filter((r) => r.customerId === customerId)
        .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt))
        .slice(0, n)
        .map(toReservationDetail);
    },
    async listReservations(filter) {
      const needle = (filter.q ?? "").trim().toUpperCase();
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...reservations.values()]
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => {
          if (!needle) return true;
          if (r.code.toUpperCase().includes(needle)) return true;
          const c = customers.get(r.customerId);
          if (c && !c.isDeleted) {
            if (c.name.toUpperCase().includes(needle)) return true;
            if ((c.phone ?? "").includes(needle)) return true;
          }
          return tableNameOf(r.tableId).toUpperCase().includes(needle);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(toReservationDetail);
    },
    async listReservationsByPhone(phone, limit = 20) {
      const n = Math.min(Math.max(limit, 1), 100);
      const ids = new Set<string>();
      for (const c of customers.values()) {
        if (!c.isDeleted && c.phone === phone) ids.add(c.id);
      }
      return [...reservations.values()]
        .filter((r) => ids.has(r.customerId) && ACTIVE_RESERVATION.includes(r.status))
        .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt))
        .slice(0, n)
        .map(toReservationDetail);
    },
    async recommendReservationTable(partySize, reservedAt) {
      const n = normalizePartySize(partySize);
      const d = new Date(reservedAt);
      if (Number.isNaN(d.getTime())) throw new Error("รูปแบบวันเวลานัดไม่ถูกต้อง");
      const iso = d.toISOString();
      const blocked = blockedTablesAt(iso);
      const found = recommendTable([...tables.values()], n, blocked);
      return found ? { ...found } : null;
    },
    async cancelReservation(id, patch, actor, now = new Date()) {
      return runReservationExclusive(async () => {
        const backup = backupReservations();
        try {
          const r = reservations.get(id);
          if (!r) throw new NotFoundError("ไม่พบการจอง");
          const reason = normalizeReservationReason(patch.reason);
          assertReservationStatusTransition(r.status, "cancelled", "customer");
          assertCancellable(r.reservedAt, now);
          const before = r.status;
          r.status = "cancelled";
          r.updatedAt = now.toISOString();
          const detail = toReservationDetail(r);
          await writeAudit(reservationCancelledEvent(detail, before, reason, actor));
          return detail;
        } catch (err) {
          restoreReservations(backup);
          throw err;
        }
      });
    },
    async updateReservationStatus(id, patch, actor) {
      return runReservationExclusive(async () => {
        const backup = backupReservations();
        try {
          const r = reservations.get(id);
          if (!r) throw new NotFoundError("ไม่พบการจอง");
          const reason = normalizeReservationReason(patch.reason);
          const to = normalizeReservationStatus(patch.status);
          if (to === "seated" || to === "completed" || to === "pending") {
            throw new ConflictError(`เปลี่ยนสถานะการจองเป็น ${to} ผ่านช่องทางนี้ไม่ได้`);
          }
          assertReservationStatusTransition(r.status, to, "manager");
          const before = r.status;
          r.status = to;
          r.updatedAt = new Date().toISOString();
          const detail = toReservationDetail(r);
          if (to === "cancelled") {
            await writeAudit(reservationCancelledEvent(detail, before, reason, actor));
          } else {
            await writeAudit(reservationStatusChangedEvent(before, detail, reason, actor));
          }
          return detail;
        } catch (err) {
          restoreReservations(backup);
          throw err;
        }
      });
    },
    async checkinReservation(input, actor, now = new Date()) {
      return runReservationExclusive(async () => {
        const backup = backupReservations();
        try {
          // ค้นหาการจอง: id ตรง > code ตรง > phone (ต้องเหลือ active เดียว)
          let r: Reservation | null = null;
          if (input.reservationId?.trim()) {
            r = reservations.get(input.reservationId.trim()) ?? null;
          } else if (input.code?.trim()) {
            const id = reservationsByCode.get(input.code.trim().toUpperCase());
            r = id ? (reservations.get(id) ?? null) : null;
          } else if (input.phone?.trim()) {
            const ids = new Set<string>();
            for (const c of customers.values()) {
              if (!c.isDeleted && c.phone === input.phone.trim()) ids.add(c.id);
            }
            const candidates = [...reservations.values()]
              .filter((x) => ids.has(x.customerId) && ACTIVE_RESERVATION.includes(x.status))
              .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt));
            if (candidates.length === 0) throw new NotFoundError("ไม่พบการจองที่พร้อมเช็กอินสำหรับเบอร์นี้");
            if (candidates.length > 1) {
              throw new ConflictError("พบหลายการจองสำหรับเบอร์นี้ กรุณาระบุรหัสการจอง");
            }
            r = candidates[0]!;
          } else {
            throw new Error("กรุณาระบุรหัสการจองหรือเบอร์โทร");
          }
          if (!r) throw new NotFoundError("ไม่พบการจอง");
          if (r.status !== "pending" && r.status !== "confirmed") {
            throw new ConflictError("การจองนี้เช็กอินไม่ได้แล้ว (ยกเลิก/เช็กอิน/จบงานไปแล้ว)");
          }
          if (roundsByReservation.has(r.id)) {
            throw new ConflictError("การจองนี้เปิดรอบการใช้โต๊ะไปแล้ว");
          }
          const actual = normalizePartySize(input.partySize);
          // เลือกโต๊ะ: ตามที่ระบุใหม่ หรือตามจอง (ต้องจุจำนวนจริงพอ)
          let tableId = r.tableId;
          if (input.tableId?.trim()) {
            tableId = input.tableId.trim();
          }
          let table = tables.get(tableId) ?? null;
          if (!table) throw new NotFoundError("ไม่พบโต๊ะที่เลือก");
          if (!table.isEnabled) throw new ConflictError(`โต๊ะ ${table.name} งดใช้งานชั่วคราว`);
          if (table.capacity < actual) {
            // โต๊ะตามจองจุไม่พอ — ลองหาโต๊ะอื่นที่ว่างและจุพอ (รอจัดโต๊ะ)
            const blocked = blockedTablesAt(r.reservedAt, r.id);
            const alt = input.tableId?.trim()
              ? null
              : recommendTable([...tables.values()].filter((t) => t.id !== table!.id), actual, blocked);
            if (alt && ![...tableRounds.values()].some((x) => x.tableId === alt.id && x.status === "open")) {
              table = alt;
              tableId = alt.id;
            } else {
              throw new ConflictError(
                `โต๊ะ ${table.name} รองรับได้ ${table.capacity} คน ไม่พอสำหรับ ${actual} คน และยังไม่มีโต๊ะอื่นที่เหมาะสม — อยู่ในรายการรอจัดโต๊ะ กรุณารอสักครู่`,
              );
            }
          }
          // โต๊ะต้องไม่มีรอบเปิดค้าง
          for (const x of tableRounds.values()) {
            if (x.tableId === tableId && x.status === "open") {
              throw new ConflictError(`โต๊ะ ${table.name} มีลูกค้าใช้อยู่ กรุณารอสักครู่ (รอจัดโต๊ะ)`);
            }
          }
          const at = now.toISOString();
          const round: TableRound = {
            id: randomUUID(),
            reservationId: r.id,
            tableId,
            partySize: actual,
            status: "open",
            openedBy: actor.actorUsername ?? actor.actorId ?? null,
            closedBy: null,
            openedAt: at,
            closedAt: null,
          };
          tableRounds.set(round.id, { ...round });
          roundsByReservation.set(r.id, round.id);
          r.status = "seated";
          if (tableId !== r.tableId) r.tableId = tableId;
          r.updatedAt = at;
          const rDetail = toReservationDetail(r);
          const roundDetail = toRoundDetail(round);
          const customer = customers.get(r.customerId);
          await writeAudit(tableRoundOpenedEvent(roundDetail, actor));
          await writeAudit(
            reservationCheckedInEvent(rDetail, roundDetail, actual, actor, customer?.phone ?? null),
          );
          return { reservation: rDetail, round: roundDetail };
        } catch (err) {
          restoreReservations(backup);
          throw err;
        }
      });
    },
    async listTableRounds(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...tableRounds.values()]
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => (filter.tableId ? r.tableId === filter.tableId : true))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
        .slice(0, limit)
        .map(toRoundDetail);
    },
    async getTableRound(id) {
      const r = tableRounds.get(id);
      return r ? toRoundDetail(r) : null;
    },
    async closeTableRound(id, actor, now = new Date()) {
      return runReservationExclusive(async () => {
        const backup = backupReservations();
        try {
          const round = tableRounds.get(id);
          if (!round) throw new NotFoundError("ไม่พบรอบการใช้โต๊ะ");
          if (round.status !== "open") throw new ConflictError("รอบการใช้โต๊ะนี้ปิดไปแล้ว");
          const pending = [...orders.values()].filter(
            (o) => o.roundId === id && o.status === "pending_payment",
          );
          if (pending.length > 0) {
            throw new ConflictError(
              `ยังมีคำสั่งซื้อรอชำระ ${pending.length} รายการในรอบนี้ กรุณาปิดงานคำสั่งซื้อก่อนปิดรอบโต๊ะ`,
            );
          }
          round.status = "closed";
          round.closedBy = actor.actorUsername ?? actor.actorId ?? null;
          round.closedAt = now.toISOString();
          let reservation: ReservationDetail | null = null;
          if (round.reservationId) {
            const r = reservations.get(round.reservationId);
            if (r && r.status === "seated") {
              r.status = "completed";
              r.updatedAt = round.closedAt;
              reservation = toReservationDetail(r);
            }
          }
          const detail = toRoundDetail(round);
          await writeAudit(tableRoundClosedEvent(detail, actor));
          void reservation;
          return detail;
        } catch (err) {
          restoreReservations(backup);
          throw err;
        }
      });
    },
    // ---- Ticket 12 memory: outbox แจ้งเตือน (backup/restore คู่กับ audit เสมอ) ----
    async queueNotification(input, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const notesBackup = new Map(notifications);
      const keysBackup = new Map(notificationsByEventKey);
      try {
        const eventKey = normalizeNotificationEventKey(input.eventKey);
        const existingId = notificationsByEventKey.get(eventKey);
        if (existingId) {
          const existing = notifications.get(existingId);
          if (existing) return { notification: { ...existing }, deduplicated: true };
        }
        const at = now.toISOString();
        const n: Notification = {
          id: randomUUID(),
          eventKey,
          kind: normalizeNotificationKind(input.kind),
          customerId: input.customerId?.trim() ? input.customerId.trim() : null,
          orderId: input.orderId?.trim() ? input.orderId.trim() : null,
          reservationId: input.reservationId?.trim() ? input.reservationId.trim() : null,
          paymentId: input.paymentId?.trim() ? input.paymentId.trim() : null,
          message: normalizeNotificationMessage(input.message),
          status: "pending",
          attempts: 0,
          maxAttempts: maxNotificationAttempts(input.maxAttempts),
          nextRetryAt: at,
          lastError: null,
          sentAt: null,
          createdAt: at,
          updatedAt: at,
        };
        notifications.set(n.id, { ...n });
        notificationsByEventKey.set(eventKey, n.id);
        await writeAudit(notificationQueuedEvent(n, actor));
        return { notification: { ...n }, deduplicated: false };
      } catch (err) {
        notifications.clear();
        for (const [id, n] of notesBackup) notifications.set(id, n);
        notificationsByEventKey.clear();
        for (const [k, id] of keysBackup) notificationsByEventKey.set(k, id);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async getNotification(id) {
      const key = normalizeNotificationId(id);
      const n = notifications.get(key);
      return n ? { ...n } : null;
    },
    async getNotificationByEventKey(eventKey) {
      const key = normalizeNotificationEventKey(eventKey);
      const id = notificationsByEventKey.get(key);
      if (!id) return null;
      const n = notifications.get(id);
      return n ? { ...n } : null;
    },
    async listNotifications(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      return [...notifications.values()]
        .filter((n) => (filter.status ? n.status === filter.status : true))
        .filter((n) => (filter.kind ? n.kind === filter.kind : true))
        .filter((n) => (filter.customerId ? n.customerId === filter.customerId : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map((n) => ({ ...n }));
    },
    async listDueNotifications(now, limit) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      const t = now.getTime();
      return [...notifications.values()]
        .filter((n) => {
          if (n.status === "pending") return true;
          if (n.status !== "failed" || !n.nextRetryAt) return false;
          return new Date(n.nextRetryAt).getTime() <= t;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, capped)
        .map((n) => ({ ...n }));
    },
    async claimNotification(id, now = new Date()) {
      const key = normalizeNotificationId(id);
      const n = notifications.get(key);
      if (!n) return null;
      const t = now.getTime();
      const due =
        n.status === "pending" ||
        (n.status === "failed" && n.nextRetryAt !== null && new Date(n.nextRetryAt).getTime() <= t);
      if (!due) return null;
      const next: Notification = {
        ...n,
        status: "sending",
        attempts: n.attempts + 1,
        updatedAt: now.toISOString(),
      };
      notifications.set(key, next);
      return { ...next };
    },
    async completeNotificationSend(id, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const notesBackup = new Map(notifications);
      try {
        const key = normalizeNotificationId(id);
        const n = notifications.get(key);
        if (!n) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        if (n.status !== "sending") throw new ConflictError("งานนี้ไม่ได้อยู่ในสถานะกำลังส่ง");
        const at = now.toISOString();
        const next: Notification = { ...n, status: "sent", sentAt: at, nextRetryAt: null, updatedAt: at };
        notifications.set(key, { ...next });
        await writeAudit(notificationSentEvent(next, actor));
        return { ...next };
      } catch (err) {
        notifications.clear();
        for (const [nid, n] of notesBackup) notifications.set(nid, n);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async failNotificationSend(id, input, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const notesBackup = new Map(notifications);
      try {
        const key = normalizeNotificationId(id);
        const n = notifications.get(key);
        if (!n) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        if (n.status !== "sending") throw new ConflictError("งานนี้ไม่ได้อยู่ในสถานะกำลังส่ง");
        const error = sanitizeNotificationError(input.error);
        const at = now.toISOString();
        const next: Notification = {
          ...n,
          status: input.nextRetryAt ? "failed" : "dead_letter",
          nextRetryAt: input.nextRetryAt,
          lastError: error,
          updatedAt: at,
        };
        notifications.set(key, { ...next });
        await writeAudit(
          input.nextRetryAt
            ? notificationFailedEvent(next, error, actor)
            : notificationDeadLetterEvent(next, actor),
        );
        return { ...next };
      } catch (err) {
        notifications.clear();
        for (const [nid, n] of notesBackup) notifications.set(nid, n);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async skipNotification(id, reason, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const notesBackup = new Map(notifications);
      try {
        const key = normalizeNotificationId(id);
        const n = notifications.get(key);
        if (!n) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        if (n.status === "sent" || n.status === "skipped" || n.status === "dead_letter") {
          throw new ConflictError("งานนี้ข้ามไม่ได้ (ส่งแล้ว/ข้ามแล้ว/เลิกส่งแล้ว)");
        }
        const trimmed = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : "ข้ามการส่ง";
        const next: Notification = {
          ...n,
          status: "skipped",
          nextRetryAt: null,
          lastError: trimmed,
          updatedAt: now.toISOString(),
        };
        notifications.set(key, { ...next });
        await writeAudit(notificationSkippedEvent(next, trimmed, actor));
        return { ...next };
      } catch (err) {
        notifications.clear();
        for (const [nid, n] of notesBackup) notifications.set(nid, n);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async retryNotification(id, input, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const notesBackup = new Map(notifications);
      try {
        const key = normalizeNotificationId(id);
        const n = notifications.get(key);
        if (!n) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        if (n.status !== "failed" && n.status !== "dead_letter" && n.status !== "skipped") {
          throw new ConflictError("งานนี้ไม่ต้องส่งซ้ำ (ยังรอส่ง/กำลังส่ง/ส่งแล้ว)");
        }
        const reason =
          typeof input.reason === "string" && input.reason.trim()
            ? input.reason.trim().slice(0, 500)
            : "สั่งส่งซ้ำด้วยมือ";
        const at = now.toISOString();
        const next: Notification = {
          ...n,
          status: "pending",
          attempts: 0,
          nextRetryAt: at,
          lastError: null,
          sentAt: null,
          updatedAt: at,
        };
        notifications.set(key, { ...next });
        await writeAudit(notificationRetriedEvent(next, reason, actor));
        return { ...next };
      } catch (err) {
        notifications.clear();
        for (const [nid, n] of notesBackup) notifications.set(nid, n);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async setNotificationConsent(customerId, enabled, _actor) {
      const id = normalizeNotificationId(customerId, "รหัสลูกค้าไม่ถูกต้อง");
      notificationConsents.set(id, enabled);
    },
    async isNotificationEnabled(customerId) {
      const id = customerId.trim();
      if (!id) return false;
      return notificationConsents.get(id) ?? true;
    },
    async listUpcomingReservations(fromIso, toIso, limit) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      const fromT = new Date(fromIso).getTime();
      const toT = new Date(toIso).getTime();
      if (Number.isNaN(fromT) || Number.isNaN(toT)) throw new Error("ช่วงเวลานัดไม่ถูกต้อง");
      return [...reservations.values()]
        .filter((r) => r.status === "pending" || r.status === "confirmed")
        .filter((r) => {
          const t = new Date(r.reservedAt).getTime();
          return t >= fromT && t <= toT;
        })
        .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt))
        .slice(0, capped)
        .map(toReservationDetail);
    },
    // ---- Ticket 13 memory: capacity + wait prediction (baseline deterministic) ----
    async getCapacityOverview(now = new Date()) {
      const at = now.toISOString();
      const active = activePredictionJobs(now);
      const stations: CapacityStationSummary[] = (["kitchen", "drink"] as QueueStation[]).map((st) => {
        const jobs = active.filter((j) => j.station === st);
        const queueAhead = jobs.length;
        const unitsAhead = jobs.reduce((s, j) => s + Math.max(0, j.quantity - j.readyQty), 0);
        const estimatedWaitMin = computeStationWaitMin(st, queueAhead, 2);
        const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
        return {
          station: st,
          perSlot: capacityOf(st).perSlot,
          activeJobs: queueAhead,
          unitsAhead,
          estimatedWaitMin,
          rangeMin,
          rangeMax,
          source: "baseline" as PredictionSource,
        };
      });
      const occ = memoryTableOccupancy();
      return {
        at,
        stations,
        enabledTables: occ.enabledTables,
        freeTables: occ.freeTables,
        occupiedTables: occ.occupiedTables,
        customerCount: occ.customerCount,
      };
    },
    async estimateOrderWaitBaseline(orderId, partySize, now = new Date()) {
      const id = orderId.trim();
      if (!id) throw new Error("กรุณาระบุคำสั่งซื้อ");
      const order = orders.get(id);
      if (!order) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
      const party = normalizePredictionPartySize(partySize);
      const orderJobs = (queueByOrder.get(id) ?? [])
        .map((jid) => queueJobs.get(jid)!)
        .filter((j) => j && j.status !== "cancelled");
      const active = activePredictionJobs(now);
      const byStation = new Map<QueueStation, { jobs: number; queueAhead: number; unitsAhead: number }>();
      for (const st of ["kitchen", "drink"] as QueueStation[]) {
        const mine = orderJobs.filter((j) => j.station === st).length;
        if (mine === 0) continue;
        const ahead = active.filter((j) => j.station === st);
        byStation.set(st, {
          jobs: mine,
          queueAhead: ahead.length,
          unitsAhead: ahead.reduce((s, j) => s + Math.max(0, j.quantity - j.readyQty), 0),
        });
      }
      const perStation: WaitStationBreakdown[] = [...byStation.entries()].map(([station, v]) => ({
        station,
        jobs: v.jobs,
        queueAhead: v.queueAhead,
        unitsAhead: v.unitsAhead,
        estimatedWaitMin: computeStationWaitMin(station, v.queueAhead, party),
      }));
      const estimatedWaitMin = perStation.length === 0 ? 0 : Math.max(...perStation.map((p) => p.estimatedWaitMin));
      const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
      const readyAtSlowest =
        orderJobs.length === 0
          ? null
          : orderJobs
              .map((j) => j.readyAt)
              .sort((a, b) => (a < b ? 1 : -1))[0]!;
      return {
        orderId: id,
        station: null,
        partySize: party,
        perStation,
        estimatedWaitMin,
        rangeMin,
        rangeMax,
        readyAtSlowest,
        source: "baseline",
        modelVersion: PREDICTION_BASELINE_VERSION,
        predictedAt: now.toISOString(),
        timeoutMs: predictionModel.timeoutMs,
        nonGuarantee: PREDICTION_NON_GUARANTEE,
      };
    },
    async checkPreorderSlot(station, scheduledAt, partySize, now = new Date()) {
      const st = normalizeStation(station);
      const at = normalizePredictionScheduledAt(scheduledAt, now);
      const party = normalizePredictionPartySize(partySize);
      const slotStart = slotStartOf(new Date(at));
      const slotEnd = new Date(slotStart.getTime() + QUEUE_SLOT_MINUTES * 60 * 1000);
      const used = countJobsInSlot(st, slotStart);
      const capacity = capacityOf(st).perSlot;
      const available = used < capacity;
      const estimatedWaitMin = computeStationWaitMin(st, used, party);
      const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
      const suggestedSlot = available ? null : await memoryStore.suggestNextSlot(st, at, now);
      return {
        station: st,
        scheduledAt: at,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        used,
        capacity,
        available,
        estimatedWaitMin,
        rangeMin,
        rangeMax,
        suggestedSlot,
      };
    },
    async getPredictionModel() {
      return { ...predictionModel };
    },
    async setPredictionModel(patch, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const backup = { ...predictionModel };
      try {
        const before = { ...predictionModel };
        const next: PredictionModel = { ...predictionModel };
        if (patch.version !== undefined) next.version = normalizeModelVersion(patch.version);
        if (patch.kind !== undefined) {
          if (patch.kind !== "baseline" && patch.kind !== "external") throw new Error("ชนิดโมเดลไม่ถูกต้อง");
          next.kind = patch.kind;
        }
        if (patch.enabled !== undefined) next.enabled = patch.enabled !== false;
        if (patch.thresholdMinutes !== undefined) next.thresholdMinutes = normalizePredictionThreshold(patch.thresholdMinutes);
        if (patch.timeoutMs !== undefined) next.timeoutMs = normalizePredictionTimeoutMs(patch.timeoutMs);
        next.updatedBy = actor.actorUsername ?? actor.actorId ?? null;
        next.updatedAt = now.toISOString();
        predictionModel = next;
        await writeAudit(predictionModelUpdatedEvent(before, next, actor));
        return { ...next };
      } catch (err) {
        predictionModel = backup;
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async recordPredictionFeature(input, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const backup = new Map(predictionFeatures);
      try {
        const party = normalizePredictionPartySize(input.partySize);
        const orderId = input.orderId ? String(input.orderId) : null;
        let station: QueueStation | null = null;
        if (input.station) station = normalizeStation(input.station);
        const orderJobs =
          orderId !== null
            ? ((queueByOrder.get(orderId) ?? []).map((jid) => queueJobs.get(jid)!).filter((j) => j && j.status !== "cancelled"))
            : [];
        if (!station && orderJobs.length > 0) {
          // ฝ่ายช้าที่สุดตัดสิน (สอดคล้อง estimateOrderWaitBaseline)
          let slowest: QueueStation | null = null;
          let slowestWait = -1;
          for (const st of ["kitchen", "drink"] as QueueStation[]) {
            if (!orderJobs.some((j) => j.station === st)) continue;
            const ahead = activePredictionJobs(now).filter((j) => j.station === st).length;
            const w = computeStationWaitMin(st, ahead, party);
            if (w > slowestWait) {
              slowestWait = w;
              slowest = st;
            }
          }
          station = slowest;
        }
        const active = station ? activePredictionJobs(now).filter((j) => j.station === station) : [];
        const parts = bangkokHourParts(now);
        const source: PredictionSource = input.source === "model" ? "model" : "baseline";
        const predictedMin =
          source === "model" && typeof input.predictedMin === "number" ? Math.max(0, Math.round(input.predictedMin)) : null;
        const feature: PredictionFeature = {
          id: randomUUID(),
          orderId,
          station,
          partySize: party,
          queueAhead: active.length,
          unitsAhead: active.reduce((s, j) => s + Math.max(0, j.quantity - j.readyQty), 0),
          hourOfDay: parts.hourOfDay,
          dayOfWeek: parts.dayOfWeek,
          isRemake: orderJobs.some((j) => j.isRemake),
          isPriority: orderJobs.some((j) => j.isPriority),
          slotKey: station ? predictionSlotKey(station, now) : null,
          baselineMin: Math.max(0, Math.round(input.baselineMin)),
          predictedMin,
          modelVersion: input.modelVersion ? String(input.modelVersion) : PREDICTION_BASELINE_VERSION,
          source,
          actualMin: null,
          errorBaseline: null,
          errorModel: null,
          createdAt: now.toISOString(),
          completedAt: null,
        };
        predictionFeatures.set(feature.id, { ...feature });
        await writeAudit(predictionRequestedEvent(feature, actor));
        return { ...feature };
      } catch (err) {
        predictionFeatures.clear();
        for (const [k, v] of backup) predictionFeatures.set(k, v);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async listPredictionFeatures(limit) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      return [...predictionFeatures.values()]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, capped)
        .map((f) => ({ ...f }));
    },
    async completePredictionFeature(id, actualMin, actor, now = new Date()) {
      const auditsLen = audits.length;
      const auditsSeq = auditSeq;
      const backup = new Map(predictionFeatures);
      try {
        const key = String(id).trim();
        const current = predictionFeatures.get(key);
        if (!current) throw new NotFoundError("ไม่พบข้อมูลพยากรณ์");
        if (current.completedAt !== null) return { feature: { ...current }, deduplicated: true };
        const actual = normalizeActualMinutes(actualMin);
        const next: PredictionFeature = {
          ...current,
          actualMin: actual,
          errorBaseline: Math.round((actual - current.baselineMin) * 100) / 100,
          errorModel:
            current.source === "model" && current.predictedMin !== null
              ? Math.round((actual - current.predictedMin) * 100) / 100
              : null,
          completedAt: now.toISOString(),
        };
        predictionFeatures.set(key, { ...next });
        await writeAudit(predictionCompletedEvent(next, actor));
        return { feature: { ...next }, deduplicated: false };
      } catch (err) {
        predictionFeatures.clear();
        for (const [k, v] of backup) predictionFeatures.set(k, v);
        audits.length = auditsLen;
        auditSeq = auditsSeq;
        throw err;
      }
    },
    async getPredictionAccuracy(now = new Date()) {
      const done = [...predictionFeatures.values()].filter((f) => f.actualMin !== null);
      const r = evaluateAccuracySamples(
        done.map((f) => ({
          baselineMin: f.baselineMin,
          predictedMin: f.predictedMin,
          source: f.source,
          actualMin: f.actualMin!,
        })),
        predictionModel.thresholdMinutes,
      );
      return {
        samples: r.samples,
        maeBaseline: r.maeBaseline,
        maeModel: r.maeModel,
        meetsThreshold: r.meetsThreshold,
        thresholdMinutes: predictionModel.thresholdMinutes,
        gatheringSamples: r.samples < 500,
        fixtures: evaluateFixtureAccuracy(predictionModel.thresholdMinutes),
        evaluatedAt: now.toISOString(),
      };
    },
    async evaluatePredictions(actor, now = new Date()) {
      const accuracy = await memoryStore.getPredictionAccuracy(now);
      predictionModel = {
        ...predictionModel,
        samples: accuracy.samples,
        maeBaseline: accuracy.maeBaseline,
        maeModel: accuracy.maeModel,
        updatedAt: now.toISOString(),
      };
      await writeAudit(predictionEvaluatedEvent(accuracy.samples, accuracy.maeBaseline, accuracy.maeModel, actor));
      return accuracy;
    },
  };

  return memoryStore;
}

// ---- MySQL persistence (runtime จริงใช้ MySQL เท่านั้น ไม่มี memory fallback) ----
const MIGRATION_FILES = [
  "001_staff_accounts.sql",
  "002_credential_version.sql",
  "003_shop_status_tables.sql",
  "004_customer_accounts.sql",
  "005_menu_catalog.sql",
  "006_orders.sql",
  "007_reservations.sql",
  "008_menu_options_recipes_inventory.sql",
  "009_payments_receipts_refunds.sql",
  "010_kitchen_drink_queues.sql",
  "011_loyalty_rewards.sql",
  "012_finance_entries.sql",
  "013_line_notifications.sql",
  "014_capacity_wait_predictions.sql",
];

export function findMigrationFile(name = MIGRATION_FILES[0]!): string {
  const candidates: string[] = [];
  if (process.env["MIGRATIONS_DIR"]) {
    candidates.push(join(process.env["MIGRATIONS_DIR"], name));
  }
  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(
    join(here, "..", "..", "..", "db", "migrations", name), // dev: <root>/apps/api/src
    join(here, "..", "..", "..", "..", "db", "migrations", name), // built: <root>/apps/api/dist/src
    join(process.cwd(), "db", "migrations", name), // cwd = project root หรือ /app ใน Docker
    join(process.cwd(), "..", "..", "db", "migrations", name), // cwd = apps/api
  );
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // ลอง candidate ถัดไป
    }
  }
  throw new Error(`หา migration ${name} ไม่พบ (ค้นแล้ว: ${candidates.join(" | ")})`);
}

export function isDuplicateColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; errno?: unknown; sqlMessage?: unknown; message?: unknown };
  if (e.code === "ER_DUP_FIELDNAME") return true;
  if (e.errno === 1060) return true;
  const msg =
    (typeof e.sqlMessage === "string" && e.sqlMessage) ||
    (typeof e.message === "string" && e.message) ||
    "";
  if (/duplicate\s+column\s+name/i.test(msg)) return true;
  return false;
}

/**
 * แยก SQL ออกเป็น statements โดยไม่ตัด `;` ที่อยู่ใน line comment (`--`/`#`),
 * block comment (`/* ... *​/`) หรือ string/identifier (`'...'` `"..."` `` `...` ``).
 * คืน statements ที่ trim แล้ว เฉพาะที่มีโค้ดจริง (ข้าม comment-only/empty)
 * เพื่อให้ migration ที่มี `;` ในคอมเมนต์ (เช่น 007) ไม่แตกเป็นชิ้น malformed.
 */
export function splitSqlStatements(sql: string): string[] {
  const raw: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const ch = sql[i]!;
    const next = i + 1 < len ? sql[i + 1]! : "";
    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "\\" && next !== "") {
        current += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === "\\" && next !== "") {
        current += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        if (next === '"') {
          current += next;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i += 1;
      continue;
    }
    if (inBacktick) {
      current += ch;
      if (ch === "\\" && next !== "") {
        current += next;
        i += 2;
        continue;
      }
      if (ch === "`") {
        if (next === "`") {
          current += next;
          i += 2;
          continue;
        }
        inBacktick = false;
      }
      i += 1;
      continue;
    }
    // อยู่นอก string/comment
    if (ch === "-" && next === "-") {
      const third = i + 2 < len ? sql[i + 2]! : "";
      if (third === "" || third === " " || third === "\t" || third === "\n" || third === "\r" || third === "-") {
        inLineComment = true;
        current += ch + next;
        i += 2;
        continue;
      }
    }
    if (ch === "#") {
      inLineComment = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch + next;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ";") {
      raw.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  raw.push(current);
  const out: string[] = [];
  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!statementHasExecutableCode(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function statementHasExecutableCode(statement: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let code = "";
  let i = 0;
  const len = statement.length;
  while (i < len) {
    const ch = statement[i]!;
    const next = i + 1 < len ? statement[i + 1]! : "";
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          code += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        if (next === '"') {
          code += next;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i += 1;
      continue;
    }
    if (inBacktick) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === "`") {
        if (next === "`") {
          code += next;
          i += 2;
          continue;
        }
        inBacktick = false;
      }
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      const third = i + 2 < len ? statement[i + 2]! : "";
      if (third === "" || third === " " || third === "\t" || third === "\n" || third === "\r" || third === "-") {
        inLineComment = true;
        i += 2;
        continue;
      }
    }
    if (ch === "#") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      code += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      code += ch;
      i += 1;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      code += ch;
      i += 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return code.trim().length > 0;
}

/** คืนโค้ด SQL โดยตัด comment ออก (คง string ไว้) — ใช้ตรวจชนิด statement */
function stripSqlComments(statement: string): string {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let code = "";
  let i = 0;
  const len = statement.length;
  while (i < len) {
    const ch = statement[i]!;
    const next = i + 1 < len ? statement[i + 1]! : "";
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        code += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          code += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        if (next === '"') {
          code += next;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i += 1;
      continue;
    }
    if (inBacktick) {
      code += ch;
      if (ch === "\\" && next !== "") {
        code += next;
        i += 2;
        continue;
      }
      if (ch === "`") {
        if (next === "`") {
          code += next;
          i += 2;
          continue;
        }
        inBacktick = false;
      }
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      const third = i + 2 < len ? statement[i + 2]! : "";
      if (third === "" || third === " " || third === "\t" || third === "\n" || third === "\r" || third === "-") {
        inLineComment = true;
        i += 2;
        continue;
      }
    }
    if (ch === "#") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      code += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      code += ch;
      i += 1;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      code += ch;
      i += 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return code;
}

/**
 * จริงก็ต่อเมื่อเป็น `ALTER TABLE ... ADD [COLUMN] <col>` เท่านั้น
 * (กันเผลอกลืน error ของ ADD INDEX/CONSTRAINT อื่น ๆ)
 */
export function isAlterTableAddColumnStatement(sql: string): boolean {
  const code = stripSqlComments(sql).trim();
  if (!/^\s*ALTER\s+TABLE\b/i.test(code)) return false;
  if (/\bADD\s+(CONSTRAINT|INDEX|KEY|PRIMARY|FOREIGN|UNIQUE|CHECK|FULLTEXT|SPATIAL)\b/i.test(code)) return false;
  return /\bADD\s+(COLUMN\s+)?[`"']?\w/i.test(code);
}

// ---- Ticket 05: helpers ระดับ module (ใช้ทั้ง seams ใน createMysqlStore) ----

function rowToOrder(r: Record<string, unknown>): Order {
  const serviceType = String(r["service_type"]);
  if (serviceType !== "dine_in" && serviceType !== "takeaway" && serviceType !== "preorder") {
    throw new Error("วิธีรับบริการในฐานข้อมูลไม่ถูกต้อง");
  }
  const status = String(r["status"]);
  if (status !== "pending_payment" && status !== "completed" && status !== "cancelled") {
    throw new Error("สถานะคำสั่งซื้อในฐานข้อมูลไม่ถูกต้อง");
  }
  const subtotal = Number(r["subtotal"]);
  const total = Number(r["total"]);
  if (!Number.isFinite(subtotal) || !Number.isFinite(total)) {
    throw new Error("ยอดคำสั่งซื้อในฐานข้อมูลไม่ถูกต้อง");
  }
  const channel = String(r["channel"]);
  if (channel !== "web") throw new Error("ช่องทางคำสั่งซื้อในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    orderNumber: String(r["order_number"]),
    customerId: r["customer_id"] == null ? null : String(r["customer_id"]),
    guestName: r["guest_name"] == null ? null : String(r["guest_name"]),
    guestPhone: r["guest_phone"] == null ? null : String(r["guest_phone"]),
    channel: "web",
    serviceType,
    status,
    subtotal,
    total,
    scheduledAt:
      r["scheduled_at"] == null ? null : new Date(r["scheduled_at"] as string).toISOString(),
    tableId: r["table_id"] == null ? null : String(r["table_id"]),
    roundId: r["round_id"] == null ? null : String(r["round_id"]),
    idempotencyKey: String(r["idempotency_key"]),
    // Ticket 07: คอลัมน์สต๊อก (แถวเก่าก่อน migration 008 ถือว่ายังไม่จอง/ไม่ตัด)
    stockReserved: r["stock_reserved"] == null ? false : Number(r["stock_reserved"]) === 1,
    stockConsumed: r["stock_consumed"] == null ? false : Number(r["stock_consumed"]) === 1,
    estimatedCost: r["estimated_cost"] == null ? 0 : Number(r["estimated_cost"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToOrderItem(r: Record<string, unknown>): OrderItem {
  const quantity = Number(r["quantity"]);
  if (!Number.isInteger(quantity)) throw new Error("จำนวนรายการในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    orderId: String(r["order_id"]),
    menuId: String(r["menu_id"]),
    menuName: String(r["menu_name"]),
    unitPrice: Number(r["unit_price"]),
    quantity,
    lineTotal: Number(r["line_total"]),
    note: r["note"] == null ? null : String(r["note"]),
    // Ticket 07: snapshot ตัวเลือก/ความต้องการเฉพาะ/ต้นทุน (แถวเก่าถือว่าไม่มี)
    selectedOptions: parseOptionsSnapshot(r["options_snapshot"]),
    specialRequest: r["special_request"] == null ? null : String(r["special_request"]),
    estimatedCost: r["estimated_cost"] == null ? 0 : Number(r["estimated_cost"]),
  };
}

/** options_snapshot เก็บ JSON array (mysql2 อาจคืน string หรือ object ขึ้นกับไดรเวอร์) */
function parseOptionsSnapshot(value: unknown): OrderItemOptionSnapshot[] {
  if (value === null || value === undefined) return [];
  let raw: unknown = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: OrderItemOptionSnapshot[] = [];
  for (const row of raw as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    if (typeof row["optionId"] !== "string" || typeof row["optionName"] !== "string") continue;
    out.push({
      groupId: typeof row["groupId"] === "string" ? row["groupId"] : "",
      groupName: typeof row["groupName"] === "string" ? row["groupName"] : "",
      optionId: row["optionId"],
      optionName: row["optionName"],
      priceDelta: typeof row["priceDelta"] === "number" ? row["priceDelta"] : 0,
    });
  }
  return out;
}

async function readOrderDetailTx(conn: PoolConnection, orderId: string): Promise<OrderDetail | null> {
  const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId])) as [
    Record<string, unknown>[],
    unknown,
  ];
  if (oRows.length === 0) return null;
  const [iRows] = (await conn.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY menu_name ASC", [
    orderId,
  ])) as [Record<string, unknown>[], unknown];
  const order = rowToOrder(oRows[0]!);
  return { ...order, items: (iRows as Record<string, unknown>[]).map(rowToOrderItem) };
}

/** normalize รูปทรงคำขอ (ไม่แตะเมนู/ลูกค้า — ตรวจ snapshot ใน transaction ของ caller) */
function normalizeOrderShape(
  input: CreateOrderInput,
  now: Date,
): {
  serviceType: OrderServiceType;
  idempotencyKey: string;
  lines: NormalizedOrderLine[];
  scheduledAt: string | null;
  tableId: string | null;
  roundId: string | null;
} {
  const serviceType = normalizeServiceType(input.serviceType);
  return {
    serviceType,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    lines: normalizeOrderLines(
      input.items.map((i) => ({
        menuId: i.menuId,
        quantity: i.quantity,
        note: i.note ?? null,
        // Ticket 07: ตัวเลือก + ความต้องการเฉพาะเป็นส่วนหนึ่งของ payload กัน key ชน
        options: i.options ?? null,
        specialRequest: i.specialRequest ?? null,
      })),
    ),
    scheduledAt: normalizeScheduledAt(serviceType, input.scheduledAt ?? null, now),
    tableId: normalizeMysqlLinkage(input.tableId),
    roundId: normalizeMysqlLinkage(input.roundId),
  };
}

/** id โต๊ะ/รอบที่แนบมากับคำสั่งซื้อฝั่ง MySQL: ว่างได้, มีค่าต้องเป็น string ไม่ว่าง */
function normalizeMysqlLinkage(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConflictError("ข้อมูลโต๊ะ/รอบการใช้โต๊ะไม่ถูกต้อง");
  }
  return value.trim();
}

/** idempotency hash รวม linkage (สคีมาเดียวกับ memory seam) */
function orderHashWithLinkageMysql(
  payload: { customerId: string | null; guestName: string | null; guestPhone: string | null; serviceType: OrderServiceType; scheduledAt: string | null; items: NormalizedOrderLine[] },
  tableId: string | null,
  roundId: string | null,
): string {
  const base = orderPayloadHash(payload);
  return createHash("sha256").update(`${base}|${tableId ?? ""}|${roundId ?? ""}`).digest("hex");
}

/**
 * hash เทียบ key เก่า (Ticket 05/06 — ไม่มีตัวเลือก/ความต้องการเฉพาะ):
 * ยอมรับ replay ของ key ที่ยืนยันก่อน deploy Ticket 07 กันเพี้ยนเป็น 409
 */
function orderCoreHashWithLinkageMysql(
  payload: { customerId: string | null; guestName: string | null; guestPhone: string | null; serviceType: OrderServiceType; scheduledAt: string | null; items: NormalizedOrderLine[] },
  tableId: string | null,
  roundId: string | null,
): string {
  const base = orderPayloadHashWithoutOptions(payload);
  return createHash("sha256").update(`${base}|${tableId ?? ""}|${roundId ?? ""}`).digest("hex");
}

/** hash สคีมาดั้งเดิมสุด (ก่อน Ticket 06 ไม่มี linkage) — กัน replay key เก่ามาก */
function orderLegacyHashMysql(
  payload: { customerId: string | null; guestName: string | null; guestPhone: string | null; serviceType: OrderServiceType; scheduledAt: string | null; items: NormalizedOrderLine[] },
): string {
  return orderPayloadHashWithoutOptions(payload);
}

/** จำแนก unique key ที่ชนจากข้อความ MySQL (uq_orders_idempotency / uq_orders_number) */
function dupOrderKeyName(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
  if (msg.includes("uq_orders_idempotency")) return "idempotency";
  if (msg.includes("uq_orders_number")) return "number";
  return "";
}

// ---------- Ticket 07: mappers + helpers ระดับ module (ใช้ทั้ง seams ใน createMysqlStore) ----------

// ---------- Ticket 08: mappers ระดับ module (ใช้ทั้ง seams ชำระเงินใน createMysqlStore) ----------

function rowToPayment(r: Record<string, unknown>): Payment {
  const method = String(r["method"]);
  if (method !== "cash" && method !== "promptpay") throw new Error("วิธีชำระเงินในฐานข้อมูลไม่ถูกต้อง");
  const status = String(r["status"]);
  if (
    status !== "pending" && status !== "paid" && status !== "manual_review" &&
    status !== "failed" && status !== "expired" && status !== "refunded" && status !== "cancelled"
  ) {
    throw new Error("สถานะการชำระเงินในฐานข้อมูลไม่ถูกต้อง");
  }
  return {
    id: String(r["id"]),
    orderId: String(r["order_id"]),
    orderNumber: String(r["order_number"]),
    method,
    amount: Number(r["amount"]),
    receivedAmount: r["received_amount"] == null ? null : Number(r["received_amount"]),
    changeAmount: Number(r["change_amount"] ?? 0),
    status,
    providerRef: r["provider_ref"] == null ? null : String(r["provider_ref"]),
    slipRef: r["slip_ref"] == null ? null : String(r["slip_ref"]),
    receiptNumber: r["receipt_number"] == null ? null : String(r["receipt_number"]),
    idempotencyKey: String(r["idempotency_key"]),
    paidAt: r["paid_at"] == null ? null : new Date(r["paid_at"] as string).toISOString(),
    expiresAt: new Date(r["expires_at"] as string).toISOString(),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function parseReceiptItems(value: unknown): Receipt["items"] {
  if (value === null || value === undefined) return [];
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: Receipt["items"] = [];
  for (const row of raw as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    if (typeof row["menuName"] !== "string") continue;
    out.push({
      menuName: String(row["menuName"]),
      quantity: Number(row["quantity"]),
      unitPrice: Number(row["unitPrice"]),
      lineTotal: Number(row["lineTotal"]),
    });
  }
  return out;
}

function rowToReceipt(r: Record<string, unknown>): Receipt {
  return {
    receiptNumber: String(r["receipt_number"]),
    paymentId: String(r["payment_id"]),
    orderId: String(r["order_id"]),
    orderNumber: String(r["order_number"]),
    shopName: String(r["shop_name"]),
    method: String(r["method"]) === "cash" ? "cash" : "promptpay",
    amount: Number(r["amount"]),
    receivedAmount: r["received_amount"] == null ? null : Number(r["received_amount"]),
    changeAmount: Number(r["change_amount"] ?? 0),
    paidAt: new Date(r["paid_at"] as string).toISOString(),
    items: parseReceiptItems(r["items_snapshot"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

function rowToRefund(r: Record<string, unknown>): Refund {
  return {
    id: String(r["id"]),
    paymentId: String(r["payment_id"]),
    orderId: String(r["order_id"]),
    orderNumber: String(r["order_number"]),
    amount: Number(r["amount"]),
    reason: String(r["reason"]),
    approvedBy: r["approved_by"] == null ? null : String(r["approved_by"]),
    approvedAt: new Date(r["approved_at"] as string).toISOString(),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

// ---- Ticket 11: converter แถว finance_entries (ใช้ทั้ง seams ใน createMysqlStore) ----

function rowToFinanceEntry(r: Record<string, unknown>): FinanceEntry {
  const kind = String(r["kind"]);
  if (kind !== "income" && kind !== "expense") throw new Error("ประเภทรายการเงินในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    kind,
    category: String(r["category"]) as FinanceCategory,
    amount: Number(r["amount"]),
    occurredAt: new Date(r["occurred_at"] as string).toISOString(),
    note: r["note"] == null ? null : String(r["note"]),
    reason: String(r["reason"] ?? ""),
    actorId: r["actor_id"] == null ? null : String(r["actor_id"]),
    actorUsername: r["actor_username"] == null ? null : String(r["actor_username"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

// ---- Ticket 12: converter สำหรับ notifications (ใช้ทั้ง seams ใน createMysqlStore) ----

const NOTIFICATION_KIND_SET = new Set([
  "reservation_created",
  "reservation_cancelled",
  "reservation_reminder",
  "payment_paid",
  "payment_manual_review",
  "order_ready",
  "order_delivered",
  "loyalty_earned",
  "loyalty_redeemed",
]);

const NOTIFICATION_STATUS_SET = new Set([
  "pending",
  "sending",
  "sent",
  "failed",
  "dead_letter",
  "skipped",
]);

function rowToNotification(r: Record<string, unknown>): Notification {
  const kind = String(r["kind"]);
  if (!NOTIFICATION_KIND_SET.has(kind)) throw new Error("ชนิดการแจ้งเตือนในฐานข้อมูลไม่ถูกต้อง");
  const status = String(r["status"]);
  if (!NOTIFICATION_STATUS_SET.has(status)) throw new Error("สถานะการแจ้งเตือนในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    eventKey: String(r["event_key"]),
    kind: kind as NotificationKind,
    customerId: r["customer_id"] == null ? null : String(r["customer_id"]),
    orderId: r["order_id"] == null ? null : String(r["order_id"]),
    reservationId: r["reservation_id"] == null ? null : String(r["reservation_id"]),
    paymentId: r["payment_id"] == null ? null : String(r["payment_id"]),
    message: String(r["message"]),
    status: status as NotificationStatus,
    attempts: Number(r["attempts"] ?? 0),
    maxAttempts: Number(r["max_attempts"] ?? 5),
    nextRetryAt: r["next_retry_at"] == null ? null : new Date(r["next_retry_at"] as string).toISOString(),
    lastError: r["last_error"] == null ? null : String(r["last_error"]),
    sentAt: r["sent_at"] == null ? null : new Date(r["sent_at"] as string).toISOString(),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

// ---- Ticket 13: converter แถว prediction_models/prediction_features ----

function rowToPredictionModel(r: Record<string, unknown>): PredictionModel {
  const kind = String(r["kind"] ?? "baseline");
  return {
    version: String(r["version"] ?? PREDICTION_BASELINE_VERSION),
    kind: kind === "external" ? "external" : "baseline",
    enabled: Number(r["enabled"] ?? 1) === 1,
    thresholdMinutes: Number(r["threshold_minutes"] ?? PREDICTION_DEFAULT_THRESHOLD_MINUTES),
    timeoutMs: Number(r["timeout_ms"] ?? PREDICTION_DEFAULT_TIMEOUT_MS),
    samples: 0,
    maeBaseline: null,
    maeModel: null,
    trainedAt: r["trained_at"] == null ? null : new Date(r["trained_at"] as string).toISOString(),
    updatedBy: r["updated_by"] == null ? null : String(r["updated_by"]),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToPredictionFeature(r: Record<string, unknown>): PredictionFeature {
  const station = r["station"] == null ? null : String(r["station"]);
  const source = String(r["source"] ?? "baseline");
  const actual = r["actual_min"] == null ? null : Number(r["actual_min"]);
  const predicted = r["predicted_min"] == null ? null : Number(r["predicted_min"]);
  return {
    id: String(r["id"]),
    orderId: r["order_id"] == null ? null : String(r["order_id"]),
    station: station === "kitchen" || station === "drink" ? station : null,
    partySize: Number(r["party_size"]),
    queueAhead: Number(r["queue_ahead"]),
    unitsAhead: Number(r["units_ahead"]),
    hourOfDay: Number(r["hour_of_day"]),
    dayOfWeek: Number(r["day_of_week"]),
    isRemake: Number(r["is_remake"] ?? 0) === 1,
    isPriority: Number(r["is_priority"] ?? 0) === 1,
    slotKey: r["slot_key"] == null ? null : String(r["slot_key"]),
    baselineMin: Number(r["baseline_min"]),
    predictedMin: predicted,
    modelVersion: String(r["model_version"]),
    source: source === "model" ? "model" : "baseline",
    actualMin: actual,
    errorBaseline: actual === null ? null : Math.round((actual - Number(r["baseline_min"])) * 100) / 100,
    errorModel:
      actual === null || source !== "model" || predicted === null
        ? null
        : Math.round((actual - predicted) * 100) / 100,
    createdAt: new Date(r["created_at"] as string).toISOString(),
    completedAt: r["completed_at"] == null ? null : new Date(r["completed_at"] as string).toISOString(),
  };
}

// ---- Ticket 09: converter แถว queue_jobs (ใช้ทั้ง seams ใน createMysqlStore) ----

function rowToQueueJob(r: Record<string, unknown>): QueueJob {
  const station = String(r["station"]);
  if (station !== "kitchen" && station !== "drink") {
    throw new Error("ฝ่ายงานคิวในฐานข้อมูลไม่ถูกต้อง");
  }
  const status = String(r["status"]);
  if (
    status !== "queued" &&
    status !== "claimed" &&
    status !== "preparing" &&
    status !== "ready" &&
    status !== "delivered" &&
    status !== "cancelled"
  ) {
    throw new Error("สถานะงานคิวในฐานข้อมูลไม่ถูกต้อง");
  }
  return {
    id: String(r["id"]),
    orderId: r["order_id"] == null ? null : String(r["order_id"]),
    orderNumber: String(r["order_number"]),
    paymentId: r["payment_id"] == null ? null : String(r["payment_id"]),
    orderItemId: r["order_item_id"] == null ? "" : String(r["order_item_id"]),
    menuId: String(r["menu_id"]),
    menuName: String(r["menu_name"]),
    station,
    quantity: Number(r["quantity"]),
    readyQty: Number(r["ready_qty"] ?? 0),
    deliveredQty: Number(r["delivered_qty"] ?? 0),
    status,
    readyAt: new Date(r["ready_at"] as string).toISOString(),
    tableId: r["table_id"] == null ? null : String(r["table_id"]),
    roundId: r["round_id"] == null ? null : String(r["round_id"]),
    isRemake: Number(r["is_remake"] ?? 0) === 1,
    isPriority: Number(r["is_priority"] ?? 0) === 1,
    reason: r["reason"] == null ? null : String(r["reason"]),
    claimedBy: r["claimed_by"] == null ? null : String(r["claimed_by"]),
    // Ticket 10: คอลัมน์รางวัล (แถวเก่าก่อน migration 011 ถือว่าไม่ใช่งานรางวัล)
    rewardRedemptionId: r["reward_redemption_id"] == null ? null : String(r["reward_redemption_id"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

// ---- Ticket 10: converters แถว loyalty/rewards (ใช้ทั้ง seams ใน createMysqlStore) ----

function rowToLoyaltyTx(r: Record<string, unknown>): LoyaltyTransaction {
  const source = String(r["source"]);
  if (
    source !== "order" && source !== "walkin" && source !== "reward_reserve" &&
    source !== "reward_consume" && source !== "reward_release" &&
    source !== "refund" && source !== "merge" && source !== "adjust"
  ) {
    throw new Error("แหล่งที่มาธุรกรรมคะแนนในฐานข้อมูลไม่ถูกต้อง");
  }
  return {
    id: String(r["id"]),
    customerId: String(r["customer_id"]),
    points: Number(r["points"]),
    source: source as LoyaltySource,
    orderId: r["order_id"] == null ? null : String(r["order_id"]),
    paymentId: r["payment_id"] == null ? null : String(r["payment_id"]),
    orderItemId: r["order_item_id"] == null ? null : String(r["order_item_id"]),
    redemptionId: r["redemption_id"] == null ? null : String(r["redemption_id"]),
    walkinTokenId: r["walkin_token_id"] == null ? null : String(r["walkin_token_id"]),
    reason: r["reason"] == null ? "" : String(r["reason"]),
    actorId: r["actor_id"] == null ? null : String(r["actor_id"]),
    actorUsername: r["actor_username"] == null ? null : String(r["actor_username"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

function rowToReward(r: Record<string, unknown>): Reward {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    imageUrl: r["image_url"] == null ? null : String(r["image_url"]),
    menuId: String(r["menu_id"]),
    menuName: String(r["menu_name"]),
    pointsCost: Number(r["points_cost"]),
    quotaTotal: r["quota_total"] == null ? null : Number(r["quota_total"]),
    quotaUsed: Number(r["quota_used"] ?? 0),
    startsAt: r["starts_at"] == null ? null : new Date(r["starts_at"] as string).toISOString(),
    endsAt: r["ends_at"] == null ? null : new Date(r["ends_at"] as string).toISOString(),
    isActive: Number(r["is_active"]) === 1,
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToRedemption(r: Record<string, unknown>): RewardRedemption {
  const status = String(r["status"]);
  if (status !== "reserved" && status !== "consumed" && status !== "released") {
    throw new Error("สถานะการแลกในฐานข้อมูลไม่ถูกต้อง");
  }
  return {
    id: String(r["id"]),
    code: String(r["code"]),
    customerId: String(r["customer_id"]),
    rewardId: String(r["reward_id"]),
    rewardName: String(r["reward_name"]),
    menuId: String(r["menu_id"]),
    menuName: String(r["menu_name"]),
    pointsCost: Number(r["points_cost"]),
    status: status as RedemptionStatus,
    idempotencyKey: String(r["idempotency_key"]),
    queueJobId: r["queue_job_id"] == null ? null : String(r["queue_job_id"]),
    reason: r["reason"] == null ? null : String(r["reason"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToWalkin(r: Record<string, unknown>): WalkinQrToken {
  return {
    id: String(r["id"]),
    code: String(r["code"]),
    createdBy: r["created_by"] == null ? null : String(r["created_by"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    expiresAt: new Date(r["expires_at"] as string).toISOString(),
    redeemedAt: r["redeemed_at"] == null ? null : new Date(r["redeemed_at"] as string).toISOString(),
    redeemedBy: r["redeemed_by"] == null ? null : String(r["redeemed_by"]),
  };
}

function rowToGuestClaim(r: Record<string, unknown>): GuestLinkClaim {
  return {
    id: String(r["id"]),
    orderId: String(r["order_id"]),
    customerId: String(r["customer_id"]),
    guestPhone: String(r["guest_phone"]),
    claimedAt: new Date(r["claimed_at"] as string).toISOString(),
  };
}

function rowToMerge(r: Record<string, unknown>): CustomerMergeRecord {
  return {
    id: String(r["id"]),
    sourceCustomerId: String(r["source_customer_id"]),
    targetCustomerId: String(r["target_customer_id"]),
    approvedBy: r["approved_by"] == null ? null : String(r["approved_by"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

function rowToReversal(r: Record<string, unknown>): LoyaltyReversal {
  return {
    id: String(r["id"]),
    orderId: String(r["order_id"]),
    refundId: String(r["refund_id"]),
    customerId: String(r["customer_id"]),
    points: Number(r["points"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

/** สถานะ derived ฝั่งคำสั่งซื้อจาก payment (ไม่เปลี่ยน OrderStatus contract) */
function paymentToOrderState(status: PaymentStatus | null): OrderPaymentState {  if (status === "paid") return "paid";
  if (status === "manual_review") return "manual_review";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "expired") return "expired";
  if (status === "refunded") return "refunded";
  return "pending_payment";
}

function rowToOptionGroup(r: Record<string, unknown>): MenuOptionGroup {
  return {
    id: String(r["id"]),
    menuId: String(r["menu_id"]),
    name: String(r["name"]),
    sortOrder: Number(r["sort_order"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToMenuOption(r: Record<string, unknown>): MenuOption {
  return {
    id: String(r["id"]),
    groupId: String(r["group_id"]),
    menuId: String(r["menu_id"]),
    name: String(r["name"]),
    priceDelta: Number(r["price_delta"]),
    isEnabled: Number(r["is_enabled"]) === 1,
    sortOrder: Number(r["sort_order"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToIngredient(r: Record<string, unknown>): Ingredient {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    unit: String(r["unit"]),
    onHand: Number(r["on_hand"]),
    reserved: Number(r["reserved"]),
    reorderThreshold: Number(r["reorder_threshold"]),
    latestCost: Number(r["latest_cost"]),
    isEnabled: Number(r["is_enabled"]) === 1,
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToStockLedger(r: Record<string, unknown>): StockLedgerEntry {
  const op = String(r["op"]);
  if (!(STOCK_OPS as string[]).includes(op)) throw new Error("ประเภทธุรกรรมสต๊อกในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    ingredientId: String(r["ingredient_id"]),
    op: op as StockOp,
    deltaOnHand: Number(r["delta_on_hand"]),
    deltaReserved: Number(r["delta_reserved"]),
    beforeOnHand: Number(r["before_on_hand"]),
    afterOnHand: Number(r["after_on_hand"]),
    beforeReserved: Number(r["before_reserved"]),
    afterReserved: Number(r["after_reserved"]),
    reason: String(r["reason"]),
    actorId: r["actor_id"] == null ? null : String(r["actor_id"]),
    actorUsername: r["actor_username"] == null ? null : String(r["actor_username"]),
    orderId: r["order_id"] == null ? null : String(r["order_id"]),
    reference: r["reference"] == null ? null : String(r["reference"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

/** จำแนก unique key ตัวเลือก/วัตถุดิบที่ชน */
function dupInventoryKeyName(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
  if (msg.includes("uq_option_groups_menu_name")) return "option-group-name";
  if (msg.includes("uq_options_group_name")) return "option-name";
  if (msg.includes("uq_ingredients_name")) return "ingredient-name";
  return "";
}

function mapInventoryConflict(err: unknown): Error {
  if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
    const which = dupInventoryKeyName(err);
    if (which === "option-group-name") return new ConflictError("ชื่อกลุ่มตัวเลือกนี้มีอยู่ในเมนูนี้แล้ว");
    if (which === "option-name") return new ConflictError("ชื่อตัวเลือกนี้มีอยู่ในกลุ่มนี้แล้ว");
    if (which === "ingredient-name") return new ConflictError("ชื่อวัตถุดิบนี้มีอยู่แล้ว");
  }
  throw err;
}

/** อ่านสูตรพร้อมบรรทัด (tx เดียวกับ caller) — คืน null เมื่อไม่มีสูตรเลย */
async function readLatestRecipeTx(
  q: Pick<PoolConnection, "query">,
  targetType: RecipeTargetType,
  targetId: string,
): Promise<Recipe | null> {
  const [rows] = (await q.query(
    "SELECT * FROM recipes WHERE target_type = ? AND target_id = ? ORDER BY version DESC LIMIT 1",
    [targetType, targetId],
  )) as [Record<string, unknown>[], unknown];
  if (rows.length === 0) return null;
  return readRecipeWithLines(q, rows[0]!);
}

async function readRecipeWithLines(q: Pick<PoolConnection, "query">, r: Record<string, unknown>): Promise<Recipe> {
  const [lineRows] = (await q.query("SELECT ingredient_id, qty FROM recipe_lines WHERE recipe_id = ? ORDER BY ingredient_id ASC", [
    String(r["id"]),
  ])) as [Record<string, unknown>[], unknown];
  return {
    id: String(r["id"]),
    targetType: String(r["target_type"]) as RecipeTargetType,
    targetId: String(r["target_id"]),
    version: Number(r["version"]),
    lines: (lineRows as Record<string, unknown>[]).map((l) => ({
      ingredientId: String(l["ingredient_id"]),
      qty: Number(l["qty"]),
    })),
    estimatedCostPerUnit: Number(r["estimated_cost"]),
    createdBy: r["created_by"] == null ? null : String(r["created_by"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
  };
}

async function insertLedgerRow(
  q: Pick<PoolConnection, "query">,
  e: Omit<StockLedgerEntry, "id" | "createdAt">,
): Promise<StockLedgerEntry> {
  const id = randomUUID();
  await q.query(
    "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id, e.ingredientId, e.op, e.deltaOnHand, e.deltaReserved, e.beforeOnHand, e.afterOnHand,
      e.beforeReserved, e.afterReserved, e.reason, e.actorId, e.actorUsername, e.orderId, e.reference,
    ],
  );
  const [rows] = (await q.query("SELECT * FROM stock_ledger WHERE id = ? LIMIT 1", [id])) as [
    Record<string, unknown>[],
    unknown,
  ];
  if (rows.length === 0) throw new Error("บันทึกธุรกรรมสต๊อกไม่สำเร็จ");
  return rowToStockLedger(rows[0]!);
}

// ---------- Ticket 06: mappers ระดับ module (ใช้ทั้ง seams ใน createMysqlStore) ----------

const RESERVATION_ACTIVE_STATUSES = ["pending", "confirmed"];

function rowToReservation(r: Record<string, unknown>): Reservation {
  const status = String(r["status"]);
  if (!RESERVATION_STATUSES.includes(status as ReservationStatus)) {
    throw new Error("สถานะการจองในฐานข้อมูลไม่ถูกต้อง");
  }
  const partySize = Number(r["party_size"]);
  if (!Number.isInteger(partySize)) throw new Error("จำนวนผู้ใช้บริการในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    code: String(r["code"]),
    customerId: String(r["customer_id"]),
    tableId: String(r["table_id"]),
    partySize,
    reservedAt: new Date(r["reserved_at"] as string).toISOString(),
    status: status as ReservationStatus,
    note: r["note"] == null ? null : String(r["note"]),
    idempotencyKey: r["idempotency_key"] == null ? null : String(r["idempotency_key"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  };
}

function rowToTableRound(r: Record<string, unknown>): TableRound {
  const status = String(r["status"]);
  if (status !== "open" && status !== "closed") throw new Error("สถานะรอบโต๊ะในฐานข้อมูลไม่ถูกต้อง");
  const partySize = Number(r["party_size"]);
  if (!Number.isInteger(partySize)) throw new Error("จำนวนผู้ใช้บริการในฐานข้อมูลไม่ถูกต้อง");
  return {
    id: String(r["id"]),
    reservationId: r["reservation_id"] == null ? null : String(r["reservation_id"]),
    tableId: String(r["table_id"]),
    partySize,
    status,
    openedBy: r["opened_by"] == null ? null : String(r["opened_by"]),
    closedBy: r["closed_by"] == null ? null : String(r["closed_by"]),
    openedAt: new Date(r["opened_at"] as string).toISOString(),
    closedAt: r["closed_at"] == null ? null : new Date(r["closed_at"] as string).toISOString(),
  };
}

/** จำแนก unique key การจองที่ชน (รหัสจอง / idempotency) */
function dupReservationKeyName(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
  if (msg.includes("uq_reservations_idempotency")) return "idempotency";
  if (msg.includes("uq_reservations_code")) return "code";
  return "";
}

export async function createMysqlStore(databaseUrl: string): Promise<Store> {
  const { default: mysql } = await import("mysql2/promise");
  const pool = mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
  });

  const conn = await pool.getConnection();
  try {
    for (const file of MIGRATION_FILES) {
      const migration = readFileSync(findMigrationFile(file), "utf8");
      const statements = splitSqlStatements(migration);
      for (const sql of statements) {
        try {
          await conn.query(sql);
        } catch (err) {
          // ALTER TABLE ADD COLUMN รันซ้ำได้: มีคอลัมน์แล้ว (1060) ให้ข้ามเท่านั้น
          if (!isAlterTableAddColumnStatement(sql) || !isDuplicateColumnError(err)) throw err;
        }
      }
    }
  } finally {
    conn.release();
  }

  function parseStoredIntervals(value: unknown, weekday: number): { open: string; close: string }[] {
    let raw: unknown = value;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`รูปแบบเวลาของวันที่ ${weekday} ในฐานข้อมูลไม่ถูกต้อง`);
      }
    }
    if (!Array.isArray(raw)) throw new Error(`รูปแบบเวลาของวันที่ ${weekday} ในฐานข้อมูลไม่ถูกต้อง`);
    return raw as { open: string; close: string }[];
  }

  const rowToTable = (r: Record<string, unknown>): ShopTable => {
    const capacity = Number(r["capacity"]);
    if (!Number.isInteger(capacity)) throw new Error("ความจุโต๊ะในฐานข้อมูลไม่ถูกต้อง");
    return {
      id: String(r["id"]),
      name: String(r["name"]),
      capacity,
      isEnabled: Number(r["is_enabled"]) === 1,
      createdAt: new Date(r["created_at"] as string).toISOString(),
      updatedAt: new Date(r["updated_at"] as string).toISOString(),
    };
  };

  const rowToMenu = (r: Record<string, unknown>): MenuItem => {
    const price = Number(r["price"]);
    if (!Number.isFinite(price)) throw new Error("ราคาเมนูในฐานข้อมูลไม่ถูกต้อง");
    const kind = String(r["kind"]);
    if (kind !== "food" && kind !== "drink") throw new Error("ประเภทเมนูในฐานข้อมูลไม่ถูกต้อง");
    const status = String(r["status"]);
    if (status !== "available" && status !== "unavailable") {
      throw new Error("สถานะเมนูในฐานข้อมูลไม่ถูกต้อง");
    }
    const sortOrder = Number(r["sort_order"]);
    if (!Number.isInteger(sortOrder)) throw new Error("ลำดับเมนูในฐานข้อมูลไม่ถูกต้อง");
    return {
      id: String(r["id"]),
      category: String(r["category"]),
      name: String(r["name"]),
      description: r["description"] == null ? null : String(r["description"]),
      imageUrl: r["image_url"] == null ? null : String(r["image_url"]),
      price,
      kind,
      status,
      isArchived: Number(r["is_archived"]) === 1,
      sortOrder,
      createdAt: new Date(r["created_at"] as string).toISOString(),
      updatedAt: new Date(r["updated_at"] as string).toISOString(),
    };
  };

  function mapMenuConflict(err: unknown): Error {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
      return new ConflictError("ชื่อเมนูนี้มีอยู่ในหมวดหมู่นี้แล้ว");
    }
    throw err;
  }

  const MENU_ORDER_BY = "ORDER BY category ASC, sort_order ASC, name ASC";

  // input เป็น UTC ISO (ลงท้าย Z) ส่วนคอลัมน์ DATETIME ไม่มี offset และ pool ตั้ง
  // timezone Z (ตีความ DATETIME เป็น UTC) จึงต้องใช้ UTC getters เท่านั้น —
  // ใช้ local getters จะเลื่อนตาม timezone ของเครื่อง server
  const toMysqlDatetime = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };

  // ---------- Ticket 03 MySQL helpers ----------
  const rowToCustomer = (r: Record<string, unknown>): Customer => ({
    id: String(r["id"]),
    name: String(r["name"]),
    phone: r["phone"] == null ? null : String(r["phone"]),
    email: r["email"] == null ? null : String(r["email"]),
    passwordHash: String(r["password_hash"]),
    isActive: Number(r["is_active"]) === 1,
    isDeleted: Number(r["is_deleted"]) === 1,
    passwordVersion: Number(r["password_version"] ?? 1),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
    deletedAt: r["deleted_at"] == null ? null : new Date(r["deleted_at"] as string).toISOString(),
  });

  const rowToLineLink = (r: Record<string, unknown>): CustomerLineLink => ({
    customerId: String(r["customer_id"]),
    provider: "line",
    providerSubject: String(r["provider_subject"]),
    displayName: r["display_name"] == null ? null : String(r["display_name"]),
    linkedAt: new Date(r["linked_at"] as string).toISOString(),
  });

  const rowToLineTx = (r: Record<string, unknown>): LineLoginTx => ({
    state: String(r["state"]),
    customerId: String(r["customer_id"]),
    nonce: String(r["nonce"]),
    codeVerifier: String(r["code_verifier"]),
    redirectAfter: r["redirect_after"] == null ? null : String(r["redirect_after"]),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    expiresAt: new Date(r["expires_at"] as string).toISOString(),
    usedAt: r["used_at"] == null ? null : new Date(r["used_at"] as string).toISOString(),
  });

  type QueryRunner = Pick<PoolConnection, "query">;

  async function findCustomerRow(q: QueryRunner, id: string): Promise<Customer | null> {
    const [rows] = (await q.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    return rows.length === 0 ? null : rowToCustomer(rows[0]!);
  }

  /** อ่านพร้อม lock แถว + ปฏิเสธบัญชีที่ลบแล้ว (ลูกค้าที่ลบบัญชีไม่นับว่ามีตัวตนใช้งานได้) */
  async function findCustomerRowForUpdate(conn: PoolConnection, id: string): Promise<Customer> {
    const [rows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
    const c = rowToCustomer(rows[0]!);
    if (c.isDeleted) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
    return c;
  }

  function mapCustomerConflict(err: unknown): Error {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
      const msg = "message" in err && typeof err.message === "string" ? err.message : "";
      if (msg.includes("uq_customers_email")) return new ConflictError("อีเมลนี้ถูกใช้สมัครแล้ว");
      return new ConflictError("เบอร์โทรศัพท์นี้ถูกใช้สมัครแล้ว");
    }
    throw err;
  }

  function escapeLike(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  }

  /**
   * รัน unit บน connection เดียวด้วย transaction: commit เมื่อสำเร็จ,
   * rollback เมื่อพัง แล้ว release connection เสมอ
   */
  async function withShopTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const out = await fn(conn);
        await conn.commit();
        return out;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          // เก็บ error ต้นฉบับไว้
        }
        throw err;
      }
    } finally {
      conn.release();
    }
  }

  /**
   * transaction สำหรับเขียนการจอง/เช็กอิน/รอบ (Ticket 06):
   * กัน concurrent ชนกันข้าม process ด้วย named lock ระดับ MySQL
   * (`paor_reservation_write`) ครอบ transaction เดียว — สำเร็จ commit ทั้ง
   * state+audit, พัง rollback ทั้งหมด แล้ว release lock/connection เสมอ
   */
  async function withReservationTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      const [lockRows] = await conn.query("SELECT GET_LOCK('paor_reservation_write', 10) AS l");
      const locked = Number((lockRows as Record<string, unknown>[])[0]!["l"]);
      if (locked !== 1) throw new Error("ขอ lock สำหรับเขียนการจองไม่สำเร็จ");
      try {
        await conn.beginTransaction();
        try {
          const out = await fn(conn);
          await conn.commit();
          return out;
        } catch (err) {
          try {
            await conn.rollback();
          } catch {
            // เก็บ error ต้นฉบับไว้
          }
          throw err;
        }
      } finally {
        try {
          await conn.query("SELECT RELEASE_LOCK('paor_reservation_write')");
        } catch {
          // เก็บ error ต้นฉบับไว้
        }
      }
    } finally {
      conn.release();
    }
  }

  /**
   * transaction สำหรับเขียนการชำระเงิน/ใบเสร็จ/คืนเงิน (Ticket 08):
   * กัน concurrent ชนกันข้าม process ด้วย named lock ระดับ MySQL
   * (`paor_payment_write`) ครอบ transaction เดียว — สำเร็จ commit ทั้ง
   * state+audit, พัง rollback ทั้งหมด แล้ว release lock/connection เสมอ
   */
  async function withPaymentTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      const [lockRows] = await conn.query("SELECT GET_LOCK('paor_payment_write', 10) AS l");
      const locked = Number((lockRows as Record<string, unknown>[])[0]!["l"]);
      if (locked !== 1) throw new Error("ขอ lock สำหรับเขียนการชำระเงินไม่สำเร็จ");
      try {
        await conn.beginTransaction();
        try {
          const out = await fn(conn);
          await conn.commit();
          return out;
        } catch (err) {
          try {
            await conn.rollback();
          } catch {
            // เก็บ error ต้นฉบับไว้
          }
          throw err;
        }
      } finally {
        try {
          await conn.query("SELECT RELEASE_LOCK('paor_payment_write')");
        } catch {
          // เก็บ error ต้นฉบับไว้
        }
      }
    } finally {
      conn.release();
    }
  }

  /** อ่านชื่อร้านใน transaction เดียวกับใบเสร็จ (snapshot ชื่อร้านตอนออกใบเสร็จ) */
  async function readShopNameFrom(q: QueryRunner): Promise<string> {
    const [rows] = (await q.query("SELECT shop_name FROM shop_settings WHERE id = 1 LIMIT 1")) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rows.length === 0) return DEFAULT_SHOP_NAME;
    return String(rows[0]!["shop_name"]);
  }

  /** อ่าน payment พร้อมใบเสร็จ (null เมื่อยังไม่ paid) — ใช้ใน seams ชำระเงิน */
  async function readReceiptTx(q: QueryRunner, paymentId: string): Promise<Receipt | null> {    const [rows] = (await q.query("SELECT * FROM receipts WHERE payment_id = ? LIMIT 1", [paymentId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rows.length === 0) return null;
    return rowToReceipt(rows[0]!);
  }

  /** เปลี่ยน pending ที่หมดอายุเป็น expired + audit (เรียกต้น seams ชำระเงินเสมอ) */
  async function expirePaymentRowIfDue(
    q: QueryRunner,
    p: Payment,
    now: Date,
    actor: ShopActor,
  ): Promise<Payment> {
    if (p.status !== "pending") return p;
    if (new Date(p.expiresAt).getTime() >= now.getTime()) return p;
    await q.query("UPDATE payments SET status = 'expired' WHERE id = ?", [p.id]);
    const after: Payment = { ...p, status: "expired", updatedAt: now.toISOString() };
    await insertAuditRow(q, paymentStatusChangedEvent({ status: "pending" }, after, "intent หมดอายุ (เกินเวลาชำระ)", actor));
    return after;
  }

  /**
   * เปลี่ยนเป็น paid + ออกใบเสร็จ (เลข RCP กันชน) ใน transaction เดียวกับ caller
   * ไม่แตะสต๊อกซ้ำ; queue (09)/points (10) เป็น no-op มี idempotency guard
   */
  async function markPaymentPaidTx(
    q: QueryRunner,
    p: Payment,
    detail: OrderDetail,
    shopNameValue: string,
    reason: string,
    actor: ShopActor,
    now: Date,
  ): Promise<Receipt> {
    assertPaymentTransition(p.status, "paid");
    const before = { status: p.status };
    let receiptNumber = generateReceiptNumber(now);
    for (let i = 0; i < 5; i += 1) {
      try {
        const paidAt = toMysqlDatetime(now.toISOString());
        await q.query(
          "UPDATE payments SET status = 'paid', paid_at = ?, receipt_number = ? WHERE id = ?",
          [paidAt, receiptNumber, p.id],
        );
        const itemsSnapshot = JSON.stringify(
          detail.items.map((item) => ({
            menuName: item.menuName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          })),
        );
        await q.query(
          "INSERT INTO receipts (payment_id, receipt_number, order_id, order_number, shop_name, method, amount, received_amount, change_amount, paid_at, items_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            p.id, receiptNumber, p.orderId, p.orderNumber, shopNameValue, p.method, p.amount,
            p.receivedAmount, p.changeAmount, paidAt, itemsSnapshot,
          ],
        );
        break;
      } catch (err: unknown) {
        const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
        if (msg.includes("uq_payments_receipt") || msg.includes("uq_receipts_number")) {
          receiptNumber = generateReceiptNumber(now);
          continue;
        }
        throw err;
      }
    }
    p.status = "paid";
    p.paidAt = now.toISOString();
    p.receiptNumber = receiptNumber;
    p.updatedAt = now.toISOString();
    await insertAuditRow(q, paymentStatusChangedEvent(before, { ...p }, reason, actor));
    // Ticket 09: ชำระสำเร็จสร้าง queue jobs แบบ exactly-once ใน transaction เดียวกัน
    await ensureQueueJobsTx(q, p, detail, actor, now);
    // Ticket 10: สะสมคะแนนอัตโนมัติแบบ no-op (ยังไม่ส่งมอบ = ไม่เข้าเงื่อนไข)
    await tryAutoEarnTx(q, detail.id, actor, now);
        const receipt = await readReceiptTx(q, p.id);
    if (!receipt) throw new Error("ออกใบเสร็จไม่สำเร็จ");
    return receipt;
  }

  // ---- Ticket 09 MySQL helpers: งานคิวครัว/เครื่องดื่ม (เรียกใน transaction เดียวกับ caller) ----

  /** อ่านงานคิวพร้อมชื่อโต๊ะ (null เมื่อไม่พบ) */
  async function readQueueDetailTx(q: QueryRunner, id: string): Promise<QueueJobDetail | null> {
    const [rows] = (await q.query(
      "SELECT j.*, t.name AS table_name FROM queue_jobs j LEFT JOIN shop_tables t ON t.id = j.table_id WHERE j.id = ? LIMIT 1",
      [id],
    )) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) return null;
    const job = rowToQueueJob(rows[0]!);
    return { ...job, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : null };
  }

  async function listQueueDetailsTx(q: QueryRunner, ids: string[]): Promise<QueueJobDetail[]> {
    const out: QueueJobDetail[] = [];
    for (const id of ids) {
      const d = await readQueueDetailTx(q, id);
      if (d) out.push(d);
    }
    return out;
  }

  /**
   * สร้าง jobs จาก payment ที่ paid แล้วแบบ exactly-once:
   * มีแถวของ payment นี้แล้ว → คืนชุดเดิม (ไม่เขียน audit ซ้ำ)
   */
  async function ensureQueueJobsTx(
    q: QueryRunner,
    p: Payment,
    detail: OrderDetail,
    actor: ShopActor,
    now: Date,
  ): Promise<QueueJob[]> {
    const [existing] = (await q.query("SELECT * FROM queue_jobs WHERE payment_id = ? ORDER BY created_at ASC", [p.id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (existing.length > 0) return existing.map(rowToQueueJob);
    const menuIds = [...new Set(detail.items.map((i) => i.menuId))];
    const kindByMenu = new Map<string, string>();
    if (menuIds.length > 0) {
      const [mRows] = (await q.query(`SELECT id, kind FROM menu_items WHERE id IN (${menuIds.map(() => "?").join(",")})`, menuIds)) as [
        Record<string, unknown>[],
        unknown,
      ];
      for (const m of mRows as Record<string, unknown>[]) kindByMenu.set(String(m["id"]), String(m["kind"]));
    }
    const paidAt = p.paidAt ? new Date(p.paidAt) : now;
    const created: QueueJob[] = [];
    for (const item of detail.items) {
      const station = classifyStation(kindByMenu.get(item.menuId) === "drink" ? "drink" : "food");
      const readyAt = computeReadyAt({
        serviceType: detail.serviceType,
        scheduledAt: detail.scheduledAt,
        paidAt,
        station,
      });
      const job: QueueJob = {
        id: randomUUID(),
        orderId: detail.id,
        orderNumber: detail.orderNumber,
        paymentId: p.id,
        orderItemId: item.id,
        menuId: item.menuId,
        menuName: item.menuName,
        station,
        quantity: item.quantity,
        readyQty: 0,
        deliveredQty: 0,
        status: "queued",
        readyAt,
        tableId: detail.tableId,
        roundId: detail.roundId,
        isRemake: false,
        isPriority: false,
        reason: null,
        claimedBy: null,
        rewardRedemptionId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await q.query(
        "INSERT INTO queue_jobs (id, order_id, order_number, payment_id, order_item_id, menu_id, menu_name, station, quantity, ready_qty, delivered_qty, status, ready_at, table_id, round_id, is_remake, is_priority, reason, claimed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'queued', ?, ?, ?, 0, 0, NULL, NULL)",
        [
          job.id, job.orderId, job.orderNumber, job.paymentId, job.orderItemId, job.menuId,
          job.menuName, job.station, job.quantity, toMysqlDatetime(job.readyAt),
          job.tableId, job.roundId,
        ],
      );
      await insertAuditRow(q, queueCreatedEvent({ ...job }, actor));
      created.push(job);
    }
    return created;
  }

  /**
   * ตรวจว่า order/payment หยุดเดินต่อหรือยัง (คืนเงิน/ยกเลิกแล้ว → 409)
   * orderId null = งานรางวัล (ไม่ผูกคำสั่งซื้อ — ข้ามการตรวจ)
   */
  async function assertQueueOrderActiveTx(q: QueryRunner, orderId: string | null): Promise<Order | null> {
    if (orderId === null) return null;
    const [oRows] = (await q.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
    const order = rowToOrder(oRows[0]!);
    if (order.status === "cancelled") {
      throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว งานคิวหยุดเดินต่อ");
    }
    const [pRows] = (await q.query("SELECT status FROM payments WHERE order_id = ? LIMIT 1", [orderId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (pRows.length > 0 && String(pRows[0]!["status"]) === "refunded") {
      throw new ConflictError("คำสั่งซื้อนี้คืนเงินแล้ว งานคิวหยุดเดินต่อ");
    }
    return order;
  }

  /** ตัดสต๊อกจริงครั้งแรกของคำสั่งซื้อ (ครั้งเดียว — มี flag แล้วเป็น no-op) */
  async function consumeStockForQueueStartTx(
    q: QueryRunner,
    order: Order,
    jobId: string,
    actor: ShopActor,
  ): Promise<void> {
    if (!order.stockReserved || order.stockConsumed) return;
    const [useRows] = (await q.query("SELECT ingredient_id, qty FROM order_stock_usage WHERE order_id = ?", [order.id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    for (const u of useRows as Record<string, unknown>[]) {
      const ingId = String(u["ingredient_id"]);
      const qty = Number(u["qty"]);
      const [ingRows] = (await q.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [ingId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (ingRows.length === 0) continue;
      const ing = rowToIngredient(ingRows[0]!);
      const afterReserved = roundStock(Math.max(0, ing.reserved - qty));
      const afterOnHand = roundStock(ing.onHand - qty);
      await q.query("UPDATE ingredients SET on_hand = ?, reserved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        afterOnHand, afterReserved, ingId,
      ]);
      await q.query(
        "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'consume', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          randomUUID(), ingId, -qty, -qty, ing.onHand, afterOnHand, ing.reserved, afterReserved,
          `ตัดใช้จริงให้คำสั่งซื้อ ${order.orderNumber} เมื่อเริ่มทำ (งานคิว ${jobId})`,
          actor.actorId ?? null, actor.actorUsername ?? null, order.id, order.orderNumber,
        ],
      );
    }
    await q.query("UPDATE orders SET stock_consumed = 1 WHERE id = ?", [order.id]);
    await insertAuditRow(q, orderStockConsumedEvent(order.orderNumber, order.id, actor));
  }

  // ---- Ticket 10 MySQL helpers: คะแนน/รางวัล (เรียกใน transaction เดียวกับ caller) ----

  async function loyaltyBalanceTx(q: QueryRunner, customerId: string): Promise<number> {
    const [rows] = (await q.query("SELECT COALESCE(SUM(points), 0) AS s FROM loyalty_transactions WHERE customer_id = ?", [customerId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    return Number(rows[0]!["s"] ?? 0);
  }

  async function loyaltyHeldTx(q: QueryRunner, customerId: string): Promise<number> {
    const [rows] = (await q.query("SELECT COALESCE(SUM(points_cost), 0) AS s FROM reward_redemptions WHERE customer_id = ? AND status = 'reserved'", [customerId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    return Number(rows[0]!["s"] ?? 0);
  }

  async function rewardHeldCountTx(q: QueryRunner, rewardId: string): Promise<number> {
    const [rows] = (await q.query("SELECT COUNT(*) AS n FROM reward_redemptions WHERE reward_id = ? AND status = 'reserved'", [rewardId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    return Number(rows[0]!["n"] ?? 0);
  }

  async function earnedForOrderItemTx(q: QueryRunner, orderItemId: string): Promise<number> {
    const [rows] = (await q.query("SELECT COALESCE(SUM(points), 0) AS s FROM loyalty_transactions WHERE order_item_id = ? AND source = 'order'", [orderItemId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    return Number(rows[0]!["s"] ?? 0);
  }

  async function appendLoyaltyTx(
    q: QueryRunner,
    tx: Omit<LoyaltyTransaction, "id" | "createdAt">,
    now: Date,
  ): Promise<LoyaltyTransaction> {
    const id = randomUUID();
    await q.query(
      "INSERT INTO loyalty_transactions (id, customer_id, points, source, order_id, payment_id, order_item_id, redemption_id, walkin_token_id, reason, actor_id, actor_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id, tx.customerId, tx.points, tx.source, tx.orderId, tx.paymentId, tx.orderItemId,
        tx.redemptionId, tx.walkinTokenId, tx.reason, tx.actorId, tx.actorUsername,
      ],
    );
    const [rows] = (await q.query("SELECT * FROM loyalty_transactions WHERE id = ? LIMIT 1", [id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rows.length === 0) throw new Error("บันทึกธุรกรรมคะแนนไม่สำเร็จ");
    void now;
    return rowToLoyaltyTx(rows[0]!);
  }

  /** เมนูรับรางวัล 1 หน่วยได้หรือไม่ (สูตรล่าสุดมีพร้อมขายพอ — ไม่มีสูตร = ตรวจผ่าน) */
  async function isMenuOrderableTx(q: QueryRunner, menuId: string, units: number): Promise<boolean> {
    const recipe = await readLatestRecipeTx(q, "menu", menuId);
    if (!recipe) return true;
    for (const line of recipe.lines) {
      const [ingRows] = (await q.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [line.ingredientId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (ingRows.length === 0) return false;
      const ing = rowToIngredient(ingRows[0]!);
      if (!ing.isEnabled) return false;
      if (roundStock(ing.onHand - ing.reserved) < roundStock(line.qty * units)) return false;
    }
    return true;
  }

  /** ตัดสต๊อกจริง 1 หน่วยให้รางวัลแลก (ตรวจครบก่อนตัด — เรียกใน tx เดียวกับ caller) */
  async function consumeStockForRewardTx(
    q: QueryRunner,
    menuId: string,
    code: string,
    menuName: string,
    actor: ShopActor,
  ): Promise<void> {
    const recipe = await readLatestRecipeTx(q, "menu", menuId);
    if (!recipe) return;
    const locked = new Map<string, { ing: ReturnType<typeof rowToIngredient>; need: number }>();
    for (const line of recipe.lines) {
      const [ingRows] = (await q.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [line.ingredientId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (ingRows.length === 0) continue;
      const ing = rowToIngredient(ingRows[0]!);
      const need = roundStock(line.qty);
      if (roundStock(ing.onHand - ing.reserved) < need || roundStock(ing.onHand - need) < 0) {
        throw new ConflictError("วัตถุดิบหมดชั่วคราว รับรายการไม่ได้ กรุณาคืนคะแนนให้ลูกค้า");
      }
      locked.set(ing.id, { ing, need });
    }
    for (const { ing, need } of locked.values()) {
      const afterOnHand = roundStock(ing.onHand - need);
      await q.query("UPDATE ingredients SET on_hand = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [afterOnHand, ing.id]);
      await insertLedgerRow(q, {
        ingredientId: ing.id,
        op: "consume",
        deltaOnHand: -need,
        deltaReserved: 0,
        beforeOnHand: ing.onHand,
        afterOnHand,
        beforeReserved: ing.reserved,
        afterReserved: ing.reserved,
        reason: `ตัดใช้จริงให้รางวัลแลก ${code} (${menuName} ×1)`,
        actorId: actor.actorId ?? null,
        actorUsername: actor.actorUsername ?? null,
        orderId: null,
        reference: code,
      });
    }
  }

  /**
   * สะสมคะแนนให้คำสั่งซื้อแบบ exactly-once ใน transaction เดียวกับ caller
   * (เงื่อนไขเดียวกับ memory helper — paid + delivered/completed เฉพาะ drink ราคา > 0)
   */
  async function tryAutoEarnTx(
    q: QueryRunner,
    orderId: string,
    actor: ShopActor,
    now: Date,
  ): Promise<number> {
    const [oRows] = (await q.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (oRows.length === 0) return 0;
    const order = rowToOrder(oRows[0]!);
    if (order.status === "cancelled" || !order.customerId) return 0;
    const [cRows] = (await q.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [order.customerId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (cRows.length === 0) return 0;
    const customer = rowToCustomer(cRows[0]!);
    if (customer.isDeleted || !customer.isActive) return 0;
    const [pRows] = (await q.query("SELECT * FROM payments WHERE order_id = ? LIMIT 1", [order.id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (pRows.length === 0 || String(pRows[0]!["status"]) !== "paid") return 0;
    const payId = String(pRows[0]!["id"]);
    const [iRows] = (await q.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY menu_name ASC", [order.id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    const menuIds = [...new Set((iRows as Record<string, unknown>[]).map((r) => String(r["menu_id"])))];
    const kindByMenu = new Map<string, string>();
    if (menuIds.length > 0) {
      const [mRows] = (await q.query(`SELECT id, kind FROM menu_items WHERE id IN (${menuIds.map(() => "?").join(",")})`, menuIds)) as [
        Record<string, unknown>[],
        unknown,
      ];
      for (const m of mRows as Record<string, unknown>[]) kindByMenu.set(String(m["id"]), String(m["kind"]));
    }
    let earned = 0;
    for (const r of iRows as Record<string, unknown>[]) {
      const item = rowToOrderItem(r);
      if (kindByMenu.get(item.menuId) !== "drink") continue;
      if (item.unitPrice <= 0) continue;
      let eligible: number;
      if (order.status === "completed") {
        eligible = item.quantity;
      } else {
        const [jRows] = (await q.query(
          "SELECT COALESCE(SUM(delivered_qty), 0) AS d FROM queue_jobs WHERE order_id = ? AND order_item_id = ? AND station = 'drink' AND reward_redemption_id IS NULL AND status <> 'cancelled'",
          [order.id, item.id],
        )) as [Record<string, unknown>[], unknown];
        eligible = Math.min(item.quantity, Number(jRows[0]!["d"] ?? 0));
      }
      const todo = eligible - (await earnedForOrderItemTx(q, item.id));
      if (todo <= 0) continue;
      const points = todo * LOYALTY_POINTS_PER_DRINK_UNIT;
      const tx = await appendLoyaltyTx(q, {
        customerId: customer.id,
        points,
        source: "order",
        orderId: order.id,
        paymentId: payId,
        orderItemId: item.id,
        redemptionId: null,
        walkinTokenId: null,
        reason: `สะสมจากคำสั่งซื้อ ${order.orderNumber} (${item.menuName} ×${todo})`,
        actorId: actor.actorId ?? null,
        actorUsername: actor.actorUsername ?? null,
      }, now);
      await insertAuditRow(q, loyaltyEarnedEvent(tx, actor));
      earned += points;
    }
    return earned;
  }

  /**
   * ย้อนคะแนนเมื่อคืนเงินแบบ idempotent ใน transaction เดียวกับ caller
   * (refund เดิมมี reversal แล้ว = คืนของเดิม ไม่เขียนซ้ำ)
   */
  async function reversePointsTx(
    q: QueryRunner,
    orderId: string,
    refundId: string,
    actor: ShopActor,
    now: Date,
  ): Promise<{ reversal: LoyaltyReversal; deduplicated: boolean }> {
    const [exRows] = (await q.query("SELECT * FROM loyalty_reversals WHERE refund_id = ? LIMIT 1", [refundId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (exRows.length > 0) return { reversal: rowToReversal(exRows[0]!), deduplicated: true };
    const [oRows] = (await q.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
    const order = rowToOrder(oRows[0]!);
    const customerId = order.customerId ?? "";
    let earned = 0;
    if (customerId) {
      const [sRows] = (await q.query(
        "SELECT COALESCE(SUM(points), 0) AS s FROM loyalty_transactions WHERE order_id = ? AND source = 'order' AND customer_id = ?",
        [orderId, customerId],
      )) as [Record<string, unknown>[], unknown];
      earned = Number(sRows[0]!["s"] ?? 0);
    }
    if (earned > 0 && customerId) {
      await appendLoyaltyTx(q, {
        customerId,
        points: -earned,
        source: "refund",
        orderId,
        paymentId: null,
        orderItemId: null,
        redemptionId: null,
        walkinTokenId: null,
        reason: `ย้อนคะแนนจากคำสั่งซื้อ ${order.orderNumber} ที่คืนเงิน`,
        actorId: actor.actorId ?? null,
        actorUsername: actor.actorUsername ?? null,
      }, now);
    }
    const id = randomUUID();
    await q.query("INSERT INTO loyalty_reversals (id, order_id, refund_id, customer_id, points) VALUES (?, ?, ?, ?, ?)", [
      id, orderId, refundId, customerId, earned,
    ]);
    const [rRows] = (await q.query("SELECT * FROM loyalty_reversals WHERE id = ? LIMIT 1", [id])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rRows.length === 0) throw new Error("บันทึกการย้อนคะแนนไม่สำเร็จ");
    const reversal = rowToReversal(rRows[0]!);
    await insertAuditRow(q, pointsReversedEvent(orderId, customerId || "-", earned, refundId, actor));
    return { reversal, deduplicated: false };
  }

  /** สร้างงานคิวรางวัล (drink 1 หน่วย ราคา 0 — ไม่ผูก order/payment) ใน tx เดียวกับ caller */
  async function insertRewardJobTx(
    q: QueryRunner,
    redemption: RewardRedemption,
    actor: ShopActor,
    now: Date,
  ): Promise<QueueJob> {
    const at = now.toISOString();
    const job: QueueJob = {
      id: randomUUID(),
      orderId: null,
      orderNumber: redemption.code,
      paymentId: null,
      orderItemId: "",
      menuId: redemption.menuId,
      menuName: redemption.menuName,
      station: "drink",
      quantity: 1,
      readyQty: 0,
      deliveredQty: 0,
      status: "queued",
      readyAt: at,
      tableId: null,
      roundId: null,
      isRemake: false,
      isPriority: false,
      reason: null,
      claimedBy: null,
      rewardRedemptionId: redemption.id,
      createdAt: at,
      updatedAt: at,
    };
    await q.query(
      "INSERT INTO queue_jobs (id, order_id, order_number, payment_id, order_item_id, menu_id, menu_name, station, quantity, ready_qty, delivered_qty, status, ready_at, table_id, round_id, is_remake, is_priority, reason, claimed_by, reward_redemption_id) VALUES (?, NULL, ?, NULL, ?, ?, ?, 'drink', 1, 0, 0, 'queued', ?, NULL, NULL, 0, 0, NULL, NULL, ?)",
      [job.id, job.orderNumber, job.orderItemId, job.menuId, job.menuName, toMysqlDatetime(job.readyAt), redemption.id],
    );
    await insertAuditRow(q, queueCreatedEvent({ ...job }, actor));
    return job;
  }

  async function readCapacityTx(q: QueryRunner, station: QueueStation): Promise<number> {
    const [rows] = (await q.query("SELECT per_slot FROM station_capacity WHERE station = ? LIMIT 1", [station])) as [
      Record<string, unknown>[],
      unknown,
    ];
    if (rows.length === 0) return QUEUE_DEFAULT_CAPACITY_PER_SLOT;
    return Number(rows[0]!["per_slot"]);
  }

  async function countJobsInSlotTx(q: QueryRunner, station: QueueStation, slotStart: Date): Promise<number> {
    const slotMs = QUEUE_SLOT_MINUTES * 60 * 1000;
    const [rows] = (await q.query(
      "SELECT COUNT(*) AS n FROM queue_jobs WHERE station = ? AND status <> 'cancelled' AND ready_at >= ? AND ready_at < ?",
      [station, toMysqlDatetime(slotStart.toISOString()), toMysqlDatetime(new Date(slotStart.getTime() + slotMs).toISOString())],
    )) as [Record<string, unknown>[], unknown];
    return Number(rows[0]!["n"] ?? 0);
  }

  async function readReservationDetail(q: QueryRunner, id: string): Promise<ReservationDetail | null> {    const [rows] = (await q.query(
      "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1",
      [id],
    )) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) return null;
    const r = rowToReservation(rows[0]!);
    return { ...r, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : "-" };
  }

  async function readRoundDetail(q: QueryRunner, id: string): Promise<TableRoundDetail | null> {
    const [rows] = (await q.query(
      "SELECT r.*, t.name AS table_name FROM table_rounds r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1",
      [id],
    )) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) return null;
    const r = rowToTableRound(rows[0]!);
    return { ...r, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : "-" };
  }

  async function insertAuditRow(q: QueryRunner, input: AuditInput): Promise<void> {
    await q.query(
      "INSERT INTO audit_logs (actor_id, actor_username, action, target_id, target_username, detail, ip, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.actorId ?? null,
        input.actorUsername ?? null,
        input.action,
        input.targetId ?? null,
        input.targetUsername ?? null,
        input.detail ?? null,
        input.ip ?? null,
        (input.success ?? true) ? 1 : 0,
      ],
    );
  }

  function mapScheduleRows(rows: Record<string, unknown>[]): WeeklySchedule {
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      const wd = Number(r["weekday"]);
      raw[String(wd)] = {
        closed: Number(r["closed"]) === 1,
        intervals: parseStoredIntervals(r["intervals"], wd),
      };
    }
    for (const key of WEEKDAY_KEYS) {
      if (!raw[key]) raw[key] = { closed: false, intervals: [{ open: "09:00", close: "21:00" }] };
    }
    return normalizeWeeklySchedule(raw);
  }

  function mapOverrideRow(r: Record<string, unknown>): ShopOverride {
    const mode = String(r["mode"]);
    if (mode !== "open" && mode !== "closed") throw new Error("โหมด override ในฐานข้อมูลไม่ถูกต้อง");
    const dt = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const d = new Date(v as string);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    };
    return {
      mode,
      reason: r["reason"] ? String(r["reason"]) : null,
      expectedReopenAt: dt(r["expected_reopen_at"]),
      expiresAt: dt(r["expires_at"]),
      createdAt: new Date(r["created_at"] as string).toISOString(),
      createdBy: r["created_by"] ? String(r["created_by"]) : null,
    };
  }

  async function readShopSnapshotFrom(q: QueryRunner): Promise<ShopSnapshot> {
    const config = await readConfigSnapshotFrom(q);
    const [tableRows] = (await q.query("SELECT * FROM shop_tables ORDER BY name ASC")) as [
      Record<string, unknown>[],
      unknown,
    ];
    return { ...config, tables: tableRows.map(rowToTable) };
  }

  /** อ่านเฉพาะ config (ไม่แตะ shop_tables) — ใช้คืนผล saveShopConfig */
  async function readConfigSnapshotFrom(q: QueryRunner): Promise<ShopConfigSnapshot> {
    const [nameRows] = (await q.query("SELECT shop_name FROM shop_settings WHERE id = 1 LIMIT 1")) as [
      Record<string, unknown>[],
      unknown,
    ];
    const [schedRows] = (await q.query(
      "SELECT weekday, closed, intervals FROM shop_schedule ORDER BY weekday ASC",
    )) as [Record<string, unknown>[], unknown];
    const [ovRows] = (await q.query("SELECT * FROM shop_override WHERE id = 1 LIMIT 1")) as [
      Record<string, unknown>[],
      unknown,
    ];
    return {
      shopName: nameRows.length === 0 ? DEFAULT_SHOP_NAME : String(nameRows[0]!["shop_name"]),
      schedule: mapScheduleRows(schedRows),
      override: ovRows.length === 0 ? null : mapOverrideRow(ovRows[0]!),
    };
  }

  const rowToUser = (r: Record<string, unknown>): User => ({
    id: String(r["id"]),
    username: String(r["username"]),
    passwordHash: String(r["password_hash"]),
    roles: parseRoles(r["roles"]),
    isActive: Number(r["is_active"]) === 1,
    passwordVersion: Number(r["password_version"] ?? 1),
    createdAt: new Date(r["created_at"] as string).toISOString(),
    updatedAt: new Date(r["updated_at"] as string).toISOString(),
  });

  /** อ่านรายการย่อยแบบ batch สำหรับ orders หลายแถว (list หลังร้าน/ของฉัน) */
  async function readOrdersWithItems(oRows: Record<string, unknown>[]): Promise<OrderDetail[]> {
    if (oRows.length === 0) return [];
    const ids = oRows.map((r) => String(r["id"]));
    const [iRows] = (await pool.query(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")})`, ids)) as [
      Record<string, unknown>[],
      unknown,
    ];
    const byOrder = new Map<string, OrderItem[]>();
    for (const r of iRows as Record<string, unknown>[]) {
      const item = rowToOrderItem(r);
      const list = byOrder.get(item.orderId) ?? [];
      list.push(item);
      byOrder.set(item.orderId, list);
    }
    return oRows.map((r) => {
      const order = rowToOrder(r);
      const items = (byOrder.get(order.id) ?? []).sort((a, b) => a.menuName.localeCompare(b.menuName, "th"));
      return { ...order, items };
    });
  }

  const mysqlStore: Store = {
    async createUser(input) {
      const id = randomUUID();
      try {
        await pool.query(
          "INSERT INTO users (id, username, password_hash, roles, is_active) VALUES (?, ?, ?, CAST(? AS JSON), 1)",
          [id, input.username, input.passwordHash, JSON.stringify(normalizeRoles(input.roles))],
        );
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "ER_DUP_ENTRY"
        ) {
          throw new ConflictError("ชื่อผู้ใช้นี้มีอยู่แล้ว");
        }
        throw err;
      }
      const created = await mysqlStore.findById(id);
      if (!created) throw new Error("สร้างบัญชีไม่สำเร็จ");
      return created;
    },
    async createFirstOwner(input) {
      // กันแข่งกันสร้าง Owner คนแรกข้าม process ด้วย named lock ระดับ MySQL
      const conn = await pool.getConnection();
      try {
        const [lockRows] = await conn.query("SELECT GET_LOCK('staff_first_owner', 10) AS l");
        const locked = Number((lockRows as Record<string, unknown>[])[0]!["l"]);
        if (locked !== 1) throw new Error("ขอ lock สำหรับ bootstrap Owner ไม่สำเร็จ");
        const [countRows] = await conn.query(
          "SELECT COUNT(*) AS n FROM users WHERE JSON_CONTAINS(roles, '\"owner\"')",
        );
        if (Number((countRows as Record<string, unknown>[])[0]!["n"]) > 0) {
          return { created: false, reason: "owner-exists" };
        }
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO users (id, username, password_hash, roles, is_active) VALUES (?, ?, ?, CAST(? AS JSON), 1)",
            [id, input.username, input.passwordHash, JSON.stringify(normalizeRoles(input.roles))],
          );
        } catch (err: unknown) {
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            (err as { code: string }).code === "ER_DUP_ENTRY"
          ) {
            throw new ConflictError("ชื่อผู้ใช้นี้มีอยู่แล้ว");
          }
          throw err;
        }
        const created = await mysqlStore.findById(id);
        if (!created) throw new Error("สร้างบัญชีไม่สำเร็จ");
        return { created: true, user: created };
      } finally {
        try {
          await conn.query("SELECT RELEASE_LOCK('staff_first_owner')");
        } finally {
          conn.release();
        }
      }
    },
    async findByUsername(username) {
      const [rows] = await pool.query("SELECT * FROM users WHERE username = ? LIMIT 1", [
        username,
      ]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToUser(list[0]!);
    },
    async findById(id) {
      const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToUser(list[0]!);
    },
    async listUsers() {
      const [rows] = await pool.query("SELECT * FROM users ORDER BY created_at ASC");
      return (rows as Record<string, unknown>[]).map(rowToUser);
    },
    async updateUser(id, patch) {
      const current = await mysqlStore.findById(id);
      if (!current) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
      const roles = patch.roles ? normalizeRoles(patch.roles) : current.roles;
      const isActive = patch.isActive ?? current.isActive;
      await pool.query("UPDATE users SET roles = CAST(? AS JSON), is_active = ? WHERE id = ?", [
        JSON.stringify(roles),
        isActive ? 1 : 0,
        id,
      ]);
      const updated = await mysqlStore.findById(id);
      if (!updated) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
      return updated;
    },
    async setPassword(id, passwordHash) {
      await pool.query(
        "UPDATE users SET password_hash = ?, password_version = password_version + 1 WHERE id = ?",
        [passwordHash, id],
      );
      const updated = await mysqlStore.findById(id);
      if (!updated) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
      return updated;
    },
    async countOwners() {
      const [rows] = await pool.query(
        "SELECT COUNT(*) AS n FROM users WHERE JSON_CONTAINS(roles, '\"owner\"')",
      );
      return Number((rows as Record<string, unknown>[])[0]!["n"]);
    },
    async createSession(userId, passwordVersion) {
      const id =
        randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      await pool.query(
        "INSERT INTO sessions (id, user_id, password_version, expires_at) VALUES (?, ?, ?, ?)",
        [id, userId, passwordVersion, expires],
      );
      const found = await mysqlStore.findSession(id);
      if (!found) throw new Error("สร้างเซสชันไม่สำเร็จ");
      return found;
    },
    async findSession(id) {
      const [rows] = await pool.query("SELECT * FROM sessions WHERE id = ? LIMIT 1", [id]);
      const list = rows as Record<string, unknown>[];
      if (list.length === 0) return null;
      const r = list[0]!;
      return {
        id: String(r["id"]),
        userId: String(r["user_id"]),
        passwordVersion: Number(r["password_version"] ?? 1),
        createdAt: new Date(r["created_at"] as string).toISOString(),
        expiresAt: new Date(r["expires_at"] as string).toISOString(),
      };
    },
    async deleteSession(id) {
      await pool.query("DELETE FROM sessions WHERE id = ?", [id]);
    },
    async deleteSessionsForUser(userId) {
      await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
    },
    async audit(input) {
      await insertAuditRow(pool, input);
    },
    async listAudit(prefix, limit) {
      let sql = "SELECT * FROM audit_logs";
      const params: unknown[] = [];
      if (prefix === "login_") {
        sql += " WHERE action LIKE 'login\\_%'";
      } else if (prefix === "shop_") {
        sql += " WHERE action LIKE 'shop\\_%'";
      } else if (prefix === "customer_") {
        sql += " WHERE action LIKE 'customer\\_%'";
      } else if (prefix === "menu_") {
        sql += " WHERE action LIKE 'menu\\_%'";
      } else if (prefix === "order_") {
        sql += " WHERE action LIKE 'order\\_%'";
      } else if (prefix === "reservation_") {
        sql += " WHERE action LIKE 'reservation\\_%'";
      } else if (prefix === "round_") {
        sql += " WHERE action LIKE 'table\\_round\\_%'";
      } else if (prefix === "payment_") {
        sql += " WHERE action LIKE 'payment\\_%'";
      } else if (prefix === "loyalty_") {
        sql += " WHERE (action LIKE 'loyalty\\_%' OR action LIKE 'reward\\_%')";
      } else if (prefix === "queue_") {
        sql += " WHERE action LIKE 'queue\\_%'";
      } else if (prefix === "notification_") {
        sql += " WHERE action LIKE 'notification\\_%'";
      } else if (prefix === "account_") {
        sql += " WHERE action NOT LIKE 'login\\_%'";
      }
      sql += " ORDER BY id DESC LIMIT ?";
      params.push(limit);
      const [rows] = await pool.query(sql, params);
      return (rows as Record<string, unknown>[]).map((r) => ({
        id: Number(r["id"]),
        at: new Date(r["at"] as string).toISOString(),
        actorId: r["actor_id"] ? String(r["actor_id"]) : null,
        actorUsername: r["actor_username"] ? String(r["actor_username"]) : null,
        action: String(r["action"]),
        targetId: r["target_id"] ? String(r["target_id"]) : null,
        targetUsername: r["target_username"] ? String(r["target_username"]) : null,
        detail: r["detail"] ? String(r["detail"]) : null,
        ip: r["ip"] ? String(r["ip"]) : null,
        success: Number(r["success"]) === 1,
      }));
    },
    async getShopName() {
      const [rows] = await pool.query("SELECT shop_name FROM shop_settings WHERE id = 1 LIMIT 1");
      const list = rows as Record<string, unknown>[];
      if (list.length === 0) return DEFAULT_SHOP_NAME;
      return String(list[0]!["shop_name"]);
    },
    async getSchedule() {
      const [rows] = await pool.query("SELECT weekday, closed, intervals FROM shop_schedule ORDER BY weekday ASC");
      return mapScheduleRows(rows as Record<string, unknown>[]);
    },
    async getOverride() {
      const [rows] = await pool.query("SELECT * FROM shop_override WHERE id = 1 LIMIT 1");
      const list = rows as Record<string, unknown>[];
      if (list.length === 0) return null;
      return mapOverrideRow(list[0]!);
    },
    async listTables() {
      const [rows] = await pool.query("SELECT * FROM shop_tables ORDER BY name ASC");
      return (rows as Record<string, unknown>[]).map(rowToTable);
    },
    async getShopSnapshot() {
      // snapshot คงเส้นคงวาจาก transaction เดียว (read-only) บน connection เดียว
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          const snap = await readShopSnapshotFrom(conn);
          await conn.commit();
          return snap;
        } catch (err) {
          try {
            await conn.rollback();
          } catch {
            // เก็บ error ต้นฉบับไว้
          }
          throw err;
        }
      } finally {
        conn.release();
      }
    },
    async saveShopConfig(input, actor) {
      // validate ก่อนเปิด transaction: ไม่ผ่าน = ไม่แตะ DB เลย
      const normalized = normalizeWeeklySchedule(JSON.parse(JSON.stringify(input.schedule)) as unknown);
      return withShopTx(async (conn) => {
        const [nameRows] = (await conn.query("SELECT shop_name FROM shop_settings WHERE id = 1 LIMIT 1 FOR UPDATE")) as [
          Record<string, unknown>[],
          unknown,
        ];
        const current = nameRows.length === 0 ? DEFAULT_SHOP_NAME : String(nameRows[0]!["shop_name"]);
        let nameChanged = false;
        if (input.shopName !== undefined && input.shopName !== current) {
          await conn.query(
            "INSERT INTO shop_settings (id, shop_name) VALUES (1, ?) ON DUPLICATE KEY UPDATE shop_name = VALUES(shop_name)",
            [input.shopName],
          );
          nameChanged = true;
          await insertAuditRow(conn, shopNameUpdatedEvent(input.shopName, actor));
        }
        for (const key of WEEKDAY_KEYS) {
          const day = normalized[key]!;
          await conn.query(
            "INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (?, ?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE closed = VALUES(closed), intervals = VALUES(intervals)",
            [Number(key), day.closed ? 1 : 0, JSON.stringify(day.intervals)],
          );
        }
        await insertAuditRow(conn, shopScheduleUpdatedEvent(actor));
        return { ...(await readConfigSnapshotFrom(conn)), nameChanged };
      });
    },
    async setShopOverride(input, actor) {
      return withShopTx(async (conn) => {
        await conn.query(
          "INSERT INTO shop_override (id, mode, reason, expected_reopen_at, expires_at, created_by) VALUES (1, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE mode = VALUES(mode), reason = VALUES(reason), expected_reopen_at = VALUES(expected_reopen_at), expires_at = VALUES(expires_at), created_by = VALUES(created_by)",
          [
            input.mode,
            input.reason ?? null,
            input.expectedReopenAt ? toMysqlDatetime(input.expectedReopenAt) : null,
            input.expiresAt ? toMysqlDatetime(input.expiresAt) : null,
            input.createdBy ?? null,
          ],
        );
        await insertAuditRow(conn, shopOverrideSetEvent(input, actor));
        const saved = await readShopSnapshotFrom(conn);
        if (!saved.override) throw new Error("บันทึกคำสั่งชั่วคราวไม่สำเร็จ");
        return saved.override;
      });
    },
    async clearShopOverride(actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT id FROM shop_override WHERE id = 1 LIMIT 1 FOR UPDATE")) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) return false;
        await conn.query("DELETE FROM shop_override WHERE id = 1");
        await insertAuditRow(conn, shopOverrideClearedEvent(actor));
        return true;
      });
    },
    async createShopTable(input, actor) {
      return withShopTx(async (conn) => {
        const id = randomUUID();
        try {
          await conn.query("INSERT INTO shop_tables (id, name, capacity, is_enabled) VALUES (?, ?, ?, 1)", [
            id,
            input.name.trim(),
            input.capacity,
          ]);
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("ชื่อโต๊ะนี้มีอยู่แล้ว");
          }
          throw err;
        }
        await insertAuditRow(conn, shopTableCreatedEvent(input.name.trim(), input.capacity, actor));
        const [rows] = (await conn.query("SELECT * FROM shop_tables WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new Error("สร้างโต๊ะไม่สำเร็จ");
        return rowToTable(rows[0]!);
      });
    },
    async updateShopTable(id, patch, actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM shop_tables WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบโต๊ะ");
        const current = rowToTable(rows[0]!);
        const name = patch.name !== undefined ? patch.name.trim() : current.name;
        const capacity = patch.capacity ?? current.capacity;
        const isEnabled = patch.isEnabled ?? current.isEnabled;
        try {
          await conn.query("UPDATE shop_tables SET name = ?, capacity = ?, is_enabled = ? WHERE id = ?", [
            name,
            capacity,
            isEnabled ? 1 : 0,
            id,
          ]);
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("ชื่อโต๊ะนี้มีอยู่แล้ว");
          }
          throw err;
        }
        await insertAuditRow(conn, shopTableUpdatedEvent(name, capacity, isEnabled, actor));
        const [rows2] = (await conn.query("SELECT * FROM shop_tables WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        return rowToTable(rows2[0]!);
      });
    },
    // ---- Ticket 04 MySQL: เมนู (transaction เดียวกับ audit เสมอ) ----
    async listMenuItems(options) {
      const includeArchived = options?.includeArchived ?? false;
      const [rows] = includeArchived
        ? await pool.query(`SELECT * FROM menu_items ${MENU_ORDER_BY}`)
        : await pool.query(`SELECT * FROM menu_items WHERE is_archived = 0 ${MENU_ORDER_BY}`);
      return (rows as Record<string, unknown>[]).map(rowToMenu);
    },
    async listPublicMenuItems() {
      const [rows] = await pool.query(
        `SELECT * FROM menu_items WHERE status = 'available' AND is_archived = 0 ${MENU_ORDER_BY}`,
      );
      return (rows as Record<string, unknown>[]).map(rowToMenu);
    },
    async getMenuItem(id) {
      const [rows] = await pool.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [id]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToMenu(list[0]!);
    },
    async createMenuItem(input, actor) {
      return withShopTx(async (conn) => {
        const n = normalizeMenuInput(input);
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO menu_items (id, category, name, description, image_url, price, kind, status, is_archived, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
            [id, n.category, n.name, n.description, n.imageUrl, n.price, n.kind, n.status, n.sortOrder],
          );
        } catch (err: unknown) {
          throw mapMenuConflict(err);
        }
        const [rows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new Error("สร้างเมนูไม่สำเร็จ");
        const created = rowToMenu(rows[0]!);
        await insertAuditRow(conn, menuCreatedEvent(created, actor));
        return created;
      });
    },
    async updateMenuItem(id, patch, actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบเมนู");
        const current = rowToMenu(rows[0]!);
        if (current.isArchived && patch.isArchived !== false) {
          throw new ConflictError("เมนูนี้ถูก archive แล้ว นำกลับมาก่อนจึงจะแก้ไขได้");
        }
        const before: MenuItem = { ...current };
        const candidate: MenuInput = {
          category: patch.category !== undefined ? patch.category : current.category,
          name: patch.name !== undefined ? patch.name : current.name,
          description: patch.description !== undefined ? patch.description : current.description,
          imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : current.imageUrl,
          price: patch.price !== undefined ? patch.price : current.price,
          kind: patch.kind !== undefined ? patch.kind : current.kind,
          status: patch.status !== undefined ? patch.status : current.status,
          sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder,
        };
        const n = normalizeMenuInput(candidate);
        const keys = Object.keys(patch) as (keyof typeof patch)[];
        const onlyStatusChanged = keys.length === 1 && keys[0] === "status" && patch.status !== undefined;
        const isArchived = patch.isArchived !== undefined ? patch.isArchived : current.isArchived;
        try {
          await conn.query(
            "UPDATE menu_items SET category = ?, name = ?, description = ?, image_url = ?, price = ?, kind = ?, status = ?, is_archived = ?, sort_order = ? WHERE id = ?",
            [n.category, n.name, n.description, n.imageUrl, n.price, n.kind, n.status, isArchived ? 1 : 0, n.sortOrder, id],
          );
        } catch (err: unknown) {
          throw mapMenuConflict(err);
        }
        const [rows2] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const after = rowToMenu(rows2[0]!);
        await insertAuditRow(
          conn,
          onlyStatusChanged ? menuStatusChangedEvent(before, after, actor) : menuUpdatedEvent(before, after, actor),
        );
        return after;
      });
    },
    async archiveMenuItem(id, actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบเมนู");
        const current = rowToMenu(rows[0]!);
        if (current.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว");
        await conn.query("UPDATE menu_items SET is_archived = 1 WHERE id = ?", [id]);
        const [rows2] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const archived = rowToMenu(rows2[0]!);
        await insertAuditRow(conn, menuArchivedEvent(archived, actor));
        return archived;
      });
    },
    async restoreMenuItem(id, actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบเมนู");
        const current = rowToMenu(rows[0]!);
        if (!current.isArchived) throw new ConflictError("เมนูนี้ไม่ได้ถูก archive");
        await conn.query("UPDATE menu_items SET is_archived = 0 WHERE id = ?", [id]);
        const [rows2] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const restored = rowToMenu(rows2[0]!);
        await insertAuditRow(conn, menuRestoredEvent(restored, actor));
        return restored;
      });
    },
    // ---- Ticket 03 MySQL: บัญชีลูกค้า + เซสชัน + LINE (transaction เดียวกับ audit เสมอ) ----
    async createCustomer(input, actor) {
      return withShopTx(async (conn) => {
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO customers (id, name, phone, email, password_hash, is_active, is_deleted) VALUES (?, ?, ?, ?, ?, 1, 0)",
            [id, input.name, input.phone, input.email, input.passwordHash],
          );
        } catch (err: unknown) {
          throw mapCustomerConflict(err);
        }
        await insertAuditRow(conn, customerRegisteredEvent(id, actor));
        const created = await findCustomerRow(conn, id);
        if (!created) throw new Error("สมัครบัญชีลูกค้าไม่สำเร็จ");
        return created;
      });
    },
    async findCustomerById(id) {
      const [rows] = await pool.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [id]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToCustomer(list[0]!);
    },
    async findCustomerByPhone(phone) {
      const [rows] = await pool.query("SELECT * FROM customers WHERE phone = ? LIMIT 1", [phone]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToCustomer(list[0]!);
    },
    async listCustomers(q, limit) {
      const needle = q.trim();
      if (!needle) {
        const [rows] = await pool.query("SELECT * FROM customers ORDER BY created_at ASC LIMIT ?", [limit]);
        return (rows as Record<string, unknown>[]).map(rowToCustomer);
      }
      const like = `%${escapeLike(needle)}%`;
      const [rows] = await pool.query(
        "SELECT * FROM customers WHERE name LIKE ? ESCAPE '\\\\' OR phone LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\' ORDER BY created_at ASC LIMIT ?",
        [like, like, like, limit],
      );
      return (rows as Record<string, unknown>[]).map(rowToCustomer);
    },
    async updateCustomerProfile(id, patch, actor) {
      return withShopTx(async (conn) => {
        const current = await findCustomerRowForUpdate(conn, id);
        const name = patch.name !== undefined ? patch.name : current.name;
        let email = current.email;
        if (patch.email !== undefined) {
          if (patch.email) {
            const [dup] = (await conn.query("SELECT id FROM customers WHERE email = ? LIMIT 1", [patch.email])) as [
              Record<string, unknown>[],
              unknown,
            ];
            if (dup.length > 0 && String(dup[0]!["id"]) !== id) throw new ConflictError("อีเมลนี้ถูกใช้แล้ว");
          }
          email = patch.email;
        }
        await conn.query("UPDATE customers SET name = ?, email = ? WHERE id = ?", [name, email, id]);
        await insertAuditRow(conn, customerProfileUpdatedEvent(id, actor));
        const updated = await findCustomerRow(conn, id);
        if (!updated) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        return updated;
      });
    },
    async setCustomerPassword(id, passwordHash, actor) {
      return withShopTx(async (conn) => {
        const current = await findCustomerRowForUpdate(conn, id);
        if (!current.isActive) throw new ConflictError("บัญชีนี้ถูกปิดใช้งานแล้ว");
        await conn.query(
          "UPDATE customers SET password_hash = ?, password_version = password_version + 1 WHERE id = ?",
          [passwordHash, id],
        );
        await conn.query("DELETE FROM customer_sessions WHERE customer_id = ?", [id]);
        await insertAuditRow(conn, customerPasswordChangedEvent(id, actor));
        const updated = await findCustomerRow(conn, id);
        if (!updated) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        return updated;
      });
    },
    async setCustomerActive(id, active, actor) {
      return withShopTx(async (conn) => {
        await findCustomerRowForUpdate(conn, id);
        await conn.query("UPDATE customers SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
        if (!active) {
          await conn.query("DELETE FROM customer_sessions WHERE customer_id = ?", [id]);
          await insertAuditRow(conn, customerDeactivatedEvent(id, actor));
        } else {
          await insertAuditRow(conn, customerActivatedEvent(id, actor));
        }
        const updated = await findCustomerRow(conn, id);
        if (!updated) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        return updated;
      });
    },
    async deleteCustomer(id, actor) {
      return withShopTx(async (conn) => {
        await findCustomerRowForUpdate(conn, id);
        const deletedAt = toMysqlDatetime(new Date().toISOString());
        await conn.query(
          "UPDATE customers SET name = ?, phone = NULL, email = NULL, password_hash = 'deleted', is_active = 0, is_deleted = 1, deleted_at = ? WHERE id = ?",
          [DELETED_CUSTOMER_NAME, deletedAt, id],
        );
        await conn.query("DELETE FROM customer_sessions WHERE customer_id = ?", [id]);
        await conn.query("DELETE FROM customer_line_links WHERE customer_id = ?", [id]);
        await insertAuditRow(conn, customerDeletedEvent(id, actor));
        const updated = await findCustomerRow(conn, id);
        if (!updated) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        return updated;
      });
    },
    async createCustomerSession(customerId, passwordVersion) {
      const id = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      await pool.query("INSERT INTO customer_sessions (id, customer_id, password_version, expires_at) VALUES (?, ?, ?, ?)", [
        id,
        customerId,
        passwordVersion,
        expires,
      ]);
      const found = await mysqlStore.findCustomerSession(id);
      if (!found) throw new Error("สร้างเซสชันลูกค้าไม่สำเร็จ");
      return found;
    },
    async findCustomerSession(id) {
      const [rows] = await pool.query("SELECT * FROM customer_sessions WHERE id = ? LIMIT 1", [id]);
      const list = rows as Record<string, unknown>[];
      if (list.length === 0) return null;
      const r = list[0]!;
      return {
        id: String(r["id"]),
        customerId: String(r["customer_id"]),
        passwordVersion: Number(r["password_version"] ?? 1),
        createdAt: new Date(r["created_at"] as string).toISOString(),
        expiresAt: new Date(r["expires_at"] as string).toISOString(),
      };
    },
    async deleteCustomerSession(id) {
      await pool.query("DELETE FROM customer_sessions WHERE id = ?", [id]);
    },
    async deleteCustomerSessionsForCustomer(customerId) {
      await pool.query("DELETE FROM customer_sessions WHERE customer_id = ?", [customerId]);
    },
    async createLineTx(input) {
      try {
        await pool.query(
          "INSERT INTO customer_line_tx (state, customer_id, nonce, code_verifier, redirect_after, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          [input.state, input.customerId, input.nonce, input.codeVerifier, input.redirectAfter, toMysqlDatetime(input.expiresAt)],
        );
      } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
          throw new ConflictError("state นี้ถูกใช้แล้ว");
        }
        throw err;
      }
    },
    async consumeLineTx(state, now) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM customer_line_tx WHERE state = ? LIMIT 1 FOR UPDATE", [state])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) return null;
        const tx = rowToLineTx(rows[0]!);
        if (tx.usedAt !== null) return null;
        if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
        await conn.query("UPDATE customer_line_tx SET used_at = ? WHERE state = ?", [
          toMysqlDatetime(now.toISOString()),
          state,
        ]);
        return { ...tx, usedAt: now.toISOString() };
      });
    },
    async peekLineTx(state, now) {
      const [rows] = (await pool.query("SELECT * FROM customer_line_tx WHERE state = ? LIMIT 1", [state])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      const tx = rowToLineTx(rows[0]!);
      if (tx.usedAt !== null) return null;
      if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
      return tx;
    },
    async consumeLineTxWithAudit(state, now, actor, failureDetail) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM customer_line_tx WHERE state = ? LIMIT 1 FOR UPDATE", [state])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) return null;
        const tx = rowToLineTx(rows[0]!);
        if (tx.usedAt !== null) return null;
        if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
        await conn.query("UPDATE customer_line_tx SET used_at = ? WHERE state = ?", [
          toMysqlDatetime(now.toISOString()),
          state,
        ]);
        await insertAuditRow(conn, customerLineLinkFailedEvent(tx.customerId, failureDetail, actor));
        return { ...tx, usedAt: now.toISOString() };
      });
    },
    async getLineLink(customerId) {
      const [rows] = await pool.query("SELECT * FROM customer_line_links WHERE customer_id = ? LIMIT 1", [customerId]);
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToLineLink(list[0]!);
    },
    async findLineLinkBySubject(provider, subject) {
      const [rows] = await pool.query(
        "SELECT * FROM customer_line_links WHERE provider = ? AND provider_subject = ? LIMIT 1",
        [provider, subject],
      );
      const list = rows as Record<string, unknown>[];
      return list.length === 0 ? null : rowToLineLink(list[0]!);
    },
    async linkLineIdentity(customerId, input, actor) {
      return withShopTx(async (conn) => {
        await findCustomerRowForUpdate(conn, customerId);
        const [mine] = (await conn.query("SELECT customer_id FROM customer_line_links WHERE customer_id = ? LIMIT 1", [
          customerId,
        ])) as [Record<string, unknown>[], unknown];
        if (mine.length > 0) throw new ConflictError("บัญชีนี้เชื่อม LINE ไว้แล้ว");
        const [other] = (await conn.query(
          "SELECT customer_id FROM customer_line_links WHERE provider = 'line' AND provider_subject = ? LIMIT 1",
          [input.providerSubject],
        )) as [Record<string, unknown>[], unknown];
        if (other.length > 0) throw new ConflictError("LINE นี้ถูกเชื่อมกับบัญชีอื่นแล้ว");
        try {
          await conn.query(
            "INSERT INTO customer_line_links (customer_id, provider, provider_subject, display_name) VALUES (?, 'line', ?, ?)",
            [customerId, input.providerSubject, input.displayName ?? null],
          );
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("การเชื่อม LINE ขัดแย้งกัน กรุณาลองใหม่อีกครั้ง");
          }
          throw err;
        }
        await insertAuditRow(conn, customerLineLinkedEvent(customerId, actor));
        const [rows] = (await conn.query("SELECT * FROM customer_line_links WHERE customer_id = ? LIMIT 1", [
          customerId,
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new Error("เชื่อม LINE ไม่สำเร็จ");
        return rowToLineLink(rows[0]!);
      });
    },
    async linkLineIdentityWithConsume(state, now, input, actor) {
      return withShopTx(async (conn) => {
        const [txRows] = (await conn.query("SELECT * FROM customer_line_tx WHERE state = ? LIMIT 1 FOR UPDATE", [
          state,
        ])) as [Record<string, unknown>[], unknown];
        if (txRows.length === 0) return null;
        const tx = rowToLineTx(txRows[0]!);
        if (tx.usedAt !== null) return null;
        if (new Date(tx.expiresAt).getTime() <= now.getTime()) return null;
        await findCustomerRowForUpdate(conn, tx.customerId);
        const [mine] = (await conn.query("SELECT customer_id FROM customer_line_links WHERE customer_id = ? LIMIT 1", [
          tx.customerId,
        ])) as [Record<string, unknown>[], unknown];
        if (mine.length > 0) throw new ConflictError("บัญชีนี้เชื่อม LINE ไว้แล้ว");
        const [other] = (await conn.query(
          "SELECT customer_id FROM customer_line_links WHERE provider = 'line' AND provider_subject = ? LIMIT 1",
          [input.providerSubject],
        )) as [Record<string, unknown>[], unknown];
        if (other.length > 0) throw new ConflictError("LINE นี้ถูกเชื่อมกับบัญชีอื่นแล้ว");
        try {
          await conn.query(
            "INSERT INTO customer_line_links (customer_id, provider, provider_subject, display_name) VALUES (?, 'line', ?, ?)",
            [tx.customerId, input.providerSubject, input.displayName ?? null],
          );
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("การเชื่อม LINE ขัดแย้งกัน กรุณาลองใหม่อีกครั้ง");
          }
          throw err;
        }
        await conn.query("UPDATE customer_line_tx SET used_at = ? WHERE state = ?", [
          toMysqlDatetime(now.toISOString()),
          state,
        ]);
        await insertAuditRow(conn, customerLineLinkedEvent(tx.customerId, actor));
        const [rows] = (await conn.query("SELECT * FROM customer_line_links WHERE customer_id = ? LIMIT 1", [
          tx.customerId,
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new Error("เชื่อม LINE ไม่สำเร็จ");
        return { link: rowToLineLink(rows[0]!), tx: { ...tx, usedAt: now.toISOString() } };
      });
    },
    async unlinkLineIdentity(customerId, actor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM customer_line_links WHERE customer_id = ? LIMIT 1 FOR UPDATE", [
          customerId,
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("บัญชีนี้ยังไม่ได้เชื่อม LINE");
        await conn.query("DELETE FROM customer_line_links WHERE customer_id = ?", [customerId]);
        await insertAuditRow(conn, customerLineUnlinkedEvent(customerId, actor));
      });
    },
    // ---- P1 narrow atomic seams (route ต้องใช้ตัวนี้ — transaction เดียวกับ audit เสมอ) ----
    async registerCustomerWithSession(input, actor) {
      return withShopTx(async (conn) => {
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO customers (id, name, phone, email, password_hash, is_active, is_deleted) VALUES (?, ?, ?, ?, ?, 1, 0)",
            [id, input.name, input.phone, input.email, input.passwordHash],
          );
        } catch (err: unknown) {
          throw mapCustomerConflict(err);
        }
        await insertAuditRow(conn, customerRegisteredEvent(id, actor));
        const created = await findCustomerRow(conn, id);
        if (!created) throw new Error("สมัครบัญชีลูกค้าไม่สำเร็จ");
        const sid = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        const expires = new Date(Date.now() + SESSION_TTL_MS);
        await conn.query(
          "INSERT INTO customer_sessions (id, customer_id, password_version, expires_at) VALUES (?, ?, ?, ?)",
          [sid, id, created.passwordVersion, expires],
        );
        await insertAuditRow(conn, customerLoginSuccessEvent(id, actor));
        const [sRows] = (await conn.query("SELECT * FROM customer_sessions WHERE id = ? LIMIT 1", [sid])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (sRows.length === 0) throw new Error("สร้างเซสชันลูกค้าไม่สำเร็จ");
        const r = sRows[0]!;
        return {
          customer: created,
          session: {
            id: String(r["id"]),
            customerId: String(r["customer_id"]),
            passwordVersion: Number(r["password_version"] ?? 1),
            createdAt: new Date(r["created_at"] as string).toISOString(),
            expiresAt: new Date(r["expires_at"] as string).toISOString(),
          },
        };
      });
    },
    async createCustomerSessionWithAudit(customerId, passwordVersion, actor) {
      return withShopTx(async (conn) => {
        await findCustomerRowForUpdate(conn, customerId);
        const sid = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        const expires = new Date(Date.now() + SESSION_TTL_MS);
        await conn.query(
          "INSERT INTO customer_sessions (id, customer_id, password_version, expires_at) VALUES (?, ?, ?, ?)",
          [sid, customerId, passwordVersion, expires],
        );
        await insertAuditRow(conn, customerLoginSuccessEvent(customerId, actor));
        const [sRows] = (await conn.query("SELECT * FROM customer_sessions WHERE id = ? LIMIT 1", [sid])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (sRows.length === 0) throw new Error("สร้างเซสชันลูกค้าไม่สำเร็จ");
        const r = sRows[0]!;
        return {
          id: String(r["id"]),
          customerId: String(r["customer_id"]),
          passwordVersion: Number(r["password_version"] ?? 1),
          createdAt: new Date(r["created_at"] as string).toISOString(),
          expiresAt: new Date(r["expires_at"] as string).toISOString(),
        };
      });
    },
    async logoutCustomerSessionWithAudit(sessionId, customerId, actor) {
      return withShopTx(async (conn) => {
        // ลบเฉพาะ session ของบัญชีตัวเอง (idempotent — ไม่มีแถวก็ยังเขียน audit สำเร็จ)
        await conn.query("DELETE FROM customer_sessions WHERE id = ? AND customer_id = ?", [
          sessionId,
          customerId,
        ]);
        await insertAuditRow(conn, customerLogoutEvent(customerId, actor));
      });
    },
    async createLineLoginTxWithAudit(input, actor) {
      return withShopTx(async (conn) => {
        try {
          await conn.query(
            "INSERT INTO customer_line_tx (state, customer_id, nonce, code_verifier, redirect_after, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            [input.state, input.customerId, input.nonce, input.codeVerifier, input.redirectAfter, toMysqlDatetime(input.expiresAt)],
          );
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("state นี้ถูกใช้แล้ว");
          }
          throw err;
        }
        await insertAuditRow(conn, customerLineLinkStartedEvent(input.customerId, actor));
      });
    },
    // ---- Ticket 05 MySQL: คำสั่งซื้อพื้นฐาน (transaction เดียวกับ audit เสมอ) ----
    async createOrder(input: CreateOrderInput, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const shape = normalizeOrderShape(input, now);
        // เจ้าของคำสั่งซื้อ: สมาชิก (ตรวจตัวตนใช้งานได้) หรือ Guest (ชื่อ+เบอร์ normalize กฎ Ticket 03)
        let customerId: string | null = null;
        let guestName: string | null = null;
        let guestPhone: string | null = null;
        if (input.customerId) {
          if (input.guestName ?? input.guestPhone) {
            throw new ConflictError("ข้อมูลผู้สั่งไม่ถูกต้อง (ระบุทั้งสมาชิกและ Guest ไม่ได้)");
          }
          const c = await findCustomerRow(conn, input.customerId);
          if (!c || c.isDeleted || !c.isActive) {
            throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
          }
          customerId = c.id;
        } else {
          guestName = normalizeGuestName(input.guestName);
          guestPhone = normalizeThaiPhone(input.guestPhone ?? "");
          assertNormalizedPhone(guestPhone);
        }
        // ผูกโต๊ะ/รอบ (Ticket 06): รอบต้องเปิดอยู่ โต๊ะต้องตรงรอบ (ตรวจใน tx เดียวกัน)
        let linkTableId: string | null = null;
        let linkRoundId: string | null = null;
        if (shape.roundId !== null || shape.tableId !== null) {
          if (shape.roundId === null) {
            throw new ConflictError("กรุณาเช็กอินเพื่อเปิดรอบการใช้โต๊ะก่อนสั่งที่โต๊ะ");
          }
          if (shape.serviceType !== "dine_in") {
            throw new ConflictError("ผูกคำสั่งซื้อกับรอบโต๊ะได้เฉพาะแบบรับประทานที่ร้าน");
          }
          const [roundRows] = (await conn.query("SELECT * FROM table_rounds WHERE id = ? LIMIT 1", [shape.roundId])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (roundRows.length === 0) throw new NotFoundError("ไม่พบรอบการใช้โต๊ะ");
          const roundRow = roundRows[0]!;
          if (String(roundRow["status"]) !== "open") {
            throw new ConflictError("รอบการใช้โต๊ะนี้ปิดแล้ว ไม่รับคำสั่งซื้อใหม่");
          }
          const roundTableId = String(roundRow["table_id"]);
          if (shape.tableId !== null && shape.tableId !== roundTableId) {
            throw new ConflictError("โต๊ะไม่ตรงกับรอบการใช้โต๊ะที่เปิดอยู่");
          }
          linkTableId = roundTableId;
          linkRoundId = String(roundRow["id"]);
        }
        const hash = orderHashWithLinkageMysql({
          customerId,
          guestName,
          guestPhone,
          serviceType: shape.serviceType,
          scheduledAt: shape.scheduledAt,
          items: shape.lines,
        }, linkTableId, linkRoundId);
        // idempotency fast-path: key เดิม → คืนของเดิม (payload เดิม) หรือ 409 (payload ต่างกัน)
        const [idemRows] = (await conn.query("SELECT id, payload_hash FROM orders WHERE idempotency_key = ? LIMIT 1", [
          shape.idempotencyKey,
        ])) as [Record<string, unknown>[], unknown];
        if (idemRows.length > 0) {
          const storedHash = String(idemRows[0]!["payload_hash"]);
          // ยอมรับ hash สคีมาเดิม (ก่อน Ticket 06 ไม่มี linkage / ก่อน Ticket 07 ไม่มีตัวเลือก)
          // ด้วย กัน replay ของ key เก่าเพี้ยนเป็น 409
          const coreHash = orderCoreHashWithLinkageMysql({
            customerId,
            guestName,
            guestPhone,
            serviceType: shape.serviceType,
            scheduledAt: shape.scheduledAt,
            items: shape.lines,
          }, linkTableId, linkRoundId);
          const legacyHash = orderLegacyHashMysql({
            customerId,
            guestName,
            guestPhone,
            serviceType: shape.serviceType,
            scheduledAt: shape.scheduledAt,
            items: shape.lines,
          });
          if (storedHash !== hash && storedHash !== coreHash && storedHash !== legacyHash) {
            throw new ConflictError("คำขอนี้ถูกใช้ยืนยันไปแล้ว กรุณาสร้างตะกร้าใหม่");
          }
          const detail = await readOrderDetailTx(conn, String(idemRows[0]!["id"]));
          if (!detail) throw new Error("อ่านคำสั่งซื้อเดิมไม่สำเร็จ");
          return { order: detail, deduplicated: true };
        }
        // snapshot ราคา/ชื่อจากเมนูปัจจุบัน — เฉพาะเมนูพร้อมขายเท่านั้น
        // Ticket 07: ตรวจตัวเลือก (ต้องเป็นของเมนูนี้และเปิดขาย กลุ่มละ 1 ตัวเลือก)
        // ราคาต่อยูนิต = ราคาเมนู + Σ ส่วนต่างตัวเลือก
        const ids = [...new Set(shape.lines.map((l) => l.menuId))];
        const [menuRows] = (await conn.query(`SELECT * FROM menu_items WHERE id IN (${ids.map(() => "?").join(",")})`, ids)) as [
          Record<string, unknown>[],
          unknown,
        ];
        const menuById = new Map(menuRows.map((r) => rowToMenu(r)).map((m) => [m.id, m]));
        const [groupRows] = (await conn.query(`SELECT * FROM menu_option_groups WHERE menu_id IN (${ids.map(() => "?").join(",")})`, ids)) as [
          Record<string, unknown>[],
          unknown,
        ];
        const groupsByMenu = new Map<string, MenuOptionGroup[]>();
        for (const r of groupRows as Record<string, unknown>[]) {
          const g = rowToOptionGroup(r);
          const list = groupsByMenu.get(g.menuId) ?? [];
          list.push(g);
          groupsByMenu.set(g.menuId, list);
        }
        const groupIds = (groupRows as Record<string, unknown>[]).map((r) => String(r["id"]));
        const optionsById = new Map<string, MenuOption>();
        if (groupIds.length > 0) {
          const [optRows] = (await conn.query(`SELECT * FROM menu_options WHERE group_id IN (${groupIds.map(() => "?").join(",")})`, groupIds)) as [
            Record<string, unknown>[],
            unknown,
          ];
          for (const r of optRows as Record<string, unknown>[]) {
            const o = rowToMenuOption(r);
            optionsById.set(o.id, o);
          }
        }
        const snapshot = shape.lines.map((line) => {
          const menu = menuById.get(line.menuId);
          if (!menu || !isMenuSellable(menu)) {
            throw new ConflictError(
              `เมนู${menu ? ` "${menu.name}"` : ""} ไม่พร้อมขายแล้ว กรุณาปรับตะกร้าแล้วยืนยันใหม่อีกครั้ง`,
            );
          }
          const optionIds = normalizeSelectedOptionIds(line.optionIds ?? []);
          const specialRequest = normalizeSpecialRequest(line.specialRequest);
          const snapshots: OrderItemOptionSnapshot[] = [];
          let deltaSum = 0;
          if (optionIds.length > 0) {
            const groupById = new Map((groupsByMenu.get(menu.id) ?? []).map((g) => [g.id, g]));
            const seenGroups = new Set<string>();
            for (const optionId of optionIds) {
              const opt = optionsById.get(optionId);
              if (!opt || opt.menuId !== menu.id) {
                throw new ConflictError(`ตัวเลือกของเมนู "${menu.name}" ไม่ถูกต้อง กรุณาเลือกใหม่`);
              }
              const group = groupById.get(opt.groupId);
              if (!group) throw new ConflictError(`ตัวเลือกของเมนู "${menu.name}" ไม่ถูกต้อง กรุณาเลือกใหม่`);
              if (!opt.isEnabled) {
                throw new ConflictError(`ตัวเลือก "${opt.name}" ปิดขายแล้ว กรุณาเลือกใหม่`);
              }
              if (seenGroups.has(opt.groupId)) {
                throw new ConflictError(`กลุ่ม "${group.name}" เลือกได้เพียง 1 ตัวเลือกต่อรายการ`);
              }
              seenGroups.add(opt.groupId);
              snapshots.push({
                groupId: group.id,
                groupName: group.name,
                optionId: opt.id,
                optionName: opt.name,
                priceDelta: opt.priceDelta,
              });
              deltaSum = roundBaht(deltaSum + opt.priceDelta);
            }
          }
          return {
            name: menu.name,
            price: roundBaht(menu.price + deltaSum),
            menuId: menu.id,
            quantity: line.quantity,
            note: line.note,
            options: snapshots,
            specialRequest,
          };
        });
        const subtotal = roundBaht(snapshot.reduce((s, l) => s + l.price * l.quantity, 0));
        // Ticket 07: รวมความต้องการวัตถุดิบจากสูตรล่าสุด (ฐานเมนู + ตัวเลือก) แล้วจองแบบ atomic
        // ล็อกแถววัตถุดิบ (FOR UPDATE) กัน concurrent แย่งชิ้นสุดท้ายข้าม process
        const required = new Map<string, number>();
        const unitCosts = new Map<string, number>();
        const needIngredientIds = new Set<string>();
        const recipeCache = new Map<string, Recipe | null>();
        const latestCached = async (t: RecipeTargetType, tid: string): Promise<Recipe | null> => {
          const key = `${t}:${tid}`;
          if (!recipeCache.has(key)) recipeCache.set(key, await readLatestRecipeTx(conn, t, tid));
          return recipeCache.get(key)!;
        };
        const lineCacheKey = (s: { menuId: string; options: { optionId: string }[] }): string =>
          `${s.menuId}|${s.options.map((o) => o.optionId).sort().join(",")}`;
        const recipesOfLine = async (s: { menuId: string; options: { optionId: string }[] }): Promise<Recipe[]> => {
          const out: Recipe[] = [];
          const menuRecipe = await latestCached("menu", s.menuId);
          if (menuRecipe) out.push(menuRecipe);
          for (const sel of s.options) {
            const r = await latestCached("option", sel.optionId);
            if (r) out.push(r);
          }
          return out;
        };
        for (const s of snapshot) {
          for (const recipe of await recipesOfLine(s)) {
            for (const rl of recipe.lines) {
              needIngredientIds.add(rl.ingredientId);
              required.set(rl.ingredientId, roundStock((required.get(rl.ingredientId) ?? 0) + rl.qty * s.quantity));
            }
          }
        }
        // ล็อก + ตรวจวัตถุดิบ แล้วคำนวณต้นทุนประมาณการต่อหน่วยจากทุนล่าสุด
        const lockedIngredients = new Map<string, Ingredient>();
        if (needIngredientIds.size > 0) {
          const ingIds = [...needIngredientIds];
          const [ingRows] = (await conn.query(`SELECT * FROM ingredients WHERE id IN (${ingIds.map(() => "?").join(",")}) FOR UPDATE`, ingIds)) as [
            Record<string, unknown>[],
            unknown,
          ];
          for (const r of ingRows as Record<string, unknown>[]) {
            const ing = rowToIngredient(r);
            lockedIngredients.set(ing.id, ing);
          }
          for (const ingId of ingIds) {
            const ing = lockedIngredients.get(ingId);
            if (!ing) throw new ConflictError("สูตรอ้างอิงวัตถุดิบที่ไม่พบ กรุณาติดต่อ Admin");
            if (!ing.isEnabled) {
              throw new ConflictError(
                `วัตถุดิบ "${ing.name}" งดใช้ชั่วคราว ทำให้เมนูบางรายการสั่งไม่ได้ กรุณาปรับรายการแล้วยืนยันใหม่อีกครั้ง`,
              );
            }
          }
          // คำนวณต้นทุนต่อหน่วยย้อนหลังเมื่อรู้ทุนล่าสุดแล้ว
          for (const s of snapshot) {
            const cacheKey = lineCacheKey(s);
            let unitCost = 0;
            for (const recipe of await recipesOfLine(s)) {
              for (const rl of recipe.lines) {
                const ing = lockedIngredients.get(rl.ingredientId)!;
                unitCost = roundBaht(unitCost + roundBaht(rl.qty * ing.latestCost));
              }
            }
            unitCosts.set(cacheKey, unitCost);
          }
          // ตรวจพร้อมขายทุกวัตถุดิบก่อนจอง (กันขายเกิน — ห้ามพร้อมขายติดลบ)
          for (const [ingId, qty] of required) {
            const ing = lockedIngredients.get(ingId)!;
            assertAvailableStock(ing.name, ing.unit, ing.onHand, ing.reserved, qty);
          }
        }
        const estimatedCost = roundBaht(
          snapshot.reduce(
            (sum, s) => sum + (unitCosts.get(lineCacheKey(s)) ?? 0) * s.quantity,
            0,
          ),
        );
        const hasReservation = required.size > 0;
        // กันเลขคำสั่งซื้อชน (unique index + retry) และกัน key แข่งกัน (re-read + เทียบ hash)
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const orderNumber = generateOrderNumber(now);
          const id = randomUUID();
          try {
            await conn.query(
              "INSERT INTO orders (id, order_number, customer_id, guest_name, guest_phone, channel, service_type, status, subtotal, total, scheduled_at, table_id, round_id, idempotency_key, payload_hash, stock_reserved, stock_consumed, estimated_cost) VALUES (?, ?, ?, ?, ?, 'web', ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
              [
                id,
                orderNumber,
                customerId,
                guestName,
                guestPhone,
                shape.serviceType,
                subtotal,
                subtotal,
                shape.scheduledAt ? toMysqlDatetime(shape.scheduledAt) : null,
                linkTableId,
                linkRoundId,
                shape.idempotencyKey,
                hash,
                hasReservation ? 1 : 0,
                estimatedCost,
              ],
            );
          } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
              const which = dupOrderKeyName(err);
              if (which === "number") continue; // เลขชน — สุ่มใหม่
              // key ชนกันข้าม request (แข่งกัน insert) — อ่านของที่ชนะแล้วเทียบ hash
              const [reread] = (await conn.query("SELECT id, payload_hash FROM orders WHERE idempotency_key = ? LIMIT 1", [
                shape.idempotencyKey,
              ])) as [Record<string, unknown>[], unknown];
              if (reread.length === 0) continue;
              if (String(reread[0]!["payload_hash"]) !== hash) {
                throw new ConflictError("คำขอนี้ถูกใช้ยืนยันไปแล้ว กรุณาสร้างตะกร้าใหม่");
              }
              const detail = await readOrderDetailTx(conn, String(reread[0]!["id"]));
              if (!detail) throw new Error("อ่านคำสั่งซื้อเดิมไม่สำเร็จ");
              return { order: detail, deduplicated: true };
            }
            throw err;
          }
          for (const s of snapshot) {
            const cacheKey = lineCacheKey(s);
            await conn.query(
              "INSERT INTO order_items (id, order_id, menu_id, menu_name, unit_price, quantity, line_total, note, special_request, options_snapshot, estimated_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)",
              [
                randomUUID(), id, s.menuId, s.name, s.price, s.quantity, roundBaht(s.price * s.quantity), s.note,
                s.specialRequest, JSON.stringify(s.options),
                roundBaht((unitCosts.get(cacheKey) ?? 0) * s.quantity),
              ],
            );
          }
          // จองสต๊อก (แถวถูกล็อกแล้วใน tx นี้ — อัปเดตยอดจอง + ledger + ตาราง usage)
          if (hasReservation) {
            for (const [ingId, qty] of required) {
              const ing = lockedIngredients.get(ingId)!;
              const beforeReserved = ing.reserved;
              const afterReserved = roundStock(beforeReserved + qty);
              await conn.query("UPDATE ingredients SET reserved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [afterReserved, ingId]);
              await conn.query(
                "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'reserve', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  randomUUID(), ingId, qty, ing.onHand, ing.onHand, beforeReserved, afterReserved,
                  `จองสต๊อกให้คำสั่งซื้อ ${orderNumber}`,
                  actor.actorId ?? null, actor.actorUsername ?? null, id, orderNumber,
                ],
              );
              await conn.query(
                "INSERT INTO order_stock_usage (order_id, ingredient_id, qty) VALUES (?, ?, ?)",
                [id, ingId, qty],
              );
            }
          }
          await insertAuditRow(conn, orderCreatedEvent((await readOrderDetailTx(conn, id))!, actor));
          if (hasReservation) {
            const created = await readOrderDetailTx(conn, id);
            await insertAuditRow(conn, orderStockReservedEvent(orderNumber, id, required.size, actor));
            if (!created) throw new Error("สร้างคำสั่งซื้อไม่สำเร็จ");
            return { order: created, deduplicated: false };
          }
          const detail = await readOrderDetailTx(conn, id);
          if (!detail) throw new Error("สร้างคำสั่งซื้อไม่สำเร็จ");
          return { order: detail, deduplicated: false };
        }
        throw new ConflictError("สร้างเลขคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      });
    },

    async getOrder(id: string) {
      const [oRows] = (await pool.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (oRows.length === 0) return null;
      const [iRows] = (await pool.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY menu_name ASC", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      const order = rowToOrder(oRows[0]!);
      return { ...order, items: (iRows as Record<string, unknown>[]).map(rowToOrderItem) };
    },

    async getOrderByNumber(orderNumber: string) {
      const [oRows] = (await pool.query("SELECT * FROM orders WHERE order_number = ? LIMIT 1", [orderNumber.trim()])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (oRows.length === 0) return null;
      return mysqlStore.getOrder(String(oRows[0]!["id"]));
    },

    async findOrderByIdempotencyKey(key: string) {
      const [oRows] = (await pool.query("SELECT * FROM orders WHERE idempotency_key = ? LIMIT 1", [key])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (oRows.length === 0) return null;
      return mysqlStore.getOrder(String(oRows[0]!["id"]));
    },

    async listCustomerOrders(customerId: string, limit = 50) {
      const n = Math.min(Math.max(limit, 1), 200);
      const [oRows] = (await pool.query("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?", [
        customerId,
        n,
      ])) as [Record<string, unknown>[], unknown];
      return readOrdersWithItems(oRows as Record<string, unknown>[]);
    },

    async listOrders(filter: ListOrdersFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const needle = (filter.q ?? "").trim();
      const params: unknown[] = [];
      let sql = "SELECT * FROM orders";
      const where: string[] = [];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (needle) {
        const like = `%${escapeLike(needle)}%`;
        where.push("(order_number LIKE ? ESCAPE '\\\\' OR guest_name LIKE ? ESCAPE '\\\\' OR guest_phone LIKE ? ESCAPE '\\\\')");
        params.push(like, like, like);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(n);
      const [oRows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return readOrdersWithItems(oRows as Record<string, unknown>[]);
    },

    async updateOrderStatus(id: string, patch: { status: OrderStatus; reason: string }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const current = rowToOrder(oRows[0]!);
        const reason = normalizeStatusReason(patch.reason);
        if (patch.status !== "completed" && patch.status !== "cancelled") {
          throw new ConflictError("สถานะคำสั่งซื้อไม่ถูกต้อง");
        }
        assertOrderStatusTransition(current.status, patch.status);
        const before = { status: current.status, total: current.total };
        await conn.query("UPDATE orders SET status = ? WHERE id = ?", [patch.status, id]);
        // Ticket 07: ยกเลิกก่อนเริ่มทำ → คืนยอดจอง (ตัดจริงแล้วไม่คืน — ของใช้ไปแล้ว)
        if (patch.status === "cancelled" && current.stockReserved && !current.stockConsumed) {
          const [useRows] = (await conn.query("SELECT ingredient_id, qty FROM order_stock_usage WHERE order_id = ?", [id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          for (const u of useRows as Record<string, unknown>[]) {
            const ingId = String(u["ingredient_id"]);
            const qty = Number(u["qty"]);
            const [ingRows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [ingId])) as [
              Record<string, unknown>[],
              unknown,
            ];
            if (ingRows.length === 0) continue;
            const ing = rowToIngredient(ingRows[0]!);
            const afterReserved = roundStock(Math.max(0, ing.reserved - qty));
            await conn.query("UPDATE ingredients SET reserved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [afterReserved, ingId]);
            await conn.query(
              "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'release', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                randomUUID(), ingId, -qty, ing.onHand, ing.onHand, ing.reserved, afterReserved,
                `คืนยอดจองของคำสั่งซื้อ ${current.orderNumber}: ${reason}`,
                actor.actorId ?? null, actor.actorUsername ?? null, id, current.orderNumber,
              ],
            );
          }
        }
        const after = await readOrderDetailTx(conn, id);
        if (!after) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        await insertAuditRow(conn, orderStatusChangedEvent(before, after, reason, actor));
        if (patch.status === "cancelled" && current.stockReserved && !current.stockConsumed) {
          await insertAuditRow(conn, orderStockReleasedEvent(after.orderNumber, after.id, reason, actor));
        }
        // Ticket 10: ปิดงาน completed เข้าเงื่อนไขสะสมคะแนนส่วนที่เหลือ (exactly-once)
        if (patch.status === "completed") {
          await tryAutoEarnTx(conn, id, actor, new Date());
        }
        return after;
      });
    },
    // ---- Ticket 07 MySQL: ตัวเลือกเมนู/วัตถุดิบ/สูตร/สต๊อก (transaction เดียวกับ audit เสมอ) ----
    async createMenuOptionGroup(menuId: string, input: { name: string; sortOrder?: number }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [menuRows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [menuId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (menuRows.length === 0) throw new NotFoundError("ไม่พบเมนู");
        const menu = rowToMenu(menuRows[0]!);
        if (menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        const name = normalizeOptionGroupName(input.name);
        const sortOrder = normalizeOptionSortOrder(input.sortOrder ?? 0);
        const id = randomUUID();
        try {
          await conn.query("INSERT INTO menu_option_groups (id, menu_id, name, sort_order) VALUES (?, ?, ?, ?)", [id, menuId, name, sortOrder]);
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        const [rows] = (await conn.query("SELECT * FROM menu_option_groups WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const group = rowToOptionGroup(rows[0]!);
        await insertAuditRow(conn, optionGroupCreatedEvent(group, menu.name, actor));
        return group;
      });
    },
    async listMenuOptionGroups(menuId: string) {
      const [rows] = (await pool.query("SELECT * FROM menu_option_groups WHERE menu_id = ? ORDER BY sort_order ASC, name ASC", [menuId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToOptionGroup);
    },
    async updateMenuOptionGroup(id: string, patch: { name?: string; sortOrder?: number }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM menu_option_groups WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบกลุ่มตัวเลือก");
        const before = rowToOptionGroup(rows[0]!);
        const name = patch.name !== undefined ? normalizeOptionGroupName(patch.name) : before.name;
        const sortOrder = patch.sortOrder !== undefined ? normalizeOptionSortOrder(patch.sortOrder) : before.sortOrder;
        try {
          await conn.query("UPDATE menu_option_groups SET name = ?, sort_order = ? WHERE id = ?", [name, sortOrder, id]);
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        const [after] = (await conn.query("SELECT * FROM menu_option_groups WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const updated = rowToOptionGroup(after[0]!);
        await insertAuditRow(conn, optionGroupUpdatedEvent(before, updated, actor));
        return updated;
      });
    },
    async createMenuOption(groupId: string, input: { name: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [gRows] = (await conn.query("SELECT * FROM menu_option_groups WHERE id = ? LIMIT 1", [groupId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (gRows.length === 0) throw new NotFoundError("ไม่พบกลุ่มตัวเลือก");
        const group = rowToOptionGroup(gRows[0]!);
        const [menuRows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [group.menuId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (menuRows.length === 0) throw new NotFoundError("ไม่พบเมนู");
        if (rowToMenu(menuRows[0]!).isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        const name = normalizeOptionName(input.name);
        const priceDelta = normalizePriceDelta(input.priceDelta ?? 0);
        const isEnabled = input.isEnabled === undefined ? true : normalizeEnabled(input.isEnabled);
        const sortOrder = normalizeOptionSortOrder(input.sortOrder ?? 0);
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO menu_options (id, group_id, menu_id, name, price_delta, is_enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [id, groupId, group.menuId, name, priceDelta, isEnabled ? 1 : 0, sortOrder],
          );
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        const [rows] = (await conn.query("SELECT * FROM menu_options WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const option = rowToMenuOption(rows[0]!);
        await insertAuditRow(conn, optionCreatedEvent(option, group.name, actor));
        return option;
      });
    },
    async updateMenuOption(id: string, patch: { name?: string; priceDelta?: number; isEnabled?: boolean; sortOrder?: number }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM menu_options WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบตัวเลือก");
        const before = rowToMenuOption(rows[0]!);
        const [menuRows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [before.menuId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (menuRows.length === 0 || rowToMenu(menuRows[0]!).isArchived) {
          throw new ConflictError("เมนูนี้ถูก archive แล้ว จัดการตัวเลือกต่อไม่ได้");
        }
        const name = patch.name !== undefined ? normalizeOptionName(patch.name) : before.name;
        const priceDelta = patch.priceDelta !== undefined ? normalizePriceDelta(patch.priceDelta) : before.priceDelta;
        const isEnabled = patch.isEnabled !== undefined ? normalizeEnabled(patch.isEnabled) : before.isEnabled;
        const sortOrder = patch.sortOrder !== undefined ? normalizeOptionSortOrder(patch.sortOrder) : before.sortOrder;
        try {
          await conn.query("UPDATE menu_options SET name = ?, price_delta = ?, is_enabled = ?, sort_order = ? WHERE id = ?", [
            name, priceDelta, isEnabled ? 1 : 0, sortOrder, id,
          ]);
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        const [after] = (await conn.query("SELECT * FROM menu_options WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const updated = rowToMenuOption(after[0]!);
        const keys = Object.keys(patch);
        await insertAuditRow(
          conn,
          keys.length === 1 && keys[0] === "isEnabled"
            ? optionStatusChangedEvent(before, updated, actor)
            : optionUpdatedEvent(before, updated, actor),
        );
        return updated;
      });
    },
    async listMenuOptions(menuId: string) {
      const [rows] = (await pool.query("SELECT * FROM menu_options WHERE menu_id = ? ORDER BY sort_order ASC, name ASC", [menuId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToMenuOption);
    },
    async listPublicMenuWithOptions() {
      const [menuRows] = (await pool.query(
        "SELECT * FROM menu_items WHERE status = 'available' AND is_archived = 0 ORDER BY category ASC, sort_order ASC, name ASC",
      )) as [Record<string, unknown>[], unknown];
      const menus = (menuRows as Record<string, unknown>[]).map(rowToMenu);
      if (menus.length === 0) return [];
      const menuIds = menus.map((m) => m.id);
      const [groupRows] = (await pool.query(
        `SELECT * FROM menu_option_groups WHERE menu_id IN (${menuIds.map(() => "?").join(",")}) ORDER BY sort_order ASC, name ASC`,
        menuIds,
      )) as [Record<string, unknown>[], unknown];
      const groups = (groupRows as Record<string, unknown>[]).map(rowToOptionGroup);
      const groupIds = groups.map((g) => g.id);
      const enabledOptions = new Map<string, MenuOption[]>();
      if (groupIds.length > 0) {
        const [optRows] = (await pool.query(
          `SELECT * FROM menu_options WHERE group_id IN (${groupIds.map(() => "?").join(",")}) AND is_enabled = 1 ORDER BY sort_order ASC, name ASC`,
          groupIds,
        )) as [Record<string, unknown>[], unknown];
        for (const r of optRows as Record<string, unknown>[]) {
          const o = rowToMenuOption(r);
          const list = enabledOptions.get(o.groupId) ?? [];
          list.push(o);
          enabledOptions.set(o.groupId, list);
        }
      }
      // สถานะพร้อมขายจากสต๊อก (สูตรฐานล่าสุด — ไม่มีสูตรถือว่าพร้อมขาย)
      const out: PublicMenuItemWithOptions[] = [];
      for (const m of menus) {
        const optionGroups: PublicMenuOptionGroup[] = groups
          .filter((g) => g.menuId === m.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            sortOrder: g.sortOrder,
            options: (enabledOptions.get(g.id) ?? []).map((o) => ({
              id: o.id, name: o.name, priceDelta: o.priceDelta, sortOrder: o.sortOrder,
            })),
          }))
          .filter((g) => g.options.length > 0);
        const latest = await readLatestRecipeTx(pool, "menu", m.id);
        let inStock = true;
        if (latest) {
          for (const line of latest.lines) {
            const [ingRows] = (await pool.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [line.ingredientId])) as [
              Record<string, unknown>[],
              unknown,
            ];
            if (ingRows.length === 0) {
              inStock = false;
              break;
            }
            const ing = rowToIngredient(ingRows[0]!);
            if (!ing.isEnabled || roundStock(ing.onHand - ing.reserved) < roundStock(line.qty)) {
              inStock = false;
              break;
            }
          }
        }
        out.push({
          id: m.id, category: m.category, name: m.name, description: m.description,
          imageUrl: m.imageUrl, price: m.price, kind: m.kind, sortOrder: m.sortOrder,
          optionGroups, inStock,
        });
      }
      return out;
    },
    async createIngredient(input: { name: string; unit: string; reorderThreshold?: number; latestCost?: number; initialOnHand?: number }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const name = normalizeIngredientName(input.name);
        const unit = normalizeIngredientUnit(input.unit);
        const reorderThreshold = normalizeReorderThreshold(input.reorderThreshold ?? 0);
        const latestCost = normalizeLatestCost(input.latestCost ?? 0);
        const initialOnHand = normalizeStockQty(input.initialOnHand ?? 0, "ยอดเริ่มต้น");
        const id = randomUUID();
        try {
          await conn.query(
            "INSERT INTO ingredients (id, name, unit, on_hand, reserved, reorder_threshold, latest_cost, is_enabled) VALUES (?, ?, ?, ?, 0, ?, ?, 1)",
            [id, name, unit, initialOnHand, reorderThreshold, latestCost],
          );
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        if (initialOnHand > 0) {
          await conn.query(
            "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'receive', ?, 0, 0, ?, 0, 0, 'ยอดเริ่มต้น', ?, ?, NULL, NULL)",
            [randomUUID(), id, initialOnHand, initialOnHand, actor.actorId ?? null, actor.actorUsername ?? null],
          );
        }
        const [rows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const ing = rowToIngredient(rows[0]!);
        await insertAuditRow(conn, ingredientCreatedEvent(ing, actor));
        return ing;
      });
    },
    async listIngredients(options?: { includeDisabled?: boolean }) {
      const includeDisabled = options?.includeDisabled ?? false;
      const [rows] = (await pool.query(
        includeDisabled ? "SELECT * FROM ingredients ORDER BY name ASC" : "SELECT * FROM ingredients WHERE is_enabled = 1 ORDER BY name ASC",
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToIngredient);
    },
    async getIngredient(id: string) {
      const [rows] = (await pool.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return rows.length === 0 ? null : rowToIngredient(rows[0]!);
    },
    async updateIngredient(id: string, patch: { name?: string; reorderThreshold?: number; latestCost?: number; isEnabled?: boolean }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบวัตถุดิบ");
        const before = rowToIngredient(rows[0]!);
        const name = patch.name !== undefined ? normalizeIngredientName(patch.name) : before.name;
        const reorderThreshold =
          patch.reorderThreshold !== undefined ? normalizeReorderThreshold(patch.reorderThreshold) : before.reorderThreshold;
        const latestCost = patch.latestCost !== undefined ? normalizeLatestCost(patch.latestCost) : before.latestCost;
        const isEnabled = patch.isEnabled !== undefined ? normalizeEnabled(patch.isEnabled) : before.isEnabled;
        try {
          await conn.query("UPDATE ingredients SET name = ?, reorder_threshold = ?, latest_cost = ?, is_enabled = ? WHERE id = ?", [
            name, reorderThreshold, latestCost, isEnabled ? 1 : 0, id,
          ]);
        } catch (err: unknown) {
          throw mapInventoryConflict(err);
        }
        const [after] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const updated = rowToIngredient(after[0]!);
        const keys = Object.keys(patch);
        await insertAuditRow(
          conn,
          keys.length === 1 && keys[0] === "isEnabled"
            ? ingredientStatusChangedEvent(before, updated, actor)
            : ingredientUpdatedEvent(before, updated, actor),
        );
        return updated;
      });
    },
    async recordStockMovement(ingredientId: string, input: { op: ManualStockOp; qty: number; reason: string; reference?: string | null }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [ingredientId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบวัตถุดิบ");
        const ing = rowToIngredient(rows[0]!);
        const op = normalizeManualStockOp(input.op);
        const qty = normalizeMovementQty(input.qty);
        const reason = normalizeStockReason(input.reason);
        const reference = normalizeStockReference(input.reference ?? null);
        const beforeOnHand = ing.onHand;
        const beforeReserved = ing.reserved;
        let deltaOnHand = 0;
        let afterOnHand = beforeOnHand;
        if (op === "receive" || op === "return") {
          afterOnHand = roundStock(beforeOnHand + qty);
          deltaOnHand = qty;
        } else if (op === "waste" || op === "expire" || op === "personal_use") {
          if (roundStock(beforeOnHand - qty) < beforeReserved) {
            throw new ConflictError(
              `คงเหลือไม่พอ (มี ${beforeOnHand} ${ing.unit} แต่จองให้คำสั่งซื้อแล้ว ${beforeReserved} ${ing.unit})`,
            );
          }
          afterOnHand = roundStock(beforeOnHand - qty);
          deltaOnHand = -qty;
        } else {
          if (roundStock(beforeOnHand + qty) < 0 || roundStock(beforeOnHand + qty) < beforeReserved) {
            throw new ConflictError(
              `ปรับยอดไม่ได้ (คงเหลือ ${beforeOnHand} ${ing.unit} จองแล้ว ${beforeReserved} ${ing.unit})`,
            );
          }
          afterOnHand = roundStock(beforeOnHand + qty);
          deltaOnHand = qty;
        }
        await conn.query("UPDATE ingredients SET on_hand = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [afterOnHand, ingredientId]);
        const entry = await insertLedgerRow(conn, {
          ingredientId, op, deltaOnHand, deltaReserved: 0,
          beforeOnHand, afterOnHand, beforeReserved, afterReserved: beforeReserved,
          reason, actorId: actor.actorId ?? null, actorUsername: actor.actorUsername ?? null,
          orderId: null, reference,
        });
        await insertAuditRow(conn, stockUpdatedEvent(entry, ing.name, ing.unit, actor));
        const [after] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1", [ingredientId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        return { ingredient: rowToIngredient(after[0]!), entry };
      });
    },
    async listStockLedger(filter: { ingredientId?: string; orderId?: string; op?: StockOp; limit: number }) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.ingredientId) {
        where.push("ingredient_id = ?");
        params.push(filter.ingredientId);
      }
      if (filter.orderId) {
        where.push("order_id = ?");
        params.push(filter.orderId);
      }
      if (filter.op) {
        where.push("op = ?");
        params.push(filter.op);
      }
      const sql = `SELECT * FROM stock_ledger${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
      params.push(limit);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToStockLedger);
    },
    async createRecipe(input: { targetType: RecipeTargetType; targetId: string; lines: RecipeLine[] }, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const lines = normalizeRecipeLines(input.lines);
        const targetId = normalizeTargetId(input.targetId);
        let targetName = "";
        if (input.targetType === "menu") {
          const [menuRows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [targetId])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (menuRows.length === 0) throw new NotFoundError("ไม่พบเมนูเป้าหมายของสูตร");
          targetName = rowToMenu(menuRows[0]!).name;
        } else if (input.targetType === "option") {
          const [optRows] = (await conn.query("SELECT * FROM menu_options WHERE id = ? LIMIT 1", [targetId])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (optRows.length === 0) throw new NotFoundError("ไม่พบตัวเลือกเป้าหมายของสูตร");
          targetName = rowToMenuOption(optRows[0]!).name;
        } else {
          throw new Error("เป้าหมายสูตรต้องเป็น เมนู หรือ ตัวเลือก");
        }
        const ingIds = [...new Set(lines.map((l) => l.ingredientId))];
        const [ingRows] = (await conn.query(`SELECT * FROM ingredients WHERE id IN (${ingIds.map(() => "?").join(",")})`, ingIds)) as [
          Record<string, unknown>[],
          unknown,
        ];
        const ingById = new Map((ingRows as Record<string, unknown>[]).map(rowToIngredient).map((g) => [g.id, g]));
        for (const line of lines) {
          const ing = ingById.get(line.ingredientId);
          if (!ing) throw new NotFoundError("สูตรอ้างอิงวัตถุดิบที่ไม่พบ");
          if (!ing.isEnabled) throw new ConflictError(`วัตถุดิบ "${ing.name}" งดใช้อยู่ ใช้ในสูตรไม่ได้`);
        }
        const [vRows] = (await conn.query(
          "SELECT COALESCE(MAX(version), 0) AS v FROM recipes WHERE target_type = ? AND target_id = ?",
          [input.targetType, targetId],
        )) as [Record<string, unknown>[], unknown];
        const version = Number((vRows as Record<string, unknown>[])[0]!["v"]) + 1;
        let estimated = 0;
        for (const line of lines) {
          const ing = ingById.get(line.ingredientId)!;
          estimated = roundBaht(estimated + roundBaht(line.qty * ing.latestCost));
        }
        const id = randomUUID();
        await conn.query(
          "INSERT INTO recipes (id, target_type, target_id, version, estimated_cost, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          [id, input.targetType, targetId, version, estimated, actor.actorUsername ?? actor.actorId ?? null],
        );
        for (const line of lines) {
          await conn.query("INSERT INTO recipe_lines (id, recipe_id, ingredient_id, qty) VALUES (?, ?, ?, ?)", [
            randomUUID(), id, line.ingredientId, line.qty,
          ]);
        }
        const recipe = await readRecipeWithLines(conn, { id, target_type: input.targetType, target_id: targetId, version, estimated_cost: estimated, created_by: actor.actorUsername ?? actor.actorId ?? null, created_at: new Date().toISOString() });
        await insertAuditRow(conn, recipeCreatedEvent(recipe, targetName, actor));
        return recipe;
      });
    },
    async listRecipes(targetType: RecipeTargetType, targetId: string) {
      const [rows] = (await pool.query(
        "SELECT * FROM recipes WHERE target_type = ? AND target_id = ? ORDER BY version ASC",
        [targetType, targetId],
      )) as [Record<string, unknown>[], unknown];
      const out: Recipe[] = [];
      for (const r of rows as Record<string, unknown>[]) {
        out.push(await readRecipeWithLines(pool, r));
      }
      return out;
    },
    async getLatestRecipe(targetType: RecipeTargetType, targetId: string) {
      return readLatestRecipeTx(pool, targetType, targetId);
    },
    async consumeOrderStock(id: string, actor: ShopActor) {
      return withShopTx(async (conn) => {
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const current = rowToOrder(oRows[0]!);
        if (current.status === "cancelled") {
          throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว ตัดสต๊อกไม่ได้");
        }
        if (!current.stockReserved) {
          throw new ConflictError("คำสั่งซื้อนี้ไม่มีการจองสต๊อก (ไม่มีสูตร) ตัดสต๊อกไม่ได้");
        }
        const detail0 = await readOrderDetailTx(conn, id);
        if (!detail0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        // ตัดแล้วเรียกซ้ำเป็น no-op (ไม่เขียน ledger/audit ซ้ำ — กัน event ซ้ำ)
        if (current.stockConsumed) {
          return { order: detail0, deduplicated: true };
        }
        const [useRows] = (await conn.query("SELECT ingredient_id, qty FROM order_stock_usage WHERE order_id = ?", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        for (const u of useRows as Record<string, unknown>[]) {
          const ingId = String(u["ingredient_id"]);
          const qty = Number(u["qty"]);
          const [ingRows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [ingId])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (ingRows.length === 0) continue;
          const ing = rowToIngredient(ingRows[0]!);
          const afterReserved = roundStock(Math.max(0, ing.reserved - qty));
          const afterOnHand = roundStock(ing.onHand - qty);
          await conn.query("UPDATE ingredients SET on_hand = ?, reserved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
            afterOnHand, afterReserved, ingId,
          ]);
          await conn.query(
            "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'consume', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              randomUUID(), ingId, -qty, -qty, ing.onHand, afterOnHand, ing.reserved, afterReserved,
              `ตัดใช้จริงให้คำสั่งซื้อ ${current.orderNumber} เมื่อเริ่มทำ`,
              actor.actorId ?? null, actor.actorUsername ?? null, id, current.orderNumber,
            ],
          );
        }
        await conn.query("UPDATE orders SET stock_consumed = 1 WHERE id = ?", [id]);
        const detail = await readOrderDetailTx(conn, id);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        await insertAuditRow(conn, orderStockConsumedEvent(detail.orderNumber, detail.id, actor));
        return { order: detail, deduplicated: false };
      });
    },
    // ---- Ticket 06 MySQL: การจอง + รอบการใช้โต๊ะ (transaction เดียวกับ audit เสมอ) ----
    async createReservation(input: CreateReservationInput, actor: ShopActor, now: Date = new Date()) {
      return withReservationTx(async (conn) => {
        const customer = await findCustomerRow(conn, input.customerId);
        if (!customer || customer.isDeleted || !customer.isActive) {
          throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
        }
        const partySize = normalizePartySize(input.partySize);
        const reservedAt = normalizeReservedAt(input.reservedAt, now);
        const note = normalizeReservationNote(input.note ?? null);
        const idempotencyKey = normalizeReservationIdempotencyKey(input.idempotencyKey ?? null);
        const requestedTable = input.tableId?.trim() ? input.tableId.trim() : null;
        const hash = reservationPayloadHash({ customerId: customer.id, tableId: requestedTable ?? "", partySize, reservedAt, note });
        if (idempotencyKey) {
          const [idemRows] = (await conn.query("SELECT id, payload_hash FROM reservations WHERE idempotency_key = ? LIMIT 1", [idempotencyKey])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (idemRows.length > 0) {
            if (String(idemRows[0]!["payload_hash"]) !== hash) {
              throw new ConflictError("คำขอนี้ถูกใช้จองไปแล้ว กรุณาสร้างการจองใหม่");
            }
            const detail = await readReservationDetail(conn, String(idemRows[0]!["id"]));
            if (!detail) throw new Error("อ่านการจองเดิมไม่สำเร็จ");
            return { reservation: detail, deduplicated: true };
          }
        }
        const [tableRows] = (await conn.query("SELECT * FROM shop_tables ORDER BY name ASC")) as [
          Record<string, unknown>[],
          unknown,
        ];
        const tablesList = tableRows.map(rowToTable);
        const [activeRows] = (await conn.query(
          "SELECT id, table_id, reserved_at FROM reservations WHERE status IN ('pending','confirmed')",
        )) as [Record<string, unknown>[], unknown];
        const blocked = new Set<string>();
        for (const r of activeRows as Record<string, unknown>[]) {
          const at = new Date(r["reserved_at"] as string).toISOString();
          if (isReservationOverlapping(at, reservedAt)) blocked.add(String(r["table_id"]));
        }
        let tableId: string;
        if (requestedTable) {
          const t = tablesList.find((x) => x.id === requestedTable);
          if (!t) throw new NotFoundError("ไม่พบโต๊ะที่เลือก");
          if (!t.isEnabled) throw new ConflictError(`โต๊ะ ${t.name} งดใช้งานชั่วคราว กรุณาเลือกโต๊ะอื่น`);
          if (t.capacity < partySize) {
            throw new ConflictError(`โต๊ะ ${t.name} รองรับได้ ${t.capacity} คน ไม่พอสำหรับ ${partySize} คน`);
          }
          if (blocked.has(t.id)) {
            throw new ConflictError(`โต๊ะ ${t.name} ไม่ว่างในช่วงเวลานี้แล้ว กรุณาเลือกเวลาหรือโต๊ะอื่น`);
          }
          tableId = t.id;
        } else {
          const found = recommendTable(tablesList, partySize, blocked);
          if (!found) throw new ConflictError("ไม่มีโต๊ะว่างที่รองรับจำนวนคนในช่วงเวลานี้ กรุณาเปลี่ยนเวลาหรือจำนวนคน");
          tableId = found.id;
        }
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const code = generateReservationCode(now);
          const id = randomUUID();
          try {
            await conn.query(
              "INSERT INTO reservations (id, code, customer_id, table_id, party_size, reserved_at, status, note, idempotency_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
              [id, code, customer.id, tableId, partySize, toMysqlDatetime(reservedAt), note, idempotencyKey, hash],
            );
          } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
              const which = dupReservationKeyName(err);
              if (which === "code") continue;
              const [reread] = (await conn.query("SELECT id, payload_hash FROM reservations WHERE idempotency_key = ? LIMIT 1", [idempotencyKey])) as [
                Record<string, unknown>[],
                unknown,
              ];
              if (reread.length === 0) continue;
              if (String(reread[0]!["payload_hash"]) !== hash) {
                throw new ConflictError("คำขอนี้ถูกใช้จองไปแล้ว กรุณาสร้างการจองใหม่");
              }
              const detail = await readReservationDetail(conn, String(reread[0]!["id"]));
              if (!detail) throw new Error("อ่านการจองเดิมไม่สำเร็จ");
              return { reservation: detail, deduplicated: true };
            }
            throw err;
          }
          const detail = await readReservationDetail(conn, id);
          if (!detail) throw new Error("สร้างการจองไม่สำเร็จ");
          await insertAuditRow(conn, reservationCreatedEvent(detail, actor));
          return { reservation: detail, deduplicated: false };
        }
        throw new ConflictError("สร้างรหัสการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      });
    },
    async getReservation(id: string) {
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1",
        [id],
      )) as [Record<string, unknown>[], unknown];
      if (rows.length === 0) return null;
      const r = rowToReservation(rows[0]!);
      return { ...r, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : "-" };
    },
    async getReservationByCode(code: string) {
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.code = ? LIMIT 1",
        [code.trim().toUpperCase()],
      )) as [Record<string, unknown>[], unknown];
      if (rows.length === 0) return null;
      const r = rowToReservation(rows[0]!);
      return { ...r, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : "-" };
    },
    async listCustomerReservations(customerId: string, limit = 50) {
      const n = Math.min(Math.max(limit, 1), 200);
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.customer_id = ? ORDER BY r.reserved_at ASC LIMIT ?",
        [customerId, n],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = rowToReservation(row);
        return { ...r, tableName: row["table_name"] ? String(row["table_name"]) : "-" };
      });
    },
    async listReservations(filter: ListReservationsFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const needle = (filter.q ?? "").trim();
      const params: unknown[] = [];
      let sql =
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id LEFT JOIN customers c ON c.id = r.customer_id";
      const where: string[] = [];
      if (filter.status) {
        where.push("r.status = ?");
        params.push(filter.status);
      }
      if (needle) {
        const like = `%${escapeLike(needle)}%`;
        where.push("(r.code LIKE ? ESCAPE '\\\\' OR c.name LIKE ? ESCAPE '\\\\' OR c.phone LIKE ? ESCAPE '\\\\' OR t.name LIKE ? ESCAPE '\\\\')");
        params.push(like, like, like, like);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY r.created_at DESC LIMIT ?";
      params.push(n);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = rowToReservation(row);
        return { ...r, tableName: row["table_name"] ? String(row["table_name"]) : "-" };
      });
    },
    async listReservationsByPhone(phone: string, limit = 20) {
      const n = Math.min(Math.max(limit, 1), 100);
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id JOIN customers c ON c.id = r.customer_id WHERE c.phone = ? AND r.status IN ('pending','confirmed') ORDER BY r.reserved_at ASC LIMIT ?",
        [phone, n],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = rowToReservation(row);
        return { ...r, tableName: row["table_name"] ? String(row["table_name"]) : "-" };
      });
    },
    async recommendReservationTable(partySize: number, reservedAt: string) {
      const n = normalizePartySize(partySize);
      const d = new Date(reservedAt);
      if (Number.isNaN(d.getTime())) throw new Error("รูปแบบวันเวลานัดไม่ถูกต้อง");
      const iso = d.toISOString();
      const [tableRows] = (await pool.query("SELECT * FROM shop_tables ORDER BY name ASC")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const tablesList = tableRows.map(rowToTable);
      const [activeRows] = (await pool.query(
        "SELECT table_id, reserved_at FROM reservations WHERE status IN ('pending','confirmed')",
      )) as [Record<string, unknown>[], unknown];
      const blocked = new Set<string>();
      for (const r of activeRows as Record<string, unknown>[]) {
        const at = new Date(r["reserved_at"] as string).toISOString();
        if (isReservationOverlapping(at, iso)) blocked.add(String(r["table_id"]));
      }
      const found = recommendTable(tablesList, n, blocked);
      return found ? { ...found } : null;
    },
    async cancelReservation(id: string, patch: { reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withReservationTx(async (conn) => {
        const [rows] = (await conn.query(
          "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1 FOR UPDATE",
          [id],
        )) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการจอง");
        const current = rowToReservation(rows[0]!);
        const reason = normalizeReservationReason(patch.reason);
        assertReservationStatusTransition(current.status, "cancelled", "customer");
        assertCancellable(current.reservedAt, now);
        const before = current.status;
        await conn.query("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [id]);
        const after = await readReservationDetail(conn, id);
        if (!after) throw new NotFoundError("ไม่พบการจอง");
        await insertAuditRow(conn, reservationCancelledEvent(after, before, reason, actor));
        return after;
      });
    },
    async updateReservationStatus(id: string, patch: { status: ReservationStatus; reason: string }, actor: ShopActor) {
      return withReservationTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM reservations WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการจอง");
        const current = rowToReservation(rows[0]!);
        const reason = normalizeReservationReason(patch.reason);
        const to = normalizeReservationStatus(patch.status);
        if (to === "seated" || to === "completed" || to === "pending") {
          throw new ConflictError(`เปลี่ยนสถานะการจองเป็น ${to} ผ่านช่องทางนี้ไม่ได้`);
        }
        assertReservationStatusTransition(current.status, to, "manager");
        const before = current.status;
        await conn.query("UPDATE reservations SET status = ? WHERE id = ?", [to, id]);
        const after = await readReservationDetail(conn, id);
        if (!after) throw new NotFoundError("ไม่พบการจอง");
        await insertAuditRow(
          conn,
          to === "cancelled"
            ? reservationCancelledEvent(after, before, reason, actor)
            : reservationStatusChangedEvent(before, after, reason, actor),
        );
        return after;
      });
    },
    async checkinReservation(input: CheckinInput, actor: ShopActor, now: Date = new Date()) {
      return withReservationTx(async (conn) => {
        let resId: string | null = null;
        if (input.reservationId?.trim()) {
          resId = input.reservationId.trim();
        } else if (input.code?.trim()) {
          const [codeRows] = (await conn.query("SELECT id FROM reservations WHERE code = ? LIMIT 1", [
            input.code.trim().toUpperCase(),
          ])) as [Record<string, unknown>[], unknown];
          if (codeRows.length === 0) throw new NotFoundError("ไม่พบการจอง");
          resId = String(codeRows[0]!["id"]);
        } else if (input.phone?.trim()) {
          const [phoneRows] = (await conn.query(
            "SELECT r.id FROM reservations r JOIN customers c ON c.id = r.customer_id WHERE c.phone = ? AND r.status IN ('pending','confirmed') ORDER BY r.reserved_at ASC LIMIT 2",
            [input.phone.trim()],
          )) as [Record<string, unknown>[], unknown];
          if (phoneRows.length === 0) throw new NotFoundError("ไม่พบการจองที่พร้อมเช็กอินสำหรับเบอร์นี้");
          if (phoneRows.length > 1) {
            throw new ConflictError("พบหลายการจองสำหรับเบอร์นี้ กรุณาระบุรหัสการจอง");
          }
          resId = String(phoneRows[0]!["id"]);
        } else {
          throw new Error("กรุณาระบุรหัสการจองหรือเบอร์โทร");
        }
        const [rows] = (await conn.query(
          "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1 FOR UPDATE",
          [resId],
        )) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการจอง");
        const current = rowToReservation(rows[0]!);
        if (current.status !== "pending" && current.status !== "confirmed") {
          throw new ConflictError("การจองนี้เช็กอินไม่ได้แล้ว (ยกเลิก/เช็กอิน/จบงานไปแล้ว)");
        }
        const [dupRound] = (await conn.query("SELECT id FROM table_rounds WHERE reservation_id = ? LIMIT 1", [current.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (dupRound.length > 0) throw new ConflictError("การจองนี้เปิดรอบการใช้โต๊ะไปแล้ว");
        const actual = normalizePartySize(input.partySize);
        let tableId = current.tableId;
        if (input.tableId?.trim()) tableId = input.tableId.trim();
        const [tableRows] = (await conn.query("SELECT * FROM shop_tables WHERE id = ? LIMIT 1", [tableId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (tableRows.length === 0) throw new NotFoundError("ไม่พบโต๊ะที่เลือก");
        let table = rowToTable(tableRows[0]!);
        if (!table.isEnabled) throw new ConflictError(`โต๊ะ ${table.name} งดใช้งานชั่วคราว`);
        if (table.capacity < actual && !input.tableId?.trim()) {
          // ลองหาโต๊ะอื่นที่ว่างและจุพอ
          const [allTables] = (await conn.query("SELECT * FROM shop_tables ORDER BY name ASC")) as [
            Record<string, unknown>[],
            unknown,
          ];
          const [activeRows] = (await conn.query(
            "SELECT table_id, reserved_at FROM reservations WHERE status IN ('pending','confirmed') AND id <> ?",
            [current.id],
          )) as [Record<string, unknown>[], unknown];
          const blocked = new Set<string>();
          for (const r of activeRows as Record<string, unknown>[]) {
            const at = new Date(r["reserved_at"] as string).toISOString();
            if (isReservationOverlapping(at, current.reservedAt)) blocked.add(String(r["table_id"]));
          }
          const alt = recommendTable(
            allTables.map(rowToTable).filter((t) => t.id !== table!.id),
            actual,
            blocked,
          );
          if (alt) {
            const [openAlt] = (await conn.query(
              "SELECT id FROM table_rounds WHERE table_id = ? AND status = 'open' LIMIT 1",
              [alt.id],
            )) as [Record<string, unknown>[], unknown];
            if (openAlt.length === 0) {
              table = alt;
              tableId = alt.id;
            } else {
              throw new ConflictError(
                `โต๊ะ ${table.name} รองรับได้ ${table.capacity} คน ไม่พอสำหรับ ${actual} คน และยังไม่มีโต๊ะอื่นที่เหมาะสม — อยู่ในรายการรอจัดโต๊ะ กรุณารอสักครู่`,
              );
            }
          } else {
            throw new ConflictError(
              `โต๊ะ ${table.name} รองรับได้ ${table.capacity} คน ไม่พอสำหรับ ${actual} คน และยังไม่มีโต๊ะอื่นที่เหมาะสม — อยู่ในรายการรอจัดโต๊ะ กรุณารอสักครู่`,
            );
          }
        } else if (table.capacity < actual) {
          throw new ConflictError(`โต๊ะ ${table.name} รองรับได้ ${table.capacity} คน ไม่พอสำหรับ ${actual} คน`);
        }
        const [openRows] = (await conn.query(
          "SELECT id FROM table_rounds WHERE table_id = ? AND status = 'open' LIMIT 1 FOR UPDATE",
          [tableId],
        )) as [Record<string, unknown>[], unknown];
        if (openRows.length > 0) {
          throw new ConflictError(`โต๊ะ ${table.name} มีลูกค้าใช้อยู่ กรุณารอสักครู่ (รอจัดโต๊ะ)`);
        }
        const roundId = randomUUID();
        const at = toMysqlDatetime(now.toISOString());
        try {
          await conn.query(
            "INSERT INTO table_rounds (id, reservation_id, table_id, party_size, status, opened_by, opened_at) VALUES (?, ?, ?, ?, 'open', ?, ?)",
            [roundId, current.id, tableId, actual, actor.actorUsername ?? actor.actorId ?? null, at],
          );
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
            throw new ConflictError("การจองนี้เปิดรอบการใช้โต๊ะไปแล้ว");
          }
          throw err;
        }
        await conn.query("UPDATE reservations SET status = 'seated', table_id = ? WHERE id = ?", [tableId, current.id]);
        const rDetail = await readReservationDetail(conn, current.id);
        const roundDetail = await readRoundDetail(conn, roundId);
        if (!rDetail || !roundDetail) throw new Error("เช็กอินไม่สำเร็จ");
        const customer = await findCustomerRow(conn, current.customerId);
        await insertAuditRow(conn, tableRoundOpenedEvent(roundDetail, actor));
        await insertAuditRow(conn, reservationCheckedInEvent(rDetail, roundDetail, actual, actor, customer?.phone ?? null));
        return { reservation: rDetail, round: roundDetail };
      });
    },
    async listTableRounds(filter: ListTableRoundsFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const params: unknown[] = [];
      let sql =
        "SELECT r.*, t.name AS table_name FROM table_rounds r LEFT JOIN shop_tables t ON t.id = r.table_id";
      const where: string[] = [];
      if (filter.status) {
        where.push("r.status = ?");
        params.push(filter.status);
      }
      if (filter.tableId) {
        where.push("r.table_id = ?");
        params.push(filter.tableId);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY r.opened_at DESC LIMIT ?";
      params.push(n);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = rowToTableRound(row);
        return { ...r, tableName: row["table_name"] ? String(row["table_name"]) : "-" };
      });
    },
    async getTableRound(id: string) {
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM table_rounds r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.id = ? LIMIT 1",
        [id],
      )) as [Record<string, unknown>[], unknown];
      if (rows.length === 0) return null;
      const r = rowToTableRound(rows[0]!);
      return { ...r, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : "-" };
    },
    async closeTableRound(id: string, actor: ShopActor, now: Date = new Date()) {
      return withReservationTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM table_rounds WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรอบการใช้โต๊ะ");
        const round = rowToTableRound(rows[0]!);
        if (round.status !== "open") throw new ConflictError("รอบการใช้โต๊ะนี้ปิดไปแล้ว");
        const [pendingRows] = (await conn.query(
          "SELECT COUNT(*) AS n FROM orders WHERE round_id = ? AND status = 'pending_payment'",
          [id],
        )) as [Record<string, unknown>[], unknown];
        if (Number(pendingRows[0]!["n"]) > 0) {
          throw new ConflictError("ยังมีคำสั่งซื้อรอชำระในรอบนี้ กรุณาปิดงานคำสั่งซื้อก่อนปิดรอบโต๊ะ");
        }
        const at = toMysqlDatetime(now.toISOString());
        await conn.query("UPDATE table_rounds SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?", [
          actor.actorUsername ?? actor.actorId ?? null,
          at,
          id,
        ]);
        if (round.reservationId) {
          await conn.query("UPDATE reservations SET status = 'completed' WHERE id = ? AND status = 'seated'", [
            round.reservationId,
          ]);
        }
        const after = await readRoundDetail(conn, id);
        if (!after) throw new NotFoundError("ไม่พบรอบการใช้โต๊ะ");
        await insertAuditRow(conn, tableRoundClosedEvent(after, actor));
        return after;
      });
    },
    // ---- Ticket 08 MySQL: การชำระเงิน ใบเสร็จ และคืนเงิน (transaction เดียวกับ audit เสมอ) ----
    async createPayment(input: CreatePaymentInput, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const method = normalizePaymentMethod(input.method);
        const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [input.orderId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const order = rowToOrder(oRows[0]!);
        if (order.status !== "pending_payment") {
          throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว ไม่สามารถชำระเงินได้อีก");
        }
        const hash = paymentPayloadHash({
          orderId: order.id,
          method,
          amount: order.total,
          receivedAmount: input.receivedAmount ?? null,
        });
        const [idemRows] = (await conn.query("SELECT * FROM payments WHERE idempotency_key = ? LIMIT 1", [idempotencyKey])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (idemRows.length > 0) {
          const ex = rowToPayment(idemRows[0]!);
          if (String(idemRows[0]!["payload_hash"]) !== hash) {
            throw new ConflictError("คำขอนี้ถูกใช้ชำระไปแล้ว กรุณาสร้างคำขอใหม่");
          }
          return {
            payment: ex,
            qrPayload: ex.method === "promptpay" && ex.status === "pending" ? `PROMPTPAY-FAKE:${ex.id}:${ex.amount}` : null,
            deduplicated: true,
          };
        }
        const [activeRows] = (await conn.query("SELECT * FROM payments WHERE order_id = ? LIMIT 1 FOR UPDATE", [order.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (activeRows.length > 0) {
          const active = rowToPayment(activeRows[0]!);
          if (active.status === "pending" || active.status === "manual_review") {
            throw new ConflictError("มีคำขอชำระที่ดำเนินการอยู่แล้ว กรุณารอผลหรือยกเลิกก่อน");
          }
          if (active.status === "paid" || active.status === "refunded") {
            throw new ConflictError("คำสั่งซื้อนี้ชำระสำเร็จแล้ว ไม่รับการชำระซ้ำ");
          }
          // terminal failed/expired/cancelled: แทนที่ด้วย intent ใหม่ใน transaction เดียว
          await conn.query("DELETE FROM payment_events WHERE payment_id = ?", [active.id]);
          await conn.query("DELETE FROM payments WHERE id = ?", [active.id]);
        }
        let receivedAmount: number | null = null;
        let changeAmount = 0;
        let providerRef: string | null = null;
        let qrPayload: string | null = null;
        const id = randomUUID();
        if (method === "cash") {
          if (input.receivedAmount === undefined || input.receivedAmount === null) {
            throw new Error("กรุณาระบุจำนวนเงินที่รับมา");
          }
          changeAmount = assertCashTendered(order.total, input.receivedAmount);
          receivedAmount = Math.round(input.receivedAmount * 100) / 100;
        } else {
          const provider = new FakePromptPayProvider();
          const expiresAt = new Date(now.getTime() + PAYMENT_PROMPTPAY_TTL_MINUTES * 60 * 1000);
          const intent = await provider.createIntent(id, order.total, expiresAt);
          providerRef = intent.providerRef;
          qrPayload = intent.qrPayload;
        }
        const slipRef = typeof input.slipRef === "string" && input.slipRef.trim() ? input.slipRef.trim().slice(0, 120) : null;
        const expiresAt = toMysqlDatetime(new Date(now.getTime() + PAYMENT_PROMPTPAY_TTL_MINUTES * 60 * 1000).toISOString());
        try {
          await conn.query(
            "INSERT INTO payments (id, order_id, order_number, method, amount, received_amount, change_amount, status, provider_ref, slip_ref, idempotency_key, payload_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
            [id, order.id, order.orderNumber, method, order.total, receivedAmount, changeAmount, providerRef, slipRef, idempotencyKey, hash, expiresAt],
          );
        } catch (err: unknown) {
          const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
          if (msg.includes("uq_payments_idempotency") || msg.includes("uq_payments_order")) {
            const [reread] = (await conn.query("SELECT * FROM payments WHERE idempotency_key = ? LIMIT 1", [idempotencyKey])) as [
              Record<string, unknown>[],
              unknown,
            ];
            if (reread.length > 0) {
              if (String(reread[0]!["payload_hash"]) !== hash) {
                throw new ConflictError("คำขอนี้ถูกใช้ชำระไปแล้ว กรุณาสร้างคำขอใหม่");
              }
              const ex = rowToPayment(reread[0]!);
              return { payment: ex, qrPayload: null, deduplicated: true };
            }
          }
          throw err;
        }
        const [pRows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const payment = rowToPayment(pRows[0]!);
        await insertAuditRow(conn, paymentCreatedEvent(payment, actor));
        return { payment, qrPayload, deduplicated: false };
      });
    },
    async getPayment(id: string) {
      const [rows] = (await pool.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return rows.length === 0 ? null : rowToPayment(rows[0]!);
    },
    async getOrderPayment(orderId: string) {
      const [rows] = (await pool.query("SELECT * FROM payments WHERE order_id = ? LIMIT 1", [orderId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return rows.length === 0 ? null : rowToPayment(rows[0]!);
    },
    async getOrderPaymentState(orderId: string) {
      const [rows] = (await pool.query("SELECT status FROM payments WHERE order_id = ? LIMIT 1", [orderId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return "pending_payment";
      return paymentToOrderState(rowToPayment({ ...rows[0]!, method: "cash", amount: 0 }).status);
    },
    async listPayments(filter: ListPaymentsFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const params: unknown[] = [];
      let sql = "SELECT * FROM payments";
      const where: string[] = [];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (filter.method) {
        where.push("method = ?");
        params.push(filter.method);
      }
      const needle = (filter.q ?? "").trim();
      if (needle) {
        where.push("(order_number LIKE ? OR receipt_number LIKE ?)");
        params.push(`%${needle}%`, `%${needle}%`);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(n);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToPayment);
    },
    async confirmCashPayment(id: string, input: { receivedAmount: number; reason?: string | null }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        let current = await expirePaymentRowIfDue(conn, rowToPayment(rows[0]!), now, actor);
        if (current.status === "paid") {
          const receipt = await readReceiptTx(conn, current.id);
          if (!receipt) throw new Error("ไม่พบใบเสร็จของการชำระนี้");
          return { payment: current, receipt, deduplicated: true };
        }
        if (current.method !== "cash") throw new ConflictError("รายการนี้ไม่ใช่การชำระด้วยเงินสด");
        const detail = await readOrderDetailTx(conn, current.orderId);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        if (detail.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว ยืนยันรับเงินไม่ได้");
        if (current.amount !== detail.total) throw new ConflictError("ยอดชำระไม่ตรงกับยอดคำสั่งซื้อปัจจุบัน");
        const tendered = input.receivedAmount ?? current.receivedAmount;
        if (tendered === null || tendered === undefined) throw new Error("กรุณาระบุจำนวนเงินที่รับมา");
        const change = assertCashTendered(current.amount, tendered);
        const received = Math.round(tendered * 100) / 100;
        await conn.query("UPDATE payments SET received_amount = ?, change_amount = ? WHERE id = ?", [received, change, current.id]);
        current = { ...current, receivedAmount: received, changeAmount: change };
        const shopNameValue = await readShopNameFrom(conn);
        const reason = input.reason?.trim() ? normalizePaymentReason(input.reason) : "รับเงินสดหน้าร้าน";
        const receipt = await markPaymentPaidTx(conn, current, detail, shopNameValue, reason, actor, now);
        const [after] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        return { payment: rowToPayment(after[0]!), receipt, deduplicated: false };
      });
    },
    async handlePaymentWebhook(paymentId: string, input: { providerEventId: string; outcome: ProviderOutcome; summary?: string | null }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const eventId = normalizeProviderEventId(input.providerEventId);
        const outcome = normalizeProviderOutcome(input.outcome);
        const [seen] = (await conn.query("SELECT * FROM payment_events WHERE provider_event_id = ? LIMIT 1", [eventId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (seen.length > 0) {
          const pid = String(seen[0]!["payment_id"]);
          const [pRows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [pid])) as [
            Record<string, unknown>[],
            unknown,
          ];
          const p = rowToPayment(pRows[0]!);
          return { payment: p, receipt: await readReceiptTx(conn, pid), deduplicated: true };
        }
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [paymentId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        let current = rowToPayment(rows[0]!);
        if (current.status === "paid" || current.status === "refunded") {
          throw new ConflictError("รายการนี้ชำระสำเร็จแล้ว ไม่รับผลการชำระซ้ำ");
        }
        current = await expirePaymentRowIfDue(conn, current, now, actor);
        if (current.status === "expired") {
          await conn.query("INSERT INTO payment_events (id, payment_id, provider_event_id, kind, summary) VALUES (?, ?, ?, ?, ?)", [
            randomUUID(), current.id, eventId, outcome === "success" ? "success" : outcome === "ambiguous" ? "ambiguous" : "fail",
            input.summary ?? `ผล ${outcome} จากผู้ให้บริการ`,
          ]);
          return { payment: current, receipt: null, deduplicated: false };
        }
        const detail = await readOrderDetailTx(conn, current.orderId);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        if (detail.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
        const target = outcomeToStatus(outcome);
        assertPaymentTransition(current.status, target);
        await conn.query("INSERT INTO payment_events (id, payment_id, provider_event_id, kind, summary) VALUES (?, ?, ?, ?, ?)", [
          randomUUID(), current.id, eventId, outcome === "success" ? "success" : outcome === "ambiguous" ? "ambiguous" : "fail",
          input.summary ?? `ผล ${outcome} จากผู้ให้บริการ`,
        ]);
        if (target === "paid") {
          const shopNameValue = await readShopNameFrom(conn);
          const receipt = await markPaymentPaidTx(conn, current, detail, shopNameValue, `ผลยืนยันจากผู้ให้บริการ (${outcome})`, actor, now);
          const [after] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [paymentId])) as [
            Record<string, unknown>[],
            unknown,
          ];
          return { payment: rowToPayment(after[0]!), receipt, deduplicated: false };
        }
        await conn.query("UPDATE payments SET status = ? WHERE id = ?", [target, current.id]);
        const after: Payment = { ...current, status: target, updatedAt: now.toISOString() };
        await insertAuditRow(conn, paymentStatusChangedEvent({ status: current.status }, after, `ผลยืนยันจากผู้ให้บริการ (${outcome})`, actor));
        return { payment: after, receipt: null, deduplicated: false };
      });
    },
    async submitPaymentSlip(id: string, input: { slipRef: string }, actor: ShopActor, now: Date = new Date()) {
      if (!isFakePaymentMode()) {
        throw new Error("ผู้ให้บริการตรวจ slip จริงยังไม่เปิดใช้งาน (contract-only)");
      }
      const raw = input.slipRef.trim();
      if (!raw) throw new Error("กรุณาระบุเลขอ้างอิง slip");
      if (raw.length > 120) throw new Error("เลขอ้างอิง slip ยาวเกินไป");
      const provider = new FakePromptPayProvider();
      const outcome = await provider.verifySlip(raw);
      return withPaymentTx(async (conn) => {
        const eventId = `slip:${raw}`;
        const [seen] = (await conn.query("SELECT * FROM payment_events WHERE provider_event_id = ? LIMIT 1", [eventId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (seen.length > 0) {
          const pid = String(seen[0]!["payment_id"]);
          const [pRows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [pid])) as [
            Record<string, unknown>[],
            unknown,
          ];
          const p = rowToPayment(pRows[0]!);
          return { payment: p, receipt: await readReceiptTx(conn, pid), deduplicated: true };
        }
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        let current = rowToPayment(rows[0]!);
        if (current.status === "paid" || current.status === "refunded") {
          throw new ConflictError("รายการนี้ชำระสำเร็จแล้ว ไม่รับผลการชำระซ้ำ");
        }
        current = await expirePaymentRowIfDue(conn, current, now, actor);
        await conn.query("UPDATE payments SET slip_ref = ? WHERE id = ?", [raw, current.id]);
        current = { ...current, slipRef: raw };
        if (current.status === "expired") {
          await conn.query("INSERT INTO payment_events (id, payment_id, provider_event_id, kind, summary) VALUES (?, ?, ?, ?, ?)", [
            randomUUID(), current.id, eventId, outcome === "success" ? "success" : outcome === "ambiguous" ? "ambiguous" : "fail", `ตรวจ slip ${raw}`,
          ]);
          return { payment: current, receipt: null, deduplicated: false };
        }
        const detail = await readOrderDetailTx(conn, current.orderId);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        if (detail.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
        const target = outcomeToStatus(outcome);
        assertPaymentTransition(current.status, target);
        await conn.query("INSERT INTO payment_events (id, payment_id, provider_event_id, kind, summary) VALUES (?, ?, ?, ?, ?)", [
          randomUUID(), current.id, eventId, outcome === "success" ? "success" : outcome === "ambiguous" ? "ambiguous" : "fail", `ตรวจ slip ${raw}`,
        ]);
        if (target === "paid") {
          const shopNameValue = await readShopNameFrom(conn);
          const receipt = await markPaymentPaidTx(conn, current, detail, shopNameValue, `ตรวจ slip ผ่าน (${raw})`, actor, now);
          const [after] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          return { payment: rowToPayment(after[0]!), receipt, deduplicated: false };
        }
        await conn.query("UPDATE payments SET status = ? WHERE id = ?", [target, current.id]);
        const after: Payment = { ...current, status: target, updatedAt: now.toISOString() };
        await insertAuditRow(conn, paymentStatusChangedEvent({ status: current.status }, after, `ตรวจ slip (${raw}) ผล ${outcome}`, actor));
        return { payment: after, receipt: null, deduplicated: false };
      });
    },
    async resolveManualReview(id: string, input: { decision: "paid" | "failed" | "cancelled"; reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        const current = rowToPayment(rows[0]!);
        if (current.status !== "manual_review") throw new ConflictError("รายการนี้ไม่ได้รอตรวจสอบ");
        const reason = normalizePaymentReason(input.reason);
        const detail = await readOrderDetailTx(conn, current.orderId);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        if (input.decision === "paid") {
          if (detail.status !== "pending_payment") throw new ConflictError("คำสั่งซื้อนี้ปิดงานแล้ว รับผลชำระไม่ได้");
          const shopNameValue = await readShopNameFrom(conn);
          const receipt = await markPaymentPaidTx(conn, current, detail, shopNameValue, reason, actor, now);
          const [after] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          return { payment: rowToPayment(after[0]!), receipt };
        }
        const target: PaymentStatus = input.decision === "failed" ? "failed" : "cancelled";
        assertPaymentTransition(current.status, target);
        await conn.query("UPDATE payments SET status = ? WHERE id = ?", [target, current.id]);
        const after: Payment = { ...current, status: target, updatedAt: now.toISOString() };
        await insertAuditRow(conn, paymentStatusChangedEvent({ status: current.status }, after, reason, actor));
        return { payment: after, receipt: null };
      });
    },
    async expirePayment(id: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        const current = rowToPayment(rows[0]!);
        if (current.status !== "pending") return { payment: current, deduplicated: true };
        void actor;
        void now;
        await conn.query("UPDATE payments SET status = 'expired' WHERE id = ?", [id]);
        const after: Payment = { ...current, status: "expired", updatedAt: new Date().toISOString() };
        await insertAuditRow(conn, paymentStatusChangedEvent({ status: "pending" }, after, "intent หมดอายุ", actor));
        return { payment: after, deduplicated: false };
      });
    },
    async getReceiptByPayment(paymentId: string) {
      const [rows] = (await pool.query("SELECT * FROM receipts WHERE payment_id = ? LIMIT 1", [paymentId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return rows.length === 0 ? null : rowToReceipt(rows[0]!);
    },
    async getReceiptByNumber(receiptNumber: string) {
      const [rows] = (await pool.query("SELECT * FROM receipts WHERE receipt_number = ? LIMIT 1", [receiptNumber.trim()])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return rows.length === 0 ? null : rowToReceipt(rows[0]!);
    },
    async listReceipts(filter: ListReceiptsFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const params: unknown[] = [];
      let sql = "SELECT * FROM receipts";
      const where: string[] = [];
      const needle = (filter.q ?? "").trim();
      if (needle) {
        where.push("(receipt_number LIKE ? OR order_number LIKE ?)");
        params.push(`%${needle}%`, `%${needle}%`);
      }
      if (filter.date) {
        where.push("DATE(CONVERT_TZ(paid_at, '+00:00', '+07:00')) = ?");
        params.push(filter.date);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY paid_at DESC LIMIT ?";
      params.push(n);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToReceipt);
    },
    async approveRefund(paymentId: string, input: { reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [paymentId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        const current = rowToPayment(rows[0]!);
        if (current.status !== "paid") throw new ConflictError("คืนเงินได้เฉพาะรายการที่ชำระสำเร็จแล้ว");
        const reason = normalizePaymentReason(input.reason);
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [current.orderId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const order = rowToOrder(oRows[0]!);
        if (order.status !== "pending_payment") {
          throw new ConflictError("คำสั่งซื้อนี้ปิดงาน/เริ่มทำแล้ว คืนเงินไม่ได้");
        }
        if (order.stockConsumed) {
          throw new ConflictError("คำสั่งซื้อเริ่มทำ (ตัดสต๊อกจริง) แล้ว คืนเงินไม่ได้");
        }
        // คืนยอดจองตาม Ticket 07 contract (SELECT ... FOR UPDATE กันแข่ง แล้วคืนทีละวัตถุดิบ)
        if (order.stockReserved) {
          const [useRows] = (await conn.query("SELECT ingredient_id, qty FROM order_stock_usage WHERE order_id = ?", [order.id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          for (const u of useRows as Record<string, unknown>[]) {
            const ingId = String(u["ingredient_id"]);
            const qty = Number(u["qty"]);
            const [ingRows] = (await conn.query("SELECT * FROM ingredients WHERE id = ? LIMIT 1 FOR UPDATE", [ingId])) as [
              Record<string, unknown>[],
              unknown,
            ];
            if (ingRows.length === 0) continue;
            const ing = rowToIngredient(ingRows[0]!);
            const afterReserved = roundStock(Math.max(0, ing.reserved - qty));
            await conn.query("UPDATE ingredients SET reserved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [afterReserved, ingId]);
            await conn.query(
              "INSERT INTO stock_ledger (id, ingredient_id, op, delta_on_hand, delta_reserved, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id, actor_username, order_id, reference) VALUES (?, ?, 'release', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [randomUUID(), ingId, -qty, ing.onHand, ing.onHand, ing.reserved, afterReserved, `คืนยอดจองของคำสั่งซื้อ ${order.orderNumber}: คืนเงิน: ${reason}`, actor.actorId ?? null, actor.actorUsername ?? null, order.id, order.orderNumber],
            );
          }
        }
        await conn.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
        const detail = await readOrderDetailTx(conn, order.id);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        await insertAuditRow(conn, orderStatusChangedEvent({ status: "pending_payment", total: order.total }, detail, `คืนเงิน: ${reason}`, actor));
        if (order.stockReserved) {
          await insertAuditRow(conn, orderStockReleasedEvent(order.orderNumber, order.id, `คืนเงิน: ${reason}`, actor));
        }
        await conn.query("UPDATE payments SET status = 'refunded' WHERE id = ?", [current.id]);
        const at = toMysqlDatetime(now.toISOString());
        const refundId = randomUUID();
        await conn.query(
          "INSERT INTO refunds (id, payment_id, order_id, order_number, amount, reason, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [refundId, current.id, order.id, order.orderNumber, current.amount, reason, actor.actorUsername ?? actor.actorId ?? null, at],
        );
        const after: Payment = { ...current, status: "refunded", updatedAt: now.toISOString() };
        await insertAuditRow(conn, paymentRefundApprovedEvent(after, refundId, reason, actor));
        // Ticket 10: คืนเงินต้องย้อนคะแนน earn ที่เกี่ยวข้อง (กัน double-reversal)
        await reversePointsTx(conn, order.id, refundId, actor, now);
        const [rRows] = (await conn.query("SELECT * FROM refunds WHERE id = ? LIMIT 1", [refundId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        return { payment: after, refund: rowToRefund(rRows[0]!) };
      });
    },
    async listRefunds(limit: number) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query("SELECT * FROM refunds ORDER BY created_at DESC LIMIT ?", [n])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToRefund);
    },
    // ---- Ticket 09 MySQL: คิวครัว/เครื่องดื่มและการส่งมอบ ----
    async ensureQueueJobs(paymentId: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM payments WHERE id = ? LIMIT 1 FOR UPDATE", [paymentId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการชำระเงิน");
        const p = rowToPayment(rows[0]!);
        if (p.status !== "paid") {
          throw new ConflictError("สร้างงานคิวได้เฉพาะคำสั่งซื้อที่ชำระสำเร็จแล้ว");
        }
        const detail = await readOrderDetailTx(conn, p.orderId);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        if (detail.status === "cancelled") {
          throw new ConflictError("คำสั่งซื้อถูกยกเลิกแล้ว สร้างงานคิวไม่ได้");
        }
        const [existing] = (await conn.query("SELECT id FROM queue_jobs WHERE payment_id = ? LIMIT 1", [p.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (existing.length > 0) {
          const [jRows] = (await conn.query("SELECT j.*, t.name AS table_name FROM queue_jobs j LEFT JOIN shop_tables t ON t.id = j.table_id WHERE j.payment_id = ? ORDER BY j.created_at ASC", [p.id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          return {
            jobs: (jRows as Record<string, unknown>[]).map((r) => {
              const job = rowToQueueJob(r);
              return { ...job, tableName: r["table_name"] ? String(r["table_name"]) : null };
            }),
            deduplicated: true,
          };
        }
        const created = await ensureQueueJobsTx(conn, p, detail, actor, now);
        return { jobs: await listQueueDetailsTx(conn, created.map((j) => j.id)), deduplicated: false };
      });
    },
    async listOrderQueueJobs(orderId: string) {
      const [rows] = (await pool.query(
        "SELECT j.*, t.name AS table_name FROM queue_jobs j LEFT JOIN shop_tables t ON t.id = j.table_id WHERE j.order_id = ? ORDER BY j.created_at ASC",
        [orderId],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((r) => {
        const job = rowToQueueJob(r);
        return { ...job, tableName: r["table_name"] ? String(r["table_name"]) : null };
      });
    },
    async getQueueJob(id: string) {
      const [rows] = (await pool.query(
        "SELECT j.*, t.name AS table_name FROM queue_jobs j LEFT JOIN shop_tables t ON t.id = j.table_id WHERE j.id = ? LIMIT 1",
        [id],
      )) as [Record<string, unknown>[], unknown];
      if (rows.length === 0) return null;
      const job = rowToQueueJob(rows[0]!);
      return { ...job, tableName: rows[0]!["table_name"] ? String(rows[0]!["table_name"]) : null };
    },
    async listQueueJobs(filter: ListQueueJobsFilter) {
      const n = Math.min(Math.max(filter.limit || 50, 1), 200);
      const params: unknown[] = [];
      let sql =
        "SELECT j.*, t.name AS table_name FROM queue_jobs j LEFT JOIN shop_tables t ON t.id = j.table_id";
      const where: string[] = [];
      if (filter.station) {
        where.push("j.station = ?");
        params.push(normalizeStation(filter.station));
      }
      if (filter.status) {
        where.push("j.status = ?");
        params.push(normalizeQueueStatus(filter.status));
      }
      if (filter.orderId) {
        where.push("j.order_id = ?");
        params.push(filter.orderId);
      }
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY j.ready_at ASC, j.created_at ASC LIMIT ?";
      params.push(n);
      const [rows] = (await pool.query(sql, params)) as [Record<string, unknown>[], unknown];
      const now = new Date();
      const jobs = (rows as Record<string, unknown>[]).map((r) => {
        const job = rowToQueueJob(r);
        return { ...job, tableName: r["table_name"] ? String(r["table_name"]) : null };
      });
      // FIFO ต่อฝ่ายตาม readyAt (priority แทรกได้) — เรียงที่โค้ดให้ตรงกับ memory seam
      return jobs.sort((a, b) => compareQueueJobs(a, b, now)).slice(0, n);
    },
    async claimQueueJob(id: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        await assertQueueOrderActiveTx(conn, job.orderId);
        assertQueueTransition(job.status, "claimed");
        const before = { status: job.status };
        await conn.query("UPDATE queue_jobs SET status = 'claimed', claimed_by = ? WHERE id = ?", [
          actor.actorUsername ?? actor.actorId ?? null, id,
        ]);
        const after = { ...job, status: "claimed" as const, claimedBy: actor.actorUsername ?? actor.actorId ?? null, updatedAt: now.toISOString() };
        await insertAuditRow(conn, queueStatusChangedEvent(before, after, "รับงานเข้าทำ", actor));
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async startQueueJob(id: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        const order = await assertQueueOrderActiveTx(conn, job.orderId);
        assertQueueTransition(job.status, "preparing");
        const before = { status: job.status };
        // ตัดสต๊อกจริงครั้งแรกของคำสั่งซื้อ (ครั้งเดียว — มี flag แล้วเป็น no-op)
        // งานรางวัล (order null) ตัดสต๊อกแล้วตอนร้านรับแลก จึงข้ามขั้นนี้
        if (order) {
          const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [order.id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          const locked = rowToOrder(oRows[0]!);
          await consumeStockForQueueStartTx(conn, locked, id, actor);
        }
        await conn.query("UPDATE queue_jobs SET status = 'preparing', claimed_by = ? WHERE id = ?", [
          actor.actorUsername ?? actor.actorId ?? null, id,
        ]);
        const after = { ...job, status: "preparing" as const, claimedBy: actor.actorUsername ?? actor.actorId ?? null, updatedAt: now.toISOString() };
        await insertAuditRow(conn, queueStatusChangedEvent(before, after, "เริ่มทำ", actor));
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async completeQueueJob(id: string, input: { qty: number }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        await assertQueueOrderActiveTx(conn, job.orderId);
        if (job.status !== "claimed" && job.status !== "preparing") {
          throw new ConflictError("บันทึกทำเสร็จได้เฉพาะงานที่รับงานหรือกำลังทำอยู่");
        }
        const qty = normalizeQueueQty(input.qty);
        if (job.readyQty + qty > job.quantity) {
          throw new ConflictError(`จำนวนทำเสร็จเกินยอดงาน (ทำเสร็จแล้ว ${job.readyQty}/${job.quantity})`);
        }
        const before = { status: job.status };
        const readyQty = job.readyQty + qty;
        const status = readyQty === job.quantity ? "ready" : "preparing";
        await conn.query("UPDATE queue_jobs SET ready_qty = ?, status = ? WHERE id = ?", [readyQty, status, id]);
        const after = { ...job, readyQty, status: status as QueueJob["status"], updatedAt: now.toISOString() };
        await insertAuditRow(conn, queueStatusChangedEvent(before, after, `ทำเสร็จ ${qty} รายการ`, actor));
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async deliverQueueJob(id: string, input: { qty: number }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        await assertQueueOrderActiveTx(conn, job.orderId);
        if (job.status !== "ready") {
          throw new ConflictError("ส่งมอบได้เฉพาะงานที่พร้อมส่งมอบแล้ว");
        }
        const qty = normalizeQueueQty(input.qty);
        if (job.deliveredQty + qty > job.readyQty) {
          throw new ConflictError(
            `จำนวนส่งมอบเกินจำนวนที่ทำเสร็จ (ส่งมอบแล้ว ${job.deliveredQty}/${job.readyQty} ที่ทำเสร็จ)`,
          );
        }
        if (job.deliveredQty + qty > job.quantity) {
          throw new ConflictError(`จำนวนส่งมอบเกินยอดงาน (${job.quantity})`);
        }
        const before = { status: job.status };
        const deliveredQty = job.deliveredQty + qty;
        const status = deliveredQty === job.quantity ? "delivered" : "ready";
        await conn.query("UPDATE queue_jobs SET delivered_qty = ?, status = ? WHERE id = ?", [deliveredQty, status, id]);
        const after = { ...job, deliveredQty, status: status as QueueJob["status"], updatedAt: now.toISOString() };
        await insertAuditRow(conn, queueStatusChangedEvent(before, after, `ส่งมอบ ${qty} รายการ`, actor));
        // Ticket 10: ส่งมอบแล้วเข้าเงื่อนไขสะสมคะแนน (exactly-once — ซ้ำเป็น no-op)
        if (job.orderId !== null) {
          await tryAutoEarnTx(conn, job.orderId, actor, now);
        }
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async prioritizeQueueJob(id: string, input: { reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        await assertQueueOrderActiveTx(conn, job.orderId);
        if (job.status === "delivered" || job.status === "cancelled") {
          throw new ConflictError("งานคิวนี้ปิดงานแล้ว เร่งงานไม่ได้");
        }
        const reason = normalizeQueueReason(input.reason);
        await conn.query("UPDATE queue_jobs SET is_priority = 1, reason = ? WHERE id = ?", [reason, id]);
        const after = { ...job, isPriority: true, reason, updatedAt: now.toISOString() };
        await insertAuditRow(conn, queuePriorityEvent(after, reason, actor));
        void now;
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async remakeQueueJob(id: string, input: { reason: string; quantity?: number | null }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const original = rowToQueueJob(rows[0]!);
        await assertQueueOrderActiveTx(conn, original.orderId);
        if (original.status === "cancelled") {
          throw new ConflictError("งานคิวนี้ถูกยกเลิกแล้ว ทำใหม่ไม่ได้");
        }
        const reason = normalizeQueueReason(input.reason);
        const remaining = original.quantity - original.deliveredQty;
        if (remaining <= 0) {
          throw new ConflictError("งานนี้ส่งมอบครบแล้ว ไม่ต้องทำใหม่");
        }
        const qty =
          input.quantity === undefined || input.quantity === null ? remaining : normalizeQueueQty(input.quantity);
        if (qty > remaining) {
          throw new ConflictError(`จำนวนทำใหม่เกินคงเหลือที่ยังไม่ส่งมอบ (${remaining})`);
        }
        const remakeId = randomUUID();
        const at = toMysqlDatetime(now.toISOString());
        await conn.query(
          "INSERT INTO queue_jobs (id, order_id, order_number, payment_id, order_item_id, menu_id, menu_name, station, quantity, ready_qty, delivered_qty, status, ready_at, table_id, round_id, is_remake, is_priority, reason, claimed_by, reward_redemption_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'queued', ?, ?, ?, 1, 0, ?, NULL, ?)",
          [
            remakeId, original.orderId, original.orderNumber, original.paymentId, original.orderItemId,
            original.menuId, original.menuName, original.station, qty, at, original.tableId, original.roundId, reason,
            original.rewardRedemptionId,
          ],
        );
        const remake = rowToQueueJob({
          id: remakeId, order_id: original.orderId, order_number: original.orderNumber, payment_id: original.paymentId,
          order_item_id: original.orderItemId, menu_id: original.menuId, menu_name: original.menuName,
          station: original.station, quantity: qty, ready_qty: 0, delivered_qty: 0, status: "queued",
          ready_at: now.toISOString(), table_id: original.tableId, round_id: original.roundId,
          is_remake: 1, is_priority: 0, reason, claimed_by: null,
          reward_redemption_id: original.rewardRedemptionId,
          created_at: now.toISOString(), updated_at: now.toISOString(),
        });
        await insertAuditRow(conn, queueRemadeEvent({ ...original }, { ...remake }, reason, actor));
        return (await readQueueDetailTx(conn, remakeId))!;
      });
    },
    async cancelQueueJob(id: string, input: { reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM queue_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบงานคิว");
        const job = rowToQueueJob(rows[0]!);
        // งานรางวัล (ไม่ผูกคำสั่งซื้อ) ยกเลิกผ่านการคืนคะแนนแลก ไม่ใช่ช่องทางนี้
        if (job.orderId === null || job.rewardRedemptionId !== null) {
          throw new ConflictError("งานรางวัลยกเลิกได้ผ่านการคืนคะแนนแลกเท่านั้น");
        }
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [job.orderId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const order = rowToOrder(oRows[0]!);
        if (order.stockConsumed) {
          throw new ConflictError("คำสั่งซื้อเริ่มทำ (ตัดสต๊อกจริง) แล้ว ยกเลิกงานคิวไม่ได้");
        }
        const [pRows] = (await conn.query("SELECT status FROM payments WHERE order_id = ? LIMIT 1", [order.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (pRows.length > 0 && String(pRows[0]!["status"]) === "refunded") {
          throw new ConflictError("คำสั่งซื้อนี้คืนเงินแล้ว ยกเลิกงานคิวไม่ได้");
        }
        if (job.status !== "queued" && job.status !== "claimed") {
          throw new ConflictError("ยกเลิกงานคิวได้เฉพาะก่อนเริ่มทำเท่านั้น");
        }
        const reason = normalizeQueueReason(input.reason);
        const before = { status: job.status };
        await conn.query("UPDATE queue_jobs SET status = 'cancelled', reason = ? WHERE id = ?", [reason, id]);
        const after = { ...job, status: "cancelled" as const, reason, updatedAt: now.toISOString() };
        await insertAuditRow(conn, queueStatusChangedEvent(before, after, reason, actor));
        void now;
        return (await readQueueDetailTx(conn, id))!;
      });
    },
    async getStationCapacity(station: QueueStation) {
      const st = normalizeStation(station);
      const [rows] = (await pool.query("SELECT per_slot, updated_by, updated_at FROM station_capacity WHERE station = ? LIMIT 1", [st])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) {
        return { station: st, perSlot: QUEUE_DEFAULT_CAPACITY_PER_SLOT, updatedBy: null, updatedAt: new Date().toISOString() };
      }
      return {
        station: st,
        perSlot: Number(rows[0]!["per_slot"]),
        updatedBy: rows[0]!["updated_by"] ? String(rows[0]!["updated_by"]) : null,
        updatedAt: new Date(rows[0]!["updated_at"] as string).toISOString(),
      };
    },
    async setStationCapacity(station: QueueStation, perSlot: number, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const st = normalizeStation(station);
        const n = normalizeCapacityPerSlot(perSlot);
        const before = await readCapacityTx(conn, st);
        await conn.query(
          "INSERT INTO station_capacity (station, per_slot, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE per_slot = VALUES(per_slot), updated_by = VALUES(updated_by)",
          [st, n, actor.actorUsername ?? actor.actorId ?? null],
        );
        await insertAuditRow(conn, queueCapacityUpdatedEvent(st, before, n, actor));
        const [rows] = (await conn.query("SELECT per_slot, updated_by, updated_at FROM station_capacity WHERE station = ? LIMIT 1", [st])) as [
          Record<string, unknown>[],
          unknown,
        ];
        void now;
        return {
          station: st,
          perSlot: Number(rows[0]!["per_slot"]),
          updatedBy: rows[0]!["updated_by"] ? String(rows[0]!["updated_by"]) : null,
          updatedAt: new Date(rows[0]!["updated_at"] as string).toISOString(),
        };
      });
    },
    async listQueueSlots(station: QueueStation, date: string, now: Date = new Date()) {
      const st = normalizeStation(station);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)");
      const dayStartUtc = new Date(`${date}T00:00:00+07:00`);
      if (Number.isNaN(dayStartUtc.getTime())) throw new Error("รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)");
      const [capRows] = (await pool.query("SELECT per_slot FROM station_capacity WHERE station = ? LIMIT 1", [st])) as [
        Record<string, unknown>[],
        unknown,
      ];
      const cap = capRows.length === 0 ? QUEUE_DEFAULT_CAPACITY_PER_SLOT : Number(capRows[0]!["per_slot"]);
      const slots: QueueSlot[] = [];
      const slotMs = QUEUE_SLOT_MINUTES * 60 * 1000;
      void now;
      for (let i = 0; i < (24 * 60) / QUEUE_SLOT_MINUTES; i += 1) {
        const start = new Date(dayStartUtc.getTime() + i * slotMs);
        const end = new Date(start.getTime() + slotMs);
        const used = await countJobsInSlotTx(pool, st, start);
        slots.push({
          station: st,
          slotStart: start.toISOString(),
          slotEnd: end.toISOString(),
          used,
          capacity: cap,
          available: Math.max(0, cap - used),
        });
      }
      return slots;
    },
    async suggestNextSlot(station: QueueStation, after: string, now: Date = new Date()) {
      const st = normalizeStation(station);
      const afterDate = new Date(after);
      if (Number.isNaN(afterDate.getTime())) throw new Error("เวลาไม่ถูกต้อง");
      const [capRows] = (await pool.query("SELECT per_slot FROM station_capacity WHERE station = ? LIMIT 1", [st])) as [
        Record<string, unknown>[],
        unknown,
      ];
      const cap = capRows.length === 0 ? QUEUE_DEFAULT_CAPACITY_PER_SLOT : Number(capRows[0]!["per_slot"]);
      const slotMs = QUEUE_SLOT_MINUTES * 60 * 1000;
      const cursor = slotStartOf(afterDate);
      void now;
      for (let i = 0; i < 96 * 7; i += 1) {
        const start = new Date(cursor.getTime() + i * slotMs);
        const used = await countJobsInSlotTx(pool, st, start);
        if (used < cap) {
          return {
            station: st,
            slotStart: start.toISOString(),
            slotEnd: new Date(start.getTime() + slotMs).toISOString(),
            used,
            capacity: cap,
            available: cap - used,
          };
        }
      }
      return null;
    },
    // ---- Ticket 10 MySQL: คะแนนสะสมและรางวัล (ledger append-only + idempotent) ----
    async earnPointsForOrder(orderId: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const earned = await tryAutoEarnTx(conn, orderId, actor, now);
        return { earned, deduplicated: earned === 0 };
      });
    },
    async getLoyaltyBalance(customerId: string) {
      const [cRows] = (await pool.query("SELECT id FROM customers WHERE id = ? LIMIT 1", [customerId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (cRows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
      return loyaltyBalanceTx(pool, customerId);
    },
    async listLoyaltyLedger(customerId: string, limit: number) {
      const [cRows] = (await pool.query("SELECT id FROM customers WHERE id = ? LIMIT 1", [customerId])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (cRows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
      const n = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query("SELECT * FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?", [customerId, n])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToLoyaltyTx);
    },
    async createReward(input, actor) {
      return withPaymentTx(async (conn) => {
        const name = normalizeRewardName(input.name);
        const imageUrl = normalizeRewardImageUrl(input.imageUrl ?? null);
        const pointsCost = normalizeRewardPointsCost(input.pointsCost);
        const quotaTotal = normalizeRewardQuotaTotal(input.quotaTotal ?? null);
        const [menuRows] = (await conn.query("SELECT * FROM menu_items WHERE id = ? LIMIT 1", [input.menuId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (menuRows.length === 0) throw new NotFoundError("ไม่พบเมนูอ้างอิง");
        const menu = rowToMenu(menuRows[0]!);
        if (menu.kind !== "drink") throw new ConflictError("รางวัลแลกได้เฉพาะเมนูเครื่องดื่มเท่านั้น");
        if (menu.isArchived) throw new ConflictError("เมนูนี้ถูก archive แล้ว ใช้เป็นรางวัลไม่ได้");
        const startsAt = input.startsAt ?? null;
        const endsAt = input.endsAt ?? null;
        if (startsAt !== null && Number.isNaN(new Date(startsAt).getTime())) throw new Error("วันเริ่มแลกไม่ถูกต้อง");
        if (endsAt !== null && Number.isNaN(new Date(endsAt).getTime())) throw new Error("วันหมดเขตแลกไม่ถูกต้อง");
        if (startsAt !== null && endsAt !== null && new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
          throw new Error("วันเริ่มแลกต้องไม่หลังวันหมดเขตแลก");
        }
        const id = randomUUID();
        await conn.query(
          "INSERT INTO rewards (id, name, image_url, menu_id, menu_name, points_cost, quota_total, quota_used, starts_at, ends_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
          [
            id, name, imageUrl, menu.id, menu.name, pointsCost, quotaTotal,
            startsAt ? toMysqlDatetime(startsAt) : null,
            endsAt ? toMysqlDatetime(endsAt) : null,
            (input.isActive ?? true) ? 1 : 0,
          ],
        );
        const [rows] = (await conn.query("SELECT * FROM rewards WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const reward = rowToReward(rows[0]!);
        await insertAuditRow(conn, rewardCreatedEvent(reward, actor));
        return reward;
      });
    },
    async listRewards() {
      const [rows] = (await pool.query("SELECT * FROM rewards ORDER BY created_at DESC")) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToReward);
    },
    async listRedeemableRewards(now: Date = new Date()) {
      const [rows] = (await pool.query("SELECT * FROM rewards WHERE is_active = 1")) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[])
        .map(rowToReward)
        .filter((r) => rewardBlockReason(r, now) === null)
        .sort((a, b) => a.pointsCost - b.pointsCost || a.name.localeCompare(b.name, "th"));
    },
    async getReward(id: string) {
      const [rows] = (await pool.query("SELECT * FROM rewards WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      return rowToReward(rows[0]!);
    },
    async updateReward(id, patch, actor) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM rewards WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรางวัล");
        const before = rowToReward(rows[0]!);
        const sets: string[] = [];
        const params: unknown[] = [];
        let touched = false;
        let statusOnly = true;
        if (patch.name !== undefined) {
          sets.push("name = ?");
          params.push(normalizeRewardName(patch.name));
          touched = true;
          statusOnly = false;
        }
        if (patch.imageUrl !== undefined) {
          sets.push("image_url = ?");
          params.push(normalizeRewardImageUrl(patch.imageUrl));
          touched = true;
          statusOnly = false;
        }
        if (patch.pointsCost !== undefined) {
          sets.push("points_cost = ?");
          params.push(normalizeRewardPointsCost(patch.pointsCost));
          touched = true;
          statusOnly = false;
        }
        if (patch.quotaTotal !== undefined) {
          const q = normalizeRewardQuotaTotal(patch.quotaTotal);
          if (q !== null && q < before.quotaUsed) {
            throw new ConflictError(`จำนวนสิทธิ์ต้องไม่น้อยกว่าที่ใช้ไปแล้ว (${before.quotaUsed})`);
          }
          sets.push("quota_total = ?");
          params.push(q);
          touched = true;
          statusOnly = false;
        }
        const startsAt = patch.startsAt !== undefined ? patch.startsAt : before.startsAt;
        const endsAt = patch.endsAt !== undefined ? patch.endsAt : before.endsAt;
        if (startsAt !== null && Number.isNaN(new Date(startsAt).getTime())) throw new Error("วันเริ่มแลกไม่ถูกต้อง");
        if (endsAt !== null && Number.isNaN(new Date(endsAt).getTime())) throw new Error("วันหมดเขตแลกไม่ถูกต้อง");
        if (startsAt !== null && endsAt !== null && new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
          throw new Error("วันเริ่มแลกต้องไม่หลังวันหมดเขตแลก");
        }
        if (patch.startsAt !== undefined) {
          sets.push("starts_at = ?");
          params.push(patch.startsAt ? toMysqlDatetime(patch.startsAt) : null);
          touched = true;
          statusOnly = false;
        }
        if (patch.endsAt !== undefined) {
          sets.push("ends_at = ?");
          params.push(patch.endsAt ? toMysqlDatetime(patch.endsAt) : null);
          touched = true;
          statusOnly = false;
        }
        if (patch.isActive !== undefined) {
          if (typeof patch.isActive !== "boolean") throw new Error("สถานะรางวัลไม่ถูกต้อง");
          sets.push("is_active = ?");
          params.push(patch.isActive ? 1 : 0);
          touched = true;
        }
        if (!touched) return before;
        await conn.query(`UPDATE rewards SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        const [afterRows] = (await conn.query("SELECT * FROM rewards WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const after = rowToReward(afterRows[0]!);
        if (statusOnly) {
          await insertAuditRow(conn, rewardStatusChangedEvent(after, actor));
        } else {
          await insertAuditRow(conn, rewardUpdatedEvent({ pointsCost: before.pointsCost, quotaTotal: before.quotaTotal }, after, actor));
        }
        return after;
      });
    },
    async redeemReserve(input, actor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const key = normalizeLoyaltyIdempotencyKey(input.idempotencyKey);
        const hash = redemptionPayloadHash({ customerId: input.customerId, rewardId: input.rewardId });
        const [idemRows] = (await conn.query("SELECT * FROM reward_redemptions WHERE idempotency_key = ? LIMIT 1", [key])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (idemRows.length > 0) {
          const ex = rowToRedemption(idemRows[0]!);
          if (redemptionPayloadHash({ customerId: ex.customerId, rewardId: ex.rewardId }) !== hash) {
            throw new ConflictError("คำขอนี้ถูกใช้แลกไปแล้ว กรุณาสร้างคำขอใหม่");
          }
          return { redemption: ex, deduplicated: true };
        }
        const [cRows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [input.customerId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (cRows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        const customer = rowToCustomer(cRows[0]!);
        if (customer.isDeleted || !customer.isActive) {
          throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
        }
        const [rRows] = (await conn.query("SELECT * FROM rewards WHERE id = ? LIMIT 1 FOR UPDATE", [input.rewardId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rRows.length === 0) throw new NotFoundError("ไม่พบรางวัล");
        const reward = rowToReward(rRows[0]!);
        const blocked = rewardBlockReason(reward, now);
        if (blocked) throw new ConflictError(blocked);
        if (reward.quotaTotal !== null && reward.quotaUsed + (await rewardHeldCountTx(conn, reward.id)) >= reward.quotaTotal) {
          throw new ConflictError("สิทธิ์แลกของรางวัลนี้หมดแล้ว");
        }
        const balance = await loyaltyBalanceTx(conn, customer.id);
        const held = await loyaltyHeldTx(conn, customer.id);
        if (balance - held < reward.pointsCost) {
          throw new ConflictError(`คะแนนไม่พอแลก (ใช้ ${reward.pointsCost} แต้ม คงเหลือใช้ได้ ${balance - held} แต้ม)`);
        }
        if (!(await isMenuOrderableTx(conn, reward.menuId, 1))) {
          throw new ConflictError("วัตถุดิบสำหรับรางวัลนี้ไม่พอชั่วคราว กรุณาลองใหม่ภายหลัง");
        }
        const reason = input.reason === undefined || input.reason === null || input.reason === ""
          ? "แลกคะแนนเป็นเครื่องดื่ม"
          : normalizeLoyaltyReason(input.reason);
        const id = randomUUID();
        let code = generateRedemptionCode();
        for (let i = 0; i < 5; i += 1) {
          try {
            await conn.query(
              "INSERT INTO reward_redemptions (id, code, customer_id, reward_id, reward_name, menu_id, menu_name, points_cost, status, idempotency_key, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)",
              [id, code, customer.id, reward.id, reward.name, reward.menuId, reward.menuName, reward.pointsCost, key, reason],
            );
            break;
          } catch (err: unknown) {
            const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
            if (msg.includes("uq_redemption_code") && i < 4) {
              code = generateRedemptionCode();
              continue;
            }
            throw err;
          }
        }
        const [nRows] = (await conn.query("SELECT * FROM reward_redemptions WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (nRows.length === 0) throw new Error("บันทึกการแลกไม่สำเร็จ");
        const redemption = rowToRedemption(nRows[0]!);
        await insertAuditRow(conn, redemptionReservedEvent(redemption, balance - held - reward.pointsCost, actor));
        return { redemption, deduplicated: false };
      });
    },
    async getRedemption(id: string) {
      const [rows] = (await pool.query("SELECT * FROM reward_redemptions WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      return rowToRedemption(rows[0]!);
    },
    async listCustomerRedemptions(customerId: string, limit: number) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query("SELECT * FROM reward_redemptions WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?", [customerId, n])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToRedemption);
    },
    async listPendingRedemptions(limit: number) {
      const n = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query("SELECT * FROM reward_redemptions WHERE status = 'reserved' ORDER BY created_at ASC LIMIT ?", [n])) as [
        Record<string, unknown>[],
        unknown,
      ];
      return (rows as Record<string, unknown>[]).map(rowToRedemption);
    },
    async redeemConsume(id: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM reward_redemptions WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการแลก");
        const current = rowToRedemption(rows[0]!);
        if (current.status === "consumed") {
          const [jRows] = (await conn.query("SELECT * FROM queue_jobs WHERE reward_redemption_id = ? LIMIT 1", [current.id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (jRows.length === 0) throw new Error("งานคิวของรายการแลกนี้หายไป");
          const detail = await readQueueDetailTx(conn, String(jRows[0]!["id"]));
          if (!detail) throw new Error("งานคิวของรายการแลกนี้หายไป");
          return { redemption: current, job: detail };
        }
        assertRedemptionTransition(current.status, "consumed");
        const [rRows] = (await conn.query("SELECT * FROM rewards WHERE id = ? LIMIT 1 FOR UPDATE", [current.rewardId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rRows.length === 0) throw new NotFoundError("ไม่พบรางวัล");
        const reward = rowToReward(rRows[0]!);
        if (!reward.isActive) throw new ConflictError("รางวัลนี้ปิดรับแลกแล้ว");
        if (!(await isMenuOrderableTx(conn, current.menuId, 1))) {
          throw new ConflictError("วัตถุดิบหมดชั่วคราว รับรายการไม่ได้ กรุณาคืนคะแนนให้ลูกค้า");
        }
        await consumeStockForRewardTx(conn, current.menuId, current.code, current.menuName, actor);
        const job = await insertRewardJobTx(conn, current, actor, now);
        await conn.query("UPDATE reward_redemptions SET status = 'consumed', queue_job_id = ? WHERE id = ?", [job.id, current.id]);
        await conn.query("UPDATE rewards SET quota_used = quota_used + 1 WHERE id = ?", [reward.id]);
        await appendLoyaltyTx(conn, {
          customerId: current.customerId,
          points: -current.pointsCost,
          source: "reward_consume",
          orderId: null,
          paymentId: null,
          orderItemId: null,
          redemptionId: current.id,
          walkinTokenId: null,
          reason: `แลก ${current.rewardName} (${current.code})`,
          actorId: actor.actorId ?? null,
          actorUsername: actor.actorUsername ?? null,
        }, now);
        const consumed: RewardRedemption = { ...current, status: "consumed", queueJobId: job.id, updatedAt: now.toISOString() };
        await insertAuditRow(conn, redemptionConsumedEvent(consumed, job.id, actor));
        const detail = await readQueueDetailTx(conn, job.id);
        if (!detail) throw new Error("สร้างงานคิวเครื่องดื่มไม่สำเร็จ");
        return { redemption: consumed, job: detail };
      });
    },
    async redeemRelease(id: string, input: { reason: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM reward_redemptions WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการแลก");
        const current = rowToRedemption(rows[0]!);
        if (current.status === "released") {
          return { redemption: current, deduplicated: true };
        }
        assertRedemptionTransition(current.status, "released");
        const reason = normalizeLoyaltyReason(input.reason);
        await conn.query("UPDATE reward_redemptions SET status = 'released', reason = ? WHERE id = ?", [reason, id]);
        const released: RewardRedemption = { ...current, status: "released", reason, updatedAt: now.toISOString() };
        await insertAuditRow(conn, redemptionReleasedEvent(released, reason, actor));
        void now;
        return { redemption: released, deduplicated: false };
      });
    },
    async issueWalkinQr(actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const id = randomUUID();
        let token = generateWalkinToken();
        let code = buildWalkinCode(token);
        for (let i = 0; i < 5; i += 1) {
          try {
            await conn.query("INSERT INTO walkin_qr_tokens (id, code, created_by, expires_at) VALUES (?, ?, ?, ?)", [
              id, code, actor.actorUsername ?? actor.actorId ?? null,
              toMysqlDatetime(new Date(now.getTime() + WALKIN_QR_TTL_MINUTES * 60 * 1000).toISOString()),
            ]);
            break;
          } catch (err: unknown) {
            const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "";
            if (msg.includes("uq_walkin_code") && i < 4) {
              token = generateWalkinToken();
              code = buildWalkinCode(token);
              continue;
            }
            throw err;
          }
        }
        const [rows] = (await conn.query("SELECT * FROM walkin_qr_tokens WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new Error("ออก QR ไม่สำเร็จ");
        const created = rowToWalkin(rows[0]!);
        await insertAuditRow(conn, walkinIssuedEvent(created, actor));
        return created;
      });
    },
    async redeemWalkinQr(input: { code: string; customerId: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const code = normalizeWalkinCode(input.code);
        const [tRows] = (await conn.query("SELECT * FROM walkin_qr_tokens WHERE code = ? LIMIT 1 FOR UPDATE", [code])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (tRows.length === 0) throw new NotFoundError("ไม่พบรหัส QR นี้");
        const token = rowToWalkin(tRows[0]!);
        if (token.redeemedAt) throw new ConflictError("QR นี้ถูกใช้ไปแล้ว");
        if (new Date(token.expiresAt).getTime() < now.getTime()) {
          throw new ConflictError("QR นี้หมดอายุแล้ว (อายุ 10 นาที)");
        }
        const [cRows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [input.customerId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (cRows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        const customer = rowToCustomer(cRows[0]!);
        if (customer.isDeleted || !customer.isActive) {
          throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
        }
        await conn.query("UPDATE walkin_qr_tokens SET redeemed_at = ?, redeemed_by = ? WHERE id = ?", [
          toMysqlDatetime(now.toISOString()), customer.id, token.id,
        ]);
        const tx = await appendLoyaltyTx(conn, {
          customerId: customer.id,
          points: LOYALTY_POINTS_PER_DRINK_UNIT,
          source: "walkin",
          orderId: null,
          paymentId: null,
          orderItemId: null,
          redemptionId: null,
          walkinTokenId: token.id,
          reason: `สแกน QR Walk-in ${token.code}`,
          actorId: actor.actorId ?? null,
          actorUsername: actor.actorUsername ?? null,
        }, now);
        const redeemed: WalkinQrToken = { ...token, redeemedAt: now.toISOString(), redeemedBy: customer.id };
        await insertAuditRow(conn, walkinRedeemedEvent(redeemed, customer.id, actor));
        await insertAuditRow(conn, loyaltyEarnedEvent(tx, actor));
        return { token: redeemed, earned: LOYALTY_POINTS_PER_DRINK_UNIT };
      });
    },
    async linkGuestOrder(input: { orderId: string; customerId: string }, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [oRows] = (await conn.query("SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE", [input.orderId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        const order = rowToOrder(oRows[0]!);
        if (order.customerId !== null) throw new ConflictError("คำสั่งซื้อนี้ผูกบัญชีแล้ว");
        if (!order.guestPhone) throw new ConflictError("คำสั่งซื้อนี้ไม่ใช่ของ Guest");
        const [clRows] = (await conn.query("SELECT id FROM guest_link_claims WHERE order_id = ? LIMIT 1", [order.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (clRows.length > 0) throw new ConflictError("คำสั่งซื้อนี้ถูกผูกบัญชีไปแล้ว");
        const [cRows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1", [input.customerId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (cRows.length === 0) throw new NotFoundError("ไม่พบบัญชีลูกค้า");
        const customer = rowToCustomer(cRows[0]!);
        if (customer.isDeleted || !customer.isActive) {
          throw new ConflictError("บัญชีลูกค้าใช้งานไม่ได้ กรุณาเข้าสู่ระบบใหม่");
        }
        if (!customer.phone || normalizeThaiPhone(order.guestPhone) !== customer.phone) {
          throw new ConflictError("เบอร์โทรของคำสั่งซื้อนี้ไม่ตรงกับบัญชี กรุณาตรวจสอบอีกครั้ง");
        }
        if (now.getTime() - new Date(order.createdAt).getTime() > GUEST_LINK_WINDOW_HOURS * 60 * 60 * 1000) {
          throw new ConflictError("เกิน 24 ชั่วโมงหลังยืนยันคำสั่งซื้อ ผูกบัญชีไม่ได้แล้ว");
        }
        await conn.query("UPDATE orders SET customer_id = ? WHERE id = ?", [customer.id, order.id]);
        const claimId = randomUUID();
        await conn.query("INSERT INTO guest_link_claims (id, order_id, customer_id, guest_phone) VALUES (?, ?, ?, ?)", [
          claimId, order.id, customer.id, customer.phone,
        ]);
        await insertAuditRow(conn, guestLinkedEvent(order.id, customer.id, actor));
        const earned = await tryAutoEarnTx(conn, order.id, actor, now);
        const detail = await readOrderDetailTx(conn, order.id);
        if (!detail) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
        return { order: detail, earned };
      });
    },
    async mergeCustomerAccounts(
      input: { sourceCustomerId: string; targetCustomerId: string },
      actor: ShopActor,
      now: Date = new Date(),
    ) {
      return withPaymentTx(async (conn) => {
        if (input.sourceCustomerId === input.targetCustomerId) {
          throw new ConflictError("บัญชีต้นทางและปลายทางต้องเป็นคนละบัญชี");
        }
        const [dupRows] = (await conn.query(
          "SELECT * FROM customer_merges WHERE source_customer_id = ? AND target_customer_id = ? LIMIT 1",
          [input.sourceCustomerId, input.targetCustomerId],
        )) as [Record<string, unknown>[], unknown];
        if (dupRows.length > 0) {
          return { record: rowToMerge(dupRows[0]!), movedPoints: 0, deduplicated: true };
        }
        const [sRows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1 FOR UPDATE", [input.sourceCustomerId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const [tRows] = (await conn.query("SELECT * FROM customers WHERE id = ? LIMIT 1 FOR UPDATE", [input.targetCustomerId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (sRows.length === 0) throw new NotFoundError("ไม่พบบัญชีต้นทาง");
        if (tRows.length === 0) throw new NotFoundError("ไม่พบบัญชีปลายทาง");
        const source = rowToCustomer(sRows[0]!);
        const target = rowToCustomer(tRows[0]!);
        if (target.isDeleted || !target.isActive) throw new ConflictError("บัญชีปลายทางใช้งานไม่ได้");
        if (source.isDeleted || !source.isActive) throw new ConflictError("บัญชีต้นทางถูกปิดหรือรวมไปแล้ว");
        const movedPoints = await loyaltyBalanceTx(conn, source.id);
        await conn.query("UPDATE loyalty_transactions SET customer_id = ? WHERE customer_id = ?", [target.id, source.id]);
        await conn.query("UPDATE reward_redemptions SET customer_id = ? WHERE customer_id = ?", [target.id, source.id]);
        await conn.query("UPDATE guest_link_claims SET customer_id = ? WHERE customer_id = ?", [target.id, source.id]);
        // ย้าย LINE link เฉพาะเมื่อปลายทางยังไม่มี (กันขัดแย้ง 1:1)
        const [linkRows] = (await conn.query("SELECT * FROM customer_line_links WHERE customer_id = ? LIMIT 1", [source.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (linkRows.length > 0) {
          const [tLinkRows] = (await conn.query("SELECT customer_id FROM customer_line_links WHERE customer_id = ? LIMIT 1", [target.id])) as [
            Record<string, unknown>[],
            unknown,
          ];
          if (tLinkRows.length === 0) {
            await conn.query("UPDATE customer_line_links SET customer_id = ? WHERE customer_id = ?", [target.id, source.id]);
          } else {
            await conn.query("DELETE FROM customer_line_links WHERE customer_id = ?", [source.id]);
          }
        }
        await conn.query(
          "UPDATE customers SET name = ?, phone = NULL, email = NULL, password_hash = ?, is_active = 0, is_deleted = 1, deleted_at = ? WHERE id = ?",
          ["ลูกค้าที่รวมบัญชีแล้ว", `merged:${source.id}`, toMysqlDatetime(now.toISOString()), source.id],
        );
        await conn.query("DELETE FROM customer_sessions WHERE customer_id = ?", [source.id]);
        const recordId = randomUUID();
        await conn.query("INSERT INTO customer_merges (id, source_customer_id, target_customer_id, approved_by) VALUES (?, ?, ?, ?)", [
          recordId, source.id, target.id, actor.actorUsername ?? actor.actorId ?? null,
        ]);
        const [mRows] = (await conn.query("SELECT * FROM customer_merges WHERE id = ? LIMIT 1", [recordId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const record = rowToMerge(mRows[0]!);
        await insertAuditRow(conn, accountMergedEvent(source.id, target.id, movedPoints, actor));
        return { record, movedPoints, deduplicated: false };
      });
    },
    async reversePointsOnRefund(orderId: string, refundId: string, actor: ShopActor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [fRows] = (await conn.query("SELECT id FROM refunds WHERE id = ? LIMIT 1", [refundId])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (fRows.length === 0) throw new NotFoundError("ไม่พบคำขอคืนเงิน");
        return reversePointsTx(conn, orderId, refundId, actor, now);
      });
    },
    // ---- Ticket 11 MySQL: รายการเงินมือ + รายงาน/Dashboard (derived รายรับจาก payments/refunds) ----
    async createFinanceEntry(input, actor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const kind = normalizeFinanceKind(input.kind);
        const category = normalizeFinanceCategory(kind, input.category);
        const amount = roundBaht2(normalizeFinanceAmount(input.amount));
        const occurredAt = normalizeFinanceOccurredAt(input.occurredAt);
        const note = normalizeFinanceNote(input.note ?? null);
        const reason = normalizeFinanceReason(input.reason);
        const id = randomUUID();
        await conn.query(
          "INSERT INTO finance_entries (id, kind, category, amount, occurred_at, note, reason, actor_id, actor_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, kind, category, amount, toMysqlDatetime(occurredAt), note, reason, actor.actorId ?? null, actor.actorUsername ?? null],
        );
        const [rows] = (await conn.query("SELECT * FROM finance_entries WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new Error("บันทึกรายการเงินไม่สำเร็จ");
        const entry = rowToFinanceEntry(rows[0]!);
        await insertAuditRow(conn, financeEntryCreatedEvent(entry, actor));
        void now;
        return entry;
      });
    },
    async getFinanceEntry(id: string) {
      const [rows] = (await pool.query("SELECT * FROM finance_entries WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      return rowToFinanceEntry(rows[0]!);
    },
    async listFinanceEntries(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const conds: string[] = [];
      const params: unknown[] = [];
      if (filter.kind) {
        conds.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter.category) {
        conds.push("category = ?");
        params.push(filter.category);
      }
      if (filter.fromOccurredAt) {
        conds.push("occurred_at >= ?");
        params.push(toMysqlDatetime(filter.fromOccurredAt));
      }
      if (filter.toOccurredAt) {
        conds.push("occurred_at <= ?");
        params.push(toMysqlDatetime(filter.toOccurredAt));
      }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
      const [rows] = (await pool.query(
        `SELECT * FROM finance_entries ${where} ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
        [...params, limit],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToFinanceEntry);
    },
    async updateFinanceEntry(id, patch, actor, now: Date = new Date()) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM finance_entries WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการเงิน");
        const before = rowToFinanceEntry(rows[0]!);
        const reason = normalizeFinanceReason(patch.reason);
        const sets: string[] = [];
        const params: unknown[] = [];
        let category = before.category;
        let amount = before.amount;
        let occurredAt = before.occurredAt;
        let note = before.note;
        if (patch.category !== undefined) {
          category = normalizeFinanceCategory(before.kind, patch.category);
          sets.push("category = ?");
          params.push(category);
        }
        if (patch.amount !== undefined) {
          amount = roundBaht2(normalizeFinanceAmount(patch.amount));
          sets.push("amount = ?");
          params.push(amount);
        }
        if (patch.occurredAt !== undefined) {
          occurredAt = normalizeFinanceOccurredAt(patch.occurredAt);
          sets.push("occurred_at = ?");
          params.push(toMysqlDatetime(occurredAt));
        }
        if (patch.note !== undefined) {
          note = normalizeFinanceNote(patch.note);
          sets.push("note = ?");
          params.push(note);
        }
        if (sets.length > 0) {
          await conn.query(`UPDATE finance_entries SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        }
        const [afterRows] = (await conn.query("SELECT * FROM finance_entries WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const after = rowToFinanceEntry(afterRows[0]!);
        await insertAuditRow(conn, financeEntryUpdatedEvent(before, after, reason, actor));
        void now;
        return after;
      });
    },
    async deleteFinanceEntry(id, input, actor) {
      return withPaymentTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM finance_entries WHERE id = ? LIMIT 1 FOR UPDATE", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        if (rows.length === 0) throw new NotFoundError("ไม่พบรายการเงิน");
        const entry = rowToFinanceEntry(rows[0]!);
        const reason = normalizeFinanceReason(input.reason);
        await conn.query("DELETE FROM finance_entries WHERE id = ?", [id]);
        await insertAuditRow(conn, financeEntryDeletedEvent(entry, reason, actor));
      });
    },
    async getFinanceReport(input) {
      const { startMysql, endExclusiveMysql } = financeWindowMysql(input.from, input.to);
      const [payRows] = (await pool.query(
        "SELECT amount, paid_at, order_id FROM payments WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?",
        [startMysql, endExclusiveMysql],
      )) as [Record<string, unknown>[], unknown];
      const paidPayments = (payRows as Record<string, unknown>[]).map((r) => ({
        amount: Number(r["amount"]),
        paidAt: r["paid_at"] == null ? null : new Date(r["paid_at"] as string).toISOString(),
        orderId: String(r["order_id"]),
      }));
      const [refRows] = (await pool.query(
        "SELECT amount, approved_at FROM refunds WHERE approved_at >= ? AND approved_at < ?",
        [startMysql, endExclusiveMysql],
      )) as [Record<string, unknown>[], unknown];
      const allRefunds = (refRows as Record<string, unknown>[]).map((r) => ({
        amount: Number(r["amount"]),
        approvedAt: new Date(r["approved_at"] as string).toISOString(),
      }));
      const [entRows] = (await pool.query(
        "SELECT kind, amount, occurred_at FROM finance_entries WHERE occurred_at >= ? AND occurred_at < ?",
        [startMysql, endExclusiveMysql],
      )) as [Record<string, unknown>[], unknown];
      const allEntries = (entRows as Record<string, unknown>[]).map((r) => ({
        kind: String(r["kind"]) as FinanceKind,
        amount: Number(r["amount"]),
        occurredAt: new Date(r["occurred_at"] as string).toISOString(),
      }));
      const orderIds = [...new Set(paidPayments.map((p) => p.orderId))];
      const costByOrder = new Map<string, number>();
      for (let i = 0; i < orderIds.length; i += 500) {
        const chunk = orderIds.slice(i, i + 500);
        const [oRows] = (await pool.query(
          `SELECT id, estimated_cost FROM orders WHERE id IN (${chunk.map(() => "?").join(",")})`,
          chunk,
        )) as [Record<string, unknown>[], unknown];
        for (const r of oRows as Record<string, unknown>[]) {
          costByOrder.set(String(r["id"]), Number(r["estimated_cost"] ?? 0));
        }
      }
      return buildFinanceReport({
        granularity: input.granularity,
        from: input.from,
        to: input.to,
        paidPayments,
        allRefunds,
        allEntries,
        orderById: (oid) => {
          const c = costByOrder.get(oid);
          return c === undefined ? null : { estimatedCost: c };
        },
      });
    },
    async getFinanceDashboard(date, now: Date = new Date()) {
      const report = await mysqlStore.getFinanceReport({ granularity: "day", from: date, to: date });
      const day = report.buckets[0] ?? emptyFinanceBucket(date);
      const topMenus = await mysqlStore.getFinanceTopMenus({ from: date, to: date, limit: 5 });
      const peakHours = await mysqlStore.getFinancePeakHours({ from: date, to: date });
      const [tRows] = (await pool.query("SELECT id, is_enabled FROM shop_tables")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const enabled = (tRows as Record<string, unknown>[]).filter((r) => Number(r["is_enabled"]) === 1);
      const [roundRows] = (await pool.query(
        "SELECT table_id, party_size FROM table_rounds WHERE status = 'open'",
      )) as [Record<string, unknown>[], unknown];
      const openRounds = roundRows as Record<string, unknown>[];
      const occupancy: FinanceOccupancy | null =
        enabled.length === 0
          ? null
          : {
              enabledTables: enabled.length,
              occupiedTables: new Set(openRounds.map((r) => String(r["table_id"]))).size,
              freeTables: enabled.length - new Set(openRounds.map((r) => String(r["table_id"]))).size,
              customerCount: openRounds.reduce((sum, r) => sum + Number(r["party_size"] ?? 0), 0),
            };
      void now;
      const [sRows] = (await pool.query(
        "SELECT on_hand, reserved, reorder_threshold, is_enabled FROM ingredients WHERE is_enabled = 1",
      )) as [Record<string, unknown>[], unknown];
      const lowStockCount = (sRows as Record<string, unknown>[]).filter(
        (r) => Number(r["on_hand"]) - Number(r["reserved"]) < Number(r["reorder_threshold"]),
      ).length;
      return {
        date,
        netSales: day.netRevenue,
        grossRevenue: day.grossRevenue,
        refunds: day.refunds,
        paidOrders: day.paidOrders,
        averageTicket: day.paidOrders === 0 ? 0 : roundBaht2(day.netRevenue / day.paidOrders),
        manualIncome: day.manualIncome,
        actualExpense: day.actualExpense,
        grossProfit: day.grossProfit,
        estimatedCost: day.estimatedCost,
        topMenus,
        peakHours,
        occupancy,
        lowStockCount,
      };
    },
    async getFinanceTopMenus(input) {
      const limit = Math.min(Math.max(input.limit || 10, 1), 50);
      const { startMysql, endExclusiveMysql } = financeWindowMysql(input.from, input.to);
      const [payRows] = (await pool.query(
        "SELECT id, order_id, paid_at FROM payments WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?",
        [startMysql, endExclusiveMysql],
      )) as [Record<string, unknown>[], unknown];
      const paidPayments = (payRows as Record<string, unknown>[]).map((r) => ({
        paidAt: r["paid_at"] == null ? null : new Date(r["paid_at"] as string).toISOString(),
        orderId: String(r["order_id"]),
      }));
      const orderIds = [...new Set(paidPayments.map((p) => p.orderId))];
      const grouped = new Map<
        string,
        { menuId: string; menuName: string; quantity: number; unitPrice: number; lineTotal: number }[]
      >();
      for (let i = 0; i < orderIds.length; i += 500) {
        const chunk = orderIds.slice(i, i + 500);
        const [iRows] = (await pool.query(
          `SELECT order_id, menu_id, menu_name, quantity, unit_price, line_total FROM order_items WHERE order_id IN (${chunk.map(() => "?").join(",")})`,
          chunk,
        )) as [Record<string, unknown>[], unknown];
        for (const r of iRows as Record<string, unknown>[]) {
          const oid = String(r["order_id"]);
          const list = grouped.get(oid) ?? [];
          list.push({
            menuId: String(r["menu_id"]),
            menuName: String(r["menu_name"]),
            quantity: Number(r["quantity"]),
            unitPrice: Number(r["unit_price"]),
            lineTotal: Number(r["line_total"]),
          });
          grouped.set(oid, list);
        }
      }
      return buildFinanceTopMenus({
        from: input.from,
        to: input.to,
        limit,
        paidPayments,
        itemsByOrder: (oid) => grouped.get(oid) ?? [],
      });
    },
    async getFinancePeakHours(input) {
      const { startMysql, endExclusiveMysql } = financeWindowMysql(input.from, input.to);
      const [payRows] = (await pool.query(
        "SELECT amount, paid_at FROM payments WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?",
        [startMysql, endExclusiveMysql],
      )) as [Record<string, unknown>[], unknown];
      return buildFinancePeakHours({
        from: input.from,
        to: input.to,
        paidPayments: (payRows as Record<string, unknown>[]).map((r) => ({
          amount: Number(r["amount"]),
          paidAt: r["paid_at"] == null ? null : new Date(r["paid_at"] as string).toISOString(),
        })),
      });
    },
    // ---- Ticket 12 MySQL: outbox แจ้งเตือน (mutation เขียนพร้อม audit ใน tx เดียว) ----
    async queueNotification(input, actor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const eventKey = normalizeNotificationEventKey(input.eventKey);
        const [dup] = (await conn.query("SELECT * FROM notifications WHERE event_key = ? LIMIT 1", [
          eventKey,
        ])) as [Record<string, unknown>[], unknown];
        if (dup.length > 0) return { notification: rowToNotification(dup[0]!), deduplicated: true };
        const kind = normalizeNotificationKind(input.kind);
        const message = normalizeNotificationMessage(input.message);
        const maxAttempts = maxNotificationAttempts(input.maxAttempts);
        const id = randomUUID();
        const at = toMysqlDatetime(now.toISOString());
        await conn.query(
          "INSERT INTO notifications (id, event_key, kind, customer_id, order_id, reservation_id, payment_id, message, status, attempts, max_attempts, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
          [
            id,
            eventKey,
            kind,
            input.customerId?.trim() ? input.customerId.trim() : null,
            input.orderId?.trim() ? input.orderId.trim() : null,
            input.reservationId?.trim() ? input.reservationId.trim() : null,
            input.paymentId?.trim() ? input.paymentId.trim() : null,
            message,
            maxAttempts,
            at,
          ],
        );
        const [rows] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const n = rowToNotification(rows[0]!);
        await insertAuditRow(conn, notificationQueuedEvent(n, actor));
        return { notification: n, deduplicated: false };
      });
    },
    async getNotification(id: string) {
      const key = normalizeNotificationId(id);
      const [rows] = (await pool.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [key])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      return rowToNotification(rows[0]!);
    },
    async getNotificationByEventKey(eventKey: string) {
      const key = normalizeNotificationEventKey(eventKey);
      const [rows] = (await pool.query("SELECT * FROM notifications WHERE event_key = ? LIMIT 1", [key])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) return null;
      return rowToNotification(rows[0]!);
    },
    async listNotifications(filter) {
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const conds: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        conds.push("status = ?");
        params.push(filter.status);
      }
      if (filter.kind) {
        conds.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter.customerId) {
        conds.push("customer_id = ?");
        params.push(filter.customerId);
      }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
      const [rows] = (await pool.query(
        `SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [...params, limit],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToNotification);
    },
    async listDueNotifications(now: Date, limit: number) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query(
        "SELECT * FROM notifications WHERE status = 'pending' OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?) ORDER BY created_at ASC, id ASC LIMIT ?",
        [toMysqlDatetime(now.toISOString()), capped],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToNotification);
    },
    async claimNotification(id: string, now: Date = new Date()) {
      const key = normalizeNotificationId(id);
      // กัน flush ซ้อน: อัปเดตแบบมีเงื่อนไขสถานะใน statement เดียว
      const at = toMysqlDatetime(now.toISOString());
      const [res] = (await pool.query(
        "UPDATE notifications SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND (status = 'pending' OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?))",
        [key, at],
      )) as [{ affectedRows: number }, unknown];
      if ((res as { affectedRows: number }).affectedRows === 0) return null;
      return mysqlStore.getNotification(key);
    },
    async completeNotificationSend(id: string, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1 FOR UPDATE", [
          normalizeNotificationId(id),
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        const n = rowToNotification(rows[0]!);
        if (n.status !== "sending") throw new ConflictError("งานนี้ไม่ได้อยู่ในสถานะกำลังส่ง");
        const at = toMysqlDatetime(now.toISOString());
        await conn.query("UPDATE notifications SET status = 'sent', sent_at = ?, next_retry_at = NULL WHERE id = ?", [
          at,
          n.id,
        ]);
        const [after] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [n.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const next = rowToNotification(after[0]!);
        await insertAuditRow(conn, notificationSentEvent(next, actor));
        return next;
      });
    },
    async failNotificationSend(id: string, input, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1 FOR UPDATE", [
          normalizeNotificationId(id),
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        const n = rowToNotification(rows[0]!);
        if (n.status !== "sending") throw new ConflictError("งานนี้ไม่ได้อยู่ในสถานะกำลังส่ง");
        const error = sanitizeNotificationError(input.error);
        const status = input.nextRetryAt ? "failed" : "dead_letter";
        await conn.query("UPDATE notifications SET status = ?, next_retry_at = ?, last_error = ? WHERE id = ?", [
          status,
          input.nextRetryAt ? toMysqlDatetime(input.nextRetryAt) : null,
          error,
          n.id,
        ]);
        const [after] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [n.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const next = rowToNotification(after[0]!);
        await insertAuditRow(
          conn,
          input.nextRetryAt ? notificationFailedEvent(next, error, actor) : notificationDeadLetterEvent(next, actor),
        );
        return next;
      });
    },
    async skipNotification(id: string, reason: string, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1 FOR UPDATE", [
          normalizeNotificationId(id),
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        const n = rowToNotification(rows[0]!);
        if (n.status === "sent" || n.status === "skipped" || n.status === "dead_letter") {
          throw new ConflictError("งานนี้ข้ามไม่ได้ (ส่งแล้ว/ข้ามแล้ว/เลิกส่งแล้ว)");
        }
        const trimmed = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : "ข้ามการส่ง";
        await conn.query("UPDATE notifications SET status = 'skipped', next_retry_at = NULL, last_error = ? WHERE id = ?", [
          trimmed,
          n.id,
        ]);
        const [after] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [n.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const next = rowToNotification(after[0]!);
        await insertAuditRow(conn, notificationSkippedEvent(next, trimmed, actor));
        return next;
      });
    },
    async retryNotification(id: string, input, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1 FOR UPDATE", [
          normalizeNotificationId(id),
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบการแจ้งเตือน");
        const n = rowToNotification(rows[0]!);
        if (n.status !== "failed" && n.status !== "dead_letter" && n.status !== "skipped") {
          throw new ConflictError("งานนี้ไม่ต้องส่งซ้ำ (ยังรอส่ง/กำลังส่ง/ส่งแล้ว)");
        }
        const reason =
          typeof input.reason === "string" && input.reason.trim()
            ? input.reason.trim().slice(0, 500)
            : "สั่งส่งซ้ำด้วยมือ";
        const at = toMysqlDatetime(now.toISOString());
        await conn.query(
          "UPDATE notifications SET status = 'pending', attempts = 0, next_retry_at = ?, last_error = NULL, sent_at = NULL WHERE id = ?",
          [at, n.id],
        );
        const [after] = (await conn.query("SELECT * FROM notifications WHERE id = ? LIMIT 1", [n.id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const next = rowToNotification(after[0]!);
        await insertAuditRow(conn, notificationRetriedEvent(next, reason, actor));
        return next;
      });
    },
    async setNotificationConsent(customerId: string, enabled: boolean, _actor: ShopActor) {
      const id = normalizeNotificationId(customerId, "รหัสลูกค้าไม่ถูกต้อง");
      await pool.query(
        "INSERT INTO notification_consents (customer_id, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)",
        [id, enabled ? 1 : 0],
      );
    },
    async isNotificationEnabled(customerId: string) {
      const id = customerId.trim();
      if (!id) return false;
      const [rows] = (await pool.query("SELECT enabled FROM notification_consents WHERE customer_id = ? LIMIT 1", [
        id,
      ])) as [Record<string, unknown>[], unknown];
      if (rows.length === 0) return true;
      return Number(rows[0]!["enabled"]) === 1;
    },
    async listUpcomingReservations(fromIso: string, toIso: string, limit: number) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      const fromT = new Date(fromIso).getTime();
      const toT = new Date(toIso).getTime();
      if (Number.isNaN(fromT) || Number.isNaN(toT)) throw new Error("ช่วงเวลานัดไม่ถูกต้อง");
      const [rows] = (await pool.query(
        "SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN shop_tables t ON t.id = r.table_id WHERE r.status IN ('pending','confirmed') AND r.reserved_at >= ? AND r.reserved_at <= ? ORDER BY r.reserved_at ASC LIMIT ?",
        [toMysqlDatetime(fromIso), toMysqlDatetime(toIso), capped],
      )) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = rowToReservation(row);
        return { ...r, tableName: row["table_name"] ? String(row["table_name"]) : "-" };
      });
    },
    // ---- Ticket 13 MySQL: capacity + wait prediction (baseline deterministic) ----
    async getCapacityOverview(now: Date = new Date()) {
      const at = now.toISOString();
      const [capRows] = (await pool.query("SELECT station, per_slot FROM station_capacity")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const capOf = (st: QueueStation): number => {
        const row = (capRows as Record<string, unknown>[]).find((r) => String(r["station"]) === st);
        return row ? Number(row["per_slot"]) : QUEUE_DEFAULT_CAPACITY_PER_SLOT;
      };
      const [jobRows] = (await pool.query(
        "SELECT station, COUNT(*) AS c, COALESCE(SUM(quantity - ready_qty), 0) AS u FROM queue_jobs WHERE status IN ('queued','claimed','preparing') AND ready_at <= ? GROUP BY station",
        [toMysqlDatetime(at)],
      )) as [Record<string, unknown>[], unknown];
      const loadOf = (st: QueueStation): { queueAhead: number; unitsAhead: number } => {
        const row = (jobRows as Record<string, unknown>[]).find((r) => String(r["station"]) === st);
        return {
          queueAhead: row ? Number(row["c"]) : 0,
          unitsAhead: row ? Math.max(0, Number(row["u"])) : 0,
        };
      };
      const stations: CapacityStationSummary[] = (["kitchen", "drink"] as QueueStation[]).map((st) => {
        const load = loadOf(st);
        const estimatedWaitMin = computeStationWaitMin(st, load.queueAhead, 2);
        const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
        return {
          station: st,
          perSlot: capOf(st),
          activeJobs: load.queueAhead,
          unitsAhead: load.unitsAhead,
          estimatedWaitMin,
          rangeMin,
          rangeMax,
          source: "baseline" as PredictionSource,
        };
      });
      const [tRows] = (await pool.query("SELECT id, is_enabled FROM shop_tables")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const enabled = (tRows as Record<string, unknown>[]).filter((r) => Number(r["is_enabled"]) === 1);
      const [roundRows] = (await pool.query(
        "SELECT table_id, party_size FROM table_rounds WHERE status = 'open'",
      )) as [Record<string, unknown>[], unknown];
      const openRounds = roundRows as Record<string, unknown>[];
      const occupied = new Set(openRounds.map((r) => String(r["table_id"]))).size;
      return {
        at,
        stations,
        enabledTables: enabled.length,
        freeTables: enabled.length - occupied,
        occupiedTables: occupied,
        customerCount: openRounds.reduce((s, r) => s + Number(r["party_size"] ?? 0), 0),
      };
    },
    async estimateOrderWaitBaseline(orderId: string, partySize: number, now: Date = new Date()) {
      const id = orderId.trim();
      if (!id) throw new Error("กรุณาระบุคำสั่งซื้อ");
      const party = normalizePredictionPartySize(partySize);
      const [oRows] = (await pool.query("SELECT id FROM orders WHERE id = ? LIMIT 1", [id])) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (oRows.length === 0) throw new NotFoundError("ไม่พบคำสั่งซื้อ");
      const [jRows] = (await pool.query(
        "SELECT station, ready_at, is_remake, is_priority, quantity, ready_qty FROM queue_jobs WHERE order_id = ? AND status != 'cancelled'",
        [id],
      )) as [Record<string, unknown>[], unknown];
      const [aRows] = (await pool.query(
        "SELECT station, COUNT(*) AS c, COALESCE(SUM(quantity - ready_qty), 0) AS u FROM queue_jobs WHERE status IN ('queued','claimed','preparing') AND ready_at <= ? GROUP BY station",
        [toMysqlDatetime(now.toISOString())],
      )) as [Record<string, unknown>[], unknown];
      const loadOf = (st: QueueStation): { queueAhead: number; unitsAhead: number } => {
        const row = (aRows as Record<string, unknown>[]).find((r) => String(r["station"]) === st);
        return {
          queueAhead: row ? Number(row["c"]) : 0,
          unitsAhead: row ? Math.max(0, Number(row["u"])) : 0,
        };
      };
      const perStation: WaitStationBreakdown[] = [];
      let readyAtSlowest: string | null = null;
      for (const st of ["kitchen", "drink"] as QueueStation[]) {
        const mine = (jRows as Record<string, unknown>[]).filter((r) => String(r["station"]) === st);
        if (mine.length === 0) continue;
        const load = loadOf(st);
        perStation.push({
          station: st,
          jobs: mine.length,
          queueAhead: load.queueAhead,
          unitsAhead: load.unitsAhead,
          estimatedWaitMin: computeStationWaitMin(st, load.queueAhead, party),
        });
        for (const r of mine) {
          const iso = new Date(r["ready_at"] as string).toISOString();
          if (readyAtSlowest === null || iso > readyAtSlowest) readyAtSlowest = iso;
        }
      }
      const [mRows] = (await pool.query("SELECT timeout_ms FROM prediction_models WHERE id = 'default' LIMIT 1")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const estimatedWaitMin = perStation.length === 0 ? 0 : Math.max(...perStation.map((p) => p.estimatedWaitMin));
      const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
      return {
        orderId: id,
        station: null,
        partySize: party,
        perStation,
        estimatedWaitMin,
        rangeMin,
        rangeMax,
        readyAtSlowest,
        source: "baseline" as PredictionSource,
        modelVersion: PREDICTION_BASELINE_VERSION,
        predictedAt: now.toISOString(),
        timeoutMs: mRows.length === 0 ? PREDICTION_DEFAULT_TIMEOUT_MS : Number(mRows[0]!["timeout_ms"]),
        nonGuarantee: PREDICTION_NON_GUARANTEE,
      };
    },
    async checkPreorderSlot(station: QueueStation, scheduledAt: string, partySize: number, now: Date = new Date()) {
      const st = normalizeStation(station);
      const at = normalizePredictionScheduledAt(scheduledAt, now);
      const party = normalizePredictionPartySize(partySize);
      const slotStart = slotStartOf(new Date(at));
      const slotEnd = new Date(slotStart.getTime() + QUEUE_SLOT_MINUTES * 60 * 1000);
      const used = await countJobsInSlotTx(pool, st, slotStart);
      const capacity = await readCapacityTx(pool, st);
      const available = used < capacity;
      const estimatedWaitMin = computeStationWaitMin(st, used, party);
      const { rangeMin, rangeMax } = waitRangeOf(estimatedWaitMin);
      let suggestedSlot = null;
      if (!available) {
        suggestedSlot = await mysqlStore.suggestNextSlot(st, at, now);
      }
      return {
        station: st,
        scheduledAt: at,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        used,
        capacity,
        available,
        estimatedWaitMin,
        rangeMin,
        rangeMax,
        suggestedSlot,
      };
    },
    async getPredictionModel() {
      const [rows] = (await pool.query("SELECT * FROM prediction_models WHERE id = 'default' LIMIT 1")) as [
        Record<string, unknown>[],
        unknown,
      ];
      if (rows.length === 0) {
        return {
          version: PREDICTION_BASELINE_VERSION,
          kind: "baseline" as const,
          enabled: true,
          thresholdMinutes: PREDICTION_DEFAULT_THRESHOLD_MINUTES,
          timeoutMs: PREDICTION_DEFAULT_TIMEOUT_MS,
          samples: 0,
          maeBaseline: null,
          maeModel: null,
          trainedAt: null,
          updatedBy: null,
          updatedAt: new Date().toISOString(),
        };
      }
      const m = rowToPredictionModel(rows[0]!);
      const [fRows] = (await pool.query(
        "SELECT baseline_min, predicted_min, source, actual_min FROM prediction_features WHERE actual_min IS NOT NULL",
      )) as [Record<string, unknown>[], unknown];
      const r = evaluateAccuracySamples(
        (fRows as Record<string, unknown>[]).map((x) => ({
          baselineMin: Number(x["baseline_min"]),
          predictedMin: x["predicted_min"] == null ? null : Number(x["predicted_min"]),
          source: String(x["source"]) === "model" ? ("model" as const) : ("baseline" as const),
          actualMin: Number(x["actual_min"]),
        })),
        m.thresholdMinutes,
      );
      return { ...m, samples: r.samples, maeBaseline: r.maeBaseline, maeModel: r.maeModel };
    },
    async setPredictionModel(patch, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const [rows] = (await conn.query("SELECT * FROM prediction_models WHERE id = 'default' LIMIT 1")) as [
          Record<string, unknown>[],
          unknown,
        ];
        const before =
          rows.length === 0
            ? {
                version: PREDICTION_BASELINE_VERSION,
                kind: "baseline" as const,
                enabled: true,
                thresholdMinutes: PREDICTION_DEFAULT_THRESHOLD_MINUTES,
                timeoutMs: PREDICTION_DEFAULT_TIMEOUT_MS,
                samples: 0,
                maeBaseline: null,
                maeModel: null,
                trainedAt: null,
                updatedBy: null,
                updatedAt: now.toISOString(),
              }
            : { ...rowToPredictionModel(rows[0]!), samples: 0, maeBaseline: null, maeModel: null };
        const next: PredictionModel = { ...before };
        if (patch.version !== undefined) next.version = normalizeModelVersion(patch.version);
        if (patch.kind !== undefined) {
          if (patch.kind !== "baseline" && patch.kind !== "external") throw new Error("ชนิดโมเดลไม่ถูกต้อง");
          next.kind = patch.kind;
        }
        if (patch.enabled !== undefined) next.enabled = patch.enabled !== false;
        if (patch.thresholdMinutes !== undefined) next.thresholdMinutes = normalizePredictionThreshold(patch.thresholdMinutes);
        if (patch.timeoutMs !== undefined) next.timeoutMs = normalizePredictionTimeoutMs(patch.timeoutMs);
        next.updatedBy = actor.actorUsername ?? actor.actorId ?? null;
        next.updatedAt = now.toISOString();
        await conn.query(
          "INSERT INTO prediction_models (id, version, kind, enabled, threshold_minutes, timeout_ms, updated_by) VALUES ('default', ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), kind = VALUES(kind), enabled = VALUES(enabled), threshold_minutes = VALUES(threshold_minutes), timeout_ms = VALUES(timeout_ms), updated_by = VALUES(updated_by)",
          [next.version, next.kind, next.enabled ? 1 : 0, next.thresholdMinutes, next.timeoutMs, next.updatedBy],
        );
        await insertAuditRow(conn, predictionModelUpdatedEvent(before, next, actor));
        return { ...next };
      });
    },
    async recordPredictionFeature(input, actor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const party = normalizePredictionPartySize(input.partySize);
        const orderId = input.orderId ? String(input.orderId) : null;
        let station: QueueStation | null = null;
        if (input.station) station = normalizeStation(input.station);
        let orderJobs: { station: string; isRemake: number; isPriority: number }[] = [];
        if (orderId !== null) {
          const [jRows] = (await conn.query(
            "SELECT station, is_remake, is_priority FROM queue_jobs WHERE order_id = ? AND status != 'cancelled'",
            [orderId],
          )) as [Record<string, unknown>[], unknown];
          orderJobs = (jRows as Record<string, unknown>[]).map((r) => ({
            station: String(r["station"]),
            isRemake: Number(r["is_remake"] ?? 0),
            isPriority: Number(r["is_priority"] ?? 0),
          }));
        }
        if (!station && orderJobs.length > 0) {
          let slowest: QueueStation | null = null;
          let slowestWait = -1;
          for (const st of ["kitchen", "drink"] as QueueStation[]) {
            if (!orderJobs.some((j) => j.station === st)) continue;
            const [cRows] = (await conn.query(
              "SELECT COUNT(*) AS c FROM queue_jobs WHERE station = ? AND status IN ('queued','claimed','preparing') AND ready_at <= ?",
              [st, toMysqlDatetime(now.toISOString())],
            )) as [Record<string, unknown>[], unknown];
            const ahead = Number((cRows as Record<string, unknown>[])[0]?.["c"] ?? 0);
            const w = computeStationWaitMin(st, ahead, party);
            if (w > slowestWait) {
              slowestWait = w;
              slowest = st;
            }
          }
          station = slowest;
        }
        let queueAhead = 0;
        let unitsAhead = 0;
        if (station) {
          const [cRows] = (await conn.query(
            "SELECT COUNT(*) AS c, COALESCE(SUM(quantity - ready_qty), 0) AS u FROM queue_jobs WHERE station = ? AND status IN ('queued','claimed','preparing') AND ready_at <= ?",
            [station, toMysqlDatetime(now.toISOString())],
          )) as [Record<string, unknown>[], unknown];
          queueAhead = Number((cRows as Record<string, unknown>[])[0]?.["c"] ?? 0);
          unitsAhead = Math.max(0, Number((cRows as Record<string, unknown>[])[0]?.["u"] ?? 0));
        }
        const parts = bangkokHourParts(now);
        const source: PredictionSource = input.source === "model" ? "model" : "baseline";
        const predictedMin =
          source === "model" && typeof input.predictedMin === "number" ? Math.max(0, Math.round(input.predictedMin)) : null;
        const id = randomUUID();
        await conn.query(
          "INSERT INTO prediction_features (id, order_id, station, party_size, queue_ahead, units_ahead, hour_of_day, day_of_week, is_remake, is_priority, slot_key, baseline_min, predicted_min, model_version, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            id,
            orderId,
            station,
            party,
            queueAhead,
            unitsAhead,
            parts.hourOfDay,
            parts.dayOfWeek,
            orderJobs.some((j) => j.isRemake === 1) ? 1 : 0,
            orderJobs.some((j) => j.isPriority === 1) ? 1 : 0,
            station ? predictionSlotKey(station, now) : null,
            Math.max(0, Math.round(input.baselineMin)),
            predictedMin,
            input.modelVersion ? String(input.modelVersion) : PREDICTION_BASELINE_VERSION,
            source,
          ],
        );
        const [rows] = (await conn.query("SELECT * FROM prediction_features WHERE id = ? LIMIT 1", [id])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const feature = rowToPredictionFeature(rows[0]!);
        await insertAuditRow(conn, predictionRequestedEvent(feature, actor));
        return feature;
      });
    },
    async listPredictionFeatures(limit: number) {
      const capped = Math.min(Math.max(limit || 50, 1), 200);
      const [rows] = (await pool.query("SELECT * FROM prediction_features ORDER BY created_at DESC LIMIT ?", [
        capped,
      ])) as [Record<string, unknown>[], unknown];
      return (rows as Record<string, unknown>[]).map(rowToPredictionFeature);
    },
    async completePredictionFeature(id: string, actualMin: number, actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const key = String(id).trim();
        const [rows] = (await conn.query("SELECT * FROM prediction_features WHERE id = ? LIMIT 1 FOR UPDATE", [
          key,
        ])) as [Record<string, unknown>[], unknown];
        if (rows.length === 0) throw new NotFoundError("ไม่พบข้อมูลพยากรณ์");
        const current = rowToPredictionFeature(rows[0]!);
        if (current.completedAt !== null) return { feature: current, deduplicated: true };
        const actual = normalizeActualMinutes(actualMin);
        await conn.query("UPDATE prediction_features SET actual_min = ?, completed_at = ? WHERE id = ?", [
          actual,
          toMysqlDatetime(now.toISOString()),
          key,
        ]);
        const [after] = (await conn.query("SELECT * FROM prediction_features WHERE id = ? LIMIT 1", [key])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const next = rowToPredictionFeature(after[0]!);
        await insertAuditRow(conn, predictionCompletedEvent(next, actor));
        return { feature: next, deduplicated: false };
      });
    },
    async getPredictionAccuracy(now: Date = new Date()) {
      const [rows] = (await pool.query(
        "SELECT baseline_min, predicted_min, source, actual_min FROM prediction_features WHERE actual_min IS NOT NULL",
      )) as [Record<string, unknown>[], unknown];
      const [mRows] = (await pool.query("SELECT threshold_minutes FROM prediction_models WHERE id = 'default' LIMIT 1")) as [
        Record<string, unknown>[],
        unknown,
      ];
      const threshold = mRows.length === 0 ? PREDICTION_DEFAULT_THRESHOLD_MINUTES : Number(mRows[0]!["threshold_minutes"]);
      const r = evaluateAccuracySamples(
        (rows as Record<string, unknown>[]).map((x) => ({
          baselineMin: Number(x["baseline_min"]),
          predictedMin: x["predicted_min"] == null ? null : Number(x["predicted_min"]),
          source: String(x["source"]) === "model" ? ("model" as const) : ("baseline" as const),
          actualMin: Number(x["actual_min"]),
        })),
        threshold,
      );
      return {
        samples: r.samples,
        maeBaseline: r.maeBaseline,
        maeModel: r.maeModel,
        meetsThreshold: r.meetsThreshold,
        thresholdMinutes: threshold,
        gatheringSamples: r.samples < 500,
        fixtures: evaluateFixtureAccuracy(threshold),
        evaluatedAt: now.toISOString(),
      };
    },
    async evaluatePredictions(actor: ShopActor, now: Date = new Date()) {
      return withShopTx(async (conn) => {
        const accuracy = await mysqlStore.getPredictionAccuracy(now);
        await conn.query("UPDATE prediction_models SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'");
        await insertAuditRow(conn, predictionEvaluatedEvent(accuracy.samples, accuracy.maeBaseline, accuracy.maeModel, actor));
        return accuracy;
      });
    },
    async close() {
      await pool.end();
    },
  };

  return mysqlStore;
}

/**
 * Runtime (index/bootstrap) ใช้ MySQL จริงเท่านั้น — ไม่มี memory fallback
 * memory store ฉีดได้เฉพาะใน unit tests ผ่าน createMemoryStore โดยตรง
 */
export function createStoreFromEnv(): Promise<Store> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "ต้องตั้งค่า DATABASE_URL ที่ชี้ MySQL จริง (เช่น mysql://user:pass@host:3306/paor)",
    );
  }
  return createMysqlStore(url);
}
