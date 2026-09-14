import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartCount,
  cartTotal,
  clearCart,
  loadCart,
  removeFromCart,
  saveCart,
  setNote,
  setQuantity,
  CART_STORAGE_KEY,
} from "../src/lib/cart";

function memStorage(initial?: Record<string, string>) {
  const data: Record<string, string> = { ...(initial ?? {}) };
  return {
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    data,
  };
}

describe("ตะกร้าฝั่งเว็บ (Ticket 05 lib)", () => {
  it("เพิ่ม/ลดจำนวน รวมยอด และลบรายการ", () => {
    let cart = addToCart([], "m1");
    expect(cart).toEqual([{ menuId: "m1", quantity: 1, note: "" }]);
    cart = addToCart(cart, "m1");
    cart = addToCart(cart, "m2");
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart, (id) => (id === "m1" ? 50 : 25))).toBe(125);
    cart = setQuantity(cart, "m1", 1);
    expect(cartTotal(cart, (id) => (id === "m1" ? 50 : 25))).toBe(75);
    cart = setQuantity(cart, "m2", 0);
    expect(cart).toHaveLength(1);
    cart = removeFromCart(cart, "m1");
    expect(cart).toEqual([]);
  });

  it("จำนวนเกิน 20 ไม่เพิ่ม/ไม่รับค่า", () => {
    let cart = [{ menuId: "m1", quantity: 20, note: "" }];
    expect(addToCart(cart, "m1")).toEqual(cart);
    expect(setQuantity(cart, "m1", 21)).toEqual(cart);
    expect(setQuantity(cart, "m1", -1)).toEqual(cart);
  });

  it("หมายเหตุถูกตัดที่ 200 ตัวอักษร", () => {
    const cart = setNote([{ menuId: "m1", quantity: 1, note: "" }], "m1", "ก".repeat(250));
    expect(cart[0]!.note).toHaveLength(200);
  });

  it("load/save ผ่าน storage และ sanitize ข้อมูลเสีย", () => {
    const storage = memStorage();
    saveCart(
      [
        { menuId: "m1", quantity: 2, note: "ไม่เผ็ด" },
        { menuId: "m2", quantity: 1, note: "" },
      ],
      storage,
    );
    expect(storage.data[CART_STORAGE_KEY]).toContain("m1");
    expect(loadCart(storage)).toHaveLength(2);

    // ข้อมูลเสีย: เมนูซ้ำ/จำนวนผิด/ไม่มี menuId ถูกกรองทิ้ง
    const dirty = memStorage({
      [CART_STORAGE_KEY]: JSON.stringify([
        { menuId: "m1", quantity: 1, note: "" },
        { menuId: "m1", quantity: 2, note: "" },
        { menuId: "", quantity: 1 },
        { menuId: "m9", quantity: 0 },
        { menuId: "m9", quantity: 99 },
        "oops",
      ]),
    });
    expect(loadCart(dirty)).toEqual([{ menuId: "m1", quantity: 1, note: "" }]);

    // JSON พัง → ตะกร้าว่าง
    expect(loadCart(memStorage({ [CART_STORAGE_KEY]: "{nope" }))).toEqual([]);
    // clear แล้วลบ key ออกจาก storage
    saveCart(clearCart(), storage);
    expect(CART_STORAGE_KEY in storage.data).toBe(false);
  });

  it("ยอดรวมปัดเศษทศนิยม 2 ตำแหน่ง", () => {
    const cart = [{ menuId: "m1", quantity: 3, note: "" }];
    expect(cartTotal(cart, () => 19.99)).toBe(59.97);
  });
});
