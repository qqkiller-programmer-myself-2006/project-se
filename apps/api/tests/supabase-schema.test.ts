import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSupabaseMigrationsDir } from "../src/pg-compat.js";
import { MIGRATION_FILES, splitSqlStatements } from "../src/store.js";

/**
 * db/supabase/* คือภาพสะท้อน PostgreSQL ของ db/migrations/* (เส้นทางชั่วคราว
 * Vercel + Supabase) — เทสต์นี้กัน DDL สำเนียง MySQL หลุดเข้าไปโดยไม่ต้องมี
 * DB จริง (อ่านไฟล์ + ตรวจด้วย splitSqlStatements ตัวเดียวกับ runner)
 */

function supabaseDir(): string {
  const dir = resolveSupabaseMigrationsDir();
  if (dir) return dir;
  // fallback เมื่อ cwd ไม่ตรง candidate ใดเลย (เช่น รัน vitest จาก root)
  const fallbacks = [
    join(process.cwd(), "db", "supabase"),
    join(process.cwd(), "apps", "api", "..", "..", "db", "supabase"),
  ];
  for (const c of fallbacks) {
    if (existsSync(c)) return c;
  }
  throw new Error("หาโฟลเดอร์ db/supabase ไม่พบ");
}

/** ตัด string/comment ออก เหลือแต่โค้ด (กัน token ใน literal/comment หลอกเทสต์) */
function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  let inLine = false;
  let inBlock = false;
  while (i < n) {
    const ch = sql[i]!;
    const nx = i + 1 < n ? sql[i + 1]! : "";
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && nx === "/") {
        i += 2;
        inBlock = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && nx === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (ch === "-" && nx === "-") {
      const th = i + 2 < n ? sql[i + 2]! : "";
      if (th === "" || " \t\n\r-".includes(th)) {
        inLine = true;
        i += 2;
        continue;
      }
    }
    if (ch === "/" && nx === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

describe("db/supabase mirror (PostgreSQL edition ของ 001-016)", () => {
  it("มีไฟล์ครบ 16 ชื่อเดียวกับ MIGRATION_FILES", () => {
    const dir = supabaseDir();
    expect(MIGRATION_FILES).toHaveLength(16);
    for (const name of MIGRATION_FILES) {
      expect(existsSync(join(dir, name)), `ขาด ${name} ใน db/supabase`).toBe(true);
    }
  });

  it("ทุกไฟล์แตก statement ได้และไม่มี DDL สำเนียง MySQL", () => {
    const dir = supabaseDir();
    const forbidden = [
      "ENGINE=",
      "INSERT IGNORE",
      "ON DUPLICATE",
      "AUTO_INCREMENT",
      "ON UPDATE CURRENT_TIMESTAMP",
      "TINYINT",
      "`",
    ];
    for (const name of MIGRATION_FILES) {
      const sql = readFileSync(join(dir, name), "utf8");
      const statements = splitSqlStatements(sql);
      expect(statements.length, `${name} ต้องมี statement อย่างน้อย 1`).toBeGreaterThan(0);
      const code = stripLiteralsAndComments(sql);
      for (const token of forbidden) {
        expect(code.includes(token), `${name} ห้ามมี ${token}`).toBe(false);
      }
      expect(/\bDATETIME\b/.test(code), `${name} ห้ามมี DATETIME`).toBe(false);
      // \bTIMESTAMP\b ไม่ match ข้างใน TIMESTAMPTZ (ไม่มี word boundary ท้าย)
      // \bJSON\b ไม่ match ข้างใน JSONB — เจอคือของ MySQL ดิบ
      expect(/\bTIMESTAMP\b/.test(code), `${name} ห้ามมี TIMESTAMP เปล่า`).toBe(false);
      expect(/\bJSON\b/.test(code), `${name} ห้ามมี JSON เปล่า`).toBe(false);
      // MODIFY เป็นไวยากรณ์ MySQL เท่านั้น (011 ใช้ ALTER COLUMN DROP NOT NULL)
      expect(/\bMODIFY\b/i.test(code), `${name} ห้ามมี MODIFY`).toBe(false);
      for (const s of statements) {
        const head = stripLiteralsAndComments(s).trim().split(/\s+/).slice(0, 2).join(" ").toUpperCase();
        expect(
          ["CREATE TABLE", "CREATE INDEX", "ALTER TABLE", "INSERT INTO"].some((k) => head.startsWith(k)),
          `${name}: statement ผิดรูป (${head})`,
        ).toBe(true);
      }
    }
  });

  it("CREATE TABLE/INDEX ทุกตัว rerunnable (IF NOT EXISTS)", () => {
    const dir = supabaseDir();
    for (const name of MIGRATION_FILES) {
      const code = stripLiteralsAndComments(readFileSync(join(dir, name), "utf8"));
      for (const m of code.matchAll(/CREATE\s+(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/gi)) {
        expect(`[${name}] CREATE ${m[1]} ขาด IF NOT EXISTS`).toBe("");
      }
    }
  });

  it("seed/upsert ใช้ ON CONFLICT (003/010/014/016) และ 016 ไม่มี IF()", () => {
    const dir = supabaseDir();
    for (const name of [
      "003_shop_status_tables.sql",
      "010_kitchen_drink_queues.sql",
      "014_capacity_wait_predictions.sql",
      "016_seed_noonui_cha_tai.sql",
    ]) {
      const sql = readFileSync(join(dir, name), "utf8");
      expect(sql, `${name} ต้องมี ON CONFLICT`).toMatch(/ON\s+CONFLICT/i);
    }
    const seed16 = readFileSync(join(dir, "016_seed_noonui_cha_tai.sql"), "utf8");
    expect(stripLiteralsAndComments(seed16)).not.toMatch(/\bIF\s*\(/i);
    const alter011 = readFileSync(join(dir, "011_loyalty_rewards.sql"), "utf8");
    expect(alter011).toMatch(/ALTER\s+COLUMN\s+\w+\s+DROP\s+NOT\s+NULL/i);
  });
});
