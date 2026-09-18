import { useEffect, useState } from "react";
import {
  RESERVATION_STATUS_LABELS,
  api,
  type AuditItem,
  type ReservationDetail,
  type ReservationStatus,
} from "../../lib/api";
import { ReservationCard } from "../../components/ReservationCard";
import { Alert, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";

const STATUS_FILTERS: ("" | ReservationStatus)[] = ["", "pending", "confirmed", "seated", "completed", "cancelled", "no_show"];
const CHANGEABLE: ReservationStatus[] = ["confirmed", "cancelled", "no_show"];

/**
 * หน้าจัดการการจองหลังร้าน (Ticket 06 — Owner/Admin เท่านั้น):
 * - ค้นหาด้วยรหัส/ชื่อ/เบอร์/โต๊ะ + กรองสถานะ
 * - ดูรายละเอียด (พร้อม QR) และเปลี่ยนสถานะพร้อมเหตุผล (มี audit ก่อน/หลัง)
 */
export default function AdminReservationsPage() {
  const [items, setItems] = useState<ReservationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ReservationStatus>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<ReservationStatus>("confirmed");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [list, audits] = await Promise.all([
        api.adminReservations(q.trim(), status || undefined),
        api.reservationAudit().catch(() => ({ items: [] as AuditItem[] })),
      ]);
      setItems(list.reservations);
      setAudit(audits.items);
      if (selectedId && !list.reservations.some((r) => r.id === selectedId)) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดการจองไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = selectedId ? (items.find((r) => r.id === selectedId) ?? null) : null;

  async function changeStatus() {
    if (!selected || saving) return;
    setSaveError(null);
    setSaveOk(null);
    if (!reason.trim()) {
      setSaveError("กรุณาระบุเหตุผลในการเปลี่ยนสถานะ");
      return;
    }
    try {
      setSaving(true);
      const res = await api.adminReservationSetStatus(selected.id, newStatus, reason.trim());
      setItems((list) => list.map((r) => (r.id === res.reservation.id ? res.reservation : r)));
      setSaveOk(`เปลี่ยนสถานะ ${res.reservation.code} เป็น${RESERVATION_STATUS_LABELS[res.reservation.status]}แล้ว`);
      setReason("");
      setAudit((await api.reservationAudit().catch(() => ({ items: [] as AuditItem[] }))).items);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">จัดการการจอง</h1>
          <p className="mt-1 text-sm text-ink-600">ค้นหา ตรวจรายละเอียด และเปลี่ยนสถานะพร้อมเหตุผล (บันทึกประวัติทุกครั้ง)</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          {loading ? "กำลังโหลด…" : "โหลดใหม่"}
        </button>
      </header>

      <Panel label="ค้นหาการจอง">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <div>
            <label htmlFor="res-search" className="mb-1 block text-sm font-semibold text-ink-800">
              ค้นหารหัสจอง ชื่อ เบอร์โทร หรือโต๊ะ
            </label>
            <input
              id="res-search"
              className={inputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              placeholder="เช่น RSV-20260914 หรือ 0812345678"
            />
          </div>
          <div>
            <label htmlFor="res-status" className="mb-1 block text-sm font-semibold text-ink-800">
              สถานะ
            </label>
            <select
              id="res-status"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | ReservationStatus)}
            >
              <option value="">ทั้งหมด</option>
              {(Object.keys(RESERVATION_STATUS_LABELS) as ReservationStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RESERVATION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => void load()} disabled={loading} className={primaryButtonClass}>
              ค้นหา
            </button>
          </div>
        </div>
      </Panel>

      {loading ? (
        <p className="py-10 text-center">
          <Spinner label="กำลังโหลดการจอง…" />
        </p>
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
        <div className="rounded-xl border border-dashed border-ink-300 bg-white px-4 py-10 text-center">
          <p className="font-semibold text-ink-800">ยังไม่มีการจองตามเงื่อนไข</p>
          <p className="mt-1 text-sm text-ink-600">ลองเปลี่ยนคำค้นหรือตัวกรองสถานะ แล้วค้นใหม่อีกครั้ง</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3" role="list" aria-label="รายการการจอง">
            <p role="status" className="text-sm text-ink-600">
              พบ {items.length} การจอง
            </p>
            {items.map((r) => (
              <div key={r.id} role="listitem" className="space-y-2">
                <ReservationCard reservation={r} />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(r.id);
                    setSaveError(null);
                    setSaveOk(null);
                    setNewStatus(r.status === "pending" ? "confirmed" : "confirmed");
                  }}
                  aria-pressed={selectedId === r.id}
                  className={selectedId === r.id ? primaryButtonClass : secondaryButtonClass}
                >
                  {selectedId === r.id ? "กำลังดูรายการนี้" : `ดูและจัดการ ${r.code}`}
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {selected ? (
              <Panel label={`จัดการ ${selected.code}`}>
                <div className="space-y-3">
                  <h2 className="pa-display text-base text-ink-900">เปลี่ยนสถานะ {selected.code}</h2>
                  <ReservationCard reservation={selected} showQr />
                  {selected.status !== "pending" && selected.status !== "confirmed" ? (
                    <Alert tone="info" role="status">
                      การจองนี้พ้นสถานะที่เปลี่ยนผ่านช่องทางนี้ได้แล้ว (เช็กอิน/จบงาน/ยกเลิกไปแล้ว)
                    </Alert>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="new-res-status" className="mb-1 block text-sm font-semibold text-ink-800">
                          สถานะใหม่
                        </label>
                        <select
                          id="new-res-status"
                          className={inputClass}
                          value={newStatus}
                          onChange={(e) => setNewStatus(e.target.value as ReservationStatus)}
                        >
                          {CHANGEABLE.map((s) => (
                            <option key={s} value={s}>
                              {RESERVATION_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="res-reason" className="mb-1 block text-sm font-semibold text-ink-800">
                          เหตุผล (บังคับ เก็บในประวัติ)
                        </label>
                        <textarea
                          id="res-reason"
                          className={`${inputClass} min-h-[88px]`}
                          value={reason}
                          maxLength={500}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="เช่น โทรยืนยันกับลูกค้าแล้ว"
                        />
                      </div>
                      {saveError ? (
                        <Alert tone="error" role="alert">
                          {saveError}
                        </Alert>
                      ) : null}
                      {saveOk ? (
                        <Alert tone="success" role="status">
                          {saveOk}
                        </Alert>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void changeStatus()}
                        disabled={saving}
                        aria-busy={saving}
                        className={primaryButtonClass}
                      >
                        {saving ? "กำลังบันทึก…" : "บันทึกสถานะ"}
                      </button>
                    </>
                  )}
                </div>
              </Panel>
            ) : (
              <Panel label="เลือกการจอง">
                <p className="text-sm text-ink-600">เลือกรายการด้านซ้ายเพื่อดูรายละเอียดและเปลี่ยนสถานะ</p>
              </Panel>
            )}

            <Panel label="ประวัติการจองล่าสุด">
              <div className="space-y-2">
                <h2 className="pa-display text-base text-ink-900">ประวัติล่าสุด</h2>
                {audit.length === 0 ? (
                  <p className="text-sm text-ink-600">ยังไม่มีประวัติการจอง</p>
                ) : (
                  <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                    {audit.slice(0, 20).map((a) => (
                      <li key={a.id} className="rounded-lg border border-ink-100 px-2.5 py-1.5">
                        <span className="font-semibold">{a.action}</span>
                        {a.detail ? <span className="block text-ink-600">{a.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
