# 07: ตัวเลือกเมนู สูตร และสต๊อก

**What to build:** ลูกค้าเลือกตัวเลือกเมนู (ขนาด/เพิ่มราคา) พร้อม snapshot ราคาตอนยืนยัน และความต้องการเฉพาะที่ไม่เปลี่ยนราคา; Admin/Owner จัดการกลุ่มตัวเลือก ตัวเลือก วัตถุดิบ สูตรแบบ versioned และธุรกรรมสต๊อก; จองสต๊อกแบบ atomic ตอนยืนยันคำสั่งซื้อก่อนรับชำระ และตัดจริงเมื่อเริ่มทำ

**Blocked by:** 04 — เมนูอาหารและเครื่องดื่ม (resolved), 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D03 (เมนู/ตัวเลือก/ราคาที่ยืนยัน), D06 (สต๊อก/สูตร/ต้นทุนประมาณการ), User Stories 17, 18, 35, 36, 37 และ AT09/AT12 ใน `spec.md` ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- กลุ่มตัวเลือกผูกเมนู (ชื่อซ้ำในเมนูเดียวกันไม่ได้) + ตัวเลือกผูกกลุ่ม (ชื่อซ้ำในกลุ่มเดียวกันไม่ได้, เลือกได้กลุ่มละ 1 ตัวเลือกต่อรายการ, เปิด/ปิดขายรายตัวเลือกได้)
- ตะกร้า/คำสั่งซื้อแนบตัวเลือก + ความต้องการเฉพาะ (ข้อความล้วน ไม่เปลี่ยนราคา ยาวไม่เกิน 200) พร้อม snapshot ชื่อกลุ่ม/ชื่อตัวเลือก/ส่วนต่างราคา และต้นทุนประมาณการต่อรายการ
- วัตถุดิบหนึ่งรายการมีหนึ่งหน่วย (immutable หลังสร้าง) พร้อมขาย = คงเหลือจริง − ยอดจอง; ธุรกรรม manual (receive/return/waste/expire/personal_use/adjust) พร้อมเหตุผลทุกครั้ง; ledger append-only
- สูตรแบบ versioned (สร้างเวอร์ชันใหม่อย่างเดียว) สำหรับเมนูหรือตัวเลือก พร้อมต้นทุนประมาณการต่อหน่วยจากทุนล่าสุด
- จองสต๊อกแบบ atomic ตอนยืนยัน (ไม่พอ → 409 + rollback ทั้งคำสั่งซื้อ ไม่รับเงินต่อ); ยกเลิกก่อนเริ่มทำคืนยอดจอง; ตัดจริงเมื่อเริ่มทำ (เรียกซ้ำเป็น no-op); menu/option ที่ไม่มีสูตรสั่งได้โดยไม่ตรวจสต๊อก
- UI ภาษาไทย: ลูกค้าเห็นกลุ่มตัวเลือก + ป้ายวัตถุดิบหมดในหน้าเมนู, เลือกตัวเลือกกลุ่มละ 1 ตัวในตะกร้า; หลังร้านจัดการตัวเลือกในหน้าจัดการเมนู และมีหน้าวัตถุดิบ/สต๊อก/สูตรเฉพาะ

