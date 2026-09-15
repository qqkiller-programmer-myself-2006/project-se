# Runbook: สำรองและกู้คืนข้อมูล (Ticket 14)

ขอบเขต local-first: เอกสารนี้สั่งงานโดยผู้ดูแลระบบ (Owner/Admin) บนเครื่องที่มี
Docker/MySQL จริงเท่านั้น สภาพแวดล้อม dev นี้ไม่มี Docker จึง**ซ้อมด้วยเอกสาร +
สคริปต์ตรวจโดยไม่แตะฐานข้อมูลจริง** (`node scripts/verify-restore.mjs`)

อ้างอิง Spec D10 (`RPO 24 ชั่วโมง`, `RTO 4 ชั่วโมง`, backup ทุกวันย้อนหลัง 7 วัน,
Owner ดาวน์โหลดได้, ทดสอบ restore ก่อนส่งมอบ) และ User Story 51

## 1. ข้อตกลงสมมติ (assumptions — ต้องยืนยันกับ Owner ก่อน production)

| เรื่อง | ค่าตั้งต้น |
|---|---|
| RPO (ข้อมูลหายได้มากสุด) | 24 ชั่วโมง (backup รายวัน) |
| RTO (กลับมาให้บริการ) | 4 ชั่วโมง |
| ความถี่ backup | ทุกวัน 02:00 Asia/Bangkok (cron ฝั่ง host) |
| ระยะเก็บ (retention) | ไฟล์ dump ย้อนหลัง 7 วัน + สำเนารายสัปดาห์ 4 ชุด |
| ขอบเขต | MySQL `dbdata` volume ทั้งก้อน (schema + ข้อมูล; migration 001–014 รวมอยู่แล้ว) |
| ที่เก็บ | ดิสก์แยกจาก host DB + สำเนานอกเครื่อง 1 ชุด (Owner ถือ) |
| การเข้ารหัส | dump เข้ารหัส at-rest (เช่น age/gpg) ก่อนย้ายออกนอกเครื่อง |
| การแจ้งเตือน | backup ล้มเหลว → แจ้ง Owner ทันที (Spec D08; ปัจจุบันเป็นงาน manual — ดูหัวข้อ 5) |

> หมายเหตุซื่อสัตย์: โค้ดรุ่นนี้**ยังไม่มีปุ่ม Owner ดาวน์โหลด backup / job
> อัตโนมัติในระบบ** (Spec D10 เขียนว่า "Owner ดาวน์โหลดได้" แต่ไม่มี ticket
> ใด implement ไว้) ขั้นตอนล่างจึงเป็น operator-executed ผ่าน shell จนกว่า
> จะมี ticket "backup automation" — บันทึกเป็น external/deferred gate ใน
> `.scratch/pa-or-restaurant/issues/14-release-hardening.md`

## 2. Memory seam vs MySQL seam (สำคัญมาก)

- **Runtime/production ใช้ MySQL จริงเท่านั้น** (`createStoreFromEnv` โยน error
  ถ้าไม่มี `DATABASE_URL` — ไม่มี memory fallback) ดังนั้น backup ของจริง =
  MySQL dump + `dbdata` volume เท่านั้น
- **MemoryStore ใช้เฉพาะใน tests** (`createMemoryStore`) ไม่มี persistence —
  ห้ามอ้างว่า "ข้อมูลใน memory สำรองแล้ว" เด็ดขาด

## 3. สำรองข้อมูล (รายวัน, operator-executed)

```powershell
# 1) dump แบบ transaction-safe (ไม่ล็อกตารางนาน)
docker compose exec db mysqldump `
  -u root -p"$env:DB_ROOT_PASSWORD" `
  --single-transaction --routines --events `
  $env:DB_NAME > "backups/paor-$(Get-Date -Format 'yyyyMMdd-HHmm').sql"

# 2) ตรวจไฟล์ (ห้ามข้าม)
Get-Item backups/paor-*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 1
# ต้องมีขนาด > 0 และลงท้ายด้วย "-- Dump completed"

# 3) เก็บ 7 วันล่าสุด + รายสัปดาห์ (ลบของเก่าเกิน retention)
Get-ChildItem backups/*.sql | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item

# 4) บันทึก checksum ไว้เทียบตอน restore
Get-FileHash backups/paor-<stamp>.sql -Algorithm SHA256
```

## 4. กู้คืนข้อมูล (restore rehearsal)

```powershell
# 1) หยุด api ชั่วคราว (คง db ไว้) แล้ว restore ลงฐานซ้อมก่อนเสมอ
docker compose stop api
docker compose exec db mysql -u root -p"$env:DB_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS paor_restore;"
Get-Content backups/paor-<stamp>.sql | docker compose exec -T db mysql -u root -p"$env:DB_ROOT_PASSWORD" paor_restore

# 2) ตรวจความครบ: ตาราง + จำนวน migration ที่ใช้จริง
docker compose exec db mysql -u root -p"$env:DB_ROOT_PASSWORD" paor_restore -e "SHOW TABLES;"
# ต้องเห็นตารางธุรกิจครบ (users, customers, menu_items, orders, payments, queue_jobs, ฯลฯ)

# 3) ชี้ TEST_DATABASE_URL ไปฐานซ้อม แล้วรัน integration tests (อ่านอย่างเดียวพอ)
# $env:TEST_DATABASE_URL="mysql://paor:<รหัส>@127.0.0.1:3306/paor_restore"
# npm run test -w apps/api   # ต้องผ่านก่อนจึง promote เป็นฐานจริง

# 4) promote: แจ้งลูกค้าหยุดรับคำสั่งซื้อชั่วคราว → restore ลง DB จริง → start api
# 5) ตรวจหลัง restore: GET /api/ready → 200, GET /api/health → 200,
#    Owner เปิด Dashboard เทียบยอดขายวันล่าสุดกับใบเสร็จ RCP-* ก่อนเปิดรับงาน
```

เวลาคาดหมาย: dump < 5 นาที (ข้อมูลร้านเดียว), restore+verify < 30 นาที,
อยู่ใน RTO 4 ชั่วโมงพร้อม buffer

## 5. ตารางทดสอบ restore (ทำก่อนส่งมอบทุก release)

| # | กรณี | วิธี | เกณฑ์ผ่าน |
|---|---|---|---|
| R1 | dump มีข้อมูลครบ | restore ลง `paor_restore` + `SHOW TABLES` + นับแถวตารางหลัก | ตารางครบ ตรงจำนวน migration 14 ไฟล์ |
| R2 | app บูตกับข้อมูลที่ restore | `DATABASE_URL` → ฐานซ้อม → `npm start` → `/api/ready` | 200 + login Owner ได้ |
| R3 | migration รันซ้ำได้ | `node scripts/verify-restore.mjs` (ไม่ต้องมี DB) | exit 0 |
| R4 | point-in-time ภายใน RPO | ตรวจ timestamp dump ล่าสุด | ห่างจากปัจจุบัน ≤ 24 ชม. |
| R5 | retention | นับไฟล์ใน `backups/` | มี ≥ 7 วันย้อนหลัง |

## 6. เมื่อ backup ล้มเหลว

1. ห้าม deploy release ใหม่จนกว่าจะมี dump ที่ผ่าน R1
2. แจ้ง Owner ทันที (LINE/โทร — ช่องทางนอกระบบ เพราะระบบอาจล้มพร้อมกัน)
3. บันทึกเหตุ + เวลา + วิธีแก้ลง tracking (`tracking.md`) ก่อนปิดงาน
