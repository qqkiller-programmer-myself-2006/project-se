# 05: ซ้อม MySQL migration และ integration จริง

**What to build:** หลักฐานว่า migration และ transaction behavior ของระบบทำงานบน MySQL จริงใน staging-like environment และพร้อมใช้เป็นฐานข้อมูล production

**Blocked by:** 01: เลือก hosting และ managed MySQL สำหรับ production; 04: เตรียม production และ staging runtime

**Status:** ready-for-agent

- [ ] รัน migration ทั้งหมดบน MySQL จริงและตรวจการ rerun ที่ควรปลอดภัย
- [ ] รัน MySQL integration tests โดยไม่ถือ skipped tests เป็น passed
- [ ] ตรวจ transaction rollback, constraints, uniqueness และ concurrent behavior ของ reservation/order/payment
- [ ] ตรวจ schema/data ที่จำเป็นต่อ queue, finance, notification และ audit
- [ ] บันทึกหลักฐานผลทดสอบและข้อจำกัดที่ยังต้องแก้ก่อน production

## Comments

- 2026-09-25: Local API connected successfully to MySQL database `paor` through the Tailscale database host. Read-only checks for health, public menu, shop status, and reservation availability returned 200.
- 2026-09-25: API suite passed 280 tests; 30 real-MySQL integration tests remain skipped because `TEST_DATABASE_URL` is not configured with an isolated test database. Production `DATABASE_URL` must not be reused for this ticket.
- 2026-09-25: `shop_tables` currently contains 0 rows on the connected database. Table fixtures/data must be provided before marking schema/data readiness complete.
- 2026-09-27: **This ticket's title and checklist target the wrong database.** The same day
  as the comment above (2026-09-25, commit `4923db8`), the repo also shipped
  `db/supabase/*.sql` + `apps/api/src/pg-compat.ts`, and production is now running on
  **Supabase PostgreSQL** via Vercel, not the Tailscale MySQL host this ticket rehearsed
  against (see Ticket 01/04 2026-09-27 comments). Verified from Supabase directly
  (`execute_sql` via MCP, project `fvdyeblfpeyuqwgtbgzr`): all 39 tables from
  `db/supabase/001`–`016` exist and are populated (`menu_items`: 38 rows, `shop_tables`:
  3 rows, `shop_schedule`: 7 rows, etc.) — so the MySQL-era finding above ("`shop_tables`
  has 0 rows") no longer describes the live database.
  - None of this ticket's checklist items have been re-run against Postgres/Supabase:
    rerun-safety of `db/supabase/*.sql`, `pg_try_advisory_lock` session-mode-lock behavior
    (`pg-compat.ts` requires Supavisor **session mode** port 5432, not transaction mode
    6543 — not verified which mode Supabase is configured for in production), and
    transaction/constraint/concurrency behavior for reservation/order/payment under
    Postgres are all unverified.
  - Recommend either retitling/rescoping this ticket to Postgres+Supabase, or opening a
    new ticket for it and marking this one superseded — the MySQL path (`pg-compat.ts`'s
    own comment calls it "a temporary route") may not be the one that ships.
