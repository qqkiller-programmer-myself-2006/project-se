# 11: การเงิน รายงาน Dashboard และ CSV

**What to build:** local-first finance module: รายรับจาก paid orders (exactly-once) หัก refunds, รายจ่ายจริง/รายรับมือ CRUD, ต้นทุนประมาณการแยกจากรายจ่ายจริง, รายงานวัน/เดือน/ปี (Asia/Bangkok), Dashboard KPI, วิเคราะห์เมนูขายดี/ชั่วโมงหนาแน่น, CSV export (UTF-8 BOM + PII masking), Owner/Admin only, MemoryStore/fake-clock tests + migration 012, API routes/types/store/UI routes + tests

**Blocked by:** 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน (resolved), 07 — ตัวเลือกเมนู สูตร และสต๊อก (resolved), 08 — การชำระเงิน ใบเสร็จ และคืนเงิน (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D08 (การเงิน รายงานและข้อความ), User Stories 43–47, AT14 และ FR-FIN ใน `docs/REQUIREMENTS.md` ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- รายจ่ายจริง/รายรับมือ (finance_entries): kind income|expense, category, amount, occurredAt (UTC, รับ wall-clock กรุงเทพ), note, actor, reason + audit (finance_entry_created/updated/deleted) แบบ all-or-nothing
- รายรับจากคำสั่งซื้อ: นับ paid payments ครั้งเดียวตาม paidAt (exactly-once), หัก refunds ตาม approvedAt; ต้นทุนประมาณการ (orders.estimatedCost) แสดงแยก ไม่หักซ้ำในกำไร
- กำไรเบื้องต้น = (รายรับสุทธิ + รายรับมือ) − รายจ่ายจริง
- รายงาน day/month/year buckets ฝั่ง Asia/Bangkok (from/to = YYYY-MM-DD wall-clock)
- Dashboard KPI วันนี้: ยอดขายสุทธิ, จำนวนคำสั่งซื้อที่ชำระ, บิลเฉลี่ย, เมนูขายดี top5, ชั่วโมงหนาแน่น 24 ชม., occupancy (โต๊ะ enabled/free/occupied + จำนวนผู้ใช้บริการจากรอบเปิด) ถ้ามี
- วิเคราะห์: top-menus + peak-hours endpoints (ช่วงวันที่กำหนด)
- CSV export: kinds sales|orders|finance (+ stock/queue ตาม Spec D08) แบบ UTF-8 BOM, Content-Disposition attachment, PII masking (เบอร์โทร/ชื่อ)
- Role isolation ฝั่ง server: Owner/Admin เท่านั้น (requireShopManager); Customer/kitchen/drink/Guest ถูกปฏิเสธ 403
- Tests deterministic: MemoryStore + fake clock (now injection), ไม่ใช้เวลาจริง/network
- Migration `db/migrations/012_finance_entries.sql` + เข้า `MIGRATION_FILES`

ไม่รวม MySQL runtime จริง, Docker, payment/LINE provider integration, external storage, browser/Playwright/Taste QA (ไม่มี reference URL) — บันทึกเป็น deferred

## Acceptance criteria

- [x] expense/income CRUD ครบ (categories, amount/date, note, actor, reason) + audit trail; validation ครบ; บทบาทอื่นถูกปฏิเสธ
- [x] paid orders นับรายรับครั้งเดียว, refunds หักครั้งเดียว; estimated cost แยกจาก actual expense (ไม่หักซ้ำ)
- [x] รายงาน day/month/year ตรง Asia/Bangkok buckets; ยอดกระทบกัน (gross − refunds = net; net + manual income − expense = profit)
- [x] Dashboard KPI ครบ: sales, orders, average ticket, top menu, peak hours, occupancy (ถ้ามี)
- [x] วิเคราะห์เมนูขายดี + ชั่วโมงหนาแน่นถูกต้อง
- [x] CSV มี BOM + PII masking + documented format
- [x] Owner/Admin ผ่าน; Customer/staff (kitchen/drink) ถูกปฏิเสธ
- [x] MemoryStore/fake-clock tests + migration 012; API/Web tests, typecheck, build ผ่าน
- [x] ไม่แตะไฟล์ต้องห้าม: apps/api/package.json, package-lock.json, apps/api/.gitignore, apps/api/generated/, apps/api/prisma.config.ts, apps/api/prisma/, apps/api/src/db/, experiments/, cache/__pycache__

## Comments

### 2026-09-15 — เริ่ม Ticket 11 (claimed)

- ต่อจาก commit 5131160 (Ticket 10 resolved)
- แผน: types (FinanceEntry/Report/Dashboard + audit actions) → finance/validation.ts + audit-events.ts → migration 012 → Store seams (memory + MySQL) → routes/finance.ts + wiring app.ts (+ audit prefix finance_) → Web api client + Dashboard/Finance pages + nav/routes → API tests (finance.test.ts) + Web tests (finance-dashboard.test.tsx) → typecheck/build → resolve + commit `feat: implement finance reports and dashboard`
- UI: อ่าน .agents/skills/ui-ux-pro-max/SKILL.md (pro-rules checklist) + .agents/skills/frontend-design/SKILL.md แล้ว; ใช้ React/Tailwind stack เดิม (Panel/Alert/Badge/Spinner, 44px targets, aria-live, responsive 375/768/1024/1440); data-dense dashboard, navy #1E40AF / blue #3B82F6 / amber #D97706, slate bg #F8FAFC, light/dark via existing tokens, visible focus, reduced motion; ไม่ใช้ emoji icons
- ข้ามตามนโยบาย (deferred, ไม่ทำให้ ticket ล้ม): MySQL runtime จริง (TEST_DATABASE_URL), Docker, payment/LINE/provider integration, external storage, browser/Playwright/Taste QA

### 2026-09-15 — ตรวจรับและปิด Ticket 11 (resolved)

- ผลตรวจ executor (exact):
  - API `tests/finance.test.ts` 10/10 ผ่าน (MemoryStore + HTTP seam; occurredAt/paid bucketing ฝั่ง Asia/Bangkok, exactly-once + refund reconcile, estimated-cost separation, CRUD/audit/validation/auth, dashboard/top/peak, CSV BOM + PII masking ครบ 5 kinds)
  - API full: 17 files passed / 8 skipped → **215 passed, 27 skipped** (เดิม 205 + ใหม่ 10; MySQL int ข้าม — ไม่มี `TEST_DATABASE_URL`)
  - Web `tests/finance-dashboard.test.tsx` 4/4 ผ่าน
  - Web full: 31 files → **173 passed** (เดิม 169 + ใหม่ 4)
  - `npm run typecheck` (api+web): ผ่าน
  - `npm run build`: api tsc emit ผ่าน; web vite **72 modules** ผ่าน (เดิม 70)
- ระหว่าง implement เจอและแก้: (1) finance route ขาด 400-mapping ของ validation errors (แก้ด้วย handleRouteError ตาม convention payments/inventory);
  (2) gross ต้องรวม refunded payments (เงินรับมาแล้วนับรายรับ ยอดคืนแสดงแยก — ไม่งั้น gross หายหลังคืนเงิน);
  (3) Guest จ่ายเงินต้องแนบ phone (contract เดิมของ payments); (4) web fetch stub ห่อ json() ซ้ำ (แก้ตาม pattern admin-rewards)
- ไม่แตะไฟล์ต้องห้าม (excluded จาก commit): `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`,
  `apps/api/generated/`, `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`, `__pycache__`
- UI: อ่าน ui-ux-pro-max (pro-rules checklist) + frontend-design แล้ว — ใช้ design system เดิม (Panel/Alert/Badge/Spinner,
  44px targets, labels, aria-live, responsive, visible focus, reduced motion) + dashboard accents
  (navy #1E40AF / blue #3B82F6 / amber #D97706, slate #F8FAFC, dark: variants); ไม่ใช้ emoji icons; ไม่ทำ Taste (ไม่มี reference URL)
- Deferred (recorded, ไม่ทำให้ ticket ล้ม): MySQL runtime จริง, Docker, payment/LINE/provider integration,
  external storage, CSV เกิน 200 แถว/large datasets (documented ใน FINANCE_CSV_FORMAT), browser/Playwright/Taste QA
