# 03: บัญชีลูกค้าและการเชื่อม LINE

**What to build:** ระบบบัญชีลูกค้าแยกจากบัญชีพนักงาน ลูกค้าสมัครและเข้าสู่ระบบผ่านเว็บ จัดการข้อมูลของตน เชื่อม/ยกเลิกการเชื่อม LINE อย่างปลอดภัย และขอลบบัญชีได้ ขณะที่ Admin/Owner ค้นหา ดู และเปลี่ยนสถานะบัญชีลูกค้าโดยมี audit

**Blocked by:** None (ใช้ infrastructure session/audit จาก Ticket 01 แต่เป็น module และตารางแยก)

**Status:** claimed

**Assignee:** opencode-executor ผ่าน Codex

## Scope

อ้างอิง Spec D01, User Stories 2, 5 และ FR-AUTH-001–004 บัญชีลูกค้าเป็นคนละชนิดกับบัญชีพนักงานและใช้ชื่อ/เบอร์โทรเป็นข้อมูลหลัก อีเมล optional ลูกค้าหนึ่งบัญชีเชื่อม LINE ได้หนึ่งบัญชี และ LINE user ID หนึ่งค่าเชื่อมได้กับลูกค้าหนึ่งบัญชีเท่านั้น

Ticket นี้สร้าง identity seam สำหรับการจอง/คะแนนในภายหลัง แต่ยังไม่รวม Guest order linking, OTP ยืนยันเบอร์, ประวัติคำสั่งซื้อ, คะแนน, การจอง หรือการส่ง LINE notification จริง การเชื่อม LINE ต้องใช้ authorization callback ที่ตรวจ state แบบครั้งเดียวและ identity ที่ adapter ยืนยันแล้ว; test ใช้ fake adapter ส่วน production ต้อง fail-fast เมื่อยังไม่ตั้งค่าผู้ให้บริการ ห้ามใช้ LINE user ID จาก request body เป็นหลักฐานโดยตรง

## Acceptance criteria

- [ ] ลูกค้าสมัครผ่านเว็บด้วยชื่อ เบอร์โทร และรหัสผ่านได้ อีเมลไม่บังคับ เบอร์โทรไม่ซ้ำและถูก normalize ตามกฎไทยที่บันทึกชัดเจน
- [ ] ลูกค้าเข้าสู่ระบบ ออกจากระบบ และตรวจ session ปัจจุบันได้ โดยบัญชีลูกค้าและบัญชีพนักงานไม่สวมสิทธิ์ข้ามกัน
- [ ] รหัสผ่านถูก hash, จำกัดขนาด bcrypt, มี CSRF/rate limit/input validation และ session เดิมถูกยกเลิกเมื่อเปลี่ยนรหัสผ่านหรือปิดบัญชี
- [ ] ลูกค้าแก้ชื่อ/อีเมลและเปลี่ยนรหัสผ่านตนเองได้ โดย response/log/audit ไม่เปิดเผย password hash, token หรือข้อมูลลับ
- [ ] ลูกค้าเริ่มเชื่อม LINE ผ่าน state แบบสุ่ม อายุสั้น ใช้ครั้งเดียว ตรวจ callback ผ่าน provider adapter และป้องกันบัญชีลูกค้าหรือ LINE user ID เชื่อมซ้ำขัดแย้งกัน
- [ ] ลูกค้าดูสถานะและยกเลิกการเชื่อม LINE ของตนได้ โดยไม่เก็บ provider access token หากไม่จำเป็น
- [ ] ลูกค้าขอลบบัญชีได้ ระบบถอน LINE/revoke sessions และทำ PII เป็นนิรนาม แต่เก็บ identifier ภายในที่ใช้รักษาความถูกต้องของประวัติในอนาคต
- [ ] Admin และ Owner ค้นหา/ดู/ปิด/เปิดบัญชีลูกค้าได้; Kitchen/Drink/Guest/ลูกค้ารายอื่นถูกปฏิเสธฝั่ง server
- [ ] การสมัคร เข้าสู่ระบบล้มเหลว/สำเร็จ แก้ข้อมูล เชื่อม/ถอน LINE ปิด/เปิด และลบบัญชีถูกบันทึก audit ตามข้อมูลที่แต่ละบทบาทควรเห็น
- [ ] MySQL migration รันซ้ำได้ มี unique constraints และ transaction สำหรับ state-changing operation ที่ต้องเขียนพร้อม audit
- [ ] UI ภาษาไทย responsive สำหรับสมัคร/เข้าสู่ระบบ/โปรไฟล์/LINE และหน้าจัดการสมาชิกหลังร้าน ใช้ design system เดิม มี loading/error/empty/success/focus states
- [ ] API/Web behavior tests, provider fake/contract tests, typecheck และ build ผ่าน; live LINE, MySQL และ browser checks รายงานตามผลจริงก่อน `resolved`

