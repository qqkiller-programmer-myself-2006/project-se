# Security / PII Review — Release Hardening (Ticket 14)

ตรวจแบบ local-first เมื่อ 2026-09-15 (ไม่พึ่งบริการภายนอก) ครอบคลุม role/access
matrix ทุก endpoint, CSRF/session/cookie, secret redaction, input limits,
audit/error review และ dependency/static checks ที่ทำได้ในเครื่องนี้
หลักฐานอัตโนมัติ: `apps/api/tests/release.test.ts` (6 ข้อ) และ
`node scripts/verify-restore.mjs`

คำย่อบทบาท: `manager` = Owner หรือ Admin; `staff` = พนักงาน login แล้ว (บทบาทใดก็ได้);
`kitchen`/`drink` = พนักงานฝ่ายนั้น; `customer` = บัญชีลูกค้า (คุกกี้ `csid`);
`public` = ไม่ต้อง login; mutation ทุกตัวต้องมี CSRF ด้วย (double-submit cookie)

## 1. Role / access matrix (ตรวจจาก route definitions + release test)

### 1.1 Auth, health, observability (`apps/api/src/app.ts`)

| เมธอด | เส้นทาง | สิทธิ์ |
|---|---|---|
| POST | `/api/auth/login` | public + rate-limit + CSRF |
| POST | `/api/auth/logout` | staff + CSRF |
| GET | `/api/auth/me` | staff |
| POST | `/api/auth/change-password` | staff + CSRF |
| GET/POST | `/api/users` | **Owner** (+CSRF สำหรับ POST) |
| PATCH | `/api/users/:id/roles` | **Owner** + CSRF (ห้ามตั้ง/ถอด `owner` ผ่าน API) |
| POST | `/api/users/:id/deactivate`, `/activate`, `/reset-password` | **Owner** + CSRF |
| GET | `/api/audit/logins`, `/api/audit/accounts` | **Owner** |
| GET | `/api/auth/csrf`, `/api/health`, `/api/ready` | public |
| GET | `/api/metrics/summary` | **Owner** (Ticket 14 — ไม่ขยายให้ Admin) |

### 1.2 ร้าน/โต๊ะ (`routes/shop.ts`)

| เมธอด | เส้นทาง | สิทธิ์ |
|---|---|---|
| GET | `/api/shop/status`, `/api/shop/table-rounds` | public (sanitize แล้ว — ดูข้อ 4) |
| GET | `/api/shop/schedule`, `/api/tables` | manager |
| PUT | `/api/shop/schedule` | manager + CSRF |
| POST/DELETE | `/api/shop/override` | manager + CSRF |
| POST/PATCH | `/api/tables`, `/api/tables/:id` | manager + CSRF (ไม่มี DELETE) |
| GET | `/api/audit/shop` | manager |

### 1.3 ลูกค้า/LINE (`routes/customers.ts`)

| เมธอด | เส้นทาง | สิทธิ์ |
|---|---|---|
| POST | `/api/customers/register`, `/api/customers/login` | public + rate-limit + CSRF |
| POST/GET/PATCH/DELETE | `/api/customers/logout`, `/me`, `/change-password` (DELETE `/me`) | customer + CSRF (ยกเว้น GET) |
| POST | `/api/customers/line/start`, `/line/unlink` | customer + CSRF |
| GET | `/api/customers/line/callback` | public (redirect 302 เสมอ; state ครั้งเดียว, ไม่รับ sub จาก body) |
| GET | `/api/customers/line/status` | customer |
| GET | `/api/admin/customers`, `/:id` | manager |
| POST | `/api/admin/customers/:id/deactivate`, `/activate` | manager + CSRF |
| GET | `/api/audit/customers` | manager |

### 1.4 เมนู/ตัวเลือก (`routes/menu.ts`)

public: `GET /api/menu/public` (เฉพาะเมนูพร้อมขาย + ตัวเลือกที่เปิดขาย + ป้ายสต๊อกหมด)
ที่เหลือ manager ทั้งหมด: `GET /api/menu`, `/:id`, `/:id/option-groups`;
mutation (`POST /api/menu`, `PATCH /:id`, `POST /:id/archive|restore`,
`POST /api/menu/option-groups/:groupId/options`, `PATCH /api/menu/options/:optionId`, …)
เป็น manager + CSRF; `GET /api/audit/menu` manager

