import { randomUUID } from "node:crypto";
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
  LineLoginTx,
  MenuItem,
  Role,
  Session,
  ShopTable,
  User,
} from "./types.js";
import { ConflictError, NotFoundError } from "./types.js";
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
    prefix: "login_" | "account_" | "shop_" | "customer_" | "menu_" | "all",
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
  close?(): Promise<void>;
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
  // ---- Ticket 03 memory state: บัญชีลูกค้า + เซสชัน + LINE (แยกจาก staff โดยสิ้นเชิง) ----
  const customers = new Map<string, Customer>();
  const customersByPhone = new Map<string, string>();
  const customersByEmail = new Map<string, string>();
  const customerSessions = new Map<string, CustomerSession>();
  const lineLinks = new Map<string, CustomerLineLink>();
  const lineLinksBySubject = new Map<string, string>();
  const lineTx = new Map<string, LineLoginTx>();

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

function isDuplicateColumnError(err: unknown): boolean {
  return (
    !!err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ER_DUP_FIELDNAME"
  );
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
      const statements = migration
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const sql of statements) {
        try {
          await conn.query(sql);
        } catch (err) {
          // ALTER ADD COLUMN รันซ้ำได้: มีคอลัมน์แล้ว (1060) ให้ข้าม
          if (!sql.toUpperCase().startsWith("ALTER TABLE") || !isDuplicateColumnError(err)) throw err;
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
