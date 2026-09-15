# Observability — Release (Ticket 14)

local-first: ไม่พึ่ง APM/บริการภายนอก ใช้ request ID + health/readiness +
metrics สรุปเบา + audit taxonomy ที่มีอยู่แล้ว

## 1. Correlation / request IDs

- middleware กลาง `requestIdMiddleware` (`apps/api/src/observability.ts`) ทำงาน
  กับทุก request/response:
  - รับ `x-request-id` ที่ client ส่งมาเมื่อตรงรูปแบบ `[A-Za-z0-9_-]{1,64}`
    มิฉะนั้นสร้าง `randomUUID()` ใหม่ (กัน header ยาว/แปลกปลอม)
  - สะท้อนค่าผ่าน response header `x-request-id` เสมอ (รวม error responses)
  - เก็บใน `(req as any).requestId` ไว้ผูกกับ log/audit ในอนาคต
- วิธีใช้ตอนแจ้งปัญหา: ลูกค้า/พนักงานจด `x-request-id` จาก response →
  ค้นใน audit (`ip`/เวลาใกล้เคียง) เพื่อตามรอยโดยไม่ต้องขอข้อมูลส่วนบุคคลเพิ่ม

## 2. Health / readiness

| Endpoint | สิทธิ์ | ความหมาย |
|---|---|---|
| `GET /api/health` | public | `{ ok, version, uptimeSec }` — liveness (additive จาก `{ ok }` เดิม) |
| `GET /api/ready` | public (ไม่มี PII) | probe seam DB ด้วย `countOwners()`; พร้อม → 200 `{ ok, version, time }`, ไม่พร้อม → **503** `{ ok:false, code:UNAVAILABLE }` |
| `GET /api/metrics/summary` | **Owner** | `{ version, uptimeSec, migrationCount: 14, ownerCount, time }` — ตรวจ release/หลัง restore |

หลัง deploy/restore ตรวจตามลำดับ: `health` → `ready` → login Owner →
`metrics/summary` (`migrationCount` ต้อง = 14)

## 3. Event / error taxonomy

- audit actions แยกตาม domain prefix (catalog ใน `AUDIT_EVENT_PREFIXES`):
  `login_|logout|user_|account_|roles_changed|password_|shop_|customer_|
  menu_|order_|reservation_|table_round_|ingredient_|recipe_|stock_|
  payment_|queue_|loyalty_|reward_|finance_|notification_|prediction_`
- release test assert ว่า audit ที่เขียนจริงทุกแถวอยู่ใน catalog
  (`isKnownAuditAction`) — action ใหม่ที่สะกดผิดจะแดงทันที
- error responses มี `code` คงที่เสมอ (Ticket 14 เติมโดยไม่เปลี่ยนข้อความไทยเดิม):

| code | HTTP | ใช้เมื่อ |
|---|---|---|
| `VALIDATION` | 400 | input ไม่ผ่าน |
| `AUTH` | 401 | ยังไม่ login / session หมดอายุ/ถูกยกเลิก |
| `FORBIDDEN` | 403 | ข้ามบทบาท / CSRF ไม่ผ่าน |
| `NOT_FOUND` | 404 | ไม่พบข้อมูล |
| `CONFLICT` | 409 | ชนกัน (จองซ้ำ/คีย์ซ้ำ/stock ไม่พอแบบแข่งกัน) |
| `RATE_LIMITED` | 429 | เกิน rate-limit |
| `UNAVAILABLE` | 503 | DB/dependency ไม่พร้อม |
| `INTERNAL` | 500 | ข้อผิดพลาดภายใน (ข้อความกลาง ไม่รั่ว detail) |

## 4. Metrics สรุป (ไม่มี PII/secret)

- ปัจจุบัน: uptime, version, migrationCount, ownerCount (Owner เท่านั้น)
- นโยบาย: ห้ามใส่ PII (ชื่อ/เบอร์/อีเมล/LINE sub), token, หรือยอดเงินรายบุคคล
  ใน metrics/log — ยอดธุรกิจดูผ่าน Dashboard/CSV ที่มีสิทธิ์อยู่แล้ว
- เป้าหมาย performance (Spec D10, ตรวจด้วยภาระทดสอบแยกก่อน pilot):
  งานทั่วไป p95 ≤ 2 วินาที, คิวอัปเดต ≤ 5 วินาที, Dashboard ครั้งแรก ≤ 5 วินาที,
  ตรวจสลิป ≤ 15 วินาที (provider ปกติ) + progress เมื่อเกิน 1 วินาที

## 5. Log policy (no sensitive logs — NFR-OBS-001)

- ห้าม log: รหัสผ่าน/hash, token/secret/verifier/nonce, session id, LINE sub,
  เบอร์/อีเมลเต็มรูป, ข้อมูลชำระเงินที่เป็นความลับ
- เบอร์ใน audit/log ใช้รูป mask `08******78` เท่านั้น
- ตัวช่วยกลาง: `sanitizeForLog` + `maskPhoneForLog` (`observability.ts`) —
  มี unit test ใน `tests/release.test.ts`
- static grep (2026-09-15): `console.*` ใน `src` มีเฉพาะ bootstrap CLI
  (พิมพ์ username อย่างเดียว) กับ `index.ts` (port) — ไม่มี log body/secret
