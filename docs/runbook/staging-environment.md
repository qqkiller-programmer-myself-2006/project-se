# Staging: Supabase แยก + Vercel Preview

เป้าหมาย: ให้ Vercel **Preview** ทุก PR ต่อ DB ของ staging ไม่ใช่ production (issue #32, #39)

> ห้ามติ๊ก Preview ให้ `DATABASE_URL` ของ production เด็ดขาด — ทุก PR (รวม Dependabot) จะเขียนข้อมูลและรัน migration ตอน boot บน DB จริง

## 1. สร้าง Supabase project สำหรับ staging (ทำเอง)
1. Supabase Dashboard → New project ตั้งชื่อ เช่น `project-se-staging` (แยกจาก production)
2. เก็บรหัสผ่าน DB ไว้ใน password manager ห้ามใส่ลง repo/issue/chat
3. Project Settings → Database → Connection string → เลือก **Session pooler (พอร์ต 5432)**
   - ต้องเป็น session mode เท่านั้น: `pg-compat.ts` ใช้ advisory lock/transaction ที่ transaction pooler (พอร์ต 6543) ไม่รองรับ และจะปฏิเสธพอร์ต 6543 ถ้าไม่ตั้ง `PG_ALLOW_TX_POOLER=1` (อย่าตั้ง)

## 2. ตั้งค่าใน Vercel (ทำเอง)
Project → Settings → Environment Variables → เพิ่มตัวแปรโดยติ๊ก **Preview เท่านั้น** (ไม่ติ๊ก Production/Development):

| ตัวแปร | ค่า |
|---|---|
| `DATABASE_URL` | connection string ของ staging (session pooler 5432) |
| `RECEIPT_QR_SECRET` | สุ่มใหม่สำหรับ staging (ไม่ใช้ซ้ำกับ production) |
| ตัวแปรอื่นที่ production ใช้ (LINE, payment, secret ต่างๆ) | ใช้ค่า **test/sandbox** ของ staging ไม่ copy ค่า production |

ตรวจ: ตัวแปรเดิมที่ติ๊ก Preview อยู่แล้วต้องไม่ชี้ production (ต้องให้เจ้าของตรวจเอง — เครื่องมือของ agent อ่านรายการ env ของ Vercel ไม่ได้)

## 3. Migration และ seed
- API รัน migration `db/supabase/001`–`016` ให้เองตอนเริ่ม (รันซ้ำได้ ไม่มีตารางบันทึก migration) — จึงไม่ต้องรันมือ
- ถ้าต้องการรันก่อน: ใช้ขั้นตอนใน [migration-rehearsal.md](migration-rehearsal.md) กับ DB staging
- Seed เมนูตัวอย่าง: `docs/menu-seed.md`
- หลาย Preview แชร์ DB staging เดียวกันได้ แต่ข้อมูลทดสอบจะปนกัน — ใช้ข้อมูลทดสอบที่ล้างทิ้งได้เสมอ

## 4. ตรวจหลัง setup
1. เปิด PR ทดสอบ รอ Vercel Preview เสร็จ
2. เรียก endpoint `/api/*` ของ Preview ต้องไม่ตอบ 503
3. ใน Supabase staging: ตารางหลัก (`orders`, `menu_items` ฯลฯ) ต้องถูกสร้างครบ
4. ทดสอบสั่งอาหาร 1 รายการบน Preview แล้วดูว่าข้อมูลอยู่ใน staging ไม่ใช่ production

## 5. ที่ยังไม่ครอบคลุม
- CI (`integration.yml`) ใช้ Postgres 16 ปกติ ไม่ใช่ Supabase/Supavisor (ดู #34)
- ยังไม่มี browser E2E บน staging (ดู #39)
- ถ้ายังไม่มี staging: ปล่อย Preview ตอบ 503 ต่อไป (เว็บแสดงข้อความไทยตาม PR #30) — ปลอดภัยกว่าต่อเข้า production
