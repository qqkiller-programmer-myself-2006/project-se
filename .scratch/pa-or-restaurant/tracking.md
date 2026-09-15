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

### Ticket 09 — คิวครัว/เครื่องดื่มและการส่งมอบ

- สถานะ: resolved (2026-09-14, implement โดย Muse Spark via opencode)
- ผลตรวจ: API 193 ผ่าน/27 ข้าม (MySQL integration ไม่มี `TEST_DATABASE_URL`;
  เดิม 184 + ใหม่ 9: queue.test.ts), Web 153 ผ่าน (เดิม 141 + ใหม่ 12: queue.test.tsx),
  typecheck ผ่าน (api tsc + web tsc), build ผ่าน (api tsc emit + web vite 71 modules)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `generated/`,
  `prisma.config.ts`, `prisma/`, `src/db/`, `experiments/`,
  `.agents/skills/ui-ux-pro-max/scripts/__pycache__/`; Tickets 01–08 ไม่ regression
- สิ่งที่สร้าง: types (QueueStation/Status/Job/Capacity/Slot + audit actions queue_*),
  `apps/api/src/queue/{validation,audit-events}.ts`, Store seams (memory + MySQL),
  `db/migrations/010_kitchen_drink_queues.sql`, `apps/api/src/routes/queue.ts` + wiring,
  Web `StationQueue`/`QueueTrack` + api client + nav/routes, tests API/Web
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  LINE notification, offline เต็มรูปแบบ, external delivery/payment, Docker/MySQL runtime,
  image/external storage, browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป): คะแนน/รางวัล (10), การเงิน/Dashboard/CSV (11),
  LINE (12), capacity/พยากรณ์โมเดลเต็ม (13 — ticket นี้ส่ง slot/capacity seam ให้แล้ว),
  backup/security/observability/release E2E (14)

### Ticket 10 — คะแนนสะสมและรางวัล

- สถานะ: resolved (2026-09-15, implement โดย Muse Spark via opencode — finalize จาก current working tree, no implementation changes)
- ผลตรวจ (exact, no re-run):
  - API loyalty 12/12
  - API full 205 passed/27 skipped
  - Web rewards 16/16
  - Web full 169 passed
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 70 modules
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–09 ไม่ regression (finalize only, no re-run)
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  deferred real MySQL/Docker, LINE, payment providers, external storage,
  browser/Playwright/Taste QA
- ไม่รวมตาม scope (งาน ticket ถัดไป): การเงิน/Dashboard/CSV (11),
  LINE (12), capacity/พยากรณ์โมเดลเต็ม (13),
  backup/security/observability/release E2E (14)

### Ticket 11 — การเงิน รายงาน Dashboard และ CSV

- สถานะ: resolved (2026-09-15, implement โดย Muse Spark via opencode)
- ผลตรวจ (exact):
  - API focused finance 10/10
  - API full 215 passed/27 skipped (เดิม 205 + ใหม่ 10; MySQL int ข้าม — ไม่มี `TEST_DATABASE_URL`)
  - Web focused finance-dashboard 4/4
  - Web full 173 passed (เดิม 169 + ใหม่ 4)
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 72 modules (เดิม 70)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–10 ไม่ regression (full suites ข้างบน)
- สิ่งที่สร้าง: types (FinanceKind/Category/Entry/Report/Dashboard/TopMenu/PeakHour/Occupancy/CsvKind + audit actions finance_entry_*),
  `apps/api/src/finance/{validation,audit-events}.ts`, Store seams (memory + MySQL) + แชร์ pure aggregation
  (buildFinanceReport/TopMenus/PeakHours + Bangkok helpers + PII masking),
  `db/migrations/012_finance_entries.sql`, `apps/api/src/routes/finance.ts` + wiring app.ts + audit/finance,
  Web `FinanceDashboard`/`FinanceEntries` + api client + nav/routes, tests API/Web
