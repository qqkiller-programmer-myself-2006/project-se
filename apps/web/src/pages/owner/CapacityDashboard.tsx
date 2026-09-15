import { useCallback, useEffect, useState } from "react";
import {
  QUEUE_STATION_LABELS,
  api,
  type CapacityOverview,
  type PreorderSlotCheck,
  type PredictionAccuracy,
  type PredictionModel,
  type QueueStation,
  type WaitEstimate,
} from "../../lib/api";
import { Alert, Badge, PageHeader, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { DEMO_CAPACITY, DEMO_NON_GUARANTEE, isOfflineError } from "../../lib/demo";

function fmtTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function waitText(e: { rangeMin: number; rangeMax: number }): string {
  return e.rangeMin === e.rangeMax ? `ประมาณ ${e.rangeMin} นาที` : `ประมาณ ${e.rangeMin}–${e.rangeMax} นาที`;
}

/**
 * Dashboard กำลังผลิต + เวลารอ Owner/Admin (Ticket 13):
 * - ภาพรวมกำลังผลิตต่อฝ่าย (perSlot/งานค้าง/เวลารอ baseline) + โต๊ะว่าง
 * - ประมาณเวลารอรายฝ่าย + ตรวจสล็อตล่วงหน้า (เต็มเสนอช่วงถัดไป)
 * - โมเดลพยากรณ์: รุ่น/สถานะ/ความแม่นยำ (MAE baseline vs model + fixtures) + ตั้งค่า
 * - ทุกเวลารอกำกับว่า "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน"
 */
export default function CapacityDashboardPage() {
  const [overview, setOverview] = useState<CapacityOverview | null>(null);
  const [nonGuarantee, setNonGuarantee] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const [waitStation, setWaitStation] = useState<QueueStation>("kitchen");
  const [waitParty, setWaitParty] = useState("2");
  const [waitEstimate, setWaitEstimate] = useState<WaitEstimate | null>(null);
  const [waitLoading, setWaitLoading] = useState(false);
  const [waitError, setWaitError] = useState<string | null>(null);

  const [slotStation, setSlotStation] = useState<QueueStation>("kitchen");
  const [slotAt, setSlotAt] = useState("");
  const [slotParty, setSlotParty] = useState("2");
  const [slotCheck, setSlotCheck] = useState<PreorderSlotCheck | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  const [model, setModel] = useState<PredictionModel | null>(null);
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({ version: "", thresholdMinutes: "", timeoutMs: "" });
  const [modelSaving, setModelSaving] = useState(false);
  const [modelMessage, setModelMessage] = useState<string | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDemo(false);
    try {
      const res = await api.capacityOverview();
      setOverview(res.overview);
      setNonGuarantee(res.nonGuarantee);
    } catch (err) {
      if (isOfflineError(err)) {
        setOverview(DEMO_CAPACITY);
        setNonGuarantee(DEMO_NON_GUARANTEE);
        setDemo(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "โหลดภาพรวมไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [m, a] = await Promise.all([api.predictionModelGet(), api.predictionAccuracy()]);
      setModel(m.model);
      setAccuracy(a.accuracy);
      setModelForm({ version: m.model.version, thresholdMinutes: String(m.model.thresholdMinutes), timeoutMs: String(m.model.timeoutMs) });
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "โหลดข้อมูลโมเดลไม่สำเร็จ");
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadMeta();
  }, [loadOverview, loadMeta]);

  async function estimateWait() {
    setWaitLoading(true);
    setWaitError(null);
    try {
      const party = Math.max(1, Number(waitParty) || 2);
      const res = await api.capacityWaitStation(waitStation, party);
      setWaitEstimate(res.estimate);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : "ประมาณเวลารอไม่สำเร็จ");
    } finally {
      setWaitLoading(false);
    }
  }

  async function checkSlot() {
    if (!slotAt) {
      setSlotError("กรุณาเลือกวันเวลานัดรับ");
      return;
    }
    setSlotLoading(true);
    setSlotError(null);
    try {
      const iso = new Date(slotAt).toISOString();
      const party = Math.max(1, Number(slotParty) || 2);
      const res = await api.preorderCheck({ station: slotStation, scheduledAt: iso, partySize: party });
      setSlotCheck(res.check);
    } catch (err) {
      setSlotError(err instanceof Error ? err.message : "ตรวจสล็อตไม่สำเร็จ");
    } finally {
      setSlotLoading(false);
    }
  }

  async function saveModel(patch: { version?: string; kind?: "baseline" | "external"; enabled?: boolean; thresholdMinutes?: number; timeoutMs?: number }) {
    setModelSaving(true);
    setModelMessage(null);
    try {
      const res = await api.predictionModelSet(patch);
      setModel(res.model);
      setModelMessage("บันทึกการตั้งค่าโมเดลแล้ว");
      const a = await api.predictionAccuracy();
      setAccuracy(a.accuracy);
    } catch (err) {
      setModelMessage(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setModelSaving(false);
    }
  }

  async function runEvaluate() {
    setEvalLoading(true);
    try {
      const res = await api.predictionEvaluate();
      setAccuracy(res.accuracy);
      const m = await api.predictionModelGet();
      setModel(m.model);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "ประเมินไม่สำเร็จ");
    } finally {
      setEvalLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="กำลังผลิตและเวลารอ"
        description="กำลังผลิตต่อช่วง 15 นาที งานค้าง โต๊ะว่าง และเวลารอโดยประมาณ (baseline) พร้อมสถานะโมเดลพยากรณ์"
        actions={
          <button type="button" onClick={() => { void loadOverview(); void loadMeta(); }} className={secondaryButtonClass}>
            โหลดใหม่
          </button>
        }
      />

      {demo ? (
        <div className="space-y-3">
          <DemoBadge />
          <ConnectionBanner onRetry={() => { void loadOverview(); void loadMeta(); }} />
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {loading ? "กำลังโหลดภาพรวมกำลังผลิต" : overview ? `ครัวรอ ${overview.stations[0]?.rangeMin}–${overview.stations[0]?.rangeMax} นาที` : "ยังไม่มีข้อมูล"}
      </div>

      {loading ? (
        <Spinner label="กำลังโหลดภาพรวมกำลังผลิต…" />
      ) : error ? (
        <Alert tone="error" role="alert">{error}</Alert>
      ) : overview ? (
        <div className="grid gap-4 md:grid-cols-2">
          {overview.stations.map((s) => (
            <Panel key={s.station} label={`กำลังผลิตฝ่าย${QUEUE_STATION_LABELS[s.station]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-ink-900">ฝ่าย{QUEUE_STATION_LABELS[s.station]}</h2>
                <Badge tone={s.source === "model" ? "active" : "brand"}>
                  {s.source === "model" ? "โมเดลพยากรณ์" : "เวลามาตรฐาน"}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-ink-50 p-3">
                  <dt className="text-ink-600">กำลังผลิต/15 นาที</dt>
                  <dd className="text-lg font-bold text-ink-900">{s.perSlot} งาน</dd>
                </div>
                <div className="rounded-xl bg-ink-50 p-3">
                  <dt className="text-ink-600">งานค้าง (ชิ้น)</dt>
                  <dd className="text-lg font-bold text-ink-900">{s.activeJobs} ({s.unitsAhead})</dd>
                </div>
              </dl>
              <p className="mt-3 text-base font-bold text-brand-800">{waitText(s)}</p>
              <p className="mt-1 text-xs text-ink-500">{nonGuarantee || "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน"}</p>
            </Panel>
          ))}
          <Panel label="โต๊ะและผู้ใช้บริการ">
            <h2 className="text-base font-bold text-ink-900">โต๊ะและผู้ใช้บริการ</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">โต๊ะว่าง</dt>
                <dd className="text-lg font-bold text-ink-900">{overview.freeTables}/{overview.enabledTables}</dd>
              </div>
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">ผู้ใช้บริการ</dt>
                <dd className="text-lg font-bold text-ink-900">{overview.customerCount} คน</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-500">ข้อมูล ณ {fmtTime(overview.at)}</p>
          </Panel>
        </div>
      ) : (
        <Alert tone="info" role="status">ยังไม่มีข้อมูลกำลังผลิต</Alert>
      )}

      <Panel label="ประมาณเวลารอรายฝ่าย">
        <h2 className="text-base font-bold text-ink-900">ประมาณเวลารอรายฝ่าย</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="cap-wait-station" className="mb-1 block text-sm font-semibold text-ink-800">ฝ่ายงาน (ประมาณเวลา)</label>
            <select id="cap-wait-station" className={inputClass} value={waitStation} onChange={(e) => setWaitStation(e.target.value as QueueStation)}>
              <option value="kitchen">ครัว</option>
              <option value="drink">เครื่องดื่ม</option>
            </select>
          </div>
          <div>
            <label htmlFor="cap-wait-party" className="mb-1 block text-sm font-semibold text-ink-800">จำนวนคน</label>
            <input id="cap-wait-party" className={inputClass} inputMode="numeric" value={waitParty} onChange={(e) => setWaitParty(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => void estimateWait()} disabled={waitLoading} className={primaryButtonClass}>
              {waitLoading ? "กำลังประมาณ…" : "ประมาณเวลา"}
            </button>
          </div>
        </div>
        {waitLoading && <div className="mt-3"><Spinner label="กำลังประมาณเวลารอ…" /></div>}
        {waitError && <div className="mt-3"><Alert tone="error" role="alert">{waitError}</Alert></div>}
        {waitEstimate && !waitLoading && (
          <div className="mt-3 rounded-xl border border-ink-200 p-3" aria-live="polite">
            <p className="text-base font-bold text-brand-800">{waitText(waitEstimate)}</p>
            <p className="mt-1 text-xs text-ink-500">
              {waitEstimate.source === "model" ? `โมเดล ${waitEstimate.modelVersion}` : "เวลามาตรฐาน"} · {waitEstimate.nonGuarantee}
            </p>
          </div>
        )}
      </Panel>

      <Panel label="ตรวจสล็อตล่วงหน้า">
        <h2 className="text-base font-bold text-ink-900">ตรวจสล็อตล่วงหน้า (จอง/นัดรับ)</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <label htmlFor="cap-slot-station" className="mb-1 block text-sm font-semibold text-ink-800">ฝ่ายงาน (ตรวจสล็อต)</label>
            <select id="cap-slot-station" className={inputClass} value={slotStation} onChange={(e) => setSlotStation(e.target.value as QueueStation)}>
              <option value="kitchen">ครัว</option>
              <option value="drink">เครื่องดื่ม</option>
            </select>
          </div>
          <div>
            <label htmlFor="cap-slot-at" className="mb-1 block text-sm font-semibold text-ink-800">วันเวลานัดรับ</label>
            <input id="cap-slot-at" type="datetime-local" className={inputClass} value={slotAt} onChange={(e) => setSlotAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cap-slot-party" className="mb-1 block text-sm font-semibold text-ink-800">จำนวนคน</label>
            <input id="cap-slot-party" className={inputClass} inputMode="numeric" value={slotParty} onChange={(e) => setSlotParty(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => void checkSlot()} disabled={slotLoading} className={primaryButtonClass}>
              {slotLoading ? "กำลังตรวจ…" : "ตรวจสล็อต"}
            </button>
          </div>
        </div>
        {slotLoading && <div className="mt-3"><Spinner label="กำลังตรวจสล็อต…" /></div>}
        {slotError && <div className="mt-3"><Alert tone="error" role="alert">{slotError}</Alert></div>}
        {slotCheck && !slotLoading && (
          <div className="mt-3 rounded-xl border border-ink-200 p-3" aria-live="polite">
            {slotCheck.available ? (
              <Alert tone="success" role="status">สล็อตว่าง (ใช้ {slotCheck.used}/{slotCheck.capacity}) · {waitText(slotCheck)}</Alert>
            ) : (
              <Alert tone="error" role="alert">
                สล็อตเต็ม (ใช้ {slotCheck.used}/{slotCheck.capacity})
                {slotCheck.suggestedSlot ? ` · ช่วงถัดไปที่ว่าง ${fmtTime(slotCheck.suggestedSlot.slotStart)}` : " · เต็มทั้ง 7 วันข้างหน้า"}
              </Alert>
            )}
          </div>
        )}
      </Panel>

      <Panel label="โมเดลพยากรณ์และความแม่นยำ">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink-900">โมเดลพยากรณ์และความแม่นยำ</h2>
          <button type="button" onClick={() => void runEvaluate()} disabled={evalLoading} className={secondaryButtonClass}>
            {evalLoading ? "กำลังประเมิน…" : "ประเมินใหม่"}
          </button>
        </div>
        {metaLoading ? (
          <div className="mt-3"><Spinner label="กำลังโหลดข้อมูลโมเดล…" /></div>
        ) : metaError ? (
          <div className="mt-3"><Alert tone="error" role="alert">{metaError}</Alert></div>
        ) : model && accuracy ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={model.enabled ? "active" : "inactive"}>{model.enabled ? "เปิดใช้" : "ปิดใช้"}</Badge>
              <span className="font-semibold text-ink-900">{model.version}</span>
              <span className="text-ink-600">({model.kind === "external" ? "โมเดลภายนอก" : "เวลามาตรฐาน"})</span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">ตัวอย่างวัดจริง</dt>
                <dd className="text-lg font-bold text-ink-900">{accuracy.samples}</dd>
              </div>
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">MAE มาตรฐาน</dt>
                <dd className="text-lg font-bold text-ink-900">{accuracy.maeBaseline ?? "–"}</dd>
              </div>
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">MAE โมเดล</dt>
                <dd className="text-lg font-bold text-ink-900">{accuracy.maeModel ?? "–"}</dd>
              </div>
              <div className="rounded-xl bg-ink-50 p-3">
                <dt className="text-ink-600">Fixtures</dt>
                <dd className="text-lg font-bold text-ink-900">{accuracy.fixtures.modelWins ? "โมเดลดีกว่า" : "ยังไม่ดีกว่า"}</dd>
              </div>
            </dl>
            {accuracy.gatheringSamples && (
              <Alert tone="info" role="status">กำลังสะสมตัวอย่าง (ต้องมีอย่างน้อย 500 งานก่อนประเมินโมเดลจริงตาม D09)</Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <div>
                <label htmlFor="cap-model-version" className="mb-1 block text-sm font-semibold text-ink-800">รุ่นโมเดล</label>
                <input id="cap-model-version" className={inputClass} value={modelForm.version} onChange={(e) => setModelForm({ ...modelForm, version: e.target.value })} />
              </div>
              <div>
                <label htmlFor="cap-model-threshold" className="mb-1 block text-sm font-semibold text-ink-800">เกณฑ์ดีกว่า (นาที)</label>
                <input id="cap-model-threshold" className={inputClass} inputMode="decimal" value={modelForm.thresholdMinutes} onChange={(e) => setModelForm({ ...modelForm, thresholdMinutes: e.target.value })} />
              </div>
              <div>
                <label htmlFor="cap-model-timeout" className="mb-1 block text-sm font-semibold text-ink-800">Timeout (ms)</label>
                <input id="cap-model-timeout" className={inputClass} inputMode="numeric" value={modelForm.timeoutMs} onChange={(e) => setModelForm({ ...modelForm, timeoutMs: e.target.value })} />
              </div>
              <div className="flex items-end gap-2">
                <button type="button" onClick={() => void saveModel({ version: modelForm.version || undefined, thresholdMinutes: modelForm.thresholdMinutes === "" ? undefined : Number(modelForm.thresholdMinutes), timeoutMs: modelForm.timeoutMs === "" ? undefined : Number(modelForm.timeoutMs) })} disabled={modelSaving} className={secondaryButtonClass}>
                  {modelSaving ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>
            </div>
            {modelMessage && <Alert tone={modelMessage.includes("แล้ว") ? "success" : "error"} role="status">{modelMessage}</Alert>}
          </div>
        ) : (
          <div className="mt-3"><Alert tone="info" role="status">ยังไม่มีข้อมูลโมเดล</Alert></div>
        )}
      </Panel>
    </div>
  );
}
