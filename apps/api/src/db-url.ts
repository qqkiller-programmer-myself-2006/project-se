/**
 * ตัวแยก database dialect จาก DATABASE_URL (เส้นทางชั่วคราว Vercel + Supabase)
 *
 * - `mysql://...` → MySQL ผ่าน mysql2 (พฤติกรรมเดิมทุกประการ)
 * - `postgres://...` / `postgresql://...` → PostgreSQL ผ่าน pg + pg-compat
 *   (Supabase: ใช้ Supavisor session-mode string พอร์ต 5432 — ดู .env-now.example)
 * - scheme อื่น หรือไม่มี URL → throw ข้อความชัดเจน (fail-fast)
 *
 * ห้ามปล่อยให้ mysql2 รับ PostgreSQL URL ตรง ๆ เด็ดขาด (wire protocol
 * คนละชนิด จะล้มเหลวแบบงง) — จุดนี้คือ gate เดียวที่ตัดสินเส้นทาง driver
 */

export type DatabaseDialect = "mysql" | "postgres";

const POSTGRES_SCHEME = /^postgres(ql)?:\/\//i;
const MYSQL_SCHEME = /^mysql:\/\//i;

/** จำแนก dialect จาก URL; throw เมื่อว่างเปล่าหรือ scheme ไม่รองรับ */
export function getDatabaseDialect(databaseUrl: string | undefined): DatabaseDialect {
  if (!databaseUrl || databaseUrl.trim() === "") {
    throw new Error(
      "ต้องตั้งค่า DATABASE_URL (MySQL: mysql://user:pass@host:3306/paor หรือ Supabase PostgreSQL: postgres://...)",
    );
  }
  if (MYSQL_SCHEME.test(databaseUrl)) return "mysql";
  if (POSTGRES_SCHEME.test(databaseUrl)) return "postgres";
  const scheme = databaseUrl.split(":")[0] ?? "(ไม่ระบุ)";
  throw new Error(
    `DATABASE_URL ใช้ scheme ที่ไม่รองรับ ("${scheme}") — รองรับเฉพาะ mysql:// และ postgres:// (Supabase) เท่านั้น`,
  );
}

/**
 * ดึงพอร์ตจาก URL (NaN เมื่อไม่มี/parse ไม่ได้)
 * ใช้เตือนเมื่อชี้ไป Supavisor transaction-mode (6543) ซึ่งไม่เข้ากับ
 * named-lock แบบ session-level ของเส้นทางนี้
 */
export function getDatabasePort(databaseUrl: string): number {
  try {
    return Number(new URL(databaseUrl).port);
  } catch {
    return NaN;
  }
}
