import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
