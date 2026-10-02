import { describe, expect, it } from "vitest";
import { assertSafeTestDatabase, checkTestDatabaseUrl } from "./helpers/db-guard.js";

describe("db-guard: กัน integration test ไปรันกับฐานข้อมูลจริง", () => {
  it("ไม่ตั้ง TEST_DATABASE_URL → ผ่าน (test ที่ใช้ DB จะ skip เอง)", () => {
    expect(checkTestDatabaseUrl({})).toEqual({ ok: true });
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "  ", DATABASE_URL: "mysql://a/b" })).toEqual({ ok: true });
  });

  it("ฐานข้อมูลที่ชื่อมี 'test' ผ่าน (MySQL/Postgres, local)", () => {
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "mysql://paor:x@127.0.0.1:3307/paor_test" }).ok).toBe(true);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://postgres:x@localhost:5433/PAOR_TEST" }).ok).toBe(true);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:p@db.internal:5432/test" }).ok).toBe(true);
  });

  it("ชื่อฐานข้อมูลไม่มี 'test' → ปฏิเสธ พร้อมบอกชื่อ", () => {
    const r = checkTestDatabaseUrl({ TEST_DATABASE_URL: "mysql://paor:x@127.0.0.1:3306/paor" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/test/);
    expect(r.ok === false && r.reason).toMatch(/paor/);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost:5432/" }).ok).toBe(false);
  });

  it("เท่ากับ DATABASE_URL → ปฏิเสธ แม้ชื่อมี 'test' (ไม่สนรหัสผ่าน/พารามิเตอร์ท้าย URL)", () => {
    const prod = "postgres://app:secret@db.internal:5432/paor_test?sslmode=require";
    const r = checkTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://app:other@db.internal:5432/paor_test", DATABASE_URL: prod });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/DATABASE_URL/);
  });

  it("Supabase: ปฏิเสธเว้นแต่ยืนยันเองด้วย TEST_DATABASE_CONFIRM_REMOTE=1", () => {
    const url = "postgres://postgres.abcd:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: url }).ok).toBe(false);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: url, TEST_DATABASE_CONFIRM_REMOTE: "0" }).ok).toBe(false);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: url, TEST_DATABASE_CONFIRM_REMOTE: "1" }).ok).toBe(true);
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://postgres:x@db.abcd.supabase.co:5432/postgres" }).ok).toBe(false);
  });

  it("แต่ถึงจะยืนยัน Supabase ก็ยังห้ามเท่ากับ DATABASE_URL", () => {
    const url = "postgres://postgres.abcd:x@aws-0.pooler.supabase.com:5432/postgres";
    const r = checkTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: url, TEST_DATABASE_CONFIRM_REMOTE: "1" });
    expect(r.ok).toBe(false);
  });

  it("URL ที่อ่านไม่ได้ → ปฏิเสธ; assertSafeTestDatabase โยน error ภาษาไทย", () => {
    expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: "not a url" }).ok).toBe(false);
    expect(() => assertSafeTestDatabase({ TEST_DATABASE_URL: "mysql://u:p@127.0.0.1/paor" })).toThrow(/db-guard.*ปฏิเสธ/);
    expect(() => assertSafeTestDatabase({ TEST_DATABASE_URL: "mysql://u:p@127.0.0.1/paor_test" })).not.toThrow();
  });
});
