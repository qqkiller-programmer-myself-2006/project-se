import { Link } from "react-router-dom";
import { ORDER_SERVICE_LABELS, ORDER_STATUS_LABELS, type OrderDetail } from "../lib/api";
import { Badge } from "./ui";

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function statusTone(status: OrderDetail["status"]): "brand" | "success" | "danger" {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  return "brand";
}

/** การ์ดแสดงคำสั่งซื้อพร้อมรายการย่อย (ใช้ร่วมกันทั้งหน้าลูกค้าและหลังร้าน) */
export function OrderCard({
  order,
  showOwner = false,
  payTo,
}: {
  order: OrderDetail;
  showOwner?: boolean;
  /** ลิงก์ไปหน้าชำระเงิน (แสดงปุ่มเมื่อคำสั่งซื้อยังรอชำระ) */
  payTo?: string;
}) {
  return (
    <article aria-label={`คำสั่งซื้อ ${order.orderNumber}`} className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink-900">{order.orderNumber}</p>
          <p className="text-sm text-ink-600">
            {ORDER_SERVICE_LABELS[order.serviceType]}
            {order.scheduledAt ? ` · นัดรับ ${fmtDateTime(order.scheduledAt)}` : null}
            {" · "}สั่งเมื่อ {fmtDateTime(order.createdAt)}
          </p>
          {showOwner ? (
            <p className="mt-0.5 text-sm text-ink-600">
              {order.customerId ? "สมาชิก" : `Guest: ${order.guestName} ${order.guestPhone}`}
            </p>
          ) : null}
        </div>
        <Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</Badge>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-semibold text-ink-900">
                {i.quantity} × {i.menuName}
              </span>
              {i.note ? <span className="block text-ink-600">หมายเหตุ: {i.note}</span> : null}
            </span>
            <span className="shrink-0 font-semibold text-ink-900">{fmtPrice(i.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-base font-bold text-ink-900">ยอดรวม {fmtPrice(order.total)}</p>
      {payTo && order.status === "pending_payment" ? (
        <p className="mt-2 text-right">
          <Link
            to={payTo}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            ชำระเงิน
          </Link>
        </p>
      ) : null}
    </article>
  );
}