- นโยบายรายรับ: gross = เงินที่รับมาแล้ว (paid หรือ refunded ภายหลัง — นับครั้งเดียวตาม paidAt),
  refunds ครั้งเดียวตาม approvedAt, net = gross − refunds,
  กำไรเบื้องต้น = net + รายรับมือ − รายจ่ายจริง; ต้นทุนประมาณการแสดงแยก ไม่หักซ้ำ
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  Docker, payment/LINE/provider integration, external storage,
  CSV เกิน 200 แถว/large datasets (documented limit ใน FINANCE_CSV_FORMAT),
  browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป): LINE (12), capacity/พยากรณ์โมเดลเต็ม (13),
  backup/security/observability/release E2E (14)

### Ticket 12 — LINE notifications และ reliability

- สถานะ: resolved (2026-09-15, implement โดย Muse Spark)
- ผลตรวจ (exact):
  - API focused notifications 11/11
  - API full 226 passed/29 skipped (เดิม 215 + ใหม่ 11; MySQL int ข้าม — ไม่มี `TEST_DATABASE_URL`)
  - Web focused notifications 6/6
  - Web full 179 passed (เดิม 169+4=173 + ใหม่ 6)
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 74 modules (เดิม 72 + 2 หน้าใหม่)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–11 ไม่ regression (full suites ข้างบน)
- สิ่งที่สร้าง: types (NotificationKind/Status/Notification + audit actions),
  `apps/api/src/notify/{validation,templates,messaging,events,audit-events}.ts`,
  Store seams (memory + MySQL) + `db/migrations/013_line_notifications.sql`,
  `apps/api/src/routes/notifications.ts` + wiring app.ts (+ hooks reservations/payments/queue/loyalty),
  Web `AdminNotifications`/`MyNotifications` + api client + nav/routes, tests API/Web
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  LINE Messaging API/credentials/sandbox/webhook/LIFF จริง, Docker/MySQL runtime,
  external payment/storage, browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- Deferred: แจ้งเตือน auto-earn จากเครื่องดื่มที่ส่งมอบ (store-internal ไม่มี route seam;
  ครอบคลุม loyalty_earned ผ่าน walk-in/guest-link และ loyalty_redeemed ผ่าน consume แล้ว)
- ไม่รวมตาม scope (งาน ticket ถัดไป): capacity/พยากรณ์โมเดลเต็ม (13),
  backup/security/observability/release E2E (14)

### Ticket 13 — Capacity และการพยากรณ์เวลารอ

- สถานะ: resolved (2026-09-15, implement โดย Muse Spark)
- ผลตรวจ (exact):
  - API focused capacity 7/7
  - API full 233 passed/29 skipped (เดิม 226 + ใหม่ 7; MySQL int ข้าม — ไม่มี `TEST_DATABASE_URL`)
  - Web focused capacity-dashboard 6/6
  - Web full 185 passed (เดิม 179 + ใหม่ 6)
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 75 modules (เดิม 74 + 1 หน้าใหม่)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–12 ไม่ regression (full suites ข้างบน)
- สิ่งที่สร้าง: types (PredictionSource/CapacityOverview/WaitEstimate/PreorderSlotCheck/PredictionModel/Feature/Accuracy + audit actions prediction_*),
  `apps/api/src/predict/{validation,adapter,audit-events}.ts`, Store seams (memory + MySQL) +
  `db/migrations/014_capacity_wait_predictions.sql`, `apps/api/src/routes/capacity.ts` + wiring app.ts,
  Web `CapacityDashboard` + เวลารอใน `QueueTrack` + api client + nav/routes, tests API/Web
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  external ML provider/API key/Python training (D09 — provider/วิธีฝึกยังไม่เลือก; เกณฑ์ 500 งานยังไม่ครบ),
  Docker/MySQL runtime, LINE/payment/storage จริง,
  browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป): backup/security/observability/release E2E (14)

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
