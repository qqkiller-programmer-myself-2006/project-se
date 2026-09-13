import type {
  LineExchangeResult,
  LineProvider,
  LineVerifiedClaims,
} from "./adapter.js";
import { LINE_AUTHORIZE_URL, LineExchangeError, LineVerifyError, validateLineClaims } from "./adapter.js";

/**
 * Fake LINE provider สำหรับ tests (ฉีดผ่าน deps เท่านั้น — ห้ามใช้ใน production)
 * - ตั้งพฤติกรรมล่วงหน้า: exchange/verify สำเร็จหรือล้มเหลว, deauthorize ล้มเหลว
 * - บันทึกทุก call (authorize/exchange/verify/deauthorize) ให้ contract tests ตรวจได้
 * - claims ที่คืนผ่าน `validateLineClaims` เหมือน production (iss/aud/exp/nonce/sub)
 */

export interface FakeLineBehavior {
  /** sub ที่ verify จะคืน (default: "Ufake-sub-001") */
  sub?: string;
  /** display name ที่ verify จะคืน */
  name?: string | null;
  /** จำลอง token exchange ล้มเหลว (4xx/5xx/timeout) */
  failExchange?: boolean;
  /** จำลอง verify ล้มเหลว (signature/issuer/audience/expiry/nonce ผิด) */
  failVerify?: "signature" | "issuer" | "audience" | "expiry" | "nonce" | boolean;
  /** จำลอง deauthorize ล้มเหลว */
  failDeauthorize?: boolean;
}

export class FakeLineProvider implements LineProvider {
  readonly channelId: string;
  behavior: FakeLineBehavior;
  authorizeCalls: { state: string; nonce: string; codeChallenge: string; redirectUri: string }[] = [];
  exchangeCalls: { code: string; redirectUri: string }[] = [];
  verifyCalls: { idToken: string; expectedNonce: string }[] = [];
  deauthorized: string[] = [];

  constructor(channelId = "fake-channel-id", behavior: FakeLineBehavior = {}) {
    this.channelId = channelId;
    this.behavior = behavior;
  }

  buildAuthorizeUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    this.authorizeCalls.push({ ...input });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: this.channelId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: "openid profile",
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    });
    return `${LINE_AUTHORIZE_URL}?${q.toString()}`;
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<LineExchangeResult> {
    this.exchangeCalls.push({ code: input.code, redirectUri: input.redirectUri });
    if (this.behavior.failExchange) {
      throw new LineExchangeError("แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    // code_verifier ต้องถูกส่งมาด้วยทุกครั้ง (PKCE บังคับ) — ไม่มีถือว่า caller ผิด
    if (!input.codeVerifier || input.codeVerifier.length < 43) {
      throw new LineExchangeError("แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    return { idToken: `fake-id-token-for-${input.code}`, accessToken: `fake-access-for-${input.code}` };
  }

  async verifyIdToken(idToken: string, expectedNonce: string): Promise<LineVerifiedClaims> {
    this.verifyCalls.push({ idToken, expectedNonce });
    const failMode = this.behavior.failVerify;
    const nowSec = Math.floor(Date.now() / 1000);
    const raw: Record<string, unknown> = {
      iss: "https://access.line.me",
      aud: this.channelId,
      exp: nowSec + 3600,
      nonce: expectedNonce,
      sub: this.behavior.sub ?? "Ufake-sub-001",
      name: this.behavior.name ?? "ลูกค้าทดสอบ",
    };
    if (failMode === "issuer" || failMode === true) raw["iss"] = "https://evil.example.com";
    if (failMode === "audience") raw["aud"] = "other-channel";
    if (failMode === "expiry") raw["exp"] = nowSec - 10;
    if (failMode === "nonce") raw["nonce"] = "mismatched-nonce";
    if (failMode === "signature") {
      throw new LineVerifyError("ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    return validateLineClaims(raw, { expectedAud: this.channelId, expectedNonce });
  }

  async deauthorize(providerSubject: string): Promise<void> {
    if (this.behavior.failDeauthorize) {
      const { LineDeauthorizeError } = await import("./adapter.js");
      throw new LineDeauthorizeError("แจ้งยกเลิกสิทธิ์กับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    this.deauthorized.push(providerSubject);
  }
}
