# 02: สถานะร้านและการจัดการโต๊ะ

**What to build:** หน้าสาธารณะสำหรับดูสถานะเปิด–ปิดร้าน จำนวนโต๊ะว่าง และจำนวนผู้ใช้บริการปัจจุบัน พร้อมหน้าหลังร้านที่ Admin/Owner ใช้กำหนดเวลาเปิดประจำสัปดาห์ ปิดร้านชั่วคราวพร้อมเหตุผลและเวลาเปิดคาดหมาย จัดการข้อมูลโต๊ะ และตรวจประวัติการเปลี่ยนสถานะร้านได้

**Blocked by:** None (ต่อยอดจาก interface บัญชี/สิทธิ์ของ Ticket 01 ที่มี automated tests ผ่านแล้ว โดยไม่ต้องรอ environment verification ของ Ticket 01)

**Status:** claimed

**Assignee:** opencode-executor ผ่าน Codex

## Scope

อ้างอิง Spec D02, User Stories 1, 3, 35, 48 และคุณภาพ D10 รุ่นแรกมีร้านเดียว/สาขาเดียว คำสั่งปิดหรือเปิดชั่วคราวมีผลเหนือเวลาประจำสัปดาห์และต้องเก็บประวัติ การปิดร้านไม่ลบหรือยกเลิกข้อมูลเดิมอัตโนมัติ Ticket นี้ยังไม่รวมการจอง เช็กอิน QR รอบการใช้โต๊ะ หรือรายการรอจัดโต๊ะ ซึ่งจะต่อยอดใน ticket ถัดไป

เพื่อไม่สร้างสถานะที่ขัดกับรอบการใช้โต๊ะในอนาคต ข้อมูลโต๊ะใน ticket นี้เก็บสถานะการใช้งานเชิงปฏิบัติการ (`พร้อมใช้งาน`/`งดใช้งาน`) ส่วน `ว่าง` และจำนวนผู้ใช้บริการเป็น snapshot ที่คำนวณจากโต๊ะพร้อมใช้งานและรอบการใช้โต๊ะที่เปิดอยู่; ก่อนมี module รอบการใช้โต๊ะ จำนวนผู้ใช้บริการเป็น 0 และโต๊ะพร้อมใช้งานถือว่าว่าง

## Acceptance criteria

- [x] Guest เปิดหน้าสาธารณะได้โดยไม่เข้าสู่ระบบ และเห็นชื่อร้าน สถานะเปิด–ปิด เหตุผล/เวลาเปิดคาดหมายเมื่อปิดชั่วคราว เวลาทำการวันนี้ จำนวนโต๊ะว่าง/พร้อมใช้งาน และจำนวนผู้ใช้บริการปัจจุบัน
- [x] ระบบคำนวณสถานะร้านตาม timezone `Asia/Bangkok` จากตารางเวลาเปิดประจำสัปดาห์ และรองรับวันที่ปิดทั้งวัน/ช่วงเวลาข้ามเที่ยงคืนอย่างชัดเจน
- [x] Admin และ Owner แก้ตารางเวลาเปิดประจำสัปดาห์ได้; Kitchen/Drink/Guest ถูกปฏิเสธที่ server
- [x] Admin และ Owner สั่งปิดหรือเปิดชั่วคราวได้ โดยปิดชั่วคราวต้องมีเหตุผลและกำหนดเวลาเปิดคาดหมายได้ คำสั่งชั่วคราวมีผลเหนือเวลาประจำสัปดาห์
- [x] ทุกการแก้เวลาทำการและคำสั่งเปิด–ปิดถูกบันทึก audit พร้อมผู้กระทำ เวลา และรายละเอียดที่ไม่เก็บ secret
- [x] Admin และ Owner เพิ่ม แก้ชื่อ/ความจุ และเปลี่ยนสถานะพร้อมใช้งาน/งดใช้งานของโต๊ะได้; ชื่อโต๊ะไม่ซ้ำ ความจุมากกว่าศูนย์ และห้ามลบข้อมูลแบบทำลายประวัติ
- [x] Public API ส่ง snapshot ที่สอดคล้องกันสำหรับสถานะร้าน จำนวนโต๊ะว่าง และจำนวนผู้ใช้บริการ โดยไม่มีข้อมูลหลังร้านหรือข้อมูลส่วนบุคคล
- [x] API มี input validation, server authorization, deterministic clock seam และ integration behavior tests ครอบคลุม schedule/override/permission/table validation
- [ ] UI ภาษาไทย responsive ใช้ design system เดิม มี loading/error/empty/success states, keyboard focus, semantic labels และ touch target อย่างน้อยประมาณ 44px
- [ ] Migration MySQL รันซ้ำได้ตามแนวโครงการ, runtime ไม่มี memory fallback และมีตัวอย่าง environment/README ที่รันซ้ำได้
- [ ] API/Web tests, typecheck และ build ผ่าน; MySQL/browser checks ต้องรายงานตามผลจริงก่อนเปลี่ยนเป็น `resolved`