ไม่รวมการชำระเงินจริง/SlipOK/PromptPay งานคิวครัว/เครื่องดื่ม LINE Drawer/MySQL runtime จริง image/external storage และ browser E2E จริง ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] ลูกค้าเห็นกลุ่มตัวเลือกที่เปิดขายในเมนูสาธารณะ พร้อมป้ายวัตถุดิบหมดเมื่อสูตรล่าสุดมีสต๊อกพร้อมขายไม่พอ 1 หน่วย
- [x] ตะกร้า/คำสั่งซื้อเลือกตัวเลือกได้ (กลุ่มละไม่เกิน 1 ตัว) ตรวจว่าเป็นของเมนูนั้นและเปิดขาย; ราคาตรึงเป็น snapshot เปลี่ยนราคาภายหลังไม่กระทบคำสั่งซื้อเดิม
- [x] ตัวเลือกผิดกฎ (ข้ามเมนู/ปิดขาย/กลุ่มละเกิน 1 ตัว/รหัสไม่มีอยู่) ถูกปฏิเสธ 409; ความต้องการเฉพาะยาวเกินได้ 400
- [x] Admin/Owner CRUD กลุ่มตัวเลือก/ตัวเลือกได้ (ชื่อซ้ำได้ 409, archive เมนูแล้วจัดการต่อไม่ได้); kitchen/drink/Guest ถูกปฏิเสธฝั่ง server
- [x] Admin/Owner CRUD วัตถุดิบได้ (ชื่อ unique, หน่วยเปลี่ยนไม่ได้); ธุรกรรมสต๊อกมีก่อน/หลัง + ledger + audit; กันติดลบ 409; reserve/release/consume ผ่านช่อง manual ไม่ได้
- [x] สูตร versioned (v1/v2/...) พร้อมต้นทุนประมาณการ; วัตถุดิบงดใช้/ไม่มีอยู่/เป้าหมายไม่มีอยู่ถูกปฏิเสธ
- [x] แข่งวัตถุดิบชิ้นสุดท้ายสำเร็จรายเดียว (serialize); ยกเลิกก่อนเริ่มทำคืนยอดจอง; ตัดจริงเมื่อเริ่มทำเรียกซ้ำเป็น no-op; ไม่มีสูตรตัดไม่ได้; kitchen ตัดได้ ลูกค้า/Guest ตัดไม่ได้
- [x] audit ครบ (menu_option_*/ingredient_*/recipe_created/stock_updated/order_stock_*) ไม่มีข้อมูลลับ ดูได้เฉพาะ Owner/Admin
- [x] UI ภาษาไทยมี loading/error/empty/success/focus states, 44px targets, responsive ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL)
- [x] API/Web tests, typecheck และ build ผ่าน; MySQL runtime จริง/external providers/browser E2E บันทึกเป็นงานภายหลัง ไม่ทำให้ ticket นี้ล้ม

## Comments

### 2026-09-14 — เริ่ม Ticket 07 (สานงานค้างใน working tree)

- สานต่อ implementation ที่ค้างอยู่ (types/store/routes/menu+orders/inventory validation+router/migration 008/MenuAdmin options/Cart/MenuPublic) โดยไม่แตะงานอื่นที่ค้างอยู่ก่อนแล้ว (apps/api/package.json, package-lock.json, apps/api/.gitignore, generated/, prisma.config.ts, prisma/, src/db/, experiments/)
- งานที่เติมจนครบ: API tests ใหม่ 13 ข้อ + MySQL int 2 ข้อ (skip อย่างซื่อสัตย์เมื่อไม่มี TEST_DATABASE_URL), หน้าวัตถุดิบ/สต๊อก/สูตร (`Inventory.tsx` + route/nav) + web tests ใหม่ 8 ข้อ, ซ่อม typecheck ที่ cart shape ใหม่ทำพัง และซ่อม menu-admin tests ที่ selector ตัวเลือกเมนูใหม่ทำให้ query กำกวม

### 2026-09-14 — ผลตรวจ Ticket 07 (implement เสร็จ, Status → resolved)

ขอบเขต: แตะเฉพาะไฟล์ Ticket 07 + จุดต่อขยายที่ออกแบบไว้ (Store interface, types, App mount, lib/api, cart lib)
ไม่แตะ Prisma/experiments/package dependencies/preset งานอื่น; ไม่เปลี่ยน contracts Tickets 01–06
(เทสต์เดิมทั้งหมดยังผ่าน — ดูผลข้างล่าง)

- `npx vitest run --maxWorkers=1 --no-file-parallelism` (apps/api):
  13 files passed / 7 skipped → **172 passed, 25 skipped (197)**
  (ใหม่ `inventory.test.ts` 13 ข้อผ่าน; ใหม่ `inventory-mysql.int.test.ts` 2 skipped อย่างซื่อสัตย์ —
  ไม่มี `TEST_DATABASE_URL`; Tickets 01–06 เดิมผ่านครบ ไม่มี regression)
