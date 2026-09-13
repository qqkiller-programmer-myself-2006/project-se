import { describe, expect, it, vi, beforeEach } from "vitest";
import { previewThaiPhone } from "../src/lib/phone";

describe("previewThaiPhone (mirror กฎ server เบื้องต้น)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalize รูปแบบไทยทั่วไป", () => {
    expect(previewThaiPhone("0812345678")).toBe("0812345678");
    expect(previewThaiPhone("081-234-5678")).toBe("0812345678");
    expect(previewThaiPhone("+66812345678")).toBe("0812345678");
    expect(previewThaiPhone("66812345678")).toBe("0812345678");
    expect(previewThaiPhone("  081 234 5678 ")).toBe("0812345678");
  });

  it("คืน null เมื่อรูปแบบผิด (server ตรวจซ้ำเสมอ)", () => {
    expect(previewThaiPhone("")).toBeNull();
    expect(previewThaiPhone("12345")).toBeNull();
    expect(previewThaiPhone("081234567")).toBeNull();
    expect(previewThaiPhone("abc")).toBeNull();
  });
});
