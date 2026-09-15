# 14: Release hardening (backup/recovery, security, observability, release E2E)

**What to build:** local-first release hardening ข้าม Tickets 01–13: backup/restore
runbook สำหรับ Memory/MySQL seams (RPO/RTO/retention assumptions), migration
rehearsal checklist, restore verification script/docs (ไม่รัน Docker/DB จริง);
security/PII review (role/access matrix ทุก endpoint, CSRF/session/cookie,
secret redaction, input limits, audit/error review, dependency/static checks ที่ทำได้);
observability (event/error taxonomy, correlation/request IDs, health/readiness,
metrics summary, no sensitive logs); fake/local release E2E (customer/staff/admin/owner
flows + duplicate reservation/payment/stock/points + responsive/keyboard/a11y
เท่าที่ทำได้โดยไม่ใช้เบราว์เซอร์จริง)

**Blocked by:** 01–13 (resolved ทั้งหมด)

**Status:** resolved

**Assignee:** executor (Muse Spark)

## Scope

อ้างอิง Spec D10 (คุณภาพ/ข้อมูล/backup/RPO/RTO), NFR-SEC-001–005, NFR-REL-001–003,
NFR-OBS-001, Definition of Done ระดับระบบข้อ 2/3/7/8 (`docs/REQUIREMENTS.md`),
User Story 51 และ AT21/AT22 ต่อยอด patterns เดิมแบบ in-memory deterministic
(Memory + MySQL seams คู่กัน — ไม่เปลี่ยน contract ธุรกิจใด ๆ)

- Backup/restore runbook เฉพาะ Memory/MySQL seams ปัจจุบัน (operator-executed;
  ยังไม่มีปุ่ม Owner ดาวน์โหลด/backup job อัตโนมัติในโค้ด — บันทึกเป็น deferred)
- Migration rehearsal checklist 001–014 + สคริปต์ตรวจ static (`exit 0` โดยไม่ต้องมี DB)
- Security review ครบทุก endpoint ตาม route definitions ปัจจุบัน (ไม่เพิ่ม auth model ใหม่)
- Observability แบบ additive เท่านั้น (เติม header/field/endpoint ใหม่ ไม่เปลี่ยน
  response เดิม): request ID, error `code`, `/api/ready`, `/api/metrics/summary` (Owner)
- Release E2E ด้วย MemoryStore + fake clock + HTTP seam + jsdom (ไม่ใช้ Docker,
  MySQL จริง, LINE/sandbox, provider credentials/network จริง, เบราว์เซอร์จริง/Taste)

ไม่รวม (deferred gates — ต้องมีก่อน production): Docker/MySQL runtime จริง,
TEST_DATABASE_URL integration, LINE Messaging/sandbox/webhook/LIFF จริง,
payment provider credentials/network จริง, backup automation endpoint/job,
dependency major upgrades, browser E2E จริง (Playwright/Taste — ไม่มี reference URL)

## Acceptance criteria

- [x] runbook สำรอง/กู้คืนระบุ RPO/RTO/retention + ขั้นตอน dump/restore/verify + ตาราง R1–R5 + แผนเมื่อ backup ล้มเหลว
- [x] migration checklist 001–014 + สคริปต์ `node scripts/verify-restore.mjs` exit 0 โดยไม่ต้องมี DB
- [x] role/access matrix ครบทุก endpoint + CSRF/session/cookie checks + redaction + input limits + audit/error review + dependency/static checks ที่ทำได้ในเครื่อง
- [x] request ID ทุก response + error taxonomy `code` (ไม่เปลี่ยนข้อความไทยเดิม) + `/api/ready` (503 เมื่อ DB ไม่พร้อม) + `/api/metrics/summary` (Owner เท่านั้น) + no sensitive logs
- [x] API release E2E (slice ข้ามบทบาท + จองชน/ชำระซ้ำ/cross-station guards + PII + audit taxonomy) และ Web release-readiness (skip/landmarks/labels/live + keyboard + touch ≥44px + responsive + focus/reduced-motion) ผ่าน
- [x] API/Web tests เต็ม, typecheck, build ผ่าน; ไม่แตะไฟล์ต้องห้าม; commit ข้อความตรงตามสั่ง

