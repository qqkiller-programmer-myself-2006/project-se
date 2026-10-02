import { getDatabaseDialect, type DatabaseDialect } from "../../src/db-url.js";

/**
 * ตัวช่วย SQL ตรงสำหรับ integration test (ตรวจผลในตาราง + ล้างข้อมูลที่ test สร้าง) ที่ใช้ได้ทั้ง
 * MySQL (`mysql://`) และ PostgreSQL/Supabase (`postgres://`) — เขียน SQL มาตรฐานล้วน ใช้ `?` เป็น placeholder
 * (แปลงเป็น `$1…` ให้เองบน Postgres) **ห้ามใช้ไวยากรณ์เฉพาะ MySQL** เช่น `DELETE a FROM a JOIN b`
 * ให้ใช้ `DELETE FROM a WHERE x IN (SELECT …)` แทน
 */
export interface SqlAdmin {
  readonly dialect: DatabaseDialect;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** ค่าตัวเลขจากคอลัมน์ (DECIMAL/COUNT/SUM คืนเป็น string บางไดรเวอร์) */
  num(value: unknown): number;
  end(): Promise<void>;
}

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function openSqlAdmin(url: string): Promise<SqlAdmin> {
  const dialect = getDatabaseDialect(url);
  const num = (value: unknown): number => Number(value);
  if (dialect === "mysql") {
    const mysql = (await import("mysql2/promise")).default;
    const conn = await mysql.createConnection(url);
    return {
      dialect,
      num,
      async query<T>(sql: string, params: unknown[] = []) {
        const [rows] = await conn.query(sql, params);
        return rows as T[];
      },
      async end() {
        await conn.end();
      },
    };
  }
  const { default: pg } = await import("pg");
  const host = new URL(url).hostname;
  const isSupabase = host.endsWith("supabase.co") || host.endsWith("pooler.supabase.com");
  const client = new pg.Client({
    connectionString: url,
    ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  return {
    dialect,
    num,
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async end() {
      await client.end();
    },
  };
}
