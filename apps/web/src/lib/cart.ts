/**
 * Ticket 05: ตะกร้าฝั่งเว็บ — ข้อมูลชั่วคราวที่ลูกค้าแก้ไขได้ (localStorage)
 * ยังไม่เป็นคำสั่งซื้อจนกว่าจะกดยืนยัน (server ตรวจราคา/สถานะเมนูอีกครั้งแล้ว snapshot)
 * Ticket 07: แต่ละบรรทัดเลือกตัวเลือกได้ (รหัสตัวเลือก) + ความต้องการเฉพาะ (ข้อความล้วน ไม่เปลี่ยนราคา)
 * pure helpers ทั้งหมด (test ได้โดยไม่ต้องมี DOM) ยกเว้น load/save ที่คุยกับ storage
 */

export interface CartLine {
  menuId: string;
  quantity: number;
  /** หมายเหตุต่อรายการ (เช่น ไม่ใส่ผัก) — ยาวไม่เกิน 200 ตัวอักษร */
  note: string;
  /** Ticket 07: รหัสตัวเลือกที่เลือกในบรรทัดนี้ */
  options: string[];
  /** Ticket 07: ความต้องการเฉพาะ (เช่น เผ็ดน้อย) — ไม่เปลี่ยนราคา ยาวไม่เกิน 200 */
  specialRequest: string;
}

export type Cart = CartLine[];

export const CART_STORAGE_KEY = "paor-cart-v1";
export const CART_NOTE_MAX = 200;
export const CART_QTY_MAX = 20;
export const CART_SPECIAL_REQUEST_MAX = 200;

/** ลายเซ็นบรรทัด (เมนู + ตัวเลือกที่เรียงแล้ว) — หมายเหตุ/ความต้องการเฉพาะเป็นฟิลด์แก้ไขได้ ไม่อยู่ในคีย์ */
export function cartLineKey(line: Pick<CartLine, "menuId" | "options">): string {
  return `${line.menuId}|${[...line.options].sort().join(",")}`;
}

function sanitizeLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { menuId?: unknown; quantity?: unknown; note?: unknown; options?: unknown; specialRequest?: unknown };
  if (typeof row.menuId !== "string" || row.menuId.trim().length === 0) return null;
  const qty = typeof row.quantity === "number" && Number.isInteger(row.quantity) ? row.quantity : 0;
  if (qty < 1 || qty > CART_QTY_MAX) return null;
  const note = typeof row.note === "string" ? row.note.slice(0, CART_NOTE_MAX) : "";
  const options = Array.isArray(row.options)
    ? [...new Set(row.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0))].slice(0, 20)
    : [];
  const specialRequest =
    typeof row.specialRequest === "string" ? row.specialRequest.slice(0, CART_SPECIAL_REQUEST_MAX) : "";
  return { menuId: row.menuId, quantity: qty, note, options, specialRequest };
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
      // Ticket 07: เมนูเดียวกันแยกบรรทัดได้เมื่อตัวเลือก/หมายเหตุ/ความต้องการเฉพาะต่างกัน
      // (คีย์เดิม menuId อย่างเดียวกว้างเกินไป — ใช้ลายเซ็นบรรทัดแทน)
      if (!line) continue;
      const key = cartLineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
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

/**
 * ดึงจำนวนให้อยู่ในช่วงที่สั่งได้จริง: จำนวนเต็ม 1..CART_QTY_MAX
 *
 * ติดลบ, 0, ทศนิยม, NaN, Infinity, ข้อความที่แปลงไม่ได้ → ไม่มีทางหลุดออกไปเป็นจำนวนที่สั่ง
 * ทศนิยมปัดลง (2.9 → 2) เพราะปัดขึ้นจะกลายเป็นสั่งเกินที่ลูกค้าตั้งใจ
 */
export function clampQuantity(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return 1;
  const whole = Math.floor(n);
  if (whole < 1) return 1;
  if (whole > CART_QTY_MAX) return CART_QTY_MAX;
  return whole;
}

