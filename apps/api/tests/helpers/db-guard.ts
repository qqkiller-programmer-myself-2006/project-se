/**
 * ตัวกันไม่ให้ integration test ที่ใช้ฐานข้อมูลจริง (สร้าง/ลบข้อมูล) ไปรันกับฐานข้อมูล production โดยพลาด
 *
 * กฎ (ผิดข้อใดข้อหนึ่ง → ปฏิเสธทั้งชุด ไม่ใช่แค่ข้ามไฟล์):
 * 1. TEST_DATABASE_URL ต้องไม่เท่ากับ DATABASE_URL (ค่าที่ production/dev ใช้)
 * 2. host เป็น Supabase (supabase.co / pooler.supabase.com): แยกโปรเจกต์ทดสอบกับ production ไม่ได้จาก URL
 *    (ชื่อฐานข้อมูลเป็น "postgres" เสมอ) → ต้องยืนยันเองด้วย TEST_DATABASE_CONFIRM_REMOTE=1
 * 3. host อื่น: ชื่อฐานข้อมูลต้องมีคำว่า "test" (เช่น paor_test)
 * ไม่ตั้ง TEST_DATABASE_URL = ไม่มีอะไรต้องกัน (test ที่ใช้ DB จะ skip เอง)
 */

export interface DbGuardEnv {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
  TEST_DATABASE_CONFIRM_REMOTE?: string;
}

export type DbGuardResult = { ok: true } | { ok: false; reason: string };

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function sameUrl(a: string, b: string): boolean {
  const ua = parse(a);
  const ub = parse(b);
  if (!ua || !ub) return a.trim() === b.trim();
  const norm = (u: URL) => `${u.protocol}//${u.username}@${u.hostname}:${u.port || "-"}${u.pathname}`;
  return norm(ua) === norm(ub);
}

export function checkTestDatabaseUrl(env: DbGuardEnv): DbGuardResult {
  const url = env.TEST_DATABASE_URL?.trim() ?? "";
  if (!url) return { ok: true };
  const parsed = parse(url);
  if (!parsed) {
    return { ok: false, reason: "TEST_DATABASE_URL อ่านเป็น URL ไม่ได้ (ต้องเป็น mysql://… หรือ postgres://…)" };
  }
  const prod = env.DATABASE_URL?.trim() ?? "";
  if (prod && sameUrl(url, prod)) {
    return { ok: false, reason: "TEST_DATABASE_URL เหมือน DATABASE_URL — ห้ามรัน integration test กับฐานข้อมูลที่ใช้งานจริง" };
  }
  const host = parsed.hostname.toLowerCase();
  const isSupabase = host.endsWith("supabase.co") || host.endsWith("pooler.supabase.com");
  if (isSupabase) {
    if (env.TEST_DATABASE_CONFIRM_REMOTE === "1") return { ok: true };
    return {
      ok: false,
      reason:
        "TEST_DATABASE_URL ชี้ Supabase ซึ่งแยกโปรเจกต์ทดสอบกับ production จาก URL ไม่ได้ — " +
        "ถ้ายืนยันแล้วว่าเป็นโปรเจกต์ทดสอบแยก ให้ตั้ง TEST_DATABASE_CONFIRM_REMOTE=1",
    };
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/test/i.test(dbName)) {
    return {
      ok: false,
      reason: `ชื่อฐานข้อมูลทดสอบต้องมีคำว่า "test" (ตอนนี้: "${dbName || "(ว่าง)"}") เช่น paor_test`,
    };
  }
  return { ok: true };
}

/** เรียกใน setup ของ vitest: ผิดกฎ → throw ให้ทั้งชุดล้ม พร้อมเหตุผลภาษาไทย */
export function assertSafeTestDatabase(env: DbGuardEnv = process.env as DbGuardEnv): void {
  const result = checkTestDatabaseUrl(env);
  if (!result.ok) {
    throw new Error(`[db-guard] ปฏิเสธรัน integration test: ${result.reason}`);
  }
}
