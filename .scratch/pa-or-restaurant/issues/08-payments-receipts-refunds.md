# 08: การชำระเงิน ใบเสร็จ และคืนเงิน

**What to build:** local-first payment state machine ผูกกับคำสั่งซื้อ (pending_payment → paid/manual_review/failed/expired/refunded), เงินสด/เงินทอน + PromptPay/Slip adapter contract (fake provider เท่านั้น), webhook dedupe/idempotency, ambiguous timeout → manual_review, audit actor/reason/before/after, กัน payment success ซ้ำและกัน side effects (queue/stock/points) ซ้ำ, เลขใบเสร็จ + มุมมองลูกค้า/หลังร้าน, Owner-approved refund/cancel พร้อมคืนยอดจองสต๊อกและปลด linkage รอบโต๊ะ

**Blocked by:** 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน (resolved), 06 — การจองโต๊ะและรอบการใช้โต๊ะ (resolved), 07 — ตัวเลือกเมนู สูตร และสต๊อก (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark via opencode)

## Scope

อ้างอิง FR-PAY-001–004, FR-FIN-001, BR-001, BR-009, NFR-REL-001/002, NFR-OBS-001 และ Payment baseline (`pending`, `paid`, `failed`, `expired`, `cancelled`, `refunded`) ใน `docs/REQUIREMENTS.md` ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- Payment หนึ่งรายการผูกหนึ่งคำสั่งซื้อที่ `pending_payment` เท่านั้น; ยอดชำระตรึงเท่ายอดคำสั่งซื้อ (`FR-PAY-001`)
- วิธีชำระ: `cash` (หลังร้านยืนยันรับเงิน + คำนวณเงินทอน) และ `promptpay` (fake provider: สร้าง intent ได้ QR payload + หมดอายุ, ยืนยันผ่าน webhook/slip fake)
- SlipOK ใช้เฉพาะ dev fake mode (`PAOR_PAYMENT_FAKE=true` หรือ non-production) ห้ามอ่าน credentials จริง; production adapter เป็น contract-only (503)
- Webhook dedupe ด้วย provider event id (replay → `deduplicated:true` ไม่เขียน audit/ledger ซ้ำ); ambiguous/timeout → `manual_review` ให้ Admin ตรวจมือ
- Payment success ซ้ำถูกปฏิเสธ (409 หรือ dedupe) และห้าม duplicate queue/stock/points side effects (จ่ายแล้วไม่จอง/ตัดสต๊อกซ้ำ; queue = Ticket 09, points = Ticket 10 — บันทึกเป็น no-op ที่มี idempotency)
- ใบเสร็จอย่างง่าย (`RCP-YYYYMMDD-XXXX`): เลขเอกสาร วันที่ รายการ ยอดรวม ช่องทางชำระ ชื่อร้าน — ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ; ลูกค้าเห็นเฉพาะของตนเอง, หลังร้านค้นหาด้วยเลขคำสั่งซื้อ/วันที่/สถานะ (`FR-PAY-004`)
- Refund/cancel: Owner อนุมัติเท่านั้น พร้อม audit; คืนยอดจองสต๊อกด้วย Ticket 07 contract (ยกเลิกก่อนเริ่มทำเท่านั้น — ตัดจริงแล้วปฏิเสธ); ออเดอร์ → `cancelled` ทำให้รอบโต๊ะปิดได้ตาม Ticket 06 contract
- UI ภาษาไทย: สถานะ loading/error/empty/success/focus, touch targets ≥44px, responsive ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL ภายนอก)

ไม่รวมการชำระเงินจริง/SlipOK/PromptPay network credentials, LINE notification, Docker/MySQL runtime จริง, image/external storage, browser E2E จริง (Playwright/Taste) ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [ ] สร้าง payment intent ได้เฉพาะออเดอร์ `pending_payment` ยอดตรง; ออเดอร์ปิดงานแล้วยืนยันซ้ำถูกปฏิเสธ
- [ ] เงินสด: รับเงิน ≥ ยอด (ทอนถูกต้อง), น้อยกว่ายอดถูกปฏิเสธ; PromptPay fake: intent → webhook success → paid + ใบเสร็จ; replay event เดิม → dedupe ไม่ side effect ซ้ำ
- [ ] Slip fake: `VALID-*` → paid, `AMBIGUOUS-*`/timeout → manual_review, อื่น → failed; production ไม่มี fake (contract-only 503, ไม่แตะ credentials จริง)
- [ ] หมดอายุ (fake clock): intent เกินเวลาชำระ → expired; expired จ่ายต่อไม่ได้
- [ ] audit ครบ (payment_created/paid/manual_review/failed/expired/refund_approved/…) มี actor/reason/before→after ไม่มีข้อมูลลับ; ดูได้เฉพาะ Owner/Admin
- [ ] ใบเสร็จมีเลขเอกสาร + ข้อมูลครบตามนิยามใบเสร็จอย่างง่าย; ลูกค้า/Guest เห็นเฉพาะของตนเอง
- [ ] Refund: เฉพาะ Owner, เฉพาะ payment ที่ paid, ออเดอร์ยังไม่ตัดสต๊อกจริง; สำเร็จ → payment refunded + ออเดอร์ cancelled + คืนยอดจอง + audit; ตัดจริงแล้ว/ซ้ำถูกปฏิเสธ
- [ ] API/Web tests, typecheck และ build ผ่าน; MySQL runtime จริง/external providers/browser E2E บันทึกเป็นงานภายหลัง ไม่ทำให้ ticket นี้ล้ม

## Comments

### 2026-09-14 — เริ่ม Ticket 08

- เริ่มหลัง Tickets 05–07 (ต้องมีคำสั่งซื้อ + รอบโต๊ะ + สต๊อก/สูตรเป็นฐาน)
- OrderStatus contract เดิม (`pending_payment`/`completed`/`cancelled`) ไม่เปลี่ยน; state machine การชำระอยู่บน Payment entity + แสดง `paymentState` ต่อยอด (pending_payment → paid/manual_review/failed/expired/refunded)
- จ่ายสำเร็จไม่แตะสต๊อกซ้ำ (จองไว้แล้วตอนยืนยัน — Ticket 07); queue (09) และ points (10) เป็น no-op ที่มี idempotency guard
- ข้าม external services ตามนโยบายงาน และบันทึกไว้ใน tracking report

### 2026-09-14 — ตรวจรับและปิด Ticket 08

- ทำ payment state machine, ใบเสร็จ, fake PromptPay/Slip, webhook dedupe, manual review และ Owner refund เสร็จตามขอบเขต
- ผลตรวจ executor: API `184 passed / 27 skipped`; focused payment API `12 passed`; Web focused `7 passed` พร้อม regression batches `11` และ `15` ผ่าน; typecheck และ build ผ่าน
- ยังข้ามตามนโยบาย: MySQL runtime/integration ที่ต้องมี `TEST_DATABASE_URL`, payment provider/PromptPay/SlipOK credentials และ network จริง, Docker, browser E2E/Playwright/Taste (ไม่มี reference URL)
