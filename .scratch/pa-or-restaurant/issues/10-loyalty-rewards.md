# 10: คะแนนสะสมและรางวัล (loyalty points and rewards)

**What to build:** ระบบคะแนนสะสมเครื่องดื่มแบบ immutable ledger + แคตตาลอกรางวัล + แลก reward แบบ reserve/consume/release idempotent + QR Walk-in earn ครั้งเดียว + ผูก Guest ภายใน 24 ชม. + กฎรวมบัญชี + กลับรายการเมื่อคืนเงิน/ยกเลิก พร้อม role isolation และ audit ครบ

**Blocked by:** 03 — บัญชีลูกค้าและการเชื่อม LINE (claimed แต่มี seam พร้อมใช้), 04 — เมนู (resolved), 05 — ตะกร้าและคำสั่งซื้อ (resolved), 07 — ตัวเลือกเมนู สูตร และสต๊อก (resolved), 08 — การชำระเงิน ใบเสร็จ และคืนเงิน (resolved), 09 — คิวครัว/เครื่องดื่มและการส่งมอบ (resolved)

**Status:** resolved

**Assignee:** opencode-executor ผ่าน Codex (Muse Spark)

## Scope

อ้างอิง Spec D07 (คะแนนและรางวัล), User Stories 39–42, AT13 และ FR-LOY-001–004, BR-009/BR-010 ใน `docs/REQUIREMENTS.md` ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- กติกา earn: เครื่องดื่มที่ร่วมรายการ 1 หน่วย = 1 คะแนน เฉพาะเมื่อคำสั่งซื้อที่ชำระสำเร็จถูกส่งมอบ (`delivered` ครบของ queue jobs ฝ่าย drink) หรือปิดงาน `completed` แล้วเท่านั้น; เรียกซ้ำเป็น no-op (exactly-once ต่อ order/payment/job event) ไม่เขียน ledger/audit ซ้ำ; รางวัลราคา 0 ไม่ได้คะแนน
- Ledger append-only (immutable ห้ามแก้/ลบ): ทุกเหตุการณ์มีลูกค้า, คะแนน (+/-), ทิศทาง, แหล่งอ้างอิง (order/payment/queue/walk-in/reward/refund/merge/adjust), เวลา, actor/reason; ยอดคงเหลือเป็นผลรวม derived ของธุรกรรมที่มีผลเท่านั้น
- แคตตาลอกรางวัล (Admin/Owner จัดการ): ชื่อ รูป (URL เดิม ไม่ทำ upload) เมนูเครื่องดื่มอ้างอิง คะแนนที่ใช้ จำนวนสิทธิ์ (quota) ช่วงเวลาเริ่ม/หมดอายุ สถานะเปิด/ปิด; หยุดรับเมื่อสิทธิ์หมด สต๊อกพร้อมขายไม่พอ หรือพ้นช่วงเวลา/ปิดขาย
- แลก reward แบบ 2 ขั้น idempotent: ยืนยันแลก = reserve (กันคะแนน + กัน quota, idempotency key) → ร้านรับรายการ = consume (หักคะแนนถาวร + สร้างงานคิวเครื่องดื่มราคา 0 ผ่าน Ticket 09 seam ครั้งเดียว) / ปฏิเสธหรือวัตถุดิบหมด = release (คืนคะแนน + คืน quota, เรียกซ้ำ no-op); แลกพร้อมกันต้องไม่ใช้คะแนนเกินและไม่ใช้ quota เกิน
- รางวัลแลก = สร้าง queue job เครื่องดื่มราคา 0 หนึ่งชุด (ไม่สร้างรายรับ, ไม่ได้คะแนนซ้ำ, ผูก reward redemption ไม่ใช่ payment)
- QR Walk-in earn: ผู้ดูแลเครื่องดื่ม (drink/admin/owner) ออกโทเค็นครั้งเดียว อายุ 10 นาที (fake QR payload deterministic ใน MemoryStore + fake clock); ลูกค้าสแกนรับคะแนน 1 แต้มต่อ QR; ใช้ซ้ำ/หมดอายุ/ข้ามลูกค้าถูกปฏิเสธ; ต้องไม่ซ้ำกับคะแนนจากคำสั่งซื้อเดียวกัน
- Guest linking: Guest ผูกคำสั่งซื้อเข้าบัญชีลูกค้าภายใน 24 ชม. หลังยืนยันเบอร์เดียวกัน รับได้เฉพาะคะแนนที่ยังไม่มีผู้รับ (กัน double-earn); ผูกซ้ำ/เบอร์คนอื่นถูกปฏิเสธ
- รวมบัญชี (merge): ยืนยันตัวตนทั้งสองบัญชี (customer auth) + Owner/Admin อนุมัติ; ย้าย ledger/reward/redemption ไปบัญชีปลายทางแบบ atomic พร้อม audit; บัญชีต้นทางถูกปิด/นิรนาม; กันย้ายซ้ำ (idempotent)
- คืนเงิน/ยกเลิก: refund/partial-cancel ย้อนคะแนน earn ที่เกี่ยวข้อง (ติดลบได้แต่ต้องมี ledger ชัดเจน ห้ามลบประวัติ) + คืนคะแนน redeem ตามสถานะ (reserve อยู่คืนกันวงเงิน, consume แล้วคืนตามนโยบายพร้อม audit); กัน double-reversal (เรียกซ้ำ no-op)
- Role isolation ฝั่ง server: Customer เห็นเฉพาะของตนเอง; drink ออก QR Walk-in + รับ/ปฏิเสธ redemption ฝ่ายตนได้; Admin/Owner จัดการรางวัล + อนุมัติ merge/refund; kitchen/Guest/ลูกค้ารายอื่นถูกปฏิเสธ; audit มี actor/reason/before→after ไม่มีข้อมูลลับ ดูได้เฉพาะ Owner/Admin
- UI ภาษาไทย responsive: ลูกค้าดูยอด/ประวัติ/รางวัลพร้อมแลก, หน้าสแกน QR Walk-in, หลังร้านจัดการรางวัล + QR ออก + redemption queue; มี loading/error/empty/success/focus states, 44px targets, ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL)
- Tests deterministic: MemoryStore + fake QR + fake clock (ไม่ใช้เวลาจริง/network); ครอบคลุม double-earn/double-redeem/double-reversal/concurrent redeem/quota/stock/expiry

