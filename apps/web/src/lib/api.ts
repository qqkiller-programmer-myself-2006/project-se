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

export interface ShopTable {
  id: string;
  name: string;
  capacity: number;
  isEnabled: boolean;
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
  createTable: (name: string, capacity: number) =>
    req<{ table: ShopTable }>("/api/tables", { method: "POST", body: JSON.stringify({ name, capacity }) }, true),
  updateTable: (id: string, patch: { name?: string; capacity?: number; isEnabled?: boolean }) =>
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
};
