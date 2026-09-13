# LINE Login/OIDC integration for Ticket 03

Research date: 2026-09-12  
Scope: บัญชีลูกค้าและการเชื่อม LINE สำหรับร้านป้าอ้ออาหารตามสั่ง  
Sources: LINE Developers documentation only

## Recommended integration

ใช้ LINE Login v2.1 แบบ OAuth 2.0 Authorization Code + OpenID Connect โดยให้ backend เป็นผู้เริ่ม flow, แลก authorization code และยืนยัน ID token ทั้งหมด

1. Backend สร้าง login transaction ที่มี `state`, `nonce`, `code_verifier`, วันหมดอายุ และ `used_at` แล้วเก็บค่าลับฝั่ง server (แนะนำเก็บ hash หากไม่จำเป็นต้องอ่านค่าต้นฉบับ; `code_verifier` ต้องอ่านกลับเพื่อแลก token จึงต้องเข้ารหัสหรือเก็บใน session ที่ป้องกันแล้ว)
2. Redirect ไป authorization endpoint พร้อม PKCE `S256` และ scope ขั้นต่ำ `openid profile`
3. Callback ตรวจ error, `peek` state แบบ exact/read-only (ไม่ mark used) เป็น pre-check ก่อนแลก code แล้ว consume transaction แบบ one-time atomic **พร้อม audit ของผลลัพธ์ใน seam เดียวหลังทราบผล** (สำเร็จ: link + consume + success audit; ล้มเหลว: consume + failure audit) — บันทึกการ implement จริงเลือกแบบนี้แทน consume-ก่อน-แลก-code เพราะการแลก code เป็น I/O ภายนอกที่เข้าร่วม DB transaction ไม่ได้ (consume ก่อนต้องชดเชยคืนซึ่งมีหน้าต่าง crash/replay; ดู rationale ใน README Ticket 03)
4. Backend แลก code โดยใช้ `redirect_uri` ค่าเดิมและ `code_verifier`
5. Backend ส่ง ID token ไป Verify ID token endpoint พร้อม expected `client_id` และ `nonce`
6. ใช้ `sub` จากผลที่ยืนยันแล้วเป็น LINE user ID; upsert ด้วย unique key `(provider, provider_subject)` แล้วออก local session ใหม่
7. Redirect ได้เฉพาะ internal allowlist; ห้ามรับปลายทาง arbitrary URL จาก request

