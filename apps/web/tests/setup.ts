import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy*/waitFor รอ 1 วินาทีโดยค่าเริ่มต้น — หน้าเต็มที่ render ช้าลงตอนเครื่องมีงานอื่น
// ล้มแบบสุ่มทั้งที่โค้ดถูก ขยายเป็น 5 วินาที (ยังสั้นกว่า testTimeout ใน vite.config.ts)
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom ไม่มี WebGL/canvas — คืน null เงียบ ๆ ให้โมเดลสามมิติเข้าโหมดสำรอง (แทน log "Not implemented")
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

// three.js แจ้ง error ตอนสร้าง WebGL ไม่ได้ (คาดไว้แล้วใน jsdom) — กรองออกไม่ให้รกผลเทสต์
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("THREE.WebGLRenderer")) return;
  originalError(...args);
};
