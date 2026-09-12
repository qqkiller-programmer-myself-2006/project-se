# 01: บัญชี Owner และพนักงาน

**What to build:** ระบบเริ่มต้นที่ Owner เข้าสู่ระบบเพื่อสร้าง ปิด และกำหนดหลายบทบาทแก่พนักงาน พนักงานเข้าระบบและเปลี่ยนรหัสผ่านตนเองได้ Owner ตรวจประวัติการเข้าสู่ระบบและการแก้บัญชีได้ผ่านหน้าจอภาษาไทย

**Blocked by:** None (can start immediately).

**Status:** claimed

**Assignee:** opencode-executor ผ่าน Codex

## Scope

อ้างอิง Spec ร้านป้าอ้อ D01/D10 และ User Stories 48–49 การเริ่ม implementation ครั้งนี้ครอบคลุมงานแรกจากรายการที่เสนอเท่านั้น ทดสอบพฤติกรรมผ่าน application API และ UI ตามแนวใน Spec ใช้ React/Tailwind, Node/Express และ MySQL ตั้งต้นเป็นโครงการที่รันซ้ำได้

## Acceptance criteria

- [x] ตั้ง Owner เริ่มต้นผ่านขั้นตอนในเครื่องที่ชัดเจน ไม่มีรหัสผ่านตั้งต้นฝังในโค้ด และไม่เปิดให้สมัคร Owner ซ้ำจากเว็บสาธารณะ
- [x] เข้าระบบ ออกจากระบบ และตรวจผู้ใช้งานปัจจุบันได้ด้วย session ที่ปลอดภัย
- [x] Owner สร้าง ปิดบัญชี และกำหนดหลายบทบาทแก่พนักงานผ่าน UI/API ได้
- [x] พนักงานเปลี่ยนรหัสผ่านตนเองได้ Owner รีเซ็ตได้ session เดิมใช้ไม่ได้หลัง reset หรือปิดบัญชี
- [x] ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ ป้องกันพนักงานเปลี่ยนบทบาทตนเองและ Admin แก้ Owner
- [x] เก็บ password hash จำกัดการลองเข้าสู่ระบบ และไม่ส่งรหัสผ่านหรือ secret ลง log/response
- [x] Owner ตรวจ audit login สำเร็จ/ล้มเหลวและการเปลี่ยนบัญชี/บทบาทได้
- [ ] UI ภาษาไทยใช้งานบนมือถือและคอมพิวเตอร์ได้ มีข้อความผิดพลาดและ label
- [x] มีวิธีตั้งค่าและเริ่มระบบ ตัวอย่าง environment ไม่มี secret จริง
- [x] มีผลตรวจ public API สำหรับสิทธิ์และ session และผล typecheck/build/test พร้อมระบุข้อจำกัดจริง

## Comments

ผู้ใช้เรียก /implement หลังเสนอรายการงาน จึงเริ่มงานไม่มี blockers เป็นลำดับแรก Codex ตรวจ diff และผลทดสอบก่อนปิดงาน; โฟลเดอร์เริ่มต้นยังไม่มี Git repository

## Verification (2026-09-12)

- API tests: ผ่าน 30 รายการ; Web tests: ผ่าน 13 รายการ
- หลังปรับ UI/UX: Web tests ผ่าน 22 รายการ
- API/Web typecheck และ production build: ผ่าน
- MySQL integration: ยังไม่ได้รัน (ขณะตรวจไม่มี `TEST_DATABASE_URL`, Docker หรือ MySQL)
- `npm audit --omit=dev`: ยังพบช่องโหว่ระดับ moderate ใน dependency ฝั่ง production 3 รายการ จึงยังไม่ได้สั่งแก้อัตโนมัติที่อาจเปลี่ยน major version
- Responsive browser QA: ยังไม่ได้ตรวจด้วย browser จริง
- แก้ production start path ให้ชี้ `dist/src/index.js` และแก้การลบ session cookie ให้ attributes ตรงกับ cookie ที่สร้าง
- ใช้ Product Design audit/polish workflow ปรับ design system, responsive shell, keyboard focus, loading/error/empty states และ Thai accessibility labels ในหน้า Login, Staff, Change Password และ Audit

สถานะยังเป็น `claimed` และยังไม่ควรเปลี่ยนเป็น `resolved` จนกว่าจะตรวจ MySQL integration, dependency decision และ responsive browser QA เพิ่มเติม

## Verification (2026-09-12, รอบตรวจซ้ำ — ยังไม่ resolved)