ไม่รวม LINE จริง, MySQL/Docker runtime จริง, payment providers จริง, external storage/image upload, browser E2E จริง (Playwright/Taste) ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] earn 1 แต้มต่อเครื่องดื่ม 1 หน่วยเฉพาะ paid+delivered/completed; เรียกซ้ำ no-op ไม่ ledger/audit ซ้ำ; reward ราคา 0 ไม่ได้คะแนน
- [x] ledger append-only + balance derived ตรงผลรวม; ทุกเหตุการณ์มีแหล่งอ้างอิง/actor/reason
- [x] รางวัลมี quota/ช่วงเวลา/สถานะ + หยุดรับเมื่อสิทธิ์หรือสต๊อกหมด; Admin/Owner CRUD ได้ บทบาทอื่นถูกปฏิเสธ
- [x] redeem reserve→consume/release idempotent ด้วย idempotency key; consume สร้าง queue job เครื่องดื่มราคา 0 ครั้งเดียว; concurrent ไม่เกินแต้ม/quota
- [x] QR Walk-in ครั้งเดียวอายุ 10 นาที (fake clock); ใช้ซ้ำ/หมดอายุถูกปฏิเสธ; ไม่ซ้ำกับคะแนนคำสั่งซื้อ
- [x] Guest ผูกภายใน 24 ชม. รับเฉพาะคะแนนที่ยังไม่มีผู้รับ; เกินเวลาหรือเบอร์ไม่ตรงถูกปฏิเสธ
- [x] merge บัญชี atomic + audit + กันย้ายซ้ำ; refund/cancel กลับรายการพร้อมกัน double-reversal
- [x] role isolation + audit ครบฝั่ง server; UI ไทย responsive พร้อม states ครบ; API/Web tests, typecheck, build ผ่าน; งานภายนอกบันทึกเป็น deferred ไม่ทำให้ ticket ล้ม

## Comments

### 2026-09-15 — เริ่ม Ticket 10 (claimed)

- Blockers 03/04/05/07/08/09 ถือว่าพร้อม (03 ยัง claimed แต่ identity seam ใช้งานได้; 04–09 resolved)
- ห้ามแตะไฟล์งานอื่นที่ค้างมาก่อน: `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`, `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`, `.agents/skills/ui-ux-pro-max/scripts/__pycache__/`
- นโยบายข้าม external: LINE จริง, MySQL/Docker runtime, payment providers, external storage, browser E2E — บันทึกเป็น deferred

### 2026-09-15 — Finalize Ticket 10 (resolved)

- Verification results (exact, from current working tree, no re-run):
  - API loyalty 12/12
  - API full 205 passed/27 skipped
  - Web rewards 16/16
  - Web full 169 passed
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 70 modules
- Deferred (recorded, not blocking): real MySQL/Docker, LINE, payment providers, external storage, browser/Playwright/Taste QA
- Status: resolved — no implementation changes during finalize, docs only
