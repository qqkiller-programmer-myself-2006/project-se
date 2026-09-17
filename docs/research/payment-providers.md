# ตัวเลือกผู้ให้บริการชำระเงินจริงในไทย (Issue #10)

อัปเดตข้อมูล: 17 กันยายน 2569 (2026)
ขอบเขต: ร้านป้าอ้อ (ร้านอาหารตามสั่งขนาดเล็ก ใกล้มหาวิทยาลัยราชภัฏเลย) — ต้องได้ผลยืนยันการชำระเงินก่อนส่งรายการเข้าคิว (FR-PAY-002) และต้องกำหนด API, webhook, สถานะ, timeout, การยกเลิก และการคืนเงินให้ชัดก่อนพัฒนาโมดูลนี้ (`docs/REQUIREMENTS.md` §5.5, §9.4, §12 ข้อ 6)

> เอกสารนี้**ไม่ได้เลือกผู้ให้บริการแทนผู้ใช้** มีไว้เพื่อสรุปข้อดีข้อเสียของแต่ละทางเลือกเท่านั้น ราคาและเงื่อนไขอาจเปลี่ยนได้ ควรตรวจหน้าทางการอีกครั้งก่อนสมัคร
> เอกสารที่เกี่ยวข้อง: [`payment-verification-api.md`](./payment-verification-api.md) (12 ก.ย. 2569) ซึ่งเน้นเรื่อง slip API และ**มีข้อเสนอแนะ**ในตัว ส่วนเอกสารนี้ครอบคลุมกว้างกว่า และพบข้อมูลบางจุดที่ต่างจากเอกสารฉบับนั้น (ดู [ข้อสังเกต](#ข้อสังเกตต่อเอกสารเดิม))

## Contract ปัจจุบันในโค้ด

`apps/api/src/payments/provider.ts`:

```ts
createIntent(paymentId: string, amount: number, expiresAt: Date): Promise<{ qrPayload: string; providerRef: string; expiresAt: string }>
verifySlip(slipRef: string): Promise<"success" | "ambiguous" | "fail">
```

คอมเมนต์หัวไฟล์พูดถึง `parseWebhook` แต่ interface **ยังไม่มีเมธอดนี้** ถ้าเลือก gateway ที่ยืนยันผลผ่าน webhook ต้องเพิ่มเมธอดนี้ (หรือเมธอดที่ทำหน้าที่เดียวกัน) เข้าไปใน contract ส่วนถ้าใช้ slip API จะใช้ `verifySlip` ได้เลย

## ภาพรวม: 3 แนวทาง

| แนวทาง | เงินไปที่ไหน | ใครยืนยันว่าจ่ายแล้ว | ลูกค้าต้องทำอะไร |
|---|---|---|---|
| **A. QR PromptPay ที่สร้างเอง + Slip verification API** | เข้าบัญชี PromptPay ของร้านโดยตรง | ร้านส่งข้อมูลสลิป (QR payload หรือรูป) ไปให้ SlipOK/EasySlip ตรวจกับข้อมูลธนาคาร | สแกนจ่าย แล้ว**อัปโหลดสลิป** |
| **B. Payment gateway (Omise/Opn, Stripe, Xendit/GB Prime Pay, 2C2P)** | เข้าบัญชีของ gateway ก่อน แล้วโอนต่อ (settle) ให้ร้าน | gateway ส่ง webhook มา และร้านเรียก API ตรวจสถานะซ้ำ | สแกนจ่ายอย่างเดียว |
| **C. API ของธนาคารโดยตรง (SCB, KBank)** | เข้าบัญชีร้านค้าหรือ Biller ของร้านที่ธนาคารนั้น | ธนาคารส่ง callback มา และร้านเรียก inquiry API | สแกนจ่ายอย่างเดียว |

## ตารางเปรียบเทียบ

ช่องที่เขียนว่า "ไม่พบในเอกสาร" หมายถึงค้นในหน้าทางการที่เปิดดูได้โดยไม่ต้อง login แล้วไม่พบ ไม่ได้แปลว่าไม่มี

| ตัวเลือก | รูปแบบ API | Webhook | ค่าธรรมเนียม (ไม่รวม VAT เว้นแต่ระบุ) | Timeout/อายุ QR | คืนเงิน | Sandbox | ผู้สมัคร |
|---|---|---|---|---|---|---|---|
| QR PromptPay สร้างเอง (`promptpay-qr`) | library สร้าง payload แบบ offline | ไม่มี | 0 (library MIT) | **QR ไม่มีวันหมดอายุ** แอปต้องจัดการเอง | ร้านโอนคืนเอง | ไม่ต้องใช้ | ใครก็ได้ที่มี PromptPay |
| SlipOK | `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>` header `x-authorization` | ไม่มีสำหรับ API (มีผลิตภัณฑ์ LINE OA แยก) | ฟรี 100 สลิป/เดือน; 350฿/500; 600฿/1,000; 1,000฿/2,000; 2,580฿/6,000 | ไม่เกี่ยว (ตรวจหลังจ่าย); มี error 1010 "Delay Slip" | ไม่เกี่ยว | ใช้แผนฟรีทดสอบ | บุคคลทั่วไป และผู้ประกอบการ |
| EasySlip v2 | `POST https://api.easyslip.com/v2/verify/bank` แบบ Bearer (sync) + `/verify/bank/async` | **มี** (async + HMAC-SHA256) | 99฿/250 ครั้ง/30 วัน; 350฿/1,000; ... | ไม่เกี่ยว; มี `SLIP_PENDING` (BBL ภายใน 5 นาที) | ไม่เกี่ยว | ทดลองใช้ฟรี (ตามหน้าราคา) | บุคคลธรรมดา และนิติบุคคล |
| Omise (Opn) PromptPay | `POST /charges` + `source[type]=promptpay` | **มี** `charge.complete` (HMAC-SHA256) | 1.65%/รายการ; ถอนเงิน 20฿/ครั้ง (≤2 ล้าน) | ค่าเริ่มต้น 24 ชม.; ตั้ง `expires_at` ได้ไม่เกิน 24 ชม.; สถานะ `expired` | **ไม่รองรับ** void/refund สำหรับ PromptPay | มี test mode (กด mark Successful/Failed ได้) | บุคคลธรรมดา และนิติบุคคล (ต้องทำ KYC) |
| Stripe PromptPay | PaymentIntent `currency=thb` → แสดง QR | **มี** `payment_intent.succeeded` | 1.65%/รายการ; คืนเงินครั้งละ 10฿ | ไม่พบค่าตายตัวในเอกสารที่อ่าน | **รองรับ** ทั้งเต็มจำนวนและบางส่วน (ลูกค้าต้องแจ้งเลขบัญชีรับเงินคืน) | มี sandbox และปุ่ม "Simulate scan" | บุคคลธรรมดา, เจ้าของคนเดียว, ห้างหุ้นส่วน, บริษัท |
| Xendit (รวม GB Prime Pay เดิม) | `POST /v3/payment_requests` `channel_code` PromptPay, `qr_string_type: DYNAMIC` | **มี** | หน้าราคาทางการเปิดไม่ได้ (403) — ยืนยันไม่ได้ | ตั้ง `channel_properties.expires_at` ได้; สถานะ `EXPIRED` | ตาราง channel ระบุ "Refund Validity 30 วัน" แต่ช่อง Refund เป็น "-" — **ข้อมูลไม่ชัด** | มี test mode และ simulate payment | บุคคลธรรมดาได้เฉพาะ "XP sub-account" |
| GB Prime Pay QR Cash (API เดิม) | form POST `token, referenceNo, amount, backgroundUrl` → `/v3/qrcode` | **มี** (postback ไปที่ `backgroundUrl`, `resultCode=00`) | ยืนยันจากแหล่งทางการไม่ได้ | ไม่พบใน doc | หัวข้อ Void & Refunds ของ QR Cash ว่าง ("-") | มีบัตรทดสอบ UAT (ฝั่งบัตร) | ต้องส่งอีเมลขอเปิด QR Cash |
| 2C2P | Payment Token → Do Payment (channel `THQR`) | **มี** `backendReturnUrl` + Inquiry API | ต้องขอใบเสนอราคา (ไม่ประกาศ) | มีฟิลด์ `expiration` แต่ไม่ระบุค่า | ไม่พบในหน้า QR | มี sandbox | ไม่พบเงื่อนไขในหน้าที่อ่าน |
| SCB Developer (Thai QR Tag 30) | OAuth → `POST .../v1/payment/qrcode/create` (`qrType=PP`, `ppId`=Biller ID 15 หลัก, `ref1`, `ref3`) | **มี** Payment Confirmation callback | ไม่พบในเอกสาร dev | QR30 ไม่มีฟิลด์ expiry (มีแค่ QR CS: `csExtExpiryTime` ค่าเริ่มต้น 15 นาที) | ไม่พบ (มี "void QR") | มี sandbox + แอป simulator | ต้องมี **Biller ID** กับ SCB |
| KBank K API (QR Payment / Slip Verification) | portal เป็น SPA ที่ต้องรัน JavaScript จึงอ่านสเปกไม่ได้ | หน้า API Reference มีหัวข้อ "WebHook Notify API for QR Payment" | ไม่พบ | ไม่พบ | ไม่พบ | ไม่ยืนยัน | ไม่ยืนยัน |

## รายละเอียดทีละตัวเลือก

### A1. QR PromptPay แบบใส่ยอดเงิน ที่สร้างเอง

- มาตรฐาน Thai QR Code ของ ธปท. อิงกับ EMVCo QR ([แนวนโยบาย Thai QR Code — ธปท.](https://www.bot.or.th/content/dam/bot/documents/th/our-roles/payment-systems/about-payment-systems/ThaiQRCode_Payment_Standard.pdf))
- library [`promptpay-qr`](https://github.com/dtinth/promptpay-qr) (MIT) สร้าง payload ได้ด้วย `generatePayload(id, { amount })` ตามสเปก EMV QRCPS Merchant Presented Mode แต่ **ไม่มีการยืนยันการชำระเงิน** และ payload จะมีเลข PromptPay ของร้านอยู่ด้วย
- **การเทียบกับ contract:** `qrPayload` = payload ที่สร้างได้, `providerRef` = `paymentId` ของเราเอง, ส่วน `expiresAt` บังคับได้**เฉพาะในแอป** เพราะตัว QR ไม่มีวันหมดอายุ ลูกค้าจึงยังโอนเงินหลังหมดเวลาได้ ต้องมีกฎรองรับว่าเงินที่เข้ามาหลัง intent หมดอายุจะทำอย่างไร (เช่น ส่งให้ Admin ตรวจ หรือโอนคืนเอง)
- ใช้คนเดียวไม่ได้ ต้องใช้คู่กับ slip API (A2/A3) หรือให้ Admin ตรวจด้วยมือ
- ข้อจำกัดของแนวทางนี้: ร้านจับคู่เงินกับคำสั่งซื้อได้จาก**ยอดเงิน + บัญชีผู้รับ + เวลา + transRef ที่ไม่ซ้ำ** เท่านั้น เพราะ PromptPay แบบบุคคลไม่มี reference ของคำสั่งซื้อติดไปด้วย ถ้ามีสองคำสั่งซื้อยอดเท่ากันในช่วงเวลาใกล้กัน ระบบจะแยกไม่ออกว่าสลิปไหนเป็นของคำสั่งซื้อไหน ต้องอาศัยการที่ลูกค้าอัปโหลดสลิปผ่านหน้าคำสั่งซื้อของตนเอง

### A2. SlipOK

- Endpoint: `POST https://api.slipok.com/api/line/apikey/<YOUR_BRANCH_ID>` header `x-authorization: <API_KEY>` ส่งข้อมูลสลิปได้ 3 แบบ: `data` (ค่าจาก QR บนสลิป), `files` (รูป jpg/png/jfif/webp) หรือ `url` มีฟิลด์เสริม `amount` (ตรวจยอด) และ `log` (`true` = ตรวจกับบัญชีที่ผูกไว้ + เก็บไว้กันสลิปซ้ำ) ([Check Slip](https://slipok.com/api-documentation/check-slip/))
- Response: `data.success`, `data.transRef`, `transDate`, `transTime`, `amount`, `receivingBank`, `sendingBank`, `sender`, `receiver` (เลขบัญชีถูก mask)
- Error codes ที่เกี่ยวกับการตัดสินใจ: `1012` สลิปซ้ำ, `1013` ยอดไม่ตรง, `1014` ผู้รับไม่ตรง, `1010` Delay Slip ([API Documentation v1.8](https://slipok.com/api-documentation/))
- มีแผนฟรี 100 สลิป/เดือน ถ้าจ่ายรายปีลด 30% และโควตาที่เหลือยกไปเดือนถัดไปได้ภายในปีนั้น สมัครได้ทั้งแบบ "บุคคลทั่วไป" และ "ผู้ประกอบการ" ([slipok.com](https://slipok.com/))
- ไม่พบ webhook สำหรับ API (ผลกลับมาแบบ synchronous) และไม่พบ sandbox แยก ใช้แผนฟรีทดสอบแทน
- **การเทียบกับ `verifySlip`:** ตรงกันเกือบทั้งหมด
  - `success` ⇐ `data.success` + ยอดตรง + ผู้รับตรง + `transRef` ยังไม่เคยถูกใช้ในฐานข้อมูลเรา
  - `fail` ⇐ 1012/1013/1014 หรือสลิปไม่ถูกต้อง
  - `ambiguous` ⇐ 1010, timeout, 5xx หรือโควตาหมด
  - ข้อควรระวัง: ตอนนี้ `slipRef` เป็น string ถ้าต้องส่งรูป ต้องเปลี่ยน signature (หรือให้ frontend อ่าน QR จากสลิปแล้วส่ง `data` มาแทน)

### A3. EasySlip API v2

- `POST https://api.easyslip.com/v2/verify/bank` ใช้ Bearer token รองรับ IP whitelist ส่งได้ทั้ง payload, รูป, Base64 และ URL ([ภาพรวม v2](https://document.easyslip.com/th/v2/))
- Body (แบบ payload): `payload` (1–128 ตัวอักษร), `remark`, `matchAccount`, `matchAmount`, `checkDuplicate` (ค่าเริ่มต้น `false` **ต้องเปิดเอง**) Response: `isDuplicate`, `amountInSlip`, `matchedAccount`, `rawSlip.transRef`, `rawSlip.date`, `rawSlip.receiver` ([Verify by payload](https://document.easyslip.com/en/v2/verify/bank/payload))
- Error: `VALIDATION_ERROR`, `SLIP_NOT_FOUND`, `SLIP_PENDING` (สลิป BBL ที่โอนมาไม่ถึง 5 นาทีอาจต้อง retry), `QUOTA_EXCEEDED`, `INVALID_API_KEY`
- **Async + Webhook:** `POST /verify/bank/async` และ `/verify/bank/batch` (รับเฉพาะ payload ธนาคาร) ส่งผลกลับไปที่ `callbackUrl` พร้อม header `X-EasySlip-Signature: sha256=<hmac>` ซึ่งเป็น HMAC-SHA256 ของ raw body ระบบ retry การตรวจ 4 ครั้ง (รวมประมาณ 7.5 นาที) retry การส่ง callback 3 ครั้ง timeout ครั้งละ 5 วินาที และดึงสถานะ job ย้อนหลังได้ประมาณ 7 วัน handler ต้อง idempotent โดยกันซ้ำด้วย `jobId` ([Webhook Callback](https://document.easyslip.com/en/v2/async/webhook))
- ราคา: Start 99฿/250 ครั้ง, Basic 350฿/1,000, Starter 700฿/2,500 ... (อายุโควตา 30 วัน) รองรับทั้ง**บุคคลธรรมดาและนิติบุคคล** ([api-products](https://easyslip.com/api-products/))
- **การเทียบกับ `verifySlip`:** ตรงกันแบบเดียวกับ SlipOK โดย `SLIP_PENDING`/`API_SERVER_ERROR`/`QUOTA_EXCEEDED` → `ambiguous` ถ้าใช้โหมด async ผลจะไม่กลับมาทันที ต้องมีสถานะ "รอผล" และเมธอดสำหรับรับ webhook

### B1. Omise (Opn Payments) — PromptPay

- สร้าง charge: `POST https://api.omise.co/charges` ด้วย `amount` (หน่วยสตางค์), `currency=THB`, `source[type]=promptpay` QR อยู่ที่ `charge.source.scannable_code.image.download_uri` (**เป็น URL รูป** ไม่ใช่ string payload) ยอดขั้นต่ำ 20฿ สูงสุด 150,000฿ ต้องอีเมลขอเปิด PromptPay กับ support ก่อน ([PromptPay docs](https://docs.omise.co/promptpay))
- **อายุ QR:** ค่าเริ่มต้น 24 ชม. ขอ support เปลี่ยนค่าเริ่มต้นได้ (เช่น 5 นาที) หรือส่ง `expires_at` ต่อ charge ได้ ไม่เกิน 24 ชม. สถานะที่เป็นไปได้: `pending`, `successful`, `failed`, `expired`
- **Webhook:** `charge.complete` (มี `charge.expire` ด้วย) ลงชื่อด้วย `Omise-Signature` + `Omise-Signature-Timestamp` (HMAC-SHA256 ของ `<timestamp>.<raw body>`) **Omise ไม่รับประกันว่าจะ retry เมื่อส่งไม่สำเร็จ** และแนะนำให้ GET charge ซ้ำเพื่อยืนยันผล ([Webhooks API](https://docs.omise.co/api-webhooks))
- **คืนเงิน:** "PromptPay charges cannot be voided or refunded through Omise" ต้องโอนคืนนอกระบบ
- Test mode: เข้า Dashboard แล้วกด Actions → mark Successful/Failed ได้
- ค่าธรรมเนียม: PromptPay 1.65%/รายการ ถอนเงิน 20฿/รายการ (≤2 ล้าน) ราคาไม่รวม VAT 7% ([ราคา](https://www.omise.co/th/pricing/thailand))
- สมัครได้ทั้ง**บุคคลธรรมดา** (บัตรประชาชน + เซลฟีคู่บัตร + หน้าสมุดบัญชีชื่อตรงกัน) และ**นิติบุคคล** (หนังสือรับรอง ฯลฯ) ต้องมี**เว็บไซต์ที่ใช้งานได้และแสดงนโยบายคืนเงิน** ทีม KYC ตอบกลับภายใน 30 วันทำการ ([Enable live account](https://docs.omise.co/how-do-i-enable-live-account?selected_country=thailand))
- **การเทียบกับ contract:** `createIntent` ตรง (`providerRef` = charge id, `expiresAt` ส่งต่อได้ถ้า ≤ 24 ชม., `qrPayload` = URL รูป หรือต้องเปลี่ยนชื่อฟิลด์ให้สื่อความหมาย) ส่วน `verifySlip` **ใช้ไม่ได้** ต้องเพิ่ม `parseWebhook` + `retrieveStatus`

### B2. Stripe — PromptPay

- เปิดใช้ได้เฉพาะบัญชี Stripe ที่จดในไทย (TH) สกุล THB สร้าง PaymentIntent (`amount`, `currency=thb`) แล้วยืนยันด้วย `stripe.confirmPromptPayPayment` เมื่อจ่ายแล้วจะได้ webhook `payment_intent.succeeded` ([Accept a PromptPay payment](https://docs.stripe.com/payments/promptpay/accept-a-payment.md?payment-ui=direct-api))
- **คืนเงิน:** รองรับทั้งเต็มจำนวนและบางส่วน Stripe จะอีเมลขอเลขบัญชีจากลูกค้าเอง ถ้าลูกค้าสแกน QR เดิมจ่ายซ้ำ เงินส่วนเกินจะเข้า balance ของร้าน และร้านต้องคืนเงินเองนอก Stripe ([PromptPay overview](https://docs.stripe.com/payments/promptpay))
- Sandbox มีปุ่ม **Simulate scan** ให้กดอนุมัติหรือทำให้ล้มเหลวได้
- ค่าธรรมเนียม 1.65% ต่อ PromptPay transfer ที่สำเร็จ และ 10฿ ต่อการคืนเงิน ([Stripe TH pricing](https://stripe.com/en-th/pricing))
- สมัครได้ 5 แบบ: บริษัท, ห้างหุ้นส่วนจดทะเบียน, ห้างหุ้นส่วนสามัญไม่จดทะเบียน, กิจการเจ้าของคนเดียว และ**บุคคลธรรมดา** ต้องมีเว็บไซต์หรือช่องทางอื่นแทน (เช่น social) และบัญชีธนาคาร THB ([Stripe Support](https://support.stripe.com/questions/what-information-is-required-to-open-a-stripe-account-in-thailand))
- ไม่พบอายุ QR ที่ระบุชัดในหน้าที่อ่าน ต้องตรวจเพิ่มในฟิลด์ `next_action` ของ API reference หากเลือกใช้ ระหว่างนี้ใช้การ cancel PaymentIntent เมื่อครบเวลาแทน
- **การเทียบกับ contract:** `providerRef` = PaymentIntent id แต่ flow ที่เอกสารแนะนำให้ Stripe.js เป็นผู้แสดง QR จึงต่างจากแนวคิด `qrPayload` ที่ backend ส่งให้ frontend ต้องมี `parseWebhook` เช่นเดียวกับ Omise

### B3. Xendit (เจ้าของ GB Prime Pay ปัจจุบัน)

- `www.gbprimepay.com` **redirect ไปที่ xendit.co/en-th** แล้ว (ตรวจเมื่อ 17 ก.ย. 2569) ตรงกับที่แหล่งข่าวรองระบุว่า Xendit ซื้อ GB Prime Pay ในปี 2022 ([PitchBook](https://pitchbook.com/profiles/company/561638-08)) ดังนั้นถ้าจะสมัครรายใหม่ ควรถาม Xendit ว่าจะให้ใช้ API ชุดใด
- Payments API v3: `POST /v3/payment_requests` ด้วย `reference_id`, `type: "PAY"`, `country: "TH"`, `currency: "THB"`, `request_amount`, `channel_code` (ตัวอย่างใน API ใช้ `QRPROMPTPAY` แต่หน้า channel เขียนว่า `PROMPTPAY` ต้องตรวจอีกครั้ง), `channel_properties.expires_at`, `qr_string_type: "DYNAMIC"` Response มี `actions[]` ที่ `descriptor: "QR_STRING"` สถานะ: `ACCEPTING_PAYMENTS`, `REQUIRES_ACTION`, `AUTHORIZED`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELED` ([Create payment request](https://docs.xendit.co/apidocs/create-payment-request.md))
- PromptPay: ยอด 1–700,000฿ ประมวลผลและ settle แบบ INSTANT ตั้ง expiry ได้ ([QR PromptPay](https://docs.xendit.co/docs/qr-promptpay.md)) มี API ยกเลิก, refund, webhook และ simulate ใน test mode ([llms.txt index](https://docs.xendit.co/llms.txt))
- **ผู้สมัคร:** "Individual applications are only allowed if they are XP sub-accounts" หมายความว่าบุคคลธรรมดาสมัครบัญชีหลักตรงไม่ได้ ([Thailand business documents](https://docs.xendit.co/docs/thailand-business-documents.md))
- ค่าธรรมเนียม: หน้า `xendit.co/en-th/pricing` ตอบ 403 อ่านไม่ได้ ผลค้นหาระบุ "2.50% ขั้นต่ำ 10฿ + processing 7฿" แต่**ยังยืนยันกับแหล่งทางการไม่ได้**
- **การเทียบกับ contract:** ตรงที่สุดในกลุ่ม gateway เพราะได้ QR เป็น string, `providerRef` = `payment_request_id` และรับ `expires_at` ได้ ยังต้องเพิ่ม `parseWebhook`

### B4. GB Prime Pay — QR Cash (API เดิม)

- จาก bundle ของ [doc.gbprimepay.com](https://doc.gbprimepay.com/) (หน้าเว็บเป็น SPA): ส่ง form POST `token`, `referenceNo`, `amount`, `backgroundUrl` ไปที่ `https://api.globalprimepay.com/v3/qrcode` (หรือ `/v3/qrcode/text`) ผลส่งไปที่ `backgroundUrl` พร้อมฟิลด์ `amount`, `referenceNo`, `gbpReferenceNo`, `currencyCode`, `resultCode` (`00` = Approved), `paymentType` (`Q` = QR Cash)
- ต้องอีเมลขอเปิด QR Cash และยอมรับเงื่อนไขเพิ่ม หัวข้อ "Void & Refunds" และ "Limit" ของ QR Cash เป็น "-" ส่วนการคืนเงินใน Getting Started พูดถึงเฉพาะบัตรเครดิต
- ไม่พบฟิลด์ expiry และไม่พบการลงชื่อ postback ต้องเรียก Query API ตรวจซ้ำ
- ค่าธรรมเนียม "QR 0.5%" ที่พบมาจาก blog ของบุคคลที่สาม **ไม่ใช่แหล่งทางการ**

### B5. 2C2P

- Flow: ขอ Payment Token (merchant ID, invoice, amount, currency) → Do Payment ด้วย channel code (เช่น `THQR`) → ได้ URL รูป QR → รอ `backendReturnUrl` (webhook) หรือ poll Payment Inquiry มี sandbox ([QR Payment](https://developer.2c2p.com/docs/direct-api-method-qr-payment))
- ไม่ประกาศราคา ต้องติดต่อฝ่ายขาย หน้า QR ไม่พูดถึงการคืนเงินและเงื่อนไขผู้สมัคร เหมาะกับธุรกิจขนาดกลางถึงใหญ่มากกว่า (ประเมินจากโมเดลการขายที่ต้องขอใบเสนอราคา)

### C1. SCB Developer — Thai QR Tag 30

- Flow: ขอ token → สร้าง QR → รับ Payment Confirmation → ตรวจสลิปหรือ inquiry (`POST /v3/payment/billpayment/inquiry`) → (void QR ถ้าต้องการ) ([Thai QR](https://developer.scb/assets/documents/documentation/qr-payment/thai-qr.html))
- สร้าง QR ด้วย `qrType=PP`, `ppType=BILLERID`, `ppId` (**Biller ID 15 หลัก**), `amount`, `ref1`, `ref3` (prefix) — QR30 ไม่มีฟิลด์ expiry มีแต่ QR CS ที่มี `csExtExpiryTime` (ค่าเริ่มต้น 15 นาที) ([QR create](https://developer.scb/assets/documents/api-reference-index/qr-payments/post-qrcode-create.html))
- Callback: ส่งฟิลด์ `transactionId`, `amount`, `billPaymentRef1/2/3`, `payeeProxyId` ฯลฯ ร้านต้องตอบ `resCode: "00"` ถ้าไม่ตอบ SCB จะ retry 3 ครั้ง ห่างกันครั้งละ 12 วินาที แล้วส่งอีเมลแทน callback ต้องเป็น HTTPS ที่มี cert ถูกต้อง และลงทะเบียนต่อ Biller ID + Ref3 ([Payment confirmation](https://developer.scb/assets/documents/documentation/qr-payment/payment-confirmation.html))
- Sandbox: มีแอป simulator (SCB Easy Simulator / แม่มณี Simulator)
- ต้องมี Biller ID จาก SCB (ปกติเป็นบริการสำหรับธุรกิจ) เอกสารสำหรับนักพัฒนาไม่ได้ระบุค่าธรรมเนียมและเงื่อนไขว่าบุคคลธรรมดาสมัครได้หรือไม่ ต้องถามสาขาหรือ RM
- **การเทียบกับ contract:** `providerRef` = ref1/transactionId ส่วน `expiresAt` ต้องบังคับฝั่งแอป (หรือเรียก void QR) และต้องเพิ่ม `parseWebhook`

### C2. KBank K API

- หน้าผลิตภัณฑ์ [QR Payment](https://apiportal.kasikornbank.com/product/public/LandingPage/QR%20Payment/Introduction/1) และ [Slip Verification](https://apiportal.kasikornbank.com/product/public/All/Slip%20Verification/Introduction) แสดงผลด้วย JavaScript จึงดึงเนื้อหามาอ่านไม่ได้ ในเมนู API Reference มีหัวข้อ "WebHook Notify API for QR Payment" และ "Inquiry QR Transaction API" ([K PAYMENT GATEWAY API Reference](https://apiportal.kasikornbank.com/product/content/All/K%20PAYMENT%20GATEWAY/API%20Reference))
- **ยังยืนยันไม่ได้**ว่าต้องเป็นนิติบุคคลหรือไม่ ค่าธรรมเนียมเท่าไร และเงื่อนไข sandbox เป็นอย่างไร ต้องเปิด portal ในเบราว์เซอร์หรือติดต่อ KBank

## ตัวอย่างค่าธรรมเนียมต่อคำสั่งซื้อ (คำนวณเอง)

สมมติคำสั่งซื้อ 60฿ และ 300 คำสั่งซื้อต่อเดือน (ตัวเลขสมมติ ยังไม่ได้ยืนยันกับร้าน)

| ตัวเลือก | ต่อรายการ | ต่อเดือน (ประมาณ) | หมายเหตุ |
|---|---:|---:|---|
| SlipOK แผนฟรี | 0฿ | 0฿ ถ้าไม่เกิน 100 สลิป | 300 สลิปเกินแผนฟรี ต้องใช้ Start 350฿ |
| EasySlip | ~0.35–0.40฿ | 350฿ (Basic) หรือ 99฿×2 | โควตาหมดอายุใน 30 วัน |
| Omise | 0.99฿ + VAT ≈ 1.06฿ | ≈ 318฿ + ค่าถอน 20฿/ครั้ง | ยอดขั้นต่ำต่อ charge 20฿ |
| Stripe | 0.99฿ (+ภาษีตามเงื่อนไข) | ≈ 297฿ | คืนเงินครั้งละ 10฿ |

แนวทาง A ลูกค้าต้องอัปโหลดสลิปเอง ส่วนแนวทาง B และ C ไม่ต้อง การเลือกจึงต้องชั่งระหว่างต้นทุน ประสบการณ์ของลูกค้า และภาระของ Admin

## Trade-off เทียบกับ requirement

| ประเด็น | A (QR สร้างเอง + slip API) | B (gateway) | C (ธนาคารตรง) |
|---|---|---|---|
| FR-PAY-002 ยืนยันก่อนเข้าคิว | ได้ แต่ขึ้นกับการอัปโหลดสลิป และมีเคส `ambiguous` บ่อยกว่า | ได้จาก webhook + GET ยืนยัน | ได้จาก callback + inquiry |
| FR-PAY-003 กันซ้ำด้วยเลขอ้างอิง | ใช้ `transRef` (unique) | ใช้ charge/payment id + event id | ใช้ `transactionId` |
| Timeout ของ intent | บังคับได้เฉพาะในแอป ลูกค้ายังจ่ายหลังหมดเวลาได้ | ฝั่ง provider ทำให้ QR หมดอายุจริง (Omise ≤ 24 ชม., Xendit `expires_at`) | QR30 ต้องจัดการเอง / void |
| การคืนเงิน | ร้านโอนคืนเอง | Omise: ไม่รองรับ PromptPay; Stripe: รองรับ; Xendit: ไม่ชัด | ไม่พบในเอกสาร |
| ผู้สมัคร | บุคคลธรรมดาได้ | Omise/Stripe: บุคคลธรรมดาได้; Xendit: ไม่ได้ (ยกเว้น sub-account) | น่าจะต้องเป็นธุรกิจ (ยังไม่ยืนยัน) |
| ความพร้อมของโครงงาน (มี sandbox) | ใช้แผนฟรีหรือทดลอง | Omise/Stripe/Xendit มี test mode ชัดเจน | SCB มี sandbox, KBank ไม่ยืนยัน |
| การแก้ contract | แทบไม่ต้องแก้ (`verifySlip` ตรง) | ต้องเพิ่ม `parseWebhook`/`getStatus` | ต้องเพิ่ม `parseWebhook`/`getStatus` |
| เงินเข้าบัญชีร้าน | ทันที | ผ่าน settlement ของ gateway (Xendit ระบุ instant) | ทันที |

## คำถามที่ต้องให้เจ้าของร้านหรืออาจารย์ตอบ (ต่อจาก §12 ข้อ 6)

1. ร้านจดทะเบียนพาณิชย์หรือเป็นนิติบุคคลหรือไม่ มีบัญชีร้านค้าหรือ Biller ID กับธนาคารใดอยู่แล้วหรือไม่
2. ยอมให้ลูกค้าต้องอัปโหลดสลิปหรือไม่ หรือต้องการให้ยืนยันอัตโนมัติโดยไม่ต้องอัปโหลด
3. ยอมรับค่าธรรมเนียมเป็นเปอร์เซ็นต์ต่อรายการได้หรือไม่ หรือต้องการค่าใช้จ่ายรายเดือนแบบตายตัว
4. นโยบายคืนเงิน: คืนผ่านระบบ หรือให้ร้านโอนคืนเอง
5. Timeout ของคำสั่งซื้อที่ยังไม่จ่ายควรนานเท่าไร (เช่น 10–15 นาที) และถ้าเงินเข้ามาหลังหมดเวลาจะทำอย่างไร
6. มีเว็บไซต์สาธารณะที่แสดงนโยบายคืนเงินหรือยัง (Omise บังคับ)

## ข้อสังเกตต่อเอกสารเดิม

เทียบกับ [`payment-verification-api.md`](./payment-verification-api.md):

- เอกสารเดิมบอกว่า SlipOK "รับ API key หลังลงทะเบียนธุรกิจ" แต่หน้าแรกของ slipok.com ปัจจุบันมีเส้นทางสมัครแบบ "บุคคลทั่วไป" ด้วย
- เอกสารเดิมไม่ได้ระบุว่า **Omise ไม่รองรับ void/refund ของ PromptPay** และไม่ได้ระบุว่า Omise **ไม่รับประกันการ retry webhook**
- EasySlip v2 มี **async + webhook** แล้ว (เอกสารเดิมเขียนว่าเป็น synchronous) และ `checkDuplicate` มีค่าเริ่มต้นเป็น `false`
- GB Prime Pay ถูกรวมเข้ากับ Xendit แล้ว

## แหล่งอ้างอิงหลัก

- Omise: [PromptPay](https://docs.omise.co/promptpay), [Webhooks](https://docs.omise.co/api-webhooks), [Pricing TH](https://www.omise.co/th/pricing/thailand), [Live account](https://docs.omise.co/how-do-i-enable-live-account?selected_country=thailand)
- Stripe: [PromptPay](https://docs.stripe.com/payments/promptpay), [Accept a payment](https://docs.stripe.com/payments/promptpay/accept-a-payment.md?payment-ui=direct-api), [Pricing TH](https://stripe.com/en-th/pricing), [Account requirements TH](https://support.stripe.com/questions/what-information-is-required-to-open-a-stripe-account-in-thailand)
- Xendit: [Create payment request](https://docs.xendit.co/apidocs/create-payment-request.md), [QR PromptPay](https://docs.xendit.co/docs/qr-promptpay.md), [TH business documents](https://docs.xendit.co/docs/thailand-business-documents.md)
- GB Prime Pay: [doc.gbprimepay.com](https://doc.gbprimepay.com/)
- 2C2P: [QR Payment](https://developer.2c2p.com/docs/direct-api-method-qr-payment)
- SCB: [Thai QR](https://developer.scb/assets/documents/documentation/qr-payment/thai-qr.html), [QR create](https://developer.scb/assets/documents/api-reference-index/qr-payments/post-qrcode-create.html), [Payment confirmation](https://developer.scb/assets/documents/documentation/qr-payment/payment-confirmation.html)
- KBank: [K API portal](https://apiportal.kasikornbank.com/product)
- SlipOK: [API docs](https://slipok.com/api-documentation/), [Check Slip](https://slipok.com/api-documentation/check-slip/), [ราคา](https://slipok.com/)
- EasySlip: [v2](https://document.easyslip.com/th/v2/), [Verify payload](https://document.easyslip.com/en/v2/verify/bank/payload), [Webhook](https://document.easyslip.com/en/v2/async/webhook), [ราคา](https://easyslip.com/api-products/)
- ธปท.: [Thai QR Code Payment Standard](https://www.bot.or.th/content/dam/bot/documents/th/our-roles/payment-systems/about-payment-systems/ThaiQRCode_Payment_Standard.pdf); library: [dtinth/promptpay-qr](https://github.com/dtinth/promptpay-qr)
