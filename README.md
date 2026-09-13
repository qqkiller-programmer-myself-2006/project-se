# ร้านป้าอ้อ — บัญชี Owner/พนักงาน + สถานะร้านและโต๊ะ + บัญชีลูกค้า/LINE (Ticket 01–03)

Vertical slice แรกของระบบร้านป้าอ้ออาหารตามสั่ง: Owner bootstrap, บัญชีพนักงานหลายบทบาท,
authentication ด้วย session คุกกี้, การจัดการบัญชี, และการตรวจ audit ผ่าน UI ภาษาไทย
(Ticket 01) ต่อด้วยสถานะร้านสาธารณะ ตารางเวลาเปิดประจำสัปดาห์ คำสั่งเปิด–ปิดชั่วคราว
และการจัดการโต๊ะ (Ticket 02) และบัญชีลูกค้าแยกจากพนักงานพร้อมการเชื่อม LINE Login v2.1
(Ticket 03)

อ้างอิง: `.scratch/pa-or-restaurant/issues/01-staff-accounts.md`,
`.scratch/pa-or-restaurant/issues/02-shop-status-and-tables.md`,
`.scratch/pa-or-restaurant/issues/03-customer-accounts.md`, Spec D01/D02/D10
(`.scratch/pa-or-restaurant/spec.md`), `docs/REQUIREMENTS.md`

## สถาปัตยกรรม

| ส่วน | เทคโนโลยี | ที่อยู่ |
|---|---|---|
| API | Node.js + Express + TypeScript | `apps/api/src` |
| UI | React + Tailwind CSS (ภาษาไทย, responsive) | `apps/web/src` |
| ฐานข้อมูล | MySQL 8 ผ่าน Docker + phpMyAdmin (runtime ใช้ MySQL จริงเท่านั้น) | `docker-compose.yml`, `db/migrations/001_staff_accounts.sql`, `002_credential_version.sql`, `003_shop_status_tables.sql`, `004_customer_accounts.sql` |
| LINE | LINE Login v2.1 Authorization Code + OIDC (backend-owned, fake ในเทสต์) | `apps/api/src/line/` |

บทบาท: `owner` (เจ้าของร้าน) · `admin` (ผู้ดูแลระบบ) · `kitchen` (ครัว) · `drink` (เครื่องดื่ม)
พนักงานหนึ่งบัญชีมีได้หลายบทบาท **การสร้าง/ดู/เปลี่ยนบทบาท/ปิด-เปิด/รีเซ็ตรหัสพนักงาน
ทำได้เฉพาะ Owner คนเดียว** (server บังคับทุกครั้ง, UI ซ่อนเมนูไว้แล้ว)
**การจัดการร้าน (เวลา/เปิด–ปิดชั่วคราว) และโต๊ะ ทำได้เฉพาะ Owner และ Admin**
(server บังคับทุกครั้ง, UI ซ่อนเมนูจาก kitchen/drink) หน้าสาธารณะ `/status` ดูได้โดยไม่ login

## เริ่มต้นใช้งาน

### 1. เตรียม environment (ไม่มี secret จริงใน repo)

```powershell
Copy-Item .env.example .env
# เปิด .env แล้วตั้ง DB_PASSWORD / DB_ROOT_PASSWORD / DATABASE_URL ให้เรียบร้อย
# compose จะ fail ทันทีถ้าไม่ตั้ง DB_PASSWORD / DB_ROOT_PASSWORD (ไม่มีค่าเริ่มต้น)
```

`apps/api` โหลด `.env` ที่ project root ผ่าน `dotenv` อัตโนมัติ ทั้ง `npm run dev:api`
และ `npm run bootstrap` (เมื่อรันจาก project root)

### 2. เริ่ม MySQL + API ด้วย Docker

```powershell
docker compose up -d --build
docker compose exec api npm run bootstrap:prod
```

- `bootstrap:prod` รันโค้ดคอมไพล์แล้ว (`node dist/src/bootstrap.js` ตรงกับ `CMD`
  ของ image; image ไม่มี `tsx` เพราะ prune dev deps) ส่วน dev ใช้ `npm run bootstrap`
- `npm start -w apps/api` รัน `node dist/src/index.js` ตรงกับ tsc output
  (`outDir: dist` + `rootDir: "."`) และ `CMD` ของ image
- bootstrap จะถามรหัสผ่านแบบซ่อน (ไม่ผ่าน argv/shell history) หรือตั้ง
  `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` เป็น env ให้ process นั้นก็ได้