LINE ระบุว่า authorization code มีอายุ 10 นาทีและใช้ได้ครั้งเดียว ส่วน `state` ต้องสุ่มใหม่ทุก attempt และตรวจให้ตรงก่อนแลก token ([web integration guide](https://developers.line.biz/en/docs/line-login/integrate-line-login/), [security checklist](https://developers.line.biz/en/docs/line-login/security-checklist/)).

## Current endpoints and parameters

### Authorization

`GET https://access.line.me/oauth2/v2.1/authorize`

Required parameters:

- `response_type=code`
- `client_id`: LINE Login Channel ID
- `redirect_uri`: URL-encoded callback ที่ลงทะเบียนใน Console; ใช้ HTTPS ใน production และต้องตรงกับ callback ที่ลงทะเบียน (อนุญาตเฉพาะ query parameters ที่ตั้งใจ)
- `state`: ค่าสุ่มที่คาดเดาไม่ได้ ไม่ซ้ำต่อ attempt และเก็บใน server session หรือ cookie ที่ same-origin ป้องกัน
- `scope`: แนะนำขั้นต่ำ `openid profile`; ขอ `email` เฉพาะเมื่อมี requirement และได้รับอนุมัติใน Console

Security parameters ที่ควรบังคับใช้:

- `nonce`: ค่าสุ่มต่อ attempt สำหรับผูก ID token และป้องกัน replay
- `code_challenge=BASE64URL(SHA256(code_verifier))`
- `code_challenge_method=S256`; LINE รองรับ PKCE เฉพาะ `S256`

`code_verifier` ต้องสุ่มตาม RFC 7636 ความยาว 43–128 ตัวอักษร และส่งเฉพาะตอนแลก token ([PKCE guide](https://developers.line.biz/en/docs/line-login/integrate-pkce/), [API reference](https://developers.line.biz/en/reference/line-login/)).

### Token exchange

`POST https://api.line.me/oauth2/v2.1/token` with `Content-Type: application/x-www-form-urlencoded`

Body: `grant_type=authorization_code`, `code`, `redirect_uri` ค่าเดียวกับ authorization request, `client_id`, `client_secret`, และ `code_verifier`. เก็บ Channel Secret ใน server-side secret/config เท่านั้น ([API reference](https://developers.line.biz/en/reference/line-login/)).

Response อาจมี access token อายุ 30 วัน, refresh token อายุสูงสุด 90 วัน และ ID token เมื่อขอ `openid`; backend ต้องทนต่อ response properties ใหม่หรือการเปลี่ยนลำดับ properties ในอนาคต ([API reference](https://developers.line.biz/en/reference/line-login/)).

## Callback and ID token validation

Callback ต้องรองรับทั้ง success (`code`, `state`) และ error response, ปฏิเสธ state ที่ไม่ตรง หมดอายุ หรือเคยใช้แล้ว และ consume transaction แบบ atomic **พร้อม audit ของผลลัพธ์หลัง exchange/verify** (peek ก่อนแลก code → link+consume+success audit หรือ consume+failure audit ใน seam เดียว). ห้ามเชื่อ `userId`, decoded profile หรือ redirect URL ที่ client ส่งมา ([web integration guide](https://developers.line.biz/en/docs/line-login/integrate-line-login/), [security checklist](https://developers.line.biz/en/docs/line-login/security-checklist/)).

### Recommended for Ticket 03: LINE verify endpoint

`POST https://api.line.me/oauth2/v2.1/verify` with form fields:

- `id_token`
- `client_id`: expected Channel ID
- `nonce`: expected nonce จาก login transaction

Endpoint ตรวจ signature และปฏิเสธ issuer, audience, expiry หรือ nonce ที่ผิด จากนั้นคืน verified claims. ระบบยังควรยืนยันว่า `iss` คือ `https://access.line.me`, `aud` คือ Channel ID, `exp` ยังไม่หมดอายุ และ `nonce` ตรงกับ attempt ก่อนใช้ `sub` ([Verify ID token reference](https://developers.line.biz/en/reference/line-login/), [ID token guide](https://developers.line.biz/en/docs/line-login/verify-id-token/)).

### Local verification alternative

ต้อง pin algorithm แทนการเชื่อค่า `alg` จาก token:

- Web Login: `HS256`, ตรวจด้วย Channel Secret
- Native SDK/LIFF: `ES256`, เลือก public key ตาม `kid` จาก JWK document; JWKS ปัจจุบันคือ `https://api.line.me/oauth2/v2.1/certs`

ดังนั้น JWKS-only verifier ไม่รองรับ ID token จาก web login. ไม่ว่าจะตรวจแบบ local หรือ endpoint ต้องตรวจ signature, `iss`, `aud`, `exp` และ expected one-time `nonce` ([ID token guide](https://developers.line.biz/en/docs/line-login/verify-id-token/)). สำหรับรุ่นแรกเลือก verify endpoint เพื่อลดความเสี่ยงการ implement crypto ผิด และซ่อน provider call หลัง injectable adapter เพื่อให้ทดสอบได้

## Identity and data minimization

- ใช้ verified `sub` เป็น external identity; LINE ระบุว่า user ID เปลี่ยนไม่ได้ ส่วน display name, picture และ status เปลี่ยนได้จึงห้ามใช้เป็น key ([managing users](https://developers.line.biz/en/docs/line-login/managing-users/)).
- LINE user ID มีขอบเขตตาม provider: คนเดียวกันได้ ID ต่างกันเมื่อช่องอยู่คนละ provider; LINE Login และ Messaging API ใต้ provider เดียวกันได้ ID เดียวกัน จึงต้องสร้าง LINE Login/OA ที่ต้องเชื่อมกันใต้ provider เดียวกันตั้งแต่แรก เพราะย้าย channel ข้าม provider ภายหลังไม่ได้ ([getting started](https://developers.line.biz/en/docs/line-login/getting-started/), [provider design](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/)).
- สำหรับ login/link อย่างเดียว หลังสร้าง local session ให้ persist เพียง provider, `sub` และ profile fields ที่ requirement ต้องใช้ ไม่ต้องเก็บ access token, refresh token หรือ ID token หากไม่มี downstream LINE API
- ห้าม log authorization code, tokens, Channel Secret, nonce หรือ verifier. เก็บเวลา, endpoint, status และ `x-line-request-id` แบบ redacted เพื่อวิเคราะห์ปัญหาได้ ([development guidelines](https://developers.line.biz/en/docs/line-login/development-guidelines/)).

## Logout, unlink, and account deletion

- Logout ปกติ: ทำลาย local session; ถ้าเก็บ access token ให้ revoke ที่ `POST https://api.line.me/oauth2/v2.1/revoke` ([API reference](https://developers.line.biz/en/reference/line-login/)).
- เมื่อผู้ใช้ลบบัญชีหรือยกเลิกการเชื่อม LINE ต้อง deauthorize สิทธิ์แทนผู้ใช้ตามข้อกำหนดของ LINE ด้วย `POST https://api.line.me/user/v1/deauthorize`, ใช้ Channel Access Token และส่ง `userAccessToken`; endpoint นี้ใช้กับ LIFF/MINI App ได้ด้วย ([development guidelines](https://developers.line.biz/en/docs/line-login/development-guidelines/), [API reference](https://developers.line.biz/en/reference/line-login/)).
- UI/เงื่อนไขบริการต้องแจ้งผลของ unlink/deletion ว่าระบบจะแจ้ง LINE และยุติการเชื่อม ผู้ใช้ยกเลิกสิทธิ์เองได้ใน LINE Settings > Account > Authorized apps
- หากเลือกไม่เก็บ user access token ระยะยาว ต้องออกแบบ unlink/deletion ให้ขอ fresh authorization/token ก่อน deauthorize หรือบันทึกข้อจำกัดนี้เป็น product flow; การลบ local link อย่างเดียวไม่เท่ากับ deauthorization ที่ LINE กำหนด

## LIFF and LINE Official Account

LINE Login, LIFF และ Official Account (Messaging API) เป็นคนละส่วน:

- LIFF app ถูกเพิ่มใต้ LINE Login channel และทำงานได้ใน LINE หรือ external browser. Authorization request ตรงใน LIFF browser ไม่รับประกัน; external browser/LINE in-app browser ควรใช้ `liff.login()` และส่ง raw ID/access token ให้ backend verify แทนการส่ง decoded user ID ([LIFF registration](https://developers.line.biz/en/docs/liff/registering-liff-apps/), [LIFF API](https://developers.line.biz/en/reference/liff)).
- การเสนอ add-friend OA ต้อง link LINE Official Account กับ LINE Login channel ใต้ provider เดียวกัน แล้วใช้ `bot_prompt`; callback อาจมี `friendship_status_changed` และตรวจสถานะล่าสุดได้ที่ `GET https://api.line.me/friendship/v1/status` ด้วย user access token ([add friend option](https://developers.line.biz/en/docs/line-login/link-a-bot/)).
- เอกสารปัจจุบันแนะนำสร้าง LIFF ใหม่เป็น LINE MINI App เนื่องจากแผนรวมแบรนด์ในอนาคต ([LIFF registration](https://developers.line.biz/en/docs/liff/registering-liff-apps/)). Ticket 03 ไม่จำเป็นต้องนำ LIFF เข้ามาใน web-login flow แรก แต่ควรจัด provider/channel ให้พร้อมเชื่อม OA ภายหลัง

## Development and test strategy

- แยก Channel ID/Secret และ callback allowlist ของ dev กับ production
- Channel สถานะ `Developing` ใช้ได้เฉพาะ Admin/Tester ที่ developer account เชื่อมกับ LINE account; production ต้อง `Published` และเปลี่ยนกลับเป็น Developing ไม่ได้ ([getting started](https://developers.line.biz/en/docs/line-login/getting-started/)).
- Unit/integration tests ผ่าน fake injectable LINE client: success, error callback, state mismatch/reuse/expiry, nonce mismatch, invalid signature/issuer/audience/expiry, token timeout/4xx/5xx, duplicate `sub`, concurrent callback idempotency, conflict เมื่อต้อง link สองบัญชี, และ allowlisted redirect
- Real sandbox check จำนวนจำกัดด้วย Tester account: authorization, callback, token exchange, verified `sub`, logout/unlink และ OA friendship เมื่อเปิด feature
- ห้าม load-test LINE endpoints; LINE ไม่เปิดเผย rate-limit threshold และอาจตอบ `429`. Load tests ต้องใช้ local fake provider ([development guidelines](https://developers.line.biz/en/docs/line-login/development-guidelines/), [API reference](https://developers.line.biz/en/reference/line-login/)).

## Ticket 03 acceptance decisions

- Backend-owned Authorization Code + OIDC flow
- Require `state`, `nonce`, and PKCE `S256` for every attempt
- Single-use login transaction with short TTL and atomic consume
- Verify ID token through LINE endpoint in v1; validate returned critical claims again before linking
- Unique provider identity `(line, sub)`; never accept LINE user ID from request body
- Persist no LINE tokens after login unless a later feature proves the need
- Generic Thai error to users; structured redacted provider logs for operators
- Separate dev/prod LINE channels under the same intended provider as the store's Official Account
- Account deletion/unlink flow must satisfy LINE deauthorization, not only remove the local database relation

