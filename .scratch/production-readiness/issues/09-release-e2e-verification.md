# 09: ตรวจ release แบบ end-to-end

**What to build:** หลักฐานจาก staging ว่า flow หลักตั้งแต่ LINE/เว็บ จอง สั่ง จ่าย คิว ส่งมอบ ใบเสร็จ และรายงานทำงานร่วมกันจริงทั้ง happy path และ failure path สำคัญ

**Blocked by:** 05: ซ้อม MySQL migration และ integration จริง; 06: เชื่อม payment production และ SlipOK fallback; 07: เปิดใช้ LINE Login/LIFF และ notification จริง; 08: ทำ backup, restore และ rollback rehearsal

**Status:** ready-for-agent

- [ ] ทดสอบ customer, staff, Admin และ Owner flows ด้วย browser E2E บน staging
- [ ] ตรวจ payment success/declined/timeout, duplicate webhook, refund และ fallback review
- [ ] ตรวจ LINE login/link/notification failure และเว็บ fallback
- [ ] ตรวจ reservation/order/queue/delivery/receipt/finance event เกิดครบและไม่ซ้ำ
- [ ] ตรวจ duplicate submit, retry และ late external response
- [ ] สรุป release evidence และรายการ incident ที่ต้องแก้ก่อน pilot

## Comments

- 2026-09-25: Web/API regression evidence collected: API tests 280 passed, web tests 340 passed, root production build passed after fixing the workspace Vite command, and UI smoke covered 13 public plus 19 protected routes without 500, Failed to fetch, or browser console errors.
- 2026-09-25: This issue remains open because the browser flow has not yet been run against an isolated staging database with real MySQL integration tests enabled, and production payment/LINE/backup prerequisites remain blocked by issues 06–08.
- 2026-09-27: Since the comment above, production actually went live on Vercel + Supabase
  (see Ticket 01/04/05 2026-09-27 comments) — this is real end-to-end evidence, just not
  the staging rehearsal this ticket asked for. Confirmed working live via Vercel's own
  tools this session: `/api/menu/public` and `/api/shop/status` on
  `project-se-rose.vercel.app` both return real Supabase data. Also found and fixed (PR
  #29, merged) six UI/3D bugs found through direct browser QA: a Vite `import.meta.env`
  access bug that silently broke the demo/offline fallback, a WebGL tainted-canvas error
  that blocked the menu photo textures, and a table-pin z-index bug that could paint over
  the fixed reservation bar — none of these would have been visible from the API/unit test
  suites this ticket's evidence relies on, which is worth noting for how much this
  ticket's checklist should trust green tests alone.
  - Still not done, and still this ticket's actual scope: no browser E2E has been run
    against an **isolated** staging Supabase project separate from the production one
    (`fvdyeblfpeyuqwgtbgzr`) — the checks above hit production directly, which is evidence
    of "it works," not a safe rehearsal environment. Payment/LINE/backup prerequisites
    (06–08) are still unaddressed; those ticket files do not even exist yet in
    `.scratch/production-readiness/issues/`.
