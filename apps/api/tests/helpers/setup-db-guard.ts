import { assertSafeTestDatabase } from "./db-guard.js";

// รันก่อนทุกไฟล์ test (ดู vitest.config.ts) — ไม่ตั้ง TEST_DATABASE_URL = ผ่านเงียบ ๆ
assertSafeTestDatabase();
