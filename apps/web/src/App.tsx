import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, ROLE_LABELS, type PublicUser } from "./lib/api";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/Login";
import StaffPage from "./pages/Staff";
import ChangePasswordPage from "./pages/ChangePassword";
import AuditPage from "./pages/Audit";
import StatusPage from "./pages/Status";
import ShopPage from "./pages/Shop";
import TablesPage from "./pages/Tables";
import CustomerRegisterPage from "./pages/CustomerRegister";
import CustomerLoginPage from "./pages/CustomerLogin";
import CustomerProfilePage from "./pages/CustomerProfile";
import AdminCustomersPage from "./pages/AdminCustomers";
import MenuPublicPage from "./pages/MenuPublic";
import MenuAdminPage from "./pages/MenuAdmin";

const NAV_BASE =
  "inline-flex min-h-[44px] items-center rounded-xl border px-4 py-2 text-sm font-semibold transition-colors";
const NAV_IDLE = "border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800";
const NAV_ACTIVE = "border-brand-600 bg-brand-600 text-white shadow-sm";

function navClass(isActive: boolean): string {
  return `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_IDLE}`;
}

export default function App() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const nav = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setMe((await api.me()).user);
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      setMe(null);
      setLoggingOut(false);
      nav("/login");
    }
  }

  if (!ready)
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-50 p-6">
        <Spinner label="กำลังโหลดระบบหลังร้าน…" />
      </div>
    );
  // หน้าสาธารณะ /status + หน้าลูกค้า ดูได้โดยไม่ต้อง login พนักงาน (Ticket 02/03)
  // session ลูกค้าแยกจาก staff (คุกกี้ csid vs sid) — หน้าลูกค้าโหลด session ของตัวเอง ไม่พึ่ง shell นี้
  if (!me)
    return (
      <Routes>
        <Route path="/status" element={<StatusPage />} />
        <Route path="/menu" element={<MenuPublicPage />} />
        <Route path="/register" element={<CustomerRegisterPage />} />
        <Route path="/customer/login" element={<CustomerLoginPage />} />
        <Route path="/profile" element={<CustomerProfilePage />} />
        <Route path="*" element={<LoginPage onLoggedIn={refresh} />} />
      </Routes>
    );

  const isOwner = me.roles.includes("owner");
  const isManager = isOwner || me.roles.includes("admin");
  const homePath = isOwner ? "/staff" : isManager ? "/shop" : "/password";
  // การจัดการพนักงานเป็นของ Owner คนเดียว (ตรงกับ server authorization)
  // การจัดการร้าน/โต๊ะ/สมาชิกเป็นของ Owner และ Admin (kitchen/drink ไม่มีเมนูและถูกปฏิเสธที่ server)

  return (
    <div className="min-h-screen bg-brand-50 text-ink-900">
      <a href="#main-content" className="ui-skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="border-b border-brand-100 bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <Link to={homePath} className="flex min-h-[44px] items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white"
            >
              ป
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold">ร้านป้าอ้อ · หลังร้าน</span>
              <span className="block text-xs font-medium text-ink-500">
                ระบบจัดการพนักงานและบัญชีสำหรับทีมงาน
              </span>
            </span>
          </Link>

          <p className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl bg-ink-50 px-3 py-1.5 text-sm">
            <span className="font-semibold">{me.username}</span>
            <span aria-hidden="true" className="text-ink-300">
              |
            </span>
            <span className="text-ink-600">{me.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</span>
          </p>

          <nav aria-label="เมนูหลักหลังร้าน" className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <NavLink to="/status" className={({ isActive }) => navClass(isActive)}>
              สถานะร้าน
            </NavLink>
            <NavLink to="/menu" className={({ isActive }) => navClass(isActive)}>
              เมนู
            </NavLink>
            {isManager && (
              <NavLink to="/shop" className={({ isActive }) => navClass(isActive)}>
                ร้าน
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/menu" className={({ isActive }) => navClass(isActive)}>
                จัดการเมนู
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/tables" className={({ isActive }) => navClass(isActive)}>
                โต๊ะ
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/customers" className={({ isActive }) => navClass(isActive)}>
                สมาชิก
              </NavLink>
            )}
            {isOwner && (
              <NavLink to="/staff" className={({ isActive }) => navClass(isActive)}>
                พนักงาน
              </NavLink>
            )}
            <NavLink to="/password" className={({ isActive }) => navClass(isActive)}>
              เปลี่ยนรหัสผ่าน
            </NavLink>
            {isOwner && (
              <NavLink to="/audit" className={({ isActive }) => navClass(isActive)}>
                ประวัติ
              </NavLink>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={loggingOut}
              aria-busy={loggingOut}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 active:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
            </button>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Routes>
          <Route path="/status" element={<StatusPage />} />
          <Route path="/menu" element={<MenuPublicPage />} />
          {isManager && <Route path="/admin/menu" element={<MenuAdminPage />} />}
          {isManager && <Route path="/shop" element={<ShopPage />} />}
          {isManager && <Route path="/tables" element={<TablesPage />} />}
          {isManager && <Route path="/admin/customers" element={<AdminCustomersPage />} />}
          {isOwner && <Route path="/staff" element={<StaffPage me={me} />} />}
          <Route
            path="/password"
            element={
              <ChangePasswordPage
                onChanged={() => {
                  setMe(null);
                  nav("/login");
                }}
              />
            }
          />
          {isOwner && <Route path="/audit" element={<AuditPage />} />}
          <Route
            path="*"
            element={
              isOwner ? (
                <StaffPage me={me} />
              ) : isManager ? (
                <ShopPage />
              ) : (
                <ChangePasswordPage
                  onChanged={() => {
                    setMe(null);
                    nav("/login");
                  }}
                />
              )
            }
          />
        </Routes>
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
        <p className="text-xs text-ink-500">
          ร้านป้าอ้ออาหารตามสั่ง · สำหรับพนักงานและเจ้าของร้านเท่านั้น โปรดออกจากระบบทุกครั้งเมื่อใช้งานเสร็จ
        </p>
      </footer>
    </div>
  );
}
