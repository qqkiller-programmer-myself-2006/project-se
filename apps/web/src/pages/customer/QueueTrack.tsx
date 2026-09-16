import { useState } from "react";
import {
  QUEUE_STATUS_LABELS,
  api,
  type OrderDetail,
  type QueueJob,
  type WaitEstimate,
} from "../../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/ui";
import { MotionReveal, Skeleton, StaggerItem, StaggerList } from "../../components/motion";
import { ConnectionBanner, DemoBadge } from "../../components/demo";
import { DEMO_QUEUE_JOBS, DEMO_NON_GUARANTEE, isDemoModeEnabled, shouldFallbackToDemo } from "../../lib/demo";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** เวลารอโดยประมาณจากเวลามาตรฐานของฝ่าย (จนกว่า Ticket 13 จะมีโมเดลพยากรณ์) */
function etaText(job: QueueJob): string {
  if (job.status === "delivered") return "ส่งมอบแล้ว";
  if (job.status === "cancelled") return "รายการนี้ถูกยกเลิก";
  if (job.status === "ready") return "พร้อมส่งมอบแล้ว พนักงานกำลังนำไปเสิร์ฟ";
  const standard = job.station === "kitchen" ? 15 : 5;
  const readyAt = new Date(job.readyAt).getTime();
  if (readyAt > Date.now()) return `คิวล่วงหน้า เริ่มทำประมาณ ${fmtTime(job.readyAt)}`;
  return `กำลังทำโดยประมาณอีก ${standard} นาที`;
}

/**
 * หน้าติดตามคิวของลูกค้า (Ticket 09 — สมาชิก/Guest):
 * - สมาชิก: เลือกจากคำสั่งซื้อของฉัน · Guest: กรอกเลขคำสั่งซื้อ + เบอร์โทร
 * - แสดงสถานะภาษาไทย queued/preparing/ready/delivered + เวลารอโดยประมาณ
 */
