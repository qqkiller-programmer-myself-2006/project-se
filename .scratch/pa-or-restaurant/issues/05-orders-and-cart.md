# 05: ตะกร้าและคำสั่งซื้อพื้นฐาน

**What to build:** ตะกร้าของลูกค้าและการสร้างคำสั่งซื้อพื้นฐานจากเมนูที่เปิดขาย รองรับรับประทานที่ร้าน/กลับบ้าน/ล่วงหน้าในขอบเขตข้อมูลคำสั่งซื้อ โดยยังไม่รวมการชำระเงินจริง สต๊อก และคิวปฏิบัติงาน

**Blocked by:** 04 — เมนูอาหารและเครื่องดื่ม (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D03, User Stories 13, 16, 19 และ FR-ORD-001, FR-ORD-003, FR-ORD-004 ใน `docs/REQUIREMENTS.md` ตะกร้าเป็นข้อมูลชั่วคราวที่ลูกค้าแก้ไขได้ คำสั่งซื้อเป็น snapshot ที่แก้ราคาเมนูภายหลังไม่ได้

รองรับ customer ที่ login แล้วและ Guest ตามข้อมูลขั้นต่ำที่ยืนยันในคำสั่งซื้อ รองรับช่องทางเว็บก่อน โดยเก็บประเภทรับบริการ (`dine_in`, `takeaway`, `preorder`) และเวลานัดที่ผ่าน validation พื้นฐาน

ไม่รวมการจองโต๊ะ/รอบโต๊ะ การชำระเงินจริง/SlipOK/PromptPay การตรวจสต๊อกและสูตร การสร้างงานคิวครัว/เครื่องดื่ม การแจ้งเตือน LINE หรือ image/external storage ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] ลูกค้าเห็นเมนูที่เปิดขายและเพิ่ม/ลด/ลบรายการในตะกร้าได้ พร้อมจำนวนมากกว่าศูนย์และหมายเหตุจำกัดความยาว
- [x] ตะกร้าตรวจราคา/สถานะเมนูอีกครั้งก่อนยืนยัน และไม่ยอมรับเมนูปิดขายหรือจำนวนไม่ถูกต้อง
- [x] สร้างคำสั่งซื้อได้สำหรับรับประทานที่ร้าน กลับบ้าน และล่วงหน้า โดยเก็บช่องทางสร้าง ประเภทรับบริการ รายการ จำนวน ราคาที่ยืนยัน และยอดรวม
- [x] คำสั่งซื้อเก็บ snapshot ชื่อ/ราคา/ตัวเลือกของเมนู ทำให้ราคาเมนูภายหลังไม่เปลี่ยนคำสั่งซื้อเดิม
- [x] ลูกค้าตรวจสอบสถานะคำสั่งซื้อและสถานะรายการย่อยได้ โดยไม่เห็นคำสั่งซื้อของผู้อื่น
- [x] Admin/Owner ค้นหา ดู และเปลี่ยนสถานะคำสั่งซื้อได้ตามสิทธิ์ พร้อม audit เหตุผลและค่าก่อน/หลังเมื่อแก้ไข
- [x] Kitchen/Drink/Guest และลูกค้าที่ไม่ใช่เจ้าของคำสั่งซื้อถูกปฏิเสธฝั่ง server
- [x] API/UI ภาษาไทยมี loading/error/empty/success/focus states และ responsive layout ตาม design system เดิม
- [x] มี uniqueness/idempotency เบื้องต้นป้องกันการยืนยันคำสั่งซื้อซ้ำจาก request เดิม
- [x] API/Web tests, typecheck และ build ผ่าน; payment, stock, reservation, queue, LINE และ MySQL จริงที่ต้องใช้ service ภายนอกให้บันทึกเป็นงานภายหลัง

## Comments

### 2026-09-14 — เริ่ม Ticket 05

- เริ่มหลัง Ticket 04 เพราะต้องมีเมนูและราคาปัจจุบันเป็นแหล่งสร้าง snapshot
- ทำเฉพาะคำสั่งซื้อพื้นฐานและสถานะ pending/payment_pending; ยังไม่สร้างงานคิวจนกว่าจะมี Ticket การชำระเงิน
- ข้าม external services ตามนโยบายงาน และบันทึกไว้ใน tracking report

