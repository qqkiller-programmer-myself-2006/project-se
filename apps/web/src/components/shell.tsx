import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { FoodMotif, Icon, type IconName } from "./icons";
import { PageEnter } from "./motion";

const NAV_BASE =
  "pa-lift pa-press inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors";
const NAV_IDLE =
  "border-white/25 bg-white/10 text-white hover:border-white/60 hover:bg-white/20";
const NAV_ACTIVE = "border-white bg-white text-brand-900 shadow-sm";

function navClass(isActive: boolean): string {
  return `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_IDLE}`;
}

export interface PublicNavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export const PUBLIC_NAV: PublicNavItem[] = [
  { to: "/menu", label: "เมนู", icon: "menu" },
  { to: "/cart", label: "ตะกร้า", icon: "cart" },
  { to: "/orders", label: "คำสั่งซื้อ", icon: "order" },
  { to: "/track", label: "ติดตามคิว", icon: "track" },
  { to: "/reservations", label: "จองโต๊ะ", icon: "reserve" },
  { to: "/rewards", label: "สะสมแต้ม", icon: "reward" },
  { to: "/notifications", label: "แจ้งเตือน", icon: "bell" },
];

/** Public restaurant shell: cocoa hero band + icon nav + food-motif footer. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-50 text-ink-900">
      <a href="#public-main" className="ui-skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="bg-brand-900 text-white">
        <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/menu"
              className="flex min-h-[44px] items-center gap-3 rounded-xl"
              aria-label="ร้านป้าอ้ออาหารตามสั่ง กลับไปหน้าเมนู"
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 shadow-md ring-2 ring-gold-200"
              >
                <FoodMotif className="h-7 w-7 text-white" />
              </span>
              <span className="leading-tight">
                <span className="pa-display block text-lg font-bold sm:text-xl">
                  ร้านป้าอ้ออาหารตามสั่ง
                </span>
                <span className="block text-xs font-medium text-brand-100">
                  ข้าง มรภ.เลย · ผัดร้อนทีละกระทะ ราคานักศึกษา
                </span>
              </span>
            </Link>
            <p className="ml-auto hidden items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-brand-100 md:inline-flex">
              <Icon name="clock" size={16} />
              เปิดทุกวัน 9:00–21:00 · โทรหน้าร้านดูที่หน้าเมนู
            </p>
          </div>
          <nav aria-label="เมนูลูกค้า" className="mt-3 flex flex-wrap gap-2">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
                <Icon name={item.icon} size={18} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div
          aria-hidden="true"
          className="h-2 bg-gradient-to-r from-brand-600 via-brand-400 via-50% to-gold-600"
        />
      </header>
      <main id="public-main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <PageEnter>{children}</PageEnter>
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-xs text-ink-600 shadow-sm">
          <FoodMotif className="h-8 w-8 text-brand-600" />
          <p className="min-w-0 flex-1">
            ร้านป้าอ้ออาหารตามสั่ง · ใกล้มหาวิทยาลัยราชภัฏเลย ต.เมืองเลย จ.เลย ·
            รับทำข้าวกล่องงานมหาวิทยาลัย สั่งล่วงหน้าอย่างน้อย 30 นาที
          </p>
          <Link
            to="/status"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-ink-300 px-4 py-2 font-semibold text-ink-800 hover:border-gold-600 hover:text-gold-700"
          >
            <Icon name="info" size={18} />
            สถานะร้าน
          </Link>
        </div>
      </footer>
    </div>
  );
}