### 1.5 คำสั่งซื้อ/สต๊อก (`routes/orders.ts`, `routes/inventory.ts`)

- `POST /api/orders` — ทุกคน (guest/member/staff แทนลูกค้า) + CSRF + rate-limit;
  `GET /mine`, `/lookup`, `/:id` — เจ้าของ (customer/guest เบอร์ตรง) หรือ manager
- `GET /api/orders`, `PATCH /:id/status`, `GET /api/audit/orders` — manager (+CSRF สำหรับ PATCH)
- `POST /api/orders/:id/consume` — **staff ทุกบทบาท** (รวม kitchen/drink — ตัดสต๊อกตอนเริ่มทำ) + CSRF;
  ลูกค้า/Guest เรียกไม่ได้ (ตรวจ `sid` ฝั่ง server)
- inventory ทั้งหมด (`/api/inventory/**`, `/api/audit/inventory`) — manager (+CSRF สำหรับ mutation);
  `reserve/release/consume` ผ่านช่อง manual ไม่ได้ (ระบบจากคำสั่งซื้อเท่านั้น)

### 1.6 การจอง/รอบโต๊ะ (`routes/reservations.ts`)

- ลูกค้า: `POST /api/reservations`, `GET /mine`, `GET /mine/:id`, `POST /mine/:id/cancel` (+CSRF สำหรับ mutation) —
  Guest สร้างไม่ได้ (401); คนอื่นดู/ยกเลิกของคนอื่นไม่ได้ (403)
- หลังร้าน: `GET /api/admin/reservations`, `/:id`, `POST /api/checkin`,
  `GET /api/rounds`, `/:id`, `GET /api/audit/reservations` — manager (+CSRF สำหรับ checkin)
- public: `GET /api/reservations/recommend`, `GET /api/shop/table-rounds` (sanitize)

### 1.7 ชำระ/ใบเสร็จ/คืนเงิน (`routes/payments.ts`)

- `POST /api/payments`, `POST /:id/webhook`, `POST /:id/slip` — เจ้าของคำสั่งซื้อ + CSRF + rate-limit
- `GET /api/orders/:id/payment`, `GET /api/payments/:id`, `GET /api/receipts/by-payment/:paymentId` — เจ้าของหรือ manager
- `POST /:id/confirm-cash`, `POST /:id/resolve`, `POST /:id/expire` — staff หลังร้าน + CSRF
  (เงินสดยืนยันโดยพนักงานหน้าร้าน; ตรวจยอด ≥ total ฝั่ง server)
- `POST /:id/refund` — **Owner** + CSRF (เฉพาะ paid + ยังไม่ตัดสต๊อกจริง)
- `GET /api/payments`, `/receipts`, `/refunds`, `/api/audit/payments` — manager

### 1.8 คิว (`routes/queue.ts`)

- `GET /api/queue` — staff; kitchen/drink ถูกล็อกฝ่ายตนเอง (ขอฝ่ายอื่น 403)
- `GET /api/queue/order/:orderId` — เจ้าของคำสั่งซื้อ / manager / staff ตามฝ่าย
- `POST /api/queue/ensure` — staff + CSRF (exactly-once ต่อ payment)
- `POST /:id/claim|start|ready|deliver|priority|remake|cancel` — staff ตามฝ่าย + CSRF
  (priority/remake ต้องมีเหตุผล + audit)
- `GET /api/queue/capacity|slots|slots/next` — ทุกบทบาทที่ login (อ่าน);
  `PUT /api/queue/capacity` — manager + CSRF; `GET /api/audit/queue` — manager

### 1.9 คะแนน/รางวัล (`routes/loyalty.ts`)

- ลูกค้า: `GET /balance`, `/ledger`, `GET /rewards/redeemable`,
  `POST /rewards/:id/redeem`, `GET /redemptions/mine`, `POST /walkin/scan`,
  `POST /guest/link` (+CSRF/rate-limit สำหรับ mutation)
