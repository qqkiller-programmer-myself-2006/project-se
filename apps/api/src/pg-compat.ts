/**
 * pg-compat: ให้ SQL สำเนียง MySQL เดิมของ store.ts รันบน Supabase PostgreSQL ได้
 * (เส้นทางชั่วคราว — MySQL ยังเป็นค่าเริ่มต้นของ local/dev/tests)
 *
 * หลักการ:
 * - แปล SQL แบบ pure-function (`translateMysqlToPostgres`) ครอบคลุมพื้นผิวที่สำรวจแล้ว:
 *   `?` → `$n`, `ON DUPLICATE KEY UPDATE` → `ON CONFLICT ... DO UPDATE`,
 *   `VALUES(c)` → `EXCLUDED.c`, `CAST(? AS JSON)` → `CAST(? AS JSONB)`,
 *   `JSON_CONTAINS(roles, '"x"')` → `(roles ? 'x')` (คอลัมน์ roles เป็น JSONB),
 *   `ESCAPE '\\'` → `ESCAPE '\'` (PG ใช้ standard_conforming_strings)
 * - named lock `GET_LOCK/RELEASE_LOCK` ทำผ่าน `pg_try_advisory_lock/unlock`
 *   ระดับ session บน client เดียวกัน (ต้องใช้ Supavisor **session mode**
 *   พอร์ต 5432 — transaction mode 6543 ถูกปฏิเสธตั้งแต่เปิด pool)
 * - error PG (`23505`/`42701`) ถูก map เป็นรูป `ER_DUP_ENTRY`/`ER_DUP_FIELDNAME`
 *   เพื่อให้ call-site เดิมคืน 409/ข้อความไทยถูกต้อง ไม่กลายเป็น 500
 * - pattern ที่ไม่รู้จัก → throw ชัดเจน (fail-fast ห้ามเงียบหรือเดา)
 *
 * เงื่อนไขรันไทม์: session timezone UTC ทุก connection (เทียบเท่า pool
 * `timezone: Z` ของ MySQL) เพื่อให้ DATETIME ที่โค้ดเขียนด้วย UTC getters
 * ตีความตรงกัน
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabasePort } from "./db-url.js";

/** conflict target ต่อตารางสำหรับ ON DUPLICATE KEY UPDATE ทั้ง 6 จุดใน store.ts */
const CONFLICT_TARGETS: Record<string, string> = {
  shop_settings: "id",
  shop_schedule: "weekday",
  shop_override: "id",
  station_capacity: "station",
  notification_consents: "customer_id",
  prediction_models: "id",
};

const GET_LOCK_RE = /SELECT\s+GET_LOCK\(\s*'([^']+)'\s*,\s*\d+\s*\)\s+AS\s+l\b/i;
const RELEASE_LOCK_RE = /SELECT\s+RELEASE_LOCK\(\s*'([^']+)'\s*\)/i;