/**
 * เพิ่มบรรทัดจากป๊อปอัปสั่งซื้อ: จำนวน + ตัวเลือก + หมายเหตุ ในครั้งเดียว
 *
 * - จำนวนผ่าน {@link clampQuantity} เสมอ — ส่งค่าติดลบมาก็ไม่มีวันลดของในตะกร้า
 * - มีบรรทัดเมนู+ตัวเลือกเดียวกันอยู่แล้ว → รวมจำนวน (ไม่เกิน 20) แทนการแตกบรรทัดซ้ำ
 *   ซึ่ง server จะปฏิเสธ; หมายเหตุใหม่ที่ไม่ว่างแทนของเดิม (คำสั่งล่าสุดของลูกค้าชนะ)
 */
export function addLineToCart(
  cart: Cart,
  line: { menuId: string; quantity: unknown; options?: string[]; note?: string },
): Cart {
  const id = line.menuId.trim();
  if (!id) return cart;
  const quantity = clampQuantity(line.quantity);
  const options = [...new Set((line.options ?? []).filter((o) => typeof o === "string" && o.trim().length > 0))];
  const note = (line.note ?? "").trim().slice(0, CART_NOTE_MAX);
  const key = cartLineKey({ menuId: id, options });
  const found = cart.find((l) => cartLineKey(l) === key);
  if (found) {
    return cart.map((l) =>
      cartLineKey(l) === key
        ? { ...l, quantity: Math.min(CART_QTY_MAX, l.quantity + quantity), note: note || l.note }
        : l,
    );
  }
  return [...cart, { menuId: id, quantity, note, options, specialRequest: "" }];
}

/** เพิ่มเมนูลงตะกร้า (มีบรรทัดเดียวกันแล้ว +1, ยังไม่มีเริ่ม 1) — เกิน 20 ชิ้นต่อบรรทัดไม่เพิ่มแล้ว */
export function addToCart(cart: Cart, menuId: string, options: string[] = []): Cart {
  const id = menuId.trim();
  if (!id) return cart;
  const clean = [...new Set(options.filter((o) => typeof o === "string" && o.trim().length > 0))];
  const key = cartLineKey({ menuId: id, options: clean });
  const found = cart.find((l) => cartLineKey(l) === key);
  if (found) {
    if (found.quantity >= CART_QTY_MAX) return cart;
    return cart.map((l) => (cartLineKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l));
  }
  return [...cart, { menuId: id, quantity: 1, note: "", options: clean, specialRequest: "" }];
}

/** ตั้งจำนวน (0 = ลบบรรทัดออก) — ระบุ options เพื่อเลือกบรรทัดเมื่อเมนูเดียวกันมีหลายแบบ */
export function setQuantity(cart: Cart, menuId: string, qty: number, options: string[] = []): Cart {
  if (!Number.isInteger(qty) || qty < 0 || qty > CART_QTY_MAX) return cart;
  const key = cartLineKey({ menuId, options });
  if (qty === 0) return cart.filter((l) => cartLineKey(l) !== key);
  return cart.map((l) => (cartLineKey(l) === key ? { ...l, quantity: qty } : l));
}

export function setNote(cart: Cart, menuId: string, note: string, options: string[] = []): Cart {
  const key = cartLineKey({ menuId, options });
  return cart.map((l) => (cartLineKey(l) === key ? { ...l, note: note.slice(0, CART_NOTE_MAX) } : l));
}

export function removeFromCart(cart: Cart, menuId: string, options?: string[]): Cart {
  if (options === undefined) return cart.filter((l) => l.menuId !== menuId);
  const key = cartLineKey({ menuId, options });
  return cart.filter((l) => cartLineKey(l) !== key);
}

/** ตั้งความต้องการเฉพาะของบรรทัด (ข้อความล้วน ไม่เปลี่ยนราคา) */
export function setSpecialRequest(cart: Cart, menuId: string, text: string, options: string[] = []): Cart {
  const key = cartLineKey({ menuId, options });
  return cart.map((l) =>
    cartLineKey(l) === key ? { ...l, specialRequest: text.slice(0, CART_SPECIAL_REQUEST_MAX) } : l,
  );
}

