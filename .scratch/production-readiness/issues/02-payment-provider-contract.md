# 02: ยืนยันบัญชีและ contract ของ Omise กับ SlipOK

**What to build:** ข้อสรุปที่ตรวจสอบได้ว่า Omise PromptPay จะใช้เป็น payment production provider และ SlipOK จะใช้เป็นบริการตรวจสลิป fallback ได้จริงตามบัญชี ค่าธรรมเนียม quota webhook และ refund ที่ร้านยอมรับ

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] ยืนยัน merchant onboarding และข้อกำหนดบัญชี Omise สำหรับ PromptPay production
- [x] ยืนยัน sandbox/test flow, webhook, signature verification, timeout และ refund
- [x] ยืนยันค่าธรรมเนียม production และค่าธรรมเนียม/เงื่อนไข refund ที่เกี่ยวข้อง
- [x] ยืนยัน SlipOK plan, quota ฟรี 100 ครั้งต่อเดือน, ผลลัพธ์ success/failure และการจัดการ quota หมด
- [x] ระบุ contract ที่ API ต้องรองรับและความเสี่ยงที่ยังต้องให้ Owner ตัดสินใจ
- [x] บันทึกคำตอบในหัวข้อ `## Answer` และสรุป decision ที่ map

## Answer

> วันที่ตรวจแหล่งข้อมูลผู้ให้บริการ: 2026-09-18 (ทุก URL ด้านล่างเปิดอ่านจริงวันเดียวกัน).
> วิธีทำ: อ่าน codebase/config แบบ read-only + เอกสารทางการของผู้ให้บริการเท่านั้น
> (primary sources) ไม่ใช้บทความรีวิวเป็นหลักฐานหลัก ราคา/โควตาเป็น "ตัวเลขที่เห็นบน
> หน้าทางการ ณ วันตรวจ" อาจเปลี่ยนได้ — ต้องยืนยันอีกครั้งตอนสมัคร/เปิดบิล
> งานนี้เป็น decision/research ticket ก่อน implementation — ไม่แตะ production code,
> dependencies, ticket/spec อื่น และไม่ใส่ secret ใด ๆ ลง repo

### 1. สิ่งที่โค้ดและ config ปัจจุบัน "เป็นจริง" (facts จาก repo, read-only)

| เรื่อง | สิ่งที่พบจริง | หลักฐานใน repo |
|---|---|---|
| Payment adapter | `PaymentProvider` มีแค่ `createIntent` + `verifySlip`; production คือ `ContractOnlyPaymentProvider` (เรียกเมื่อใดก็โยน error → route ตอบ 503) กันเผลอใช้ credentials จริงก่อนเลือก provider | `apps/api/src/payments/provider.ts:24-85` |
| Fake mode gate | `isFakePaymentMode()` = `PAOR_PAYMENT_FAKE=true` หรือ `NODE_ENV !== "production"`; ใน production เรียก fake ไม่ได้ | `apps/api/src/payments/provider.ts:34-37` |
| Webhook seam | `store.ts` มีคอมเมนต์ contract ว่า "รับ webhook (fake signature seam)": success → paid + ใบเสร็จ, ambiguous → manual_review — **ยังไม่มีการตรวจ HMAC จริง** ต้องทำใน Ticket 06 | `apps/api/src/store.ts:789-792` |
| Outcome mapping | `success → paid`, `ambiguous → manual_review`, `fail → failed`; timeout/ไม่แน่ชัดต้องเข้า manual_review เสมอ | `apps/api/src/payments/validation.ts:151-166` |
| State machine | `pending → paid/manual_review/failed/expired/cancelled`; `manual_review → paid/failed/cancelled` โดย Admin; สถานะปลายทางเปลี่ยนต่อไม่ได้ ยกเว้น `paid → refunded` ผ่านช่องทางคืนเงินเท่านั้น | `apps/api/src/payments/validation.ts:139-149` |
| Idempotency/dedupe | `payments` ผูก 1:1 กับ order (`UNIQUE order_id`), `UNIQUE idempotency_key` + payload hash (key เดิม+payload ต่างกัน → 409); `payment_events` append-only + `UNIQUE provider_event_id` กัน webhook replay | `db/migrations/009_payments_receipts_refunds.sql:28-47`, `apps/api/src/payments/validation.ts:117-130` |
| Refund ในโค้ด | `approveRefund` เป็น Owner-only, หนึ่ง payment คืนได้ครั้งเดียว, `paid → refunded` + order → cancelled; รายรับ = paid หัก refunds (derived ไม่เก็บซ้ำ) + audit `payment_refund_approved` | `docs/SECURITY.md:86`, `apps/api/src/store.ts:825-829`, `apps/api/src/routes/finance.ts:499-514` |
| Safe state | `manual_review` = `รอตรวจสอบการชำระเงิน` (CONTEXT.md); คิวสร้างจาก payment ที่ paid เท่านั้น (unpaid `queue/ensure` → 409 ใน tests) — ตรงกับ spec ที่ว่าต้องให้ Admin ยืนยันก่อนเข้าคิว | `apps/api/src/types.ts:737`, `apps/api/tests/queue.test.ts:121-134` |
| Secrets | `.env.example` **ไม่มี** `OMISE_*`/`SLIPOK_*` ใด ๆ — ดีแล้ว ต้องคงไว้แบบนี้จน Ticket 06 ออกแบบ env ใหม่ (ห้าม commit secret) | `.env.example` |

