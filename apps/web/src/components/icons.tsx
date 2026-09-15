/** Inline SVG icon set (Lucide/Heroicons style, stroke-based).
 * Never use emoji as structural icons. Decorative icons must be aria-hidden;
 * icon-only controls must carry an aria-label at the call site. */

export type IconName =
  | "home"
  | "menu"
  | "cart"
  | "order"
  | "reserve"
  | "reward"
  | "bell"
  | "track"
  | "clock"
  | "table"
  | "wallet"
  | "chart"
  | "search"
  | "refresh"
  | "check"
  | "alert"
  | "info"
  | "wifiOff"
  | "flame";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  menu: "M4 7h16M4 12h16M4 17h10",
  cart: "M3 4h2l2.4 12.2a1 1 0 0 0 1 .8h9.9a1 1 0 0 0 1-.8L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  order: "M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6",
  reserve: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  reward: "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8L12 3Z",
  bell: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0",
  track: "M4 12h4l2-6 4 12 2-6h4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  table: "M3 8h18M3 8v9M21 8v9M7 8V5M17 8V5M7 21l1-5M17 21l-1-5",
  wallet: "M3 7a2 2 0 0 1 2-2h13v3M3 7v10a2 2 0 0 0 2 2h15V9M3 7h16M16 14h2",
  chart: "M4 20V10M10 20V4M16 20v-8M21 20H3",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.3-4.3",
  refresh: "M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5",
  check: "M4 12.5 9.5 18 20 6.5",
  alert: "M12 3 2 20h20L12 3ZM12 10v5M12 18.5v.5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5M12 7.5V8",
  wifiOff: "M2 8.5A15 15 0 0 1 12 5c1.5 0 3 .2 4.3.7M5 12a10 10 0 0 1 4.2-2.3M8.5 15.5A6 6 0 0 1 12 14c.9 0 1.7.2 2.5.5M12 20h.01M3 3l18 18",
  flame: "M12 2s6 5.5 6 11a6 6 0 0 1-12 0c0-2 1-3.8 2-5 .5 1 1.2 1.8 2 2.3C10 8 10.5 5 12 2Z",
};

export function Icon({
  name,
  size = 20,
  decorative = true,
  label,
  className = "",
}: {
  name: IconName;
  size?: number;
  decorative?: boolean;
  label?: string;
  className?: string;
}) {
  const ariaProps = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label ?? name };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...ariaProps}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Small decorative food motif (CSS/inline SVG only, no external images). */
export function FoodMotif({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M10 30h44c0 10-9 18-22 18S10 40 10 30Z" />
      <path d="M22 30c0-8 4-14 10-18M32 30V10M40 30c1-5 4-9 8-11" />
      <path d="M18 52h28" />
    </svg>
  );
}
