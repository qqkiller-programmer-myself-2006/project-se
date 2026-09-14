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
};