- API tests: ผ่าน 30 รายการ (26 public HTTP + 4 env/start-path; เพิ่ม test start-path และ logout cookie), Web tests: ผ่าน 13 รายการ
- API/Web typecheck และ production build (`npm run typecheck`, `npm run build`): ผ่าน
- แก้บั๊กจริง 2 จุด: `apps/api/package.json` start `node dist/index.js` → `node dist/src/index.js` (ตรง tsc output + Dockerfile CMD; ยืนยัน `node dist/src/index.js` โหลดได้แล้ว fail ด้วย DATABASE_URL ตามคาด ไม่ใช่ MODULE_NOT_FOUND) และ `clearCookie` ตอน logout/change-password ให้ส่ง `Path=/, SameSite=Lax, Secure` ตรงกับตอนตั้งคุกกี้ (กันลบไม่หลุดบน HTTPS)
- MySQL integration: SKIP ชัดเจน (`1 file skipped / 6 tests skipped` — ไม่มี `TEST_DATABASE_URL`, Docker หรือ MySQL ในเครื่องนี้) ไม่นับว่าผ่าน
- `npm audit --omit=dev`: ยังพบ moderate 3 รายการ (qs ผ่าน express, react-router 6→7 ต้อง major bump) จึงไม่สั่ง `audit fix`/`--force` ตามข้อห้าม major upgrade เสี่ยง
- Responsive browser QA: ยังไม่ได้ตรวจด้วย browser จริง (UI มี layout มือถือ/คอมพิวเตอร์ + label/error ครบ แต่ต้องตรวจบน browser จริงก่อนปิดงาน)

สถานะคง `claimed` — ห้ามเปลี่ยนเป็น `resolved` จนกว่าจะมี MySQL integration บนเครื่องที่มี Docker/MySQL และ browser responsive QA จริง

## Verification (2026-09-12, UI/UX polish — ยังไม่ resolved)

- ขอบเขต: แตะเฉพาะ `apps/web` (+ tests) ไม่เปลี่ยน API contracts และไม่เพิ่มสมัคร Owner สาธารณะ
- Web tests: ผ่าน 22 รายการ (เดิม 13 + ใหม่ 9: login inline validation/loading, staff empty/badge/checkbox/reset, audit empty/error/result-filter, app skip-link/aria-current/user-context)
- `npm run typecheck` (api+web) และ `npm run build`: ผ่าน
- MySQL integration / browser responsive QA จริง: ยังไม่ได้ทำเช่นเดิม สถานะคง `claimed`

## Verification (2026-09-12, duplicate roles fix — ยังไม่ resolved)

- ขอบเขต: แตะเฉพาะ `apps/api/src/app.ts` (rolesSchema), `apps/api/src/store.ts` (normalize/defensive), `apps/api/tests/accounts.test.ts` และ verification comments ของ Ticket 01 เท่านั้น ไม่เปลี่ยน API contracts อื่น
- แก้ไข: `rolesSchema` เพิ่ม `.refine` ปฏิเสธบทบาทซ้ำ (`['kitchen','kitchen']` ได้ HTTP 400 `ห้ามกำหนดบทบาทซ้ำกัน`) ใช้ร่วมกันทั้ง POST `/api/users` และ PATCH `/api/users/:id/roles`; ข้อห้ามบทบาท Owner เดิม (403) ยังทำงานตามเดิม
- Persistence: เพิ่ม `normalizeRoles` ใช้ตอนเขียน memory/MySQL (`createUser`/`createFirstOwner`/`updateUser`) และ `parseRoles` normalize ข้อมูลเก่าที่มีค่าซ้ำตอนอ่าน ไม่เปลี่ยน contract ภายนอก
- Tests ใหม่ 3 รายการ: ปฏิเสธบทบาทซ้ำตอนสร้าง (400) + ยอมรับหลายบทบาทไม่ซ้ำ + ยืนยัน Owner-restriction เดิมยัง 403; ปฏิเสธบทบาทซ้ำตอนอัปเดต (400) + ยอมรับหลายบทบาทไม่ซ้ำ; persistence normalize ระดับ store
- ผลรันจริง: `npm run test:api` ผ่าน 33 รายการ + ข้าม MySQL 6 รายการ (ไม่มี `TEST_DATABASE_URL`), `npm run test:web` ผ่าน 22 รายการ, `npm run typecheck` ผ่าน, `npm run build` ผ่าน
- MySQL integration จริง: ยังไม่ได้รัน (ไม่มี `TEST_DATABASE_URL`/Docker/MySQL ในเครื่องนี้) ไม่นับว่าผ่าน
- Responsive browser QA จริง: ยังไม่ได้ตรวจด้วย browser จริง

สถานะคง `claimed` — ห้ามเปลี่ยนเป็น `resolved` จนกว่าจะมี MySQL integration บนเครื่องที่มี Docker/MySQL และ browser responsive QA จริง
