# 09: คิวครัว/เครื่องดื่มและการส่งมอบ

**What to build:** local-first kitchen/drink queues with delivery confirmation, linked to paid orders, table rounds, and inventory consumption — no duplicate side effects.

**Blocked by:** 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน (resolved), 06 — การจองโต๊ะและรอบการใช้โต๊ะ (resolved), 07 — ตัวเลือกเมนู สูตร และสต๊อก (resolved), 08 — การชำระเงิน ใบเสร็จ และคืนเงิน (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง Spec D05 (งานคิวและการส่งมอบ), User Stories 26–32, AT10/AT11 และ FR-QUE-001–003 ใน `docs/REQUIREMENTS.md` ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- หลังชำระสำเร็จ (`paid` หรือยืนยันจ่ายหลังที่ร้าน) สร้าง queue jobs แบบ exactly-once deduplicated (idempotency จาก payment/order event; เรียกซ้ำเป็น no-op ไม่เขียน audit/ledger ซ้ำ)
- แยกคิว 2 ฝ่าย: อาหาร → kitchen, เครื่องดื่ม → drink (ตัดสินจาก menu kind/category ตาม Ticket 04 contract); FIFO ต่อฝ่ายตาม `readyAt` (เวลาพร้อมทำ)
- `readyAt`: งานทั่วไป = เวลาชำระ/ยืนยัน; งานล่วงหน้า (preorder) = เวลานัดลบเวลาทำประมาณการ — บล็อกจนถึง `readyAt` (ยังไม่ขึ้นคิวพร้อมทำ)
- Station role isolation ฝั่ง server: kitchen เห็น/ทำได้เฉพาะงานครัว, drink เฉพาะงานเครื่องดื่ม; owner/admin เห็นทั้งสองฝ่าย; ลูกค้า/Guest เห็นเฉพาะคำสั่งซื้อตนเอง
- Lifecycle ต่อ job: `queued → claimed → preparing → ready → delivered` พร้อม partial quantities (จำนวนทั้งหมด + จำนวนที่ทำเสร็จ/ส่งมอบทีละส่วน ไม่เกินยอดงาน)
- งาน dine-in ผูก table round (table_id/round_id จาก Ticket 06) — แสดงโต๊ะ/รอบในคิว
- นาฬิกาควบคุมได้ (fake clock seam แบบเดียวกับ Tickets 05/06/08) + capacity ต่อ station ช่วง 15 นาที + preorder slots (Admin ตั้งกำลังผลิต; เต็มเสนอช่วงถัดไป — contract สำหรับ Ticket 13)
- งานทำใหม่ (remake) / งานเร่งด่วน (priority) ต้องมีเหตุผล + audit (actor/reason/before→after) และสิทธิ์เฉพาะฝ่ายตน; ทำใหม่ไม่คิดเงินซ้ำ
- ผูก inventory Ticket 07: ตัดสต๊อกจริงเมื่อเริ่มทำ (consume ครั้งเดียว; เรียกซ้ำ no-op); ยกเลิกก่อนเริ่มคืนยอดจอง; ตัดจริงแล้วปฏิเสธ refund/cancel ตาม Ticket 08 contract; คืนเงินแล้ว job หยุดเดินต่อ
- ลูกค้าติดตามสถานะภาษาไทย (queued/preparing/ready/delivered + เวลารอโดยประมาณจากเวลามาตรฐานจนกว่า Ticket 13 จะมีโมเดล)
- UI ภาษาไทย: สถานะ loading/error/empty/success/focus, touch targets ≥44px, responsive ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL ภายนอก)

ไม่รวม LINE notification, offline เต็มรูปแบบ, external delivery/payment, Docker/MySQL runtime จริง, image/external storage, browser E2E จริง (Playwright/Taste) ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] จ่ายสำเร็จสร้าง jobs ครบทุกฝ่ายexactly-once; เรียกซ้ำ dedupe ไม่เพิ่ม job/audit/ledger
- [x] แยกฝ่ายครัว/เครื่องดื่มถูก; FIFO ตาม readyAt ต่อฝ่าย; preorder บล็อกจนถึง readyAt
- [x] kitchen/drink ข้ามฝ่ายถูกปฏิเสธ 403 ฝั่ง server; ลูกค้าเห็นเฉพาะของตนเอง
- [x] claim/start/ready/delivered + partial quantities ถูกต้อง (จำนวนเสร็จ/ส่งมอบไม่เกินยอด; ทำเสร็จกับส่งมอบแยกกัน)
- [x] dine-in jobs มี table/round linkage; preorder มี slot/capacity 15 นาที; remake/priority ต้องมีเหตุผล + audit
- [x] inventory consume ครั้งเดียวตอนเริ่มทำ; refund/cancel เคารพ paid/refund (ตัดจริงแล้วปฏิเสธ)
- [x] ลูกค้าติดตามภาษาไทยพร้อมเวลารอ; UI ผ่าน design system (focus/loading/error/empty/aria-live)
- [x] API/Web tests, typecheck และ build ผ่าน; MySQL runtime จริง/external/browser E2E บันทึกเป็นงานภายหลัง ไม่ทำให้ ticket นี้ล้ม

## Comments

### 2026-09-14 — เริ่ม Ticket 09

- เริ่มหลัง Tickets 05–08 (ต้องมีคำสั่งซื้อ + รอบโต๊ะ + สต๊อก/สูตร + การชำระเป็นฐาน)
- OrderStatus contract เดิมไม่เปลี่ยน; queue เป็น entity ใหม่ผูก order + payment event แบบ idempotent
- ข้าม external services ตามนโยบายงาน และบันทึกไว้ใน tracking report
- ห้ามแตะไฟล์งานอื่นที่ค้างมาก่อน: `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated`, `apps/api/prisma.config.ts`, `apps/api/prisma`, `apps/api/src/db`, `experiments`, `.agents/skills/ui-ux-pro-max/scripts/__pycache__`

### 2026-09-14 — resolve Ticket 09 (implement โดย Muse Spark via opencode)

- ผลตรวจ: API 193 ผ่าน/27 ข้าม (MySQL int ไม่มี TEST_DATABASE_URL; เดิม 184 + ใหม่ 9: queue.test.ts),
  Web 153 ผ่าน (เดิม 141 + ใหม่ 12: queue.test.tsx),
  typecheck ผ่าน (api tsc + web tsc), build ผ่าน (api tsc emit + web vite 71 modules)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket); Tickets 01–08 ไม่ regression
- สิ่งที่สร้าง: types (QueueStation/Status/Job/Capacity/Slot + audit actions),
  `apps/api/src/queue/{validation,audit-events}.ts`, Store seams (memory + MySQL) + `db/migrations/010_*`,
  `apps/api/src/routes/queue.ts` + wiring app.ts, Web `StationQueue/QueueTrack` + api client + nav/routes
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แต่รัน integration ไม่ได้เพราะไม่มี TEST_DATABASE_URL),
  LINE notification, offline เต็มรูปแบบ, external delivery/payment, Docker/MySQL runtime,
  image/external storage, browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป): คะแนน/รางวัล (10), การเงิน/Dashboard/CSV (11),
  LINE (12), capacity/พยากรณ์โมเดลเต็ม (13 — ticket นี้ส่ง slot/capacity seam ให้แล้ว),
  backup/security/E2E (14)
