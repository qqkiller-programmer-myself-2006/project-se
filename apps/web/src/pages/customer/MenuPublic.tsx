import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MENU_KIND_LABELS, api, type MenuKind, type PublicMenuGroupWithOptions } from "../../lib/api";
import { DEMO_MENU_GROUPS, isDemoModeEnabled, shouldFallbackToDemo } from "../../lib/demo";
import { Alert, Badge, Panel } from "../../components/ui";
import { DepthHero, MotionReveal, Skeleton, StaggerItem, StaggerList, TiltCard } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { Icon, FoodMotif } from "../../components/icons";
import { RealMenuPhotoGallery } from "../../components/RealMenuPhotoGallery";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDelta(n: number): string {
  if (n === 0) return "ไม่เพิ่มราคา";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/** หน้าเมนูสาธารณะ: ดูได้โดยไม่ต้องเข้าสู่ระบบ — เฉพาะเมนูพร้อมขาย จัดกลุ่มตามหมวด */
export default function MenuPublicPage() {
  const [groups, setGroups] = useState<PublicMenuGroupWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [kind, setKind] = useState<"" | MenuKind>("");
  const [q, setQ] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setDemo(false);
      const fetched = (await api.menuPublic()).groups;
      // Dev-only demo mode: empty API also shows local fixtures (with label).
      // Normal mode keeps the real empty state so operators see the truth.
      if (fetched.length === 0 && isDemoModeEnabled()) {
        setGroups(DEMO_MENU_GROUPS);
        setDemo(true);
      } else {
        setGroups(fetched);
      }
    } catch (err) {
      // Prefer real API; offline always falls back, other errors only in demo mode.
      // Mutations still call the real API — demo never bypasses auth/security.
      if (shouldFallbackToDemo(err)) {
        setGroups(DEMO_MENU_GROUPS);
        setDemo(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "โหลดเมนูไม่สำเร็จ");
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
        <p
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md"
        >
          <FoodMotif className="h-9 w-9" />
        </p>
        <h1 className="font-display mt-2 text-xl font-bold text-ink-900 sm:text-2xl">เมนูร้านป้าอ้ออาหารตามสั่ง</h1>
        <p className="mt-1 text-sm text-ink-600">
          ดูเมนูพร้อมขายแยกตามหมวดหมู่ได้โดยไม่ต้องเข้าสู่ระบบ
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
                className="w-full min-h-[44px] rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-400 shadow-sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="เช่น ข้าวผัด ชาเย็น"
              />
            </div>
            <div>
              <label htmlFor="menu-kind" className="mb-1 block text-sm font-semibold text-ink-800">
                ประเภท
              </label>
              <select
                id="menu-kind"
                className="w-full min-h-[44px] rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-base text-ink-900 shadow-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as "" | MenuKind)}
              >
                <option value="">ทั้งหมด (อาหาร + เครื่องดื่ม)</option>
                <option value="food">{MENU_KIND_LABELS.food}</option>
                <option value="drink">{MENU_KIND_LABELS.drink}</option>
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
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm transition-colors hover:bg-ink-50"
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
                      <StaggerItem key={m.id} index={index} className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
                        <TiltCard className="pa-lift h-full">
                        {m.imageUrl ? (
                          <img
                            src={m.imageUrl}
                            alt={`รูป${m.name}`}
                            loading="lazy"
                            className="h-36 w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : null}
                        <div className="space-y-1.5 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="text-base font-bold text-ink-900">{m.name}</p>
                            <span className="flex flex-wrap gap-1.5">
                              <Badge tone="brand">{MENU_KIND_LABELS[m.kind]}</Badge>
                              {inStock ? null : <Badge tone="danger">วัตถุดิบหมดชั่วคราว</Badge>}
                            </span>
                          </div>
                          {m.description ? <p className="text-sm text-ink-600">{m.description}</p> : null}
                          <p className="text-base font-bold text-brand-700">{fmtPrice(m.price)}</p>
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

        <p className="text-center text-sm text-ink-500">
          <Link to="/status" className="font-semibold text-brand-700 underline underline-offset-2">
            ดูสถานะร้านและโต๊ะว่าง
          </Link>
        </p>
      </main>
    </div>
  );
}
