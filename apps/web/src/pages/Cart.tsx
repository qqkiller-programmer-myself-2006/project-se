import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ORDER_SERVICE_LABELS,
  api,
  type MenuGroup,
  type OrderDetail,
  type OrderServiceType,
  type PublicCustomer,
} from "../lib/api";
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
  type Cart,
} from "../lib/cart";
import { Alert, Badge, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "../components/ui";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * หน้าตะกร้าและยืนยันคำสั่งซื้อ (Ticket 05):
 * - ดูเมนูพร้อมขาย + เพิ่ม/ลด/ลบ/หมายเหตุในตะกร้า (เก็บใน localStorage)
 * - ยืนยันเป็นคำสั่งซื้อแบบสมาชิก (login แล้ว) หรือ Guest (ชื่อ+เบอร์)
 * - server ตรวจราคา/สถานะเมนูอีกครั้งแล้ว snapshot — ราคาภายหลังไม่กระทบคำสั่งซื้อเดิม
 */
export default function CartPage() {
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(() => loadCart());
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [serviceType, setServiceType] = useState<OrderServiceType>("dine_in");
  const [scheduledAt, setScheduledAt] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<OrderDetail | null>(null);

  async function loadMenu() {
    try {
      setMenuLoading(true);
      setMenuError(null);
      setGroups((await api.menuPublic()).groups);
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : "โหลดเมนูไม่สำเร็จ");
    } finally {
      setMenuLoading(false);
    }
  }

  useEffect(() => {
    void loadMenu();
    // session ลูกค้าแยกจาก staff — มีก็ผูกคำสั่งซื้อกับบัญชี ไม่มีก็สั่งแบบ Guest
    api
      .customerMe()
      .then((r) => setCustomer(r.customer))
      .catch(() => setCustomer(null))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const priceMap = useMemo(() => {
    const map = new Map<string, { price: number; name: string }>();
    for (const g of groups) for (const m of g.items) map.set(m.id, { price: m.price, name: m.name });
    return map;
  }, [groups]);

  const total = cartTotal(cart, (id) => priceMap.get(id)?.price ?? null);
  const count = cartCount(cart);
  const staleLines = cart.filter((l) => !priceMap.has(l.menuId));

  function add(menuId: string) {
    setSubmitError(null);
    setCart((c) => addToCart(c, menuId));
  }

  async function submit() {
    if (submitting) return;
    setSubmitError(null);
    if (cart.length === 0) {
      setSubmitError("ตะกร้ายังว่างอยู่ กรุณาเลือกเมนูอย่างน้อย 1 รายการ");
      return;
    }
    let scheduled: string | null = null;
    if (serviceType === "preorder") {
      if (!scheduledAt) {
        setSubmitError("กรุณาระบุเวลานัดรับสำหรับคำสั่งซื้อล่วงหน้า");
        return;
      }
      const d = new Date(scheduledAt);
      if (Number.isNaN(d.getTime())) {
        setSubmitError("รูปแบบเวลานัดไม่ถูกต้อง");
        return;
      }
      scheduled = d.toISOString();
    }
    const body = {
      serviceType,
      scheduledAt: scheduled,
      items: cart.map((l) => ({ menuId: l.menuId, quantity: l.quantity, note: l.note || null })),
      ...(customer
        ? {}
        : { guestName: guestName.trim(), guestPhone: guestPhone.trim() }),
      idempotencyKey: newIdempotencyKey(),
    };
    try {
      setSubmitting(true);
      const res = await api.orderCreate(body);
      setPlaced(res.order);
      const cleared = clearCart();
      setCart(cleared);
      saveCart(cleared);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "ยืนยันคำสั่งซื้อไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#cart-main" className="ui-skip-link">
        ข้ามไปยังตะกร้า
      </a>
      <header className="text-center">
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">ตะกร้าและสั่งซื้อ</h1>
        <p className="mt-1 text-sm text-ink-600">
          เลือกเมนูพร้อมขาย ปรับจำนวนและหมายเหตุ แล้วกดยืนยันเป็นคำสั่งซื้อ
          {sessionChecked && customer ? ` (สั่งในนาม ${customer.name})` : " (ไม่ต้องสมัครก็สั่งแบบ Guest ได้)"}
        </p>
      </header>

      <main id="cart-main" aria-label="ตะกร้าและสั่งซื้อ" className="space-y-4">
        {placed ? (
          <Panel label="ยืนยันคำสั่งซื้อสำเร็จ">
            <div className="space-y-3">
              <Alert tone="success" role="status">
                รับคำสั่งซื้อแล้ว เลขคำสั่งซื้อ {placed.orderNumber} ยอดรวม {fmtPrice(placed.total)}
              </Alert>
              <p className="text-sm text-ink-600">
                สถานะปัจจุบัน: รอชำระเงิน — จดเลขคำสั่งซื้อไว้ใช้ติดตามสถานะ
                {placed.guestPhone ? " (ใช้คู่กับเบอร์โทรที่สั่ง)" : " (ดูได้ที่หน้าคำสั่งซื้อของฉัน)"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to="/orders" className={primaryButtonClass}>
                  ไปติดตามคำสั่งซื้อ
                </Link>
                <button type="button" onClick={() => setPlaced(null)} className={secondaryButtonClass}>
                  สั่งเพิ่ม
                </button>
              </div>
            </div>
          </Panel>
        ) : null}

        <Panel label="ตะกร้าของฉัน">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-ink-900">
              ตะกร้าของฉัน {count > 0 ? <span className="font-medium text-ink-600">({count} ชิ้น)</span> : null}
            </h2>
            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
                <p className="font-semibold text-ink-800">ตะกร้ายังว่างอยู่</p>
                <p className="mt-1 text-sm text-ink-600">เลือกเมนูด้านล่างเพื่อเพิ่มลงตะกร้า</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {cart.map((l) => {
                  const info = priceMap.get(l.menuId);
                  return (
                    <li key={l.menuId} className="rounded-xl border border-ink-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-ink-900">{info?.name ?? "เมนูที่เลือก"}</p>
                          <p className="text-sm text-ink-600">
                            {info ? fmtPrice(info.price) : "กำลังตรวจราคา…"} · รวม{" "}
                            {info ? fmtPrice(info.price * l.quantity) : "–"}
                          </p>
                          {!info && !menuLoading ? (
                            <p className="mt-1 text-sm font-medium text-red-700">
                              เมนูนี้อาจไม่พร้อมขายแล้ว ระบบจะตรวจอีกครั้งตอนยืนยัน
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart((c) => removeFromCart(c, l.menuId))}
                          aria-label={`ลบ${info?.name ?? "รายการ"}ออกจากตะกร้า`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                        >
                          ลบ
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1" role="group" aria-label={`จำนวน${info?.name ?? ""}`}>
                          <button
                            type="button"
                            onClick={() => setCart((c) => setQuantity(c, l.menuId, l.quantity - 1))}
                            disabled={l.quantity <= 1}
                            aria-label="ลดจำนวน"
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-ink-300 bg-white text-lg font-bold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            −
                          </button>
                          <span aria-live="polite" className="min-w-[3rem] text-center font-bold">
                            {l.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCart((c) => setQuantity(c, l.menuId, l.quantity + 1))}
                            disabled={l.quantity >= 20}
                            aria-label="เพิ่มจำนวน"
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-ink-300 bg-white text-lg font-bold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            +
                          </button>
                        </div>
                        <div className="min-w-[12rem] flex-1">
                          <label htmlFor={`note-${l.menuId}`} className="sr-only">
                            หมายเหตุ{info ? ` ${info.name}` : ""} (ไม่เกิน 200 ตัวอักษร)
                          </label>
                          <input
                            id={`note-${l.menuId}`}
                            className={inputClass}
                            value={l.note}
                            maxLength={200}
                            onChange={(e) => setCart((c) => setNote(c, l.menuId, e.target.value))}
                            placeholder="หมายเหตุ เช่น ไม่ใส่ผัก (ไม่เกิน 200 ตัวอักษร)"
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {cart.length > 0 ? (
              <p className="text-right text-base font-bold text-ink-900" role="status">
                ยอดรวมโดยประมาณ {fmtPrice(total)}
              </p>
            ) : null}
            {staleLines.length > 0 && !menuLoading ? (
              <Alert tone="error" role="alert">
                มี {staleLines.length} รายการที่อาจไม่พร้อมขายแล้ว กรุณาตรวจสอบก่อนยืนยัน
              </Alert>
            ) : null}
          </div>
        </Panel>

        {cart.length > 0 ? (
          <Panel label="ยืนยันคำสั่งซื้อ">
            <div className="space-y-4">
              <fieldset>
                <legend className="mb-1 block text-sm font-semibold text-ink-800">วิธีรับบริการ</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(ORDER_SERVICE_LABELS) as OrderServiceType[]).map((v) => (
                    <label
                      key={v}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                        serviceType === v
                          ? "border-brand-600 bg-brand-50 text-brand-800"
                          : "border-ink-300 bg-white text-ink-800 hover:border-ink-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name="service-type"
                        value={v}
                        checked={serviceType === v}
                        onChange={() => setServiceType(v)}
                        className="h-5 w-5 accent-brand-600"
                      />
                      {ORDER_SERVICE_LABELS[v]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {serviceType === "preorder" ? (
                <div>
                  <label htmlFor="scheduled-at" className="mb-1 block text-sm font-semibold text-ink-800">
                    เวลานัดรับ (ล่วงหน้าอย่างน้อย 30 นาที ไม่เกิน 7 วัน)
                  </label>
                  <input
                    id="scheduled-at"
                    type="datetime-local"
                    className={inputClass}
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              ) : null}

              {sessionChecked && !customer ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="guest-name" className="mb-1 block text-sm font-semibold text-ink-800">
                      ชื่อผู้สั่ง (Guest)
                    </label>
                    <input
                      id="guest-name"
                      className={inputClass}
                      value={guestName}
                      maxLength={120}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="เช่น คุณมินตรา"
                      autoComplete="name"
                    />
                  </div>
                  <div>
                    <label htmlFor="guest-phone" className="mb-1 block text-sm font-semibold text-ink-800">
                      เบอร์โทร (Guest)
                    </label>
                    <input
                      id="guest-phone"
                      className={inputClass}
                      value={guestPhone}
                      inputMode="tel"
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="เช่น 0812345678"
                      autoComplete="tel"
                    />
                  </div>
                </div>
              ) : null}

              {submitError ? (
                <Alert tone="error" role="alert">
                  {submitError}
                </Alert>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !sessionChecked}
                aria-busy={submitting}
                className={primaryButtonClass}
              >
                {submitting ? "กำลังยืนยันคำสั่งซื้อ…" : `ยืนยันคำสั่งซื้อ · ${fmtPrice(total)}`}
              </button>
              <p className="text-xs text-ink-500">
                กดยืนยันแล้วระบบจะตรวจราคาและสถานะเมนูอีกครั้งก่อนสร้างคำสั่งซื้อ
                ราคาที่บันทึกจะไม่เปลี่ยนแม้ราคาเมนูภายหลังเปลี่ยน
              </p>
            </div>
          </Panel>
        ) : null}

        <Panel label="เลือกเมนู">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-ink-900">เลือกเมนูพร้อมขาย</h2>
            {menuLoading ? (
              <p className="py-6 text-center">
                <Spinner label="กำลังโหลดเมนู…" />
              </p>
            ) : menuError ? (
              <div className="space-y-3">
                <Alert tone="error" role="alert">
                  {menuError}
                </Alert>
                <button type="button" onClick={() => void loadMenu()} className={secondaryButtonClass}>
                  ลองใหม่
                </button>
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
                <p className="font-semibold text-ink-800">ยังไม่มีเมนูพร้อมขาย</p>
                <p className="mt-1 text-sm text-ink-600">โปรดกลับมาดูใหม่ภายหลัง</p>
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.category} aria-label={`หมวด ${g.category}`} className="space-y-2">
                  <h3 className="font-bold text-ink-900">{g.category}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {g.items.map((m) => {
                      const line = cart.find((l) => l.menuId === m.id);
                      return (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-ink-200 bg-white p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-900">{m.name}</p>
                            <p className="text-sm font-bold text-brand-700">{fmtPrice(m.price)}</p>
                          </div>
                          {line ? (
                            <Badge tone="brand">ในตะกร้า {line.quantity}</Badge>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => add(m.id)}
                            aria-label={`เพิ่ม${m.name}ลงตะกร้า`}
                            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                          >
                            เพิ่ม
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
            <p className="text-center text-sm text-ink-500">
              <Link to="/menu" className="font-semibold text-brand-700 underline underline-offset-2">
                ดูเมนูทั้งหมด
              </Link>
            </p>
          </div>
        </Panel>
      </main>
    </div>
  );
}
