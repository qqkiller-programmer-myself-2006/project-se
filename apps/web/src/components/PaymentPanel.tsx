import { useEffect, useState } from "react";
import {
  api,
  ORDER_PAYMENT_STATE_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderDetail,
  type OrderPaymentState,
  type Payment,
  type PaymentMethod,
  type Receipt,
} from "../lib/api";
import { Alert, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";
import { PaymentStateBadge, ReceiptCard } from "./ReceiptCard";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/**
 * แผงชำระเงินฝั่งลูกค้า (Ticket 08):
 * - สร้างคำขอชำระเงินสด/พร้อมเพย์ (idempotency ต่อการกดหนึ่งครั้ง)
 * - พร้อมเพย์ fake: แสดง QR payload + ช่องกรอก slip
 * - แสดงสถานะรอตรวจสอบ/ไม่สำเร็จ/หมดอายุ + ใบเสร็จเมื่อสำเร็จ
 */
export function PaymentPanel({
  order,
  phone,
  initialPayment,
  initialState,
  onChanged,
}: {
  order: OrderDetail;
  /** เบอร์ Guest (สมาชิกไม่ต้องส่ง) */
  phone?: string;
  initialPayment: Payment | null;
  initialState: OrderPaymentState;
  onChanged?: () => void;
}) {
  const [payment, setPayment] = useState<Payment | null>(initialPayment);
  const [state, setState] = useState<OrderPaymentState>(initialState);
  const [qr, setQr] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("promptpay");
  const [received, setReceived] = useState("");
  const [slip, setSlip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // จ่ายสำเร็จแล้ว (เช่น รีโหลดหลัง parent ดึงสถานะใหม่) → โหลดใบเสร็จทันที
  useEffect(() => {
    if (initialPayment?.status === "paid" && !receipt) {
      api
        .receiptByPayment(initialPayment.id, phone)
        .then((r) => setReceipt(r.receipt))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ซิงก์ payment/state เมื่อ parent โหลดใหม่หลังสร้าง intent — ไม่ล้าง qr ที่ได้จาก provider
  useEffect(() => {
    if (initialPayment) {
      setPayment((prev) =>
        prev?.id === initialPayment.id && prev?.status === initialPayment.status ? prev : initialPayment,
      );
    }
    setState(initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayment, initialState]);

  // QR จำลองผูกกับ payment (รอดจากการ refresh/remount หลัง parent โหลดใหม่ — รูปแบบเดียวกับ fake provider)
  const qrToShow =
    qr ??
    (payment?.method === "promptpay" && payment?.status === "pending"
      ? `PROMPTPAY-FAKE:${payment.id}:${Math.round(payment.amount * 100) / 100}`
      : null);

  async function refresh() {
    try {
      const res = await api.orderPayment(order.id, phone);
      setPayment(res.payment);
      setState(res.paymentState);
      if (res.payment?.status === "paid") {
        setReceipt((await api.receiptByPayment(res.payment.id, phone).catch(() => null))?.receipt ?? null);
      }
    } catch {
      // เงียบไว้ — ผู้ใช้กดลองใหม่ได้
    } finally {
      onChanged?.();
    }
  }

  async function createIntent() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: { orderId: string; method: PaymentMethod; idempotencyKey: string; receivedAmount?: number | null; phone?: string } = {
        orderId: order.id,
        method,
        idempotencyKey: newIdempotencyKey(),
        phone,
      };
      if (method === "cash") {
        const n = Number(received);
        if (!Number.isFinite(n) || n <= 0) {
          setError("กรุณาระบุจำนวนเงินที่ลูกค้าถือมา (ตัวเลขมากกว่าศูนย์)");
          setBusy(false);
          return;
        }
        body.receivedAmount = n;
      }
      const res = await api.paymentCreate(body);
      setPayment(res.payment);
      setQr((prev) => res.qrPayload ?? prev);
      setState(res.payment.status === "pending" ? "pending_payment" : "paid");
      setNotice(
        res.payment.method === "cash"
          ? "สร้างคำขอเงินสดแล้ว กรุณาชำระที่เคาน์เตอร์แล้วให้พนักงานยืนยัน"
          : "สร้างคำขอพร้อมเพย์แล้ว สแกน QR ด้านล่างเพื่อชำระ (โหมดจำลอง)",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างคำขอชำระไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function submitSlip() {
    if (busy || !payment) return;
    if (!slip.trim()) {
      setError("กรุณากรอกเลขอ้างอิง slip");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.paymentSlip(payment.id, slip.trim(), phone);
      setPayment(res.payment);
      setReceipt(res.receipt);
      if (res.deduplicated) setNotice("ได้รับ slip นี้แล้ว (ไม่ประมวลผลซ้ำ)");
      else if (res.payment.status === "paid") setNotice("ชำระสำเร็จ ออกใบเสร็จแล้ว");
      else if (res.payment.status === "manual_review") setNotice("หลักฐานไม่ชัดเจน ร้านจะตรวจสอบด้วยมือแล้วแจ้งผล");
      else setNotice("บันทึกผลการตรวจ slip แล้ว");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่ง slip ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel label={`ชำระเงินคำสั่งซื้อ ${order.orderNumber}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink-900">
            ชำระเงิน · {order.orderNumber} · {fmtPrice(order.total)}
          </h2>
          <PaymentStateBadge state={state} />
        </div>

        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="info" role="status">
            {notice}
          </Alert>
        ) : null}

        {state === "paid" ? (
          receipt ? (
            <ReceiptCard receipt={receipt} />
          ) : (
            <p className="py-4 text-center">
              <Spinner label="กำลังโหลดใบเสร็จ…" />
            </p>
          )
        ) : state === "refunded" ? (
          <Alert tone="info" role="status">
            คำสั่งซื้อนี้คืนเงินแล้ว ยอดจองวัตถุดิบถูกคืนและคำสั่งซื้อถูกยกเลิก
          </Alert>
        ) : payment && (payment.status === "pending" || payment.status === "manual_review") ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-ink-700">
              วิธีชำระ: <strong>{PAYMENT_METHOD_LABELS[payment.method]}</strong> ·
              สถานะ: <strong>{ORDER_PAYMENT_STATE_LABELS[state]}</strong>
              {payment.method === "promptpay" ? (
                <> · หมดอายุ {new Date(payment.expiresAt).toLocaleString("th-TH", { timeStyle: "short" })}</>
              ) : null}
            </p>
            {payment.method === "promptpay" && qrToShow ? (
              <div className="rounded-xl border border-dashed border-brand-400 bg-brand-50 p-4 text-center">
                <p className="text-sm font-semibold text-brand-900">QR พร้อมเพย์ (โหมดจำลอง)</p>
                <p className="mt-1 break-all font-mono text-sm text-ink-900 tabular-nums" aria-label="รหัส QR พร้อมเพย์">
                  {qrToShow}
                </p>
                <p className="mt-1 text-xs text-ink-600">ยอด {fmtPrice(payment.amount)} · แสดงให้พนักงานดูหรือใช้ slip จำลองด้านล่าง</p>
              </div>
            ) : null}
            {payment.method === "promptpay" ? (
              <div className="space-y-2">
                <label htmlFor={`slip-${payment.id}`} className="block text-sm font-semibold text-ink-800">
                  เลขอ้างอิง slip (จำลอง: ขึ้นต้น VALID- คือผ่าน, AMBIGUOUS- คือรอตรวจสอบ)
                </label>
                <input
                  id={`slip-${payment.id}`}
                  className={inputClass}
                  value={slip}
                  onChange={(e) => setSlip(e.target.value)}
                  placeholder="เช่น VALID-1234"
                  autoComplete="off"
                />
                <button type="button" onClick={() => void submitSlip()} disabled={busy} aria-busy={busy} className={primaryButtonClass}>
                  {busy ? "กำลังส่ง…" : "ส่ง slip"}
                </button>
              </div>
            ) : (
              <Alert tone="info" role="status">
                กรุณาชำระเงินสด {fmtPrice(payment.amount)}
                {payment.receivedAmount !== null ? ` (รับมา ${fmtPrice(payment.receivedAmount)} ทอน ${fmtPrice(payment.changeAmount)})` : ""} ที่เคาน์เตอร์
              </Alert>
            )}
            <button type="button" onClick={() => void refresh()} disabled={busy} className={secondaryButtonClass}>
              ตรวจผลล่าสุด
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {state === "failed" || state === "expired" ? (
              <Alert tone="error" role="alert">
                {state === "expired" ? "คำขอชำระหมดอายุแล้ว กรุณาสร้างคำขอใหม่" : "การชำระครั้งก่อนไม่สำเร็จ สร้างคำขอใหม่ได้ด้านล่าง"}
              </Alert>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink-800">เลือกวิธีชำระเงิน</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="วิธีชำระเงิน">
                {(["promptpay", "cash"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                    className={`inline-flex min-h-[44px] items-center rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                      method === m
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-ink-300 bg-white text-ink-800 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </fieldset>
            {method === "cash" ? (
              <div>
                <label htmlFor={`received-${order.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                  จำนวนเงินที่ลูกค้าถือมา (บาท)
                </label>
                <input
                  id={`received-${order.id}`}
                  className={inputClass}
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  inputMode="decimal"
                  placeholder={`เช่น ${order.total}`}
                />
              </div>
            ) : null}
            <button type="button" onClick={() => void createIntent()} disabled={busy} aria-busy={busy} className={primaryButtonClass}>
              {busy ? "กำลังสร้างคำขอ…" : `สร้างคำขอชำระ ${fmtPrice(order.total)}`}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
