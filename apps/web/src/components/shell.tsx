import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { FoodMotif, Icon, type IconName } from "./icons";
import { PageEnter } from "./motion";
import { DemoBadge } from "./demo";
import { isDemoModeEnabled } from "../lib/demo";
import { api } from "../lib/api";
import { useCustomerSession } from "../lib/customerSession";

const NAV_BASE =
  "pa-press inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide transition-colors sm:border sm:px-4 sm:text-sm";
const NAV_IDLE = "border-transparent text-ink-300 hover:text-gold-200 sm:border-white/15 sm:text-ink-100 sm:hover:border-gold-500 sm:hover:text-gold-200";
const NAV_ACTIVE = "border-transparent text-gold-200 sm:border-gold-500 sm:bg-gold-500/15 sm:text-gold-100";

function navClass(isActive: boolean): string {
  return `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_IDLE}`;
}

const ACCOUNT_LINK =
  "pa-press inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold tracking-wide text-ink-100 transition-colors hover:text-gold-200";

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

/** แถบบัญชีสมาชิกมุมขวาของหัวเว็บ: ชื่อ + ออกจากระบบ หรือ เข้าสู่ระบบ + สมัครสมาชิก */
function AccountBar() {
  const nav = useNavigate();
  const { customer, clear } = useCustomerSession();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await api.customerLogout();
    } finally {
      // ล้าง session ฝั่งเว็บเสมอ แม้ปลายทางตอบ error — ไม่ทิ้งหัวเว็บค้างว่ายัง login อยู่
      clear();
      setBusy(false);
      nav("/");
    }
  }

  if (!customer) {
    return (
      <nav aria-label="บัญชีสมาชิก" className="ml-auto flex items-center gap-1">
        <Link to="/customer/login" className={ACCOUNT_LINK}>
          <Icon name="user" size={18} />
          เข้าสู่ระบบ
        </Link>
        <Link
          to="/register"
          className="pa-press inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gold-500/60 px-4 py-2 text-sm font-semibold tracking-wide text-gold-100 transition-colors hover:bg-gold-500/15"
        >
          สมัครสมาชิก
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="บัญชีสมาชิก" className="ml-auto flex items-center gap-1">
      <Link to="/profile" className={ACCOUNT_LINK}>
        <Icon name="user" size={18} />
        <span className="max-w-[10rem] truncate">{customer.name}</span>
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        aria-busy={busy}
        className="pa-press inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold tracking-wide text-ink-100 transition-colors hover:border-brand-300 hover:text-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="logout" size={18} />
        {busy ? "กำลังออก…" : "ออกจากระบบ"}
      </button>
    </nav>
  );
}

/** Public restaurant shell: graphite hero band + icon nav + food-motif footer. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="role-customer min-h-screen bg-ink-50 text-ink-900">
      <a href="#public-main" className="ui-skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="customer-header role-header bg-ink-900 text-ink-50">
        <div className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/"
              className="flex min-h-[44px] items-center gap-3 rounded-xl"
              aria-label="ร้านป้าอ้ออาหารตามสั่ง กลับไปหน้าแรก"
            >
              <span className="pa-brand-mark flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-800 ring-1 ring-gold-600/60">
                <img
                  src="/brand/pa-or-logo.png"
                  alt="โลโก้ร้านป้าอ้ออาหารตามสั่ง"
                  aria-label="โลโก้ร้านป้าอ้ออาหารตามสั่ง"
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                    event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                  }}
                />
                <span hidden aria-hidden="true" className="pa-display text-lg text-gold-200">
                  ปอ
                </span>
              </span>
              <span className="leading-tight">
                <span className="pa-display block text-lg sm:text-xl">ร้านป้าอ้ออาหารตามสั่ง</span>
                <span className="luxe-kicker block text-gold-500">ข้าง มรภ.เลย · ผัดร้อนทีละกระทะ</span>
              </span>
            </Link>
            <AccountBar />
          </div>
          <nav aria-label="เมนูลูกค้า" className="mt-3 flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
                <Icon name={item.icon} size={18} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          {isDemoModeEnabled() ? (
            <div className="mt-3 flex justify-start">
              <DemoBadge />
            </div>
          ) : null}
        </div>
        <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-gold-600 to-transparent" />
      </header>
      <main
        id="public-main"
        tabIndex={-1}
        className="luxe-scene customer-main mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      >
        <PageEnter>{children}</PageEnter>
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6">
        <hr className="luxe-rule mb-4" />
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
          <FoodMotif className="h-6 w-6 shrink-0 text-brand-700" />
          <p className="min-w-0 flex-1">
            ร้านป้าอ้ออาหารตามสั่ง · ใกล้มหาวิทยาลัยราชภัฏเลย ต.เมืองเลย จ.เลย · เปิดทุกวัน 9:00–21:00 ·
            รับทำข้าวกล่องงานมหาวิทยาลัย สั่งล่วงหน้าอย่างน้อย 30 นาที
          </p>
          <Link
            to="/status"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-ink-200 px-4 py-2 font-semibold text-ink-800 transition-colors hover:border-gold-600 hover:text-gold-700"
          >
            <Icon name="info" size={18} />
            สถานะร้าน
          </Link>
        </div>
      </footer>
    </div>
  );
}
