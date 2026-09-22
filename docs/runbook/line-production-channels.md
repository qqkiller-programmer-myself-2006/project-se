# Runbook: LINE channels และ production credentials (Ticket 03)

เอกสารนี้กำหนดสิ่งที่ repo รองรับและรายการที่ต้องยืนยันใน LINE Console/กับ Owner
ก่อนเปิด staging หรือ production โดยไม่เก็บ credential จริงไว้ใน repository

## 1. Provider/channel matrix

| Environment | LINE Login/LIFF channel | Official Account/Messaging channel | Callback | Credentials |
|---|---|---|---|---|
| development | channel dev | OA/channel สำหรับ dev ที่ Owner อนุมัติ | `http://localhost:<port>/api/customers/line/callback` เท่านั้น | dev เท่านั้น |
| staging | channel staging | OA/channel สำหรับ staging ที่แยกจาก production | HTTPS exact URL ที่ Owner ลงทะเบียนและ allowlist | staging เท่านั้น |
| production | channel production | OA/channel production ที่ Owner อนุมัติ | HTTPS exact URL ของ production | production เท่านั้น |

Ticket 01 แนะนำ DigitalOcean App Platform + DigitalOcean Managed MySQL สำหรับ runtime
เท่านั้น ไม่ได้เลือกหรืออนุมัติ LINE provider/channel ให้แทน Owner. ห้ามใช้ channel,
secret, access token, callback หรือ LINE user ID ข้ามแถวในตารางนี้.

## 2. Environment input contract

ตั้งค่าผ่าน secret/environment configuration ของ environment นั้น ไม่ commit ค่าใด ๆ:

- `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LINE_REDIRECT_URI`: จำเป็นสำหรับ Login/LIFF
  callback; backend fail-fast เมื่อสามค่านี้ไม่ครบ
- `LINE_CHANNEL_ACCESS_TOKEN`: จำเป็นเมื่อเปิด Official Account/Messaging notification
  หรือ flow ที่ต้องใช้ channel token; ต้องมาจาก channel เดียวกับ OA ที่ยืนยันแล้ว
- `CUSTOMER_UI_URL`: base URL ของเว็บ environment เดียวกันสำหรับ redirect หลัง callback
- `LINE_TOKEN_ENCRYPTION_KEY`: ยังไม่ใช้สำหรับ flow ปัจจุบัน เพราะระบบไม่ persist user access
  token ระยะยาว; ห้ามตั้งค่าแทนการออกแบบ deauthorization ที่ผ่านการอนุมัติ

ห้ามใช้ production secret ใน development/staging และห้ามใช้ `TEST_DATABASE_URL` หรือ
ฐานข้อมูล staging เป็น production `DATABASE_URL`.

## 3. Callback and identity constraints

1. ลงทะเบียน callback แบบ exact match ทุกตัวอักษร รวม scheme, host, path และ trailing slash.
2. development ใช้ HTTP ได้เฉพาะ localhost; staging และ production ต้อง HTTPS ที่ certificate
   ใช้งานได้ และต้องอยู่ใน allowlist ของ LINE Console/ผู้ให้บริการที่เกี่ยวข้อง.
3. ตรวจ `state`, PKCE verifier/challenge, nonce, code expiry/reuse และ OIDC claims
   (`iss`, `aud`, `exp`, `nonce`, `sub`) ใน staging ก่อน promote.
4. `sub`/LINE user ID ต้องมาจาก claims ที่ LINE verify แล้วเท่านั้น ห้ามรับจาก request body,
   query หรือฟอร์มเป็นหลักฐาน identity.
5. บันทึกเฉพาะผลลัพธ์ที่ redacted; ห้าม log secret, token, authorization code, nonce,
   verifier หรือ LINE subject.

## 4. Acceptance matrix ก่อนเปิดใช้งาน

| Flow | หลักฐานที่ต้องเก็บ | สถานะ repo |
|---|---|---|
| Login/LIFF callback | staging test ด้วย channel จริง, callback 200/redirect ถูกต้อง | รองรับ contract; ยังรอ Owner credentials |
| Link account | verified identity, duplicate link ถูกปฏิเสธ, audit ไม่ซ้ำ | มี implementation/tests; ยังรอ staging smoke |
| Notification | OA/channel จริง, success, timeout/failure, retry และไม่ส่งซ้ำไม่สิ้นสุด | fake provider เท่านั้นใน repo; real Messaging integration ยังเป็น Ticket 07 |
| Deauthorization/unlink | เจ้าของยืนยันการถอนสิทธิ์ และผลลัพธ์ไม่ลบ local link เมื่อ provider deauthorize ไม่สำเร็จ | deauthorize จริงยังไม่ผ่าน: implementation ปัจจุบัน fail ชัดเจนเพราะไม่ persist user access token |
| Identity/consent | verified identity, privacy/consent และ account deletion policy ที่ Owner อนุมัติ | ต้อง Owner/legal/product acceptance |

## 5. Owner inputs and external blockers

Owner ต้องจัดหาและอนุมัติสิ่งต่อไปนี้นอก repo:

- LINE provider account และ channel IDs ของ dev/staging/production; ความสัมพันธ์กับ Official Account;
- channel secret และ channel access token ผ่าน secret manager/หน้าตั้งค่า environment เท่านั้น;
- domain/DNS ของเว็บและ callback, ผู้มีสิทธิ์แก้ DNS, และ allowlist ของ HTTPS callback;
- verified identity/Official Account ที่ใช้ทดสอบ และรายชื่อ tester ของ staging;
- อนุมัติข้อความ notification, consent/privacy notice, deauthorization/account deletion behavior;
- ผล smoke test จริงของ Login, link, notification, retry และ deauthorization ก่อน Ticket 07/09.

หากข้อใดข้างต้นยังไม่มี ให้คง Ticket 03 เป็น `ready-for-agent` หรือ `blocked` ตามสถานะ
การประสานงานจริง และห้ามทำเครื่องหมาย resolved จากเอกสารเพียงอย่างเดียว.
