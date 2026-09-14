# 04: เมนูอาหารและเครื่องดื่ม

**What to build:** แคตตาล็อกเมนูสาธารณะสำหรับลูกค้า และหน้าจัดการเมนูสำหรับ Admin/Owner โดยยังไม่รวมสูตรวัตถุดิบ การตัดสต๊อก หรือการสร้างคำสั่งซื้อ

**Blocked by:** None

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D03, User Story 1, 35 และ FR-MENU-001–002 ใน `docs/REQUIREMENTS.md` บัญชีลูกค้าไม่จำเป็นสำหรับการดูเมนู ลูกค้าต้องเห็นเฉพาะเมนูที่เปิดขาย ส่วน Admin/Owner จัดการข้อมูลเมนูได้ตามสิทธิ์

Ticket นี้ครอบคลุมหมวดหมู่ ชื่อ รายละเอียด รูปภาพ URL ราคา ประเภทอาหาร/เครื่องดื่ม สถานะเปิดขาย และลำดับการแสดงผล รวม validation, audit และ UI ภาษาไทย

ยังไม่รวมการตรวจสต๊อกจากสูตร การคำนวณพร้อมขายจากวัตถุดิบ ตัวเลือกเพิ่มราคา ตะกร้า คำสั่งซื้อ การชำระเงิน หรือการอัปโหลดไฟล์รูปจริง ให้เตรียม field/interface ที่ต่อยอดได้โดยไม่อ้างว่าสต๊อกพร้อมขายแล้ว

## Acceptance criteria

- [x] Public API/UI แสดงเมนูแยกหมวดหมู่ พร้อมชื่อ รายละเอียด รูปภาพ URL ราคา ประเภท และสถานะที่แสดงต่อลูกค้า
- [x] เมนูที่ปิดขายหรือถูก archive ไม่สามารถแสดงเป็นเมนูพร้อมขาย และไม่สามารถถูกเลือกเข้าสู่ flow ถัดไป
- [x] Admin/Owner เพิ่ม แก้ไข เปิดขาย ปิดขาย และ archive เมนูได้; บทบาทอื่นถูกปฏิเสธฝั่ง server
- [x] Validation ตรวจชื่อ ราคาไม่ติดลบ หมวดหมู่ ประเภท และ URL รูปภาพตามกฎที่บันทึกไว้
- [x] การเปลี่ยนแปลงเมนูและสถานะมี audit ที่ไม่เปิดเผยข้อมูลลับ และเก็บค่าก่อน/หลังเมื่อแก้ไข
- [x] มี uniqueness/ดัชนีที่เหมาะสมสำหรับหมวดหมู่และลำดับการแสดงผล โดยไม่บังคับชื่อซ้ำข้ามหมวดโดยไม่จำเป็น
- [x] UI ภาษาไทยมี loading/error/empty/success/focus states และ responsive layout ตาม design system เดิม
- [x] API/Web tests, typecheck และ build ผ่าน; integration กับ MySQL จริงหรือ image storage ภายนอกให้บันทึกเป็นงานภายหลัง ไม่ทำให้ ticket นี้ล้ม

## Comments

### 2026-09-14 — เริ่ม Ticket 04

- เลือกเมนูก่อนคำสั่งซื้อ เพราะคำสั่งซื้อและตะกร้าต้องอ้างเมนูและราคาที่ตรวจสอบได้
- ข้าม external services ตามนโยบายงาน: Docker/MySQL จริง, image storage และ provider login
- งานที่ข้ามจะเก็บไว้ใน tracking report และต้องตรวจซ้ำก่อนเปิดใช้งาน production

### 2026-09-14 — ผลตรวจ Ticket 04 (implement เสร็จ, Status → resolved)

ขอบเขต: แตะเฉพาะไฟล์ Ticket 04 + จุดต่อขยายที่ออกแบบไว้ (Store interface, types, App mount, lib/api)
ไม่แตะ Prisma/experiments/package dependencies ของงานอื่น; ไม่เปลี่ยน contracts Tickets 01–03
(เทสต์เดิมทั้งหมดยังผ่าน — ดูผลข้างล่าง)

- `npx vitest run --maxWorkers=1 --no-file-parallelism` (apps/api):
  10 files passed / 4 skipped → **138 passed, 19 skipped (157)**
  (ใหม่ `menu.test.ts` 10 ข้อผ่าน; `menu-mysql.int.test.ts` 2 skipped อย่างซื่อสัตย์ —
  ไม่มี `TEST_DATABASE_URL`; Ticket 01/02/03 เดิมผ่านครบ ไม่มี regression)
- Web tests (รันแยก batch ด้วย `NODE_OPTIONS=--max-old-space-size=3072`, กัน OOM ตามแนว Ticket 03):
  batch1 login/staff/audit/status 22 ผ่าน; batch2 shop/tables/shell/app/api-client/bangkok/phone 36 ผ่าน;
  batch3 customer-auth/profile/shell/admin-customers 21 ผ่าน;
  ใหม่ menu-public 5 + menu-admin 6 → **รวม 90 passed / 0 failed**
- `npm run typecheck` (api+web): ผ่าน
- `npm run build` (api tsc + web vite 52 modules): ผ่าน
- กฎ validation ที่บันทึกใน `apps/api/src/menu/validation.ts`:
  หมวด 1–64 / ชื่อ 1–120 (trim) / รายละเอียด ≤500 (ว่าง→null) /
  imageUrl ว่าง→null ถ้าระบุต้อง absolute http/https ยาว ≤2048 ไม่มีช่องว่าง /
  ราคา 0–1,000,000 ทศนิยม ≤2 ตำแหน่ง / kind food|drink / status available|unavailable /
  sortOrder จำนวนเต็ม 0–10000 (default 0); uniqueness ระดับ (category, name) —
  ชื่อซ้ำข้ามหมวดได้ ซ้ำในหมวดเดียวกัน 409
- Audit: `menu_created` / `menu_updated` (มีก่อน→หลัง) / `menu_status_changed`
  (เฉพาะ PATCH status อย่างเดียว) / `menu_archived` / `menu_restored`;
  ไม่มี password/token/secret (เมนูไม่มีข้อมูลลับ); ดูได้เฉพาะ Owner/Admin (`GET /api/audit/menu`)
- DB: `db/migrations/005_menu_catalog.sql` (UNIQUE (category,name), INDEX (category,sort_order),
  INDEX kind, INDEX (status,is_archived), CHECK price/kind/status/sort) + เข้า `MIGRATION_FILES`
  รันซ้ำได้; MySQL adapter ใช้ transaction เดียวกับ audit เสมอ (rollback พิสูจน์ด้วย test)
- ที่บันทึกเป็นงานภายหลัง (ไม่ทำให้ ticket ล้ม ตาม acceptance ข้อสุดท้าย):
  MySQL integration จริง (TEST_DATABASE_URL แยก), image storage/upload จริง,
  browser responsive/keyboard QA จริง
- ที่ไม่รวมตาม scope (ไม่ implement): orders, cart, payment, stock/สูตร,
  image upload, Docker/MySQL runtime, external providers
