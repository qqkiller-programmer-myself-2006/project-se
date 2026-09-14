import type { ReservationDetail } from "../lib/api";
import { RESERVATION_STATUS_LABELS } from "../lib/api";
import { Badge } from "./ui";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function statusTone(status: ReservationDetail["status"]): "brand" | "success" | "danger" | "active" | "inactive" | "neutral" {
  if (status === "completed" || status === "confirmed") return "success";
  if (status === "cancelled" || status === "no_show") return "danger";
  if (status === "seated") return "active";
  return "brand";
}

/** การ์ดแสดงการจองพร้อมรหัส โต๊ะ เวลานัด และ QR สำหรับเช็กอิน (ใช้ร่วมกันทั้งลูกค้าและหลังร้าน) */
export function ReservationCard({ reservation, showQr = false }: { reservation: ReservationDetail; showQr?: boolean }) {
  return (
    <article aria-label={`การจอง ${reservation.code}`} className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink-900">{reservation.code}</p>
          <p className="text-sm text-ink-600">
            โต๊ะ {reservation.tableName} · {reservation.partySize} คน · นัด {fmtDateTime(reservation.reservedAt)}
          </p>
          {reservation.note ? <p className="mt-0.5 text-sm text-ink-600">หมายเหตุ: {reservation.note}</p> : null}
        </div>
        <Badge tone={statusTone(reservation.status)}>{RESERVATION_STATUS_LABELS[reservation.status]}</Badge>
      </div>
      {showQr && reservation.qr ? (
        <p className="mt-2 rounded-lg bg-ink-50 px-2.5 py-1.5 font-mono text-xs break-all text-ink-700">
          QR เช็กอิน: {reservation.qr}
        </p>
      ) : null}
    </article>
  );
}
