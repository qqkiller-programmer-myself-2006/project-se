import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  RESERVATION_STATUS_LABELS,
  TABLE_ZONE_LABELS,
  api,
  type PublicCustomer,
  type ReservationDetail,
  type TableAvailability,
} from "../../lib/api";
import { ReservationCard } from "../../components/ReservationCard";
import { Alert, Panel, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";
import { DepthHero, MotionReveal, Skeleton } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { Icon } from "../../components/icons";
import { ReservationVenueGallery } from "../../components/ReservationVenueGallery";
import { ReservationTableScene } from "../../components/ReservationTableScene";
import { demoAvailability, isDemoTableId } from "../../components/venueModel";
import { DEMO_RESERVATIONS, isDemoModeEnabled, isOfflineError, shouldFallbackToDemo } from "../../lib/demo";
import {
  buildBookingDays,
  buildTimeSlots,
  formatBookingDateTime,
  pickDefaultSlot,
  slotToDate,
  toDateKey,
} from "../../lib/reservationSlots";

const PARTY_MIN = 1;
const PARTY_MAX = 50;

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // API ต้องการรูปแบบ UUID — สำรองสำหรับเบราว์เซอร์เก่า
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

type Availability = { tables: TableAvailability[]; recommendedTableId: string | null };

function StepCard({
  step,
  title,
  hint,
  done,
  children,
  id,
}: {
  step: number;
  title: string;
  hint?: string;
  done?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const headingId = `reserve-step-${step}`;
  return (
    <section id={id} aria-labelledby={headingId} className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 flex-none place-items-center rounded-full text-base font-bold ${
            done ? "bg-emerald-600 text-white" : "bg-brand-600 text-white"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-lg font-bold text-ink-900">
            <span className="sr-only">ขั้นที่ {step}: </span>
            {title}
          </h2>
          {hint ? <p className="mt-0.5 text-sm text-ink-600">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

const chipClass =
  "pa-press min-h-[44px] rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors aria-pressed:border-brand-600 aria-pressed:bg-brand-600 aria-pressed:text-white border-ink-200 bg-white text-ink-800 hover:border-gold-500";

/**
 * หน้าจองโต๊ะของลูกค้า — 3 ขั้นชัดเจน:
 * 1) วัน เวลา จำนวนคน  2) เลือกโซนและโต๊ะจากผังจริง (สถานะ ณ เวลานั้น)  3) ตรวจสอบแล้วยืนยัน
 * Guest ดูผังและโต๊ะว่างได้ แต่ต้องเข้าสู่ระบบก่อนยืนยันการจอง
 */
export default function ReservationsPage() {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [items, setItems] = useState<ReservationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  // ---------- ขั้นที่ 1: วัน เวลา จำนวนคน ----------
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const initialSlot = useMemo(() => pickDefaultSlot(new Date()), []);
  const [partySize, setPartySize] = useState(2);
  const [dateKey, setDateKey] = useState(initialSlot?.dateKey ?? toDateKey(new Date()));
  const [time, setTime] = useState(initialSlot?.time ?? "");
  const days = useMemo(() => buildBookingDays(now), [now]);
  const times = useMemo(() => buildTimeSlots(dateKey, now), [dateKey, now]);

  // เวลาเดินไปจนช่องที่เลือกหมดสิทธิ์จอง → เลื่อนไปช่องแรกที่ยังจองได้
  useEffect(() => {
    if (days.length > 0 && !days.some((d) => d.key === dateKey)) {
      setDateKey(days[0]!.key);
      return;
    }
    if (times.length > 0 && !times.includes(time)) setTime(times[0]!);
  }, [days, times, dateKey, time]);

  const reservedAt = time ? slotToDate(dateKey, time) : null;
  const reservedIso = reservedAt ? reservedAt.toISOString() : null;

  // ---------- ขั้นที่ 2: ผังสถานะโต๊ะ ----------
  const [availability, setAvailability] = useState<Availability>({ tables: [], recommendedTableId: null });
  const [availLoading, setAvailLoading] = useState(true);
  const [availError, setAvailError] = useState<string | null>(null);
  const [availDemo, setAvailDemo] = useState(false);
  const [availVersion, setAvailVersion] = useState(0);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!reservedIso) {
      setAvailLoading(false);
      setAvailability({ tables: [], recommendedTableId: null });
      return;
    }
    let cancelled = false;
    setAvailLoading(true);
    setAvailError(null);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.reservationAvailability(partySize, reservedIso);
        if (cancelled) return;
        setAvailability(res);
        setAvailDemo(false);
      } catch (err) {
        if (cancelled) return;
        if (shouldFallbackToDemo(err) || isOfflineError(err)) {
          setAvailability(demoAvailability(partySize));
          setAvailDemo(true);
        } else {
          setAvailError(err instanceof Error ? err.message : "ตรวจสอบโต๊ะว่างไม่สำเร็จ");
        }
      } finally {
        if (!cancelled) setAvailLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [partySize, reservedIso, availVersion]);

  // ผังใหม่ทำให้โต๊ะที่เลือกไว้ไม่ว่างแล้ว → ยกเลิกการเลือกพร้อมแจ้ง
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTableId || availLoading) return;
    const table = availability.tables.find((t) => t.id === selectedTableId);
    if (!table || table.status !== "available") {
      setSelectedTableId(null);
      setSelectionNotice(
        table
          ? `โต๊ะ ${table.name} ${table.status === "booked" ? "ถูกจองในช่วงเวลานี้แล้ว" : "มีที่นั่งไม่พอ"} กรุณาเลือกโต๊ะใหม่`
          : "โต๊ะที่เลือกไม่พร้อมให้จองแล้ว กรุณาเลือกโต๊ะใหม่",
      );
    }
  }, [availability, availLoading, selectedTableId]);

  const selectedTable = availability.tables.find((t) => t.id === selectedTableId) ?? null;

  // ---------- ขั้นที่ 3: ยืนยัน ----------
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<ReservationDetail | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  useEffect(() => {
    const el = document.getElementById("reserve-confirm");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setConfirmVisible(Boolean(entry?.isIntersecting)), {
      threshold: 0.15,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  function changeParty(next: number) {
    if (!Number.isFinite(next)) return;
    setPartySize(Math.min(PARTY_MAX, Math.max(PARTY_MIN, Math.round(next))));
    setCreated(null);
  }

  function selectTable(id: string | null) {
    setSelectedTableId(id);
    setSelectionNotice(null);
    setCreateError(null);
    setCreated(null);
  }

  async function create() {
    if (creating) return;
    setCreateError(null);
    if (!customer) {
      setCreateError("กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อนยืนยันการจอง");
      return;
    }
    if (!reservedAt || !selectedTable) {
      setCreateError("กรุณาเลือกโต๊ะในขั้นที่ 2 ก่อนยืนยัน");
      return;
    }
    if (availDemo || isDemoTableId(selectedTable.id)) {
      setCreateError("ตอนนี้เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (โหมดสาธิต) จึงยังจองจริงไม่ได้ กรุณาลองใหม่เมื่อออนไลน์");
      return;
    }
    try {
      setCreating(true);
      const res = await api.reservationCreate({
        tableId: selectedTable.id,
        partySize,
        reservedAt: reservedAt.toISOString(),
        note: note.trim() ? note.trim() : null,
        idempotencyKey: newIdempotencyKey(),
      });
      setCreated(res.reservation);
      setNote("");
      setSelectedTableId(null);
      setAvailVersion((v) => v + 1);
      try {
        setItems((await api.myReservations()).reservations);
      } catch {
        // รายการจะอัปเดตเมื่อโหลดหน้าใหม่ — การจองสำเร็จแล้ว
      }
    } catch (err) {
      setCreateError(
        isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ยังไม่ได้จอง กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
          : err instanceof Error
            ? err.message
            : "สร้างการจองไม่สำเร็จ",
      );
      // โต๊ะอาจถูกจองตัดหน้า — ดึงผังล่าสุด
      setAvailVersion((v) => v + 1);
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
      setAvailVersion((v) => v + 1);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "ยกเลิกการจองไม่สำเร็จ");
    } finally {
      setCancelId(null);
    }
  }

  const whenText = reservedAt ? formatBookingDateTime(reservedAt) : "ยังไม่ได้เลือกเวลา";
  const zoneText = selectedTable?.zone ? TABLE_ZONE_LABELS[selectedTable.zone] : selectedTable ? "โซนอื่น ๆ" : "—";
  const canConfirm = Boolean(customer && selectedTable && reservedAt && !availDemo && !creating);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 pb-28 sm:px-6">
      <a href="#reservations-main" className="ui-skip-link">
        ข้ามไปยังการจอง
      </a>
      <DepthHero>
        <h1 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">จองโต๊ะล่วงหน้า</h1>
        <p className="mt-1 inline-flex items-center gap-2 text-sm text-ink-600">
          <Icon name="reserve" size={18} />
          เลือกเวลา เลือกโต๊ะจากผังร้านจริง แล้วกดยืนยัน — จองล่วงหน้า 1 ชม. ถึง 3 วัน
        </p>
        {demo ? (
          <div className="mt-3 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </DepthHero>

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      <main id="reservations-main" aria-label="จองโต๊ะ" className="space-y-5">
        <StepCard step={1} title="เลือกวัน เวลา และจำนวนคน" hint="ระบบถือโต๊ะให้ 2 ชั่วโมงนับจากเวลานัด" done={Boolean(reservedAt)}>
          <div className="space-y-4">
            <div>
              <p id="party-label" className="mb-1.5 text-sm font-semibold text-ink-800">
                จำนวนคน
              </p>
              <div className="flex items-center gap-2" role="group" aria-labelledby="party-label">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  aria-label="ลดจำนวนคน"
                  disabled={partySize <= PARTY_MIN}
                  onClick={() => changeParty(partySize - 1)}
                >
                  −
                </button>
                <label htmlFor="res-party" className="sr-only">
                  จำนวนผู้ใช้บริการ (คน)
                </label>
                <div className="w-20">
                  <input
                    id="res-party"
                    type="number"
                    min={PARTY_MIN}
                    max={PARTY_MAX}
                    inputMode="numeric"
                    className={`${inputClass} text-center text-lg font-bold`}
                    value={partySize}
                    onChange={(e) => changeParty(Number(e.target.value))}
                  />
                </div>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  aria-label="เพิ่มจำนวนคน"
                  disabled={partySize >= PARTY_MAX}
                  onClick={() => changeParty(partySize + 1)}
                >
                  +
                </button>
                <span className="text-sm text-ink-600">คน</span>
              </div>
            </div>

            <div>
              <p id="day-label" className="mb-1.5 text-sm font-semibold text-ink-800">
                วันที่
              </p>
              {days.length === 0 ? (
                <p className="text-sm text-ink-600">ขณะนี้ไม่มีวันที่เปิดให้จอง</p>
              ) : (
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="day-label">
                  {days.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      className={chipClass}
                      aria-pressed={day.key === dateKey}
                      onClick={() => {
                        setDateKey(day.key);
                        setCreated(null);
                      }}
                    >
                      <span className="block leading-tight">{day.label}</span>
                      <span className="block text-xs font-normal opacity-80">{day.dateLabel}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p id="time-label" className="mb-1.5 text-sm font-semibold text-ink-800">
                เวลานัด
              </p>
              {times.length === 0 ? (
                <p className="text-sm text-ink-600">วันนี้ไม่มีเวลาที่จองได้แล้ว กรุณาเลือกวันอื่น</p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-labelledby="time-label">
                  {times.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={chipClass}
                      aria-pressed={t === time}
                      onClick={() => {
                        setTime(t);
                        setCreated(null);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </StepCard>

        <StepCard
          step={2}
          title="เลือกโซนและโต๊ะ"
          hint={`สถานะโต๊ะสำหรับ ${partySize} คน · ${whenText}`}
          done={Boolean(selectedTable)}
        >
          <div className="space-y-3">
            {availDemo ? (
              <Alert tone="info" role="status">
                เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กำลังแสดงผังตัวอย่าง (ดูได้แต่ยังจองจริงไม่ได้)
              </Alert>
            ) : null}
            {availError ? (
              <Alert tone="error" role="alert">
                {availError}{" "}
                <button type="button" className="font-semibold underline" onClick={() => setAvailVersion((v) => v + 1)}>
                  ลองอีกครั้ง
                </button>
              </Alert>
            ) : null}
            {selectionNotice ? (
              <Alert tone="info" role="status">
                {selectionNotice}
              </Alert>
            ) : null}
            {!availLoading && !availError && availability.tables.length > 0 && !availability.tables.some((t) => t.status === "available") ? (
              <Alert tone="info" role="status">
                เวลานี้ไม่มีโต๊ะว่างสำหรับ {partySize} คน ลองเปลี่ยนเวลาหรือวันในขั้นที่ 1
              </Alert>
            ) : null}
            <ReservationTableScene
              tables={availability.tables}
              recommendedTableId={availability.recommendedTableId}
              partySize={partySize}
              selectedTableId={selectedTableId}
              onSelectTable={selectTable}
              loading={availLoading}
            />
          </div>
        </StepCard>

        <StepCard step={3} title="ตรวจสอบและยืนยันการจอง" id="reserve-confirm" done={Boolean(created)}>
          <div className="space-y-4">
            {created ? (
              <div role="status" className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4">
                <p className="text-lg font-bold text-emerald-800">จองสำเร็จ รหัส {created.code}</p>
                <p className="mt-1 text-sm text-emerald-900">
                  โต๊ะ {created.tableName} · {created.partySize} คน · {formatBookingDateTime(new Date(created.reservedAt))}
                </p>
                <p className="mt-1 text-sm text-emerald-900">แสดงรหัสนี้ที่หน้าร้านเพื่อเช็กอิน ดูรายละเอียดได้ใน “การจองของฉัน” ด้านล่าง</p>
              </div>
            ) : null}

            <dl className="grid gap-2 rounded-xl bg-ink-100 p-4 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-600">วันและเวลา</dt>
                <dd className="font-semibold text-ink-900">{whenText}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-600">จำนวนคน</dt>
                <dd className="font-semibold text-ink-900">{partySize} คน</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-600">โซน</dt>
                <dd className="font-semibold text-ink-900">{zoneText}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-600">โต๊ะ</dt>
                <dd className={`font-semibold ${selectedTable ? "text-ink-900" : "text-brand-700"}`}>
                  {selectedTable ? `โต๊ะ ${selectedTable.name} (${selectedTable.capacity} ที่นั่ง)` : "ยังไม่ได้เลือก — แตะโต๊ะสีเขียวในขั้นที่ 2"}
                </dd>
              </div>
            </dl>

            <div>
              <label htmlFor="res-note" className="mb-1 block text-sm font-semibold text-ink-800">
                หมายเหตุถึงร้าน (ถ้ามี)
              </label>
              <input
                id="res-note"
                className={inputClass}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น มีเด็กเล็ก ขอเก้าอี้เสริม"
              />
            </div>

            {createError ? (
              <Alert tone="error" role="alert">
                {createError}
              </Alert>
            ) : null}

            {sessionChecked && !customer ? (
              <Alert tone="info" role="status">
                กรุณา
                <Link to="/customer/login" className="font-semibold text-brand-700 underline underline-offset-2">
                  เข้าสู่ระบบบัญชีลูกค้า
                </Link>
                ก่อนยืนยันการจอง (Guest จองโต๊ะไม่ได้) หรือ
                <Link to="/register" className="font-semibold text-brand-700 underline underline-offset-2">
                  สมัครสมาชิก
                </Link>
              </Alert>
            ) : null}

            {customer ? (
              <button
                type="button"
                onClick={() => void create()}
                disabled={!canConfirm}
                aria-busy={creating}
                className={`${primaryButtonClass} w-full text-base sm:w-auto`}
              >
                {creating ? "กำลังจอง…" : selectedTable ? `ยืนยันจองโต๊ะ ${selectedTable.name}` : "เลือกโต๊ะก่อนยืนยัน"}
              </button>
            ) : null}
          </div>
        </StepCard>

        {loading ? (
          <Panel label="กำลังโหลดการจอง">
            <Skeleton label="กำลังโหลดการจอง…" lines={4} />
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
        ) : demo ? (
          <Panel label="การจองตัวอย่าง">
            <div className="space-y-3">
              <h2 className="text-base font-bold text-ink-900">การจองตัวอย่าง ({items.length} รายการ)</h2>
              <p className="text-sm text-ink-600">สร้าง/ยกเลิกการจองต้องเชื่อมต่อเซิร์ฟเวอร์ — ข้อมูลด้านล่างไว้ดูดีไซน์เท่านั้น</p>
              {items.map((r, index) => (
                <MotionReveal key={r.id} index={index}>
                  <ReservationCard reservation={r} />
                </MotionReveal>
              ))}
            </div>
          </Panel>
        ) : customer ? (
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
                  <p className="mt-1 text-sm text-ink-600">เลือกเวลาและโต๊ะด้านบนเพื่อจองครั้งแรกได้เลย</p>
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
                        {r.status === "pending" || r.status === "confirmed" ? (
                          <button
                            type="button"
                            onClick={() => void cancel(r.id)}
                            disabled={cancelId === r.id}
                            aria-busy={cancelId === r.id}
                            className="inline-flex min-h-[44px] items-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {cancelId === r.id ? "กำลังยกเลิก…" : `ยกเลิกการจอง ${r.code}`}
                          </button>
                        ) : (
                          <p className="text-sm text-ink-500">สถานะ: {RESERVATION_STATUS_LABELS[r.status]}</p>
                        )}
                      </div>
                    </MotionReveal>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        ) : null}

        <ReservationVenueGallery />
      </main>

      {selectedTable && !confirmVisible && !created ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(28,21,18,0.6)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="min-w-0 text-sm leading-tight text-ink-800">
              <strong className="block truncate">
                โต๊ะ {selectedTable.name} · {partySize} คน
              </strong>
              <span className="block truncate text-ink-600">{whenText}</span>
            </p>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => document.getElementById("reserve-confirm")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              ไปยืนยัน
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
