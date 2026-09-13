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
  | "customer_activated";

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
