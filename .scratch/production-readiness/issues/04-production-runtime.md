# 04: เตรียม production และ staging runtime

**What to build:** Web, API และ managed MySQL ที่แยก staging/production พร้อม HTTPS, secrets, readiness, health checks, metrics และ logs ที่ไม่รั่วข้อมูลส่วนบุคคล

**Blocked by:** 01: เลือก hosting และ managed MySQL สำหรับ production

**Status:** blocked

**Assignee:** Codex (repo-side production-readiness work)

## Comments

- 2026-09-22: Claimed for safe repository-side readiness only. Ticket 01 is resolved and recommends DigitalOcean App Platform + DigitalOcean Managed MySQL, but account, billing, region, DNS, secrets, access separation, and real staging/production verification remain external blockers.

- [x] บันทึก staging/production boundary และ Owner blockers สำหรับ DigitalOcean recommendation
- [ ] ตั้ง HTTPS, domains/callback base URLs และ environment-specific secrets ใน provider จริง
- [x] ตรวจจาก repo ว่า production runtime ใช้ MySQL จริงและไม่มี memory fallback
- [x] บันทึก health/readiness และ external dependency degradation ใน runbook
- [x] ตรวจ request ID, error taxonomy, metrics และ redacted-log contract ที่มีอยู่
- [x] บันทึกลำดับตรวจ deployment/rollback และ access separation โดยไม่สร้าง fake deployment files

## Answer

API มี `/api/health` (liveness), `/api/ready` (DB-backed readiness และ 503 เมื่อ DB ไม่พร้อม),
Owner-only `/api/metrics/summary`, request ID, error taxonomy และ redaction contract อยู่แล้ว
และ `createStoreFromEnv` fail-fast เมื่อไม่มี `DATABASE_URL`; production จึงยัง MySQL-only
และไม่มี memory fallback

เพิ่ม `docs/runbook/production-runtime-readiness.md` ตามคำแนะนำ Ticket 01: DigitalOcean App
Platform + DigitalOcean Managed MySQL โดยไม่สร้าง deployment manifest ที่ยืนยันไม่ได้

Ticket นี้ **blocked** ต่อ แม้ Ticket 01 จะ resolved เพราะยังไม่มี account/billing, region,
domains/DNS/TLS, real secrets, named access roles, backup/alert approvals หรือหลักฐาน staging/
production deployment และ rollback ที่ตรวจได้จาก repo

- 2026-09-22: Added the repo-side runtime runbook and preserved existing health/readiness/observability/MySQL-only behavior. Kept blocked pending Owner/provider infrastructure and real staging evidence.
