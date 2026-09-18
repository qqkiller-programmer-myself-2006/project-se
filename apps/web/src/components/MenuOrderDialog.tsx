import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicMenuItemWithOptions } from "../lib/api";
import { CART_NOTE_MAX, CART_QTY_MAX, addLineToCart, clampQuantity, loadCart, saveCart } from "../lib/cart";
import { MenuItemImage } from "./MenuItemImage";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDelta(n: number): string {
  if (n === 0) return "ไม่เพิ่มราคา";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/** กลุ่มตัวเลือกเรียงตามลำดับที่ร้านตั้ง — ตัวเลือกแรกของแต่ละกลุ่มคือค่าเริ่มต้น */
function sortedGroups(item: PublicMenuItemWithOptions) {
  return [...(item.optionGroups ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({ ...g, options: [...g.options].sort((a, b) => a.sortOrder - b.sortOrder) }))
    .filter((g) => g.options.length > 0);
}

export type MenuOrderDialogProps = {
  item: PublicMenuItemWithOptions;
  onClose: () => void;
  /** เพิ่มลงตะกร้าแล้ว — ส่งจำนวนชิ้นที่เพิ่มกลับไปให้หน้าที่เปิดแสดงผล */
  onAdded?: (summary: { name: string; quantity: number }) => void;
};

/**
 * ป๊อปอัปสั่งซื้อจากการ์ดเมนู: เลือกตัวเลือก (ขนาด/เพิ่มไข่) หมายเหตุ และจำนวน แล้วเพิ่มลงตะกร้า
 *
 * จำนวนถูกบังคับอยู่ในช่วง 1..CART_QTY_MAX ทุกทาง — ปุ่ม −/+ ปิดที่ขอบ, ช่องพิมพ์ถูกดึงกลับเข้าช่วง
 * เมื่อออกจากช่อง และ `addLineToCart` ตรวจซ้ำอีกชั้น ติดลบ/0/ทศนิยมจึงหลุดลงตะกร้าไม่ได้
 *
 * Esc / ปุ่มปิด / แตะนอกกรอบ = ปิดโดยไม่เพิ่มอะไร · คืนโฟกัสให้การ์ดที่เปิดเมื่อปิด
 */
export function MenuOrderDialog({ item, onClose, onAdded }: MenuOrderDialogProps) {
  const groups = useMemo(() => sortedGroups(item), [item]);
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.options[0]!.id])),
  );
  const [quantity, setQuantity] = useState(1);
  // ข้อความในช่องจำนวนแยกจากค่าจริง — ให้ลบแล้วพิมพ์ใหม่ได้ โดยค่าที่ใช้คำนวณ/สั่งยังถูกต้องเสมอ
  const [quantityText, setQuantityText] = useState("1");
  const [note, setNote] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inStock = item.inStock ?? true;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unitPrice = useMemo(() => {
    const deltas = groups.reduce((sum, g) => {
      const opt = g.options.find((o) => o.id === selected[g.id]);
      return sum + (opt?.priceDelta ?? 0);
    }, 0);
    return Math.round((item.price + deltas) * 100) / 100;
  }, [groups, selected, item.price]);
  const total = Math.round(unitPrice * quantity * 100) / 100;

  function setQty(next: unknown) {
    const clean = clampQuantity(next);
    setQuantity(clean);
    setQuantityText(String(clean));
  }

  function onQuantityTyping(text: string) {
    // รับเฉพาะตัวเลข — เครื่องหมายลบ จุดทศนิยม และตัวอักษรพิมพ์ไม่ติดตั้งแต่แรก
    const digits = text.replace(/[^0-9]/g, "").slice(0, 2);
    setQuantityText(digits);
    if (digits !== "") setQuantity(clampQuantity(digits));
  }

  function add() {
    if (!inStock) return;
    const next = addLineToCart(loadCart(), {
      menuId: item.id,
      quantity,
      options: groups.map((g) => selected[g.id]!).filter(Boolean),
      note,
    });
    saveCart(next);
    onAdded?.({ name: item.name, quantity });
    onClose();
  }

  // portal ไปที่ body: บรรพบุรุษที่มี transform/perspective/preserve-3d (เช่นเลเยอร์ 3D ของหน้า)
  // ทำให้ position: fixed ยึดกล่องนั้นแทนหน้าจอ — ป๊อปอัปไปโผล่ท้ายหน้ายาว ๆ จนต้องเลื่อนหา
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink-900/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-order-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <MenuItemImage src={item.imageUrl} name={item.name} loading="eager" className="h-48 w-full sm:rounded-t-2xl" />
          <button
            type="button"
            className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/70 text-lg text-ink-50 backdrop-blur hover:bg-ink-900"
            aria-label="ปิดหน้าต่างสั่งซื้อ"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <h2
              id="menu-order-title"
              ref={headingRef}
              tabIndex={-1}
              className="pa-display text-2xl text-ink-900 outline-none"
            >
              {item.name}
            </h2>
            {item.description ? <p className="mt-1 text-sm text-ink-600">{item.description}</p> : null}
            <p className="luxe-price mt-1 text-base font-semibold text-ink-900">{fmtPrice(item.price)}</p>
            {inStock ? null : (
              <p role="status" className="mt-2 text-sm font-semibold text-brand-700">
                วัตถุดิบหมดชั่วคราว — ยังสั่งเมนูนี้ไม่ได้
              </p>
            )}
          </div>

          {groups.map((g) => (
            <fieldset key={g.id} disabled={!inStock}>
              <legend className="luxe-kicker mb-2">{g.name}</legend>
              <div className="grid gap-2">
                {g.options.map((o) => {
                  const checked = selected[g.id] === o.id;
                  return (
                    <label
                      key={o.id}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        checked ? "border-ink-900 bg-ink-50 font-semibold text-ink-900" : "border-ink-200 text-ink-700 hover:border-ink-400"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`option-${g.id}`}
                          value={o.id}
                          checked={checked}
                          onChange={() => setSelected((s) => ({ ...s, [g.id]: o.id }))}
                          className="h-5 w-5 accent-ink-900"
                        />
                        {o.name}
                      </span>
                      <span className="luxe-price text-ink-600">{fmtDelta(o.priceDelta)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div>
            <label htmlFor="menu-order-note" className="luxe-kicker mb-2 block">
              หมายเหตุถึงร้าน (ถ้ามี)
            </label>
            <textarea
              id="menu-order-note"
              rows={2}
              maxLength={CART_NOTE_MAX}
              value={note}
              disabled={!inStock}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ไม่ใส่ผัก เผ็ดน้อย"
              className="w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-base text-ink-900 placeholder:text-ink-400 focus:border-gold-600 disabled:bg-ink-100"
            />
          </div>

          <div>
            <p id="menu-order-qty-label" className="luxe-kicker mb-2">
              จำนวน
            </p>
            <div className="flex items-center gap-3" role="group" aria-labelledby="menu-order-qty-label">
              <button
                type="button"
                className={secondaryButtonClass}
                aria-label="ลดจำนวน"
                disabled={!inStock || quantity <= 1}
                onClick={() => setQty(quantity - 1)}
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label="จำนวนที่สั่ง"
                aria-describedby="menu-order-qty-hint"
                value={quantityText}
                disabled={!inStock}
                onChange={(e) => onQuantityTyping(e.target.value)}
                onBlur={() => setQty(quantityText === "" ? quantity : quantityText)}
                className="luxe-price h-11 w-16 rounded-lg border border-ink-200 text-center text-lg font-semibold text-ink-900"
              />
              <button
                type="button"
                className={secondaryButtonClass}
                aria-label="เพิ่มจำนวน"
                disabled={!inStock || quantity >= CART_QTY_MAX}
                onClick={() => setQty(quantity + 1)}
              >
                +
              </button>
            </div>
            <p id="menu-order-qty-hint" className="mt-1 text-xs text-ink-500">
              สั่งได้ 1–{CART_QTY_MAX} ชิ้นต่อครั้ง
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-ink-200 pt-4">
            <p className="text-sm text-ink-600" aria-live="polite">
              รวม <span className="luxe-price text-lg font-semibold text-ink-900">{fmtPrice(total)}</span>
            </p>
            <button type="button" className={primaryButtonClass} onClick={add} disabled={!inStock}>
              เพิ่ม {quantity} ชิ้นลงตะกร้า
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MenuOrderDialog;
