import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MENU_KIND_LABELS,
  api,
  type PublicMenuItemWithOptions,
  type ShopStatus,
} from "../../lib/api";
import { cartCount, loadCart } from "../../lib/cart";
import { DEMO_MENU_GROUPS_WITH_FOOD, isOfflineError } from "../../lib/demo";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { resolveTableContext } from "../../lib/tableContext";
import { Alert, primaryButtonClass, secondaryButtonClass } from "../../components/ui";
import { MotionReveal, Skeleton, StaggerItem, StaggerList } from "../../components/motion";
import { Icon } from "../../components/icons";
import { MenuItemImage } from "../../components/MenuItemImage";
import { MenuOrderDialog } from "../../components/MenuOrderDialog";
import type { ShowcaseItem } from "../../components/MenuShowcase3D";
import "../../components/MenuShowcase3D.css";

// three.js หนัก — โหลดตู้โชว์เฉพาะเมื่อหน้านี้แสดงผลจริง
const MenuShowcase3D = lazy(() =>
  import("../../components/MenuShowcase3D").then((m) => ({ default: m.MenuShowcase3D })),
);

/** จำนวนบานในตู้โชว์ — มากกว่านี้บานจะเล็กเกินอ่านบนมือถือ */
const SHOWCASE_SIZE = 7;

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/**
 * Dev-only demo fallback (กฎเดียวกับหน้าเมนูสาธารณะ)
 * ผูกกับ `import.meta.env.DEV` ตรง ๆ — ไม่ใช่ VITE_DEMO_MODE —
 * build production จึงไม่มีทางตกไปใช้ข้อมูลตัวอย่างเองได้
 */
function isDevMenuFallbackEnabled(): boolean {
  try {
    // ต้องเขียน import.meta.env ตรง ๆ — `import.meta?.env` Vite ไม่แทนค่า เบราว์เซอร์จะอ่านได้ undefined เสมอ
    const env = import.meta.env as unknown as Record<string, unknown> | undefined;
    return env?.["DEV"] === true;
  } catch {
    return false;
  }
}

/**
 * error ที่เข้าข่าย fallback: เฉพาะเครือข่ายล้มเหลว (API ติดต่อไม่ได้)
 * HTTP error รวมถึง 500 ไม่เข้าข่าย — กฎเดียวกับหน้าเมนูสาธารณะ
 */
function isMenuFallbackError(err: unknown): boolean {
  return isOfflineError(err);
}

function openingText(status: ShopStatus | null, loading: boolean): string {
  if (!status) return loading ? "กำลังตรวจสอบเวลาเปิด…" : "ยังตรวจสอบเวลาเปิดไม่ได้ ดูได้ที่หน้าสถานะร้าน";
  if (!status.isOpen) {
    return status.reason ? `ปิดชั่วคราว · ${status.reason}` : "ปิดอยู่ในขณะนี้";
  }
  const intervals = status.today.intervals ?? [];
  if (intervals.length === 0) return "เปิดอยู่";
  return `เปิดอยู่ · วันนี้ ${intervals.map((i) => `${i.open}–${i.close}`).join(", ")}`;
}

/**
 * หน้าแรกของลูกค้า (landing)
 *
 * เป็นหน้าที่ QR ที่โต๊ะพามาถึง: เห็นร้าน เห็นเมนู และสั่งได้จากที่นี่เลย
 * โดยไม่ต้องเข้าสู่ระบบ ตู้โชว์ 3D เป็นของประดับ — ชื่อ ราคา และปุ่มสั่ง
 * ทั้งหมดอยู่ใน DOM ข้างล่าง คีย์บอร์ดและสกรีนรีดเดอร์ใช้ได้ครบ
 */
