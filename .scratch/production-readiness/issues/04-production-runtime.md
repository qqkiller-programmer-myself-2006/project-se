# 04: เตรียม production และ staging runtime

**What to build:** Web, API และ managed MySQL ที่แยก staging/production พร้อม HTTPS, secrets, readiness, health checks, metrics และ logs ที่ไม่รั่วข้อมูลส่วนบุคคล

**Blocked by:** 01: เลือก hosting และ managed MySQL สำหรับ production

**Status:** in-progress (production live on a different stack than the recommendation — see 2026-09-27 comment)

**Assignee:** Codex (repo-side production-readiness work); Claude Code executor (2026-09-27 deploy fixes)

## Comments

- 2026-09-22: Claimed for safe repository-side readiness only. Ticket 01 is resolved and recommends DigitalOcean App Platform + DigitalOcean Managed MySQL, but account, billing, region, DNS, secrets, access separation, and real staging/production verification remain external blockers.

- 2026-09-27: **The blocker in this comment is stale.** Owner already deployed to **Vercel +
  Supabase Managed PostgreSQL** (see Ticket 01 comment 2026-09-25/27 for evidence), not
  DigitalOcean. Production is live and verified working through Vercel's own tools:
  `project-se-rose.vercel.app` serves the menu/shop-status API with real Supabase data
  (`x-menu-source: db`). So the "account/billing/region" blockers from Ticket 01 are
  resolved *for this stack*, just not the one this ticket originally planned around.
  - Found and fixed two runtime bugs in this pass (PR #30,
    `claude/ui-ux-3d-model-bugs-txer1d`): (1) the serverless function ran in `iad1` while
    Supabase is in `ap-southeast-1` on some deployments — pinned `regions: ["sin1"]` in
    `vercel.json` so every deployment runs next to the database; (2) when the API answers
    `503 {"error":"service_unavailable"}` (DB unreachable at cold start — this is what
    every **Preview** deployment does right now, since Preview has no `DATABASE_URL`),
    the web client showed the raw JSON error code — now shows a Thai message instead.
  - Still open / not yet verified from the repo: `DATABASE_URL` (and other prod-only env
    vars like `SKIP_BOOT_MIGRATIONS`) are not set for the **Preview** environment in
    Vercel, so every PR preview 503s on every API call — confirmed live on PR #30's own
    preview URL. No Supabase backup/PITR policy or restore rehearsal has been recorded for
    this stack (Ticket 05/08 assumed MySQL). No custom domain — production is still on the
    `*.vercel.app` default domain (`project-se-rose.vercel.app`), so the domain/DNS/TLS
    item from Ticket 01 §4.1 is unaddressed for this stack too.
  - GitHub issues opened for the still-open items: #32 (DATABASE_URL missing on
    Preview), #38 (custom domain/DNS/TLS).
  - Could not read Vercel project environment variables this session (`403 forbidden` —
    the connected Vercel account lacks that permission), so I could not add/confirm
    `DATABASE_URL` for Preview myself; that needs Owner action in the Vercel dashboard.

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
