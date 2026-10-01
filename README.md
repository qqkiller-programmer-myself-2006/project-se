# ระบบร้านป้าอ๋อ

ระบบจัดการร้านอาหารตามสั่งและการสั่งอาหารออนไลน์สำหรับลูกค้า พนักงาน และ Owner
รองรับหน้าเว็บลูกค้า, ระบบหลังร้าน, คำสั่งซื้อ, โต๊ะ/การจอง, เมนู, การชำระเงิน
และการเชื่อมต่อ LINE

## ภาพรวมใน 5 นาที

- API อยู่ที่ apps/api และมี Vercel entry ที่ api/index.ts
- เว็บอยู่ที่ apps/web
- ฐานข้อมูลและ migration อยู่ที่ db/
- เอกสารทั้งหมดอยู่ที่ docs/ โดยเริ่มจาก docs/README.md
- ข้อตกลงด้านคำศัพท์และบริบทอยู่ที่ CONTEXT.md

## Stack

- TypeScript, Express, React และ Vite
- npm workspaces: apps/api และ apps/web
- MySQL สำหรับ local development และ Supabase สำหรับ deployment ที่เกี่ยวข้อง
- Vitest สำหรับ API/web tests
- Docker Compose สำหรับ MySQL ในเครื่อง

## เริ่มต้นใช้งาน

ต้องมี Node.js 22, npm และ Docker Desktop

1. สร้างไฟล์ environment จากตัวอย่าง แล้วเติมค่าที่จำเป็น

~~~powershell
Copy-Item .env.example .env
~~~

2. ติดตั้ง dependency และเริ่ม MySQL

~~~powershell
npm ci
docker compose up -d
~~~

3. เปิด API และเว็บใน terminal แยกกัน

~~~powershell
npm run dev:api
npm run dev:web
~~~

โหมดสาธิตหน้าเว็บที่ไม่ใช้ API เปิดได้ด้วย VITE_DEMO_MODE=true ตามรายละเอียดใน
docs/development-guide.md

## คำสั่งตรวจสอบ

~~~powershell
npm run typecheck
npm run test:api
npm run test:web
npm run build
~~~

## โครงสร้างโฟลเดอร์

~~~text
.
├── api/                 Vercel HTTP entry
├── apps/api/            Express API, domain modules และ tests
├── apps/web/            React/Vite web app และ tests
├── db/                  migrations และ Supabase schema
├── docs/                requirements, runbooks, research และ reports
├── scripts/             งานตรวจสอบ/ปฏิบัติการที่ใช้ซ้ำ
├── .scratch/            local Markdown issue tracker
├── .agents/             skills ของ tooling
└── docker-compose.yml   MySQL สำหรับ local development
~~~

## อ่านต่อ

- [สารบัญเอกสาร](docs/README.md)
- [คู่มือการพัฒนาและรายละเอียดระบบฉบับเต็ม](docs/development-guide.md)
- [แนวทางการมีส่วนร่วม](CONTRIBUTING.md)
- [นโยบายความปลอดภัย](SECURITY.md)
- [คู่มือเตรียมค่า GitHub สำหรับเจ้าของ repo](docs/ops/github-repo-setup.md)
- [บริบทและ glossary ของระบบ](CONTEXT.md)

ไฟล์ LICENSE ยังไม่ได้เพิ่ม เพราะเจ้าของโครงการยังไม่ได้ตัดสินใจเรื่อง license
