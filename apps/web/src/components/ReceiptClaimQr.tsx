import { Link } from "react-router-dom";
import type { ReceiptClaimQr } from "../lib/api";
import { TableQrCode } from "./TableQrCode";

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * QR รับแต้มของใบเสร็จ (Issue #55) — แสดงใต้ใบเสร็จของ Guest ที่ชำระแล้ว
 * สมาชิกสแกนที่หน้า "คะแนนสะสม" (หรือกดลิงก์บนเครื่องนี้) ผูกคำสั่งซื้อเข้าบัญชีและรับแต้มตามกติกาเดิม
 * ใช้ได้ครั้งเดียวต่อใบเสร็จ ภายใน 24 ชม. หลังชำระเงิน
 */
export function ReceiptClaimQrCard({ claim }: { claim: ReceiptClaimQr }) {
  const expiry = fmtExpiry(claim.expiresAt);
  return (
    <section aria-label="QR รับแต้มจากใบเสร็จ" className="rounded-xl border border-dashed border-brand-400 bg-brand-50 p-4 text-center">
      <h3 className="pa-display text-base text-brand-900">รับแต้มสะสมจากใบเสร็จนี้</h3>
      <p className="mt-1 text-sm text-ink-700">
        สมาชิกสแกน QR นี้ที่หน้า “คะแนนสะสม” เพื่อผูกคำสั่งซื้อเข้าบัญชีและรับแต้ม (เครื่องดื่ม 1 แก้ว = 1 แต้ม)
      </p>
      <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-2 shadow-sm">
        <TableQrCode value={claim.code} label="QR รับแต้มจากใบเสร็จ" size={200} />
      </div>
      <p className="mt-2 break-all font-mono text-xs text-ink-700" aria-label="รหัส QR ใบเสร็จ">
        {claim.code}
      </p>
      <p className="mt-2 text-sm text-ink-600">
        ใช้ได้ครั้งเดียว{expiry ? ` ภายใน ${expiry}` : " ภายใน 24 ชั่วโมงหลังชำระเงิน"} — อย่าแชร์ภาพใบเสร็จนี้ให้ผู้อื่น
      </p>
      <Link
        to={`/rewards?code=${encodeURIComponent(claim.code)}`}
        className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        รับแต้มบนเครื่องนี้
      </Link>
    </section>
  );
}
