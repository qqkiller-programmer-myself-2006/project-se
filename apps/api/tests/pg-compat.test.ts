import { describe, expect, it, vi } from "vitest";
import {
  PgCompatConnection,
  PgCompatPool,
  mapPgError,
  parseMysqlGetLock,
  parseMysqlReleaseLock,
  translateMysqlToPostgres,
  type PgClientLike,
} from "../src/pg-compat.js";

describe("translateMysqlToPostgres", () => {
  it("? → $n ตามลำดับ (ข้าม ? ใน string literal)", () => {
    expect(translateMysqlToPostgres("SELECT * FROM users WHERE id = ? AND name <> 'a?b' LIMIT ?")).toBe(
      "SELECT * FROM users WHERE id = $1 AND name <> 'a?b' LIMIT $2",
    );
  });

  it("IN (?, ?, ?) และ ESCAPE backslash", () => {
    expect(
      translateMysqlToPostgres("SELECT * FROM customers WHERE name LIKE ? ESCAPE '\\\\' ORDER BY created_at ASC LIMIT ?"),
    ).toBe("SELECT * FROM customers WHERE name LIKE $1 ESCAPE '\\' ORDER BY created_at ASC LIMIT $2");
  });

  it("LIKE pattern แบบฝัง (login\\_%) คงเดิม — PG ใช้ backslash escape ตั้งต้นเหมือนกัน", () => {
    expect(translateMysqlToPostgres("SELECT * FROM audit_logs WHERE action LIKE 'login\\_%' ORDER BY id DESC LIMIT ?")).toBe(
      "SELECT * FROM audit_logs WHERE action LIKE 'login\\_%' ORDER BY id DESC LIMIT $1",
    );
  });

  it("ON DUPLICATE KEY UPDATE ทั้ง 6 ตาราง → ON CONFLICT ตรง PK/unique", () => {
    expect(
      translateMysqlToPostgres(
        "INSERT INTO shop_settings (id, shop_name) VALUES (1, ?) ON DUPLICATE KEY UPDATE shop_name = VALUES(shop_name)",
      ),
    ).toBe("INSERT INTO shop_settings (id, shop_name) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET shop_name = EXCLUDED.shop_name");
    expect(
      translateMysqlToPostgres(
        "INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (?, ?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE closed = VALUES(closed), intervals = VALUES(intervals)",
      ),
    ).toBe(
      "INSERT INTO shop_schedule (weekday, closed, intervals) VALUES ($1, $2, CAST($3 AS JSONB)) ON CONFLICT (weekday) DO UPDATE SET closed = EXCLUDED.closed, intervals = EXCLUDED.intervals",
    );
    expect(
      translateMysqlToPostgres(
        "INSERT INTO notification_consents (customer_id, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)",
      ),
    ).toBe(
      "INSERT INTO notification_consents (customer_id, enabled) VALUES ($1, $2) ON CONFLICT (customer_id) DO UPDATE SET enabled = EXCLUDED.enabled",
    );
    expect(
      translateMysqlToPostgres(
        "INSERT INTO station_capacity (station, per_slot, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE per_slot = VALUES(per_slot), updated_by = VALUES(updated_by)",
      ),
    ).toBe(
      "INSERT INTO station_capacity (station, per_slot, updated_by) VALUES ($1, $2, $3) ON CONFLICT (station) DO UPDATE SET per_slot = EXCLUDED.per_slot, updated_by = EXCLUDED.updated_by",
    );
  });

  it("CAST(? AS JSON) → JSONB และ JSON_CONTAINS → ? operator", () => {
    expect(translateMysqlToPostgres("UPDATE users SET roles = CAST(? AS JSON), is_active = ? WHERE id = ?")).toBe(
      "UPDATE users SET roles = CAST($1 AS JSONB), is_active = $2 WHERE id = $3",
    );
    expect(translateMysqlToPostgres("SELECT COUNT(*) AS n FROM users WHERE JSON_CONTAINS(roles, '\"owner\"')")).toBe(
      "SELECT COUNT(*) AS n FROM users WHERE (roles ? 'owner')",
    );
  });

  it("SELECT ... FOR UPDATE / transaction / CURRENT_TIMESTAMP ผ่านตรง (แปลแค่ placeholder)", () => {
    const sql = "SELECT * FROM customers WHERE id = ? LIMIT 1 FOR UPDATE";
    expect(translateMysqlToPostgres(sql)).toBe("SELECT * FROM customers WHERE id = $1 LIMIT 1 FOR UPDATE");
    expect(translateMysqlToPostgres("UPDATE prediction_models SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'")).toBe(
      "UPDATE prediction_models SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'",
    );
  });

  it("ตารางที่ไม่รู้จักใน upsert → throw (กัน upsert ผิดความหมาย)", () => {
    expect(() =>
      translateMysqlToPostgres("INSERT INTO mystery (id, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)"),
    ).toThrow(/conflict target/);
  });

  it("คำว่า ON DUPLICATE KEY UPDATE ในคอมเมนต์ไม่ถูกแปลเป็น upsert", () => {
    const ddl = "-- INSERT ... ON DUPLICATE KEY UPDATE ที่โค้ด\n\nCREATE TABLE IF NOT EXISTS queue_jobs (id CHAR(36) NOT NULL PRIMARY KEY)";
    expect(translateMysqlToPostgres(ddl)).toBe(ddl);
  });

  it("IF() ใน upsert และ backtick → throw (fail-fast)", () => {
    expect(() =>
      translateMysqlToPostgres("INSERT INTO menu_items (id) VALUES (?) ON DUPLICATE KEY UPDATE name = IF(id=VALUES(id),VALUES(name),name)"),
    ).toThrow(/IF\(\)/);
    expect(() => translateMysqlToPostgres("SELECT `id` FROM `users`")).toThrow(/backtick/);
  });

  it("named lock ห้ามผ่าน translate (ต้องใช้ query path ที่มี state)", () => {
    expect(() => translateMysqlToPostgres("SELECT GET_LOCK('paor_reservation_write', 10) AS l")).toThrow(/named lock/);
    expect(() => translateMysqlToPostgres("SELECT RELEASE_LOCK('paor_reservation_write')")).toThrow(/named lock/);
  });
});