## Comments

เลือก Ticket 03 เป็นบัญชีลูกค้าก่อนการจอง เพราะ Spec กำหนดว่าการจองและคะแนนใช้ได้เฉพาะสมาชิก จึงต้องมี customer identity seam ที่พิสูจน์และแยกจาก staff identity ก่อน

### 2026-09-12 — แก้ review findings P1/P2 (ยัง claimed: live LINE/MySQL/browser ตรวจไม่ได้ในเครื่องนี้)

- P1 deauthorize: `RealLineProvider.deauthorize` ห้ามสำเร็จแบบเงียบ — โยน `LineDeauthorizeError`
  ชัดเจนทุกครั้ง (รุ่นนี้ไม่ persist user access token ระยะยาว จึงเรียก
  `POST .../user/v1/deauthorize` ทางการไม่ได้; ห้าม log token/secret) งาน follow-up
  เก็บ token ขั้นต่ำเข้ารหัส at-rest ด้วย `LINE_TOKEN_ENCRYPTION_KEY` (ดู `.env.example`)
  fake บันทึก `deauthorized[]` และเทสต์ assert subject ถูกต้องทั้ง unlink/delete
  unlink/delete เรียก provider ก่อนเสมอ ล้มเหลวคง local link ไว้ (502) ลบเฉพาะหลัง success
  (ยกเว้น Disabled provider ที่ไม่เคยตั้งค่าเลย) — เทสต์ Real provider ยืนยัน unlink/delete คง link
- P1 atomic: เพิ่ม narrow seams `registerCustomerWithSession`,
  `createCustomerSessionWithAudit`, `createLineLoginTxWithAudit` ทั้ง Memory (backup/restore)
  และ MySQL (transaction เดียว) routes ใช้สามตัวนี้เท่านั้น (ห้ามแยกเรียกหลายขั้น)
  เทสต์ failure-injection พิสูจน์ rollback ทั้ง state/session/audit (store + route ระดับ HTTP)
- P1 atomic (logout, 2026-09-12 รอบสอง): เพิ่ม seam ที่สี่
  `logoutCustomerSessionWithAudit(sessionId, customerId, actor)` ทั้ง Memory
  (backup/restore) และ MySQL (`DELETE ... WHERE id=? AND customer_id=?` + audit
  `customer_logout` ใน transaction เดียว) — route `POST /api/customers/logout` ใช้ seam
  นี้เท่านั้น (เลิกเรียก `deleteCustomerSession` + `audit` แยกสองขั้น) auth/CSRF คงเดิม
  audit ล้มเหลว → 500 โดย session คงอยู่และไม่มี audit logout (me ยัง 200)
  สำเร็จ → 200 + session หาย (me 401) + มี audit logout; seam ไม่ลบ session ข้ามบัญชี
  เทสต์ใหม่: store success/failure/cross-account (1) + route failure/success (1)
  + MySQL int parity (1, skip เมื่อไม่มี TEST_DATABASE_URL)
- P2 callback: `GET /api/customers/line/callback` ตอบ redirect 302 เสมอ (ไม่ค้าง JSON)
  ไป `CUSTOMER_UI_URL` + allowlist path (ไม่ตั้ง = same-origin fallback) พร้อม query
  `?line=linked` / `?line=error&reason=<code>` เท่านั้น ไม่ใส่ code/token/secret/state/nonce/sub
  หน้าโปรไฟล์อ่าน query มาแสดงผลไทย (เทสต์ web 2 ข้อใหม่)
- ผลตรวจ (รอบสอง 2026-09-12, รวม logout seam): API 100 passed / 0 failed / 14 skipped
  (3 ไฟล์ MySQL int ไม่มี TEST_DATABASE_URL), web 79 passed / 0 failed
  (รันแยกไฟล์ด้วย NODE_OPTIONS=--max-old-space-size=3072; รันรวม OOM ในเครื่องนี้),
  typecheck api+web ผ่าน, build api+web ผ่าน
- คงเหลือก่อน resolved: MySQL จริง (TEST_DATABASE_URL แยก + migration 004 รันซ้ำ + rollback),
  LINE sandbox จริงด้วย Tester account, browser responsive/keyboard จริง

### 2026-09-13 — สถานะหลัง final review (ยัง claimed)

- พบ P1/P2 คงเหลือใน success callback: `linkLineIdentity` และ `consumeLineTx`
  ยังถูกเรียกแยกกันใน `customers.ts` จึงยังไม่ atomic ระหว่าง link, success audit
  และการ consume state
- เพิ่ม seam `linkLineIdentityWithConsume` ใน `store.ts` แล้วทั้ง Memory/MySQL
  แต่ยังต่อ route และเพิ่ม regression test ไม่สำเร็จ เพราะ opencode executor
  ล้มซ้ำจาก Bun `Illegal instruction`/`MemoryExhaustion` ก่อนแก้ไฟล์
