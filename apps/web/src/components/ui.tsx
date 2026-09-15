import type { ReactNode } from "react";

type AlertTone = "error" | "success" | "info" | "demo";

const ALERT_STYLES: Record<AlertTone, string> = {
  error: "border-brand-200 bg-white text-brand-800",
  success: "border-green-300 bg-green-50 text-green-900",
  info: "border-ink-200 bg-white text-ink-800",
  demo: "border-gold-200 bg-gold-100 text-gold-700",
};

export function Alert({
  tone,
  role,
  children,
  ariaLive,
}: {
  tone: AlertTone;
  role: "alert" | "status";
  children: ReactNode;
  ariaLive?: "assertive" | "polite";
}) {
  return (
    <p
      role={role}
      aria-live={ariaLive ?? (role === "alert" ? "assertive" : "polite")}
      className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${ALERT_STYLES[tone]}`}
    >
      {children}
    </p>
  );
}

type BadgeTone = "active" | "inactive" | "success" | "danger" | "neutral" | "brand" | "gold";

const BADGE_STYLES: Record<BadgeTone, string> = {
  active: "border-green-300 bg-green-50 text-green-900",
  inactive: "border-ink-300 bg-ink-100 text-ink-700",
  success: "border-green-300 bg-green-50 text-green-900",
  danger: "border-brand-300 bg-brand-50 text-brand-800",
  neutral: "border-ink-200 bg-ink-50 text-ink-700",
  brand: "border-brand-600 bg-brand-600 text-white",
  gold: "border-gold-600 bg-gold-100 text-gold-700",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-[28px] items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  label,
  labelledBy,
  children,
  className = "",
}: {
  label?: string;
  labelledBy?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`rounded-2xl border border-ink-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="pa-display text-xl font-bold text-brand-900 sm:text-2xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </span>
  );
}

export const inputClass =
  "w-full min-h-[44px] rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-400 shadow-sm transition-colors hover:border-ink-400 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500 aria-[invalid=true]:border-brand-500 aria-[invalid=true]:bg-brand-50";

export const primaryButtonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm transition-colors hover:border-gold-600 hover:bg-gold-100 hover:text-gold-700 active:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60";

export const dangerButtonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-brand-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50 active:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60";

export const successButtonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-green-600 bg-white px-4 py-2.5 text-sm font-semibold text-green-800 shadow-sm transition-colors hover:bg-green-50 active:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60";
