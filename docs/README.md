# สารบัญเอกสาร

เอกสารชุดนี้แบ่งตามคำถามที่ผู้อ่านต้องการตอบ เริ่มจากคู่มือฉบับเต็มหากต้องการ
เข้าใจ flow เดิม หรือเลือกเอกสารตามบทบาทด้านล่าง

## จุดเริ่มต้น

| เอกสาร | เหมาะสำหรับ | เนื้อหา |
| --- | --- | --- |
| [คู่มือการพัฒนา](development-guide.md) | ผู้พัฒนาใหม่และผู้ดูแลระบบ | architecture, quick start, API contract, tests และข้อจำกัดเดิมทั้งหมด |
| [Requirements](REQUIREMENTS.md) | ผู้วางแผนงานและผู้ตรวจรับ | ข้อกำหนดและ acceptance baseline ของระบบ |
| [Real Report](reports/Real_Report.docx) | ผู้ดู requirement ต้นทาง | เอกสารรายงานต้นฉบับจากโครงการ |
| [CONTEXT.md](../CONTEXT.md) | ทุกคนที่เขียน spec หรือ code | glossary และคำศัพท์โดเมนที่ต้องใช้ร่วมกัน |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | ผู้ส่ง change | branch, commit, PR และคำสั่งตรวจสอบ |

## เอกสารตามหน้าที่

### Security และ operations

- [SECURITY.md](SECURITY.md) — role/access matrix, session, CSRF, secrets และแนวทาง
  ป้องกันข้อมูลส่วนบุคคล
- [OBSERVABILITY.md](OBSERVABILITY.md) — health/readiness, request ID, error catalog,
  metrics และ logging
- [runbook/](runbook/) — ขั้นตอนที่ operator ใช้จริง:
  [backup-restore](runbook/backup-restore.md),
  [migration-rehearsal](runbook/migration-rehearsal.md),
  [LINE production channels](runbook/line-production-channels.md),
  [production runtime readiness](runbook/production-runtime-readiness.md) และ
  [integration test กับฐานข้อมูลจริง](runbook/integration-db-tests.md)
- [ops/github-repo-setup.md](ops/github-repo-setup.md) — checklist และคำสั่ง gh
  สำหรับเจ้าของ repo; ยังไม่ได้รัน remote cleanup จากเครื่องนี้

### Engineering context

- [agents/domain.md](agents/domain.md) — กติกาการอ่าน CONTEXT.md และ ADR
- [agents/issue-tracker.md](agents/issue-tracker.md) — รูปแบบ local Markdown tracker
  ใน .scratch/
- [research/](research/) — ผลการค้นคว้าที่ใช้ตัดสินใจ เช่น
  [LINE login integration](research/line-login-integration.md) และ
  [payment verification API](research/payment-verification-api.md)
- [menu-seed.md](menu-seed.md) — วิธี seed เมนูและข้อควรระวังเรื่อง asset

## กติกาการดูแลเอกสาร

- ข้อตกลงโดเมนใช้คำตาม CONTEXT.md
- ข้อกำหนดเชิงพฤติกรรมให้ดู REQUIREMENTS.md และ ticket ใน .scratch/
- ขั้นตอนปฏิบัติการ production ให้ดู runbook ก่อนคำสั่งใน source
- เอกสารใหม่ควรเพิ่มลิงก์ในสารบัญนี้ทันที
- ปัจจุบันยังไม่มี docs/adr/ เพราะยังไม่มี decision ที่ต้องเพิ่ม ADR
