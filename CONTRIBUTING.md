# แนวทางการมีส่วนร่วม

ขอบคุณที่ช่วยพัฒนาระบบร้านป้าอ๋อ เอกสารนี้เป็นทางเข้าสำหรับผู้พัฒนาใหม่
รายละเอียดโดเมนให้ยึด CONTEXT.md และสารบัญเอกสารใน docs/README.md

## Branch

สร้าง branch จาก main และใช้ชื่อสั้นที่บอกเจตนา เช่น

- claude/bug-scan-fixes
- codex/docs-reorganization
- feature/menu-import
- fix/reservation-timezone
- docs/github-hygiene
- chore/ci-cache

ประวัติ repo ใช้ prefix อย่าง claude/, codex/, experiment/ และ research/ อยู่แล้ว
ส่วน change ใหม่ควรใช้ prefix ที่สื่อประเภทงานและ slug ภาษาอังกฤษที่อ่านง่าย

## Commit

ใช้ Conventional Commits โดย prefix ที่พบในประวัติ repo ได้แก่
feat, fix, docs, style, test และ perf เช่น

~~~text
docs: improve repository wayfinding
fix(deploy): explain API availability
test(web): align reservation assertion
~~~

เขียน subject เป็นคำสั่งสั้น ๆ และใส่ scope เมื่อช่วยให้ค้นประวัติได้ง่าย

## Local setup และ tests

~~~powershell
npm ci
npm run typecheck
npm run test:api
npm run test:web
npm run build
~~~

สำหรับการพัฒนาเต็มรูปแบบ ให้สร้าง .env จาก .env.example และเริ่ม MySQL ด้วย
docker compose up -d จากนั้นใช้ npm run dev:api และ npm run dev:web
รายละเอียด environment และโหมด demo อยู่ใน docs/development-guide.md

## Pull request flow

1. อัปเดต branch กับ main และตรวจ diff ให้เหลือเฉพาะงานที่เกี่ยวข้อง
2. รัน typecheck, API tests, web tests และ build
3. เปิด PR พร้อมสรุปสิ่งที่เปลี่ยน, วิธีทดสอบ และความเสี่ยง/สิ่งที่ยังไม่ทำ
4. ตอบ review และให้ CI ผ่านก่อน merge
5. ใช้ squash merge ตามแนวทางของ repo และลบ head branch หลัง merge

ห้าม commit secret, ไฟล์ .env จริง หรือ asset ขนาดใหญ่ที่ไม่จำเป็น
อ่าน SECURITY.md ก่อนทำงานที่เกี่ยวกับ credentials, session หรือข้อมูลลูกค้า