## Comments

ผู้ใช้สั่งทำ “next ticket 02” แต่ยังไม่มีไฟล์ Ticket 02 เดิม จึงกำหนดจากลำดับ Release 1 และ D02 ให้เป็นฐานสถานะร้าน/โต๊ะก่อนการจอง บันทึก assumption นี้เพื่อให้แก้ชื่อหรือขอบเขตภายหลังได้โดยไม่ปะปนกับการจอง

### ผลตรวจ Ticket 02 (2026-09-12, implement โดยตรง — ไม่มี git repo จึงไม่มี commit)

验收 8 ข้อแรกมีหลักฐาน automated tests รองรับจึงติ๊กแล้ว; 3 ข้อท้ายยังเปิดไว้เพราะต้องพึ่ง
environment จริง (MySQL/browser) — Status จึงคง `claimed` ตามคำสั่ง

- `npm run test:api` → 3 files passed, 2 skipped / **42 passed, 7 skipped (49)**:
  Ticket 01 เดิม 29 + env 4 ผ่านครบ (ไม่มี regression), ใหม่ `shop-status.test.ts` 9 ข้อผ่าน,
  `mysql.int.test.ts` 6 skipped + `shop-mysql.int.test.ts` 1 skipped
  (`SKIP ...: ไม่ได้ตั้งค่า TEST_DATABASE_URL` — ข้ามอย่างซื่อสัตย์ ไม่นับว่าผ่าน)
- `npm run test:web` → 9 files / **42 passed**: เดิม 22 ผ่านครบ + ใหม่ 20
  (`status` 5, `shop` 5, `tables` 6, `shell` 4: public /status, role-nav owner/admin/kitchen)
- `npm run typecheck` (api+web) ผ่าน, `npm run build` (api tsc + web vite, 40 modules) ผ่าน
- `npm audit --omit=dev` → 3 moderate (`qs` ผ่าน express, `react-router` 6.x);
  ไม่ทำ forced major upgrade (`react-router-dom@7` เป็น breaking change)
- Docker ใช้ไม่ได้ (`docker` not recognized), ไม่มี `TEST_DATABASE_URL`,
  ไม่มีเบราว์เซอร์อัตโนมัติ — MySQL integration, responsive/keyboard ภาพจริง
  ต้องตรวจบนเครื่องที่มี Docker/MySQL/browser ด้วย `TEST_DATABASE_URL` แยกก่อน `resolved`
- ไฟล์ที่เปลี่ยน (API): `apps/api/src/shop/schedule.ts` (ใหม่: normalize/validate/evaluate
  Bangkok/overnight + `AppOptions.now` clock seam), `apps/api/src/shop/occupancy.ts`
  (ใหม่: `OccupancyProvider` default zero, ไม่มี occupied boolean หลอก),
  `apps/api/src/types.ts` (audit `shop_*` + `ShopTable` 1–50), `apps/api/src/store.ts`
  (Store/memory/MySQL parity + migration 003), `apps/api/src/app.ts`
  (routes `/api/shop/status|schedule|override`, `/api/tables`, `/api/audit/shop`,
  `requireShopManager` owner/admin; kitchen/drink 403, guest 401; CSRF คงเดิม),
  `db/migrations/003_shop_status_tables.sql` (ใหม่, IF NOT EXISTS + INSERT IGNORE),
  `apps/api/tests/shop-status.test.ts` (ใหม่ 9 ข้อ), `apps/api/tests/shop-mysql.int.test.ts` (ใหม่)