/**
 * สลับตัวเลือกในบรรทัด (เลือก/ยกเลิกทีละตัว) — ชนกับบรรทัดอื่นที่ลายเซ็นเดียวกันให้รวมจำนวน
 * (กันส่งบรรทัดซ้ำซ้อนไป server แล้วถูกปฏิเสธ)
 */
export function toggleLineOption(cart: Cart, index: number, optionId: string): Cart {
  const line = cart[index];
  if (!line || !optionId) return cart;
  const has = line.options.includes(optionId);
  const nextOptions = has ? line.options.filter((o) => o !== optionId) : [...line.options, optionId];
  const nextKey = cartLineKey({ menuId: line.menuId, options: nextOptions });
  const clashAt = cart.findIndex((l, i) => i !== index && cartLineKey(l) === nextKey);
  if (clashAt === -1) {
    return cart.map((l, i) => (i === index ? { ...l, options: nextOptions } : l));
  }
  // รวมจำนวนเข้าบรรทัดที่ชน (cap 20) แล้วลบบรรทัดเดิม
  const target = cart[clashAt]!;
  const mergedQty = Math.min(CART_QTY_MAX, target.quantity + line.quantity);
  return cart
    .map((l, i) => (i === clashAt ? { ...l, quantity: mergedQty } : l))
    .filter((_, i) => i !== index);
}

/**
 * เลือกตัวเลือกในกลุ่มให้บรรทัด (radio: กลุ่มละ 1 ตัวเลือก — เลือกตัวใหม่แทนที่ตัวเดิมในกลุ่มเดียวกัน)
 * groupOptionIds = รหัสตัวเลือกทั้งหมดของกลุ่มนี้ (ใช้ถอดตัวเก่าออกก่อนใส่ตัวใหม่)
 */
export function setLineOption(cart: Cart, index: number, optionId: string, groupOptionIds: string[]): Cart {
  const line = cart[index];
  if (!line || !optionId) return cart;
  const inGroup = new Set(groupOptionIds);
  const nextOptions = [...line.options.filter((o) => !inGroup.has(o)), optionId];
  const nextKey = cartLineKey({ menuId: line.menuId, options: nextOptions });
  const clashAt = cart.findIndex((l, i) => i !== index && cartLineKey(l) === nextKey);
  if (clashAt === -1) {
    return cart.map((l, i) => (i === index ? { ...l, options: nextOptions } : l));
  }
  const target = cart[clashAt]!;
  const mergedQty = Math.min(CART_QTY_MAX, target.quantity + line.quantity);
  return cart
    .map((l, i) => (i === clashAt ? { ...l, quantity: mergedQty } : l))
    .filter((_, i) => i !== index);
}

/** อัปเดตบรรทัดด้วย index (ใช้ในหน้า UI ที่วนลูปบรรทัด) */
export function patchLine(cart: Cart, index: number, patch: Partial<Pick<CartLine, "quantity" | "note" | "specialRequest">>): Cart {
  const line = cart[index];
  if (!line) return cart;
  const next: CartLine = { ...line };
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(patch.quantity) || patch.quantity < 0 || patch.quantity > CART_QTY_MAX) return cart;
    if (patch.quantity === 0) return cart.filter((_, i) => i !== index);
    next.quantity = patch.quantity;
  }
  if (patch.note !== undefined) next.note = patch.note.slice(0, CART_NOTE_MAX);
  if (patch.specialRequest !== undefined) next.specialRequest = patch.specialRequest.slice(0, CART_SPECIAL_REQUEST_MAX);
  return cart.map((l, i) => (i === index ? next : l));
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

/** ยอดรวมแบบรวมส่วนต่างตัวเลือก (UI ตะกร้าใช้ตัวนี้ — ราคาจริงตรึงที่ server ตอนยืนยัน) */
export function cartTotalWith(cart: Cart, priceOf: (line: CartLine) => number | null): number {
  const total = cart.reduce((sum, l) => {
    const price = priceOf(l);
    return sum + (price === null ? 0 : price * l.quantity);
  }, 0);
  return Math.round(total * 100) / 100;
}
