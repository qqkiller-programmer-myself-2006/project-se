import { ORDER_PAYMENT_STATE_LABELS, PAYMENT_METHOD_LABELS, type Receipt } from "../lib/api";
import { Badge } from "./ui";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function stateTone(state: keyof typeof ORDER_PAYMENT_STATE_LABELS): "brand" | "success" | "danger" | "neutral" {
  if (state === "paid") return "success";
  if (state === "failed" || state === "expired") return "danger";
  if (state === "refunded") return "neutral";
  return "brand";
}

/**
 * ใบเสร็จอย่างง่าย (Ticket 08): หลักฐานการรับเงินของร้าน — เลขเอกสาร วันที่
 * รายการ ยอดรวม ช่องทางชำระ ชื่อร้าน (ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ)
 * ทรง "สลิปบิล" ด้วยเส้นประคั่นรายการตามภาษาร้านอาหาร
 */
export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <article aria-label={`ใบเสร็จ ${receipt.receiptNumber}`} className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="bg-ink-900 px-4 py-3 text-center">
        <p className="text-base font-bold text-white">{receipt.shopName}</p>
        <p className="text-xs font-medium text-ink-300">
          ใบเสร็จรับเงิน · <span>{receipt.receiptNumber}</span>
        </p>
      </div>
      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 text-ink-600">
          <span>คำสั่งซื้อ {receipt.orderNumber}</span>
          <span>{fmtDateTime(receipt.paidAt)}</span>
        </div>
        <ul className="space-y-1.5 border-y border-dashed border-ink-300 py-2.5" aria-label="รายการในใบเสร็จ">
          {receipt.items.map((i, idx) => (
            <li key={`${i.menuName}-${idx}`} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="font-semibold text-ink-900">
                  {i.quantity} × {i.menuName}
                </span>
                <span className="block text-xs text-ink-500 tabular-nums">
                  {i.unitPrice.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท/หน่วย
                </span>
              </span>
              <span className="shrink-0 font-semibold text-ink-900 tabular-nums">{fmtPrice(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-600">ช่องทางชำระ</dt>
            <dd className="font-semibold text-ink-900">{PAYMENT_METHOD_LABELS[receipt.method]}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-600">ยอดรวม</dt>
            <dd className="font-bold text-ink-900 tabular-nums">{fmtPrice(receipt.amount)}</dd>
          </div>
          {receipt.receivedAmount !== null ? (
            <div className="flex justify-between gap-2">
              <dt className="text-ink-600">รับมา</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{fmtPrice(receipt.receivedAmount)}</dd>
            </div>
          ) : null}
          {receipt.changeAmount > 0 ? (
            <div className="flex justify-between gap-2">
              <dt className="text-ink-600">เงินทอน</dt>
              <dd className="font-bold text-green-800 tabular-nums">{fmtPrice(receipt.changeAmount)}</dd>
            </div>
          ) : null}
        </dl>
        <p role="status" className="text-center text-xs text-ink-500">
          {ORDER_PAYMENT_STATE_LABELS.paid} · ขอบคุณที่ใช้บริการร้านป้าอ้อ
        </p>
      </div>
    </article>
  );
}

export function PaymentStateBadge({ state }: { state: keyof typeof ORDER_PAYMENT_STATE_LABELS }) {
  return <Badge tone={stateTone(state)}>{ORDER_PAYMENT_STATE_LABELS[state]}</Badge>;
}
