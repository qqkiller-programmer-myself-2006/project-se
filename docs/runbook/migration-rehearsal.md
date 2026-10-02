# Checklist: ซ้อม migration ก่อน release (Ticket 14)

ใช้ตรวจ migration `db/migrations/001–016` (และชุด Postgres `db/supabase/001–016`) แบบไม่ต้องมี Docker/MySQL
(รันจริงบนเครื่องที่มี DB ตามขั้นตอนข้อ 4) สคริปต์ตรวจอัตโนมัติ:
`node scripts/verify-restore.mjs` (exit 0 = ผ่านระดับ static)

## 1. สินค้าคงคลัง migration (ต้องครบ 16 ไฟล์ ตามลำดับ)

```
001_staff_accounts.sql
002_credential_version.sql
003_shop_status_tables.sql
004_customer_accounts.sql
005_menu_catalog.sql
006_orders.sql
007_reservations.sql
008_menu_options_recipes_inventory.sql
009_payments_receipts_refunds.sql
010_kitchen_drink_queues.sql
011_loyalty_rewards.sql
012_finance_entries.sql
013_line_notifications.sql
014_capacity_wait_predictions.sql
015_table_zones.sql
016_seed_noonui_cha_tai.sql
```

ลำดับใน `MIGRATION_FILES` (`apps/api/src/store.ts`) ต้องตรงกับรายการนี้
(สคริปต์ตรวจให้แล้ว)

## 2. กฎ rerunnable (ทุกไฟล์ต้องผ่าน)

- [ ] มี `IF NOT EXISTS` (หรือ guard เทียบเท่า) สำหรับ `CREATE TABLE`
- [ ] `ALTER TABLE ... ADD COLUMN` มี fallback ทน error 1060 (duplicate column)
      ฝั่ง runner (`store.ts` tolerate 1060) — เอกสารไว้ใน ticket ของ migration นั้น
- [ ] ไม่มี `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` (migration เป็น additive เท่านั้น)
- [ ] `INSERT` ได้เฉพาะ seed ค่าเริ่มต้น/เมนูที่ rerunnable (`ON CONFLICT` / `INSERT IGNORE` เช่น 003, 014, 016)
      ไม่มีบัญชีผู้ใช้/รหัสผ่าน (บัญชี Owner สร้างผ่าน `npm run bootstrap` แบบถามรหัสผ่านเท่านั้น)
- [ ] ไม่มี secret/token/รหัสผ่านตัวอย่างในไฟล์ SQL

## 3. Static rehearsal (ทำได้ทุกเครื่อง — ไม่ต้องมี DB)

- [ ] `node scripts/verify-restore.mjs` → exit 0
- [ ] `npm run typecheck -w apps/api` → ผ่าน (store/MySQL adapter compile ตรง schema)
- [ ] `npm run test -w apps/api` → ผ่าน; `*.int.test.ts` ต้อง **skip อย่างซื่อสัตย์**
      (ไม่มี `TEST_DATABASE_URL`) ไม่ใช่ผ่านปลอม — ใน CI จะรันจริงแทนที่จะ skip (ดู `docs/runbook/integration-db-tests.md`)

## 4. Rehearsal บนฐานจริง (ทำบน staging/ฐานซ้อมเท่านั้น — ห้ามรันบน production ตรง)

- [ ] สร้างฐานเปล่า → รัน migration 001→016 จากศูนย์ → app บูตได้ (`/api/ready` 200)
- [ ] รัน migration ซ้ำรอบสองบนฐานเดิม → ต้องสำเร็จโดยไม่มี error (idempotent)
- [ ] รัน `*.int.test.ts` ด้วย `TEST_DATABASE_URL` แยก → ผ่าน (รวม rollback test
      เมื่อ audit เขียนไม่ได้ และ migration รันซ้ำ)

> หมายเหตุ: workflow `Integration (real DB)` ใน CI รัน 3 ข้อบนนี้บน **MySQL 8.4** (ทุกไฟล์) และ **Postgres 16**
> (เฉพาะ `*-sql.int.test.ts`) ทุก PR โดยไม่มีตารางบันทึก migration — `createMysqlStore` รันทั้ง 16 ไฟล์ทุกครั้งที่ start
> และทุกไฟล์ test เรียกต่อกันบน DB เดียว จึงเป็นหลักฐานการรันซ้ำ แต่ **ไม่ใช่ Supabase/Supavisor จริง**
> การซ้อมบน staging Supabase ยังต้องทำเองตามข้อ 4 (ดู issue #34, #39)
- [ ] ทดสอบ rollback แผน: เนื่องจาก migration เป็น additive จึงไม่มี down-migration —
      แผนถอยคือ **restore dump ก่อน deploy** ตาม `docs/runbook/backup-restore.md`
      (ต้องมี dump ผ่าน R1 ก่อน deploy เสมอ)

## 5. เกณฑ์ Go / No-go

- Go: ข้อ 1–3 ผ่านครบ + ข้อ 4 ผ่านบนฐานซ้อม + มี dump สำรองก่อน deploy
- No-go: migration ไฟล์ใดไม่ rerunnable, int test แดง, หรือไม่มี dump ใหม่ —
  เลื่อน release แล้วบันทึกเหตุใน tracking
