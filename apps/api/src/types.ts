export type Role = "owner" | "admin" | "kitchen" | "drink";

export const ALL_ROLES: Role[] = ["owner", "admin", "kitchen", "drink"];

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  roles: Role[];
  isActive: boolean;
  /** รุ่นของข้อมูล credential ปัจจุบัน เพิ่มทุกครั้งที่เปลี่ยน/รีเซ็ตรหัสผ่าน */
  passwordVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  roles: Role[];
  isActive: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  /** รุ่น credential ตอนสร้างเซสชัน ต้องตรงกับ user ปัจจุบันจึงใช้งานได้ */
  passwordVersion: number;
  createdAt: string;
  expiresAt: string;
}

export type AuditAction =
  | "login_success"
  | "login_failed"
  | "logout"
  | "user_created"
  | "user_deactivated"
  | "user_activated"
  | "roles_changed"
  | "password_changed"
  | "password_reset"
  | "shop_schedule_updated"
  | "shop_name_updated"
  | "shop_override_set"
  | "shop_override_cleared"
  | "shop_table_created"
  | "shop_table_updated"
  | "customer_registered"
  | "customer_login_success"
  | "customer_login_failed"
  | "customer_logout"
  | "customer_profile_updated"
  | "customer_password_changed"
  | "customer_deleted"
  | "customer_line_link_started"
  | "customer_line_linked"
  | "customer_line_link_failed"
  | "customer_line_unlinked"
  | "customer_deactivated"
  | "customer_activated"
  | "menu_created"
  | "menu_updated"
  | "menu_status_changed"
  | "menu_archived"
  | "menu_restored"
  | "order_created"
  | "order_status_changed"
  | "reservation_created"
  | "reservation_cancelled"
  | "reservation_status_changed"
  | "reservation_checked_in"
  | "table_round_opened"
  | "table_round_closed"
  // ---------- Ticket 07: ตัวเลือกเมนู สูตร และสต๊อก ----------
  | "menu_option_group_created"
  | "menu_option_group_updated"
  | "menu_option_created"
  | "menu_option_updated"
  | "menu_option_status_changed"
  | "ingredient_created"
  | "ingredient_updated"
  | "ingredient_status_changed"
  | "recipe_created"
  | "stock_updated"
  | "order_stock_reserved"
  | "order_stock_released"
  | "order_stock_consumed"
  // ---------- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน ----------
  | "payment_created"
  | "payment_cash_confirmed"
  | "payment_paid"
  | "payment_manual_review"
  | "payment_failed"
  | "payment_expired"
  | "payment_refund_approved"
  // ---------- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ ----------
  | "queue_created"
  | "queue_claimed"
  | "queue_started"
  | "queue_ready"
  | "queue_delivered"
  | "queue_priority"
  | "queue_remade"
  | "queue_cancelled"
  | "queue_capacity_updated"
  // ---------- Ticket 10: คะแนนสะสมและรางวัล ----------
  | "loyalty_earned"
  | "loyalty_redeemed_reserved"
  | "loyalty_redeemed_consumed"
  | "loyalty_redeemed_released"
  | "loyalty_walkin_issued"
  | "loyalty_walkin_redeemed"
  | "loyalty_guest_linked"
  | "loyalty_account_merged"
  | "loyalty_points_reversed"
  | "reward_created"
  | "reward_updated"
  | "reward_status_changed"
  // ---------- Ticket 11: การเงิน รายงาน Dashboard และ CSV ----------
  | "finance_entry_created"
  | "finance_entry_updated"
  | "finance_entry_deleted"
  // ---------- Ticket 12: LINE notifications และ reliability ----------
  | "notification_queued"
  | "notification_sent"
  | "notification_failed"
  | "notification_dead_letter"
  | "notification_retried"
  | "notification_skipped"
  // ---------- Ticket 13: Capacity และการพยากรณ์เวลารอ ----------
  | "prediction_requested"
  | "prediction_model_updated"
  | "prediction_completed"
  | "prediction_evaluated";

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string | null;
  actorUsername: string | null;
  action: AuditAction | string;
  targetId: string | null;
  targetUsername: string | null;
  detail: string | null;
  ip: string | null;
  success: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    roles: [...u.roles],
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

export class ConflictError extends Error {
  code = "CONFLICT";
}
export class NotFoundError extends Error {
  code = "NOT_FOUND";
}

export interface ShopTable {
  id: string;
  name: string;
  capacity: number;
  /** พร้อมใช้งานเชิงปฏิบัติการ (true) / งดใช้งาน (false) — ไม่ใช่สถานะ "ว่าง" */
  isEnabled: boolean;
  /** โซนที่นั่งในร้าน (ใช้แสดงผังให้ลูกค้าเลือก) — null = ยังไม่กำหนดโซน */
  zone: TableZone | null;
  createdAt: string;
  updatedAt: string;
}

/** โซนที่นั่งของร้าน (ลำดับนี้คือลำดับที่แสดงให้ลูกค้า) */
export const TABLE_ZONES = ["front", "dining", "kitchen", "sala"] as const;
export type TableZone = (typeof TABLE_ZONES)[number];
export const TABLE_ZONE_LABELS: Record<TableZone, string> = {
  front: "โซนหน้าร้าน (ใต้กันสาด)",
  dining: "โซนห้องอาหาร",
  kitchen: "โซนบาร์หน้าครัว",
  sala: "โซนศาลากลางแจ้ง",
};

export function isTableZone(value: unknown): value is TableZone {
  return typeof value === "string" && (TABLE_ZONES as readonly string[]).includes(value);
}

/** validation โต๊ะ: ชื่อ 1–64 ตัวอักษร (trim), ความจุ 1–50 */
export const TABLE_NAME_MAX = 64;
export const TABLE_CAPACITY_MIN = 1;
export const TABLE_CAPACITY_MAX = 50;

// ---------- Ticket 03: บัญชีลูกค้า (แยกจากบัญชีพนักงานโดยสิ้นเชิง) ----------

/**
 * บัญชีลูกค้า: ตัวตนถาวรของลูกค้าที่ใช้ร่วมกันระหว่างเว็บและ LINE
 * - แยกตาราง/เซสชัน/คุกกี้จากบัญชีพนักงาน (staff) ไม่สวมสิทธิ์ข้ามกัน
 * - `phone` เก็บเบอร์ที่ normalize แล้ว (unique); บัญชีที่ลบแล้วตั้งเป็น null
 *   เพื่อให้เบอร์เดิมนำกลับมาใช้ใหม่ได้ ส่วน `id` ภายในคงอยู่เพื่อความถูกต้องของประวัติ
 * - `email` optional เก็บตัวพิมพ์เล็ก (unique เมื่อไม่ว่าง; null ได้หลายแถว)
 */
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  passwordHash: string;
  isActive: boolean;
  isDeleted: boolean;
  /** รุ่น credential ปัจจุบัน เพิ่มทุกครั้งที่เปลี่ยนรหัสผ่าน (ผูกกับเซสชันกัน race) */
  passwordVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** ฟิลด์ปลอดภัยสำหรับส่งออก/API หลังร้าน — ไม่มี passwordHash/token/secret */
export interface PublicCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: string;
}

export interface CustomerSession {
  id: string;
  customerId: string;
  /** รุ่น credential ตอนสร้างเซสชัน ต้องตรงกับ customer ปัจจุบันจึงใช้งานได้ */
  passwordVersion: number;
  createdAt: string;
  expiresAt: string;
}

/** การเชื่อม LINE หนึ่งต่อหนึ่ง: ลูกค้าหนึ่งบัญชี ↔ LINE user ID (sub) หนึ่งค่า */
export interface CustomerLineLink {
  customerId: string;
  provider: "line";
  providerSubject: string;
  displayName: string | null;
  linkedAt: string;
}

