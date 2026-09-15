# 12: LINE notifications และ reliability (outbox + retry + web fallback)

**What to build:** local-first LINE notification outbox ที่ map จาก business events (reservation/payment/queue/loyalty) พร้อม consent/recipient checks, exactly-once dedupe ด้วย event key, retry/backoff/dead-letter, fake LINE messaging provider + contract adapter, Thai templates (จอง/ชำระ/คิว/คะแนน + เตือนก่อน 30 นาทีด้วย fake scheduler/clock), Admin/Owner APIs + UI ดูสถานะ/retry/dead-letter/manual retry พร้อม audit, web fallback ให้ลูกค้าดูข้อความในเว็บเมื่อ OA ส่งไม่สำเร็จ

**Blocked by:** 03 — บัญชีลูกค้าและการเชื่อม LINE (claimed แต่มี line-link seam พร้อมใช้), 06 — การจอง (resolved), 08 — การชำระ (resolved), 09 — คิว (resolved), 10 — คะแนน (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark)

## Scope

อ้างอิง Spec D08 (การเงิน รายงานและข้อความ), User Story 50 และ AT15 ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- Outbox: `notifications` (event_key unique, kind, customer/order/reservation/payment refs, message ภาษาไทย, status pending/sending/sent/failed/dead_letter/skipped, attempts/maxAttempts, nextRetryAt, lastError ที่ sanitize แล้ว, sentAt)
- Event mapping (pure): reservation_created/cancelled, reservation_reminder (30 นาที — scheduler seam กวาดการจอง pending/confirmed ในหน้าต่างเวลานัด), payment_paid/manual_review, order_ready (รวมครบทุก job เป็นเหตุการณ์เดียว), order_delivered (ครบ), loyalty_earned/redeemed — eventKey แบบ `kind:refId` ทำให้เรียกซ้ำเป็น no-op
- Consent/recipient checks ตอน flush (ส่งจริง): ลูกค้าต้องมีอยู่ + active + ไม่ถูกลบ + เปิด consent (default เปิด, opt-out ได้) + มี LINE link; ไม่ผ่าน → skipped (web fallback ยังอ่านข้อความของตนเองในเว็บได้) — ความล้มเหลวทุกกรณีไม่ rollback business transaction (enqueue/flush อยู่ใน try/catch แยกจาก business commit)
- Retry/backoff/dead-letter: backoff 1/5/15/30 นาทีตาม attempt, ครบ 5 ครั้ง → dead_letter + audit; manual retry (Admin/Owner) รีเซ็ตเป็น pending + audit; timeout ของ provider ถือเป็น retryable
- Provider: `LineMessagingProvider` contract (`sendPush`) + `FakeLineMessagingProvider` (ตั้งพฤติกรรม success/fail/timeout + บันทึก calls) + `DisabledLineMessagingProvider` (503 fail-fast เมื่อยังไม่ตั้งค่า); ห้าม log secrets/tokens (message/error เก็บเฉพาะข้อความไทยย่อ + sanitized error ≤500 อักษร)
- Admin/Owner APIs: list (กรอง status/kind) + get + retry + run-outbox flush + run-reminders + consent set/get; ลูกค้าดูของตนเอง (`/api/notifications/mine`) เป็น web fallback
- Hooks: หลัง reservation สร้าง/ยกเลิก, payment paid/manual_review, queue ready/delivered ครบ, loyalty earn/redeem — best-effort enqueue (catch แล้วกลืน ไม่ทำให้ request หลักล้ม)
- UI ภาษาไทย: หน้า Admin (`AdminNotifications` — ตารางสถานะ + retry + dead-letter + ปุ่ม flush/reminders + consent toggle) และหน้าลูกค้า (`MyNotifications` — web fallback) มี loading/error/empty/success/focus states, 44px targets, responsive ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL)
- Migration `013_line_notifications.sql` (rerunnable, เข้า `MIGRATION_FILES`)

