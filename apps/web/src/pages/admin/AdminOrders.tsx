import { useEffect, useState } from "react";
import { ORDER_STATUS_LABELS, api, type AuditItem, type OrderDetail, type OrderStatus } from "../../lib/api";
import { OrderCard } from "../../components/OrderCard";
import { Alert, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "../../components/ui";

/**
 * หน้าจัดการคำสั่งซื้อหลังร้าน (Ticket 05 — Owner/Admin เท่านั้น):
 * - ค้นหาด้วยเลข/ชื่อ/เบอร์ + กรองสถานะ
 * - ดูรายละเอียดและเปลี่ยนสถานะพร้อมเหตุผล (มี audit ก่อน/หลัง)
 * - kitchen/drink/guest เรียก API ถูกปฏิเสธฝั่ง server (403)
 */
const STATUS_FILTERS: ("" | OrderStatus)[] = ["", "pending_payment", "completed", "cancelled"];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | OrderStatus>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<OrderStatus>("completed");
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
        api.ordersList(q.trim(), status || undefined),
        api.orderAudit().catch(() => ({ items: [] as AuditItem[] })),
      ]);
      setOrders(list.orders);
      setAudit(audits.items);
      if (selectedId && !list.orders.some((o) => o.id === selectedId)) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคำสั่งซื้อไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = selectedId ? (orders.find((o) => o.id === selectedId) ?? null) : null;

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
      const res = await api.orderSetStatus(selected.id, newStatus, reason.trim());
      setOrders((list) => list.map((o) => (o.id === res.order.id ? res.order : o)));
      setSaveOk(`เปลี่ยนสถานะ ${res.order.orderNumber} เป็น${ORDER_STATUS_LABELS[res.order.status]}แล้ว`);
      setReason("");
      setAudit((await api.orderAudit().catch(() => ({ items: [] as AuditItem[] }))).items);
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
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">จัดการคำสั่งซื้อ</h1>
          <p className="mt-1 text-sm text-ink-600">ค้นหา ตรวจรายละเอียด และปิดงานพร้อมเหตุผล (บันทึกประวัติทุกครั้ง)</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          {loading ? "กำลังโหลด…" : "โหลดใหม่"}
        </button>
      </header>

      <Panel label="ค้นหาคำสั่งซื้อ">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <div>
            <label htmlFor="order-search" className="mb-1 block text-sm font-semibold text-ink-800">
              ค้นหาเลขคำสั่งซื้อ ชื่อ หรือเบอร์โทร
            </label>
            <input
              id="order-search"
              className={inputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              placeholder="เช่น ORD-20260914 หรือ 0812345678"
            />
          </div>
          <div>
            <label htmlFor="order-status" className="mb-1 block text-sm font-semibold text-ink-800">
              สถานะ
            </label>
            <select
              id="order-status"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | OrderStatus)}
            >
              <option value="">ทั้งหมด</option>
              {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
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
          <Spinner label="กำลังโหลดคำสั่งซื้อ…" />
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
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 bg-white px-4 py-10 text-center">
          <p className="font-semibold text-ink-800">ยังไม่มีคำสั่งซื้อตามเงื่อนไข</p>
          <p className="mt-1 text-sm text-ink-600">ลองเปลี่ยนคำค้นหรือตัวกรองสถานะ แล้วค้นใหม่อีกครั้ง</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3" role="list" aria-label="รายการคำสั่งซื้อ">
            <p role="status" className="text-sm text-ink-600">
              พบ {orders.length} คำสั่งซื้อ
            </p>
            {orders.map((o) => (
              <div key={o.id} role="listitem" className="space-y-2">
                <OrderCard order={o} showOwner />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(o.id);
                    setSaveError(null);
                    setSaveOk(null);
                    setNewStatus(o.status === "pending_payment" ? "completed" : o.status);
                  }}
                  aria-pressed={selectedId === o.id}
                  className={selectedId === o.id ? primaryButtonClass : secondaryButtonClass}
                >
                  {selectedId === o.id ? "กำลังดูรายการนี้" : `ดูและจัดการ ${o.orderNumber}`}
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {selected ? (
              <Panel label={`จัดการ ${selected.orderNumber}`}>
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-ink-900">เปลี่ยนสถานะ {selected.orderNumber}</h2>
                  {selected.status !== "pending_payment" ? (
                    <Alert tone="info" role="status">
                      คำสั่งซื้อนี้ปิดงานแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก
                    </Alert>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="new-status" className="mb-1 block text-sm font-semibold text-ink-800">
                          สถานะใหม่
                        </label>
                        <select
                          id="new-status"
                          className={inputClass}
                          value={newStatus}
                          onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                        >
                          {(STATUS_FILTERS.filter(Boolean) as OrderStatus[])
                            .filter((s) => s !== "pending_payment")
                            .map((s) => (
                              <option key={s} value={s}>
                                {ORDER_STATUS_LABELS[s]}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="status-reason" className="mb-1 block text-sm font-semibold text-ink-800">
                          เหตุผล (บังคับ เก็บในประวัติ)
                        </label>
                        <textarea
                          id="status-reason"
                          className={`${inputClass} min-h-[88px]`}
                          value={reason}
                          maxLength={500}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="เช่น ลูกค้าชำระเงินครบแล้ว ปิดงาน"
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
              <Panel label="เลือกคำสั่งซื้อ">
                <p className="text-sm text-ink-600">เลือกรายการด้านซ้ายเพื่อดูรายละเอียดและเปลี่ยนสถานะ</p>
              </Panel>
            )}

            <Panel label="ประวัติคำสั่งซื้อล่าสุด">
              <div className="space-y-2">
                <h2 className="text-base font-bold text-ink-900">ประวัติล่าสุด</h2>
                {audit.length === 0 ? (
                  <p className="text-sm text-ink-600">ยังไม่มีประวัติคำสั่งซื้อ</p>
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
