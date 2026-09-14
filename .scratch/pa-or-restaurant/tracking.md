# Tracking report

## 2026-09-14

### Ticket 01 — บัญชีพนักงาน

- Commit: `31623ae` (รวม Ticket 02)
- สถานะ: ทำงานหลักเสร็จ; รอ MySQL integration และ browser QA จริง

### Ticket 02 — สถานะร้านและโต๊ะ

- Commit: `31623ae`
- สถานะ: ทำงานหลักเสร็จ; รอ MySQL integration และ browser QA จริง

### Ticket 03 — บัญชีลูกค้าและการเชื่อม LINE

- Commit: `7ba44be`
- สถานะ: implementation และ tests หลักเสร็จ; งาน production LINE deauthorize/recovery และ external QA เลื่อนไปทำภายหลัง
- ผลตรวจล่าสุด: API 126 ผ่าน/17 ข้าม, Web 79 ผ่าน, typecheck/build ผ่าน

### Ticket 04 — เมนูอาหารและเครื่องดื่ม

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode)
- ผลตรวจ: API 138 ผ่าน/19 ข้าม (MySQL int ไม่มี TEST_DATABASE_URL), Web 90 ผ่าน,
  typecheck ผ่าน, build ผ่าน (api tsc + web vite 52 modules)
- ไม่แตะ Prisma/experiments/package dependencies ของงานอื่น; Tickets 01–03 ไม่ regression
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  Docker/MySQL runtime จริง, image storage/upload ภายนอก, browser QA จริง
- ไม่รวมตาม scope (งาน ticket ถัดไป): orders, cart, payment, stock/สูตรวัตถุดิบ,
  image upload, external providers

### Ticket 05 — ตะกร้าและคำสั่งซื้อพื้นฐาน

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode)
- ผลตรวจ: API 148 ผ่าน/21 ข้าม (MySQL int ไม่มี TEST_DATABASE_URL), Web 106 ผ่าน,
  typecheck ผ่าน, build ผ่าน (api tsc + web vite 57 modules)
- ไม่แตะ Prisma/experiments/package dependencies ของงานอื่น; Tickets 01–04 ไม่ regression
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง, payment/SlipOK/PromptPay, stock/สูตรวัตถุดิบ,
  reservation/table-round, kitchen/drink queue, LINE notification,
  image/external storage, browser QA จริง
- ไม่รวมตาม scope (งาน ticket ถัดไป): payment, stock/สูตร, reservation/รอบโต๊ะ,
  งานคิวครัว/เครื่องดื่ม, LINE, Docker/MySQL runtime

### Ticket 06 — การจองโต๊ะและรอบการใช้โต๊ะ

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode)
- ผลตรวจ: API 159 ผ่าน/23 ข้าม (MySQL int ไม่มี TEST_DATABASE_URL), Web 126 ผ่าน
  (เดิม 106 + ใหม่ 20: reservations/checkin/admin-reservations),
  typecheck ผ่าน, build ผ่าน (api tsc + web vite 61 modules)
- ไม่แตะ Prisma/experiments/package dependencies ของงานอื่น; Tickets 01–05 ไม่ regression
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง, LINE reminder/notification, QR provider จริง,
  payment/deposit, full waitlist, Docker/MySQL runtime, browser QA จริง
- ไม่รวมตาม scope (งาน ticket ถัดไป): LINE, payment/deposit, external notification,
  full waitlist, Prisma/experiments

### Ticket 07 — ตัวเลือกเมนู สูตร และสต๊อก

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode — สานงานค้างใน working tree)
- ผลตรวจ: API 172 ผ่าน/25 ข้าม (MySQL int ไม่มี TEST_DATABASE_URL), Web 134 ผ่าน
  (เดิม 126 + ใหม่ 8: inventory/stock/ledger/recipe/options),
  typecheck ผ่าน, build ผ่าน (api tsc + web vite 62 modules)
- ไม่แตะ Prisma/experiments/package dependencies/preset งานอื่นที่ค้างอยู่ก่อนแล้ว
  (apps/api/package.json, package-lock.json, apps/api/.gitignore, generated/,
  prisma.config.ts, prisma/, src/db/, experiments/); Tickets 01–06 ไม่ regression
  (ซ่อมเฉพาะจุดที่ Ticket 07 ทำให้พัง: cart.test.ts shape ใหม่ + menu-admin.test.tsx
  query กำกวมจาก selector ตัวเลือกเมนูใหม่)
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง, การชำระเงินจริง/SlipOK/PromptPay, งานคิวครัว/เครื่องดื่ม,
  LINE notification, image/external storage, Docker/MySQL runtime, browser QA จริง
  (รวม Playwright/Taste — ไม่มี reference URL ภายนอก เลื่อนตามนโยบายโปรเจกต์)
- ไม่รวมตาม scope (งาน ticket ถัดไป): payment/ใบเสร็จ/คืนเงิน (08),
  คิวครัว/เครื่องดื่ม (09), คะแนน/รางวัล (10), การเงิน/Dashboard/CSV (11),
  LINE (12), capacity/พยากรณ์ (13), backup/security/E2E (14)

### Ticket 08 — การชำระเงิน ใบเสร็จ และคืนเงิน

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode)
- ผลตรวจ: API 184 ผ่าน/27 ข้าม (MySQL integration ไม่มี `TEST_DATABASE_URL`),
  focused payment API 12 ผ่าน, Web focused 7 ผ่าน พร้อม regression batches 11 และ 15 ผ่าน,
  typecheck และ build ผ่าน
- ไม่แตะ Prisma/experiments/package dependencies ที่ค้างมาก่อน
  (`apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `generated/`,
  `prisma.config.ts`, `prisma/`, `src/db/`, `experiments/`); Tickets 01–07 ไม่ regression
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง, ผู้ให้บริการ PromptPay/SlipOK และ credentials/network จริง,
  Docker, image/external storage และ browser E2E จริง (Playwright/Taste ไม่มี reference URL)
- ไม่รวมตาม scope (งาน ticket ถัดไป): คิวครัว/เครื่องดื่ม (09), คะแนน/รางวัล (10),
  การเงิน/Dashboard/CSV (11), LINE (12), capacity/พยากรณ์ (13),
  backup/security/observability/release E2E (14)

## Roadmap หลัง Ticket 06

- Ticket 07: ตัวเลือกเมนู สูตร และสต๊อก
- Ticket 08: การชำระเงิน ใบเสร็จ และคืนเงิน
- Ticket 09: คิวครัว/เครื่องดื่มและการส่งมอบ
- Ticket 10: คะแนนสะสมและรางวัล
- Ticket 11: การเงิน รายงาน Dashboard และ CSV
- Ticket 12: LINE notifications และ reliability
- Ticket 13: Capacity และการพยากรณ์เวลารอ
- Ticket 14: Backup/recovery, security/observability และ release E2E

ทุกรายการจะทำตามลำดับ dependency, ข้าม external services ตามนโยบาย และบันทึกผลไว้ก่อน commit