ไม่รวม LINE Messaging API จริง/credentials/sandbox/webhook/LIFF, MySQL/Docker runtime จริง, external payment/storage, browser E2E จริง (Playwright/Taste) ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] enqueue จาก business events ครบชนิด + dedupe ด้วย eventKey (เรียกซ้ำไม่เพิ่มแถว/audit)
- [x] flush ส่งผ่าน fake provider สำเร็จ → sent; fail/timeout → failed + backoff; ครบ max → dead_letter; manual retry กลับมา pending + audit
- [x] ไม่มี consent/LINE link/ลูกค้าไม่ valid → skipped; ลูกค้ายังอ่านข้อความของตนเองในเว็บได้ (web fallback)
- [x] ความล้มเหลวของ notify ไม่ทำให้ business request ล้ม (reservation/payment/queue/loyalty เดิมผ่าน)
- [x] reminder 30 นาที enqueue ได้ด้วย fake clock (กวาดหน้าต่างเวลานัด, ซ้ำเป็น no-op)
- [x] Admin/Owner เท่านั้นที่เห็นทั้งหมด/retry/flush; customer/kitchen/drink/guest ถูกปฏิเสธที่ server; audit ครบ (queued/sent/failed/dead_letter/retried/skipped) ไม่มี secrets
- [x] MySQL migration รันซ้ำได้ + seams คู่ Memory/MySQL; API/Web tests, typecheck, build ผ่าน

## Comments

### 2026-09-15 — เริ่ม Ticket 12 (claimed)

- เริ่มหลัง Tickets 03/06/08/09/10 (ต้องมี line-link + reservation + payment + queue + loyalty เป็นฐาน)
- Outbox แยกจาก business commit เสมอ: enqueue best-effort หลัง success, flush แยกต่างหาก — LINE ล้มเหลวไม่ยกเลิกงาน (AT15)
- ข้อความพร้อมรับ/ครบรวมเป็นเหตุการณ์เดียวต่อคำสั่งซื้อ (ลดซ้ำตาม D08)
- ข้าม external services ตามนโยบาย และบันทึกไว้ใน tracking report

### 2026-09-15 — ตรวจรับและปิด Ticket 12 (resolved, implement โดย Muse Spark)

- ผลตรวจ (exact):
  - API focused notifications 11/11
  - API full 226 passed/29 skipped (เดิม 215 + ใหม่ 11; MySQL int ข้าม 29 — ไม่มี `TEST_DATABASE_URL`, รวมไฟล์ใหม่ 2 skipped)
  - Web focused notifications 6/6
  - Web full 179 passed (เดิม 173 + ใหม่ 6)
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 74 modules (เดิม 72 + 2 หน้าใหม่)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–11 ไม่ regression (full suites ข้างบน)
- สิ่งที่สร้าง: types (NotificationKind/Status/Notification + audit actions notification_*),
  `apps/api/src/notify/{validation,templates,messaging,events,audit-events}.ts`,
  Store seams (memory + MySQL) + `db/migrations/013_line_notifications.sql`,
  `apps/api/src/routes/notifications.ts` + wiring app.ts (+ hooks ใน reservations/payments/queue/loyalty),
  Web `AdminNotifications`/`MyNotifications` + api client + nav/routes, tests API/Web
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  LINE Messaging API/credentials/sandbox/webhook/LIFF จริง, Docker/MySQL runtime,
  external payment/storage, browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป): capacity/พยากรณ์โมเดลเต็ม (13),
  backup/security/observability/release E2E (14)
- Deferred ใน ticket นี้: แจ้งเตือน auto-earn จากเครื่องดื่มที่ส่งมอบ (คะแนนจากคำสั่งซื้อที่เกิดใน
  store-internal auto-earn ไม่มี route seam — ครอบคลุม loyalty_earned ผ่าน walk-in/guest-link
  และ loyalty_redeemed ผ่าน consume แล้ว; จะตามในงานปรับปรุงเมื่อมี loyalty outbox เต็มรูป)