describe("parseMysqlGetLock / parseMysqlReleaseLock", () => {
  it("ดึงชื่อ lock ครบ 3 จุดของระบบ", () => {
    expect(parseMysqlGetLock("SELECT GET_LOCK('paor_reservation_write', 10) AS l")).toBe("paor_reservation_write");
    expect(parseMysqlGetLock("SELECT GET_LOCK('paor_payment_write', 10) AS l")).toBe("paor_payment_write");
    expect(parseMysqlGetLock("SELECT GET_LOCK('staff_first_owner', 10) AS l")).toBe("staff_first_owner");
    expect(parseMysqlGetLock("SELECT 1")).toBeNull();
    expect(parseMysqlReleaseLock("SELECT RELEASE_LOCK('paor_payment_write')")).toBe("paor_payment_write");
    expect(parseMysqlReleaseLock("SELECT 1")).toBeNull();
  });
});

describe("mapPgError", () => {
  it("23505 → ER_DUP_ENTRY คง message (call-site แยก constraint จาก message)", () => {
    const mapped = mapPgError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uq_reservations_idempotency"',
    }) as { code: string; message: string };
    expect(mapped.code).toBe("ER_DUP_ENTRY");
    expect(mapped.message).toContain("uq_reservations_idempotency");
  });

  it("42701 → ER_DUP_FIELDNAME (migration rerun tolerance)", () => {
    const mapped = mapPgError({ code: "42701", message: "column already exists" }) as { code: string };
    expect(mapped.code).toBe("ER_DUP_FIELDNAME");
  });

  it("error อื่น/ไม่ใช่ object → คืนเดิม", () => {
    const other = { code: "ECONNREFUSED", message: "x" };
    expect(mapPgError(other)).toBe(other);
    expect(mapPgError(null)).toBeNull();
  });
});

