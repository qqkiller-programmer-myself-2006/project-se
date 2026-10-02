import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    // กัน integration test (สร้าง/ลบข้อมูลจริง) ไปรันกับฐานข้อมูลที่ดูเป็น production — ดู tests/helpers/db-guard.ts
    setupFiles: ["./tests/helpers/setup-db-guard.ts"],
  },
});
