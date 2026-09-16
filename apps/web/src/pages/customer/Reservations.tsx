import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  RESERVATION_STATUS_LABELS,
  api,
  type PublicCustomer,
  type RecommendedTable,
  type ReservationDetail,
} from "../../lib/api";
import { ReservationCard } from "../../components/ReservationCard";
import { Alert, Panel, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";
import { DepthHero, MotionReveal, Skeleton } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { Icon } from "../../components/icons";
import { ReservationVenueGallery } from "../../components/ReservationVenueGallery";
import { ReservationTableScene } from "../../components/ReservationTableScene";
import { DEMO_RESERVATIONS, isDemoModeEnabled, isOfflineError, shouldFallbackToDemo } from "../../lib/demo";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * หน้าการจองของลูกค้า (Ticket 06):
 * - สมาชิกที่ login แล้วสร้าง/ดู/ยกเลิกการจองของตนเองได้
 * - ระบบแนะนำโต๊ะว่างที่เล็กที่สุดซึ่งรองรับจำนวนคน (จองล่วงหน้า 60 นาที – 3 วัน)
 */
export default function ReservationsPage() {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [items, setItems] = useState<ReservationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [partySize, setPartySize] = useState("2");
  const [reservedAt, setReservedAt] = useState(() => {
    const d = new Date(Date.now() + 2 * 3600_000);
    return toLocalInput(d.toISOString());
  });
  const [note, setNote] = useState("");
  const [recommend, setRecommend] = useState<RecommendedTable | null>(null);
  const [recommendChecked, setRecommendChecked] = useState(false);
  const [selectedSceneTableId, setSelectedSceneTableId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState<string | null>(null);

  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setDemo(false);
      let me: PublicCustomer | null = null;
      try {
        me = (await api.customerMe()).customer;
      } catch (sessionErr) {
        if (shouldFallbackToDemo(sessionErr)) {
          setCustomer(null);
          setSessionChecked(true);
          setItems(DEMO_RESERVATIONS);
          setDemo(true);
          return;
        }
        me = null;
      }
      setCustomer(me);
      setSessionChecked(true);
      if (me) {
        try {
          const fetched = (await api.myReservations()).reservations;
          if (fetched.length === 0 && isDemoModeEnabled()) {
            setItems(DEMO_RESERVATIONS);
            setDemo(true);
          } else {
            setItems(fetched);
          }
        } catch (listErr) {
          if (shouldFallbackToDemo(listErr)) {
            setItems(DEMO_RESERVATIONS);
            setDemo(true);
          } else {
            throw listErr;
          }
        }
      } else if (isDemoModeEnabled()) {
        setItems(DEMO_RESERVATIONS);
        setDemo(true);
      } else {
        setItems([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดการจองไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function checkRecommend() {
    setCreateError(null);
    setCreateOk(null);
    setRecommend(null);
    setRecommendChecked(false);
    const n = Number(partySize);
    if (!Number.isInteger(n) || n < 1) {
      setCreateError("จำนวนผู้ใช้บริการต้องเป็นจำนวนเต็มมากกว่าศูนย์");
      return;
    }
    if (!reservedAt) {
      setCreateError("กรุณาระบุวันเวลานัดหมาย");
      return;
    }
    try {
      const iso = new Date(reservedAt).toISOString();
      const res = await api.reservationRecommend(n, iso);
      setRecommend(res.table);
      setRecommendChecked(true);
    } catch (err) {
      setCreateError(
        isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — ดูโต๊ะว่างไม่ได้ กรุณาเชื่อมต่อเน็ตแล้วลองใหม่"
          : err instanceof Error ? err.message : "ค้นหาโต๊ะว่างไม่สำเร็จ",
      );
    }
  }

  async function create() {
    if (creating) return;
    setCreateError(null);
    setCreateOk(null);
    const n = Number(partySize);
    if (!Number.isInteger(n) || n < 1) {
      setCreateError("จำนวนผู้ใช้บริการต้องเป็นจำนวนเต็มมากกว่าศูนย์");
      return;
    }
    if (!reservedAt) {
      setCreateError("กรุณาระบุวันเวลานัดหมาย");
      return;
    }
    const d = new Date(reservedAt);
    if (Number.isNaN(d.getTime())) {
      setCreateError("รูปแบบวันเวลานัดไม่ถูกต้อง");
      return;
    }
    try {
      setCreating(true);
      const res = await api.reservationCreate({
        partySize: n,
        reservedAt: d.toISOString(),
        note: note.trim() ? note.trim() : null,
        idempotencyKey: newIdempotencyKey(),
      });
      setCreateOk(
        `จองสำเร็จ รหัส ${res.reservation.code} โต๊ะ ${res.reservation.tableName} วันที่ ${new Date(res.reservation.reservedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`,
      );
      setNote("");
      setRecommend(null);
      setRecommendChecked(false);
      setSelectedSceneTableId(null);
      setItems((await api.myReservations()).reservations);
    } catch (err) {
      setCreateError(
        isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — สร้างการจองไม่ได้ กรุณาเชื่อมต่อเน็ตแล้วลองใหม่"
          : err instanceof Error ? err.message : "สร้างการจองไม่สำเร็จ",
      );
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id: string) {
    if (cancelId) return;
    setCancelError(null);
    try {
      setCancelId(id);
      await api.reservationCancel(id);
      setItems((list) => list.map((r) => (r.id === id ? { ...r, status: "cancelled" as const } : r)));
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "ยกเลิกการจองไม่สำเร็จ");
    } finally {
      setCancelId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#reservations-main" className="ui-skip-link">
        ข้ามไปยังการจอง
      </a>
      <DepthHero>
        <h1 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">จองโต๊ะล่วงหน้า</h1>
        <p className="mt-1 inline-flex items-center gap-2 text-sm text-ink-600">
          <Icon name="reserve" size={18} />
          จองล่วงหน้าอย่างน้อย 60 นาที ไม่เกิน 3 วัน ยกเลิกได้ก่อนนัด 60 นาที
        </p>
        {demo ? (
          <div className="mt-3 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </DepthHero>

      <ReservationVenueGallery />

      <ReservationTableScene
        partySize={partySize}
        recommendedTableId={recommend?.id}
        selectedTableId={selectedSceneTableId}
        onSelectTable={setSelectedSceneTableId}
      />

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      <main id="reservations-main" aria-label="การจองของฉัน" className="space-y-4">
        {loading ? (
          <Panel label="กำลังโหลดการจอง">
            <Skeleton label="กำลังโหลดการจอง…" lines={5} />
          </Panel>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
              ลองใหม่
            </button>
          </div>
        ) : (
          <>
            {sessionChecked && !customer && !demo ? (
              <Alert tone="info" role="status">
                กรุณา
                <Link to="/customer/login" className="font-semibold text-brand-700 underline underline-offset-2">
                  เข้าสู่ระบบบัญชีลูกค้า
                </Link>
                ก่อนจองโต๊ะ (Guest จองโต๊ะไม่ได้) หรือ
                <Link to="/register" className="font-semibold text-brand-700 underline underline-offset-2">
                  สมัครสมาชิก
                </Link>
              </Alert>
            ) : null}

            {customer ? (
              <Panel label="สร้างการจองใหม่">
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-ink-900">สร้างการจองใหม่</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="res-party" className="mb-1 block text-sm font-semibold text-ink-800">
                        จำนวนผู้ใช้บริการ (คน)
                      </label>
                      <input
                        id="res-party"
                        className={inputClass}
                        inputMode="numeric"
                        value={partySize}
                        onChange={(e) => setPartySize(e.target.value)}
                        placeholder="เช่น 2"
                      />
                    </div>
                    <div>
                      <label htmlFor="res-time" className="mb-1 block text-sm font-semibold text-ink-800">
                        วันเวลานัดหมาย
                      </label>
                      <input
                        id="res-time"
                        type="datetime-local"
                        className={inputClass}
                        value={reservedAt}
                        onChange={(e) => setReservedAt(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="res-note" className="mb-1 block text-sm font-semibold text-ink-800">
                      หมายเหตุ (ถ้ามี ไม่เกิน 200 ตัวอักษร)
                    </label>
                    <input
                      id="res-note"
                      className={inputClass}
                      value={note}
                      maxLength={200}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="เช่น ขอโต๊ะริมหน้าต่าง"
                    />
                  </div>
                  {recommendChecked ? (
                    <p role="status" className="text-sm text-ink-700">
                      {recommend
                        ? `โต๊ะที่แนะนำ: ${recommend.name} (รองรับ ${recommend.capacity} คน) — ระบบจะจัดโต๊ะนี้ให้อัตโนมัติ`
                        : "ช่วงเวลานี้ไม่มีโต๊ะว่างที่รองรับจำนวนคน กรุณาเปลี่ยนเวลาหรือจำนวนคน"}
                    </p>
                  ) : null}
                  {createError ? (
                    <Alert tone="error" role="alert">
                      {createError}
                    </Alert>
                  ) : null}
                  {createOk ? (
                    <Alert tone="success" role="status">
                      {createOk}
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void checkRecommend()} className={secondaryButtonClass}>
                      ดูโต๊ะที่แนะนำ
                    </button>
                    <button
                      type="button"
                      onClick={() => void create()}
                      disabled={creating}
                      aria-busy={creating}
                      className={primaryButtonClass}
                    >
                      {creating ? "กำลังจอง…" : "ยืนยันการจอง"}
                    </button>
                  </div>
                </div>
              </Panel>
            ) : null}

            {demo ? (
              <Panel label="การจองตัวอย่าง">
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-ink-900">การจองตัวอย่าง ({items.length} รายการ)</h2>
                  <p className="text-sm text-ink-600">
                    สร้าง/ยกเลิกการจองต้องเชื่อมต่อเซิร์ฟเวอร์ — ข้อมูลด้านล่างไว้ดูดีไซน์เท่านั้น
                  </p>
                  {items.map((r, index) => (
                    <MotionReveal key={r.id} index={index}>
                      <ReservationCard reservation={r} />
                    </MotionReveal>
                  ))}
                </div>
              </Panel>
            ) : null}

            {customer ? (
              <Panel label="การจองของฉัน">
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-ink-900">การจองของ {customer.name}</h2>
                  {cancelError ? (
                    <Alert tone="error" role="alert">
                      {cancelError}
                    </Alert>
                  ) : null}
                  {items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
                      <p className="font-semibold text-ink-800">ยังไม่มีการจอง</p>
                      <p className="mt-1 text-sm text-ink-600">สร้างการจองใหม่จากแบบฟอร์มด้านบนได้เลย</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p role="status" className="text-sm text-ink-600">
                        พบ {items.length} การจอง
                      </p>
                      {items.map((r, index) => (
                        <MotionReveal key={r.id} index={index}>
                          <div className="space-y-2">
                          <ReservationCard reservation={r} />
                          {(r.status === "pending" || r.status === "confirmed") && (
                            <button
                              type="button"
                              onClick={() => void cancel(r.id)}
                              disabled={cancelId === r.id}
                              aria-busy={cancelId === r.id}
                              className="inline-flex min-h-[44px] items-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {cancelId === r.id ? "กำลังยกเลิก…" : `ยกเลิกการจอง ${r.code}`}
                            </button>
                          )}
                          {r.status !== "pending" && r.status !== "confirmed" ? (
                            <p className="text-sm text-ink-500">สถานะ: {RESERVATION_STATUS_LABELS[r.status]}</p>
                          ) : null}
                          </div>
                        </MotionReveal>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