- ฝ่ายเครื่องดื่ม: `POST /walkin/issue`, `POST /redemptions/:id/consume|release`,
  `GET /redemptions/pending` (drink/admin/owner; kitchen ถูกปฏิเสธ)
- manager: `POST|PATCH /api/rewards`, `GET /api/rewards`,
  `POST /loyalty/merge`, `POST /loyalty/reverse`, `GET /api/audit/loyalty`

### 1.10 การเงิน/แจ้งเตือน/พยากรณ์ (`routes/finance.ts`, `notifications.ts`, `capacity.ts`)

- ทั้งหมด manager (+CSRF สำหรับ mutation): `POST|PATCH|DELETE /api/finance/entries`,
  `GET /reports|dashboard|analytics/*|export`, `GET /api/audit/finance`
- แจ้งเตือน: `GET /api/notifications`, `/:id`, `POST /:id/retry|run-outbox|run-reminders`,
  consent `GET|PUT /api/notification-consents*` — manager;
  ลูกค้าใช้ `GET /notifications/mine/list`, `PATCH /mine/consent` (ของตนเองเท่านั้น)
- capacity: `GET /capacity/overview` — staff ทุกบทบาท; `GET /capacity/wait`,
  `POST /capacity/preorder-check` — public แบบ rate-limit (ไม่มี PII);
  `GET|PUT /api/predictions/model`, `GET /accuracy|evaluate|features*`,
  `GET /api/audit/predictions` — manager (+CSRF สำหรับ PUT/POST)

## 2. CSRF / session / cookie (ตรวจแล้ว)

- mutation ทุกตัวต้องมี CSRF double-submit (`csrf` cookie vs `x-csrf-token`) —
  รวม login (กัน login CSRF); release test assert ไม่มี token → 403 + `code: FORBIDDEN`
- session แยกชนิดเด็ดขาด: staff (`sid`) vs customer (`csid`) — ข้ามกันไม่ได้ (server ตรวจทุกครั้ง)
- session ผูก `passwordVersion` — เปลี่ยน/รีเซ็ตรหัส, เปลี่ยนบทบาท, ปิดบัญชี →
  session เดิมใช้ไม่ได้ทันที (กัน reset/login race ด้วย re-read + compare)
- cookie: `HttpOnly` (session), `SameSite=Lax`, `Secure` เมื่อ `COOKIE_SECURE=true`;
  `trust proxy` default `false` (เพิกเฉย `X-Forwarded-For` ดิบ)
- rate-limit: login staff (default 10/15 นาที/IP), customer register+login (30),
  orders/payments/queue/loyalty/notify/capacity มี limiter เฉพาะของตน
- รหัสผ่าน bcrypt + ขีด 72 ไบต์ UTF-8 ทุกจุด (กันตัดเงียบ); ไม่ส่ง hash ใน response/log

## 3. Secret / token redaction (ตรวจแล้ว)

- audit เก็บเฉพาะผลลัพธ์ + actor/reason/before→after — ไม่เก็บรหัสผ่าน/hash/
  token/secret/verifier/nonce/state/sub/code (assert ใน release test + tests เดิมทุก ticket)
- `apps/api/src/observability.ts`: `sanitizeForLog` (redact key ลับ recursive +
  mask เบอร์ `08******78`) — ใช้เป็น contract กลางสำหรับ log ในอนาคต
- static grep (2026-09-15): `console.*` มีเฉพาะ `bootstrap.ts` (ข้อความ CLI —
  พิมพ์เฉพาะ username ไม่พิมพ์รหัสผ่าน) และ `index.ts` (port เท่านั้น);
  **ไม่มี hardcoded secret** ใน `apps/api/src` (grep `BEGIN PRIVATE KEY|sk_live|AKIA|password: "..."` = 0)
- LINE callback redirect มีเฉพาะ `line`/`reason` ทั่วไป — ไม่มี code/token/state/nonce/sub ใน query
- CSV export มี PII masking (เบอร์/ชื่อ) + UTF-8 BOM (Ticket 11)

## 4. Public surface ที่ไม่มี PII (ตรวจแล้ว)

