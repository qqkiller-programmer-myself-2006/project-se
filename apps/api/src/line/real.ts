import {
  LINE_DEAUTHORIZE_URL,
  LINE_TOKEN_URL,
  LINE_VERIFY_URL,
  LineDeauthorizeError,
  LineExchangeError,
  LineNotConfiguredError,
  LineVerifyError,
  validateLineClaims,
  type LineExchangeResult,
  type LineProvider,
  type LineVerifiedClaims,
} from "./adapter.js";

/**
 * Production LINE provider (LINE Login v2.1 OAuth2 Authorization Code + OIDC verify endpoint)
 * - อ่านค่าจาก env ผ่าน factory เท่านั้น: LINE_CHANNEL_ID / LINE_CHANNEL_SECRET /
 *   LINE_REDIRECT_URI (+ LINE_CHANNEL_ACCESS_TOKEN สำหรับ deauthorize)
 * - ยังไม่ตั้งค่า → factory โยน LineNotConfiguredError ทันที (fail-fast ตั้งแต่ start)
 * - ไม่เก็บ token ระยะยาว: exchange/verify ใช้แล้วทิ้ง
 * - deauthorize: ห้ามสำเร็จแบบเงียบโดยเด็ดขาด — รุ่นนี้ตั้งใจไม่ persist user access
 *   token ระยะยาว จึงไม่มี userAccessToken สดสำหรับเรียก
 *   `POST https://api.line.me/user/v1/deauthorize` อย่างเป็นทางการได้
 *   (endpoint นี้ต้องใช้ Channel Access Token + userAccessToken สดของผู้ใช้นั้น)
 *   เมธอดนี้จึงโยน LineDeauthorizeError ที่อธิบายชัดเจนทุกครั้ง (ไม่ลบ local link ฝั่ง route)
 *   ผู้ใช้เพิกถอนเองได้ที่ LINE Settings > Account > Authorized apps
 *   งาน follow-up หากต้องการ deauthorize เต็มรูปแบบ: เก็บ user access token ขั้นต่ำ
 *   ที่เข้ารหัส at-rest ด้วย LINE_TOKEN_ENCRYPTION_KEY ที่ตั้งชัดเจน แล้วส่งสดตอน
 *   unlink/delete (ห้าม log token/secret ใด ๆ)
 */

export interface RealLineConfig {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
  channelAccessToken?: string;
}

export function realLineConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RealLineConfig {
  const channelId = (env["LINE_CHANNEL_ID"] ?? "").trim();
  const channelSecret = (env["LINE_CHANNEL_SECRET"] ?? "").trim();
  const redirectUri = (env["LINE_REDIRECT_URI"] ?? "").trim();
  if (!channelId || !channelSecret || !redirectUri) {
    throw new LineNotConfiguredError();
  }
  const channelAccessToken = (env["LINE_CHANNEL_ACCESS_TOKEN"] ?? "").trim() || undefined;
  return { channelId, channelSecret, redirectUri, channelAccessToken };
}

export class RealLineProvider implements LineProvider {
  readonly channelId: string;
  private readonly channelSecret: string;
  private readonly defaultRedirectUri: string;
  private readonly channelAccessToken?: string;

  constructor(config: RealLineConfig) {
    this.channelId = config.channelId;
    this.channelSecret = config.channelSecret;
    this.defaultRedirectUri = config.redirectUri;
    this.channelAccessToken = config.channelAccessToken;
  }

  get redirectUri(): string {
    return this.defaultRedirectUri;
  }

  buildAuthorizeUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
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
    return `https://access.line.me/oauth2/v2.1/authorize?${q.toString()}`;
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<LineExchangeResult> {
    let res: Response;
    try {
      res = await fetch(LINE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: this.channelId,
          client_secret: this.channelSecret,
          code_verifier: input.codeVerifier,
        }).toString(),
      });
    } catch {
      throw new LineExchangeError("แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    if (!res.ok) {
      throw new LineExchangeError("แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    const body = (await res.json().catch(() => ({}))) as {
      id_token?: unknown;
      access_token?: unknown;
    };
    if (typeof body.id_token !== "string" || body.id_token.length === 0) {
      throw new LineExchangeError("แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    return {
      idToken: body.id_token,
      accessToken: typeof body.access_token === "string" ? body.access_token : undefined,
    };
  }

  async verifyIdToken(idToken: string, expectedNonce: string): Promise<LineVerifiedClaims> {
    let res: Response;
    try {
      res = await fetch(LINE_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, client_id: this.channelId, nonce: expectedNonce }).toString(),
      });
    } catch {
      throw new LineVerifyError("ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    if (!res.ok) {
      throw new LineVerifyError("ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    const claims = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return validateLineClaims(claims, { expectedAud: this.channelId, expectedNonce });
  }

  async deauthorize(providerSubject: string): Promise<void> {
    // P1: ห้ามสำเร็จแบบเงียบ — รุ่นนี้ไม่มี userAccessToken สดที่ persist ไว้
    // จึงเรียก POST .../user/v1/deauthorize อย่างเป็นทางการไม่ได้ (ต้องใช้
    // Channel Access Token + userAccessToken สด) ต้องโยน error ชัดเจนเสมอ
    // เพื่อให้ route คง local link ไว้ (ไม่ลบ) และตอบ 502 พร้อมข้อความไทย
    // ห้าม log providerSubject เต็ม/ token/ secret ใด ๆ (redacted เท่านั้น)
    void providerSubject;
    void LINE_DEAUTHORIZE_URL;
    throw new LineDeauthorizeError(
      "แจ้งยกเลิกสิทธิ์กับ LINE ไม่สำเร็จ: รุ่นนี้ไม่เก็บ user access token ระยะยาว " +
        "จึงเรียก deauthorize ของ LINE ไม่ได้ กรุณาเพิกถอนสิทธิ์เองที่ LINE Settings > Account > Authorized apps " +
        "แล้วลองใหม่อีกครั้ง",
    );
  }
}