## Comments

### 2026-09-15 — เริ่ม Ticket 14 (claimed)

- ต่อจาก commit a462793 (Ticket 13 resolved); working tree มีไฟล์ค้างก่อนแล้ว
  (apps/api/package.json, package-lock.json, apps/api/.gitignore, generated/,
  prisma.config.ts, prisma/, src/db/, experiments/, __pycache__) — ห้ามแตะ/ห้าม commit
- อ่าน ui-ux-pro-max (priority 1/2/5 + pro-rules checklist) + frontend-design แล้ว;
  ใช้ design system เดิม ไม่เปลี่ยน visual (restraint) ตรวจเฉพาะ readiness; ไม่ทำ Taste
  เพราะไม่มี reference URL ภายนอก

### 2026-09-15 — ตรวจรับและปิด Ticket 14 (resolved)

- ผลตรวจ (exact):
  - API focused release 6/6 (`tests/release.test.ts`)
  - API full: 20 files passed / 9 skipped (29) → **239 passed, 29 skipped** (เดิม 233 + ใหม่ 6; MySQL int ข้าม — ไม่มี `TEST_DATABASE_URL`)
  - Web focused release-readiness 5/5 (`tests/release-readiness.test.tsx`)
  - Web full: 34 files → **190 passed** (เดิม 185 + ใหม่ 5)
  - `node scripts/verify-restore.mjs` → exit 0 (migrations 14/14 + docs + RPO/RTO + seams)
  - `npm run typecheck` (api+web): ผ่าน
  - `npm run build`: api tsc emit ผ่าน; web vite 75 modules ผ่าน
  - `npm audit --omit=dev`: 9 vulnerabilities (4 moderate, 5 high) — ไม่ fix (ต้อง major
    upgrade หรือแตะไฟล์ต้องห้าม; บันทึกใน `docs/SECURITY.md` ข้อ 7)
- สิ่งที่สร้าง: `apps/api/src/observability.ts` (request-id/error taxonomy/redaction/
  audit catalog), ต่อ `app.ts` (middleware + `/api/ready` + `/api/metrics/summary` +
  error `code` + auth/CSRF 403/401 มี `code`), `apps/api/tests/release.test.ts`,
  `apps/web/tests/release-readiness.test.tsx`, `docs/runbook/backup-restore.md`,
  `docs/runbook/migration-rehearsal.md`, `docs/SECURITY.md`, `docs/OBSERVABILITY.md`,
  `scripts/verify-restore.mjs`, README ส่วน Ticket 14, tracking Ticket 14
- ระหว่าง implement เจอและแก้: (1) error body ของ 409 จาก store (ConflictError) ได้ `code`
  ผ่าน central handler อัตโนมัติ แต่ auth/CSRF/role middleware ตอบ `{error}` ตรง ๆ —
  เติม `code` ให้ครบเพื่อ taxonomy คงที่; (2) web `?raw` CSS import คืนค่าว่างใน vitest —
  เปลี่ยนเป็น `readFileSync` ตรง; (3) App shell มี `main`/skip-link ซ้ำกับหน้าย่อย —
  assert แบบ some() แทน getBy ตัวเดียว; (4) Tailwind v4 breakpoints อยู่ใน utility classes
  ไม่ใช่ CSS — ตรวจบน DOM แทน
- ไม่แตะไฟล์ต้องห้าม (excluded จาก commit): `apps/api/package.json`, `package-lock.json`,
  `apps/api/.gitignore`, `apps/api/generated/`, `apps/api/prisma.config.ts`, `apps/api/prisma/`,
  `apps/api/src/db/`, `experiments/`, `__pycache__`; Tickets 01–13 ไม่ regression (full suites ข้างบน)
- Deferred (recorded, ไม่ทำให้ ticket ล้ม — ต้องมีก่อน production):
  MySQL/Docker runtime จริง + TEST_DATABASE_URL integration, LINE/sandbox/webhook/LIFF จริง,
  payment provider credentials/network จริง, backup automation (Owner download/job),
  dependency major upgrades (react-router-dom@7, prisma chain, mariadb),
  browser E2E จริง (Playwright/Taste), external storage/image upload
