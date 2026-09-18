import { describe, expect, it } from "vitest";
import {
  TABLE_CONTEXT_STORAGE_KEY,
  loadTableContext,
  resolveTableContext,
  sanitizeTableCode,
  saveTableContext,
  tableCodeFromSearch,
} from "../src/lib/tableContext";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("บริบทโต๊ะจากการสแกน QR", () => {
  it("รับรหัสโต๊ะที่เป็นตัวอักษร/ตัวเลข/ขีด และไทยได้", () => {
    expect(sanitizeTableCode("S4")).toBe("S4");
    expect(sanitizeTableCode("  sala-01 ")).toBe("sala-01");
    expect(sanitizeTableCode("โต๊ะ1")).toBe("โต๊ะ1");
  });

  it("ปฏิเสธค่าที่ไม่ใช่รหัสโต๊ะ", () => {
    expect(sanitizeTableCode("")).toBeNull();
    expect(sanitizeTableCode("   ")).toBeNull();
    expect(sanitizeTableCode("<script>")).toBeNull();
    expect(sanitizeTableCode("a/b")).toBeNull();
    expect(sanitizeTableCode("x".repeat(41))).toBeNull();
    expect(sanitizeTableCode(42)).toBeNull();
    expect(sanitizeTableCode(null)).toBeNull();
  });

  it("อ่านได้ทั้ง ?table= และ ?t=", () => {
    expect(tableCodeFromSearch("?table=S4")).toBe("S4");
    expect(tableCodeFromSearch("?t=A1&x=1")).toBe("A1");
    expect(tableCodeFromSearch("?other=1")).toBeNull();
    expect(tableCodeFromSearch("")).toBeNull();
  });

  it("บันทึกและอ่านค่าจาก storage; ค่าว่างลบของเดิมออก", () => {
    const store = memoryStorage();
    saveTableContext("S4", store);
    expect(store.data.get(TABLE_CONTEXT_STORAGE_KEY)).toBe("S4");
    expect(loadTableContext(store)).toBe("S4");
    saveTableContext(null, store);
    expect(loadTableContext(store)).toBeNull();
  });

  it("ค่าที่เก็บไว้เสียหายถือว่าไม่มีโต๊ะ", () => {
    const store = memoryStorage({ [TABLE_CONTEXT_STORAGE_KEY]: "a b/c" });
    expect(loadTableContext(store)).toBeNull();
  });

  it("สแกน QR โต๊ะใหม่ทับค่าที่จำไว้ (ย้ายโต๊ะ)", () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "S1");
    expect(resolveTableContext("?table=S9")).toBe("S9");
    expect(sessionStorage.getItem(TABLE_CONTEXT_STORAGE_KEY)).toBe("S9");
    // ไม่มี query แล้วยังจำโต๊ะเดิมได้ตลอดแท็บ
    expect(resolveTableContext("")).toBe("S9");
    sessionStorage.clear();
  });
});
