import { useEffect, useState } from "react";
import {
  api,
  ORDER_PAYMENT_STATE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderPaymentState,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type Receipt,
  type Refund,
} from "../../lib/api";
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
} from "../../components/ui";
import { ReceiptCard } from "../../components/ReceiptCard";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function statusTone(s: PaymentStatus): "brand" | "success" | "danger" | "neutral" {
  if (s === "paid") return "success";
  if (s === "failed" || s === "expired") return "danger";
  if (s === "refunded" || s === "cancelled") return "neutral";
  return "brand";
}

const STATUS_FILTERS: (PaymentStatus | "")[] = ["", "pending", "manual_review", "paid", "failed", "expired", "refunded"];
const METHOD_FILTERS: (PaymentMethod | "")[] = ["", "cash", "promptpay"];

/**
 * หน้าจัดการชำระเงินหลังร้าน (Ticket 08 — Owner/Admin):
 * - ค้นหาด้วยเลขคำสั่งซื้อ/เลขใบเสร็จ + กรองสถานะ/วิธีชำระ (FR-PAY-004)
 * - ยืนยันเงินสด ตัดสินรอตรวจสอบ หมดอายุ intent อนุมัติคืนเงิน (Owner) ดูใบเสร็จ
 */
export default function AdminPaymentsPage({ isOwner }: { isOwner: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [items, setItems] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [tendered, setTendered] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [refundsOpen, setRefundsOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(
        (await api.paymentsList(q.trim(), status || undefined, method || undefined)).payments,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการชำระไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function confirmCash(p: Payment) {
    const n = Number(tendered[p.id] ?? p.receivedAmount ?? p.amount);
    if (!Number.isFinite(n) || n <= 0) {
      setRowError("กรุณาระบุจำนวนเงินที่รับมาให้ถูกต้อง");
      return;
    }
    void run(p.id, () => api.paymentConfirmCash(p.id, n, reason[p.id]?.trim() || undefined), `รับเงินสด ${p.orderNumber} สำเร็จ ทอน ${fmtPrice(Math.max(0, n - p.amount))}`);
  }

  function resolve(p: Payment, decision: "paid" | "failed" | "cancelled") {
    const r = reason[p.id]?.trim();
    if (!r) {
      setRowError("กรุณาระบุเหตุผลก่อนตัดสินรายการรอตรวจสอบ");
      return;
    }
    const label = decision === "paid" ? "สำเร็จ" : decision === "failed" ? "ไม่สำเร็จ" : "ยกเลิก";
    void run(p.id, () => api.paymentResolve(p.id, decision, r), `ตัดสิน ${p.orderNumber} เป็น${label}แล้ว`);
  }

  function refund(p: Payment) {
    const r = reason[p.id]?.trim();
    if (!r) {
      setRowError("กรุณาระบุเหตุผลก่อนอนุมัติคืนเงิน");
      return;
    }
    void run(p.id, () => api.paymentRefund(p.id, r), `อนุมัติคืนเงิน ${p.orderNumber} แล้ว (คืนยอดจอง + ยกเลิกคำสั่งซื้อ)`);
  }

  async function showReceipt(p: Payment) {
    try {
      setReceipts((m) => ({ ...m }));
      const r = (await api.paymentGet(p.id)).receipt;
      if (r) setReceipts((m) => ({ ...m, [p.id]: r }));
      else setRowError("รายการนี้ยังไม่มีใบเสร็จ");
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "โหลดใบเสร็จไม่สำเร็จ");
    }
  }

  async function loadRefunds() {
    try {
      setRefunds((await api.refundsList()).refunds);
      setRefundsOpen(true);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "โหลดประวัติคืนเงินไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="การชำระเงิน"
        description="ยืนยันเงินสด ตรวจสอบพร้อมเพย์ ออกใบเสร็จ และอนุมัติคืนเงิน (Owner)"
      />

      {error ? (
        <div className="space-y-3">
          <Alert tone="error" role="alert">
            {error}
          </Alert>
          <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
            ลองใหม่
          </button>
        </div>
      ) : null}
      {rowError ? (
        <Alert tone="error" role="alert">
          {rowError}
        </Alert>
      ) : null}
      {rowNotice ? (
        <Alert tone="info" role="status">
          {rowNotice}
        </Alert>
      ) : null}

      <Panel label="ค้นหารายการชำระ">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div>
            <label htmlFor="pay-q" className="mb-1 block text-sm font-semibold text-ink-800">
              เลขคำสั่งซื้อ/เลขใบเสร็จ
            </label>
            <input
              id="pay-q"
              className={inputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="เช่น ORD-20260914-AB12 หรือ RCP-…"
            />
          </div>
          <div>
            <label htmlFor="pay-status" className="mb-1 block text-sm font-semibold text-ink-800">
              สถานะ
            </label>
            <select
              id="pay-status"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as PaymentStatus | "")}
            >
              <option value="">ทั้งหมด</option>
              {STATUS_FILTERS.filter((s) => s !== "").map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s as PaymentStatus]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pay-method" className="mb-1 block text-sm font-semibold text-ink-800">
              วิธีชำระ
            </label>
            <select
              id="pay-method"
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
            >
              <option value="">ทั้งหมด</option>
              {METHOD_FILTERS.filter((m) => m !== "").map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m as PaymentMethod]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={loading} aria-busy={loading} className={`${primaryButtonClass} self-end`}>
            {loading ? "กำลังค้นหา…" : "ค้นหา"}
          </button>
        </form>
      </Panel>

      {loading ? (
        <p className="py-10 text-center">
          <Spinner label="กำลังโหลดรายการชำระ…" />
        </p>
      ) : items.length === 0 ? (
        <Panel label="รายการว่าง">
          <div className="px-4 py-8 text-center">
            <p className="font-semibold text-ink-800">ยังไม่มีรายการชำระตามเงื่อนไข</p>
            <p className="mt-1 text-sm text-ink-600">คำขอชำระจะปรากฏที่นี่เมื่อลูกค้ากดชำระจากคำสั่งซื้อ</p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          <p role="status" className="text-sm text-ink-600">
            พบ {items.length} รายการ
          </p>
          {items.map((p) => (
            <Panel key={p.id} label={`ชำระ ${p.orderNumber}`}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink-900">
                      {p.orderNumber} · {fmtPrice(p.amount)} · {PAYMENT_METHOD_LABELS[p.method]}
                    </p>
                    <p className="text-sm text-ink-600">
                      สถานะคำสั่งซื้อ: {ORDER_PAYMENT_STATE_LABELS[paymentToState(p)]} ·
                      {p.receiptNumber ? ` ใบเสร็จ ${p.receiptNumber}` : " ยังไม่มีใบเสร็จ"}
                      {p.method === "cash" && p.receivedAmount !== null
                        ? ` · รับมา ${fmtPrice(p.receivedAmount)} ทอน ${fmtPrice(p.changeAmount)}`
                        : ""}
                    </p>
                  </div>
                  <Badge tone={statusTone(p.status)}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
                </div>

                {(p.status === "pending" || p.status === "manual_review") && p.method === "cash" ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <div>
                      <label htmlFor={`tendered-${p.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                        เงินที่รับมา (บาท)
                      </label>
                      <input
                        id={`tendered-${p.id}`}
                        className={inputClass}
                        value={tendered[p.id] ?? String(p.receivedAmount ?? p.amount)}
                        onChange={(e) => setTendered((m) => ({ ...m, [p.id]: e.target.value }))}
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <label htmlFor={`reason-cash-${p.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                        หมายเหตุ (ถ้ามี)
                      </label>
                      <input
                        id={`reason-cash-${p.id}`}
                        className={inputClass}
                        value={reason[p.id] ?? ""}
                        onChange={(e) => setReason((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="เช่น รับเงินหน้าร้าน"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => confirmCash(p)}
                      disabled={busyId === p.id}
                      aria-busy={busyId === p.id}
                      className={`${successButtonClass} self-end`}
                    >
                      {busyId === p.id ? "กำลังยืนยัน…" : "ยืนยันรับเงินสด"}
                    </button>
                  </div>
                ) : null}

                {p.status === "manual_review" ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <div>
                      <label htmlFor={`reason-review-${p.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                        เหตุผลตัดสิน (บังคับ)
                      </label>
                      <input
                        id={`reason-review-${p.id}`}
                        className={inputClass}
                        value={reason[p.id] ?? ""}
                        onChange={(e) => setReason((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="เช่น ตรวจ slip แล้ว ยอดตรง"
                      />
                    </div>
                    <button type="button" onClick={() => resolve(p, "paid")} disabled={busyId === p.id} className={`${successButtonClass} self-end`}>
                      อนุมัติสำเร็จ
                    </button>
                    <button type="button" onClick={() => resolve(p, "failed")} disabled={busyId === p.id} className={`${dangerButtonClass} self-end`}>
                      ไม่สำเร็จ
                    </button>
                    <button type="button" onClick={() => resolve(p, "cancelled")} disabled={busyId === p.id} className={`${secondaryButtonClass} self-end`}>
                      ยกเลิก
                    </button>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {p.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void run(p.id, () => api.paymentExpire(p.id), `ทำ ${p.orderNumber} หมดอายุแล้ว`)}
                      disabled={busyId === p.id}
                      className={secondaryButtonClass}
                    >
                      ทำหมดอายุ
                    </button>
                  ) : null}
                  {p.status === "paid" ? (
                    <button type="button" onClick={() => void showReceipt(p)} className={secondaryButtonClass}>
                      ดูใบเสร็จ
                    </button>
                  ) : null}
                  {p.status === "paid" && isOwner ? (
                    <span className="flex flex-1 flex-wrap items-end gap-2 sm:flex-nowrap">
                      <span className="min-w-40 flex-1">
                        <label htmlFor={`reason-refund-${p.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                          เหตุผลคืนเงิน (บังคับ)
                        </label>
                        <input
                          id={`reason-refund-${p.id}`}
                          className={inputClass}
                          value={reason[p.id] ?? ""}
                          onChange={(e) => setReason((m) => ({ ...m, [p.id]: e.target.value }))}
                          placeholder="เช่น ลูกค้ายกเลิกก่อนเริ่มทำ"
                        />
                      </span>
                      <button type="button" onClick={() => refund(p)} disabled={busyId === p.id} className={dangerButtonClass}>
                        อนุมัติคืนเงิน
                      </button>
                    </span>
                  ) : null}
                </div>

                {receipts[p.id] ? <ReceiptCard receipt={receipts[p.id]!} /> : null}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel label="ประวัติคืนเงิน">
        {!refundsOpen ? (
          <button type="button" onClick={() => void loadRefunds()} className={secondaryButtonClass}>
            ดูประวัติคืนเงิน
          </button>
        ) : refunds.length === 0 ? (
          <p className="text-sm text-ink-600">ยังไม่มีประวัติคืนเงิน</p>
        ) : (
          <ul className="space-y-2">
            {refunds.map((r) => (
              <li key={r.id} className="rounded-xl border border-ink-200 px-3 py-2 text-sm">
                <p className="font-semibold text-ink-900">
                  {r.orderNumber} · {fmtPrice(r.amount)}
                </p>
                <p className="text-ink-600">
                  เหตุผล: {r.reason} · อนุมัติโดย {r.approvedBy ?? "-"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function paymentToState(p: Payment): OrderPaymentState {
  if (p.status === "paid") return "paid";
  if (p.status === "manual_review") return "manual_review";
  if (p.status === "failed" || p.status === "cancelled") return "failed";
  if (p.status === "expired") return "expired";
  if (p.status === "refunded") return "refunded";
  return "pending_payment";
}
