# Integration test กับฐานข้อมูลจริง (MySQL และ Postgres)

test ที่ใช้ฐานข้อมูลจริงมีนามสกุล `*.int.test.ts` ใน `apps/api/tests/` ถ้าไม่ตั้ง `TEST_DATABASE_URL`
ไฟล์เหล่านี้จะ **ถูกข้าม** (ไม่ใช่ผ่าน) เอกสารนี้บอกวิธีรันให้ไม่ถูกข้าม ทั้งในเครื่องและใน CI

## ภาพรวม: ใครรันกับ DB อะไร

| ชนิด | ไฟล์ | MySQL | Postgres |
| --- | --- | :---: | :---: |
| ผูกกับ MySQL | `*-mysql.int.test.ts`, `mysql.int.test.ts` | ใช่ | ไม่ |
| ไม่ผูก dialect | `*-sql.int.test.ts` (เช่น `payments-sql`, `order-edit-sql`, `receipt-qr-sql`) | ใช่ | ใช่ |

- production รันบน **Supabase Postgres** ผ่านชั้น `pg-compat` ดังนั้นการพิสูจน์ SQL ของ production ต้องใช้ไฟล์ `*-sql.int.test.ts`
- ธรรมเนียมเมื่อเขียน test ใหม่ที่ใช้ DB: ตั้งชื่อ `<ชื่อ>-sql.int.test.ts` และตรวจ/ล้างข้อมูลผ่าน
  `tests/helpers/sql-admin.ts` (`openSqlAdmin`) ซึ่งใช้ SQL มาตรฐานและคุยได้ทั้งสอง DB
  **ห้ามใช้ไวยากรณ์เฉพาะ MySQL** เช่น `DELETE a FROM a JOIN b` — ใช้ `DELETE FROM a WHERE x IN (SELECT …)`

## ตัวกัน: จะไม่รันกับฐานข้อมูลที่ดูเป็น production

`apps/api/tests/helpers/db-guard.ts` ทำงานก่อนทุกไฟล์ test (ผ่าน `setupFiles` ใน `vitest.config.ts`)
ถ้าผิดกฎ **ทั้งชุดล้มทันที** พร้อมเหตุผลภาษาไทย:

1. `TEST_DATABASE_URL` ต้องไม่เท่ากับ `DATABASE_URL`
2. host เป็น Supabase → ต้องยืนยันเองด้วย `TEST_DATABASE_CONFIRM_REMOTE=1` (เพราะแยกโปรเจกต์ทดสอบ/จริงจาก URL ไม่ได้)
3. host อื่น → ชื่อฐานข้อมูลต้องมีคำว่า `test` (เช่น `paor_test`)

> ห้ามเอา `DATABASE_URL` ของ production ไปใส่เป็น `TEST_DATABASE_URL` เด็ดขาด test จะสร้างและลบข้อมูล
> (ลบเฉพาะแถวที่มี prefix ของตัวเอง แต่ไม่ควรเสี่ยง) และห้ามวาง connection string ลงแชท/ไฟล์ที่ commit

## ใน CI (อัตโนมัติ)

workflow `.github/workflows/integration.yml` รันทุก PR และทุก push เข้า `main` (ไม่มี `paths:` filter โดยตั้งใจ — ดูหมายเหตุด้านล่าง):

- **Integration (MySQL 8.4)**: ทุกไฟล์ `*.int.test.ts` ทีละไฟล์ (ไม่ขนาน)
- **Integration (Postgres 16)**: เฉพาะ `*-sql.int.test.ts`

ดูผลที่หน้า PR → Checks ทั้งสอง job เป็น **required check** ของ `main` คู่กับ `Quality checks` — ต้องผ่านก่อน merge

> หมายเหตุ: ชื่อ job (`Integration (MySQL 8.4)`, `Integration (Postgres 16)`) ผูกกับ branch protection ถ้าเปลี่ยนชื่อ
> ต้องแก้ required checks ให้ตรงด้วย และห้ามใส่ `paths:` filter ที่ trigger เพราะ PR ที่ไม่แตะไฟล์ตามเงื่อนไข
> จะไม่มี check นี้รายงานและถูกบล็อก merge ค้าง

## รันในเครื่อง (ต้องมี Docker Desktop)

### MySQL (รันได้ทุกไฟล์)

```powershell
docker run -d --name paor-test-mysql -e MYSQL_ROOT_PASSWORD=test-root -e MYSQL_DATABASE=paor_test -e MYSQL_USER=paor -e MYSQL_PASSWORD=test-pass -p 3307:3306 mysql:8.4
docker exec paor-test-mysql mysqladmin ping -uroot -ptest-root   # ลองซ้ำจนขึ้น "mysqld is alive"
$env:TEST_DATABASE_URL = "mysql://paor:test-pass@127.0.0.1:3307/paor_test"
npm run test -w apps/api -- --no-file-parallelism int.test
docker rm -f paor-test-mysql                                      # ล้างเมื่อเสร็จ
```

### Postgres (เหมือน production)

```powershell
docker run -d --name paor-test-pg -e POSTGRES_PASSWORD=test-pass -e POSTGRES_DB=paor_test -p 5433:5432 postgres:16
$env:TEST_DATABASE_URL = "postgres://postgres:test-pass@127.0.0.1:5433/paor_test"
npm run test -w apps/api -- --no-file-parallelism tests/payments-sql.int.test.ts tests/order-edit-sql.int.test.ts tests/receipt-qr-sql.int.test.ts
docker rm -f paor-test-pg
```

host ที่ไม่ใช่ Supabase จะไม่เปิด SSL ให้เอง จึงเชื่อมโดยตรงได้

### Supabase โปรเจกต์ทดสอบแยก (ใกล้ production ที่สุด)

1. สร้างโปรเจกต์ใหม่ (เช่น `paor-test`) — แผนฟรีมีโปรเจกต์ใช้งานได้ 2 ตัว
2. เอา connection string แบบ **Session pooler พอร์ต 5432** จาก Dashboard → Connect (**ไม่ใช้พอร์ต 6543** โค้ดปฏิเสธเอง)
3. ตั้งเฉพาะใน shell: `$env:TEST_DATABASE_URL = "<string นั้น>"` และ `$env:TEST_DATABASE_CONFIRM_REMOTE = "1"`
4. รันเหมือนหัวข้อ Postgres ด้านบน

## ผลที่ควรเห็น
- ไฟล์ที่เลือก **passed และ 0 skipped** — ถ้ายังขึ้น skipped แปลว่า `TEST_DATABASE_URL` ไม่ถูกส่งเข้า shell เดียวกัน
- ล้มด้วยข้อความ `[db-guard] ปฏิเสธรัน…` = URL ไม่ผ่านตัวกัน (อ่านเหตุผลในข้อความ)
- ระบบ migrate ให้เองตอนเริ่ม: MySQL ใช้ `db/migrations/`, Postgres ใช้ `db/supabase/`
