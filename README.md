# ร้านป้าอ้อ — บัญชี Owner/พนักงาน + สถานะร้านและโต๊ะ (Ticket 01–02)

Vertical slice แรกของระบบร้านป้าอ้ออาหารตามสั่ง: Owner bootstrap, บัญชีพนักงานหลายบทบาท,
authentication ด้วย session คุกกี้, การจัดการบัญชี, และการตรวจ audit ผ่าน UI ภาษาไทย
(Ticket 01) ต่อด้วยสถานะร้านสาธารณะ ตารางเวลาเปิดประจำสัปดาห์ คำสั่งเปิด–ปิดชั่วคราว
และการจัดการโต๊ะ (Ticket 02)

อ้างอิง: `.scratch/pa-or-restaurant/issues/01-staff-accounts.md`,
`.scratch/pa-or-restaurant/issues/02-shop-status-and-tables.md`, Spec D01/D02/D10
(`.scratch/pa-or-restaurant/spec.md`), `docs/REQUIREMENTS.md`

## สถาปัตยกรรม

| ส่วน | เทคโนโลยี | ที่อยู่ |
|---|---|---|
| API | Node.js + Express + TypeScript | `apps/api/src` |
| UI | React + Tailwind CSS (ภาษาไทย, responsive) | `apps/web/src` |
| ฐานข้อมูล | MySQL 8 ผ่าน Docker + phpMyAdmin (runtime ใช้ MySQL จริงเท่านั้น) | `docker-compose.yml`, `db/migrations/001_staff_accounts.sql`, `002_credential_version.sql`, `003_shop_status_tables.sql` |

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

## ตรวจ/ทดสอบ

```powershell
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run test -w apps/api   # Ticket 01: 29 API + 4 env + Ticket 02: 11 shop-status + 4 shop-store + 5 shop-schedule (memory/fault seam ฉีดเฉพาะในเทสต์)
npm run test -w apps/web   # Ticket 01 (login/staff/audit/change-password/App/api-client) + Ticket 02 (bangkok-time 7/status 7/shop 10/tables 6/shell 4)
npm run build -w apps/api
npm run build -w apps/web
```

`tests/mysql.int.test.ts` (Ticket 01, 6 ข้อ) และ `tests/shop-mysql.int.test.ts`
(Ticket 02, 3 ข้อ: CRUD + snapshot/audit, transaction rollback เมื่อ audit เขียนไม่ได้,
override datetime round-trip) ใช้ **MySQL จริงผ่าน `TEST_DATABASE_URL` แยกจาก production เท่านั้น**:

- ไม่มี `TEST_DATABASE_URL` → **skip ชัดเจน (9 skipped)** ไม่นับว่าผ่าน
- มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → **FAIL** (ห้าม catch แล้วผ่าน)
- ทำความสะอาด users/sessions/audit ที่สร้างทั้งหมดหลังจบ (`afterAll`)

## ข้อจำกัดที่ทราบ (สภาพแวดล้อมนี้)

- เครื่องนี้ไม่มี Docker/MySQL จึงตรวจ integration กับ MySQL จริงไม่ได้
  (ผลล่าสุด: `mysql.int 6 skipped` + `shop-mysql 3 skipped` —
  `SKIP ...: ไม่ได้ตั้งค่า TEST_DATABASE_URL`)
  ต้องรันบนเครื่องที่มี Docker/MySQL ด้วย `TEST_DATABASE_URL` แยกก่อนปิด ticket
- ไม่มีเบราว์เซอร์อัตโนมัติในสภาพแวดล้อมนี้ จึงตรวจ responsive/keyboard จริงไม่ได้
  (web tests ตรวจ states/labels/landmarks/role-nav ใน jsdom เท่านั้น)
- `npm audit --omit=dev` ผลล่าสุด: 3 moderate (`qs` ผ่าน express, `react-router` 6.x)
  ยังไม่ upgrade เพราะ `react-router-dom@7` เป็น breaking change (ไม่ทำ forced major upgrade)
