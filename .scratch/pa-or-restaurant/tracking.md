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
