import { describe, expect, it } from "vitest";
import { loadErrorMessage } from "../src/lib/demo";

describe("loadErrorMessage", () => {
  it("แปลง fetch ล้มเหลวระดับเครือข่ายเป็นข้อความไทย", () => {
    expect(loadErrorMessage(new TypeError("Failed to fetch"), "x")).toBe(
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
    );
    expect(loadErrorMessage(new TypeError("Load failed"), "x")).toMatch(/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/);
  });

  it("TypeError จาก bug/response ผิดรูป ไม่ถูกบอกว่าเป็นปัญหาเน็ต", () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'flatMap')");
    expect(loadErrorMessage(bug, "x")).toBe(bug.message);
  });

  it("HTTP error ใช้ข้อความจริง · ค่าที่ไม่ใช่ Error ใช้ fallback", () => {
    expect(loadErrorMessage(new Error("เกิดข้อผิดพลาด (500)"), "x")).toBe("เกิดข้อผิดพลาด (500)");
    expect(loadErrorMessage("oops", "โหลดไม่สำเร็จ")).toBe("โหลดไม่สำเร็จ");
  });
});