- Web tests (รัน 4 batch ด้วย `NODE_OPTIONS=--max-old-space-size=3072`, กัน OOM ตามแนว Ticket 03–06):
  batch1 menu/cart/orders 27 ผ่าน; batch2 shop/shell/app 49 ผ่าน; batch3 customers/reservations 50 ผ่าน;
  ใหม่ inventory 5 + menu-options 3 → **รวม 134 passed / 0 failed** (เดิม 126 + ใหม่ 8)
- `npm run typecheck` (api+web): ผ่าน
- `npm run build` (api tsc + web vite 62 modules): ผ่าน
- กฎ validation ที่บันทึกใน `apps/api/src/inventory/validation.ts` (+ `orders/validation.ts` ต่อยอด):
  กลุ่มชื่อ 1–64 / ตัวเลือกชื่อ 1–120 / ส่วนต่างราคา ±1,000,000 ทศนิยม ≤2 /
  กลุ่มละ 1 ตัวเลือกต่อรายการ (ซ้ำกลุ่ม → 409) / ความต้องการเฉพาะ ≤200 (ว่าง→null ไม่เปลี่ยนราคา) /
  วัตถุดิบชื่อ 1–120 หน่วย 1–32 (immutable) / ปริมาณ ≥0 ทศนิยม ≤3 / ทุน 0–1,000,000 ทศนิยม ≤2 /
  สูตร 1–50 บรรทัด ไม่ซ้ำวัตถุดิบ ปริมาณ >0 ทศนิยม ≤3 / ธุรกรรม manual ปริมาณ >0 เหตุผล 1–500
- เลขคำสั่งซื้อ/รหัสจอง/idempotency คงเดิมจาก Tickets 05–06 (ตัวเลือก + ความต้องการเฉพาะรวมใน hash กัน key ชน)
- พร้อมขาย = onHand − reserved (ปัด 3 ตำแหน่ง); จองตอนยืนยันก่อนรับชำระ ผู้ชนะได้สิทธิ์ก่อน (serialize ผ่านคิวใน Memory, named lock + transaction ใน MySQL)
- สูตร versioned (UNIQUE target+version); คำสั่งซื้อตรึงยอดจองใน order_stock_usage (ไม่เปลี่ยนตามสูตรภายหลัง); ledger append-only
- Audit: `menu_option_group_created/updated`, `menu_option_created/updated/status_changed`,
  `ingredient_created/updated/status_changed`, `recipe_created`, `stock_updated`,
  `order_stock_reserved/released/consumed` (มีก่อน→หลัง + เหตุผล; เบอร์ลูกค้าถูกปกปิดตามเดิม)
- DB: `db/migrations/008_menu_options_recipes_inventory.sql` (UNIQUE (menu,name)/(group,name)/ingredient name/target+version, INDEX/CHECK, ALTER orders/order_items แบบ tolerate 1060) + เข้า `MIGRATION_FILES` รันซ้ำได้; MySQL adapter ใช้ transaction เดียวกับ audit เสมอ (rollback พิสูจน์ด้วย test ทั้ง Memory failAudit เดิมและ MySQL username ยาวเกินคอลัมน์)
- UI: อ่าน `.agents/skills/ui-ux-pro-max/SKILL.md` + `.agents/skills/frontend-design/SKILL.md` แล้ว — ใช้ design system เดิม (Panel/Alert/Badge/Spinner, 44px targets, labels, aria-live, responsive) ไม่ทำ Taste เพราะไม่มี reference URL ภายนอก
- ที่บันทึกเป็นงานภายหลัง (ไม่ทำให้ ticket ล้ม ตาม acceptance ข้อสุดท้าย):
  MySQL integration จริง (TEST_DATABASE_URL แยก), การชำระเงินจริง/SlipOK/PromptPay,
  งานคิวครัว/เครื่องดื่ม, LINE notification, image/external storage, Docker/MySQL runtime,
  browser responsive/keyboard QA จริง
- ที่ไม่รวมตาม scope (ไม่ implement): payment, queue/kitchen-drink, LINE, Docker/MySQL runtime,
  full waitlist, Prisma changes, experiments, package dependencies