- `GET /api/shop/status` (snapshot แคบ), `GET /api/shop/table-rounds`
  (เหลือ tableId/tableName/partySize/openedAt), `GET /api/menu/public`,
  `GET /api/capacity/wait`, `POST /api/capacity/preorder-check` —
  release test assert ไม่มี `phone/passwordHash/token/secret/sub` ใน response

## 5. Input limits (ตัวอย่างกฎที่บังคับฝั่ง server — routes ห้าม duplicate กฎ)

| กลุ่ม | ขีดจำกัด |
|---|---|
| ชื่อผู้ใช้ | 3–32, `a-z 0-9 _ . -` |
| รหัสผ่าน | ≥8 ตัวอักษร, ≤72 ไบต์ UTF-8 |
| ชื่อโต๊ะ/ความจุ | 1–64 ตัวอักษร (trim, ไม่ซ้ำ), int 1–50 |
| จอง | ล่วงหน้า 60 นาที–3 วัน, ยกเลิกก่อนนัด ≥60 นาที, จำนวน 1–50, หมายเหตุ ≤200, เหตุผล ≤500, slot 120 นาที |
| คำสั่งซื้อ | ≤20 บรรทัด, จำนวน 1–20, หมายเหตุ ≤200, special request ≤200 |
| ชำระ/คืนเงิน | เงินสดรับ ≥ total (ทอนถูก), refund เฉพาะ Owner + เหตุผล ≤500 |
| สต๊อก/สูตร | ปริมาณทศนิยม ≤3, ทุน ≤1,000,000 (ทศนิยม ≤2), สูตร ≤50 บรรทัด, เหตุผล ≤500 |
| คะแนน/QR | QR อายุ 10 นาที ครั้งเดียว, guest-link 24 ชม., เหตุผล ≤500 |
| JSON body | 32kb (`express.json({ limit: "32kb" })`) |
| audit list `limit` | 1–500 (clamp ทุก endpoint) |

## 6. Audit / error review

- audit ครอบคลุม login, บัญชี, ร้าน/โต๊ะ, ลูกค้า/LINE, เมนู, คำสั่งซื้อ, จอง/รอบ,
  สต๊อก/สูตร, ชำระ/คืนเงิน, คิว, คะแนน/รางวัล, การเงิน, แจ้งเตือน, พยากรณ์ —
  มี actor/reason/before→after; Owner อ่านได้ (บางหมวด Admin ได้ด้วย)
- Ticket 14 เพิ่ม error taxonomy คงที่ (`VALIDATION/AUTH/FORBIDDEN/NOT_FOUND/
  CONFLICT/RATE_LIMITED/UNAVAILABLE/INTERNAL` ใน field `code`) โดย**ไม่เปลี่ยน
  ข้อความ `error` ภาษาไทยเดิม** — contract/tests เดิมไม่แตก
- release test assert: ทุก audit action ที่เขียนจริงอยู่ใน catalog
  (`isKnownAuditAction`) — กัน typo ของ action ใหม่

## 7. Dependency / static checks (ทำได้ในเครื่องนี้, 2026-09-15)

- `npm audit --omit=dev` (exact): **9 vulnerabilities (4 moderate, 5 high)** —
  `qs` (moderate, ผ่าน express), `react-router 6.x` (moderate),
  `deepmerge-ts→@prisma/config→prisma` และ `mariadb→@prisma/adapter-mariadb` (high)
- **ไม่ทำ `audit fix`**: ของ moderate ต้อง major upgrade (`react-router-dom@7`,
  ตาม README เดิม) ส่วน high อยู่ใน dependency chain ของไฟล์ต้องห้าม
  (`apps/api/package.json`, `package-lock.json`, `prisma/` — working tree
  ค้างก่อน Ticket 14 ห้ามแตะ) — บันทึกเป็น deferred gate ให้ Owner อนุมัติ
  upgrade แยก (mitigation ปัจจุบัน: rate-limit + input limits + trust-proxy=false)
- `npm run typecheck` (api+web) และ `npm run build` (api tsc + web vite) ผ่าน —
  ดูผลใน ticket
- Docker/MySQL runtime จริง, LINE/sandbox, browser E2E จริง — นอก scope เครื่องนี้
  (deferred gates ใน ticket)