/** งบเวลารอ named lock (ms) — เทียบเท่า GET_LOCK(..., 10) ของ MySQL */
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** แยก assignment ระดับบนสุดด้วย comma (ไม่ตัด comma ในวงเล็บ/quote) */
function splitTopLevelComma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inSingle) {
      current += ch;
      if (ch === "'" && s[i + 1] === "'") {
        current += s[i + 1]!;
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** ตัดคอมเมนต์ SQL (บรรทัด `--` และ block) ที่อยู่นอก string literal */
function stripSqlComments(s: string): string {
  let out = "";
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const next = s[i + 1];
    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
    } else if (ch === "-" && next === "-") {
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 1;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * แปล ON DUPLICATE KEY UPDATE ท้าย statement เป็น ON CONFLICT
 * รองรับเฉพาะรูป `col = VALUES(col)` (ทั้ง 6 จุดใน store.ts) —
 * นอกนั้น throw ชัดเจนเพื่อไม่ให้เกิด upsert ผิดความหมาย
 */
function rewriteUpsert(rawSql: string): string {
  // คอมเมนต์ที่ติดหน้า statement (เช่น "-- INSERT ... ON DUPLICATE KEY UPDATE ที่โค้ด")
  // ต้องไม่ถูกตีความเป็น upsert — ตัดคอมเมนต์ก่อนตรวจ
  if (!/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(stripSqlComments(rawSql))) return rawSql;
  const sql = stripSqlComments(rawSql);
  const m = sql.match(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]+?);?\s*$/i);
  if (!m) return sql;
  const tableMatch = sql.match(/INSERT\s+INTO\s+([A-Za-z_][\w]*)/i);
  const table = tableMatch?.[1]?.toLowerCase() ?? "";
  const clause = m[1]!;
  if (/\bIF\s*\(/i.test(clause)) {
    throw new Error(
      `pg-compat: ไม่รองรับ IF() ใน ON DUPLICATE KEY UPDATE (ตาราง "${table}") — ต้องแปล DDL/seed เป็น PG ตรง ๆ`,
    );
  }
  const target = CONFLICT_TARGETS[table];
  if (!target) {
    throw new Error(
      `pg-compat: ไม่รู้จัก conflict target ของตาราง "${table}" (ON DUPLICATE KEY UPDATE) — ปฏิเสธเพื่อกัน upsert ผิดความหมาย`,
    );
  }
  const assignments = splitTopLevelComma(clause).map((a) => {
    const rewritten = a.replace(/\bVALUES\(\s*([A-Za-z_][\w]*)\s*\)/gi, "EXCLUDED.$1");
    if (/\bVALUES\s*\(/i.test(rewritten)) {
      throw new Error(
        `pg-compat: รองรับเฉพาะรูป col = VALUES(col) (ตาราง "${table}") — พบ: ${a}`,
      );
    }
    return rewritten;
  });
  return `${sql.slice(0, m.index).trimEnd()} ON CONFLICT (${target}) DO UPDATE SET ${assignments.join(", ")}`;
}

/**
 * แปล statement สำเนียง MySQL เป็น PostgreSQL (pure — ไม่ต้องมี pg ก็เทสต์ได้)
 * throw เมื่อเจอ pattern ที่แปลไม่ได้ (fail-fast)
 *
 * ลำดับสำคัญ: numbering `?` → `$n` ต้องเกิดก่อน rewrite ที่เติมอักขระ `?`
 * ของ PG เอง (`?` operator ของ JSONB, `ESCAPE '\'`) มิฉะนั้น scanner จะกิน
 * `?` พวกนั้นเป็น placeholder หรือหลุด state string
 */
export function translateMysqlToPostgres(sql: string): string {
  if (GET_LOCK_RE.test(sql) || RELEASE_LOCK_RE.test(sql)) {
    throw new Error("pg-compat: named lock ต้องผ่าน PgCompatConnection.query เท่านั้น (ห้ามแปลเป็น text)");
  }
  let out = numberPlaceholders(sql);
  // CAST(?/$n AS JSON) → JSONB (PG ไม่มี implicit cast แบบเดียวกันทุกกรณี)
  out = out.replace(/CAST\(\s*(\?|\$\d+)\s*AS\s+JSON\s*\)/gi, (_m, p: string) => `CAST(${p} AS JSONB)`);
  // JSON_CONTAINS(roles, '"x"') → (roles ? 'x') — roles เป็น JSONB array
  out = out.replace(/JSON_CONTAINS\(\s*([A-Za-z_][\w]*)\s*,\s*'"([^"']+)"'\s*\)/gi, "($1 ? '$2')");
  // ESCAPE '\\' (2 chars ใต้ standard_conforming_strings) → ESCAPE '\'
  out = out.replace(/ESCAPE\s+'\\\\'/g, "ESCAPE '\\'");
  out = rewriteUpsert(out);
  // backtick identifier ไม่มีใน queries ของ store.ts — เจอคือสัญญาณ SQL แปลกปลอม
  if (/`/.test(out)) {
    throw new Error("pg-compat: พบ backtick identifier ซึ่ง PostgreSQL ไม่รองรับ — ปฏิเสธ statement นี้");
  }
  return out;
}

/** ? → $n โดยข้าม string/comment (logic เดียวกับ splitSqlStatements) */
function numberPlaceholders(out: string): string {
  let result = "";
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    const next = i + 1 < out.length ? out[i + 1]! : "";
    if (inLineComment) {
      result += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      result += ch;
      if (ch === "*" && next === "/") {
        result += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      result += ch;
      if (ch === "\\" && next !== "") {
        result += next;
        i++;
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          result += next;
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      result += ch;
      if (ch === "\\" && next !== "") {
        result += next;
        i++;
        continue;
      }
      if (ch === '"') {
        if (next === '"') {
          result += next;
          i++;
        } else {
          inDouble = false;
        }
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      result += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      result += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      result += ch;
      continue;
    }
    if (ch === "?") {
      n++;
      result += `$${n}`;
      continue;
    }
    result += ch;
  }
  return result;
}

/** ตรวจว่าเป็น SELECT GET_LOCK(...) AS l — คืนชื่อ lock หรือ null */
export function parseMysqlGetLock(sql: string): string | null {
  return sql.match(GET_LOCK_RE)?.[1] ?? null;
}

/** ตรวจว่าเป็น SELECT RELEASE_LOCK(...) — คืนชื่อ lock หรือ null */
export function parseMysqlReleaseLock(sql: string): string | null {
  return sql.match(RELEASE_LOCK_RE)?.[1] ?? null;
}

/**
 * map error ของ pg ให้เป็นรูปที่ call-site เดิมใน store.ts เข้าใจ
 * (`code: ER_DUP_ENTRY` → 409 Conflict พร้อมข้อความไทย, ไม่ใช่ 500)
 * คง message ต้นฉบับไว้เพราะหลายจุดแยกชนิด unique ด้วยชื่อ constraint
 */
export function mapPgError(err: unknown): unknown {
  if (!err || typeof err !== "object" || !("code" in err)) return err;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "23505") {
    const message = typeof e.message === "string" ? e.message : "duplicate key value violates unique constraint";
    return { code: "ER_DUP_ENTRY", errno: 1062, message };
  }
  if (e.code === "42701") {
    const message = typeof e.message === "string" ? e.message : "duplicate column";
    return { code: "ER_DUP_FIELDNAME", errno: 1060, message };
  }
  return err;
}

// ---------- adapter ที่มีรูปร่างเดียวกับ mysql2 Pool/Connection ----------

export type MysqlLikeRows = Record<string, unknown>[];
/**
 * รูป OkPacket แบบ mysql2 สำหรับ statement เขียน (INSERT/UPDATE/DELETE/DDL):
 * call-site เดียวที่อ่านผลเขียนคือ claimNotification (`affectedRows === 0`
 * แปลว่าแย่ง claim ไม่ทัน) — pg คืน rowCount มาใน Result จึง map มาตรงนี้
 * แทนที่จะทิ้ง (ถ้าทิ้งจะได้ undefined แล้วแย่ง claim กันผิดความหมาย)
 */
export interface MysqlOkPacketLike {
  affectedRows: number;
}
/** รูปร่างผลลัพธ์แบบ mysql2: SELECT → [rows, fields]; เขียน → [ok, fields] */
export type MysqlLikeResult = [MysqlLikeRows | MysqlOkPacketLike, unknown];

/** interface ขั้นต่ำของ pg client ที่ adapter ต้องการ (ฉีด fake ในเทสต์ได้) */
export interface PgClientLike {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: MysqlLikeRows; rowCount?: number | null; command?: string }>;
  release(): void;
}

/** interface ขั้นต่ำของ pg pool ที่ adapter ต้องการ */
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

export class PgCompatConnection {
  constructor(private readonly client: PgClientLike) {}

  /**
   * query สำเนียง MySQL (placeholder `?`) บน PostgreSQL
   * - SELECT คืนรูป [rows, undefined] แบบ mysql2
   *   (fields ไม่ถูกใช้ที่ call-site ใดเลย)
   * - INSERT/UPDATE/DELETE คืนรูป [{ affectedRows }, undefined] แบบ OkPacket
   *   ของ mysql2 (claimNotification อ่าน affectedRows เพื่อกันแย่ง claim ซ้อน)
   */
  async query(sql: string, params: unknown[] = []): Promise<MysqlLikeResult> {
    const lockName = parseMysqlGetLock(sql);
    if (lockName !== null) {
      const deadline = Date.now() + LOCK_WAIT_MS;
      for (;;) {
        try {
          const r = await this.client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS l", [lockName]);
          if (r.rows[0]?.["l"] === true) return [[{ l: 1 }], undefined];
        } catch (err) {
          throw mapPgError(err);
        }
        if (Date.now() >= deadline) return [[{ l: 0 }], undefined];
        await sleep(LOCK_POLL_MS);
      }
    }
    const releaseName = parseMysqlReleaseLock(sql);
    if (releaseName !== null) {
      try {
        await this.client.query("SELECT pg_advisory_unlock(hashtext($1))", [releaseName]);
      } catch (err) {
        throw mapPgError(err);
      }
      return [[{ l: 1 }], undefined];
    }
    const translated = translateMysqlToPostgres(sql);
    try {
      const r = await this.client.query(translated, params);
      // mysql2 คืน ResultSetHeader (affectedRows) สำหรับ INSERT/UPDATE/DELETE — claimNotification พึ่งค่านี้กัน claim ซ้อน
      if ((r.command === "UPDATE" || r.command === "DELETE" || r.command === "INSERT") && r.rows.length === 0) {
        return [{ affectedRows: r.rowCount ?? 0 }, undefined];
      }
      return [r.rows, undefined];
    } catch (err) {
      throw mapPgError(err);
    }
  }

  async beginTransaction(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  release(): void {
    this.client.release();
  }
}

export class PgCompatPool {
  constructor(private readonly pool: PgPoolLike) {}

  async getConnection(): Promise<PgCompatConnection> {
    const client = await this.pool.connect();
    try {
      // เทียบเท่า mysql pool `timezone: Z` — Supabase default เป็น UTC อยู่แล้ว
      // SET นี้ทำให้ DATETIME ที่โค้ดเขียนด้วย UTC getters ตีความตรงกันเสมอ
      await client.query("SET TIME ZONE 'UTC'");
    } catch (err) {
      client.release();
      throw mapPgError(err);
    }
    return new PgCompatConnection(client);
  }

  async query(sql: string, params: unknown[] = []): Promise<MysqlLikeResult> {
    const conn = await this.getConnection();
    try {
      return await conn.query(sql, params);
    } finally {
      conn.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export interface PgCompatPoolOptions {
  /** จำนวน connection สูงสุดต่อ instance (default 3 — serverless-friendly) */
  max?: number;
}

/**
 * สร้าง pg pool ชี้ Supabase พร้อม guard ความปลอดภัยของเส้นทางนี้:
 * - ปฏิเสธ Supavisor transaction-mode (พอร์ต 6543) เพราะ advisory lock
 *   ระดับ session จะผิดความหมายบน pooler แบบ transaction — ต้องใช้
 *   session-mode string (พอร์ต 5432) เว้นแต่ตั้ง PG_ALLOW_TX_POOLER=1
 * - บังคับ SSL เมื่อ host เป็น Supabase (Supabase บังคับ SSL อยู่แล้ว)
 */
export async function createPgCompatPool(databaseUrl: string, opts?: PgCompatPoolOptions): Promise<PgCompatPool> {
  if (getDatabasePort(databaseUrl) === 6543 && process.env["PG_ALLOW_TX_POOLER"] !== "1") {
    throw new Error(
      "DATABASE_URL ชี้ Supavisor transaction-mode (พอร์ต 6543) ซึ่งไม่รองรับ named lock ของระบบนี้ — " +
        "ใช้ session-mode connection string (พอร์ต 5432) สำหรับเส้นทางชั่วคราวนี้",
    );
  }
  const { default: pg } = await import("pg");
  // BIGINT/COUNT(*) → number แบบ mysql2 (pg คืน int8 เป็น string); NUMERIC คงเป็น string เหมือน DECIMAL ของ mysql2
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get("sslmode");
  const isSupabaseHost =
    url.hostname.endsWith("supabase.co") || url.hostname.endsWith("pooler.supabase.com");
  const ssl =
    sslMode === "verify-full" || sslMode === "verify-ca"
      ? true
      : sslMode === "disable" || sslMode === "allow"
        ? undefined
        : isSupabaseHost
          ? { rejectUnauthorized: false }
          : undefined;
  const max = Number(process.env["PG_POOL_MAX"] ?? opts?.max ?? 3);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(ssl === undefined ? {} : { ssl }),
  });
  // ตรวจการเชื่อมต่อตั้งแต่สร้าง (fail-fast แทนที่จะพังตอน query แรก)
  const probe = await pool.connect();
  try {
    await probe.query("SELECT 1");
  } finally {
    probe.release();
  }
  return new PgCompatPool(pool);
}

/**
 * หาโฟลเดอร์ db/supabase (schema ฉบับ PostgreSQL) ด้วย logic เดียวกับ
 * findMigrationFile — ใช้เป็น MIGRATIONS_DIR อัตโนมัติเมื่อ dialect เป็น postgres
 * และผู้ใช้ไม่ได้ตั้ง MIGRATIONS_DIR เอง
 */
export function resolveSupabaseMigrationsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "..", "db", "supabase"), // dev: <root>/apps/api/src
    join(here, "..", "..", "..", "..", "db", "supabase"), // built: <root>/apps/api/dist/src
    join(process.cwd(), "db", "supabase"), // cwd = project root / Vercel function
    join(process.cwd(), "..", "..", "db", "supabase"), // cwd = apps/api
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // ลอง candidate ถัดไป
    }
  }
  return null;
}
