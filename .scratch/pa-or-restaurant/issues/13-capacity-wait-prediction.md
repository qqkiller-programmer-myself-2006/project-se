# 13: Capacity และการพยากรณ์เวลารอ

**What to build:** local-first capacity + wait-time prediction: กฎกำลังผลิตจากคิว/สถานี/โต๊ะและสล็อตล่วงหน้า, baseline เวลารอแบบ deterministic (queue jobs + service rates + party size + งานช้าที่สุด), prediction adapter (model version/input-output metadata + timeout/error fallback เป็น baseline + ข้อความไม่ใช่เวลารับประกัน), เก็บ features สำหรับฝึกในอนาคต + เทียบความแม่นยำด้วย fixtures (no leakage), audit/observability, Dashboard Owner/Admin + สถานะลูกค้า (role isolation, loading/error/empty/success/focus/responsive)

**Blocked by:** 09 — คิวครัว/เครื่องดื่มและการส่งมอบ (resolved), 12 — LINE notifications และ reliability (resolved)

**Status:** resolved

**Assignee:** executor (Muse Spark)

## Scope

อ้างอิง Spec D05 (งานคิวและการส่งมอบ), D08 (Dashboard/เวลารอ), D09 (พยากรณ์), User Stories 32/34/46/52, AT10/AT11/AT18 และ FR ที่เกี่ยวข้อง ต่อยอด Store/repository, migration และ UI patterns เดิมแบบ in-memory deterministic (Memory + MySQL seams คู่กัน)

- Capacity rules จาก `station_capacity` ต่อช่วง 15 นาที (Ticket 09 seam) + งานคิว active ต่อฝ่าย + โต๊ะพร้อมใช้งาน/ว่าง (tables + rounds) + ตรวจสล็อตล่วงหน้า (preorder/reservation slot validation: เต็มเสนอช่วงถัดไปผ่าน `suggestNextSlot` เดิม)
- Baseline wait แบบ deterministic (pure): ต่อฝ่าย `wait = prep × (1 + queueAhead) + partyAdj` (prep = ครัว 15 / เครื่องดื่ม 5 นาที; partyAdj = +5 เมื่อ partySize > 4); ระดับคำสั่งซื้อ = งานช้าที่สุด (max ทุกฝ่าย) + `readyAtSlowest` + ช่วง `[wait, wait+5]` นาที
- Prediction adapter: `PredictionProvider` contract (`predict` คืน `waitMin + modelVersion`) + `FakePredictionProvider` (success/fail/timeout/latency) + `DisabledPredictionProvider` (fallback baseline ทันที); timeout race (default 500ms) + error ใด ๆ fallback baseline; metadata ทุกครั้ง (`source: baseline|model`, `modelVersion`, `predictedAt`, `timeoutMs`) + ข้อความไม่ใช่เวลารับประกัน (`เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน`)
- Feature capture ณ จุดพยากรณ์เท่านั้น (no leakage: ไม่มีข้อมูลอนาคต; ไม่มี PII ลูกค้า — ไม่มีชื่อ/เบอร์/LINE): station/qty ต่อฝ่าย, queueAhead/unitsAhead, partySize, hourOfDay/dayOfWeek (กรุงเทพ), isRemake/isPriority, slotKey; บันทึก actual เมื่อส่งมอบครบแล้วเทียบ MAE baseline vs model บนชุดเดียวกันก่อนเปิดใช้ (AT18)
- Owner/Admin: `GET /api/capacity/overview`, `PUT` capacity เดิม (Ticket 09), `GET /api/predictions/model` + `PUT` (version/enabled/threshold/timeoutMs), `GET /api/predictions/accuracy` (MAE เทียบ + fixtures), `GET /api/audit/predictions`; ลูกค้า/Guest: `GET /api/capacity/wait?orderId=` (เจ้าของเท่านั้น) + `POST /api/capacity/preorder-check` (ตรวจสล็อตล่วงหน้าสาธารณะแบบ rate-limit) + UI สถานะ
- UI ภาษาไทย: หน้า `CapacityDashboard` (Owner/Admin — ภาพรวมกำลังผลิต/เวลารอ/occupancy + โมเดล/accuracy + ตรวจสล็อต) และสถานะลูกค้าใน `QueueTrack` (ช่วงเวลารอ + หมายเหตุไม่รับประกัน) มี loading/error/empty/success/focus states, 44px targets, responsive ตาม design system เดิม (อ่าน ui-ux-pro-max + frontend-design แล้ว; ไม่ทำ Taste เพราะไม่มี reference URL)
- Migration `014_capacity_wait_predictions.sql` (rerunnable, เข้า `MIGRATION_FILES`)

ไม่รวม external ML provider/API key/Python training, MySQL/Docker runtime จริง, LINE/payment/storage จริง, browser E2E จริง (Playwright/Taste) ให้บันทึกไว้ใน tracking report

## Acceptance criteria