- เปิด phpMyAdmin ได้ที่ `http://localhost:8081` (ค่า `PMA_PORT` ใน `.env`)

### 3. เริ่มแบบพัฒนาในเครื่อง (ต้องมี MySQL จริง)

```powershell
npm install
# ตั้ง DATABASE_URL ใน .env ให้ชี้ MySQL จริงก่อน (runtime ไม่มี memory fallback)
npm run dev:api    # http://localhost:4000 (โหลด .env ที่ root อัตโนมัติ)
npm run dev:web    # http://localhost:5173 (proxy /api ไป :4000)
```

### 4. สร้าง Owner คนแรก (บังคับระบุ credentials ชัดเจน)

```powershell
$env:BOOTSTRAP_USERNAME = "<ชื่อ>"; $env:BOOTSTRAP_PASSWORD = "<รหัสผ่าน>"
npm run bootstrap -w apps/api
# หรือ: npm run bootstrap -w apps/api -- --username <ชื่อ>  (ถามรหัสผ่านแบบซ่อน)
```

- ไม่มีรหัสผ่านตั้งต้นในโค้ด ไม่รับรหัสผ่านผ่าน argv และไม่พิมพ์ secret ลง log
- สร้างแบบ atomic (`GET_LOCK` + ตรวจก่อน insert ใน lock เดียวกัน) ถ้ามี Owner อยู่แล้ว
  จะปฏิเสธและ exit 1 — ไม่มี endpoint สมัคร Owner สาธารณะ

## API หลัก (public HTTP seam)

| เมธอด | เส้นทาง | สิทธิ์ |
|---|---|---|
| POST | `/api/auth/login` | สาธารณะ + rate-limit + **ต้องมี CSRF token** |
| POST | `/api/auth/logout` | เข้าสู่ระบบ + CSRF |
| GET | `/api/auth/me` | เข้าสู่ระบบ |
| POST | `/api/auth/change-password` | เข้าสู่ระบบ + CSRF |
| GET/POST | `/api/users` | **Owner เท่านั้น** |
| PATCH | `/api/users/:id/roles` | **Owner เท่านั้น** (ห้ามกำหนด/ถอดบทบาท owner ผ่าน API) |
| GET | `/api/shop/status` | สาธารณะ (snapshot แคบ ๆ ไม่มีข้อมูลหลังร้าน/ส่วนบุคคล) |
| GET | `/api/shop/schedule` | **Owner/Admin** |
| PUT | `/api/shop/schedule` | **Owner/Admin** + CSRF (ชื่อร้าน + ตาราง 7 วัน) |
| POST | `/api/shop/override` | **Owner/Admin** + CSRF (ปิดชั่วคราวต้องมีเหตุผล ชนะตารางเสมอ) |
| DELETE | `/api/shop/override` | **Owner/Admin** + CSRF (ล้างกลับไปใช้ตาราง) |
| GET/POST | `/api/tables` | **Owner/Admin** (ชื่อไม่ซ้ำ trim, ความจุ int 1–50) |
| PATCH | `/api/tables/:id` | **Owner/Admin** + CSRF (แก้ชื่อ/ความจุ/พร้อมใช้งาน–งดใช้งาน — ไม่มี DELETE) |
| GET | `/api/audit/shop` | **Owner/Admin** |
| POST | `/api/users/:id/deactivate` | **Owner เท่านั้น** |
| POST | `/api/users/:id/activate` | **Owner เท่านั้น** |
| POST | `/api/users/:id/reset-password` | **Owner เท่านั้น** |
| GET | `/api/audit/logins`, `/api/audit/accounts` | Owner เท่านั้น |
| GET | `/api/auth/csrf`, `/api/health` | สาธารณะ |
| POST | `/api/customers/register` | สาธารณะ + rate-limit + **ต้องมี CSRF token** (สมัครแล้ว login ทันที) |
| POST | `/api/customers/login` | สาธารณะ + rate-limit + **ต้องมี CSRF token** |
| POST | `/api/customers/logout` | ลูกค้า + CSRF |
| GET | `/api/customers/me` | ลูกค้า |
| PATCH | `/api/customers/me` | ลูกค้า + CSRF (แก้ชื่อ/อีเมล) |
| POST | `/api/customers/change-password` | ลูกค้า + CSRF (ล้างทุกเซสชัน ต้อง login ใหม่) |
| DELETE | `/api/customers/me` | ลูกค้า + CSRF (PII นิรนาม + ถอน LINE + ล้างเซสชัน) |
| POST | `/api/customers/line/start` | ลูกค้า + CSRF (สร้าง state/nonce/PKCE อายุ 10 นาที) |
| GET | `/api/customers/line/callback` | สาธารณะ (callback จาก LINE — ระบุตัวตนจาก state ครั้งเดียว ไม่รับ sub จาก body) |
| GET | `/api/customers/line/status` | ลูกค้า |
| POST | `/api/customers/line/unlink` | ลูกค้า + CSRF (ลบ link + แจ้ง adapter) |
| GET | `/api/admin/customers`, `/api/admin/customers/:id` | **Owner/Admin** (safe fields + สถานะ LINE) |
| POST | `/api/admin/customers/:id/deactivate`, `/activate` | **Owner/Admin** + CSRF (ปิดแล้วยกเลิกเซสชัน) |
| GET | `/api/audit/customers` | **Owner/Admin** |

