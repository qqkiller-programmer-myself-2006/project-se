/**
 * Ticket 05: ตะกร้าฝั่งเว็บ — ข้อมูลชั่วคราวที่ลูกค้าแก้ไขได้ (localStorage)
 * ยังไม่เป็นคำสั่งซื้อจนกว่าจะกดยืนยัน (server ตรวจราคา/สถานะเมนูอีกครั้งแล้ว snapshot)
 * pure helpers ทั้งหมด (test ได้โดยไม่ต้องมี DOM) ยกเว้น load/save ที่คุยกับ storage
 */

export interface CartLine {
  menuId: string;
  quantity: number;
  /** หมายเหตุต่อรายการ (เช่น ไม่ใส่ผัก) — ยาวไม่เกิน 200 ตัวอักษร */
  note: string;
}

export type Cart = CartLine[];

export const CART_STORAGE_KEY = "paor-cart-v1";
export const CART_NOTE_MAX = 200;
export const CART_QTY_MAX = 20;

function sanitizeLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { menuId?: unknown; quantity?: unknown; note?: unknown };
  if (typeof row.menuId !== "string" || row.menuId.trim().length === 0) return null;
  const qty = typeof row.quantity === "number" && Number.isInteger(row.quantity) ? row.quantity : 0;
  if (qty < 1 || qty > CART_QTY_MAX) return null;
  const note = typeof row.note === "string" ? row.note.slice(0, CART_NOTE_MAX) : "";
  return { menuId: row.menuId, quantity: qty, note };
}

export function loadCart(storage?: Pick<Storage, "getItem">): Cart {
  try {
    const source = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const raw = source?.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: Cart = [];
    for (const row of parsed) {
      const line = sanitizeLine(row);
      if (!line || seen.has(line.menuId)) continue;
      seen.add(line.menuId);
      out.push(line);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCart(cart: Cart, storage?: Pick<Storage, "setItem" | "removeItem">): void {
  try {
    const target = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    if (!target) return;
    if (cart.length === 0) {
      target.removeItem(CART_STORAGE_KEY);
      return;
    }
    target.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // storage เต็ม/ใช้ไม่ได้ — ตะกร้าใน memory ยังใช้งานต่อได้
  }
}

/** เพิ่มเมนูลงตะกร้า (มีแล้ว +1, ยังไม่มีเริ่ม 1) — เกิน 20 ชิ้นต่อรายการไม่เพิ่มแล้ว */
export function addToCart(cart: Cart, menuId: string): Cart {
  const id = menuId.trim();
  if (!id) return cart;
  const found = cart.find((l) => l.menuId === id);
  if (found) {
    if (found.quantity >= CART_QTY_MAX) return cart;
    return cart.map((l) => (l.menuId === id ? { ...l, quantity: l.quantity + 1 } : l));
  }
  return [...cart, { menuId: id, quantity: 1, note: "" }];
}

/** ตั้งจำนวน (0 = ลบรายการออก) */
export function setQuantity(cart: Cart, menuId: string, qty: number): Cart {
  if (!Number.isInteger(qty) || qty < 0 || qty > CART_QTY_MAX) return cart;
  if (qty === 0) return cart.filter((l) => l.menuId !== menuId);
  return cart.map((l) => (l.menuId === menuId ? { ...l, quantity: qty } : l));
}

export function setNote(cart: Cart, menuId: string, note: string): Cart {
  return cart.map((l) => (l.menuId === menuId ? { ...l, note: note.slice(0, CART_NOTE_MAX) } : l));
}

export function removeFromCart(cart: Cart, menuId: string): Cart {
  return cart.filter((l) => l.menuId !== menuId);
}

export function clearCart(): Cart {
  return [];
}

export function cartCount(cart: Cart): number {
  return cart.reduce((n, l) => n + l.quantity, 0);
}

/** ยอดรวมจากราคาปัจจุบัน (ยอดจริงตรึงที่ server ตอนยืนยันอีกครั้ง) */
export function cartTotal(cart: Cart, priceOf: (menuId: string) => number | null): number {
  const total = cart.reduce((sum, l) => {
    const price = priceOf(l.menuId);
    return sum + (price === null ? 0 : price * l.quantity);
  }, 0);
  return Math.round(total * 100) / 100;
}