### 2026-09-14 — ผลตรวจ Ticket 05 (implement เสร็จ, Status → resolved)

ขอบเขต: แตะเฉพาะไฟล์ Ticket 05 + จุดต่อขยายที่ออกแบบไว้ (Store interface, types, App mount, lib/api)
ไม่แตะ Prisma/experiments/package dependencies ของงานอื่น; ไม่เปลี่ยน contracts Tickets 01–04
(เทสต์เดิมทั้งหมดยังผ่าน — ดูผลข้างล่าง)

- `npx vitest run --maxWorkers=1 --no-file-parallelism` (apps/api):
  10 files passed / 5 skipped → **148 passed, 21 skipped (169)**
  (ใหม่ `orders.test.ts` 10 ข้อผ่าน; ใหม่ `orders-mysql.int.test.ts` 2 skipped อย่างซื่อสัตย์ —
  ไม่มี `TEST_DATABASE_URL`; Ticket 01–04 เดิมผ่านครบ ไม่มี regression)
- Web tests (รันแยก 3 batch ด้วย `NODE_OPTIONS=--max-old-space-size=3072`, กัน OOM ตามแนว Ticket 03/04):
  batch1 22 ผ่าน; batch2 36 ผ่าน; batch3 48 ผ่าน (รวมของใหม่ cart 5 +
  customer-orders 5 + admin-orders 4 + cart-page 2) → **รวม 106 passed / 0 failed**
- `npm run typecheck` (api+web): ผ่าน
- `npm run build` (api tsc + web vite 57 modules): ผ่าน
- กฎ validation ที่บันทึกใน `apps/api/src/orders/validation.ts`:
  serviceType dine_in|takeaway|preorder / preorder ต้องมีเวลานัดล่วงหน้า 30 นาที–7 วัน /
  จำนวนเต็ม 1–20 ต่อรายการ / 1 คำสั่งซื้อ 1–20 รายการ / หมายเหตุ ≤200 (ว่าง→null) /
  Guest ชื่อ 1–120 + เบอร์ normalize กฎ Ticket 03 / idempotencyKey UUID /
  เปลี่ยนสถานะได้เฉพาะ pending_payment → completed|cancelled พร้อมเหตุผล 1–500
- เลขคำสั่งซื้อ `ORD-YYYYMMDD-XXXX` (unique + retry กันชน);
  idempotency: key เดิม + payload เดิม → 200 คืนของเดิม (ไม่เขียน audit ซ้ำ),
  key เดิม + payload ต่างกัน → 409
- สถานะเริ่มต้น `pending_payment`; ลูกค้าเปลี่ยนสถานะเองไม่ได้ (มีแต่ดู);
  หลังร้านเปลี่ยนได้เฉพาะ Owner/Admin พร้อม audit `order_created` / `order_status_changed`
  (มีก่อน→หลัง + เหตุผล, เบอร์ใน audit ถูกปกปิด)
- DB: `db/migrations/006_orders.sql` (UNIQUE order_number/idempotency_key,
  INDEX customer/status/guest_phone/created, CHECK service/status/channel/total/qty/price,
  FK order_items → orders) + เข้า `MIGRATION_FILES` รันซ้ำได้;
  MySQL adapter ใช้ transaction เดียวกับ audit เสมอ (rollback พิสูจน์ด้วย test)
- ที่บันทึกเป็นงานภายหลัง (ไม่ทำให้ ticket ล้ม ตาม acceptance ข้อสุดท้าย):
  MySQL integration จริง (TEST_DATABASE_URL แยก), การชำระเงินจริง/SlipOK/PromptPay,
  สต๊อก/สูตร, reservation/table-round, kitchen/drink queue, LINE notification,
  image/external storage, browser responsive/keyboard QA จริง
- ที่ไม่รวมตาม scope (ไม่ implement): payment, stock/สูตร, reservation/รอบโต๊ะ,
  งานคิวครัว/เครื่องดื่ม, LINE, Docker/MySQL runtime, Prisma/experiments
