import { useEffect, useState } from "react";
import {
  api,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type NotificationItem,
  type NotificationKind,
  type NotificationStatus,
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
import { Skeleton, StaggerItem, StaggerList } from "../../components/motion";

function statusTone(s: NotificationStatus): "brand" | "success" | "danger" | "neutral" {
  if (s === "sent") return "success";
  if (s === "failed" || s === "dead_letter") return "danger";
  if (s === "skipped") return "neutral";
  return "brand";
}

const STATUS_FILTERS: (NotificationStatus | "")[] = [
  "",
  "pending",
  "sending",
  "sent",
  "failed",
  "dead_letter",
  "skipped",
];
const KIND_FILTERS: (NotificationKind | "")[] = [
  "",
  "reservation_created",
  "reservation_cancelled",
  "reservation_reminder",
  "payment_paid",
  "payment_manual_review",
  "order_ready",
  "order_delivered",
  "loyalty_earned",
  "loyalty_redeemed",
];

/**
 * หน้าจัดการแจ้งเตือน LINE หลังร้าน (Ticket 12 — Owner/Admin):
 * - ดูสถานะ outbox (กรองสถานะ/ชนิด) + สั่งส่งซ้ำรายการ failed/dead_letter/skipped
 * - สั่ง flush คิวค้าง + กวาดเตือนการจอง 30 นาทีด้วยมือ + ตรวจ/ตั้ง consent ลูกค้า
 */
export default function AdminNotificationsPage() {
  const [status, setStatus] = useState<NotificationStatus | "">("");
  const [kind, setKind] = useState<NotificationKind | "">("");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [running, setRunning] = useState<"outbox" | "reminders" | null>(null);
  const [consentId, setConsentId] = useState("");
  const [consentState, setConsentState] = useState<boolean | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(
        (await api.notificationsList({ status: status || undefined, kind: kind || undefined })).items,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคิวแจ้งเตือนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry(id: string) {
    if (busyId) return;
    setBusyId(id);
    setRowError(null);
    setRowNotice(null);
    try {
      await api.notificationRetry(id, "สั่งส่งซ้ำจากหน้าจัดการแจ้งเตือน");
      setRowNotice("รับคำสั่งส่งซ้ำแล้ว");
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "สั่งส่งซ้ำไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function runOutbox() {
    if (running) return;
    setRunning("outbox");
    setRowError(null);
    setRowNotice(null);
    try {
      const { result, message } = await api.notificationsRunOutbox(50);
      setRowNotice(
        `${message} (ข้าม ${result.skipped} · รอส่งซ้ำ ${result.failed} · เลิกส่ง ${result.deadLetter})`,
      );
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "ส่งคิวค้างไม่สำเร็จ");
    } finally {
      setRunning(null);
    }
  }

  async function runReminders() {
    if (running) return;
    setRunning("reminders");
    setRowError(null);
    setRowNotice(null);
    try {
      const { message } = await api.notificationsRunReminders();
      setRowNotice(message);
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "กวาดเตือนไม่สำเร็จ");
    } finally {
      setRunning(null);
    }
  }

  async function checkConsent() {
    const id = consentId.trim();
    if (!id || consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    setConsentState(null);
    try {
      setConsentState((await api.notificationConsentGet(id)).enabled);
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : "ตรวจ consent ไม่สำเร็จ");
    } finally {
      setConsentBusy(false);
    }
  }

  async function setConsent(enabled: boolean) {
    const id = consentId.trim();
    if (!id || consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      const out = await api.notificationConsentSet(id, enabled);
      setConsentState(out.enabled);
      setRowNotice(out.message);
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : "ตั้งค่า consent ไม่สำเร็จ");
    } finally {
      setConsentBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="แจ้งเตือน LINE"
        description="คิวส่งข้อความออก (outbox) — ส่งไม่สำเร็จจะลองซ้ำอัตโนมัติ ครบกำหนดแล้วย้ายเป็นส่งไม่สำเร็จ ต้องสั่งส่งซ้ำด้วยมือ"
        actions={
          <>
            <button
              type="button"
              onClick={() => void runOutbox()}
              disabled={running !== null}
              aria-busy={running === "outbox"}
              className={primaryButtonClass}
            >
              {running === "outbox" ? "กำลังส่ง…" : "ส่งคิวค้างตอนนี้"}
            </button>
            <button
              type="button"
              onClick={() => void runReminders()}
              disabled={running !== null}
              aria-busy={running === "reminders"}
              className={secondaryButtonClass}
            >
              {running === "reminders" ? "กำลังกวาด…" : "กวาดเตือน 30 นาที"}
            </button>
          </>
        }
      />

      {rowError ? (
        <Alert tone="error" role="alert">
          {rowError}
        </Alert>
      ) : null}
      {rowNotice ? (
        <Alert tone="success" role="status">
          {rowNotice}
        </Alert>
      ) : null}

      <Panel label="ตัวกรองคิวแจ้งเตือน">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-700">สถานะ</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as NotificationStatus | "")}
              className={inputClass}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s || "all"} value={s}>
                  {s ? NOTIFICATION_STATUS_LABELS[s] : "ทุกสถานะ"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-700">ชนิดข้อความ</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as NotificationKind | "")}
              className={inputClass}
            >
              {KIND_FILTERS.map((k) => (
                <option key={k || "all"} value={k}>
                  {k ? NOTIFICATION_KIND_LABELS[k] : "ทุกชนิด"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
              {loading ? "กำลังโหลด…" : "ค้นหา"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel label="รายการแจ้งเตือน">
        {loading ? (
          <Skeleton label="กำลังโหลดคิวแจ้งเตือน…" lines={5} />
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
              ลองใหม่
            </button>
          </div>
        ) : items.length === 0 ? (
          <Alert tone="info" role="status">
            ยังไม่มีการแจ้งเตือนตามเงื่อนไขนี้ ข้อความใหม่จะเข้าคิวอัตโนมัติเมื่อมีการจอง ชำระเงิน งานคิว หรือคะแนน
          </Alert>
        ) : (
          <StaggerList className="space-y-3" label="รายการแจ้งเตือน" live>
            {items.map((n, index) => (
              <StaggerItem key={n.id} index={index} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(n.status)}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>
                  <Badge tone="neutral">{NOTIFICATION_KIND_LABELS[n.kind]}</Badge>
                  <span className="text-xs text-ink-500">
                    ลองแล้ว {n.attempts}/{n.maxAttempts} ครั้ง
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-line text-ink-900">{n.message}</p>
                <p className="mt-1 text-xs text-ink-500">คีย์กันซ้ำ {n.eventKey}</p>
                {n.lastError ? <p className="mt-1 text-xs text-red-700">สาเหตุ: {n.lastError}</p> : null}
                {n.nextRetryAt && (n.status === "pending" || n.status === "failed") ? (
                  <p className="mt-1 text-xs text-ink-500">ส่งซ้ำได้หลัง {n.nextRetryAt}</p>
                ) : null}
                {(n.status === "failed" || n.status === "dead_letter" || n.status === "skipped") && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => void retry(n.id)}
                      disabled={busyId === n.id}
                      aria-busy={busyId === n.id}
                      className={secondaryButtonClass}
                    >
                      {busyId === n.id ? "กำลังสั่ง…" : "ส่งซ้ำ"}
                    </button>
                  </div>
                )}
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </Panel>

      <Panel label="ตรวจ consent รับแจ้งเตือนของลูกค้า">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-sm font-semibold text-ink-700">รหัสลูกค้า</span>
            <input
              value={consentId}
              onChange={(e) => setConsentId(e.target.value)}
              placeholder="เช่น c-xxxx"
              inputMode="text"
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={() => void checkConsent()}
            disabled={consentBusy || !consentId.trim()}
            className={secondaryButtonClass}
          >
            {consentBusy ? "กำลังตรวจ…" : "ตรวจ"}
          </button>
          <button
            type="button"
            onClick={() => void setConsent(true)}
            disabled={consentBusy || !consentId.trim()}
            className={secondaryButtonClass}
          >
            เปิดรับ
          </button>
          <button
            type="button"
            onClick={() => void setConsent(false)}
            disabled={consentBusy || !consentId.trim()}
            className={secondaryButtonClass}
          >
            ปิดรับ
          </button>
        </div>
        {consentError ? (
          <div className="mt-3">
            <Alert tone="error" role="alert">
              {consentError}
            </Alert>
          </div>
        ) : null}
        {consentState !== null && !consentError ? (
          <div className="mt-3">
            <Alert tone="info" role="status">
              ลูกค้า {consentId.trim()} {consentState ? "เปิดรับแจ้งเตือนอยู่" : "ปิดรับแจ้งเตือนอยู่"}
            </Alert>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
