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
  | "shop_table_updated";

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
