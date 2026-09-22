# 03: ยืนยัน LINE channels และ production credentials

**What to build:** แผนและข้อยืนยันสำหรับ LINE Login, LIFF และ Official Account ใน dev, staging และ production โดยใช้ provider/channel ที่เชื่อมกันได้และ callback ที่ปลอดภัย

**Blocked by:** None (can start immediately)

**Status:** blocked

**Assignee:** Codex (repo-side production-readiness work)

## Comments

- 2026-09-22: Claimed for safe repository-side readiness only. External LINE Console/provider setup, verified identities, real credentials, and staging/production smoke tests remain Owner/provider work.

- [x] บันทึก provider/channel matrix และ callback constraints ใน `docs/runbook/line-production-channels.md`
- [x] บันทึกการแยก channel, credentials และ callback URL ของ dev/staging/production
- [ ] ยืนยันข้อกำหนด HTTPS, allowlist, tester และการ Published production channel จาก LINE Console
- [ ] ตรวจ flow Login, link account, notification และ deauthorization ด้วย credentials จริง
- [x] ระบุ credentials และการอนุมัติที่ต้องได้รับจาก Owner ใน runbook
- [x] บันทึกคำตอบในหัวข้อ `## Answer`

## Answer

ทำ repo-side readiness แล้ว: `.env.example` แยกกติกา development/staging/production และ
`docs/runbook/line-production-channels.md` ระบุ matrix, exact callback matching,
HTTPS/allowlist, verified identity, notification/deauthorization acceptance และ Owner inputs
โดยไม่มี secret จริง

สิ่งที่ยังยืนยันไม่ได้ใน repoคือ channel/provider จริง, channel access token, HTTPS domains,
allowlist, tester/verified identity, Published production channel และ staging smoke tests.
Ticket นี้จึง **blocked** จน Owner จัดเตรียม external inputs เหล่านี้

- 2026-09-22: Added the repo-side runbook and `.env.example` environment contract. Kept blocked because provider setup, real credentials, HTTPS allowlist and staging evidence are not available in the repository.
