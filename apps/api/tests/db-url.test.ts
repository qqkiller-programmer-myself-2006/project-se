import { describe, expect, it } from "vitest";
import { getDatabaseDialect, getDatabasePort } from "../src/db-url.js";

describe("getDatabaseDialect (gate กัน mysql2 รับ PostgreSQL URL)", () => {
  it("mysql:// → mysql", () => {
    expect(getDatabaseDialect("mysql://paor:secret@127.0.0.1:3306/paor")).toBe("mysql");
  });

  it("postgres:// และ postgresql:// → postgres", () => {
    expect(
      getDatabaseDialect("postgres://postgres.fvdyeblfpeyuqwgtbgzr:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"),
    ).toBe("postgres");
    expect(getDatabaseDialect("postgresql://postgres:secret@db.ref.supabase.co:5432/postgres")).toBe("postgres");
  });

  it("ไม่มี URL → throw ชัดเจน (ไม่ fallback เงียบ)", () => {
    expect(() => getDatabaseDialect(undefined)).toThrow(/DATABASE_URL/);
    expect(() => getDatabaseDialect("")).toThrow(/DATABASE_URL/);
    expect(() => getDatabaseDialect("   ")).toThrow(/DATABASE_URL/);
  });

  it("scheme อื่น → throw ระบุ scheme (กัน driver ผิดชนิด)", () => {
    expect(() => getDatabaseDialect("sqlite://./a.db")).toThrow(/sqlite/);
    expect(() => getDatabaseDialect("mongodb://x")).toThrow(/mongodb/);
  });
});

describe("getDatabasePort", () => {
  it("อ่านพอร์ต Supavisor session-mode (5432) และ transaction-mode (6543)", () => {
    expect(getDatabasePort("postgres://u:p@host.pooler.supabase.com:5432/postgres")).toBe(5432);
    expect(getDatabasePort("postgres://u:p@host.pooler.supabase.com:6543/postgres")).toBe(6543);
  });

  it("URL ใช้ไม่ได้ → NaN", () => {
    expect(getDatabasePort("not-a-url")).toBeNaN();
  });
});