/**
 * login transaction สำหรับ LINE authorization: ใช้ครั้งเดียว อายุสั้น
 * - `state`/`nonce` สุ่มใหม่ทุก attempt, `codeVerifier` เก็บฝั่ง server เท่านั้น
 * - callback อ่าน pre-check แบบไม่ consume (peekLineTx) ก่อนแลก code แล้ว consume
 *   พร้อม audit ของผลลัพธ์แบบ atomic (ล้มเหลว→consumeLineTxWithAudit,
 *   สำเร็จ→linkLineIdentityWithConsume); ใช้ซ้ำ/หมดอายุถูกปฏิเสธ
 */
export interface LineLoginTx {
  state: string;
  customerId: string;
  nonce: string;
  codeVerifier: string;
  redirectAfter: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

// ---------- Ticket 04: แคตตาล็อกเมนู (ยังไม่รวมสูตร/สต๊อก/คำสั่งซื้อ) ----------

export type MenuKind = "food" | "drink";
export type MenuStatus = "available" | "unavailable";

export const MENU_KINDS: MenuKind[] = ["food", "drink"];
export const MENU_STATUSES: MenuStatus[] = ["available", "unavailable"];

/** ขีดจำกัด validation เมนู (บันทึกเป็นกฎชัดเจนสำหรับ Ticket 04) */
export const MENU_CATEGORY_MAX = 64;
export const MENU_NAME_MAX = 120;
export const MENU_DESCRIPTION_MAX = 500;
export const MENU_IMAGE_URL_MAX = 2048;
export const MENU_PRICE_MAX = 1000000;
export const MENU_SORT_ORDER_MIN = 0;
export const MENU_SORT_ORDER_MAX = 10000;

export interface MenuItem {
  id: string;
  /** หมวดหมู่ เช่น "อาหารจานเดียว" — ชื่อซ้ำได้ข้ามหมวด แต่ห้ามซ้ำในหมวดเดียวกัน */
  category: string;
  name: string;
  description: string | null;
  /** URL รูปภาพ (absolute http/https) หรือ null — ยังไม่รองรับอัปโหลดไฟล์จริง */
  imageUrl: string | null;
  /** ราคาขายปัจจุบัน (บาท) — snapshot ราคาตอนยืนยันคำสั่งซื้อจะเก็บแยกใน Ticket คำสั่งซื้อ */
  price: number;
  /** ประเภทอาหาร/เครื่องดื่ม (ใช้แยกคิวครัว/เครื่องดื่มในอนาคต) */
  kind: MenuKind;
  /** สถานะเปิดขาย (available) / ปิดขายชั่วคราว (unavailable) */
  status: MenuStatus;
  /** archive = ซ่อนถาวรจากหน้าขาย แต่คงประวัติไว้ (ไม่ลบทำลาย) */
  isArchived: boolean;
  /** ลำดับแสดงผลในหมวด (น้อยขึ้นก่อน) */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** DTO สาธารณะ: เฉพาะเมนูพร้อมขาย (available + ไม่ถูก archive) — ไม่มีข้อมูลหลังร้าน/ต้นทุน */
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

export interface MenuGroup {
  category: string;
  items: PublicMenuItem[];
}

export function toPublicMenuItem(m: MenuItem): PublicMenuItem {
  return {
    id: m.id,
    category: m.category,
    name: m.name,
    description: m.description,
    imageUrl: m.imageUrl,
    price: m.price,
    kind: m.kind,
    sortOrder: m.sortOrder,
  };
}

/** พร้อมขายต่อลูกค้า = เปิดขายและไม่ถูก archive (ยังไม่ตรวจสต๊อกจากสูตร — งาน Ticket สต๊อก) */
export function isMenuSellable(m: MenuItem): boolean {
  return m.status === "available" && !m.isArchived;
}

// ---------- Ticket 05: ตะกร้าและคำสั่งซื้อพื้นฐาน (ยังไม่รวมชำระเงิน/สต๊อก/คิว) ----------

/** วิธีรับบริการ: รับประทานที่ร้าน / กลับบ้าน / ล่วงหน้า (มีเวลานัด) */
export type OrderServiceType = "dine_in" | "takeaway" | "preorder";

export const ORDER_SERVICE_TYPES: OrderServiceType[] = ["dine_in", "takeaway", "preorder"];

/**
 * สถานะคำสั่งซื้อพื้นฐาน (Ticket 05):
 * - `pending_payment` = สร้างแล้วรอชำระ (สถานะเริ่มต้น ยังไม่สร้างงานคิว)
 * - `completed` / `cancelled` = ปิดงานโดย Owner/Admin เท่านั้น
 * สถานะคิว (`in_progress`/`ready`) และการชำระจริงเป็นงาน ticket ถัดไป
 */
export type OrderStatus = "pending_payment" | "completed" | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = ["pending_payment", "completed", "cancelled"];

/** ขีดจำกัด validation คำสั่งซื้อ (บันทึกเป็นกฎชัดเจนสำหรับ Ticket 05) */
export const ORDER_NOTE_MAX = 200;
export const ORDER_GUEST_NAME_MAX = 120;
export const ORDER_REASON_MAX = 500;
export const ORDER_MAX_LINES = 20;
export const ORDER_QTY_MIN = 1;
export const ORDER_QTY_MAX = 20;

/** รายการย่อยในคำสั่งซื้อ: snapshot ชื่อ+ราคาตอนยืนยัน (ราคาเมนูภายหลังไม่กระทบ) */
export interface OrderItem {
  id: string;
  orderId: string;
  /** อ้างอิงเมนูต้นทาง (คงไว้เพื่อ trace; ราคา/ชื่ออ่านจาก snapshot) */
  menuId: string;
  /** snapshot ชื่อเมนู ณ เวลายืนยัน */
  menuName: string;
  /** snapshot ราคาต่อหน่วย ณ เวลายืนยัน (บาท) */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** หมายเหตุต่อรายการ (เช่น ไม่ใส่ผัก) — ไม่เปลี่ยนราคา */
  note: string | null;
  // ---------- Ticket 07: snapshot ตัวเลือก/ความต้องการเฉพาะ/ต้นทุน ----------
  /** snapshot ตัวเลือกที่ลูกค้าเลือก (ชื่อกลุ่ม+ชื่อตัวเลือก+ส่วนต่างราคา ณ เวลายืนยัน) */
  selectedOptions: OrderItemOptionSnapshot[];
  /** ความต้องการเฉพาะ (เช่น เผ็ดน้อย ไม่ใส่ผัก) — ข้อความล้วน ไม่เปลี่ยนราคา */
  specialRequest: string | null;
  /** ต้นทุนวัตถุดิบประมาณการของรายการนี้ (บาท, คำนวณจากสูตรล่าสุดตอนยืนยัน) */
  estimatedCost: number;
}

/** snapshot ตัวเลือกหนึ่งตัวในรายการคำสั่งซื้อ (ตรึงชื่อ+ส่วนต่างราคาตอนยืนยัน) */
export interface OrderItemOptionSnapshot {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

/** คำสั่งซื้อ: snapshot รวมของตะกร้าที่ลูกค้ายืนยันแล้ว */
export interface Order {
  id: string;
  /** เลขอ้างอิงอ่านได้ เช่น ORD-20260914-AB12 (unique) */
  orderNumber: string;
  /** เจ้าของเมื่อ login แล้ว (ผูกกับบัญชีลูกค้า) — Guest เป็น null */
  customerId: string | null;
  /** ตัวตนขั้นต่ำของ Guest (null เมื่อเป็นคำสั่งซื้อของสมาชิก) */
  guestName: string | null;
  /** เบอร์ Guest ที่ normalize แล้ว (null เมื่อเป็นของสมาชิก) */
  guestPhone: string | null;
  /** ช่องทางสร้าง — รุ่นแรกมีเฉพาะ `web` */
  channel: "web";
  serviceType: OrderServiceType;
  status: OrderStatus;
  subtotal: number;
  /** ยอดรวมที่ตรึงตอนยืนยัน (รุ่นแรก = subtotal ยังไม่มีส่วนลด/ค่าธรรมเนียม) */
  total: number;
  /** เวลานัดรับ (เฉพาะ preorder) */
  scheduledAt: string | null;
  /** ผูกกับโต๊ะ/รอบการใช้โต๊ะ (เฉพาะ dine_in ที่เช็กอินแล้ว — null ได้) */
  tableId: string | null;
  /** รอบการใช้โต๊ะที่คำสั่งซื้อนี้สังกัด (ต้องเป็นรอบเปิดอยู่ตอนสร้าง) */
  roundId: string | null;
  /** คีย์กันยืนยันซ้ำจาก request เดิม (client สร้าง UUID ต่อการกดยืนยันหนึ่งครั้ง) */
  idempotencyKey: string;
  // ---------- Ticket 07: การจองสต๊อกผูกกับคำสั่งซื้อ ----------
  /** จองสต๊อกแล้ว (จองตอนยืนยันก่อนรับชำระ — กันขายเกิน) */
  stockReserved: boolean;
  /** ตัดสต๊อกจริงแล้ว (ตัดเมื่อเริ่มทำ — เหตุการณ์ซ้ำเป็น no-op) */
  stockConsumed: boolean;
  /** ต้นทุนวัตถุดิบประมาณการรวม (บาท, จากสูตรล่าสุดตอนยืนยัน — แยกจากรายจ่ายจริง) */
  estimatedCost: number;
  createdAt: string;
  updatedAt: string;
}

/** คำสั่งซื้อพร้อมรายการย่อย — รูป DTO ที่ API ส่งออก (ไม่มีข้อมูลลับ) */
export interface OrderDetail extends Order {
  items: OrderItem[];
}

/** ---------- Ticket 06: การจองโต๊ะและรอบการใช้โต๊ะ (ยังไม่รวม LINE/payment) ---------- */

/**
 * สถานะการจอง (baseline ตาม docs/REQUIREMENTS.md):
 * - `pending` = สร้างแล้วรอการยืนยัน/เช็กอิน (สถานะเริ่มต้น)
 * - `confirmed` = แอดมินยืนยันแล้ว (พร้อมเช็กอิน)
 * - `seated` = เช็กอินแล้ว (เปิดรอบการใช้โต๊ะแล้ว)
 * - `completed` = ปิดรอบแล้ว (จบงาน)
 * - `cancelled` = ยกเลิก (โดยลูกค้าหรือแอดมิน)
 * - `no_show` = แอดมินบันทึกว่าไม่มาตามนัด
 */
export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

export const RESERVATION_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
];

/** สถานะรอบการใช้โต๊ะ: เปิดอยู่ / ปิดแล้ว */
export type TableRoundStatus = "open" | "closed";

export const TABLE_ROUND_STATUSES: TableRoundStatus[] = ["open", "closed"];

/** ขีดจำกัด validation การจอง (บันทึกเป็นกฎชัดเจนสำหรับ Ticket 06) */
export const RESERVATION_PARTY_MIN = 1;
export const RESERVATION_PARTY_MAX = 50;
export const RESERVATION_NOTE_MAX = 200;
export const RESERVATION_REASON_MAX = 500;

export interface Reservation {
  id: string;
  /** เลขอ้างอิงอ่านได้ เช่น RSV-20260914-AB12 (unique) */
  code: string;
  /** เจ้าของการจอง (ต้องเป็นบัญชีลูกค้า — Guest จองไม่ได้) */
  customerId: string;
  tableId: string;
  partySize: number;
  /** เวลานัดหมาย (UTC ISO) */
  reservedAt: string;
  status: ReservationStatus;
  note: string | null;
  /** คีย์กันสร้างซ้ำจาก request เดิม (optional — client สร้าง UUID ต่อการกดจองหนึ่งครั้ง) */
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TableRound {
  id: string;
  /** การจองต้นทาง (null = รอบ walk-in ไม่มีจอง) */
  reservationId: string | null;
  tableId: string;
  /** จำนวนผู้ใช้บริการจริงตอนเช็กอิน */
  partySize: number;
  status: TableRoundStatus;
  openedBy: string | null;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
}

/** การจองพร้อมชื่อโต๊ะ (DTO หลังร้าน — มีข้อมูลลูกค้าเท่าที่จำเป็น) */
export interface ReservationDetail extends Reservation {
  tableName: string;
}

/** รอบการใช้โต๊ะพร้อมชื่อโต๊ะ (DTO หลังร้าน) */
export interface TableRoundDetail extends TableRound {
  tableName: string;
}

/** รอบการใช้โต๊ะแบบสาธารณะ — ไม่มีข้อมูลลูกค้า/รหัสจอง/ผู้เปิดปิด */
export interface PublicTableRound {
  tableId: string;
  tableName: string;
  partySize: number;
  openedAt: string;
}

export function toOrderDetail(order: Order, items: OrderItem[]): OrderDetail {
  return { ...order, items: items.map((i) => ({ ...i })) };
}

export function toPublicCustomer(c: Customer): PublicCustomer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    isActive: c.isActive,
    isDeleted: c.isDeleted,
    createdAt: c.createdAt,
  };
}

/** ---------- Ticket 07: ตัวเลือกเมนู สูตร และสต๊อก ---------- */

/** ขีดจำกัด validation ตัวเลือกเมนู */
export const OPTION_GROUP_NAME_MAX = 64;
export const OPTION_NAME_MAX = 120;
export const OPTION_PRICE_DELTA_MAX = 1000000;
export const OPTION_SORT_ORDER_MIN = 0;
export const OPTION_SORT_ORDER_MAX = 10000;

/** กลุ่มตัวเลือกของเมนูหนึ่งรายการ (เช่น "ขนาด", "เพิ่มท็อปปิ้ง") */
export interface MenuOptionGroup {
  id: string;
  menuId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** ตัวเลือกในกลุ่ม (เช่น "พิเศษ +10 บาท") — เปิด/ปิดขายรายตัวเลือกได้ */
export interface MenuOption {
  id: string;
  groupId: string;
  menuId: string;
  name: string;
  /** ส่วนต่างราคาต่อหน่วย (บาท, บวก/ลบได้ — รวมกับราคาเมนูตอนยืนยัน) */
  priceDelta: number;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** ตัวเลือกแบบสาธารณะ (เฉพาะตัวที่เปิดขาย) */
export interface PublicMenuOption {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
}

/** กลุ่มตัวเลือกแบบสาธารณะ (เฉพาะกลุ่มที่มีตัวอย่างน้อยหนึ่งตัวเลือกที่เปิดขาย) */
export interface PublicMenuOptionGroup {
  id: string;
  name: string;
  sortOrder: number;
  options: PublicMenuOption[];
}

/** เมนูสาธารณะพร้อมกลุ่มตัวเลือก + สถานะพร้อมขายจากสต๊อก */
export interface PublicMenuItemWithOptions extends PublicMenuItem {
  optionGroups: PublicMenuOptionGroup[];
  /**
   * พร้อมขายจากสต๊อกหรือไม่ (true เมื่อไม่มีสูตร หรือสูตรล่าสุดมีสต๊อกพร้อมขายพอ
   * สำหรับ 1 หน่วย — งาน Ticket สต๊อก; false = แสดงป้าย "วัตถุดิบหมดชั่วคราว")
   */
  inStock: boolean;
}

export function toPublicMenuOption(o: MenuOption): PublicMenuOption {
  return { id: o.id, name: o.name, priceDelta: o.priceDelta, sortOrder: o.sortOrder };
}

/** ขีดจำกัด validation วัตถุดิบ/สูตร/สต๊อก */
export const INGREDIENT_NAME_MAX = 120;
export const INGREDIENT_UNIT_MAX = 32;
export const INGREDIENT_STOCK_MAX = 1000000000;
export const INGREDIENT_COST_MAX = 1000000;
export const RECIPE_QTY_MAX = 1000000000;
export const RECIPE_MAX_LINES = 50;
export const SPECIAL_REQUEST_MAX = 200;
export const STOCK_REASON_MAX = 500;
export const STOCK_QTY_DECIMALS = 3;

/**
 * วัตถุดิบ: หนึ่งรายการมีหนึ่งหน่วยเท่านั้น (เช่น กรัม ฟอง มิลลิลิตร ถุง)
 * ไม่มีแปลงหน่วยอัตโนมัติ — หน่วยกำหนดตอนสร้างและเปลี่ยนไม่ได้
 * พร้อมขาย = คงเหลือจริง (onHand) − ยอดจอง (reserved)
 */
export interface Ingredient {
  id: string;
  name: string;
  /** หน่วยเดียวของวัตถุดิบนี้ (immutable หลังสร้าง) */
  unit: string;
  /** คงเหลือจริง */
  onHand: number;
  /** ยอดที่จองให้คำสั่งซื้อที่ยืนยันแล้ว (ยังไม่ตัดจริง) */
  reserved: number;
  /** ระดับเตือนเมื่อพร้อมขายต่ำกว่าค่านี้ */
  reorderThreshold: number;
  /** ราคาทุนล่าสุดต่อหน่วย (บาท — ใช้คำนวณต้นทุนประมาณการเท่านั้น) */
  latestCost: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** พร้อมขาย = คงเหลือจริง − ยอดจอง (ห้ามติดลบ — store บังคับก่อน mutate เสมอ) */
export function ingredientAvailable(i: Ingredient): number {
  return Math.round((i.onHand - i.reserved) * 1000) / 1000;
}

/** เป้าหมายของสูตร: สูตรฐานของเมนู หรือสูตรเพิ่มเติมของตัวเลือก */
export type RecipeTargetType = "menu" | "option";

export const RECIPE_TARGET_TYPES: RecipeTargetType[] = ["menu", "option"];

/** สูตรหนึ่งบรรทัด: ใช้วัตถุดิบนี้ปริมาณเท่าใดต่อหน่วยขาย (ทศนิยมได้) */
export interface RecipeLine {
  ingredientId: string;
  /** ปริมาณต่อ 1 หน่วยขาย (หน่วยเดียวกับวัตถุดิบ) */
  qty: number;
}

/**
 * สูตรแบบ versioned: แก้ไข = สร้างเวอร์ชันใหม่เท่านั้น (ห้ามแก้/ลบเวอร์ชันเก่า)
 * คำสั่งซื้อยืนยันอ้างสูตรล่าสุดเสมอ; ประวัติเวอร์ชันเก่าคงไว้ตรวจสอบย้อนหลัง
 */
export interface Recipe {
  id: string;
  targetType: RecipeTargetType;
  targetId: string;
  version: number;
  lines: RecipeLine[];
  /** ต้นทุนประมาณการต่อหน่วยขาย (บาท, Σ qty × latestCost ณ เวลาสร้างเวอร์ชัน) */
  estimatedCostPerUnit: number;
  createdBy: string | null;
  createdAt: string;
}

/** ประเภทธุรกรรมสต๊อก (ทุกครั้งมีเหตุผล ผู้ทำ เวลา ยอดก่อน–หลัง) */
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

export const STOCK_OPS: StockOp[] = [
  "receive",
  "reserve",
  "release",
  "consume",
  "return",
  "waste",
  "expire",
  "personal_use",
  "adjust",
];

/** ประเภทที่ผู้ใช้กรอกเองได้ (reserve/release/consume เป็นของระบบจากคำสั่งซื้อเท่านั้น) */
export type ManualStockOp = "receive" | "return" | "waste" | "expire" | "personal_use" | "adjust";

export const MANUAL_STOCK_OPS: ManualStockOp[] = [
  "receive",
  "return",
  "waste",
  "expire",
  "personal_use",
  "adjust",
];

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

/** ---------- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน ---------- */

/** วิธีชำระเงินรุ่นแรก: เงินสด (หลังร้านยืนยัน) / พร้อมเพย์ (fake provider) */
export type PaymentMethod = "cash" | "promptpay";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "promptpay"];

/**
 * สถานะการชำระ (state machine ต่อยอดจากคำสั่งซื้อ pending_payment):
 * - `pending` = สร้าง intent แล้วรอผล (สถานะเริ่มต้น)
 * - `paid` = ชำระสำเร็จ (ออกใบเสร็จแล้ว)
 * - `manual_review` = รอตรวจสอบการชำระเงิน (หลักฐานไม่ชัด/ambiguous/timeout — ต้องให้ Admin ตรวจมือ)
 * - `failed` = ชำระไม่สำเร็จ
 * - `expired` = intent หมดอายุ (จ่ายต่อไม่ได้ — ต้องสร้าง intent ใหม่)
 * - `refunded` = คืนเงินแล้ว (Owner อนุมัติ)
 * - `cancelled` = ยกเลิก intent ที่ยังไม่สำเร็จ (ยังไม่จ่าย)
 */
export type PaymentStatus =
  | "pending"
  | "paid"
  | "manual_review"
  | "failed"
  | "expired"
  | "refunded"
  | "cancelled";

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "pending",
  "paid",
  "manual_review",
  "failed",
  "expired",
  "refunded",
  "cancelled",
];

/** ขีดจำกัด validation การชำระเงิน */
export const PAYMENT_REASON_MAX = 500;
export const PAYMENT_REFERENCE_MAX = 120;
/** อายุ intent พร้อมเพย์ (นาที) — เกินแล้วถือว่าหมดอายุ */
export const PAYMENT_PROMPTPAY_TTL_MINUTES = 15;

export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  /** วิธีชำระ */
  method: PaymentMethod;
  /** ยอดที่ต้องชำระ (ตรึงเท่ายอดคำสั่งซื้อตอนสร้าง — FR-PAY-001) */
  amount: number;
  /** เงินที่รับมาจริง (เฉพาะ cash — ใช้คำนวณเงินทอน) */
  receivedAmount: number | null;
  /** เงินทอน (เฉพาะ cash) */
  changeAmount: number;
  status: PaymentStatus;
  /** อ้างอิงผู้ให้บริการ (fake payload / slip ref — ไม่มีข้อมูลลับจริง) */
  providerRef: string | null;
  slipRef: string | null;
  /** เลขใบเสร็จ (มีเมื่อ paid แล้วเท่านั้น) */
  receiptNumber: string | null;
  /** กันสร้าง intent ซ้ำจาก request เดิม (client สร้าง UUID ต่อการกดชำระหนึ่งครั้ง) */
  idempotencyKey: string;
  /** เวลาชำระสำเร็จ (paid) */
  paidAt: string | null;
  /** เวลาหมดอายุของ intent */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * สถานะการชำระฝั่งคำสั่งซื้อ (derived — ไม่เปลี่ยน OrderStatus contract เดิม):
 * pending_payment (ยังไม่มี payment) → paid/manual_review/failed/expired/refunded
 */
export type OrderPaymentState =
  | "pending_payment"
  | "paid"
  | "manual_review"
  | "failed"
  | "expired"
  | "refunded";

export const ORDER_PAYMENT_STATES: OrderPaymentState[] = [
  "pending_payment",
  "paid",
  "manual_review",
  "failed",
  "expired",
  "refunded",
];

/** เหตุการณ์ webhook/provider (append-only — ใช้ dedupe ด้วย providerEventId) */
export interface PaymentEvent {
  id: string;
  paymentId: string;
  /** รหัสเหตุการณ์จากผู้ให้บริการ (unique — replay ได้ dedupe) */
  providerEventId: string;
  kind: "success" | "ambiguous" | "fail" | "expire";
  /** สรุปที่ปลอดภัยของ payload (ไม่มีข้อมูลลับ) */
  summary: string;
  createdAt: string;
}

/**
 * ใบเสร็จอย่างง่าย: หลักฐานการรับเงินของร้าน (เลขเอกสาร วันที่ รายการ
 * ยอดรวม ช่องทางชำระ ชื่อร้าน) — ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ
 */
export interface Receipt {
  /** เลขเอกสาร เช่น RCP-20260914-AB12 (unique) */
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

/** คำขอคืนเงิน: ต้องได้รับอนุมัติ (Owner) และมีหลักฐานก่อนถือว่าคืนสำเร็จ */
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

/** ธุรกรรมสต๊อก: หลักฐานการเปลี่ยนปริมาณทุกครั้ง (append-only ห้ามแก้/ลบ) */
export interface StockLedgerEntry {
  id: string;
  ingredientId: string;
  op: StockOp;
  /** ผลต่างคงเหลือจริง (บวก/ลบ) */
  deltaOnHand: number;
  /** ผลต่างยอดจอง (บวก/ลบ) */
  deltaReserved: number;
  beforeOnHand: number;
  afterOnHand: number;
  beforeReserved: number;
  afterReserved: number;
  reason: string;
  actorId: string | null;
  actorUsername: string | null;
  /** คำสั่งซื้อต้นทาง (ธุรกรรมจากระบบจอง/ตัดสต๊อก) */
  orderId: string | null;
  /** เลขอ้างอิงเพิ่มเติม (เช่น เลขบิลซื้อ) */
  reference: string | null;
  createdAt: string;
}

/** ---------- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ ---------- */

/** ฝ่ายปฏิบัติงาน: อาหาร → kitchen, เครื่องดื่ม → drink (ตัดสินจาก menu kind) */
export type QueueStation = "kitchen" | "drink";

export const QUEUE_STATIONS: QueueStation[] = ["kitchen", "drink"];

export const QUEUE_STATION_LABELS: Record<QueueStation, string> = {
  kitchen: "ครัว",
  drink: "เครื่องดื่ม",
};

/**
 * สถานะงานคิวต่อ job:
 * - `queued` = รอรับงาน (สถานะเริ่มต้นเมื่อชำระสำเร็จ)
 * - `claimed` = มีผู้รับงานแล้ว
 * - `preparing` = กำลังทำ (ตัดสต๊อกจริงครั้งแรกตรงนี้ — ครั้งเดียว idempotent)
 * - `ready` = พร้อมส่งมอบ (ทำเสร็จแล้วรอเสิร์ฟ แยกจากส่งมอบแล้ว)
 * - `delivered` = ส่งมอบแล้ว (ลูกค้าได้รับ)
 * - `cancelled` = ยกเลิกงานคิวนี้ (เฉพาะก่อนเริ่มทำ)
 */
export type QueueStatus =
  | "queued"
  | "claimed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export const QUEUE_STATUSES: QueueStatus[] = [
  "queued",
  "claimed",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
];

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  queued: "รอรับงาน",
  claimed: "รับงานแล้ว",
  preparing: "กำลังทำ",
  ready: "พร้อมส่งมอบ",
  delivered: "ส่งมอบแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

/** ขีดจำกัด validation งานคิว */
export const QUEUE_REASON_MAX = 500;
/** ช่วงสล็อตนับกำลังผลิต (นาที) — ฝ่ายละ N งานต่อช่วง */
export const QUEUE_SLOT_MINUTES = 15;
/** เวลาทำประมาณการมาตรฐาน (นาที) แยกตามฝ่าย — ใช้คำนวณ readyAt preorder + เวลารอโดยประมาณ */
export const QUEUE_STANDARD_PREP_MINUTES: Record<QueueStation, number> = {
  kitchen: 15,
  drink: 5,
};
/** กำลังผลิตค่าเริ่มต้นต่อช่วง 15 นาที (Admin ปรับได้) */
export const QUEUE_DEFAULT_CAPACITY_PER_SLOT = 10;

/**
 * งานคิว: รายการเมนูชนิดเดียวกันภายในคำสั่งซื้อที่ฝ่ายอาหาร/เครื่องดื่มต้องทำหนึ่งชุด
 * หนึ่ง OrderItem → หนึ่ง job (ทำใหม่สร้าง job ใหม่ผูก orderItem เดิม ไม่คิดเงินซ้ำ)
 * - งานรางวัล (Ticket 10): orderId/paymentId เป็น null (ไม่ผูกคำสั่งซื้อ/ชำระเงิน —
 *   ไม่สร้างรายรับและไม่ได้คะแนน) อ้างอิง redemption ผ่าน rewardRedemptionId แทน
 */
export interface QueueJob {
  id: string;
  /** คำสั่งซื้อต้นทาง (ต้องชำระสำเร็จแล้วจึงมี job; null = งานรางวัล) */
  orderId: string | null;
  orderNumber: string;
  /** payment ที่ทำให้เกิด job ชุดนี้ (idempotency: หนึ่ง payment สร้าง jobs ได้ชุดเดียว; null = งานรางวัล) */
  paymentId: string | null;
  /** รายการคำสั่งซื้อต้นทาง ("" สำหรับงานรางวัล — ไม่มี order item) */
  orderItemId: string;
  menuId: string;
  menuName: string;
  station: QueueStation;
  /** จำนวนทั้งหมดของงานนี้ */
  quantity: number;
  /** จำนวนที่ทำเสร็จแล้ว (ทยอยได้ ไม่เกิน quantity) */
  readyQty: number;
  /** จำนวนที่ส่งมอบแล้ว (ทยอยได้ ไม่เกิน readyQty และ quantity) */
  deliveredQty: number;
  status: QueueStatus;
  /** เวลาพร้อมทำ: งานทั่วไป = เวลาชำระ; งานล่วงหน้า = เวลานัด − เวลาทำประมาณการ */
  readyAt: string;
  /** ผูกโต๊ะ/รอบการใช้โต๊ะ (เฉพาะ dine_in — null ได้) */
  tableId: string | null;
  roundId: string | null;
  /** งานทำใหม่ (ไม่คิดเงินซ้ำ) */
  isRemake: boolean;
  /** งานเร่งด่วน (แทรกคิวได้เมื่อมีเหตุผล) */
  isPriority: boolean;
  /** เหตุผลล่าสุด (priority/remake/cancel) */
  reason: string | null;
  /** ผู้รับงานล่าสุด */
  claimedBy: string | null;
  /** รหัส redemption รางวัลต้นทาง (null = งานจากคำสั่งซื้อปกติ) */
  rewardRedemptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** งานคิวพร้อมข้อมูลแสดงผล (ชื่อโต๊ะ/สถานะรอบ) */
export interface QueueJobDetail extends QueueJob {
  tableName: string | null;
}

/** กำลังผลิตต่อช่วง 15 นาทีของแต่ละฝ่าย (Admin ตั้งได้) */
export interface StationCapacity {
  station: QueueStation;
  /** จำนวนงานสูงสุดที่รับเพิ่มได้ต่อช่วง 15 นาที */
  perSlot: number;
  updatedBy: string | null;
  updatedAt: string;
}

/** ภาพสล็อต 15 นาทีสำหรับ preorder/capacity (contract สำหรับ Ticket 13) */
export interface QueueSlot {
  station: QueueStation;
  /** จุดเริ่มสล็อต (UTC ISO) */
  slotStart: string;
  /** จุดจบสล็อต (UTC ISO) */
  slotEnd: string;
  /** จำนวนงานที่จองสล็อตนี้แล้ว */
  used: number;
  capacity: number;
  available: number;
}

/** ---------- Ticket 10: คะแนนสะสมและรางวัล ---------- */

/** ขีดจำกัด validation คะแนน/รางวัล */
export const REWARD_NAME_MAX = 120;
export const REWARD_IMAGE_URL_MAX = 2048;
export const REWARD_POINTS_MIN = 1;
export const REWARD_POINTS_MAX = 100000;
export const REWARD_QUOTA_MAX = 1000000;
export const LOYALTY_REASON_MAX = 500;
/** อายุ QR Walk-in (นาที) — ใช้ครั้งเดียว */
export const WALKIN_QR_TTL_MINUTES = 10;
/** หน้าต่างผูก Guest เข้าบัญชีหลังคำสั่งซื้อยืนยัน (ชั่วโมง) */
export const GUEST_LINK_WINDOW_HOURS = 24;
/** คะแนนต่อเครื่องดื่มที่ร่วมรายการ 1 หน่วย */
export const LOYALTY_POINTS_PER_DRINK_UNIT = 1;

/**
 * แหล่งที่มาของธุรกรรมคะแนน (ทุกเหตุการณ์มีแหล่งอ้างอิงชัดเจน):
 * - `order` = ได้คะแนนจากเครื่องดื่มในคำสั่งซื้อที่ชำระ+ส่งมอบแล้ว
 * - `walkin` = ได้คะแนนจาก QR Walk-in
 * - `reward_reserve` = กันคะแนนเมื่อยืนยันแลก (hold)
 * - `reward_consume` = หักคะแนนถาวรเมื่อร้านรับรายการ
 * - `reward_release` = คืนคะแนนที่กันไว้เมื่อปฏิเสธ/ยกเลิก
 * - `refund` = ย้อนคะแนนเมื่อคืนเงิน/ยกเลิกคำสั่งซื้อ
 * - `merge` = ย้ายคะแนนเมื่อรวมบัญชี
 * - `adjust` = ปรับยอดโดย Owner/Admin พร้อมเหตุผล
 */
export type LoyaltySource =
  | "order"
  | "walkin"
  | "reward_reserve"
  | "reward_consume"
  | "reward_release"
  | "refund"
  | "merge"
  | "adjust";

export const LOYALTY_SOURCES: LoyaltySource[] = [
  "order",
  "walkin",
  "reward_reserve",
  "reward_consume",
  "reward_release",
  "refund",
  "merge",
  "adjust",
];

/**
 * ธุรกรรมคะแนน: หลักฐานการเพิ่ม/หักคะแนนแบบ append-only (ห้ามแก้/ลบ)
 * ยอดคงเหลือ = ผลรวม points ของธุรกรรมทั้งหมดของลูกค้า (derived)
 */
export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  /** คะแนน (+ = รับ, − = ใช้/ย้อน) */
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

/**
 * รางวัล: เครื่องดื่มที่แลกด้วยคะแนน (Admin/Owner จัดการ)
 * - quotaTotal null = ไม่จำกัดสิทธิ์; quotaUsed นับเฉพาะที่ consume แล้ว
 *   (reserve กันวงเงินแยกในหน่วยความจำ/คอลัมน์ชั่วคราวของ seam)
 * - ช่วงเวลา startsAt/endsAt null = ไม่จำกัด
 */
export interface Reward {
  id: string;
  name: string;
  /** URL รูป (absolute http/https) หรือ null — ยังไม่รองรับอัปโหลดไฟล์จริง */
  imageUrl: string | null;
  /** เมนูเครื่องดื่มอ้างอิง */
  menuId: string;
  menuName: string;
  /** คะแนนที่ใช้แลก 1 หน่วย */
  pointsCost: number;
  /** จำนวนสิทธิ์ทั้งหมด (null = ไม่จำกัด) */
  quotaTotal: number | null;
  /** จำนวนสิทธิ์ที่ใช้ไปแล้ว (consume แล้ว) */
  quotaUsed: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** สถานะการแลกรางวัล: reserved (กันคะแนน) → consumed (ร้านรับ) / released (คืนคะแนน) */
export type RedemptionStatus = "reserved" | "consumed" | "released";

export const REDEMPTION_STATUSES: RedemptionStatus[] = ["reserved", "consumed", "released"];

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  reserved: "รอร้านรับรายการ",
  consumed: "รับรายการแล้ว",
  released: "คืนคะแนนแล้ว",
};

/**
 * รายการแลกรางวัล: คำขอใช้คะแนนแลกเครื่องดื่ม 1 หน่วย
 * - reserve กันคะแนน+quota ด้วย idempotencyKey (คีย์ซ้ำ + payload เดิม = คืนของเดิม)
 * - consume (ร้านรับ) หักคะแนนถาวร + สร้างงานคิวเครื่องดื่มราคา 0 ครั้งเดียว
 * - release (ปฏิเสธ/วัตถุดิบหมด) คืนคะแนน+quota
 */
export interface RewardRedemption {
  id: string;
  /** รหัสอ้างอิงอ่านได้ เช่น RDM-XXXXXX */
  code: string;
  customerId: string;
  rewardId: string;
  rewardName: string;
  menuId: string;
  menuName: string;
  pointsCost: number;
  status: RedemptionStatus;
  /** กันแลกซ้ำจาก request เดิม (client สร้าง UUID ต่อการกดแลกหนึ่งครั้ง) */
  idempotencyKey: string;
  /** งานคิวเครื่องดื่มที่สร้างตอน consume (null จนกว่าร้านจะรับ) */
  queueJobId: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * โทเค็น QR Walk-in: ใช้ครั้งเดียว อายุ 10 นาที (fake QR payload แบบ deterministic)
 * code รูป `WALKIN-<token>` — ลูกค้าสแกนรับคะแนน 1 แต้มต่อ QR
 */
export interface WalkinQrToken {
  id: string;
  /** payload ที่แสดงเป็น QR (deterministic: `WALKIN-<token>`) */
  code: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
}

/** หลักฐานผูกคำสั่งซื้อ Guest เข้าบัญชีลูกค้า (กัน double-claim) */
export interface GuestLinkClaim {
  id: string;
  orderId: string;
  customerId: string;
  guestPhone: string;
  claimedAt: string;
}

/** หลักฐานรวมบัญชี (กันย้ายซ้ำ — คู่ source/target เดิมเป็น no-op) */
export interface CustomerMergeRecord {
  id: string;
  sourceCustomerId: string;
  targetCustomerId: string;
  approvedBy: string | null;
  createdAt: string;
}

/** ---------- Ticket 11: การเงิน รายงาน Dashboard และ CSV ---------- */

/**
 * ประเภทรายการเงินมือ (manual entries — แยกจากรายรับที่เกิดจาก paid orders):
 * - `income` = รายรับมือ (เช่น รายได้เสริมที่นอกเหนือคำสั่งซื้อ)
 * - `expense` = รายจ่ายจริง (เช่น ซื้อวัตถุดิบ ค่าแรง ค่าสาธารณูปโภค)
 * รายรับจากคำสั่งซื้อ (paid payments หัก refunds) คำนวณ derived จากตาราง payments/refunds
 * ไม่ได้เก็บในตารางนี้ — กันนับรายรับซ้ำ
 */
export type FinanceKind = "income" | "expense";

export const FINANCE_KINDS: FinanceKind[] = ["income", "expense"];

/** หมวดรายจ่ายจริง */
export type FinanceExpenseCategory =
  | "ingredients"
  | "labor"
  | "utilities"
  | "rent"
  | "maintenance"
  | "marketing"
  | "other_expense";

/** หมวดรายรับมือ */
export type FinanceIncomeCategory = "other_income" | "catering" | "adjustment";

export type FinanceCategory = FinanceExpenseCategory | FinanceIncomeCategory;

export const FINANCE_EXPENSE_CATEGORIES: FinanceExpenseCategory[] = [
  "ingredients",
  "labor",
  "utilities",
  "rent",
  "maintenance",
  "marketing",
  "other_expense",
];

export const FINANCE_INCOME_CATEGORIES: FinanceIncomeCategory[] = [
  "other_income",
  "catering",
  "adjustment",
];

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

/** ขีดจำกัด validation การเงิน */
export const FINANCE_NOTE_MAX = 500;
export const FINANCE_REASON_MAX = 500;
export const FINANCE_AMOUNT_MAX = 100000000;

export interface FinanceEntry {
  id: string;
  kind: FinanceKind;
  category: FinanceCategory;
  /** จำนวนเงิน (บาท, >0, ทศนิยม ≤2) */
  amount: number;
  /** วันที่เกิดรายการ (UTC ISO — รับ wall-clock กรุงเทพแล้วแปลงที่ route/store) */
  occurredAt: string;
  note: string | null;
  /** เหตุผล (บังคับ — ใช้ตรวจสอบย้อนหลัง) */
  reason: string;
  actorId: string | null;
  actorUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ความละเอียดรายงาน: day (รายวัน) / month (รายเดือน) / year (รายปี) — buckets ฝั่ง Asia/Bangkok */
export type FinanceGranularity = "day" | "month" | "year";

export const FINANCE_GRANULARITIES: FinanceGranularity[] = ["day", "month", "year"];

/** ยอดสรุปหนึ่ง bucket (gross − refunds = net; net + manualIncome − expense = profit) */
export interface FinanceReportBucket {
  /** คีย์ bucket ฝั่งกรุงเทพ: day=YYYY-MM-DD, month=YYYY-MM, year=YYYY */
  bucket: string;
  /** รายรับรวมจาก paid payments (นับครั้งเดียวตาม paidAt) */
  grossRevenue: number;
  /** ยอดคืนเงิน (ครั้งเดียวตาม approvedAt) */
  refunds: number;
  /** รายรับสุทธิ = gross − refunds */
  netRevenue: number;
  /** รายรับมือ (kind=income) */
  manualIncome: number;
  /** รายจ่ายจริง (kind=expense) */
  actualExpense: number;
  /** กำไรเบื้องต้น = netRevenue + manualIncome − actualExpense */
  grossProfit: number;
  /** จำนวนคำสั่งซื้อที่ชำระสำเร็จ (paid payments, นับครั้งเดียว) */
  paidOrders: number;
  /**
   * ต้นทุนวัตถุดิบประมาณการรวม (จาก orders.estimatedCost ของคำสั่งซื้อที่ชำระ —
   * แสดงเพื่อวิเคราะห์เท่านั้น ไม่หักในกำไรเพื่อกันหักต้นทุนซ้ำกับรายจ่ายจริง)
   */
  estimatedCost: number;
}

export interface FinanceReport {
  granularity: FinanceGranularity;
  /** ขอบเขต wall-clock กรุงเทพที่ขอ (YYYY-MM-DD) */
  from: string;
  to: string;
  buckets: FinanceReportBucket[];
  total: FinanceReportBucket;
}

/** เมนูขายดีหนึ่งอันดับ (นับเฉพาะรายการในคำสั่งซื้อที่ชำระสำเร็จ) */
export interface FinanceTopMenu {
  menuId: string;
  menuName: string;
  quantity: number;
  revenue: number;
}

/** ชั่วโมงหนาแน่นหนึ่งชั่วโมง (0–23 ฝั่งกรุงเทพ) */
export interface FinancePeakHour {
  /** ชั่วโมงฝั่งกรุงเทพ 0–23 */
  hour: number;
  paidOrders: number;
  revenue: number;
}

/** ภาพ occupancy ปัจจุบัน (ถ้ามี — null เมื่อไม่มีข้อมูลโต๊ะ/รอบ) */
export interface FinanceOccupancy {
  enabledTables: number;
  freeTables: number;
  occupiedTables: number;
  customerCount: number;
}

/** KPI Dashboard รายวัน (Asia/Bangkok) */
export interface FinanceDashboard {
  /** วันที่ wall-clock กรุงเทพ (YYYY-MM-DD) */
  date: string;
  /** ยอดขายสุทธิวันนี้ = gross − refunds */
  netSales: number;
  grossRevenue: number;
  refunds: number;
  /** จำนวนคำสั่งซื้อที่ชำระสำเร็จ */
  paidOrders: number;
  /** บิลเฉลี่ย = netSales / paidOrders (0 เมื่อไม่มีคำสั่งซื้อ) */
  averageTicket: number;
  manualIncome: number;
  actualExpense: number;
  grossProfit: number;
  /** ต้นทุนประมาณการ (แยกวิเคราะห์ ไม่หักในกำไร) */
  estimatedCost: number;
  topMenus: FinanceTopMenu[];
  peakHours: FinancePeakHour[];
  occupancy: FinanceOccupancy | null;
  lowStockCount: number;
}

/** ประเภท CSV export (documented format — ดู FINANCE_CSV_FORMAT ใน routes/finance.ts) */
export type FinanceCsvKind = "sales" | "orders" | "finance" | "stock" | "queue";

export const FINANCE_CSV_KINDS: FinanceCsvKind[] = ["sales", "orders", "finance", "stock", "queue"];

/** หลักฐานกลับรายการคะแนนเมื่อคืนเงิน (กัน double-reversal) */
export interface LoyaltyReversal {
  id: string;
  orderId: string;
  refundId: string;
  customerId: string;
  /** คะแนนที่ย้อน (ติดลบหรือศูนย์เมื่อไม่มีคะแนนให้ย้อน) */
  points: number;
  createdAt: string;
}

/** ---------- Ticket 12: LINE notifications และ reliability (outbox local-first) ---------- */

/**
 * ชนิดข้อความแจ้งเตือน (หนึ่ง business event → หนึ่ง kind):
 * - reservation_created/cancelled/reminder = การจอง (reminder = เตือนก่อนนัด 30 นาที)
 * - payment_paid/manual_review = การชำระ (สำเร็จ / รอตรวจมือ)
 * - order_ready/order_delivered = คำสั่งซื้อพร้อมรับครบทุกงาน / ส่งมอบครบแล้ว
 *   (รวมเป็นเหตุการณ์เดียวต่อคำสั่งซื้อตาม D08 — ไม่แยกย่อยราย job)
 * - loyalty_earned/redeemed = ได้รับ/ใช้คะแนน
 */
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

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "reservation_created",
  "reservation_cancelled",
  "reservation_reminder",
  "payment_paid",
  "payment_manual_review",
  "order_ready",
  "order_delivered",
  "loyalty_earned",
  "loyalty_redeemed",
];

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

/**
 * สถานะ outbox:
 * - `pending` = รอส่ง (รวม retry ที่ถึงเวลาแล้ว)
 * - `sending` = กำลังส่ง (claim แล้ว — กัน flush ซ้อนส่งซ้ำ)
 * - `sent` = ส่งถึง provider แล้ว (terminal)
 * - `failed` = ส่งไม่สำเร็จแต่ retry ได้ (มี nextRetryAt)
 * - `dead_letter` = เกิน max attempts (terminal — ต้อง retry ด้วยมือ)
 * - `skipped` = ข้ามการส่ง (ไม่มี consent/LINE link/ลูกค้าไม่ valid — อ่านในเว็บแทน)
 */
export type NotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "dead_letter"
  | "skipped";

export const NOTIFICATION_STATUSES: NotificationStatus[] = [
  "pending",
  "sending",
  "sent",
  "failed",
  "dead_letter",
  "skipped",
];

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: "รอส่ง",
  sending: "กำลังส่ง",
  sent: "ส่งแล้ว",
  failed: "รอส่งซ้ำ",
  dead_letter: "ส่งไม่สำเร็จ",
  skipped: "ข้าม (ดูในเว็บ)",
};

/** ขีดจำกัด validation การแจ้งเตือน */
export const NOTIFICATION_MESSAGE_MAX = 2000;
export const NOTIFICATION_EVENT_KEY_MAX = 191;
export const NOTIFICATION_LAST_ERROR_MAX = 500;
/** จำนวนครั้งสูงสุดก่อนเป็น dead_letter (รวมครั้งแรก) */
export const NOTIFICATION_MAX_ATTEMPTS = 5;
/** เตือนการจองก่อนเวลานัด (นาที) */
export const NOTIFICATION_REMINDER_MINUTES_BEFORE = 30;

/**
 * แถว outbox: หนึ่ง eventKey → หนึ่งแถวเท่านั้น (exactly-once เชิงตรรกะ)
 * message เก็บเฉพาะข้อความภาษาไทยที่จะส่ง — ห้ามมี token/secret/PII เกินจำเป็น
 */
export interface Notification {
  id: string;
  /** คีย์กันซ้ำ เช่น `payment_paid:<paymentId>` (unique) */
  eventKey: string;
  kind: NotificationKind;
  /** ลูกค้าปลายทาง (null = หาผู้รับไม่ได้ตั้งแต่ enqueue — flush จะ skipped) */
  customerId: string | null;
  orderId: string | null;
  reservationId: string | null;
  paymentId: string | null;
  message: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  /** เวลาที่ retry ได้อีกครั้ง (null เมื่อ terminal/skipped) */
  nextRetryAt: string | null;
  /** ข้อผิดพลาดย่อที่ sanitize แล้ว (ไม่มี token/secret) */
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ---------- Ticket 13: Capacity และการพยากรณ์เวลารอ (local-first) ---------- */

/** แหล่งที่มาของเวลารอ: baseline deterministic หรือโมเดลภายนอก (ต้องดีกว่า baseline ก่อนเปิดใช้) */
export type PredictionSource = "baseline" | "model";

export const PREDICTION_SOURCES: PredictionSource[] = ["baseline", "model"];

/** ข้อความกำกับทุกเวลารอ — เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน (CONVENTION ห้ามเปลี่ยนความหมาย) */
export const PREDICTION_NON_GUARANTEE = "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน";

/** รุ่น baseline เริ่มต้น (deterministic — เวลามาตรฐานรายฝ่าย + คิว + ขนาดปาร์ตี้) */
export const PREDICTION_BASELINE_VERSION = "baseline-v1";
/** timeout เริ่มต้นของ prediction adapter (ms) — เกินแล้ว fallback baseline ทันที */
export const PREDICTION_DEFAULT_TIMEOUT_MS = 500;
export const PREDICTION_TIMEOUT_MIN_MS = 50;
export const PREDICTION_TIMEOUT_MAX_MS = 5000;
export const PREDICTION_MODEL_VERSION_MAX = 64;
/** เกณฑ์เปิดใช้โมเดล: MAE โมเดลต้องดีกว่า baseline อย่างน้อย threshold (นาที, default 0) */
export const PREDICTION_DEFAULT_THRESHOLD_MINUTES = 0;
/** ช่วงเวลารอแสดงเป็น [wait, wait + N] นาที */
export const PREDICTION_RANGE_PLUS_MINUTES = 5;
/** จำนวนปาร์ตี้ที่เริ่มบวกเวลารอเพิ่ม (+5 นาทีเมื่อมากกว่า) */
export const PREDICTION_LARGE_PARTY_SIZE = 4;
export const PREDICTION_LARGE_PARTY_EXTRA_MINUTES = 5;

export const PREDICTION_SOURCE_LABELS: Record<PredictionSource, string> = {
  baseline: "เวลามาตรฐาน",
  model: "โมเดลพยากรณ์",
};

/** ภาพกำลังผลิต/เวลารอรายฝ่าย (baseline deterministic) */
export interface CapacityStationSummary {
  station: QueueStation;
  /** กำลังผลิตต่อช่วง 15 นาที */
  perSlot: number;
  /** งาน active ที่พร้อมทำแล้ว (queued/claimed/preparing, readyAt ถึงแล้ว) */
  activeJobs: number;
  /** จำนวนชิ้นคงเหลือของงาน active */
  unitsAhead: number;
  /** เวลารอโดยประมาณ (นาที) */
  estimatedWaitMin: number;
  rangeMin: number;
  rangeMax: number;
  source: PredictionSource;
}

/** ภาพรวมกำลังผลิตร้าน (staff หลังร้าน) */
export interface CapacityOverview {
  /** เวลาที่คำนวณ (UTC ISO) */
  at: string;
  stations: CapacityStationSummary[];
  enabledTables: number;
  freeTables: number;
  occupiedTables: number;
  customerCount: number;
}

/** เวลารอรายฝ่ายของคำสั่งซื้อ (งานช้าที่สุดตัดสิน) */
export interface WaitStationBreakdown {
  station: QueueStation;
  jobs: number;
  queueAhead: number;
  unitsAhead: number;
  estimatedWaitMin: number;
}

/** ผลพยากรณ์เวลารอ (baseline หรือ model + metadata ครบ) */
export interface WaitEstimate {
  orderId: string | null;
  station: QueueStation | null;
  partySize: number;
  perStation: WaitStationBreakdown[];
  /** เวลารอโดยประมาณ = งานช้าที่สุด (นาที) */
  estimatedWaitMin: number;
  rangeMin: number;
  rangeMax: number;
  /** readyAt ช้าที่สุดของงานในคำสั่งซื้อ (null เมื่อไม่มีงาน) */
  readyAtSlowest: string | null;
  source: PredictionSource;
  modelVersion: string;
  predictedAt: string;
  timeoutMs: number;
  /** ข้อความกำกับ — เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน */
  nonGuarantee: string;
}

/** ผลตรวจสล็อตล่วงหน้า (preorder/reservation slot validation) */
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
  /** สล็อตว่างถัดไปเมื่อเต็ม (null เมื่อว่างหรือเต็มทั้ง 7 วัน) */
  suggestedSlot: QueueSlot | null;
}

/** รุ่นโมเดลพยากรณ์ (registry — โมเดลจริงยังไม่เลือกผู้ให้บริการ) */
export interface PredictionModel {
  version: string;
  kind: "baseline" | "external";
  enabled: boolean;
  /** MAE ต้องดีกว่า baseline อย่างน้อย threshold (นาที) จึงเปิดใช้ได้ */
  thresholdMinutes: number;
  timeoutMs: number;
  /** จำนวนตัวอย่างที่ประเมินแล้ว */
  samples: number;
  maeBaseline: number | null;
  maeModel: number | null;
  trainedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * ฟีเจอร์สำหรับฝึกโมเดลในอนาคต — เก็บ ณ จุดพยากรณ์เท่านั้น (no leakage):
 * ไม่มีข้อมูลอนาคต (actual มาตอนส่งมอบครบ) และไม่มี PII ลูกค้า
 * (ไม่มีชื่อ/เบอร์โทร/อีเมล/LINE user ID)
 */
export interface PredictionFeature {
  id: string;
  orderId: string | null;
  station: QueueStation | null;
  partySize: number;
  queueAhead: number;
  unitsAhead: number;
  /** ชั่วโมงฝั่งกรุงเทพ 0–23 ณ จุดพยากรณ์ */
  hourOfDay: number;
  /** วันฝั่งกรุงเทพ 0 (อาทิตย์)–6 (เสาร์) ณ จุดพยากรณ์ */
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

/** ผลเทียบความแม่นยำ baseline vs model (Owner เท่านั้น) */
export interface PredictionAccuracy {
  samples: number;
  maeBaseline: number | null;
  maeModel: number | null;
  meetsThreshold: boolean;
  thresholdMinutes: number;
  /** เกณฑ์ 500 งานตาม D09 — ยังไม่ครบให้รายงานว่าสะสมอยู่ */
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