function fakeClient(responses: Record<string, { rows: Record<string, unknown>[] }>): PgClientLike & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async query(text: string) {
      seen.push(text);
      if (text.startsWith("SELECT pg_try_advisory_lock")) return { rows: [{ l: true }] };
      if (text.startsWith("SELECT pg_advisory_unlock")) return { rows: [{ result: true }] };
      const hit = responses[text];
      if (hit) return hit;
      return { rows: [] };
    },
    release: vi.fn(),
  };
}

describe("PgCompatConnection (ฉีด fake pg client — ไม่ต้องมี DB จริง)", () => {
  it("แปล placeholder แล้วคืนรูป [rows, undefined] แบบ mysql2", async () => {
    const client = fakeClient({ "SELECT * FROM users WHERE id = $1 LIMIT 1": { rows: [{ id: "u1" }] } });
    const conn = new PgCompatConnection(client);
    const [rows, fields] = await conn.query("SELECT * FROM users WHERE id = ? LIMIT 1", ["u1"]);
    expect(rows).toEqual([{ id: "u1" }]);
    expect(fields).toBeUndefined();
  });

  it("GET_LOCK → advisory lock คืน [{l:1}] ในรูปเดิม", async () => {
    const client = fakeClient({});
    const conn = new PgCompatConnection(client);
    const [rows] = await conn.query("SELECT GET_LOCK('paor_reservation_write', 10) AS l");
    expect(rows).toEqual([{ l: 1 }]);
    expect(client.seen[0]).toContain("pg_try_advisory_lock");
    const [rel] = await conn.query("SELECT RELEASE_LOCK('paor_reservation_write')");
    expect(rel).toEqual([{ l: 1 }]);
  });

  it("UPDATE/DELETE คืน {affectedRows} แบบ ResultSetHeader (claimNotification พึ่งค่านี้)", async () => {
    const client: PgClientLike = {
      async query() {
        return { rows: [], command: "UPDATE", rowCount: 0 };
      },
      release: vi.fn(),
    };
    const conn = new PgCompatConnection(client);
    const [res] = await conn.query("UPDATE notifications SET status = 'sending' WHERE id = ?", ["n1"]);
    expect(res).toEqual({ affectedRows: 0 });
  });

  it("BEGIN/COMMIT/ROLLBACK ผ่านคำสั่ง PG ตรง", async () => {
    const client = fakeClient({});
    const conn = new PgCompatConnection(client);
    await conn.beginTransaction();
    await conn.commit();
    await conn.rollback();
    expect(client.seen).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  it("error 23505 จาก pg กลายเป็น ER_DUP_ENTRY ที่ call-site เดิมเข้าใจ", async () => {
    const client: PgClientLike = {
      async query() {
        throw { code: "23505", message: 'duplicate key value violates unique constraint "uq_orders_idempotency"' };
      },
      release: vi.fn(),
    };
    const conn = new PgCompatConnection(client);
    await expect(conn.query("INSERT INTO orders (id) VALUES (?)", ["x"])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });
});

describe("PgCompatPool", () => {
  it("getConnection ตั้ง TIME ZONE UTC (เทียบเท่า mysql timezone:Z) แล้ว query ผ่าน client เดียวกัน", async () => {
    const client = fakeClient({ "SELECT * FROM shop_settings WHERE id = 1 LIMIT 1": { rows: [{ shop_name: "s" }] } });
    const pool = new PgCompatPool({ async connect() { return client; }, async end() {} });
    const [rows] = await pool.query("SELECT * FROM shop_settings WHERE id = 1 LIMIT 1");
    expect(rows).toEqual([{ shop_name: "s" }]);
    expect(client.seen[0]).toBe("SET TIME ZONE 'UTC'");
  });
});
