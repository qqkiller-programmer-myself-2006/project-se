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
  | "table_round_closed";

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
  createdAt: string;
  updatedAt: string;
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
