import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeThaiPhone } from "../src/customer/phone.js";
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateState,
  LINE_STATE_TTL_MS,
} from "../src/line/pkce.js";
import {
  DisabledLineProvider,
  LineDeauthorizeError,
  LineNotConfiguredError,
  LineVerifyError,
  validateLineClaims,
} from "../src/line/adapter.js";
import { FakeLineProvider } from "../src/line/fake.js";
import { RealLineProvider, realLineConfigFromEnv } from "../src/line/real.js";
import { buildLineCallbackRedirect, maskPhone, sanitizeLineRedirect } from "../src/routes/customers.js";
import { createMemoryStore } from "../src/store.js";

describe("Ticket 03 unit/contract: phone/email/PKCE/claims/redirect", () => {
  it("normalizeThaiPhone ครบทุกรูปแบบ + ปฏิเสธค่าผิด", () => {
    expect(normalizeThaiPhone("0812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("081-234-5678")).toBe("0812345678");
    expect(normalizeThaiPhone("+66812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("66812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("  +66 81 234 5678  ")).toBe("0812345678");
    expect(normalizeThaiPhone("(081) 234-5678")).toBe("0812345678");
    for (const bad of ["", "123", "081234567", "08123456789", "1800CALL", "+11234567890", "08123abc78", 123 as unknown as string, null, undefined]) {
      expect(() => normalizeThaiPhone(bad)).toThrow(/เบอร์โทร/);
    }
  });

  it("normalizeEmail: ว่างเป็น null, ลดรูปพิมพ์เล็ก, ตรวจรูปแบบ", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("A@Example.COM ")).toBe("a@example.com");
    for (const bad of ["no-at", "a@", "@b.com", "a@b", "x".repeat(250) + "@y.zz"]) {
      expect(() => normalizeEmail(bad)).toThrow(/อีเมล/);
    }
  });

  it("PKCE: state/nonce ยาว 64 hex ไม่ซ้ำ, verifier 43–128, challenge ตรง S256", () => {
    expect(generateState()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateNonce()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateState()).not.toBe(generateState());
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    // RFC 7636 Appendix B vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" → challenge
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(LINE_STATE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("validateLineClaims ตรวจ iss/aud/exp/nonce/sub ครบทุกราย", () => {
    const now = new Date("2026-09-12T10:00:00.000Z");
    const good = { iss: "https://access.line.me", aud: "cid", exp: Math.floor(now.getTime() / 1000) + 60, nonce: "n", sub: "U1", name: "x" };
    expect(validateLineClaims(good, { expectedAud: "cid", expectedNonce: "n", now }).sub).toBe("U1");
    const cases: Record<string, unknown>[] = [
      { ...good, iss: "https://evil.example.com" },
      { ...good, aud: "other" },
      { ...good, exp: Math.floor(now.getTime() / 1000) - 1 },
      { ...good, nonce: "other" },
      { ...good, sub: "" },
      { ...good, sub: undefined },
    ];
    for (const raw of cases) {
      expect(() => validateLineClaims(raw, { expectedAud: "cid", expectedNonce: "n", now })).toThrow(LineVerifyError);
    }
  });

  it("sanitizeLineRedirect รับเฉพาะ allowlist ภายใน, maskPhone ปิดบังกลางเบอร์", () => {
    expect(sanitizeLineRedirect("/profile")).toBe("/profile");
    expect(sanitizeLineRedirect("/")).toBe("/");
    expect(sanitizeLineRedirect("https://evil.example.com")).toBe("/profile");
    expect(sanitizeLineRedirect("//evil.com")).toBe("/profile");
    expect(sanitizeLineRedirect("/admin")).toBe("/profile");
    expect(sanitizeLineRedirect(undefined)).toBe("/profile");
    expect(maskPhone("0812345678")).toBe("08******78");
    expect(maskPhone("0812345678")).not.toContain("123456");
  });

  it("FakeLineProvider contract: authorize URL มีพารามิเตอร์ครบ + verify ผ่าน claims เดียวกับ production", async () => {
    const fake = new FakeLineProvider("cid-123");
    const url = new URL(fake.buildAuthorizeUrl({ state: "s", nonce: "n", codeChallenge: "c", redirectUri: "https://shop.example/cb" }));
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("openid");
    const ex = await fake.exchangeCode({ code: "c", codeVerifier: "v".repeat(64), redirectUri: "https://shop.example/cb" });
    expect(ex.idToken).toContain("c");
    const claims = await fake.verifyIdToken(ex.idToken, "n");
    expect(claims.sub).toBe("Ufake-sub-001");
    expect(claims.aud).toBe("cid-123");
    await fake.deauthorize("Ufake-sub-001");
    expect(fake.deauthorized).toEqual(["Ufake-sub-001"]);
  });

  it("P1: RealLineProvider.deauthorize ห้ามสำเร็จแบบเงียบ — ต้องโยน explicit error เสมอ", async () => {
    const real = new RealLineProvider({ channelId: "cid", channelSecret: "sec", redirectUri: "https://x/cb" });
    await expect(real.deauthorize("U123")).rejects.toThrow(LineDeauthorizeError);
    await expect(real.deauthorize("U123")).rejects.toThrow(/access token|deauthorize/i);
  });

  it("P2: buildLineCallbackRedirect ไป UI ที่ตั้งไว้หรือ fallback โดยไม่มี secret ใน query", () => {
    // ตั้ง base ไว้ → absolute URL ของ UI + allowlist path + status เท่านั้น
    expect(buildLineCallbackRedirect("https://app.example.test", "/profile", { line: "linked" })).toBe(
      "https://app.example.test/profile?line=linked",
    );
    expect(
      buildLineCallbackRedirect("https://app.example.test/", "/customer/profile", { line: "error", reason: "conflict" }),
    ).toBe("https://app.example.test/customer/profile?line=error&reason=conflict");
    // path นอก allowlist ตกเป็น /profile; base ใช้ไม่ได้ตกเป็น same-origin fallback
    expect(buildLineCallbackRedirect("https://app.example.test", "https://evil.example.com", { line: "linked" })).toBe(
      "https://app.example.test/profile?line=linked",
    );
    expect(buildLineCallbackRedirect(undefined, "/profile", { line: "linked" })).toBe("/profile?line=linked");
    expect(buildLineCallbackRedirect("not-a-url", "/line", { line: "error", reason: "expired_or_used" })).toBe(
      "/line?line=error&reason=expired_or_used",
    );
    // query ต้องไม่มีช่องให้รั่ว code/token/secret/state
    for (const loc of [
      buildLineCallbackRedirect("https://app.example.test", "/profile", { line: "linked" }),
      buildLineCallbackRedirect(undefined, "/profile", { line: "error", reason: "verify_failed" }),
    ]) {
      expect(loc).not.toMatch(/code|token|secret|state|nonce/i);
    }
  });
  it("production fail-fast: ไม่มี env ครบโยน LineNotConfiguredError; disabled ทุกเมธอดโยนทันที", () => {
    expect(() => realLineConfigFromEnv({})).toThrow(LineNotConfiguredError);
    expect(() => realLineConfigFromEnv({ LINE_CHANNEL_ID: "x" })).toThrow(LineNotConfiguredError);
    const cfg = realLineConfigFromEnv({ LINE_CHANNEL_ID: "id", LINE_CHANNEL_SECRET: "s", LINE_REDIRECT_URI: "https://x/cb" });
    expect(cfg.channelId).toBe("id");
    const disabled = new DisabledLineProvider();
    expect(() => disabled.buildAuthorizeUrl({ state: "", nonce: "", codeChallenge: "", redirectUri: "" })).toThrow(
      LineNotConfiguredError,
    );
    expect(() => disabled.exchangeCode({ code: "", codeVerifier: "", redirectUri: "" })).toThrow(LineNotConfiguredError);
  });

  it("Memory/MySQL parity ระดับ store: link/unlink/consume semantics", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "พ", phone: "0812345678", email: null, passwordHash: "h" }, {});
    await s.createLineTx({ customerId: c.id, state: "st", nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: null, expiresAt: new Date(Date.now() + 60000).toISOString() });
    const tx = await s.consumeLineTx("st", new Date());
    expect(tx!.nonce).toBe("n");
    expect(await s.consumeLineTx("st", new Date())).toBeNull();
    const link = await s.linkLineIdentity(c.id, { providerSubject: "U1", displayName: "ด" }, {});
    expect(link.providerSubject).toBe("U1");
    await expect(s.linkLineIdentity(c.id, { providerSubject: "U2" }, {})).rejects.toThrow(/เชื่อม LINE ไว้แล้ว/);
    const c2 = await s.createCustomer({ name: "พ2", phone: "0899999999", email: null, passwordHash: "h" }, {});
    await expect(s.linkLineIdentity(c2.id, { providerSubject: "U1" }, {})).rejects.toThrow(/บัญชีอื่น/);
    expect((await s.findLineLinkBySubject("line", "U1"))!.customerId).toBe(c.id);
    await s.unlinkLineIdentity(c.id, {});
    expect(await s.getLineLink(c.id)).toBeNull();
  });
});