- [x] capacity overview รวมกำลังผลิต/งานค้าง/โต๊ะ/เวลารอ baseline ถูกต้อง (fake clock); preorder เต็มเสนอช่วงถัดไป
- [x] baseline wait ต่อฝ่าย/ต่อคำสั่งซื้อ (งานช้าที่สุด + readyAtSlowest + ช่วง) ถูกต้อง deterministic
- [x] adapter success ใช้ model + metadata; fail/timeout/disabled fallback baseline + source ชัดเจน + ข้อความไม่รับประกัน
- [x] feature capture ไม่มี PII/อนาคต; accuracy fixtures เทียบ MAE baseline vs model ได้; audit ครบ (requested/model_updated/completed/evaluated) ไม่มี secrets
- [x] Owner/Admin เท่านั้นเห็น overview/model/accuracy; customer/kitchen/drink/guest ถูกปฏิเสธที่ server ตามบทบาท; ลูกค้าเห็นเฉพาะคำสั่งซื้อตนเอง
- [x] MySQL migration รันซ้ำได้ + seams คู่ Memory/MySQL; API/Web tests, typecheck, build ผ่าน

## Comments

### 2026-09-15 — เริ่ม Ticket 13 (claimed)

- เริ่มหลัง Tickets 09/12 (ต้องมี queue jobs + capacity/slot seams + notify patterns เป็นฐาน)
- Baseline ก่อนโมเดลเสมอ (D05/D09): โมเดลต้องดีกว่า baseline บนชุดทดสอบเดียวกันก่อนเปิดใช้ (AT18); เกณฑ์ 500 งานยังไม่ครบ — เก็บ features สะสมก่อน ไม่เปิดโมเดลจริง
- ข้าม external services ตามนโยบาย และบันทึกไว้ใน tracking report
- ห้ามแตะไฟล์งานอื่นที่ค้างมาก่อน: `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated`, `apps/api/prisma.config.ts`, `apps/api/prisma`, `apps/api/src/db`, `experiments`, `__pycache__`
- UI: อ่าน .agents/skills/ui-ux-pro-max/SKILL.md (priority 1-10 + pro-rules checklist) + .agents/skills/frontend-design/SKILL.md แล้ว; ใช้ React/Tailwind stack เดิม (Panel/Alert/Badge/Spinner, 44px targets, aria-live, responsive 375/768/1024/1440); dashboard ใช้ navy #1E40AF / blue #3B82F6 / amber #D97706, slate bg #F8FAFC ตาม Ticket 11; ไม่ใช้ emoji icons; ไม่ทำ Taste (ไม่มี reference URL)

### 2026-09-15 — ตรวจรับและปิด Ticket 13 (resolved, implement โดย Muse Spark)

- ผลตรวจ (exact):
  - API focused capacity 7/7
  - API full 233 passed/29 skipped (เดิม 226 + ใหม่ 7; MySQL int ข้าม 29 — ไม่มี `TEST_DATABASE_URL`, รวมไฟล์ใหม่ capacity 7 ผ่าน)
  - Web focused capacity-dashboard 6/6
  - Web full 185 passed (เดิม 179 + ใหม่ 6)
  - API/Web typecheck passed
  - API tsc build passed
  - Vite build passed 75 modules (เดิม 74 + หน้า CapacityDashboard ใหม่)
- ไม่แตะไฟล์งานอื่นที่ค้างมาก่อน (excluded จาก commit ตาม ticket):
  `apps/api/package.json`, `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`, `experiments/`,
  `__pycache__`; Tickets 01–12 ไม่ regression (full suites ข้างบน)
- สิ่งที่สร้าง: types (PredictionSource/CapacityOverview/WaitEstimate/PreorderSlotCheck/PredictionModel/Feature/Accuracy + audit actions prediction_*),
  `apps/api/src/predict/{validation,adapter,audit-events}.ts`,
  Store seams (memory + MySQL) + `db/migrations/014_capacity_wait_predictions.sql`,
  `apps/api/src/routes/capacity.ts` + wiring app.ts (+ predictor injection),
  Web `CapacityDashboard` + ต่อเวลารอใน `QueueTrack` + api client + nav/routes, tests API/Web
- ระหว่าง implement เจอและแก้: (1) preorder slot นับจาก readyAt = scheduledAt − prep (ตกช่วงก่อนหน้าเสมอ)
  — เทสต์จองด้วย scheduledAt = จุดเริ่มช่วง + 15 นาที แล้วตรวจช่วงเดียวกัน; (2) feature keys มี
  `baselineMin` ตรง regex PII หยาบ (`line` ใน baseline) — เปลี่ยนเป็น assert รายคีย์ต้องห้ามตรงตัว;
  (3) web datetime-local + POST CSRF ต้อง stub `/api/auth/csrf` ในเทสต์; (4) label `ฝ่ายงาน` ซ้ำสองฟอร์ม —
  แยกเป็น `ฝ่ายงาน (ประมาณเวลา)` / `ฝ่ายงาน (ตรวจสล็อต)`; (5) `listAudit` prefix type เพิ่ม `prediction_`
- งานที่ข้าม (บันทึกตาม ticket — ไม่ทำให้ ticket ล้ม):
  MySQL runtime จริง (มี migration + seams แล้ว แต่ไม่มี `TEST_DATABASE_URL`),
  external ML provider/API key/Python training (D09 — provider/วิธีฝึกยังไม่เลือก; เกณฑ์ 500 งานยังไม่ครบ
  เก็บ features สะสมก่อน ไม่เปิดโมเดลจริง), Docker/MySQL runtime,
  LINE/payment/storage จริง, browser E2E จริง (Playwright/Taste — ไม่มี reference URL ภายนอก)
- ไม่รวมตาม scope (งาน ticket ถัดไป):
  backup/security/observability/release E2E (14)
