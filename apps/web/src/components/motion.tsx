import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Shared premium motion/3D primitives (Ticket 16).
 *
 * No animation dependencies — CSS transforms/opacity only. Every primitive:
 * - respects `prefers-reduced-motion` (static/opacity states, no tilt/loops),
 * - never gates interaction on hover (tilt is decorative enhancement only),
 * - cleans up all observers/listeners/rAF handles on unmount.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReveal<T extends HTMLElement>(extraDelay = 0): {
  ref: React.RefObject<T>;
  visible: boolean;
} {
  const ref = useRef<T | null>(null);
  const visibleRef = useRef(false);
  // Render visible on the server / without IO support so content never hides.
  const initiallyVisible =
    typeof window === "undefined" || typeof IntersectionObserver === "undefined";
  const force = useRef(initiallyVisible);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleRef.current = true;
            force.current = true;
            el.classList.add("is-visible");
            io.disconnect();
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    // Entrance stagger is CSS-driven; nothing else to schedule.
    void extraDelay;
    return () => io.disconnect();
  }, [extraDelay]);

  return { ref: ref as React.RefObject<T>, visible: force.current };
}

export type RevealVariant = "up" | "fade" | "scale";

/** Scroll/route entrance reveal: opacity + small translate, staggered via index. */
export function MotionReveal({
  children,
  className = "",
  variant = "up",
  index = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  variant?: RevealVariant;
  index?: number;
  as?: "div" | "li" | "section" | "article" | "span";
}) {
  const { ref } = useReveal<HTMLDivElement>();
  const capped = Math.max(0, Math.min(8, index));
  const style = { "--motion-delay": `${capped * 60}ms` } as CSSProperties;
  const hidden = typeof window !== "undefined" && typeof IntersectionObserver !== "undefined";
  return (
    <Tag
      // ref works for all intrinsic tags used here
      ref={ref as never}
      style={style}
      className={`pa-reveal pa-reveal--${variant}${hidden ? "" : " is-visible"} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

/** Stagger wrapper for lists: children get incremental delays, capped at 9 items. */
export function StaggerList({
  children,
  className = "",
  as: Tag = "ul",
  label,
  live = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "ul" | "ol" | "div";
  label?: string;
  live?: boolean;
}) {
  return (
    <Tag aria-label={label} aria-live={live ? "polite" : undefined} className={`pa-stagger ${className}`.trim()}>
      {children}
    </Tag>
  );
}

/** Stagger item: <li>/<div> with index-capped entrance delay. */
export function StaggerItem({
  children,
  index = 0,
  className = "",
  as: Tag = "li",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: "li" | "div";
}) {
  const { ref } = useReveal<HTMLLIElement>();
  const capped = Math.max(0, Math.min(8, index));
  const style = { "--motion-delay": `${capped * 60}ms` } as CSSProperties;
  const hidden = typeof window !== "undefined" && typeof IntersectionObserver !== "undefined";
  return (
    <Tag
      ref={ref as never}
      style={style}
      className={`pa-reveal pa-reveal--up pa-stagger-item${hidden ? "" : " is-visible"} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

/**
 * Subtle 3D tilt card (fine pointers only, max 6deg, rAF-throttled).
 * Decorative: content and controls work identically without hover.
 */
export function TiltCard({
  children,
  className = "",
  maxTilt = 6,
  label,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    if (typeof window.matchMedia === "function" && !window.matchMedia("(pointer: fine)").matches) return;

    const clamp = Math.max(2, Math.min(6, maxTilt));
    let pending: { x: number; y: number } | null = null;

    function apply() {
      raf.current = null;
      if (!pending || !el) return;
      const rect = el.getBoundingClientRect();
      const px = (pending.x - rect.left) / Math.max(1, rect.width) - 0.5;
      const py = (pending.y - rect.top) / Math.max(1, rect.height) - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-py * clamp).toFixed(2)}deg) rotateY(${(px * clamp).toFixed(2)}deg) translateY(-2px)`;
      el.classList.add("is-tilting");
      pending = null;
    }
    function onMove(e: PointerEvent) {
      pending = { x: e.clientX, y: e.clientY };
      if (raf.current === null && typeof requestAnimationFrame === "function") {
        raf.current = requestAnimationFrame(apply);
      } else if (typeof requestAnimationFrame !== "function") {
        apply();
      }
    }
    function onLeave() {
      if (raf.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      pending = null;
      const node = ref.current;
      if (!node) return;
      node.style.transform = "";
      node.classList.remove("is-tilting");
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("blur", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("blur", onLeave);
      if (raf.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf.current);
      }
    };
  }, [maxTilt]);

  return (
    <div ref={ref} aria-label={label} className={`pa-tilt ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * Layered hero with ambient floating shapes (CSS only, aria-hidden).
 * Keeps the Ticket 15 cocoa slab as the single focal point.
 */
export function DepthHero({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <header className={`pa-hero pa-depth-hero px-5 py-5 text-center sm:px-8 ${className}`.trim()}>
      <span aria-hidden="true" className="pa-depth-layer pa-depth-layer--a" />
      <span aria-hidden="true" className="pa-depth-layer pa-depth-layer--b" />
      <span aria-hidden="true" className="pa-depth-layer pa-depth-layer--c" />
      <div className="pa-depth-content">{children}</div>
    </header>
  );
}

/** Shimmer skeleton placeholder (opacity/static under reduced motion). */
export function Skeleton({ label = "กำลังโหลด…", lines = 3 }: { label?: string; lines?: number }) {
  const rows = Math.max(1, Math.min(8, lines));
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pa-skeleton block h-4 rounded-lg"
          style={{ width: `${[96, 82, 90, 70, 88][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

/** Dashboard chart bar with scaleX reveal (no layout shift: fixed track height). */
export function ChartBar({
  widthPercent,
  label,
  className = "",
}: {
  widthPercent: number;
  label: string;
  className?: string;
}) {
  const { ref } = useReveal<HTMLSpanElement>();
  const clamped = Math.max(4, Math.min(100, Math.round(widthPercent)));
  const hidden = typeof window !== "undefined" && typeof IntersectionObserver !== "undefined";
  return (
    <span className="pa-chart-track block h-4 min-w-1 flex-1 overflow-hidden rounded bg-ink-100">
      <span
        ref={ref}
        role="img"
        aria-label={label}
        style={{ width: `${clamped}%` }}
        className={`pa-chart-bar block h-full rounded bg-[#3B82F6]${hidden ? "" : " is-visible"} ${className}`.trim()}
      />
    </span>
  );
}

/** Route/page entrance: remounts per pathname for a short fade-rise. */
export function PageEnter({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="pa-page-enter">
      {children}
    </div>
  );
}
