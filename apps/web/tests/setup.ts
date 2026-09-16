import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom ไม่มี WebGL/canvas — คืน null เงียบ ๆ ให้โมเดลสามมิติเข้าโหมดสำรอง (แทน log "Not implemented")
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