**Gap หลัก (ยกให้ Ticket 06):** adapter ปัจจุบันไม่มี `parseWebhook/verifySignature`,
ไม่มี `retrieveCharge` (ตรวจสถานะซ้ำ), ไม่มี `createRefund` ผ่าน Omise (และตามข้อ 2.6
ข้างล่างก็เรียกไม่ได้สำหรับ PromptPay), ไม่มี SlipOK client (auth/request/response/
quota check/timeout mapping) และไม่มี env contract สำหรับ keys/secrets ราย environment

### 2. Omise PromptPay production (เอกสารทางการ Omise)

- **Onboarding/KYC (ก่อนรับเงินจริง):** สมัคร test account ก่อน แล้วกด "Switch to live
  mode" ใน dashboard สมัคร live account ออนไลน์ 100% — ต้องมีอีเมลยืนยันแล้ว, เว็บไซต์
  พร้อมออนไลน์, **แสดงนโยบาย refund บนเว็บ** (ข้อบังคับฝั่ง Visa merchants) และยื่นเอกสาร
  ยืนยันตัวตน (บุคคล: บัตรประชาชน + selfie ถือบัตร + สมุดบัญชีธนาคารไทยชื่อตรงบัตร;
  นิติบุคคล: หนังสือรับรอง DBD ออกไม่เกิน 6 เดือน + บอ.อ.จ.3/5 + บัตรกรรมการ/ผู้ถือหุ้น
  เกิน 25% + สมุดบัญชีชื่อตรงบริษัท ฯลฯ — ลงนามรับรองสำเนาถูกต้อง + ประทับตรา ไม่รับ
  e-signature) ทีม KYC ตรวจหลังยื่นครบ (เอกสารระบุกรอบราว 30 วันทำการ)
  ([How do I enable the live account?](https://www.omise.co/how-do-i-enable-live-account/thailand),
  [Getting started](https://docs.omise.co/thailand),
  [Required documents per legal entity](https://docs.omise.co/what-documents-are-required-for-each-type-of-Legal-Entity/thailand))
- **Activation ของ PromptPay โดยเฉพาะ:** ไม่ได้เปิดมาให้เลย — ต้องส่งอีเมลขอเปิดที่
  `support@omise.co` และ**ยอมรับข้อกำหนดเพิ่มเติม**; API ขั้นต่ำ `2017-11-02`; รองรับเฉพาะ
 ประเทศไทย ([PromptPay](https://docs.omise.co/promptpay/thailand) หัวข้อ How to enable)
- **Fees (production):** PromptPay **1.65% ต่อรายการ ยังไม่รวม VAT 7%** (รวม VAT ≈ 1.7655%);
  ค่าโอนยอดออกจากบัญชี Omise ไปธนาคาร: **≤ 2 ล้านบาท = 20 บาท/รายการ, > 2 ล้านบาท =
  150 บาท/รายการ** ตามหน้าราคา ([Pricing Thailand](https://www.omise.co/th/pricing/thailand))
  — **spec ยอมรับแล้วว่า "รับเงินจริงไม่ต้องฟรี"** จึงไม่ขัดกับ Out of Scope
- **API flow:** สร้าง source `type: promptpay` ด้วย **public key** ฝั่ง client → สร้าง charge
  ด้วย **secret key** ฝั่ง server (`amount`+`currency` ต้องตรงกับ source) หรือสร้าง+charge
  ใน request เดียวด้วย secret key; QR อยู่ใน `charge.source.scannable_code.image.download_uri`;
  QR ใช้ครั้งเดียว ผูกยอดต่อ order ([PromptPay](https://docs.omise.co/promptpay/thailand),
  [Authentication](https://docs.omise.co/api-authentication/thailand))
- **Limits/expiry:** ขั้นต่ำ `2000` (20.00 บาท) สูงสุด `15000000` (150,000.00 บาท) หน่วยย่อย;
  QR หมดอายุ default **24 ชม.** หลังสร้าง — ขอเปลี่ยน default ได้ทาง support หรือกำหนดราย
  charge ด้วย `expires_at` (ต้องไม่เกิน 24 ชม.) ([PromptPay](https://docs.omise.co/promptpay/thailand)
  หัวข้อ Limits / Setting the QR code to expire)
- **Webhook event/response:** charge สร้างแล้วได้ `charge.create`; ชำระสำเร็จได้
  **`charge.complete`** (POST event object ฝัง charge มา); หลังรับ event **ต้อง `GET
  /charges/{id}` ตรวจ `status` ซ้ำ** (`successful` = ได้เงินแล้ว; `failed` ดู
  `failure_code`/`failure_message`: `failed_processing`, `insufficient_balance`,
  `payment_cancelled`); event ถูก serialize ตาม API version ของ account
  ([PromptPay](https://docs.omise.co/promptpay/thailand) หัวข้อ Completing the charge,
  [Webhooks](https://docs.omise.co/api-webhooks/thailand), [Events API](https://docs.omise.co/events-api/thailand))
- **Signature verification (มีจริง ต้อง implement):** Omise ลงนาม webhook ด้วย **HMAC-SHA256**;
  headers `Omise-Signature` (hex, ตอน rotate มี 2 ค่าคั่น comma) + `Omise-Signature-Timestamp`
  (unix); วิธีตรวจ: `signedPayload = "<timestamp>.<raw_body_utf8>"`, ถอด secret (base64)
  แล้ว HMAC-SHA256 เทียบแบบ constant-time (`timingSafeEqual`), กัน replay ได้ด้วยการตรวจ
  timestamp window (เช่น 5 นาที, optional); secret แยก test/live, rotate แบบ zero-downtime
  (secret เก่าใช้ได้ต่อ 24 ชม. พร้อม dual-signature); ถ้าทำ signature ไม่ได้ ให้ใช้ทางรองคือ
  event verification (`GET` charge ตรวจซ้ำ) — แต่ Ticket 06 ต้องทำ signature เป็นหลัก
  ([Webhooks — Protecting Your Endpoints](https://docs.omise.co/api-webhooks/thailand))
- **Timeout/retry (สำคัญ):** เอกสารระบุชัดว่า **Omise ไม่รับประกัน retry อัตโนมัติ** สำหรับ
  delivery ที่ล้มเหลว และ endpoint ต้องตอบ `200 OK` — ดังนั้นระบบเราต้อง (ก) ตอบ webhook
  เร็วแล้วประมวลผลแบบ idempotent (ข) มี fallback ไป poll `Events API`/`GET charge` สำหรับ
  event ที่พลาด (ค) **ห้ามถือว่า timeout = สำเร็จ** — timeout/ไม่แน่ชัด → `manual_review`
  ตามกฎ repo ปัจจุบัน ([Webhooks FAQ](https://docs.omise.co/api-webhooks/thailand))
- **Duplicate delivery/idempotency:** รับ event ซ้ำได้ — dedupe ด้วย event/charge id ฝั่งเรา
  (`payment_events.provider_event_id UNIQUE` มีอยู่แล้ว) + ใช้ charge id เป็น business key;
  ระวัง serialization ตาม API version และ dynamic `webhook_endpoints` ราย charge (ถ้าใช้ จะไม่
  ส่งเข้า static endpoint) ([Webhooks](https://docs.omise.co/api-webhooks/thailand)
  หัวข้อ Serialization / Dynamic Webhooks)
- **Refund — ข้อจำกัดที่เป็น blocker ของการออกแบบ:** หน้า PromptPay ระบุชัดว่า
  **"PromptPay charges cannot be voided or refunded through Omise"** ขณะที่ Refund API
  กลางรองรับเฉพาะ charge ที่ capture แล้ว ไม่มี dispute (เงื่อนไขกลาง: partial ไม่เกิน 15 ครั้ง,
  ภายใน 365 วัน — แต่ละวิธีจ่ายอาจสั้นกว่านั้น) ดังนั้น **refund ผ่าน Omise API ใช้กับ
  PromptPay ไม่ได้** ([PromptPay](https://docs.omise.co/promptpay/thailand) หัวข้อ Voids and
  refunds, [Refund API](https://docs.omise.co/refunds-api/thailand))
  - **Decision ที่สอดคล้อง spec:** คืนเงิน PromptPay = **โอนคืนนอก Omise ด้วยมือ
    (ธนาคารตรง)** แล้วบันทึกเป็นหลักฐานใน flow `approveRefund` เดิมของระบบ (Owner อนุมัติ,
    หนึ่ง payment คืนได้ครั้งเดียว, `paid → refunded`, รายรับ derived หัก refund, มี audit)
    — ไม่ต้องแก้สเปก เพราะ spec/user stories 14/23 ต้องการแค่ "ขอ refund ตามเงื่อนไขร้าน
    + ติดตามสถานะ + ไม่นับรายรับซ้ำ + audit" ไม่ได้บังคับว่า gateway ต้อง reverse ให้
  - **Owner ต้องยอมรับ 2 เรื่องนี้ก่อนผูก production:** (1) คืนเงินช้ากว่า gateway-reversal
    (รอบโอนธนาคาร) และ (2) ต้องประกาศนโยบาย refund บนเว็บ (ซึ่งเป็นเงื่อนไขผ่าน KYC อยู่แล้ว)

### 3. Development sandbox (Omise test mode)

- ใช้ test keys (`pkey_test_*`/`skey_test_*`) แยกจาก live keys โดยสิ้นเชิง; webhook endpoint
  + webhook secret แยก test/live; ทดสอบ signature/rotation ใน test mode ก่อนเสมอ
  ([Authentication](https://docs.omise.co/api-authentication/thailand),
  [Webhooks](https://docs.omise.co/api-webhooks/thailand) หัวข้อ Managing Webhook Secrets/Testing)
- วิธีจำลอง PromptPay (offline flow): สร้าง charge test แล้วใน dashboard กด **Actions →
  Mark as Successful / Mark as Failed**; ทดสอบ webhook delivery + status re-check + failure
  codes ทั้งสามค่า ([Testing](https://docs.omise.co/api-testing/thailand),
  [PromptPay](https://docs.omise.co/promptpay/thailand) หัวข้อ Authorizing the charge)
- **ห้ามใช้ live secret ในการทดสอบ** (ตรงกับ spec) — Ticket 06 ต้องแยก credentials,
  callback URL, keys ตาม environment

### 4. SlipOK fallback (เอกสารทางการ SlipOK)

- **Plan/quota (ฟรี 100 ครั้ง/เดือนมีจริง):** `OK BASIC` **0 บาท = 100 สลิป/เดือน** (สร้างได้
  สูงสุด 2 ร้าน); `START` 350 บาท/500; `SME` 600 บาท/1,000; `ENTERPRISE` 1,000 บาท/2,000
  (มี tier ใหญ่กว่าถึง 150,000/เดือน); ค่าเกินโควตา: Basic **1.00** / Start **0.70** / SME
  **0.60** / Enterprise **0.50** บาท/รายการ (รวมบิลถัดไป); แพ็กรายเดือน**ไม่ยกยอด**ข้ามเดือน,
  แพ็กรายปี (จ่าย 12 เดือนล่วงหน้า) ยกยอดได้ + ลด 30% ([ราคา SlipOK](https://slipok.com/our-service/),
  [FAQ](https://slipok.com/faq/))
- **นับโควตาอย่างไร (ต้องอ่านคู่กับ quota doc):** FAQ ว่า "สลิปถูก + สลิปปลอมนับ, สลิปซ้ำไม่นับ"
  แต่รายละเอียดจริงขึ้นกับ `log`: **ไม่ส่ง `log:true`** — นับเมื่อสลิปถูก และ**ส่งสลิปถูกเดิมซ้ำก็นับซ้ำ**;
  **ส่ง `log:true`** — นับเมื่อสลิปถูก**และตรงบัญชีรับเงินที่ผูกใน LINE LIFF**, ส่งซ้ำไม่นับซ้ำ,
  แต่ถ้าบัญชีรับไม่ตรงก็นับ ([FAQ](https://slipok.com/faq/),
  [Check Slip Quota](https://slipok.com/api-documentation/check-slip-quota/))
  → **ระบบต้องส่ง `log:true` + `amount` เสมอ** (ดูข้อถัดไป)
- **API contract:** `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>` header
  `x-authorization: <API_KEY>`; body ส่ง**อย่างใดอย่างหนึ่ง**: `{data: QR string}` |
  `{files: JPG/JPEG/PNG/JFIF/WEBP}` | `{url: image URL}`; optional `{log: boolean,
  amount: number}`; response มี `success/data.success/message/language/receivingBank/
  sendingBank/transRef/transDate/transTime/transTimestamp/sender/receiver/amount/…`
  (ชื่อ/เลขบัญชีถูก mask, ชื่ออาจไม่สมบูรณ์ — ต้อง match แบบ partial + ตรวจยอด/บัญชีเอง);
  มี `GET .../quota` ดู `quota` คงเหลือ + `overQuota` ([Check Slip](https://slipok.com/api-documentation/check-slip/),
  [Check Slip Quota](https://slipok.com/api-documentation/check-slip-quota/),
  [API Documentation v1.8 (30 ก.ค. 2024)](https://slipok.com/api-documentation/))
- **Success/failure/timeout/ไม่แน่ชัด → mapping ของระบบ:**
  - success (`data.success=true`) + `amount` ตรง + receiver ตรงบัญชีร้าน + `transRef` ไม่เคยใช้
    → `paid` (แล้วตรวจซ้ำใน DB เราก่อนเปลี่ยนสถานะเสมอ)
  - `1013` ยอดไม่ตรง / `1014` บัญชีรับไม่ตรง → `failed` (แสดงเหตุผลให้ลูกค้าแก้ ไม่ใช่ paid)
  - `1012` สลิปซ้ำ (มี timestamp ครั้งก่อน) → กันที่ `UNIQUE(provider+transRef)` ฝั่งเรา,
    ไม่สร้าง paid ซ้ำ
  - `1009` ธนาคารขัดข้อง (ให้ตรวจใหม่ใน 15 นาที, **ไม่เสียโควตา**) / `1010` สลิปดีเลย์
    (รอ N นาที) / network timeout / response ไม่ครบ → **`manual_review` (รอตรวจสอบการชำระเงิน)**
    ห้ามถือว่าสำเร็จ
  - `1007/1008/1011` (ไม่มี QR / ไม่ใช่ QR ชำระเงิน / QR หมดอายุ-ไม่มีรายการจริง) → `failed`
    พร้อมข้อความให้ส่งใหม่; `1000/1001/1002/1005/1006` (request/branch/auth/ไฟล์ผิด) → 4xx
    ฝั่งเรา + log (ไม่ใช่ความผิดลูกค้าฝ่ายเดียว)
  - `1003` แพ็กเกจหมดอายุ / `1004` เกินโควตามาแล้ว 400 บาท → **`manual_review` +
    quota-exhausted flag** + แจ้ง Admin ทันที (ดูข้อถัดไป)
  ([Error Status Code](https://slipok.com/api-documentation/error-status-code/),
  [Check Slip](https://slipok.com/api-documentation/check-slip/))
- **Quota exhausted — behavior ที่ระบบต้องใช้:** ก่อนเรียกตรวจเช็ก `GET .../quota`; ถ้า
  `quota` หมด/`overQuota` ขึ้น หรือเจอ `1003/1004` ให้**ข้ามการเรียกตรวจ ตั้ง `manual_review`
  ทันที** ส่งงานให้ Admin ตรวจมือ (ห้าม fail อัตโนมัติจนลูกค้าเสียสิทธิ์ และห้าม retry
  แบบเสียโควตาซ้ำ); นโยบายรายเดือนไม่ยกยอด → ตั้ง alert โควตาใกล้หมด + Owner ตัดสินใจ
  upgrade (START/SME) หรือคง manual review ช่วงพีก — โควตาฟรีนี้เป็นโควตา**ตรวจสลิป**
  ไม่ใช่โควตา payment gateway (ตรง spec)
- **Backend guidance จาก SlipOK เอง (ต้องทำตาม):** แม้ส่ง `log:true` ระบบร้านต้อง
  (1) ตรวจยอดเรียกเก็บเอง (กันตัดต่อยอด) (2) เก็บบันทึก slip + `transRef` ใน DB ร้านเอง
  (กันสลิปซ้ำ) (3) ตรวจบัญชีปลายทางของร้านเอง (กันโอนเข้าบัญชีตัวเองแล้วตัดรูป)
  ([API](https://slipok.com/api/) หัวข้อคำแนะนำหลังบ้าน)
- **Onboarding:** Add LINE `@slipok` → กรอกข้อมูลธุรกิจ → เลือกช่องทาง `API` → ได้
  branch ID + API key มากรอกใน server (secret ฝั่ง backend เท่านั้น); ผูกบัญชีรับเงินใน
  LINE LIFF ของร้านก่อนใช้ `log:true` ([API](https://slipok.com/api/))
- **Privacy/retention (Owner ต้องอนุมัติ):** SlipOK ระบุว่าเก็บบันทึกตรวจของร้าน**ตลอดไป
  ไม่ลบ/แก้/ปลอมแปลง** และยกเลิกต้องแจ้งล่วงหน้า**≥ 30 วัน** — ภาพสลิปมีชื่อ/เลขบัญชีบางส่วน/
  ยอด/เวลา จึงต้องมี privacy notice + consent + retention สั้นฝั่งเรา (ลบภาพต้นฉบับหลังพ้น
  ช่วงตรวจสอบ) + จำกัดสิทธิ์ Admin ([FAQ](https://dev.slipok.com/api/) / [FAQ](https://slipok.com/faq/))

### 5. ช่องว่าง repo vs provider (สิ่งที่ Ticket 06 ต้องสร้าง)

1. Omise charge/source client (Test/live base URL + keys แยก env, amount หน่วยย่อย, `expires_at`)
2. Webhook endpoint (HTTPS): ตรวจ HMAC-SHA256 (`Omise-Signature/Timestamp`, secret base64
   แยก env, `timingSafeEqual`, replay window) → `charge.complete` → `GET charge` ตรวจซ้ำ →
   เขียน `payment_events` (dedupe `provider_event_id`) → transition ตาม outcome mapping
   (ห้าม paid ถ้าไม่ `successful`); ตอบ 200 เร็ว; poll Events API ชดเชย event ที่พลาด
3. กฎราคา/ลิมิต: ปฏิเสธยอดต่ำกว่า 20 บาท (Omise min) ฝั่ง validation ก่อนสร้าง charge;
   แสดงค่าธรรมเนียมโดยประมาณให้ Owner เห็นในรายงาน (1.65% + VAT) — ไม่บวกเพิ่มในยอดลูกค้า
   เว้น Owner สั่ง
4. Refund: **ไม่มีปุ่ม "refund ผ่าน Omise" สำหรับ PromptPay** — ใช้ flow อนุมัติ Owner +
   โอนคืนนอกระบบ + หลักฐานใน `refunds` (ของเดิมรองรับอยู่แล้ว); UI ต้องสื่อสารว่าเป็นการโอนคืน
   ด้วยมือพร้อม SLA
5. SlipOK client (server-side เท่านั้น): `x-authorization` + branch ID แยก env/staging/prod,
   ส่ง `log:true` + `amount` ทุกครั้ง, ตรวจ `transRef/amount/receiver` ซ้ำใน DB เรา,
   เรียก `GET .../quota` ก่อนตรวจ, mapping error ตามข้อ 4, timeout ของเราเอง (เอกสารไม่ประกาศ
   SLA — เสนอ 10 วินาที + retry เฉพาะ `1009`/network แบบมี backoff แล้วตก `manual_review`)
6. ไม่สร้าง paid/queue/revenue ซ้ำจากทุกทาง (webhook ซ้ำ, SlipOK ซ้ำ, กดซ้ำ, retry) —
   ของเดิมมี UNIQUE + transaction รองรับแล้ว Ticket 06 แค่ห้าม bypass

### 6. Decision (map กลับ spec)

- **Production:** ใช้ **Omise PromptPay** เป็นช่องทางหลัก (QR ผูกยอดครั้งเดียว,
  ยืนยันด้วย `charge.complete` + ตรวจ charge ซ้ำ + HMAC) ยอมรับค่าธรรมเนียม 1.65% + VAT 7%
  และค่าโอนออก 20/150 บาท — ครอบคลุม spec Implementation ("ค่าธรรมเนียม production
  ยอมรับได้ตามรายการสำเร็จ") และ user stories 11–14, 22–23
- **Development:** ใช้ **Omise sandbox/test** (test keys + dashboard Mark Successful/Failed +
  webhook test endpoint/secret แยก) ห้ามใช้ live secret ทดสอบ — ตรง spec ที่ว่า dev ใช้
  sandbox ไม่รับเงินจริง
- **Fallback:** ใช้ **SlipOK (เริ่มที่ OK BASIC ฟรี 100 ครั้ง/เดือน)** เป็นตัวตรวจสลิป fallback
  ด้วย contract ข้อ 4 (`log:true` + `amount` + ผูกบัญชี LIFF + ตรวจซ้ำใน DB เรา + เช็ก quota
  ก่อนเรียก) — ตรง spec ที่ว่าโควตาฟรีนี้เป็นของตรวจสลิป ไม่ใช่ของ gateway (stories 15–16)
- **Safe state:** ทุกกรณี gateway ขัดข้อง / SlipOK ไม่แน่ชัด/timeout/หมดโควตา / Omise timeout /
  refund รอดำเนินการ → คงสถานะ **`รอตรวจสอบการชำระเงิน` (`manual_review`)** ห้ามเข้าคิว
  อัตโนมัติ จน Admin ยืนยันด้วยมือ (stories 13, 16–17; Implementation Decisions ข้อ gateway/
  fallback) — repo ปัจจุบัน enforce ไว้แล้วผ่าน state machine + queue paid-only
- **Map → spec:** decision นี้ตอบ spec หัวข้อ Solution (ย่อหน้า payment), Implementation
  Decisions ข้อ payment/credentials/refund/idempotency/safe-state, Testing Decisions ข้อ
  payment tests (success/declined/timeout/duplicate/invalid-signature/retry/refund/late/
  manual-review) และเป็น precondition ของ Ticket 06 (payment-production-fallback)

### 7. ระดับความมั่นใจของแต่ละข้อ

- **Confirmed fact (เอกสารทางการ + เปิดอ่าน 2026-09-18):** ทุก bullet ในข้อ 2–4 ที่มีลิงก์
  Omise/SlipOK กำกับ (onboarding docs, fees, limits, webhook+HMAC, no-retry, refund ไม่ได้
  ผ่าน Omise สำหรับ PromptPay, SlipOK plans/quota-counting/API contract/error codes/retention)
  และทุก row ในข้อ 1 (อ่านจากไฟล์จริง)
- **Inference (อนุมานอย่างสมเหตุสมผล):** mapping error SlipOK → `paid/failed/manual_review`
  (เอกสารให้ error code มา แต่ไม่สั่ง mapping — เลือกตามกฎ "ไม่แน่ชัดต้อง manual_review" ของ repo/spec);
  timeout 10 วินาที + backoff เฉพาะ `1009`/network (เอกสารไม่ประกาศ SLA จึงต้องกำหนดเองใน Ticket 06)
- **Assumption (ต้องให้ Owner ยืนยัน):** ร้านยอมรับ (ก) ค่าธรรมเนียม 1.65%+VAT/ค่าโอน
  (ข) คืนเงิน PromptPay แบบโอนมือนอก Omise (ค) retention ตลอดไปของ SlipOK + ยกเลิกแจ้ง 30 วัน
  (ง) แสดงนโยบาย refund บนเว็บก่อนยื่น live
- **Unresolved / account-specific (ยืนยันไม่ได้ก่อนมีบัญชีจริง):** ผล KYC/ระยะเวลาอนุมัติ,
  อัตราโอนออก ณ วันเซ็นสัญญา (เห็น 20/150 บาท ณ วันตรวจ), การเปิด PromptPay + default QR expiry
  ของบัญชีร้าน, ตัวเลข SLA/latency ของ SlipOK (ไม่ประกาศ), ตาราง retry ของ Omise (ประกาศว่า
  ไม่รับประกัน — จึงออกแบบ poll ชดเชยแทน)

### 8. สิ่งที่ Owner ต้องจัดการก่อนใช้ production credentials (ห้ามใส่ secret ใน ticket/repo)

1. จดทะเบียน Omise + ยื่น KYC (บุคคล/นิติบุคคลตาม checklist) + แสดง**นโยบาย refund** บนเว็บ
2. ส่งอีเมลขอเปิด **PromptPay** (`support@omise.co`) + ยอมรับ T&C เพิ่มเติม + ยืนยัน default QR expiry
3. รับ **live keys** (`pkey_/skey_`) + **webhook secret (live)** เก็บเข้า secret manager แยก
   prod/staging (dev ใช้ test keys/secret แยก)
4. ตั้ง webhook endpoint **HTTPS** (ใบรับรอง valid) + allowlist IP ของ Omise
   (`54.169.118.227`, `52.74.199.175`, `18.139.13.19`) ที่ firewall
5. สมัคร SlipOK (**เริ่ม OK BASIC ฟรี**) ผ่าน LINE `@slipok`, ผูกบัญชีรับเงินใน LINE LIFF,
   รับ branch ID + API key แยก staging/prod เก็บเป็น secret
6. อนุมัติเป็นลายลักษณ์อักษร: ค่าธรรมเนียม Omise, refund แบบโอนมือ + SLA คืนเงิน,
   retention/privacy (ภาพสลิป + บันทึกตลอดไปฝั่ง SlipOK), เกณฑ์ upgrade SlipOK เมื่อโควตาใกล้หมด
7. อนุมัติให้ Ticket 06 เริ่ม implement ตาม contract ข้อ 5 ได้

### 9. แหล่งข้อมูล (เปิดอ่าน 2026-09-18)

- Omise PromptPay (enable/limits/expiry/flow/refund ไม่ได้/fee ในตัวอย่าง charge):
  https://docs.omise.co/promptpay/thailand
- Omise Pricing Thailand (PromptPay 1.65%, transfer 20/150 บาท, ยังไม่รวม VAT 7%):
  https://www.omise.co/th/pricing/thailand
- Omise Webhooks (events/signature/rotation/retry/IPs/HTTPS/200 OK):
  https://docs.omise.co/api-webhooks/thailand
- Omise Authentication (public/secret/test/live keys):
  https://docs.omise.co/api-authentication/thailand
- Omise Testing (dashboard Actions, test/live แยกกัน):
  https://docs.omise.co/api-testing/thailand
- Omise Refund API (เงื่อนไขกลางของ refund):
  https://docs.omise.co/refunds-api/thailand
- Omise Live account + KYC (ขั้นตอน/เอกสาร/refund policy บนเว็บ):
  https://www.omise.co/how-do-i-enable-live-account/thailand ,
  https://docs.omise.co/thailand ,
  https://docs.omise.co/what-documents-are-required-for-each-type-of-Legal-Entity/thailand
- SlipOK Pricing (plans + เกินโควตา):
  https://slipok.com/our-service/
- SlipOK API + backend guidance:
  https://slipok.com/api/
- SlipOK API Documentation v1.8 + Check Slip + Quota + Error codes:
  https://slipok.com/api-documentation/ ,
  https://slipok.com/api-documentation/check-slip/ ,
  https://slipok.com/api-documentation/check-slip-quota/ ,
  https://slipok.com/api-documentation/error-status-code/
- SlipOK FAQ (นับโควตา/เก็บบันทึกตลอดไป/ยกเลิก 30 วัน):
  https://slipok.com/faq/ , https://dev.slipok.com/api/
- งานวิจัยเดิมใน repo (ใช้ประกอบ ไม่ใช่หลักฐานหลัก):
  `docs/research/payment-verification-api.md` (12 ก.ย. 2026)

### 10. Acceptance checklist (ติ๊ก passed เฉพาะข้อที่มีหลักฐานข้างบนรองรับ)

- [x] (passed) merchant onboarding + ข้อกำหนดบัญชี PromptPay production — ข้อ 2 + 8 + แหล่งข้อ 9
- [x] (passed) sandbox/test flow, webhook, signature verification, timeout, refund — ข้อ 2 + 3
      (refund ผ่าน Omise ไม่ได้สำหรับ PromptPay → decision คืนมือนอกระบบ + flow เดิมรองรับ)
- [x] (passed) ค่าธรรมเนียม production + เงื่อนไข refund — ข้อ 2 (1.65% + VAT, โอนออก 20/150 บาท)
- [x] (passed) SlipOK plan + quota ฟรี 100/เดือน + success/failure + จัดการ quota หมด — ข้อ 4
- [x] (passed) contract ที่ API ต้องรองรับ + ความเสี่ยงให้ Owner ตัดสิน — ข้อ 5 + 7 + 8
- [x] (passed) บันทึก `## Answer` + decision ที่ map กลับ spec — ข้อ 6 + 10 + 11

### 11. หมายเหตุเรื่อง map

- ตรวจแล้ว **ไม่มีไฟล์ map** (`.scratch/production-readiness/map.md` ไม่มี — ในโฟลเดอร์มีแค่
  `spec.md` กับ `issues/`) จึง**ไม่ได้แตะ/สร้าง map หรือไฟล์อื่นใด** ตามกฎ issue-tracker
  (เพิ่ม pointer ได้เฉพาะเมื่อ map มีอยู่จริง) — เมื่อมี map ค่อยมาเพิ่ม pointer
  `02-payment-provider-contract.md` ที่ Decisions

### 12. Blockers ที่เหลือ (ของงานถัดไป ไม่ใช่ของ ticket นี้)

1. Owner ทำ KYC + เปิด PromptPay + รับ live keys/secrets (ดูข้อ 8 ข้อ 1–4) — ไม่มีสิ่งนี้
   Ticket 06 ทดสอบได้แค่ sandbox
2. Owner สมัคร SlipOK + ผูกบัญชี LIFF + รับ branch/API keys แยก env (ข้อ 8 ข้อ 5)
3. Owner อนุมัติค่าธรรมเนียม + refund โอนมือ + retention/privacy + เกณฑ์ upgrade โควตา (ข้อ 8 ข้อ 6)
4. Implement ตาม contract ข้อ 5 ใน Ticket 06 (ไม่ทำใน ticket นี้ตามขอบเขต decision/research)