- ไฟล์ที่เปลี่ยน (Web): `apps/web/src/lib/api.ts` (shop/table client),
  `apps/web/src/pages/Status.tsx`/`Shop.tsx`/`Tables.tsx` (ใหม่),
  `apps/web/src/App.tsx` (public `/status`, nav ร้าน/โต๊ะ เฉพาะ owner/admin,
  พนักงาน/ประวัติคง owner-only), `apps/web/tests/status|shop|tables|shell.test.tsx` (ใหม่ 20 ข้อ)
- เอกสาร: `README.md` (routes/กฎ Ticket 02, จำนวนเทสต์, ข้อจำกัด), ไฟล์ ticket นี้
- ที่ยังไม่เสร็จ: MySQL integration จริง, ตรวจ responsive/keyboard บนเบราว์เซอร์จริง,
  ตรวจ migration 003 รันซ้ำบน MySQL จริง

### ผลตรวจรอบ code review fixes (2026-09-12 — P1 atomicity, P2 expired/serviceWindow, Standards)

ติ๊ก acceptance เดิมไว้เท่าเดิม (8 ข้อแรกมีหลักฐาน, 3 ข้อท้ายรอ MySQL/browser จริง) —
Status คง `claimed` ตามคำสั่ง

- `npm run test:api` → 5 files passed, 2 skipped / **53 passed, 9 skipped (62)**:
  Ticket 01 29+4 ผ่านครบ (ไม่มี regression); ใหม่ `shop-schedule.test.ts` 5 (domain:
  WEEKDAY_KEYS, serviceWindow วันนี้/เมื่อวาน/ขอบปิด, effectiveOverride),
  `shop-store.test.ts` 4 (atomicity: save/override/table + rollback state/auditSeq
  เมื่อ audit ล้มเหลวผ่าน `failAudit` seam, clear ว่างไม่เขียน audit, snapshot เป็นสำเนา),
  `shop-status.test.ts` 11 (เพิ่ม: serviceWindow DTO ชี้ overnight เมื่อวานตอน 01:00
  และ null ที่ขอบปิด, expired/future override ทั้ง public/management + 400 เมื่อ
  expiresAt ไม่อยู่ในอนาคต, audit ล้มเหลวผ่าน HTTP ได้ 500 และไม่เหลือ partial state);
  `mysql.int` 6 + `shop-mysql` 3 skipped อย่างซื่อสัตย์ (ไม่มี `TEST_DATABASE_URL`)
- `npm run test:web` → 9 files / **46 passed**: เดิมครบ + ใหม่
  (`status` 7: เพิ่ม spillover ต่อเนื่องจากวันศุกร์ + ปิดแล้วไม่แสดงรอบ,
  `shop` 7: เพิ่ม payload expiresAt แยกจาก expectedReopenAt + แจ้งหมดอายุ,
  `tables` 6, `shell` 4)
- `npm run typecheck` (api+web) ผ่าน, `npm run build` ผ่าน (api tsc + web vite 44 modules)
- `npm audit --omit=dev` → 3 moderate เหมือนเดิม (`qs` ผ่าน express, `react-router` 6.x);
  ไม่ทำ forced major upgrade