กฎสำคัญ:

- เปลี่ยนรหัส/รีเซ็ต/ปิดบัญชี/เปลี่ยนบทบาท → เซสชันเดิมทั้งหมดถูกยกเลิกทันที
- กัน reset/login race ด้วย `password_version`: login ตรวจ hash สดซ้ำหลัง compare
  (หลักฐาน stale ถูกปฏิเสธ) เซสชันผูก version ตอนสร้าง ถ้า version ไม่ตรง user
  ปัจจุบันจะใช้ไม่ได้แม้แถว session ยังอยู่
- รหัสผ่านเก็บแบบ bcrypt hash **บังคับไม่เกิน 72 ไบต์ (UTF-8) ทุกจุด**
  (login/create/change/reset/bootstrap) เพราะ bcrypt ตัดส่วนเกินแบบเงียบ
- ไม่ส่ง hash/รหัสผ่านใน response/log; audit เก็บเฉพาะผลลัพธ์ ไม่เก็บ secret
- `trust proxy` ค่าเริ่มต้น `false` (เพิกเฉย `X-Forwarded-For` ดิบเสมอ)
  ตั้ง `TRUSTED_PROXY` (คั่นด้วย comma) เฉพาะเมื่ออยู่หลัง reverse proxy ที่ไว้ใจได้จริง

กฎสำคัญ (Ticket 02 เพิ่มเติม):
- ตารางเวลาเปิดประจำสัปดาห์คำนวณฝั่ง `Asia/Bangkok` รองรับปิดทั้งวันและช่วงข้ามเที่ยงคืน
  (overnight ต้องเป็นช่วงสุดท้ายได้วันละ 1 ช่วง และไม่ซ้อนวันถัดไป) กฎรวมใน
  `apps/api/src/shop/schedule.ts` — routes ห้าม duplicate กฎ
- คำสั่งเปิด–ปิดชั่วคราวชนะตารางเสมอ ปิดต้องมีเหตุผล (≤300 ตัวอักษร)
  `expectedReopenAt` (คาดว่าจะเปิด = แสดงผลเท่านั้น) แยกจาก `expiresAt`
  (หมดอายุคำสั่ง = มีผลจริง ต้องอยู่ในอนาคต) ของหมดอายุไม่ถือว่า active
  (`override: null` + `expiredOverride`) ทั้ง public และ management
- ช่องวันเวลาใน UI เป็น wall-clock กรุงเทพ (Asia/Bangkok, UTC+07:00 ไม่มี DST):
  `apps/web/src/lib/bangkok-time.ts` แปลงเป็น UTC ISO แบบ pure
  (เช่น `2026-09-12T18:30` กรุงเทพ = `2026-09-12T11:30:00.000Z` เสมอ
  ไม่พึ่ง timezone เครื่อง) ค่าผิด/เป็นไปไม่ได้ถูกปฏิเสธฝั่ง client ด้วยข้อความไทย
  ก่อนเรียก API; server แปลง ISO↔DATETIME ด้วย UTC getters (pool `timezone: Z`)
  และรับเฉพาะ ISO ที่มี timezone ชัดเจน (ลงท้าย `Z` หรือ `±HH:MM` —
  ค่าไม่มี timezone ถูกปฏิเสธ 400)
- public snapshot แสดง `serviceWindow` (รอบที่เปิดอยู่จริง `{sourceWeekday, open, close, overnight}`)
  ถ้าเปิดจาก overnight เมื่อวานจะชี้ช่วงของเมื่อวาน ไม่ใช่ตารางวันนี้
