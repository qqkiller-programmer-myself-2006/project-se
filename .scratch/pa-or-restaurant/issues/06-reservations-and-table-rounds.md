# 06: การจองโต๊ะและรอบการใช้โต๊ะ

**What to build:** ระบบจองโต๊ะล่วงหน้า การตรวจเวลาทับซ้อน การเช็กอิน และรอบการใช้โต๊ะสำหรับเชื่อมกับคำสั่งซื้อ โดยยังไม่รวมการแจ้งเตือน LINE และ payment จริง

**Blocked by:** 02 — สถานะร้านและโต๊ะ (resolved), 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D02, User Stories 7, 8, 10 และ FR-RES-001–003 ใน `docs/REQUIREMENTS.md` รองรับการจองล่วงหน้าไม่เกิน 3 วัน ก่อนเวลานัดอย่างน้อย 60 นาที เลือกโต๊ะเองหรือให้ระบบแนะนำโต๊ะว่างขนาดเล็กที่สุดที่รองรับจำนวนคน

ครอบคลุม reservation lifecycle, cancellation policy, staff check-in, table round, จำนวนผู้ใช้บริการจริง และการปิดรอบโดยพนักงาน ใช้เวลาที่ควบคุมได้ใน tests และทำ transaction seams ใน Memory/MySQL ตาม pattern เดิม

ไม่รวม LINE reminder, QR provider จริง, payment/deposit, external notification, Docker/MySQL runtime จริง และการจัดคิวรอเต็มรูปแบบถ้าไม่จำเป็นต่อรอบโต๊ะ ให้บันทึกใน tracking

## Acceptance criteria

- [x] ลูกค้าสร้าง ดู และยกเลิกการจองของตนเองได้ตามกฎ 3 วัน/60 นาที และยกเลิกก่อนนัดอย่างน้อย 60 นาที
- [x] เลือกโต๊ะเองหรือรับคำแนะนำโต๊ะว่างที่เล็กที่สุดซึ่งรองรับจำนวนคนได้
- [x] การจองเวลาทับซ้อนชนกันแบบ concurrent สำเร็จได้เพียงรายการเดียว และผลลัพธ์ไม่ทำให้โต๊ะติดค้าง
- [x] Admin/Owner ค้นหา ดู เปลี่ยนสถานะ และยกเลิกการจองได้ พร้อม audit actor/reason/before/after
- [x] พนักงานที่มีสิทธิ์เช็กอินด้วยรหัสจองหรือเบอร์โทร ตรวจจำนวนคนจริง และเปิดรอบการใช้โต๊ะได้เพียงครั้งเดียว
- [x] รอบโต๊ะเชื่อมคำสั่งซื้อที่โต๊ะได้ และปิดรอบได้โดยพนักงานเมื่อยอดครบ; รอบปิดรับคำสั่งซื้อใหม่
- [x] จำนวนผู้ใช้บริการและสถานะโต๊ะแสดงต่อ public ตาม snapshot เดิมโดยไม่เปิดเผยข้อมูลลูกค้าเกินจำเป็น
- [x] Kitchen/Drink/Guest และลูกค้าที่ไม่ใช่เจ้าของถูกปฏิเสธฝั่ง server
- [x] UI ภาษาไทยมี loading/error/empty/success/focus states และ responsive layout
- [x] API/Web tests, typecheck/build ผ่าน; external notification, Docker/MySQL จริง และ browser QA บันทึกไว้ทำภายหลัง

## Comments

### 2026-09-14 — เริ่ม Ticket 06

- เริ่มหลังคำสั่งซื้อพื้นฐานเพื่อให้รอบโต๊ะผูกกับคำสั่งซื้อที่มีอยู่
- ข้าม LINE reminder, payment/deposit, Docker/MySQL จริง และ external QA ตามแผน

### 2026-09-14 — ผลตรวจ Ticket 06 (implement เสร็จ, Status → resolved)

ขอบเขต: แตะเฉพาะไฟล์ Ticket 06 + จุดต่อขยายที่ออกแบบไว้ (Store interface, types,
App mount, orders linkage, lib/api, README ส่วน Ticket 06)
ไม่แตะ Prisma/experiments/package dependencies/preset งานอื่น;
ไม่เปลี่ยน contracts Tickets 01–05 (เทสต์เดิมทั้งหมดยังผ่าน — ดูผลข้างล่าง)

- API: `npx vitest run --maxWorkers=1 --no-file-parallelism` (apps/api):
  12 files passed / 6 skipped → **159 passed, 23 skipped (182)**
  (ใหม่ `reservations.test.ts` 11 ข้อผ่าน; ใหม่ `reservations-mysql.int.test.ts`
  2 skipped อย่างซื่อสัตย์ — ไม่มี `TEST_DATABASE_URL`;
  Tickets 01–05 เดิมผ่านครบ ไม่มี regression)
- Web tests (รันแยก 3 batch ด้วย `NODE_OPTIONS=--max-old-space-size=3072`, กัน OOM ตามแนว Ticket 05):
  batch1 36 ผ่าน (รวมของใหม่ reservations 7 + checkin 7 + admin-reservations 6 +
  customer-orders 5 + admin-orders 4 + cart-page 2 + cart 5);
  batch2 49 ผ่าน (status/shop/tables/shell/app/staff/login/audit/api-client);
  batch3 41 ผ่าน (admin-customers/customer-auth/profile/shell/menu-admin/menu-public/phone/bangkok-time)
  → **รวม 126 passed / 0 failed** (เดิม 106 + ใหม่ 20)
