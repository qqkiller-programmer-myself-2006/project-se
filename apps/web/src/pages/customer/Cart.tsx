import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ORDER_SERVICE_LABELS,
  api,
  type OrderDetail,
  type OrderServiceType,
  type PublicCustomer,
  type PublicMenuGroupWithOptions,
  type PublicTableStatus,
} from "../../lib/api";
import {
  addToCart,
  cartCount,
  cartTotalWith,
  clearCart,
  loadCart,
  removeFromCart,
  saveCart,
  setLineOption,
  setSpecialRequest,
  setNote,
  setQuantity,
  toggleLineOption,
  type Cart,
} from "../../lib/cart";
import { loadTableContext, saveTableContext } from "../../lib/tableContext";
import { Alert, Badge, Panel, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";
import { DepthHero, MotionReveal, Skeleton, StaggerItem, StaggerList } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { Icon } from "../../components/icons";
import { DEMO_MENU_GROUPS, isDemoModeEnabled, isOfflineError, shouldFallbackToDemo } from "../../lib/demo";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDelta(n: number): string {
  if (n === 0) return "ไม่เพิ่มราคา";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
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
 * หน้าตะกร้าและยืนยันคำสั่งซื้อ (Ticket 05 + Ticket 07):
 * - ดูเมนูพร้อมขาย + เพิ่ม/ลด/ลบ/หมายเหตุในตะกร้า (เก็บใน localStorage)
 * - Ticket 07: เลือกตัวเลือกต่อบรรทัด (กลุ่มละ 1 ตัวเลือก มีส่วนต่างราคา) +
 *   ความต้องการเฉพาะ (ข้อความล้วน ไม่เปลี่ยนราคา)
 * - ยืนยันเป็นคำสั่งซื้อแบบสมาชิก (login แล้ว) หรือ Guest (ชื่อ+เบอร์)
 * - server ตรวจราคา/สถานะเมนู/ตัวเลือก/สต๊อกอีกครั้งแล้ว snapshot + จองสต๊อก
 */
export default function CartPage() {
  const [groups, setGroups] = useState<PublicMenuGroupWithOptions[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
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
  // โต๊ะที่สแกน QR มา (จำไว้ตลอดแท็บ) + สถานะว่าโต๊ะนั้นเช็กอินแล้วหรือยัง
  const [tableCode, setTableCode] = useState<string | null>(() => loadTableContext());
  const [tableStatus, setTableStatus] = useState<PublicTableStatus | null>(null);
  const [tableStatusError, setTableStatusError] = useState<string | null>(null);

  async function loadMenu() {
    try {
      setMenuLoading(true);
      setMenuError(null);
      setDemo(false);
      const fetched = (await api.menuPublic()).groups;
      if (fetched.length === 0 && isDemoModeEnabled()) {
        setGroups(DEMO_MENU_GROUPS);
        setDemo(true);
      } else {
        setGroups(fetched);
      }
    } catch (err) {
      if (shouldFallbackToDemo(err)) {
        setGroups(DEMO_MENU_GROUPS);
        setDemo(true);
        setMenuError(null);
      } else {
        setMenuError(err instanceof Error ? err.message : "โหลดเมนูไม่สำเร็จ");
      }
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

  // โต๊ะจาก QR: ถามสถานะเพื่อบอกลูกค้าตั้งแต่ตอนนี้ว่าสั่งที่โต๊ะนี้ได้ไหม
  // ไม่ใช่ปล่อยให้เลือกเมนูจนครบแล้วค่อยโดนปฏิเสธตอนกดยืนยัน
  useEffect(() => {
    if (!tableCode) {
      setTableStatus(null);
      setTableStatusError(null);
      return;
    }
    let cancelled = false;
    api
      .tablePublicStatus(tableCode)
      .then((r) => {
        if (!cancelled) {
          setTableStatus(r);
          setTableStatusError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTableStatus(null);
        setTableStatusError(err instanceof Error ? err.message : "ตรวจสถานะโต๊ะไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [tableCode]);

  /** ลูกค้าบอกว่าไม่ได้นั่งโต๊ะนี้ — ลืมโต๊ะแล้วกลับไปเลือกวิธีรับบริการเอง */
  function forgetTable() {
    saveTableContext(null);
    setTableCode(null);
  }

  const priceMap = useMemo(() => {
    const map = new Map<string, { price: number; name: string; inStock: boolean }>();
    for (const g of groups)
      for (const m of g.items) map.set(m.id, { price: m.price, name: m.name, inStock: m.inStock ?? true });
    return map;
  }, [groups]);

  const optionMap = useMemo(() => {
    const map = new Map<string, { menuId: string; groupId: string; name: string; priceDelta: number }>();
    for (const g of groups)
      for (const m of g.items)
        for (const og of m.optionGroups ?? [])
          for (const o of og.options) map.set(o.id, { menuId: m.id, groupId: og.id, name: o.name, priceDelta: o.priceDelta });
    return map;
  }, [groups]);

  const groupsByMenu = useMemo(() => {
    const map = new Map<string, PublicMenuGroupWithOptions["items"][number]["optionGroups"]>();
    for (const g of groups) for (const m of g.items) map.set(m.id, m.optionGroups ?? []);
    return map;
  }, [groups]);

  function lineUnitPrice(line: Cart[number]): number | null {
    const base = priceMap.get(line.menuId);
    if (!base) return null;
    let price = base.price;
    for (const optionId of line.options) {
      const opt = optionMap.get(optionId);
      if (!opt || opt.menuId !== line.menuId) return null;
      price = Math.round((price + opt.priceDelta) * 100) / 100;
    }
    return price;
  }

  const total = cartTotalWith(cart, (l) => lineUnitPrice(l));
  const count = cartCount(cart);
  const staleLines = cart.filter((l) => lineUnitPrice(l) === null);

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
      items: cart.map((l) => ({
        menuId: l.menuId,
        quantity: l.quantity,
        note: l.note || null,
        options: l.options.length > 0 ? l.options : null,
        specialRequest: l.specialRequest || null,
      })),
      ...(customer
        ? {}
        : { guestName: guestName.trim(), guestPhone: guestPhone.trim() }),
      // แนบโต๊ะเฉพาะตอนกินที่ร้าน — server ผูกกับรอบที่เปิดอยู่ของโต๊ะนั้นให้เอง
      // (เปลี่ยนไปกลับบ้าน/ล่วงหน้าแล้วส่งโต๊ะไปด้วยจะโดนปฏิเสธ)
      ...(tableCode && serviceType === "dine_in" ? { tableId: tableCode } : {}),
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
      setSubmitError(
        isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต ยอดในตะกร้าถูกคำนวณจากข้อมูลตัวอย่าง — กรุณาเชื่อมต่อเน็ตแล้วลองยืนยันอีกครั้ง"
          : err instanceof Error ? err.message : "ยืนยันคำสั่งซื้อไม่สำเร็จ",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#cart-main" className="ui-skip-link">
        ข้ามไปยังตะกร้า
      </a>
      <DepthHero>
        <h1 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">ตะกร้าและสั่งซื้อ</h1>
        <p className="mt-1 text-sm text-ink-600">
          เลือกเมนูพร้อมขาย ปรับจำนวน ตัวเลือก และหมายเหตุ แล้วกดยืนยันเป็นคำสั่งซื้อ
          {sessionChecked && customer ? ` (สั่งในนาม ${customer.name})` : " (ไม่ต้องสมัครก็สั่งแบบ Guest ได้)"}
        </p>
        {demo ? (
          <div className="mt-3 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </DepthHero>

      {demo ? <ConnectionBanner onRetry={() => void loadMenu()} /> : null}

      <main id="cart-main" aria-label="ตะกร้าและสั่งซื้อ" className="space-y-4">
        {placed ? (
          <MotionReveal>
            <Panel label="ยืนยันคำสั่งซื้อสำเร็จ">
            <div className="space-y-3">
              <Alert tone="success" role="status">
                รับคำสั่งซื้อแล้ว เลขคำสั่งซื้อ {placed.orderNumber} ยอดรวม {fmtPrice(placed.total)}
              </Alert>
              <p className="text-sm text-ink-600">
                สถานะปัจจุบัน: รอชำระเงิน — จดเลขคำสั่งซื้อไว้ใช้ติดตามสถานะ
                {placed.guestPhone ? " (ใช้คู่กับเบอร์โทรที่สั่ง)" : " (ดูได้ที่หน้าคำสั่งซื้อของฉัน)"}
              </p>
              {placed.tableId ? (
                <p className="text-sm text-ink-600">
                  ผูกกับโต๊ะ {tableStatus?.table.name ?? placed.tableId} แล้ว — ครัวจะรู้ว่าจานนี้ของโต๊ะไหน
                </p>
              ) : null}
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
          </MotionReveal>
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
              <StaggerList className="space-y-3">
                {cart.map((l, index) => {
                  const info = priceMap.get(l.menuId);
                  const unit = lineUnitPrice(l);
                  const menuGroups = groupsByMenu.get(l.menuId) ?? [];
                  const optionNames = l.options.map((id) => optionMap.get(id)?.name ?? "ตัวเลือกที่ไม่พบ");
                  return (
                    <StaggerItem key={`${l.menuId}-${index}`} index={index} className="rounded-xl border border-ink-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-ink-900">{info?.name ?? "เมนูที่เลือก"}</p>
                          <p className="text-sm text-ink-600">
                            {unit !== null ? fmtPrice(unit) : "กำลังตรวจราคา…"}
                            {l.options.length > 0 ? ` · ตัวเลือก: ${optionNames.join(" · ")}` : null} · รวม{" "}
                            {unit !== null ? fmtPrice(unit * l.quantity) : "–"}
                          </p>
                          {unit === null && !menuLoading ? (
                            <p className="mt-1 text-sm font-medium text-red-700">
                              เมนูหรือตัวเลือกนี้อาจไม่พร้อมขายแล้ว ระบบจะตรวจอีกครั้งตอนยืนยัน
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart((c) => removeFromCart(c, l.menuId, l.options))}
                          aria-label={`ลบ${info?.name ?? "รายการ"}ออกจากตะกร้า`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                        >
                          ลบ
                        </button>
                      </div>
                      {menuGroups.length > 0 ? (
                        <fieldset className="mt-2 space-y-2 rounded-xl bg-ink-50 p-2.5">
                          <legend className="px-1 text-sm font-semibold text-ink-800">ตัวเลือก (กลุ่มละ 1 ตัวเลือก)</legend>
                          {menuGroups.map((og) => (
                            <div key={og.id}>
                              <p className="text-xs font-semibold text-ink-600">{og.name}</p>
                              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={og.name}>
                                {og.options.map((o) => {
                                  const checked = l.options.includes(o.id);
                                  return (
                                    <label
                                      key={o.id}
                                      className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium ${
                                        checked
                                          ? "border-brand-600 bg-brand-50 text-brand-800"
                                          : "border-ink-300 bg-white text-ink-700 hover:border-ink-400"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="h-5 w-5 accent-brand-600"
                                        checked={checked}
                                        onChange={(e) =>
                                          setCart((c) =>
                                            e.target.checked
                                              ? // เลือกตัวใหม่ในกลุ่มเดียวกันให้แทนที่ตัวเดิม (กลุ่มละ 1 ตัวเลือก)
                                                setLineOption(c, index, o.id, og.options.map((x) => x.id))
                                              : toggleLineOption(c, index, o.id),
                                          )
                                        }
                                        aria-label={`${o.name} ${fmtDelta(o.priceDelta)}`}
                                      />
                                      {o.name} ({fmtDelta(o.priceDelta)})
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </fieldset>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1" role="group" aria-label={`จำนวน${info?.name ?? ""}`}>
                          <button
                            type="button"
                            onClick={() => setCart((c) => setQuantity(c, l.menuId, l.quantity - 1, l.options))}
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
                            onClick={() => setCart((c) => setQuantity(c, l.menuId, l.quantity + 1, l.options))}
                            disabled={l.quantity >= 20}
                            aria-label="เพิ่มจำนวน"
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-ink-300 bg-white text-lg font-bold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            +
                          </button>
                        </div>
                        <div className="min-w-[12rem] flex-1 space-y-2">
                          <div>
                            <label htmlFor={`note-${l.menuId}-${index}`} className="sr-only">
                              หมายเหตุ{info ? ` ${info.name}` : ""} (ไม่เกิน 200 ตัวอักษร)
                            </label>
                            <input
                              id={`note-${l.menuId}-${index}`}
                              className={inputClass}
                              value={l.note}
                              maxLength={200}
                              onChange={(e) => setCart((c) => setNote(c, l.menuId, e.target.value, l.options))}
                              placeholder="หมายเหตุ เช่น ไม่ใส่ผัก (ไม่เกิน 200 ตัวอักษร)"
                            />
                          </div>
                          <div>
                            <label htmlFor={`special-${l.menuId}-${index}`} className="sr-only">
                              ความต้องการเฉพาะ{info ? ` ${info.name}` : ""} (ไม่เกิน 200 ตัวอักษร ไม่เปลี่ยนราคา)
                            </label>
                            <input
                              id={`special-${l.menuId}-${index}`}
                              className={inputClass}
                              value={l.specialRequest}
                              maxLength={200}
                              onChange={(e) => setCart((c) => setSpecialRequest(c, l.menuId, e.target.value, l.options))}
                              placeholder="ความต้องการเฉพาะ เช่น เผ็ดน้อย (ไม่เปลี่ยนราคา)"
                            />
                          </div>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerList>
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
              {tableCode ? (
                <div className="rounded-lg border border-gold-600/40 bg-gold-100 px-4 py-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gold-700">
                    <Icon name="table" size={18} />
                    กำลังสั่งที่โต๊ะ {tableStatus?.table.name ?? tableCode}
                  </p>
                  <p role="status" className="mt-1 text-sm text-ink-700">
                    {tableStatusError
                      ? `ตรวจสถานะโต๊ะไม่ได้ (${tableStatusError}) — ยืนยันได้ แต่ถ้าโต๊ะยังไม่เช็กอินระบบจะปฏิเสธ`
                      : tableStatus === null
                        ? "กำลังตรวจสถานะโต๊ะ…"
                        : tableStatus.ready
                          ? "โต๊ะนี้เช็กอินแล้ว คำสั่งซื้อจะผูกกับโต๊ะให้อัตโนมัติ"
                          : "โต๊ะนี้ยังไม่ได้เช็กอิน กรุณาแจ้งพนักงานหน้าร้านก่อนยืนยัน"}
                  </p>
                  {serviceType !== "dine_in" ? (
                    <p className="mt-1 text-sm text-ink-700">
                      เลือกวิธีรับบริการอื่นอยู่ — คำสั่งซื้อนี้จะไม่ผูกกับโต๊ะ
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={forgetTable}
                    className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-ink-700 underline underline-offset-2 hover:text-brand-700"
                  >
                    ไม่ได้นั่งโต๊ะนี้
                  </button>
                </div>
              ) : null}

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
                กดยืนยันแล้วระบบจะตรวจราคา ตัวเลือก และสต๊อกอีกครั้งก่อนสร้างคำสั่งซื้อ
                ราคาที่บันทึกจะไม่เปลี่ยนแม้ราคาเมนูภายหลังเปลี่ยน
              </p>
            </div>
          </Panel>
        ) : null}

        <Panel label="เลือกเมนู">
          <div className="space-y-3">
            <h2 className="inline-flex items-center gap-2 text-base font-bold text-ink-900">
              <Icon name="menu" size={18} />
              เลือกเมนูพร้อมขาย
            </h2>
            {menuLoading ? (
              <Skeleton label="กำลังโหลดเมนู…" lines={4} />
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
                  <StaggerList className="grid gap-2 sm:grid-cols-2">
                    {g.items.map((m, itemIndex) => {
                      const inStock = m.inStock ?? true;
                      const countInCart = cart.filter((l) => l.menuId === m.id).reduce((n, l) => n + l.quantity, 0);
                      return (
                        <StaggerItem
                          key={m.id}
                          index={itemIndex}
                          className="pa-lift flex items-center justify-between gap-2 rounded-xl border border-ink-200 bg-white p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-900">{m.name}</p>
                            <p className="text-sm font-bold text-brand-700">{fmtPrice(m.price)}</p>
                            {(m.optionGroups ?? []).length > 0 ? (
                              <p className="truncate text-xs text-ink-500">
                                มี {(m.optionGroups ?? []).length} กลุ่มตัวเลือก
                              </p>
                            ) : null}
                            {inStock ? null : (
                              <p className="text-xs font-semibold text-red-700">วัตถุดิบหมดชั่วคราว</p>
                            )}
                          </div>
                          {countInCart > 0 ? <Badge tone="brand">ในตะกร้า {countInCart}</Badge> : null}
                          <button
                            type="button"
                            onClick={() => add(m.id)}
                            disabled={!inStock}
                            aria-label={`เพิ่ม${m.name}ลงตะกร้า`}
                            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            เพิ่ม
                          </button>
                        </StaggerItem>
                      );
                    })}
                  </StaggerList>
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