- mutation ร้าน/โต๊ะทุกตัวเป็น atomic พร้อม audit ผ่าน Store
  (`saveShopConfig` คืน `ShopConfigSnapshot` เฉพาะชื่อ/ตาราง/override ไม่แตะ tables;
  `setShopOverride`/`clearShopOverride`/`createShopTable`/`updateShopTable`):
  event action/detail สร้างจาก factory กลาง `apps/api/src/shop/audit-events.ts`
  (Memory/MySQL ใช้ semantics เดียวกัน);
  MySQL ใช้ transaction บน connection เดียว (begin/commit/rollback + release เสมอ),
  memory rollback ทั้ง state และลำดับ audit; public status อ่านจาก
  `getShopSnapshot()` (snapshot คงเส้นคงวาชุดเดียว)
- โต๊ะเก็บเฉพาะ `พร้อมใช้งาน/งดใช้งาน` (ไม่มี `occupied` boolean หลอก) โต๊ะว่าง =
  โต๊ะพร้อมใช้งาน − รอบเปิดจาก `OccupancyProvider` (default zero จนกว่า ticket รอบการใช้โต๊ะ
  จะมา implement) ชื่อ trim ไม่ซ้ำ ความจุ int 1–50 ไม่มี endpoint ลบ
- นาฬิกาฉีดผ่าน `AppOptions.now` (default เวลาจริง) เทสต์กำหนดเวลาตายตัวผ่าน seam นี้
- Ticket 02 routes อยู่ใน `apps/api/src/routes/shop.ts` (รับ middleware/clock/occupancy
  ผ่าน deps) `app.ts` เหลือ Ticket 01 + mount router; web ใช้ `WeekdayKey`/`WEEKDAY_KEYS`
  ร่วมกัน และประวัติร้านใช้ `AuditItem` ตัวเดียว (ไม่มี `ShopAuditItem` ซ้ำ)

กฎสำคัญ (Ticket 03 — บัญชีลูกค้าและการเชื่อม LINE):

- บัญชีลูกค้าแยกจากพนักงานโดยสิ้นเชิง: ตาราง (`customers`/`customer_sessions`),
  คุกกี้ (`csid` vs `sid`) และ middleware แยกกัน session ข้ามชนิดใช้แทนกันไม่ได้ (server ตรวจทุกครั้ง)
- เบอร์โทร normalize กฎไทยที่ `apps/api/src/customer/phone.ts` (ตัดขีด/ช่องว่าง/วงเล็บ,
  `+66`/`66` → `0`, ต้องได้ 10 หลักขึ้นต้น `0`) ซ้ำกันถูกปฏิเสธ 409 แม้เขียนต่างรูปแบบ
  อีเมล optional (ว่าง = null, trim + ตัวพิมพ์เล็ก, ซ้ำถูกปฏิเสธ 409)
- รหัสผ่าน bcrypt ขีด 72 ไบต์เหมือนพนักงานทุกจุด; เปลี่ยนรหัส/ปิดบัญชี → ล้างเซสชันลูกค้าทั้งหมดทันที
  (เซสชันผูก `passwordVersion` กัน race แบบเดียวกับ staff)
- audit ลูกค้า (`customer_*`) เก็บเบอร์แบบ mask (`08******78`) ไม่เก็บ hash/token/verifier/nonce
  ดูได้เฉพาะ Owner/Admin ผ่าน `/api/audit/customers`