- `npm run typecheck` (api+web): ผ่าน
- `npm run build` (api tsc + web vite 61 modules): ผ่าน
- กฎที่บันทึกใน `apps/api/src/reservations/validation.ts`:
  จองล่วงหน้า 60 นาที–3 วัน (ขอบพอดีผ่าน) / ยกเลิกก่อนนัด ≥60 นาที /
  หน้าต่างถือครองโต๊ะ 120 นาที (`RESERVATION_SLOT_MINUTES`, pure ใช้ร่วม Memory/MySQL) /
  จำนวนจริง 1–50 / หมายเหตุ ≤200 / เหตุผล ≤500 /
  pending→confirmed/cancelled, confirmed→cancelled/no_show (ลูกค้า cancel ได้เฉพาะ pending/confirmed;
  seated→completed ผ่านปิดรอบเท่านั้น)
- รหัสจอง `RSV-YYYYMMDD-XXXX` (unique + retry กันชน);
  idempotency (optional UUID): key เดิม + payload เดิม → 200 คืนของเดิม (ไม่เขียน audit ซ้ำ),
  key เดิม + payload ต่างกัน → 409
- กันชน concurrent: Memory serialize ผ่านคิวใน store; MySQL ใช้ named lock
  `paor_reservation_write` + transaction เดียว (พิสูจน์ด้วยเทสต์ Promise.all ชนกัน)
- QR เป็น fake/local seam เท่านั้น (`PAOR-RSV:<CODE>`, encode/decode round-trip ในเทสต์)
- DB: `db/migrations/007_reservations.sql` (reservations + table_rounds + ALTER orders
  เพิ่ม table_id/round_id, IF NOT EXISTS/rerunnable, เข้า `MIGRATION_FILES` แล้ว —
  runner tolerate 1060 สำหรับ ALTER รันซ้ำ) + MySQL adapter ใช้ transaction เดียวกับ audit
  เสมอ (rollback พิสูจน์ด้วย test ทั้ง Memory failAudit และ MySQL username ยาวเกินคอลัมน์)
- รอบโต๊ะ: เช็กอิน (รหัส/เบอร์/QR) เปิดรอบได้ครั้งเดียวต่อการจอง + หนึ่งรอบต่อหนึ่งโต๊ะ;
  โต๊ะไม่พอ → 409 รอจัดโต๊ะโดยไม่เปลี่ยนสถานะ; dine_in ผูก roundId ได้เฉพาะรอบเปิด
  (โต๊ะต้องตรงรอบ); ปิดรอบได้เมื่อไม่มีออเดอร์ pending_payment ผูกอยู่
  (ปิดแล้วการจองต้นทาง → completed); รอบปิดรับคำสั่งซื้อใหม่ไม่ได้
- public privacy: `/api/shop/status` (ผ่าน OccupancyProvider นับจากรอบเปิดจริง) +
  `GET /api/shop/table-rounds` (sanitize เหลือ tableId/tableName/partySize/openedAt) —
  เทสต์ assert ไม่มีชื่อ/เบอร์/รหัสจอง/customerId/qr ใน response
- ที่บันทึกเป็นงานภายหลัง (ไม่ทำให้ ticket ล้ม ตาม acceptance ข้อสุดท้าย):
  MySQL integration จริง (TEST_DATABASE_URL แยก), LINE reminder/notification,
  QR provider จริง, payment/deposit, full waitlist, Docker/MySQL runtime,
  browser responsive/keyboard QA จริง
- ที่ไม่รวมตาม scope (ไม่ implement): LINE, payment/deposit, external notification,
  Docker/MySQL runtime, full waitlist, Prisma changes, experiments, package dependencies

### 2026-09-25 — บั๊กสแกนหลัง resolved: race ที่ createOrder (MySQL) + timezone ของช่องเวลาจอง

- พบ (codex, ตรวจ read-only, verify โดย Claude): `createMysqlStore().createOrder` อ่านแถว
  `table_rounds` ที่เปิดอยู่โดยไม่ล็อก (`SELECT ... status='open'` ไม่มี `FOR UPDATE`) ก่อนผูก
  คำสั่งซื้อกับรอบ — ถ้ามี request `closeTableRound` (ซึ่งล็อกด้วย `FOR UPDATE` ใน
  `withReservationTx`) ปิดรอบคั่นกลางระหว่างอ่านกับ INSERT คำสั่งซื้อ จะได้คำสั่งซื้อ
  `pending_payment` ผูกกับรอบที่ปิดไปแล้ว (ฝั่ง memory store ไม่มีปัญหานี้เพราะ synchronous)
- แก้: เพิ่ม `FOR UPDATE` ให้ query อ่านรอบทั้งสองเส้นทางใน `createOrder`
  (ระบุ `roundId` ตรง และค้นหารอบเปิดจาก `tableId`) ใน `apps/api/src/store.ts`
  ยังไม่ได้รันยืนยันกับ MySQL จริง (เครื่อง dev ไม่มี MySQL/Docker) — ควรรันชุด
  `*-mysql.int.test.ts` กับ `TEST_DATABASE_URL` ก่อน deploy
- พบ (bug scan, Claude) เพิ่มเติม (ไม่เกี่ยวกับ MySQL): ช่องเวลาจองโต๊ะฝั่งเว็บ
  (`apps/web/src/lib/reservationSlots.ts`) คำนวณเป็นเวลาท้องถิ่นของเครื่องลูกค้า
  ขณะที่ API ตรวจเวลาเปิดร้านเป็นเวลากรุงเทพเสมอ — เครื่องที่ตั้งเขตเวลาอื่นจะเห็น/เลือก
  ช่องเวลาผิดจากที่ API ยอมรับจริง แก้ให้คิดเป็นเวลากรุงเทพเสมอ (ไม่ขึ้นกับ timezone
  ของเครื่อง) และเพิ่ม test ยืนยันผลเดียวกันไม่ว่า `TZ` ของเครื่องรัน test จะเป็นอะไร
