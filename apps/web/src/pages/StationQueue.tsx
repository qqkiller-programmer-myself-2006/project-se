import { useEffect, useState } from "react";
import {
  QUEUE_STATION_LABELS,
  QUEUE_STATUS_LABELS,
  api,
  type QueueJob,
  type QueueStation,
  type QueueStatus,
  type StationCapacity,
} from "../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  Spinner,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  successButtonClass,
} from "../components/ui";

const STATUS_FILTERS: (QueueStatus | "")[] = ["", "queued", "claimed", "preparing", "ready", "delivered", "cancelled"];

function statusTone(s: QueueStatus): "brand" | "success" | "danger" | "neutral" | "active" | "inactive" {
  if (s === "ready") return "success";
  if (s === "delivered") return "active";
  if (s === "cancelled") return "danger";
  if (s === "preparing") return "brand";
  return "neutral";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * หน้าคิวฝ่ายอาหาร/เครื่องดื่ม (Ticket 09 — kitchen/drink/owner/admin):
 * - FIFO ต่อฝ่ายตาม readyAt (preorder บล็อกจนถึง readyAt; priority ขึ้นก่อน)
 * - lifecycle queued → claimed → preparing → ready → delivered พร้อมทยอยจำนวน
 * - ทำใหม่/เร่งด่วนต้องมีเหตุผล; ยกเลิกได้เฉพาะก่อนเริ่มทำ
 * - server ปฏิเสธข้ามฝ่าย (403) — หน้านี้ขอเฉพาะฝ่ายของตน
 */
export default function StationQueuePage({
  station,
  canManageCapacity,
}: {
  station: QueueStation;
  canManageCapacity: boolean;
}) {
  const [status, setStatus] = useState<QueueStatus | "">("");
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [remakeQty, setRemakeQty] = useState<Record<string, string>>({});
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [capacities, setCapacities] = useState<StationCapacity[]>([]);
  const [capInput, setCapInput] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [capMsg, setCapMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.queueList({ station, status: status || undefined, limit: 100 });
      setJobs(res.jobs);
      if (canManageCapacity) {
        setCapacities((await api.queueCapacities()).capacities);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคิวงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, status]);

  async function run(id: string, fn: () => Promise<unknown>, okMsg: string) {
    if (busyId) return;
    setBusyId(id);
    setRowError(null);
    setRowNotice(null);
    try {
      await fn();
      setRowNotice(okMsg);
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  function num(value: string | undefined, fallback: number): number {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  }

  async function saveCapacity() {
    const n = Number(capInput);
    if (!Number.isInteger(n) || n < 1) {
      setCapMsg("กำลังผลิตต้องเป็นจำนวนเต็มมากกว่าศูนย์");
      return;
    }
    setCapBusy(true);
    setCapMsg(null);
    try {
      const res = await api.queueSetCapacity(station, n);
      setCapacities((list) => list.map((c) => (c.station === station ? res.capacity : c)));
      setCapInput("");
      setCapMsg(`ตั้งกำลังผลิตฝ่าย${QUEUE_STATION_LABELS[station]} ${n} งานต่อ 15 นาทีแล้ว`);
    } catch (err) {
      setCapMsg(err instanceof Error ? err.message : "บันทึกกำลังผลิตไม่สำเร็จ");
    } finally {
      setCapBusy(false);
    }
  }

  const blockedCount = jobs.filter((j) => new Date(j.readyAt).getTime() > Date.now() && j.status !== "cancelled" && j.status !== "delivered").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`คิวฝ่าย${QUEUE_STATION_LABELS[station]}`}
        description={`ลำดับ FIFO ตามเวลาพร้อมทำ${blockedCount > 0 ? ` · รอเวลาพร้อมทำ ${blockedCount} งาน` : ""} · แตะปุ่มขนาด ≥44px รองรับจอสัมผัสหลังร้าน`}
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
            {loading ? "กำลังโหลด…" : "โหลดใหม่"}
          </button>
        }
      />

      <div aria-live="polite" className="sr-only">
        {loading ? "กำลังโหลดคิวงาน" : `คิวฝ่าย${QUEUE_STATION_LABELS[station]} ทั้งหมด ${jobs.length} งาน`}
      </div>

      {rowNotice && <Alert tone="success" role="status">{rowNotice}</Alert>}
      {rowError && <Alert tone="error" role="alert">{rowError}</Alert>}

      <Panel label="ตัวกรองสถานะ">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="queue-status" className="text-sm font-semibold text-ink-800">
            สถานะ
          </label>
          <select
            id="queue-status"
            className={`${inputClass} w-auto min-w-[44px]`}
            value={status}
            onChange={(e) => setStatus(e.target.value as QueueStatus | "")}
          >
            <option value="">ทั้งหมด</option>
            {STATUS_FILTERS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {QUEUE_STATUS_LABELS[s as QueueStatus]}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      {loading ? (
        <Spinner label="กำลังโหลดคิวงาน…" />
      ) : error ? (
        <Alert tone="error" role="alert">{error}</Alert>
      ) : jobs.length === 0 ? (
        <Panel label="คิวว่าง">
          <p className="text-sm text-ink-600">ยังไม่มีงานคิว{status ? `สถานะ${QUEUE_STATUS_LABELS[status as QueueStatus]}` : ""} งานที่ชำระสำเร็จจะเข้าคิวอัตโนมัติ</p>
        </Panel>
      ) : (
        <ol className="space-y-3">
          {jobs.map((job, idx) => {
            const blocked = new Date(job.readyAt).getTime() > Date.now();
            const busy = busyId === job.id;
            return (
              <li key={job.id}>
                <Panel label={`งานคิว ${job.orderNumber} ${job.menuName}`}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink-900" aria-label={`ลำดับที่ ${idx + 1}`}>
                        #{idx + 1}
                      </span>
                      <span className="text-base font-bold text-ink-900">{job.menuName} ×{job.quantity}</span>
                      <Badge tone={statusTone(job.status)}>{QUEUE_STATUS_LABELS[job.status]}</Badge>
                      {job.isPriority && <Badge tone="danger">เร่งด่วน</Badge>}
                      {job.isRemake && <Badge tone="brand">ทำใหม่</Badge>}
                      {blocked && job.status !== "cancelled" && job.status !== "delivered" && (
                        <Badge tone="inactive">รอเวลาพร้อมทำ {fmtTime(job.readyAt)}</Badge>
                      )}
                    </div>
                    <dl className="grid gap-x-6 gap-y-1 text-sm text-ink-700 sm:grid-cols-2">
                      <div className="flex gap-2"><dt className="font-semibold">คำสั่งซื้อ</dt><dd>{job.orderNumber}</dd></div>
                      <div className="flex gap-2"><dt className="font-semibold">โต๊ะ</dt><dd>{job.tableName ?? "—"}</dd></div>
                      <div className="flex gap-2"><dt className="font-semibold">ทำเสร็จ</dt><dd>{job.readyQty}/{job.quantity}</dd></div>
                      <div className="flex gap-2"><dt className="font-semibold">ส่งมอบ</dt><dd>{job.deliveredQty}/{job.quantity}</dd></div>
                      {job.claimedBy && <div className="flex gap-2"><dt className="font-semibold">ผู้รับงาน</dt><dd>{job.claimedBy}</dd></div>}
                      {job.reason && <div className="flex gap-2"><dt className="font-semibold">เหตุผล</dt><dd>{job.reason}</dd></div>}
                    </dl>

                    <div className="flex flex-wrap gap-2">
                      {job.status === "queued" && (
                        <button type="button" disabled={busy} onClick={() => void run(job.id, () => api.queueClaim(job.id), `รับงาน ${job.menuName} แล้ว`)} className={primaryButtonClass}>
                          {busy ? "กำลังรับงาน…" : "รับงาน"}
                        </button>
                      )}
                      {job.status === "claimed" && (
                        <button type="button" disabled={busy} onClick={() => void run(job.id, () => api.queueStart(job.id), `เริ่มทำ ${job.menuName} แล้ว (ตัดสต๊อกจริงครั้งแรก)`) } className={primaryButtonClass}>
                          {busy ? "กำลังเริ่ม…" : "เริ่มทำ"}
                        </button>
                      )}
                      {(job.status === "claimed" || job.status === "preparing") && (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <label htmlFor={`ready-${job.id}`} className="sr-only">จำนวนที่ทำเสร็จ</label>
                          <input
                            id={`ready-${job.id}`}
                            className={`${inputClass} w-24`}
                            inputMode="numeric"
                            placeholder="จำนวน"
                            value={qty[job.id] ?? ""}
                            onChange={(e) => setQty((m) => ({ ...m, [job.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(job.id, () => api.queueReady(job.id, num(qty[job.id], job.quantity - job.readyQty)), "บันทึกทำเสร็จแล้ว")}
                            className={successButtonClass}
                          >
                            บันทึกทำเสร็จ
                          </button>
                        </span>
                      )}
                      {job.status === "ready" && (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <label htmlFor={`deliver-${job.id}`} className="sr-only">จำนวนที่ส่งมอบ</label>
                          <input
                            id={`deliver-${job.id}`}
                            className={`${inputClass} w-24`}
                            inputMode="numeric"
                            placeholder="จำนวน"
                            value={qty[job.id] ?? ""}
                            onChange={(e) => setQty((m) => ({ ...m, [job.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(job.id, () => api.queueDeliver(job.id, num(qty[job.id], job.readyQty - job.deliveredQty)), "บันทึกส่งมอบแล้ว")}
                            className={successButtonClass}
                          >
                            บันทึกส่งมอบ
                          </button>
                        </span>
                      )}
                      {(job.status === "queued" || job.status === "claimed") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(job.id, () => api.queueCancel(job.id, (reason[job.id] ?? "").trim() || "ยกเลิกก่อนเริ่มทำ"), `ยกเลิกงาน ${job.menuName} แล้ว`)}
                          className={dangerButtonClass}
                        >
                          ยกเลิกรายการ
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        aria-expanded={openPanel === `pr-${job.id}`}
                        onClick={() => setOpenPanel((p) => (p === `pr-${job.id}` ? null : `pr-${job.id}`))}
                        className={secondaryButtonClass}
                      >
                        เร่งด่วน/ทำใหม่
                      </button>
                    </div>

                    {openPanel === `pr-${job.id}` && (
                      <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
                        <div>
                          <label htmlFor={`reason-${job.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                            เหตุผล (บังคับสำหรับเร่งด่วน/ทำใหม่/ยกเลิก)
                          </label>
                          <input
                            id={`reason-${job.id}`}
                            className={inputClass}
                            value={reason[job.id] ?? ""}
                            onChange={(e) => setReason((m) => ({ ...m, [job.id]: e.target.value }))}
                            placeholder="เช่น ลูกค้ารอหน้าร้าน ทำผิดสูตร"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy || !(reason[job.id] ?? "").trim()}
                            onClick={() => void run(job.id, () => api.queuePriority(job.id, (reason[job.id] ?? "").trim()), "เร่งงานแล้ว")}
                            className={secondaryButtonClass}
                          >
                            เร่งงานนี้
                          </button>
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <label htmlFor={`remake-${job.id}`} className="sr-only">จำนวนทำใหม่</label>
                            <input
                              id={`remake-${job.id}`}
                              className={`${inputClass} w-24`}
                              inputMode="numeric"
                              placeholder="ทั้งชุด"
                              value={remakeQty[job.id] ?? ""}
                              onChange={(e) => setRemakeQty((m) => ({ ...m, [job.id]: e.target.value }))}
                            />
                            <button
                              type="button"
                              disabled={busy || !(reason[job.id] ?? "").trim()}
                              onClick={() =>
                                void run(
                                  job.id,
                                  () =>
                                    api.queueRemake(
                                      job.id,
                                      (reason[job.id] ?? "").trim(),
                                      remakeQty[job.id] ? num(remakeQty[job.id], job.quantity - job.deliveredQty) : undefined,
                                    ),
                                  "สร้างงานทำใหม่แล้ว (ไม่คิดเงินซ้ำ)",
                                )
                              }
                              className={secondaryButtonClass}
                            >
                              ทำใหม่
                            </button>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ol>
      )}

      {canManageCapacity && (
        <Panel label="กำลังผลิตต่อช่วง 15 นาที">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-ink-900">กำลังผลิตฝ่าย{QUEUE_STATION_LABELS[station]}</h2>
            <p className="text-sm text-ink-600">
              ปัจจุบัน {capacities.find((c) => c && c.station === station)?.perSlot ?? "—"} งานต่อช่วง 15 นาที · เต็มแล้วเสนอช่วงถัดไปให้คำสั่งซื้อล่วงหน้า
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="cap-input" className="mb-1 block text-sm font-semibold text-ink-800">
                  กำลังผลิตใหม่ (งานต่อ 15 นาที)
                </label>
                <input
                  id="cap-input"
                  className={`${inputClass} w-40`}
                  inputMode="numeric"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  placeholder="เช่น 12"
                />
              </div>
              <button type="button" onClick={() => void saveCapacity()} disabled={capBusy} className={primaryButtonClass}>
                {capBusy ? "กำลังบันทึก…" : "บันทึกกำลังผลิต"}
              </button>
            </div>
            {capMsg && <Alert tone={capMsg.includes("แล้ว") ? "success" : "error"} role="status">{capMsg}</Alert>}
          </div>
        </Panel>
      )}
    </div>
  );
}