- LINE Login v2.1 backend-owned: `state`/`nonce` สุ่ม 64 hex ใหม่ทุก attempt + PKCE S256,
  tx อายุ 10 นาที; callback ใช้ `peekLineTx` (อ่านอย่างเดียว ไม่ mark used) เป็น pre-check
  ก่อนแลก code แล้ว consume แบบ one-time atomic พร้อม audit ของผลลัพธ์ใน seam เดียวเท่านั้น
  (สำเร็จ→`linkLineIdentityWithConsume`: link + consume + `customer_line_linked` ใน transaction/seam เดียว;
  ล้มเหลวทุกขั้นหลัง peek→`consumeLineTxWithAudit`: consume + `customer_line_link_failed` ใน seam เดียว;
  ใช้ซ้ำ/หมดอายุ/แข่งกัน → redirect error โดยไม่เขียน audit ซ้ำ)
  เหตุผลที่ **ไม่** consume ก่อนแลก code: การแลก code เป็น I/O ภายนอก (LINE API) ที่เข้าร่วม
  DB transaction ไม่ได้ — consume ก่อนจะได้แค่ (ก) เผา state โดยไม่มี audit ของผลลัพธ์
  (เสีย invariant “state เปลี่ยนต้องมี audit”) หรือ (ข) consume แล้วชดเชยคืนเมื่อล้มเหลว
  (มีหน้าต่าง crash ที่ state ไหม้โดยไม่มี audit/link และเปิด replay) ส่วน flow ปัจจุบันยังกัน
  replay ได้เท่าเดิม: สำเร็จครั้งเดียวผ่าน `SELECT ... FOR UPDATE` + `used_at` + unique
  `(provider, provider_subject)` (MySQL) / backup-restore (memory) และ code ฝั่ง LINE
  ใช้ได้ครั้งเดียว; แต้มล้มเหลวเผา state เพื่อกัน brute-force ส่วน audit infra พัง rollback
  การ consume แล้วโยน error (state ยังใช้ได้ → retry ได้) ไม่เก็บ code/token/secret/state/nonce/sub
  ใน audit/redirect เด็ดขาด
  redirect รับเฉพาะ allowlist (`/profile`, `/customer/profile`, `/line`, `/customer/login`, `/`) นอกนั้นตกเป็น `/profile`
- callback (`GET /api/customers/line/callback`) ตอบเป็น redirect 302 เสมอ ไม่ค้างเป็น JSON:
  ไป `CUSTOMER_UI_URL` + allowlist path (ไม่ตั้ง = same-origin fallback) พร้อม query
  `?line=linked` (สำเร็จ) หรือ `?line=error&reason=<cancelled|invalid_response|expired_or_used|exchange_failed|verify_failed|conflict|unavailable|internal>`
  เท่านั้น — ไม่ใส่ code/token/secret/state/nonce/sub ใน query; หน้าโปรไฟล์อ่าน query นี้มาแสดงผลไทย
- ห้ามรับ LINE user ID จาก request body — ใช้เฉพาะ `sub` จาก claims ที่ adapter ยืนยันแล้ว
  (`iss`/`aud`/`exp`/`nonce` ตรวจซ้ำทุกครั้ง) ไม่ persist token ใด ๆ หลังเชื่อม
  ความสัมพันธ์หนึ่งต่อหนึ่งทั้งสองทิศ (ลูกค้ามีได้หนึ่ง LINE, LINE หนึ่งค่าผูกได้หนึ่งบัญชี)
- unlink/ลบบัญชีเรียก `adapter.deauthorize` ก่อนลบความสัมพันธ์ภายในเสมอ (fake บันทึกการเรียกในเทสต์
  และ assert subject ถูกต้อง) ล้มเหลวต้องคง local link ไว้ (ตอบ 502) ลบเฉพาะหลัง success —
  ยกเว้น Disabled provider (ไม่เคยตั้งค่าเลย ไม่มี external auth ให้ revoke) ที่ทำความสะอาดภายในต่อได้
  ลบบัญชีทำ PII เป็นนิรนาม (`ลูกค้าที่ลบบัญชี`, phone/email = null เพื่อให้เบอร์นำกลับมาใช้ใหม่ได้)
  คง id ภายใน + ล้างเซสชัน + ถอน LINE ใน transaction เดียวพร้อม audit
- สมัครสำเร็จ (customer + initial session + audit), login สำเร็จ (session + login audit),
  เริ่มเชื่อม LINE (line state tx + audit) เป็น atomic ที่ Store seam ผ่าน narrow methods
  (`registerCustomerWithSession`, `createCustomerSessionWithAudit`, `createLineLoginTxWithAudit`)
  ทั้ง Memory (backup/restore) และ MySQL (transaction เดียว) — routes ห้ามแยกเรียกหลายขั้น
  เทสต์ failure-injection พิสูจน์ rollback ทั้ง state/session/audit
- ยังไม่ตั้ง `LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`/`LINE_REDIRECT_URI` → `POST /line/start`
  ตอบ 503 fail-fast (เทสต์ฉีด `FakeLineProvider` ผ่าน deps ห้ามเรียก LINE จริง)
