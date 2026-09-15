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
import { ConnectionBanner, DemoBadge } from "../components/demo";
import { Icon } from "../components/icons";
import { DEMO_NOTIFICATIONS, isOfflineError } from "../lib/demo";

function statusTone(s: NotificationStatus): "brand" | "success" | "danger" | "neutral" {
  if (s === "sent") return "success";
  if (s === "failed" || s === "dead_letter") return "danger";
  if (s === "skipped") return "neutral";
  return "brand";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [demo, setDemo] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setDemo(false);
    try {
      const out = await api.myNotifications(50);
      setItems(out.items);
      setConsentEnabled(out.consentEnabled);
      setLineLinked(out.lineLinked);
    } catch (err) {
      if (isOfflineError(err)) {
        setItems(DEMO_NOTIFICATIONS);
        setConsentEnabled(true);
        setLineLinked(false);
        setDemo(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "โหลดการแจ้งเตือนไม่สำเร็จ");
      }
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
      if (isOfflineError(err)) {
        setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — เปลี่ยนการตั้งค่าไม่ได้ กรุณาเชื่อมต่อเน็ตแล้วลองใหม่");
      } else {
        setError(err instanceof Error ? err.message : "เปลี่ยนการตั้งค่าไม่สำเร็จ");
      }
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <a href="#notifications-main" className="ui-skip-link">
        ข้ามไปยังการแจ้งเตือน
      </a>
      <PageHeader
        title="การแจ้งเตือนของฉัน"
        description="ข้อความเดียวกับที่ร้านส่งผ่าน LINE — อ่านในเว็บได้เสมอแม้ LINE ส่งไม่ถึง"
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {demo ? <DemoBadge /> : null}
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={toggling || loading || demo}
              aria-busy={toggling}
              aria-pressed={consentEnabled}
              aria-label={demo ? "เปลี่ยนการตั้งค่าไม่ได้ในโหมดสาธิต" : undefined}
              title={demo ? "เชื่อมต่อเซิร์ฟเวอร์ก่อนจึงเปลี่ยนการตั้งค่าได้" : undefined}
              className={secondaryButtonClass}
            >
              <Icon name="bell" size={18} />
              {toggling ? "กำลังบันทึก…" : consentEnabled ? "ปิดรับแจ้งเตือน LINE" : "เปิดรับแจ้งเตือน LINE"}
            </button>
          </span>
        }
      />

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      <main id="notifications-main" aria-label="การแจ้งเตือนของฉัน" className="space-y-4">

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
              <li key={n.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(n.status)}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>
                  <Badge tone="neutral">{NOTIFICATION_KIND_LABELS[n.kind]}</Badge>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-500">
                    <Icon name="clock" size={14} />
                    {fmtTime(n.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-line text-ink-900">{n.message}</p>
                {demo ? (
                  <p className="mt-1 text-xs text-ink-500">ข้อมูลตัวอย่าง — เชื่อมต่อเซิร์ฟเวอร์เพื่อดูข้อความจริง</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      </main>
    </div>
  );
}