export default function QueueTrackPage() {
  const [mode, setMode] = useState<"member" | "guest">("guest");
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [trackedNumber, setTrackedNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticket 13: เวลารอโดยประมาณของคำสั่งซื้อ (enhancement — ล้มเหลวเงียบ ไม่บังสถานะคิวหลัก)
  const [waitEstimate, setWaitEstimate] = useState<WaitEstimate | null>(null);
  const [waitLoading, setWaitLoading] = useState(false);
  const [demo, setDemo] = useState(false);

  async function loadWait(orderId: string, guestPhone?: string) {
    setWaitLoading(true);
    try {
      const res = await api.capacityWaitOrder(orderId, 2, guestPhone);
      const estimate = (res as { estimate?: WaitEstimate }).estimate;
      setWaitEstimate(estimate && typeof estimate.rangeMin === "number" ? estimate : null);
    } catch {
      setWaitEstimate(null);
    } finally {
      setWaitLoading(false);
    }
  }

  async function loadMyOrders() {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      setOrders((await api.myOrders()).orders);
    } catch (err) {
      setOrdersError(err instanceof Error ? err.message : "โหลดคำสั่งซื้อไม่สำเร็จ กรุณาเข้าสู่ระบบบัญชีลูกค้า");
    } finally {
      setOrdersLoading(false);
    }
  }

  function showDemoQueue() {
    setJobs(DEMO_QUEUE_JOBS);
    setTrackedNumber("ORD-DEMO-0001");
    setWaitEstimate({
      orderId: "demo-order-1",
      station: null,
      partySize: 2,
      perStation: [],
      estimatedWaitMin: 15,
      rangeMin: 10,
      rangeMax: 20,
      readyAtSlowest: null,
      source: "baseline",
      modelVersion: "demo-baseline",
      predictedAt: new Date().toISOString(),
      timeoutMs: 0,
      nonGuarantee: DEMO_NON_GUARANTEE,
    });
    setDemo(true);
    setError(null);
  }

  async function trackGuest() {
    if (!orderNumber.trim() || !phone.trim()) {
      // Dev-only shortcut: empty form + demo mode still shows fixtures with label.
      if (isDemoModeEnabled()) {
        setLoading(true);
        try {
          showDemoQueue();
        } finally {
          setLoading(false);
        }
        return;
      }
      setError("กรุณากรอกเลขคำสั่งซื้อและเบอร์โทรที่ใช้สั่งซื้อ");
      return;
    }
    setLoading(true);
    setError(null);
    setWaitEstimate(null);
    setDemo(false);
    try {
      const found = await api.orderLookup(orderNumber.trim(), phone.trim());
      const res = await api.queueOrder(found.order.id, phone.trim());
      if (res.jobs.length === 0 && isDemoModeEnabled()) {
        showDemoQueue();
        return;
      }
      setJobs(res.jobs);
      setTrackedNumber(res.orderNumber);
      if (res.jobs.length > 0) void loadWait(found.order.id, phone.trim());
    } catch (err) {
      // Offline always falls back; demo mode falls back on ANY lookup failure.
      if (shouldFallbackToDemo(err)) {
        showDemoQueue();
      } else {
        setError(err instanceof Error ? err.message : "ติดตามคิวไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }

  async function trackOrder(order: OrderDetail) {
    setLoading(true);
    setError(null);
    setWaitEstimate(null);
    try {
      const res = await api.queueOrder(order.id);
      setJobs(res.jobs);
      setTrackedNumber(res.orderNumber);
      if (res.jobs.length > 0) void loadWait(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ติดตามคิวไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="ติดตามคิวอาหารและเครื่องดื่ม"
        description="ดูสถานะงานครัว/เครื่องดื่มของคำสั่งซื้อที่ชำระแล้ว พร้อมเวลารอโดยประมาณ"
      />

      {demo ? (
        <div className="space-y-3">
          <DemoBadge />
          <ConnectionBanner onRetry={() => void trackGuest()} />
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {loading ? "กำลังโหลดสถานะคิว" : trackedNumber ? `คำสั่งซื้อ ${trackedNumber} มีงานคิว ${jobs.length} รายการ` : "ยังไม่ได้เลือกคำสั่งซื้อ"}
      </div>

      <Panel label="เลือกวิธีติดตาม">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="วิธีติดตามคิว">
          <button type="button" role="tab" aria-selected={mode === "guest"} onClick={() => setMode("guest")} className={mode === "guest" ? primaryButtonClass : secondaryButtonClass}>
            Guest (เลข+เบอร์โทร)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "member"}
            onClick={() => {
              setMode("member");
              void loadMyOrders();
            }}
            className={mode === "member" ? primaryButtonClass : secondaryButtonClass}
          >
            สมาชิก (คำสั่งซื้อของฉัน)
          </button>
        </div>

        {mode === "guest" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="track-number" className="mb-1 block text-sm font-semibold text-ink-800">
                เลขคำสั่งซื้อ (เช่น ORD-20260914-AB12)
              </label>
              <input id="track-number" className={inputClass} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-…" />
            </div>
            <div>
              <label htmlFor="track-phone" className="mb-1 block text-sm font-semibold text-ink-800">
                เบอร์โทรที่ใช้สั่งซื้อ
              </label>
              <input id="track-phone" className={inputClass} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08XXXXXXXX" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={() => void trackGuest()} disabled={loading} className={primaryButtonClass}>
                {loading ? "กำลังติดตาม…" : "ติดตามคิว"}
              </button>
              {isDemoModeEnabled() ? (
                <button
                  type="button"
                  onClick={() => showDemoQueue()}
                  className={secondaryButtonClass}
                  aria-label="ดูตัวอย่างคิว ORD-DEMO-0001"
                >
                  ดูตัวอย่าง
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {ordersLoading ? (
              <Skeleton label="กำลังโหลดคำสั่งซื้อ…" lines={3} />
            ) : ordersError ? (
              <Alert tone="error" role="alert">{ordersError}</Alert>
            ) : orders.length === 0 ? (
              <p className="text-sm text-ink-600">ยังไม่มีคำสั่งซื้อในบัญชีนี้</p>
            ) : (
              <StaggerList className="space-y-2">
                {orders.map((o, index) => (
                  <StaggerItem key={o.id} index={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 p-3">
                    <span className="text-sm font-bold">{o.orderNumber}</span>
                    <span className="text-sm text-ink-600">{o.items.length} รายการ · {o.total} บาท</span>
                    <button type="button" onClick={() => void trackOrder(o)} disabled={loading} className={secondaryButtonClass}>
                      ดูคิว
                    </button>
                  </StaggerItem>
                ))}
              </StaggerList>
            )}
          </div>
        )}
      </Panel>

      {loading && <Skeleton label="กำลังโหลดสถานะคิว…" lines={3} />}
      {error && <Alert tone="error" role="alert">{error}</Alert>}

      {!loading && !error && trackedNumber && (
        <MotionReveal>
        <Panel label={`สถานะคิว ${trackedNumber}`}>
          <h2 className="text-base font-bold text-ink-900">คำสั่งซื้อ {trackedNumber}</h2>
          {jobs.length > 0 && (
            <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3" aria-live="polite">
              {waitLoading ? (
                <Skeleton label="กำลังประมาณเวลารอ…" lines={2} />
              ) : waitEstimate ? (
                <>
                  <p className="text-base font-bold text-brand-800">
                    {waitEstimate.rangeMin === waitEstimate.rangeMax
                      ? `เวลารอโดยประมาณ ${waitEstimate.rangeMin} นาที`
                      : `เวลารอโดยประมาณ ${waitEstimate.rangeMin}–${waitEstimate.rangeMax} นาที`}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {waitEstimate.source === "model" ? `โมเดล ${waitEstimate.modelVersion}` : "เวลามาตรฐาน"} · {waitEstimate.nonGuarantee}
                  </p>
                </>
              ) : null}
            </div>
          )}
          {jobs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-600">คำสั่งซื้อนี้ยังไม่เข้าคิว (อาจรอชำระเงิน) ชำระสำเร็จแล้วงานจะขึ้นที่นี่อัตโนมัติ</p>
          ) : (
            <StaggerList as="ol" className="mt-3 space-y-3">
              {jobs.map((job, index) => (
                <StaggerItem key={job.id} index={index} className="rounded-xl border border-ink-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink-900">{job.menuName} ×{job.quantity}</span>
                    <Badge tone={job.status === "ready" ? "success" : job.status === "delivered" ? "active" : job.status === "cancelled" ? "danger" : "brand"}>
                      {QUEUE_STATUS_LABELS[job.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-700">{etaText(job)}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {job.station === "kitchen" ? "ฝ่ายครัว" : "ฝ่ายเครื่องดื่ม"}
                    {job.tableName ? ` · เสิร์ฟที่โต๊ะ ${job.tableName}` : ""}
                    {job.quantity > 1 ? ` · ทำเสร็จ ${job.readyQty}/${job.quantity} · ส่งมอบ ${job.deliveredQty}/${job.quantity}` : ""}
                  </p>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </Panel>
        </MotionReveal>
      )}
    </div>
  );
}
