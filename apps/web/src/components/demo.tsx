import { DEMO_MODE_LABEL } from "../lib/demo";
import { Icon } from "./icons";

/** Exact-label demo badge shown whenever demo/mock data is rendered. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <p
      role="status"
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#A16207] bg-[#FEF3C7] px-4 py-2 text-sm font-bold text-[#713F12] ${className}`}
    >
      <Icon name="flame" size={18} />
      {DEMO_MODE_LABEL}
    </p>
  );
}

/**
 * Non-blocking connection banner: page content stays visible underneath.
 * Render only when the API is unreachable and demo data is shown.
 */
export function ConnectionBanner({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#FECACA] bg-white px-4 py-3 text-sm shadow-sm"
    >
      <span className="inline-flex items-center gap-2 font-semibold text-[#450A0A]">
        <Icon name="wifiOff" size={18} />
        เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังแสดงข้อมูลตัวอย่าง
      </span>
      <span className="text-[#A16207]">{DEMO_MODE_LABEL}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label="ลองเชื่อมต่อเซิร์ฟเวอร์อีกครั้ง"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-2 font-semibold text-[#DC2626] transition-colors hover:bg-[#FEE2E2]"
        >
          <Icon name="refresh" size={18} />
          ลองเชื่อมต่ออีกครั้ง
        </button>
      ) : null}
    </div>
  );
}
