import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MENU_KIND_LABELS, api, type MenuKind, type PublicMenuGroupWithOptions } from "../../lib/api";
import { DEMO_MENU_GROUPS_WITH_FOOD, isDevEnv, isOfflineError, loadErrorMessage } from "../../lib/demo";
import { Alert, Badge, Panel } from "../../components/ui";
import { DepthHero, MotionReveal, Skeleton, StaggerItem, StaggerList, TiltCard } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { Icon } from "../../components/icons";
import { MenuItemImage } from "../../components/MenuItemImage";
import { MenuOrderDialog } from "../../components/MenuOrderDialog";
import { RealMenuPhotoGallery } from "../../components/RealMenuPhotoGallery";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDelta(n: number): string {
  if (n === 0) return "ไม่เพิ่มราคา";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/**
 * Dev-only demo fallback for the public menu page.
 * Explicitly based on `import.meta.env.DEV` — never on VITE_DEMO_MODE —
 * so production builds can never automatically fall back to fixtures.
 */
function isDevMenuFallbackEnabled(): boolean {
  return isDevEnv();
}

/**
 * error ที่เข้าข่าย fallback: เฉพาะเครือข่ายล้มเหลว (API ติดต่อไม่ได้)
 *
 * HTTP error รวมถึง 500 ไม่เข้าข่าย — เซิร์ฟเวอร์พังคือเรื่องที่ทางร้านต้องเห็น
 * ถ้ากลืนเป็นข้อมูลตัวอย่างให้ หน้าเว็บจะดู "ปกติ" ทั้งที่ระบบหลังบ้านล่ม
 * และคนแก้จะไม่รู้เลยว่าพังตั้งแต่เมื่อไร
 */
function isMenuFallbackError(err: unknown): boolean {
  return isOfflineError(err);
}

/** หน้าเมนูสาธารณะ: ดูได้โดยไม่ต้องเข้าสู่ระบบ — เฉพาะเมนูพร้อมขาย จัดกลุ่มตามหมวด */
export default function MenuPublicPage() {
  const [groups, setGroups] = useState<PublicMenuGroupWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  // ร้านนี้คือร้านอาหารตามสั่ง — เปิดหน้ามาต้องเห็นทั้งอาหารและเครื่องดื่ม
  // (เคยตั้งเป็น "drink" ไว้ตอน seed เมนูเครื่องดื่ม แล้วลืมคืนค่า เมนูอาหารเลยหายไปทั้งหน้า)
  const [kind, setKind] = useState<"" | MenuKind>("");
  const [q, setQ] = useState("");
  // เมนูที่กดการ์ดแล้วเปิดป๊อปอัปสั่งซื้ออยู่ (null = ปิด)
  const [ordering, setOrdering] = useState<PublicMenuGroupWithOptions["items"][number] | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setDemo(false);
      const fetched = (await api.menuPublic()).groups;
      // DEV-only fallback: empty API shows local fixtures (with DemoBadge).
      // Production keeps the real empty state so operators see the truth.
      if (fetched.length === 0 && isDevMenuFallbackEnabled()) {
        setGroups(DEMO_MENU_GROUPS_WITH_FOOD);
        setDemo(true);
      } else {
        setGroups(fetched);
      }
    } catch (err) {
      // DEV-only fallback: network failures and HTTP 500 show demo fixtures.
      // Other HTTP errors keep real error behavior; production never falls back.
      // Mutations still call the real API — demo never bypasses auth/security.
      if (isDevMenuFallbackEnabled() && isMenuFallbackError(err)) {
        setGroups(DEMO_MENU_GROUPS_WITH_FOOD);
        setDemo(true);
        setError(null);
      } else {
        // ข้อความดิบของเบราว์เซอร์ ("Failed to fetch") เป็นภาษาอังกฤษ ลูกค้าไม่เข้าใจ
        setError(loadErrorMessage(err, "โหลดเมนูไม่สำเร็จ"));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter(
          (m) =>
            (kind === "" || m.kind === kind) &&
            (!needle ||
              m.name.toLowerCase().includes(needle) ||
              (m.description ?? "").toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, kind, q]);

  const total = useMemo(() => filtered.reduce((n, g) => n + g.items.length, 0), [filtered]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#menu-main" className="ui-skip-link">
        ข้ามไปยังรายการเมนู
      </a>
      <DepthHero>
        <img
          src="/venue/site/pa-or-menu-hero.jpg"
          alt="ป้ายเมนูเครื่องดื่มหนูนุ้ย ชาใต้ ที่ร้านป้าอ้อ"
          title="เมนูเครื่องดื่มหนูนุ้ย ชาใต้ ที่ร้านป้าอ้อ"
          className="h-auto w-full rounded-2xl object-cover"
          loading="eager"
          decoding="async"
        />
        <h1 className="font-display mt-2 text-xl font-bold text-ink-900 sm:text-2xl">เมนูร้านป้าอ้ออาหารตามสั่ง</h1>
        <p className="mt-1 text-sm text-ink-600">
          ดูเมนูอาหารและเครื่องดื่มพร้อมขายแยกตามหมวดหมู่ได้โดยไม่ต้องเข้าสู่ระบบ
        </p>
        {demo ? (
          <div className="mt-3 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </DepthHero>

      <RealMenuPhotoGallery />

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      <main id="menu-main" aria-label="รายการเมนูพร้อมขาย" className="space-y-4">
        <MotionReveal>
          <Panel label="ค้นหาและกรองเมนู" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="menu-search" className="mb-1 block text-sm font-semibold text-ink-800">
                ค้นหาชื่อหรือรายละเอียด
              </label>
              <input
                id="menu-search"
                className="w-full min-h-[44px] rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-400 shadow-sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="เช่น ข้าวผัดหมู ชาใต้"
              />
            </div>
            <div>
              <label htmlFor="menu-kind" className="mb-1 block text-sm font-semibold text-ink-800">
                ประเภท
              </label>
              <select
                id="menu-kind"
                className="w-full min-h-[44px] rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-base text-ink-900 shadow-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as "" | MenuKind)}
              >
                <option value="">ทั้งหมด</option>
                <option value="food">{MENU_KIND_LABELS.food}</option>
                <option value="drink">เครื่องดื่มทั้งหมด</option>
              </select>
            </div>
            </div>
          </Panel>
        </MotionReveal>

        {loading ? (
          <Panel label="กำลังโหลดเมนู">
            <Skeleton label="กำลังโหลดเมนู…" lines={6} />
          </Panel>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button
              type="button"
              onClick={() => void load()}
              aria-label="ลองโหลดเมนูอีกครั้ง"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm transition-colors hover:bg-ink-50"
            >
              <Icon name="refresh" size={18} />
              ลองใหม่
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white px-4 py-10 text-center">
            <p className="font-semibold text-ink-800">
              {groups.length === 0 ? "ยังไม่มีเมนูพร้อมขาย" : "ไม่พบเมนูที่ตรงกับเงื่อนไข"}
            </p>
            <p className="mt-1 text-sm text-ink-600">
              {groups.length === 0
                ? "ร้านยังไม่เปิดขายเมนู โปรดกลับมาดูใหม่ภายหลัง"
                : "ลองเปลี่ยนคำค้นหรือประเภท แล้วค้นใหม่อีกครั้ง"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p role="status" className="inline-flex items-center gap-2 text-sm text-ink-600">
              <Icon name="menu" size={18} />
              พบ {total} เมนูพร้อมขายใน {filtered.length} หมวดหมู่
            </p>
            {filtered.map((g) => (
              <section key={g.category} aria-label={`หมวด ${g.category}`} className="space-y-3">
                <h2 className="pa-section-title text-lg font-bold text-ink-900">{g.category}</h2>
                <StaggerList className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((m, index) => {
                    // Ticket 07: ข้อมูลเก่า/จำลองอาจไม่มีฟิลด์ใหม่ — ค่าเริ่มต้นพร้อมขายโดยไม่มีตัวเลือก
                    const optionGroups = m.optionGroups ?? [];
                    const inStock = m.inStock ?? true;
                    return (
                      <StaggerItem key={m.id} index={index} className="overflow-hidden luxe-card">
                        {/* แตะตรงไหนของการ์ดก็เปิดป๊อปอัปสั่งซื้อ — ปุ่มข้างล่างคือทางเข้าหลักของคีย์บอร์ด/สกรีนรีดเดอร์ */}
                        <TiltCard className="pa-lift h-full cursor-pointer">
                        <div onClick={() => setOrdering(m)} className="h-full">
                        {/* รูปพัง/ยังไม่มีรูป → แผ่นป้ายสำรอง แทนการหายไปเงียบ ๆ จนการ์ดโหว่ */}
                        <MenuItemImage src={m.imageUrl} name={m.name} className="h-36 w-full" />
                        <div className="luxe-layer space-y-1.5 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="text-base font-bold text-ink-900">{m.name}</p>
                            <span className="flex flex-wrap gap-1.5">
                              <Badge tone="brand">{MENU_KIND_LABELS[m.kind]}</Badge>
                              {inStock ? null : <Badge tone="danger">วัตถุดิบหมดชั่วคราว</Badge>}
                            </span>
                          </div>
                          {m.description ? <p className="text-sm text-ink-600">{m.description}</p> : null}
                          <p className="text-base luxe-price font-semibold text-ink-900">{fmtPrice(m.price)}</p>
                          {optionGroups.length > 0 ? (
                            <div className="space-y-1 border-t border-ink-100 pt-2">
                              {optionGroups.map((og) => (
                                <p key={og.id} className="text-xs text-ink-600">
                                  <span className="font-semibold text-ink-800">{og.name}:</span>{" "}
                                  {og.options.map((o) => `${o.name} (${fmtDelta(o.priceDelta)})`).join(" · ")}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOrdering(m);
                            }}
                            aria-label={inStock ? `สั่ง ${m.name}` : `ดูรายละเอียด ${m.name} (วัตถุดิบหมดชั่วคราว)`}
                            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-ink-900 px-4 py-2 text-sm font-semibold tracking-wide text-ink-900 transition-colors hover:bg-ink-900 hover:text-ink-50"
                          >
                            <Icon name="cart" size={18} />
                            {inStock ? "สั่งเมนูนี้" : "ดูรายละเอียด"}
                          </button>
                        </div>
                        </div>
                        </TiltCard>
                      </StaggerItem>
                    );
                  })}
                </StaggerList>
              </section>
            ))}
          </div>
        )}

        {added ? (
          <div className="flex flex-wrap items-center justify-center gap-3" role="status">
            <p className="text-sm font-semibold text-green-800">{added}</p>
            <Link to="/cart" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-800 hover:border-gold-600">
              <Icon name="cart" size={18} />
              ไปที่ตะกร้า
            </Link>
          </div>
        ) : null}

        <p className="text-center text-sm text-ink-500">
          <Link to="/status" className="font-semibold text-brand-700 underline underline-offset-2">
            ดูสถานะร้านและโต๊ะว่าง
          </Link>
        </p>
      </main>

      {ordering ? (
        <MenuOrderDialog
          item={ordering}
          onClose={() => setOrdering(null)}
          onAdded={({ name, quantity }) => setAdded(`เพิ่ม ${name} ${quantity} ชิ้นลงตะกร้าแล้ว`)}
        />
      ) : null}
    </div>
  );
}
