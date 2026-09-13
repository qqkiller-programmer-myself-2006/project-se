import { createHash, randomBytes } from "node:crypto";

/**
 * ตัวช่วย PKCE S256 + state/nonce สำหรับ LINE Login v2.1 (Ticket 03)
 * - `state`/`nonce`: สุ่ม 32 ไบต์ เข้ารหัส hex (64 ตัวอักษร) ใหม่ทุก attempt
 * - `code_verifier`: สุ่มตาม RFC 7636 ยาว 43–128 ตัวอักษร (ใช้ 64 ไบต์ → 86 ตัวอักษร base64url)
 * - `code_challenge`: BASE64URL(SHA256(verifier)) — LINE รองรับเฉพาะ S256
 */

export const LINE_STATE_TTL_MS = 10 * 60 * 1000; // authorization code มีอายุ 10 นาที — state ก็อายุสั้นเท่ากัน

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateState(): string {
  return randomBytes(32).toString("hex");
}

export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(64)); // 86 ตัวอักษร อยู่ในช่วง 43–128
}

export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "utf8").digest());
}