- Docker ใช้ไม่ได้, ไม่มี `TEST_DATABASE_URL`, ไม่มีเบราว์เซอร์อัตโนมัติ (เหมือนรอบก่อน)
- ไฟล์ที่เปลี่ยนรอบนี้ (API): `shop/schedule.ts` (`WeekdayKey`/`WEEKDAY_KEYS`,
  `ServiceWindow`, `evaluateSchedule` คืน serviceWindow, `effectiveOverride`),
  `store.ts` (interface atomic `saveShopConfig`/`setShopOverride`/`clearShopOverride`/
  `createShopTable`/`updateShopTable` + `getShopSnapshot` + `ShopActor`;
  ลบ mutation แยกชิ้นเดิม; MySQL transaction บน connection เดียว begin/commit/rollback/release;
  memory snapshot/restore + `failAudit` seam; reads ใช้ mapper ร่วม),
  `routes/shop.ts` (ใหม่: ย้าย Ticket 02 routes จาก `app.ts`, ใช้ atomic store,
  `expiresAt` ต้องอนาคตเทียบ clock, `override` = effective + `expiredOverride`,
  DTO มี `serviceWindow`), `app.ts` (เหลือ Ticket 01 + mount router),
  tests `shop-schedule`/`shop-store` (ใหม่), `shop-status` (ปรับ expiry semantics + เพิ่ม 2 ข้อ),
  `shop-mysql.int` (เพิ่ม tx rollback + datetime round-trip)
- ไฟล์ที่เปลี่ยนรอบนี้ (Web): `lib/api.ts` (`WeekdayKey`/`WEEKDAY_KEYS`/`ServiceWindow`,
  `ShopStatus.serviceWindow`, `ShopConfig.expiredOverride`, ลบ `ShopAuditItem` ใช้ `AuditItem`),
  `lib/shop-week.ts` (ใหม่: labels/blankWeek/mergeWeek/fmtBangkok),
  `components/ScheduleDayField.tsx`/`OverridePanel.tsx` (ใหม่: ช่องหมดอายุแยกจากคาดว่าจะเปิด
  พร้อม label ไทย)/`ShopAuditList.tsx` (ใหม่), `pages/Shop.tsx` (เล็กลง ใช้ components),
  `pages/Status.tsx` (แสดงรอบที่เปิดอยู่ + ต่อเนื่องจากวันต้นทาง),
  tests `status` (+2), `shop` (+2)
- เอกสาร: `README.md` (กฎ atomic/expiresAt-serviceWindow/router/WeekdayKey), ไฟล์ ticket นี้
- ที่ยังไม่เสร็จ (เหมือนเดิม + ชัดขึ้น): MySQL integration จริง
  (รวม tx rollback + datetime round-trip ใหม่), responsive/keyboard บนเบราว์เซอร์จริง

### ผลตรวจรอบ final review fixes (2026-09-12 — P2 timezone + maintainability ปลอดภัย)

ติ๊ก acceptance คงเดิม (8 ข้อแรกมีหลักฐาน, 3 ข้อท้ายรอ MySQL/browser จริง) —
Status คง `claimed` ตามคำสั่ง

- `npm run test:api` → 5 files passed, 2 skipped / **53 passed, 9 skipped (62)** เท่าเดิม
  (Ticket 01 29+4 ครบ; `mysql.int` 6 + `shop-mysql` 3 skipped ซื่อสัตย์ ไม่มี `TEST_DATABASE_URL`)
- `npm run test:web` → 10 files / **56 passed** (เดิม 46 + ใหม่ 10):
  `bangkok-time.test.ts` 7 (pure: exact `2026-09-12T18:30` กรุงเทพ => `11:30Z`,
  ข้ามวัน, leap/impossible/malformed, ISO->wall, round-trip),
  `shop.test.tsx` 10 (เพิ่ม: payload exact `18:30` กรุงเทพ => `11:30Z` แยกจาก expected,
  `buildOverrideBody` unit (valid/invalid ไทย), label Asia/Bangkok)
- `TZ=Pacific/Kiritimati` รัน `bangkok-time` 7/7 ผ่าน; `TZ=America/New_York`
  รัน `bangkok-time`+`shop`+`status` 24/24 ผ่าน — ไม่พึ่ง timezone เครื่อง
  (หมายเหตุ: jsdom ล้างค่า datetime-local ที่เป็นไปไม่ได้ (เช่น 30 ก.พ.) เป็น "" ตั้งแต่ชั้น input
  จึงตรวจ branch invalid ผ่าน unit test ของ `buildOverrideBody` แทน DOM)
