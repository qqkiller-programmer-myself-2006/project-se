import { useEffect, useState } from "react";
import { api, type PublicQueueSnapshot, type PublicQueueStatus } from "../../lib/api";
import { Alert, Badge } from "../../components/ui";
import { Skeleton } from "../../components/motion";

/** รีเฟรชคิวรวมทุก 15 วินาที (หยุดเมื่อแท็บถูกซ่อน) */
const REFRESH_MS = 15_000;

const STATUS_LABELS: Record<PublicQueueStatus, string> = {
  waiting: "รอทำ",
  preparing: "กำลังทำ",
  ready: "พร้อมรับ",
};

const STATUS_TONES: Record<PublicQueueStatus, "brand" | "active" | "success"> = {
  waiting: "active",
  preparing: "brand",
  ready: "success",
};

function aheadText(status: PublicQueueStatus, ahead: number): string {
  if (status === "ready") return "พร้อมรับแล้ว";
  if (ahead === 0) return "คิวถัดไป";
  return `มี ${ahead} คิวก่อนหน้า`;
}

function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * คิวรวมของร้าน (Issue #43): ทุกคนดูได้โดยไม่ต้องล็อกอิน
 * แสดงเฉพาะรหัสย่อท้ายเลขคำสั่งซื้อ + สถานะ + จำนวนคิวก่อนหน้า (ครัวและเครื่องดื่มรวมกัน)
 * — ไม่มีชื่อ เบอร์โทร หรือรายการอาหาร
 */
export default function PublicQueueBoard() {
  const [snapshot, setSnapshot] = useState<PublicQueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const next = await api.queuePublic();
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "โหลดคิวรวมไม่สำเร็จ");
      }
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!snapshot && !error) return <Skeleton label="กำลังโหลดคิวรวม…" lines={3} />;

  return (
    <section className="space-y-3" aria-label="คิวทั้งหมดของร้าน">
      {error ? (
        <Alert tone="error" role="alert">
          {error}
          {snapshot ? " (กำลังแสดงข้อมูลล่าสุดที่โหลดได้)" : ""}
        </Alert>
      ) : null}

      {snapshot ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="สรุปจำนวนคิว">
            {(Object.keys(STATUS_LABELS) as PublicQueueStatus[]).map((status) => (
              <Badge key={status} tone={STATUS_TONES[status]}>
                {STATUS_LABELS[status]} {snapshot.counts[status]}
              </Badge>
            ))}
          </div>

          {snapshot.entries.length === 0 ? (
            <p className="text-sm text-ink-600">ขณะนี้ไม่มีคิวค้างอยู่</p>
          ) : (
            <ol className="space-y-2">
              {snapshot.entries.map((entry) => (
                <li key={entry.ref} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 p-3">
                  <span className="text-sm font-bold text-ink-900">#{entry.ref}</span>
                  <Badge tone={STATUS_TONES[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
                  <span className="text-sm text-ink-700">{aheadText(entry.status, entry.ahead)}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="text-xs text-ink-500">
            แสดงเฉพาะรหัสท้ายเลขคำสั่งซื้อ ไม่แสดงชื่อ เบอร์โทร หรือรายการอาหาร · รีเฟรชอัตโนมัติทุก 15 วินาที
            {fmtUpdated(snapshot.updatedAt) ? ` · อัปเดต ${fmtUpdated(snapshot.updatedAt)}` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
