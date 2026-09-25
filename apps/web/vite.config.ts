import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    /**
     * เทสต์หน้าเต็ม (จองโต๊ะ/เชลล์/เมนู) ใช้ 1–2 วินาทีบนเครื่องว่าง แต่เกิน 5 วินาที
     * (ค่าเริ่มต้นของ vitest) ได้เมื่อเครื่องมีงานอื่น → ล้มแบบสุ่มทั้งที่โค้ดถูก
     */
    testTimeout: 20_000,
    /**
     * เทสต์ต้องไม่ขึ้นกับ .env.local ของเครื่องใครคนหนึ่ง
     *
     * Vite โหลด `apps/web/.env.local` ให้ vitest ด้วย เครื่องที่ตั้ง
     * `VITE_DEMO_MODE=true` ไว้จะทำให้ `isDemoModeEnabled()` เป็น true ตลอด
     * แล้ว `shouldFallbackToDemo()` คืน true กับ error ทุกชนิด — ทุกหน้าจึง
     * แสดงข้อมูลตัวอย่างแทน error/empty state และเทสต์ที่ตรวจสองสถานะนั้นล้ม
     * (เจอจริง: ล้ม 17 ตัวเฉพาะบนเครื่องที่เปิดโหมดสาธิตไว้)
     *
     * ปิดเป็นค่าตั้งต้น เทสต์ที่ต้องการโหมดสาธิตเปิดเองได้ (tests/demo-flag.test.tsx)
     */
    env: { VITE_DEMO_MODE: "false" },
  },
});