export default function LandingPage() {
  const { search } = useLocation();
  const [items, setItems] = useState<PublicMenuItemWithOptions[]>([]);
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(() => cartCount(loadCart()));
  const [added, setAdded] = useState<string | null>(null);
  // เมนูที่เปิดป๊อปอัปสั่งซื้ออยู่ — เลือกขนาด/ไข่/หมายเหตุ/จำนวนก่อนลงตะกร้า
  const [ordering, setOrdering] = useState<PublicMenuItemWithOptions | null>(null);
  const [demo, setDemo] = useState(false);
  const tableCode = useMemo(() => resolveTableContext(search), [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDemo(false);
    try {
      const [menu, shop] = await Promise.all([
        api.menuPublic(),
        api.shopStatus().catch(() => null),
      ]);
      setItems(menu.groups.flatMap((g) => g.items));
      setStatus(shop);
    } catch (err) {
      // DEV เท่านั้น: API ใช้ไม่ได้ให้โชว์เมนูตัวอย่างพร้อมป้ายโหมดสาธิต
      // production เก็บ error จริงไว้ ให้ทางร้านเห็นความจริง
      if (isDevMenuFallbackEnabled() && isMenuFallbackError(err)) {
        setItems(DEMO_MENU_GROUPS_WITH_FOOD.flatMap((g) => g.items));
        setStatus(null);
        setDemo(true);
      } else {
        // ข้อความดิบของเบราว์เซอร์ ("Failed to fetch") เป็นภาษาอังกฤษ ลูกค้าไม่เข้าใจ
        setError(isOfflineError(err) ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" : err instanceof Error ? err.message : "โหลดหน้าแรกไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * บานในตู้โชว์: เฉพาะเมนูพร้อมขาย (ของที่วัตถุดิบหมดกดสั่งไม่ได้ ไม่ควรเป็นพระเอก)
   * เรียงเมนูที่มีรูปขึ้นก่อน แล้วเติมเมนูที่ยังไม่มีรูปให้ตู้ครบบาน
   * (บานไม่มีรูปวาดเป็นแผ่นอักษร "ปอ" — ยังอ่านชื่อและราคาได้)
   */
  const showcase = useMemo(() => {
    const sellable = items.filter((m) => m.inStock ?? true);
    return [...sellable.filter((m) => m.imageUrl), ...sellable.filter((m) => !m.imageUrl)].slice(
      0,
      SHOWCASE_SIZE,
    );
  }, [items]);
  const showcaseItems: ShowcaseItem[] = useMemo(
    () => showcase.map((m) => ({ id: m.id, name: m.name, price: m.price, imageUrl: m.imageUrl })),
    [showcase],
  );

  // active เป็น index ของ showcase — รายการสั้นลงต้องไม่ค้างเกินขอบ
  const safeActive = showcase.length === 0 ? 0 : Math.min(active, showcase.length - 1);
  const current = showcase[safeActive];

  function rotate(delta: number) {
    if (showcase.length === 0) return;
    setActive((safeActive + delta + showcase.length) % showcase.length);
  }

  function onAdded({ name, quantity }: { name: string; quantity: number }) {
    setCount(cartCount(loadCart()));
    setAdded(`เพิ่ม ${name} ${quantity} ชิ้นลงตะกร้าแล้ว`);
  }

  return (
    <div className="space-y-12 sm:space-y-16">
      {/* ---------- ปกหน้า ---------- */}
      <section className="pa-hero px-6 py-12 text-center sm:px-12 sm:py-16">
        <p className="luxe-kicker luxe-line-in text-gold-200">ร้านป้าอ้ออาหารตามสั่ง · ข้าง มรภ.เลย</p>
        <h1 className="luxe-display luxe-line-in mt-4 text-ink-50" style={{ ["--motion-delay" as string]: "90ms" }}>
          ผัดร้อนทีละกระทะ
          <br />
          เสิร์ฟตรงจากเตา
        </h1>
        <p
          className="luxe-line-in mx-auto mt-5 max-w-xl text-base text-ink-200"
          style={{ ["--motion-delay" as string]: "180ms" }}
        >
          อาหารตามสั่งและเครื่องดื่มราคานักศึกษา สั่งจากหน้านี้ได้เลยโดยไม่ต้องสมัครสมาชิก
          หรือจองโต๊ะไว้ก่อนมาถึง
        </p>
        <div
          className="luxe-line-in mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{ ["--motion-delay" as string]: "270ms" }}
        >
          <Link to="/menu" className={primaryButtonClass}>
            <Icon name="menu" size={18} />
            ดูเมนูทั้งหมด
          </Link>
          <Link
            to="/reservations"
            className="pa-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold tracking-wide text-ink-50 transition-colors hover:border-gold-500 hover:text-gold-200"
          >
            <Icon name="reserve" size={18} />
            จองโต๊ะ
          </Link>
        </div>
        <p className="luxe-line-in mt-8 text-sm text-ink-300" style={{ ["--motion-delay" as string]: "360ms" }}>
          {demo ? "ข้อมูลตัวอย่าง (API ใช้ไม่ได้)" : openingText(status, loading)}
        </p>
        {demo ? (
          <div className="mt-4 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </section>

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      {/* ---------- สแกน QR มาจากโต๊ะ ---------- */}
      {tableCode ? (
        <MotionReveal variant="fade">
          <p
            role="status"
            className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-gold-600/40 bg-gold-100 px-4 py-3 text-sm font-semibold text-gold-700"
          >
            <Icon name="info" size={18} />
            กำลังสั่งที่โต๊ะ {tableCode} · เลือกเมนูแล้วยืนยันที่ตะกร้า
          </p>
        </MotionReveal>
      ) : null}

      {/* ---------- ตู้โชว์เมนู 3D ---------- */}
      <section aria-labelledby="showcase-title" className="space-y-6">
        <MotionReveal>
          <div className="text-center">
            <p className="luxe-kicker">เมนูแนะนำ</p>
            <h2 id="showcase-title" className="pa-display mt-2 text-2xl text-ink-900 sm:text-3xl">
              หมุนดูทีละจาน
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">
              ลากตู้เพื่อหมุน หรือกดปุ่มก่อนหน้า/ถัดไป แล้วเพิ่มลงตะกร้าได้จากที่นี่
            </p>
          </div>
        </MotionReveal>

        {loading ? (
          <div className="luxe-card p-5">
            <Skeleton label="กำลังโหลดเมนูแนะนำ…" lines={5} />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
              <Icon name="refresh" size={18} />
              ลองใหม่
            </button>
          </div>
        ) : showcase.length === 0 ? (
          <div className="luxe-card px-6 py-12 text-center">
            <p className="pa-display text-lg text-ink-900">วันนี้ยังไม่เปิดขายเมนู</p>
            <p className="mt-2 text-sm text-ink-600">
              ทางร้านยังไม่ได้เปิดรายการขายของวันนี้ ลองกลับมาดูอีกครั้งภายหลัง
            </p>
            <Link to="/status" className={`${secondaryButtonClass} mt-5`}>
              <Icon name="info" size={18} />
              ดูสถานะร้าน
            </Link>
          </div>
        ) : (
          <div className="menu-showcase">
            <Suspense fallback={<div className="menu-showcase__stage" aria-hidden="true" />}>
              <MenuShowcase3D items={showcaseItems} activeIndex={safeActive} onActiveIndexChange={setActive} />
            </Suspense>

            {/* ข้อมูลและปุ่มจริงของบานที่อยู่ด้านหน้า (canvas ข้างบนเป็นของประดับ) */}
            <div className="relative z-10 space-y-4 px-5 pb-6 text-center sm:px-8">
              <p aria-live="polite" className="sr-only">
                {current ? `บานหน้า: ${current.name} ราคา ${fmtPrice(current.price)}` : ""}
              </p>
              <div className="luxe-glass mx-auto max-w-md px-5 py-4">
                <p className="pa-display text-xl text-ink-50">{current?.name}</p>
                <p className="luxe-price mt-1 text-base font-semibold text-gold-200">
                  {current ? fmtPrice(current.price) : ""}
                </p>
                {current?.description ? (
                  <p className="mt-2 text-sm text-ink-200">{current.description}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => current && setOrdering(current)}
                    className={primaryButtonClass}
                  >
                    <Icon name="cart" size={18} />
                    เพิ่มลงตะกร้า
                  </button>
                  <Link
                    to="/menu"
                    className="pa-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold tracking-wide text-ink-50 transition-colors hover:border-gold-500 hover:text-gold-200"
                  >
                    ดูรายละเอียด
                  </Link>
                </div>
              </div>

              <div className="menu-showcase__nav flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => rotate(-1)}
                  aria-label="หมุนไปเมนูก่อนหน้า"
                  className="menu-showcase__arrow text-ink-50"
                >
                  <Icon name="chevronLeft" size={20} />
                </button>
                {showcase.map((m, index) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActive(index)}
                    aria-current={index === safeActive}
                    aria-label={`ไปที่เมนู ${m.name}`}
                    className="menu-showcase__dot"
                  />
                ))}
                <button
                  type="button"
                  onClick={() => rotate(1)}
                  aria-label="หมุนไปเมนูถัดไป"
                  className="menu-showcase__arrow text-ink-50"
                >
                  <Icon name="chevronRight" size={20} />
                </button>
              </div>
            </div>
          </div>
        )}

        {added ? (
          <MotionReveal variant="fade">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Alert tone="success" role="status">
                {added}
              </Alert>
              <Link to="/cart" className={secondaryButtonClass}>
                <Icon name="cart" size={18} />
                ไปที่ตะกร้า ({count})
              </Link>
            </div>
          </MotionReveal>
        ) : null}
      </section>

      {/* ---------- รายการเมนูย่อ ---------- */}
      {!loading && !error && items.length > 0 ? (
        <section aria-labelledby="popular-title" className="space-y-5">
          <MotionReveal>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="luxe-kicker">จากครัว</p>
                <h2 id="popular-title" className="pa-section-title mt-2 text-2xl text-ink-900">
                  เมนูที่สั่งได้วันนี้
                </h2>
              </div>
              <Link to="/menu" className={secondaryButtonClass}>
                ดูทั้งหมด {items.length} เมนู
              </Link>
            </div>
          </MotionReveal>
          <StaggerList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" label="เมนูที่สั่งได้วันนี้">
            {items.slice(0, 6).map((m, index) => (
              <StaggerItem key={m.id} index={index} className="luxe-card luxe-sheen overflow-hidden">
                <MenuItemImage src={m.imageUrl} name={m.name} className="h-40 w-full" />
                <div className="luxe-layer space-y-2 p-5">
                  <p className="luxe-kicker">{MENU_KIND_LABELS[m.kind]}</p>
                  <p className="pa-display text-lg text-ink-900">{m.name}</p>
                  {m.description ? <p className="text-sm text-ink-600">{m.description}</p> : null}
                  <hr className="luxe-rule my-3" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="luxe-price text-base font-semibold text-ink-900">{fmtPrice(m.price)}</p>
                    {(m.inStock ?? true) ? (
                      <button type="button" onClick={() => setOrdering(m)} aria-label={`สั่ง ${m.name}`} className={secondaryButtonClass}>
                        <Icon name="cart" size={18} />
                        เพิ่ม
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-ink-500">วัตถุดิบหมดชั่วคราว</span>
                    )}
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        </section>
      ) : null}

      {/* ---------- สามเหตุผล ---------- */}
      <section aria-label="จุดเด่นของร้าน" className="pa-hero px-6 py-10 sm:px-10">
        <p className="luxe-kicker text-center text-gold-200">ทำไมต้องร้านป้าอ้อ</p>
        <div className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/10">
          {[
            { title: "ผัดสดทีละจาน", body: "ไม่ตักจากหม้อรวม สั่งแล้วลงกระทะ ได้กลิ่นกระทะจริง" },
            { title: "ราคานักศึกษา", body: "ตั้งราคาสำหรับคนแถว มรภ.เลย รับทำข้าวกล่องงานมหาวิทยาลัย" },
            { title: "จองโต๊ะล่วงหน้า", body: "เลือกโต๊ะและเวลาได้เอง ถึงร้านแล้วเช็กอินที่หน้าร้าน" },
          ].map((f, index) => (
            <div key={f.title} className="px-2 text-center sm:px-8">
              <p aria-hidden="true" className="pa-display text-sm tracking-[0.2em] text-gold-500">
                0{index + 1}
              </p>
              <p className="pa-display mt-2 text-lg text-ink-50">{f.title}</p>
              <hr aria-hidden="true" className="luxe-rule mx-auto my-3 w-12" />
              <p className="text-sm text-ink-200">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- ปิดท้าย ---------- */}
      <section className="pa-hero px-6 py-12 text-center sm:px-12">
        <p className="luxe-kicker text-gold-200">พร้อมสั่งแล้ว</p>
        <h2 className="pa-display mt-3 text-2xl text-ink-50 sm:text-3xl">เลือกเมนู แล้วรับที่ร้านได้เลย</h2>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link to="/cart" className={primaryButtonClass}>
            <Icon name="cart" size={18} />
            ตะกร้าของฉัน ({count})
          </Link>
          <Link
            to="/track"
            className="pa-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold tracking-wide text-ink-50 transition-colors hover:border-gold-500 hover:text-gold-200"
          >
            <Icon name="track" size={18} />
            ติดตามคิว
          </Link>
        </div>
      </section>
      {ordering ? (
        <MenuOrderDialog item={ordering} onClose={() => setOrdering(null)} onAdded={onAdded} />
      ) : null}
    </div>
  );
}