- `npm run typecheck` (api+web) ผ่าน, `npm run build` ผ่าน (api tsc + web vite 45 modules)
- `npm audit --omit=dev` → 3 moderate เดิม (`qs`, `react-router` 6.x) ไม่ forced major upgrade
- Docker/`TEST_DATABASE_URL`/เบราว์เซอร์อัตโนมัติไม่มีเหมือนเดิม
- ไฟล์ที่เปลี่ยนรอบนี้ (Web): `lib/bangkok-time.ts` (ใหม่: `parseBangkokWall`/
  `utcIsoToBangkokWall` ด้วย Date.UTC/getUTC* + ตรวจปฏิทินจริง),
  `components/OverridePanel.tsx` (เลิก `new Date(value)` กับ datetime-local;
  ใช้ `buildOverrideBody` pure + inline error ไทยก่อนเรียก API;
  label ระบุ "เวลา Asia/Bangkok" ทั้งสองช่อง),
  `tests/bangkok-time.test.ts` (ใหม่ 7), `tests/shop.test.tsx` (+3 net)
- ไฟล์ที่เปลี่ยนรอบนี้ (API): `shop/audit-events.ts` (ใหม่: factory กลาง 6 events
  Memory/MySQL ใช้ร่วมกัน), `store.ts` (`SaveShopConfigResult` แคบเป็น
  `ShopConfigSnapshot` ไม่แตะ tables; ทั้งสอง adapter ใช้ factories;
  `toMysqlDatetime` ใช้ UTC getters ให้ตรง pool `timezone: Z` ไม่พึ่ง TZ server)
- เอกสาร: `README.md` (สัญญา timezone wall-clock กรุงเทพ + UTC getters + factories),
  ไฟล์ ticket นี้
- ที่ยังไม่เสร็จ: MySQL integration จริง (รวม `toMysqlDatetime` UTC บน server TZ อื่น),
  responsive/keyboard บนเบราว์เซอร์จริง

### ผลตรวจรอบ targeted P2 API timezone (2026-09-12 — explicit timezone เท่านั้น)

เปลี่ยนเฉพาะ `parseIsoDatetime` ใน `apps/api/src/routes/shop.ts` + regression test —
ติ๊ก acceptance คงเดิม, Status คง `claimed` (ไม่มี MySQL/browser)

- สัญญาใหม่: `expectedReopenAt`/`expiresAt` รับเฉพาะ ISO 8601 มี timezone ชัดเจน
  (`Z`/`z` หรือ `±HH:MM` พร้อมตรวจรูป offset 00–23:00–59 และ parseability จริง);
  ค่าไม่มี timezone (เช่น `2026-09-12T18:30`) ได้ HTTP 400
  “วันเวลาต้องระบุ timezone ให้ชัดเจน (ลงท้ายด้วย Z หรือ ±HH:MM …)”;
  ทุกค่าที่รับถูก canonicalize เป็น UTC ISO ด้วย `toISOString()` ไม่พึ่ง TZ server
- payload web เดิม (`...T...:00.000Z` จาก `bangkok-time.ts`) ยังผ่านเหมือนเดิม
- `npm run test:api` → 5 files passed, 2 skipped / **54 passed, 9 skipped (63)**:
  `shop-status.test.ts` 12 (เพิ่ม 1: timezone-less ทั้งสองฟิลด์ + offset ผิด → 400,
  Z รับ/canonical, `+07:00` exact `18:30+07:00` => `11:30Z`, อดีตแบบ Z ยัง 400);
  Ticket 01 29+4 ครบ; int 6+3 skipped ซื่อสัตย์
- `TZ=America/New_York` รัน `shop-status` 12/12 ผ่าน — ไม่พึ่ง TZ เครื่อง
- `npm run test:web` → 10 files / **56 passed** (ไม่แตะ web รอบนี้ แต่รันยืนยัน)
- `npm run typecheck` (api+web) ผ่าน, `npm run build` ผ่าน (vite 45 modules)
- ไฟล์ที่เปลี่ยนรอบนี้: `apps/api/src/routes/shop.ts` (เฉพาะ `parseIsoDatetime` +
  `MISSING_TIMEZONE_ERROR`), `apps/api/tests/shop-status.test.ts` (+1),
  `README.md` (บรรทัดสัญญา explicit timezone), ไฟล์ ticket นี้
