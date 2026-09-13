/**
 * LINE provider seam (Ticket 03) — backend เป็นเจ้าของ flow ทั้งหมด
 * - production ใช้ `RealLineProvider` (LINE Login v2.1: authorize → token → verify)
 * - tests ฉีด `FakeLineProvider` ผ่าน deps (ห้ามเรียก LINE จริงในเทสต์)
 * - ยังไม่ตั้งค่าผู้ให้บริการ → `DisabledLineProvider` โยน `LineNotConfiguredError`
 *   ให้ route ตอบ 503 fail-fast (ห้ามเงียบหรือข้ามขั้นตอนยืนยัน)
 *
 * กฎเหล็ก:
 * - ห้ามรับ LINE user ID (`sub`) จาก request body เป็นหลักฐาน — ใช้เฉพาะ `sub`
 *   จาก claims ที่ adapter ยืนยันแล้วเท่านั้น
 * - ห้าม persist provider access/refresh/ID token หลัง login (เก็บแค่ provider+sub+profile ที่จำเป็น)
 * - ห้าม log authorization code, tokens, secret, nonce หรือ verifier (redacted logs เท่านั้น)
 */

export const LINE_ISSUER = "https://access.line.me";
export const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
export const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
export const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
export const LINE_DEAUTHORIZE_URL = "https://api.line.me/user/v1/deauthorize";

export class LineNotConfiguredError extends Error {
  code = "LINE_NOT_CONFIGURED";
  constructor(message = "ยังไม่เปิดใช้งานการเชื่อม LINE (ผู้ดูแลระบบยังไม่ตั้งค่าผู้ให้บริการ)") {
    super(message);
  }
}

export class LineVerifyError extends Error {
  code = "LINE_VERIFY_FAILED";
}

export class LineExchangeError extends Error {
  code = "LINE_EXCHANGE_FAILED";
}

export class LineDeauthorizeError extends Error {
  code = "LINE_DEAUTHORIZE_FAILED";
}

export interface LineVerifiedClaims {
  /** LINE user ID ที่ยืนยันแล้ว — ใช้เป็น external identity เพียงค่าเดียว */
  sub: string;
  iss: string;
  aud: string;
  /** วันหมดอายุ (วินาที epoch ตาม OIDC) */
  exp: number;
  nonce: string;
  /** display name ที่เปลี่ยนได้ — ห้ามใช้เป็น key */
  name?: string | null;
}

export interface LineExchangeResult {
  idToken: string;
  /** รับมาเพื่อ verify/deauthorize ทันที ห้าม persist ระยะยาว */
  accessToken?: string;
}

export interface LineProvider {
  readonly channelId: string;
  buildAuthorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<LineExchangeResult>;
  verifyIdToken(idToken: string, expectedNonce: string): Promise<LineVerifiedClaims>;
  /**
   * แจ้งผู้ให้บริการว่าผู้ใช้ยกเลิกการเชื่อม/ลบบัญชี
   * P1: ห้ามสำเร็จแบบเงียบโดยเด็ดขาด — ถ้าไม่มี userAccessToken สดที่ถูกต้อง
   * (หรือ channel access token ที่ต้องใช้) ต้องโยน LineDeauthorizeError/
   * LineNotConfiguredError ที่อธิบายชัดเจน ห้าม log token/secret ใด ๆ
   * route ต้องคง local link ไว้เมื่อโยน (ลบเฉพาะหลัง success)
   */
  deauthorize(providerSubject: string): Promise<void>;
}

/**
 * ตรวจ claims สำคัญซ้ำอีกชั้นก่อน link (ใช้ร่วมกันทั้ง real/fake/tests):
 * iss, aud, exp, nonce และ sub ต้องถูกต้อง — ผิดข้อใดโยน LineVerifyError
 * (ข้อความทั่วไป ไม่เปิดเผยความลับ; รายละเอียดให้ operator ดู redacted logs)
 */
export function validateLineClaims(
  raw: Record<string, unknown>,
  opts: { expectedAud: string; expectedNonce: string; now?: Date },
): LineVerifiedClaims {
  const nowMs = (opts.now ?? new Date()).getTime();
  const iss = raw["iss"];
  const aud = raw["aud"];
  const exp = raw["exp"];
  const nonce = raw["nonce"];
  const sub = raw["sub"];
  const name = raw["name"];
  const fail = (): never => {
    throw new LineVerifyError("ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  };
  if (iss !== LINE_ISSUER) fail();
  if (aud !== opts.expectedAud) fail();
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= nowMs) fail();
  if (typeof nonce !== "string" || nonce.length === 0 || nonce !== opts.expectedNonce) fail();
  if (typeof sub !== "string" || sub.length === 0) fail();
  return {
    sub: sub as string,
    iss: iss as string,
    aud: aud as string,
    exp: exp as number,
    nonce: nonce as string,
    name: typeof name === "string" ? name : null,
  };
}

/** provider กรณี production ยังไม่ตั้งค่า — ทุกเมธอด fail-fast ทันที */
export class DisabledLineProvider implements LineProvider {
  readonly channelId = "";
  buildAuthorizeUrl(_input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    throw new LineNotConfiguredError();
  }
  exchangeCode(_input: { code: string; codeVerifier: string; redirectUri: string }): Promise<LineExchangeResult> {
    throw new LineNotConfiguredError();
  }
  verifyIdToken(_idToken: string, _expectedNonce: string): Promise<LineVerifiedClaims> {
    throw new LineNotConfiguredError();
  }
  deauthorize(_providerSubject: string): Promise<void> {
    throw new LineNotConfiguredError();
  }
}