- ข้อจำกัดที่รู้แล้ว (ซื่อสัตย์): รุ่นนี้ตั้งใจไม่เก็บ user access token ระยะยาว `RealLineProvider.deauthorize`
  จึงเรียก `POST .../user/v1/deauthorize` ของ LINE แบบเต็ม (ต้องใช้ userAccessToken สด) ไม่ได้ —
  เมธอดนี้โยน `LineDeauthorizeError` ชัดเจนทุกครั้ง (ห้ามสำเร็จแบบเงียบ ห้าม log token/secret)
  และ unlink/delete คง local link ไว้พร้อมตอบ 502; ผู้ใช้เพิกถอนเองได้ที่ LINE Settings > Account > Authorized apps
  (flow เก็บ token ขั้นต่ำเข้ารหัส at-rest ด้วย `LINE_TOKEN_ENCRYPTION_KEY` เพื่อ deauthorize เต็มรูปแบบเป็นงาน follow-up);
  หน้าเว็บเปิด authorize URL ในแท็บใหม่แล้วกด “ตรวจสอบสถานะ” (ยังไม่มี auto-redirect กลับเข้าเว็บ
  นอกจาก callback redirect 302 กลับมาเมื่อ LINE ส่ง browser มาที่ callback โดยตรง)

## ตรวจ/ทดสอบ

```powershell
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run test -w apps/api   # Ticket 01: 29 API + 4 env + Ticket 02: 12 shop-status + 4 shop-store + 5 shop-schedule + Ticket 03: 19 customers + 15 customer-line + 10 line-provider (memory/fault seam ฉีดเฉพาะในเทสต์)
npm run test -w apps/web   # เดิม 56 + ใหม่ 23 (phone 2/customer-auth 6/customer-profile 8/admin-customers 4/customer-shell 3)
npm run build -w apps/api
npm run build -w apps/web
```

`tests/mysql.int.test.ts` (Ticket 01, 6 ข้อ), `tests/shop-mysql.int.test.ts`
(Ticket 02, 3 ข้อ: CRUD + snapshot/audit, transaction rollback เมื่อ audit เขียนไม่ได้,
override datetime round-trip) และ `tests/customer-mysql.int.test.ts`
(Ticket 03, 4 ข้อ: CRUD/profile/password, unique/tx consume/link conflict,
LINE start→callback→unlink ผ่าน HTTP, migration 004 รันซ้ำ) ใช้ **MySQL จริงผ่าน `TEST_DATABASE_URL`
แยกจาก production เท่านั้น**:

- ไม่มี `TEST_DATABASE_URL` → **skip ชัดเจน (13 skipped)** ไม่นับว่าผ่าน
- มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → **FAIL** (ห้าม catch แล้วผ่าน)
- ทำความสะอาด users/sessions/audit + customers/customer_sessions/line_links/line_tx ที่สร้างทั้งหมดหลังจบ (`afterAll`)

## ข้อจำกัดที่ทราบ (สภาพแวดล้อมนี้)

- เครื่องนี้ไม่มี Docker/MySQL จึงตรวจ integration กับ MySQL จริงไม่ได้
  (ผลล่าสุด: `mysql.int 6 skipped` + `shop-mysql 3 skipped` + `customer-mysql 4 skipped` —
  `SKIP ...: ไม่ได้ตั้งค่า TEST_DATABASE_URL`)
  ต้องรันบนเครื่องที่มี Docker/MySQL ด้วย `TEST_DATABASE_URL` แยกก่อนปิด ticket
  (รวม migration 004 รันซ้ำ + tx rollback บน MySQL จริง)
- ไม่มีเบราว์เซอร์อัตโนมัติในสภาพแวดล้อมนี้ จึงตรวจ responsive/keyboard จริงไม่ได้
  (web tests ตรวจ states/labels/landmarks/role-nav ใน jsdom เท่านั้น)
- ไม่ได้ตรวจกับ LINE จริง (ไม่มี channel/dev tester ในเครื่องนี้) — ใช้ `FakeLineProvider`
  ตรวจทุก branch (success/error/reuse/expiry/nonce/issuer/audience/signature/timeout/conflict/allowlist)
  ส่วน sandbox จริงต้องตรวจด้วย Tester account ก่อน `resolved`
- ชุด web tests ทั้งหมดรันพร้อมกัน (`npm run test -w apps/web`) ใช้หน่วยความจำเกินขีดเครื่องนี้
  (worker OOM) จึงรันทีละไฟล์/ทีละชุดด้วย `NODE_OPTIONS=--max-old-space-size=3072` แล้วรวมผล —
  ผ่านครบทุกไฟล์ (ดูรายงานใน ticket)
- `npm audit --omit=dev` ผลล่าสุด: 3 moderate (`qs` ผ่าน express, `react-router` 6.x)
  ยังไม่ upgrade เพราะ `react-router-dom@7` เป็น breaking change (ไม่ทำ forced major upgrade)