- จึงยังไม่ mark resolved และยังไม่ควร commit จนกว่าจะต่อ route ใช้ seam ใหม่
  และรัน verification รอบสุดท้ายได้

### 2026-09-13 — สถานะหลัง final review (ยัง claimed)

- พบ P1/P2 คงเหลือใน success callback: `linkLineIdentity` และ `consumeLineTx`
  ยังถูกเรียกแยกกันใน `customers.ts` จึงยังไม่ atomic ระหว่าง link, success audit
  และการ consume state
- เพิ่ม seam `linkLineIdentityWithConsume` ใน `store.ts` แล้วทั้ง Memory/MySQL
  แต่ยังต่อ route และเพิ่ม regression test ไม่สำเร็จ เพราะ opencode executor
  ล้มซ้ำจาก Bun `Illegal instruction`/`MemoryExhaustion` ก่อนแก้ไฟล์
- จึงยังไม่ mark resolved และยังไม่ควร commit จนกว่าจะต่อ route ใช้ seam ใหม่
  และรัน verification รอบสุดท้ายได้

### 2026-09-13 — แก้ review finding: LINE callback failure audit gap (ยัง claimed: live LINE/MySQL/browser ตรวจไม่ได้ในเครื่องนี้)

- เดิม callback ทำ `consumeLineTx` แล้วค่อย `audit(customer_line_link_failed)` แยกสองขั้น —
  audit พัง = state ถูกใช้แล้วแต่ไม่มี failure audit (consumed-แต่-no-audit)
- เพิ่ม seam ที่ห้า `consumeLineTxWithAudit(state, now, actor, failureDetail)` ทั้ง Memory
  (backup/restore — ระวังห้าม mutate tx object in-place เพราะ backup แชร์ reference;
  ใช้ replace ทั้งก้อน) และ MySQL (`SELECT ... FOR UPDATE` + `UPDATE used_at` +
  `INSERT audit_logs` ใน transaction เดียว) — คืน null (ไม่เขียน audit/ไม่เปลี่ยน state)
  เมื่อไม่พบ/ใช้แล้ว/หมดอายุ; audit ล้มเหลว rollback การ consume แล้วโยน error (retry ได้)
- เพิ่ม `peekLineTx(state, now)` (อ่านอย่างเดียว ไม่ mark used) สำหรับ pre-check ก่อนแลก code;
  callback ใหม่: peek → exchange/verify → consume พร้อม audit ของผลลัพธ์เท่านั้น
  (ล้มเหลว→seam ใหม่ทุก branch: cancelled/invalid_response/exchange/verify/conflict/
  not-found/internal; สำเร็จ→link ก่อนแล้วค่อย consume ธรรมดา + success audit ที่ atomic
  อยู่แล้วใน `linkLineIdentity`) — ไม่มี branch ใด consume แล้ว audit แยกอีก
- internal link error เดิม `throw` (เสีย redirectAfter + ไม่มี failure audit) → เขียน failure audit
  ด้วย detail ทั่วไปผ่าน seam เดียวแล้ว redirect 302 `reason=internal` (ไม่รั่ว error ภายใน,
  ไม่ใส่ code/token/secret/state/nonce/sub ใน audit/redirect เหมือนเดิม)
- เทสต์ใหม่: store success/null-cases (1) + store rollback ด้วย failAudit (1) + route
  exchange_failed พร้อม audit/consume (1) + route audit-ล้มเหลว→302 internal โดย state
  ไม่ถูกใช้ (1) + route cancel/invalid-response พร้อม audit ไม่รั่ว secret (1)
  + MySQL int parity peek/consumeWithAudit (1, skip เมื่อไม่มี TEST_DATABASE_URL)
  (รวมเทสต์ retry ด้วย state เดิมจน linked ที่มีใน workspace แล้ว — เก็บไว้ เขียว)
- ผลตรวจ (รอบสาม 2026-09-13): API 107 passed / 0 failed / 15 skipped
  (3 ไฟล์ MySQL int 6+6+3 tests ไม่มี TEST_DATABASE_URL; รันด้วย
  `npx vitest run --maxWorkers=1 --no-file-parallelism`, รันรวม default OOM ในเครื่องนี้),
  web 79 passed / 0 failed (รันแยกไฟล์/batch ด้วย
  NODE_OPTIONS=--max-old-space-size=3072; รันรวม OOM ในเครื่องนี้),
  typecheck api+web ผ่าน, build api+web ผ่าน (web build ต้องมี heap flag)
- คงเหลือก่อน resolved: MySQL จริง (TEST_DATABASE_URL แยก + migration 004 รันซ้ำ + rollback),
  LINE sandbox จริงด้วย Tester account, browser responsive/keyboard จริง
