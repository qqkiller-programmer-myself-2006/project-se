import { useEffect, useState } from "react";
import {
  api,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type NotificationItem,
  type NotificationStatus,
} from "../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  Spinner,
  secondaryButtonClass,
} from "../components/ui";

function statusTone(s: NotificationStatus): "brand" | "success" | "danger" | "neutral" {
  if (s === "sent") return "success";
  if (s === "failed" || s === "dead_letter") return "danger";
  if (s === "skipped") return "neutral";
  return "brand";
}

/**
 * หน้าแจ้งเตือนของฉัน (Ticket 12 — web fallback สำหรับลูกค้า):
 * เมื่อส่ง LINE ไม่สำเร็จ (หรือยังไม่เชื่อม LINE) ลูกค้ายังอ่านข้อความเดียวกันในเว็บได้
 * พร้อมปุ่มเปิด/ปิดรับแจ้งเตือนของตนเอง
 */
export default function MyNotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [consentEnabled, setConsentEnabled] = useState(true);
  const [lineLinked, setLineLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const out = await api.myNotifications(50);
      setItems(out.items);
      setConsentEnabled(out.consentEnabled);
      setLineLinked(out.lineLinked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดการแจ้งเตือนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    setNotice(null);
    setError(null);
    try {
      const out = await api.myNotificationConsent(!consentEnabled);
      setConsentEnabled(out.enabled);
      setNotice(out.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนการตั้งค่าไม่สำเร็จ");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="การแจ้งเตือนของฉัน"
        description="ข้อความเดียวกับที่ร้านส่งผ่าน LINE — อ่านในเว็บได้เสมอแม้ LINE ส่งไม่ถึง"
        actions={
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={toggling || loading}
            aria-busy={toggling}
            aria-pressed={consentEnabled}
            className={secondaryButtonClass}
          >
            {toggling ? "กำลังบันทึก…" : consentEnabled ? "ปิดรับแจ้งเตือน LINE" : "เปิดรับแจ้งเตือน LINE"}
          </button>
        }
      />

      {notice ? (
        <Alert tone="success" role="status">
          {notice}
        </Alert>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3" aria-live="polite">
          {!lineLinked ? (
            <Alert tone="info" role="status">
              บัญชีนี้ยังไม่เชื่อม LINE — ข้อความด้านล่างอ่านในเว็บแทนได้ หากต้องการรับผ่าน LINE กรุณาเชื่อม LINE ในหน้าโปรไฟล์
            </Alert>
          ) : null}
          {!consentEnabled ? (
            <Alert tone="info" role="status">
              คุณปิดรับแจ้งเตือนผ่าน LINE อยู่ — ข้อความใหม่จะเก็บไว้ให้อ่านในหน้านี้เท่านั้น
            </Alert>
          ) : null}
        </div>
      ) : null}

      <Panel label="ข้อความแจ้งเตือน">
        {loading ? (
          <Spinner label="กำลังโหลดการแจ้งเตือน…" />
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
            ยังไม่มีการแจ้งเตือนสำหรับบัญชีนี้ เมื่อมีการจอง การชำระเงิน งานคิว หรือคะแนน ข้อความจะปรากฏที่นี่
          </Alert>
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {items.map((n) => (
              <li key={n.id} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(n.status)}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>
                  <Badge tone="neutral">{NOTIFICATION_KIND_LABELS[n.kind]}</Badge>
                </div>
                <p className="mt-2 text-sm whitespace-pre-line text-ink-900">{n.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
