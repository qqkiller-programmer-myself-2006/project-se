import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, ROLE_LABELS, type PublicUser } from "./lib/api";
import { Spinner } from "./components/ui";
import { PageEnter } from "./components/motion";
import { PublicShell } from "./components/shell";
// แยกโหลดทีละหน้า: ลูกค้าที่สแกน QR บนมือถือไม่ต้องดาวน์โหลดโค้ดหลังร้านทั้งหมด
// (บัญชี สต๊อก การเงิน คิวครัว) ตั้งแต่เปิดเว็บ — หน้าแรก เมนู ตะกร้า และสถานะร้าน
// โหลดทันทีเพราะเป็นเส้นทางจาก QR ที่ต้องขึ้นเร็วที่สุด
const LoginPage = lazy(() => import("./pages/shared/Login"));
const StaffPage = lazy(() => import("./pages/owner/Staff"));
const ChangePasswordPage = lazy(() => import("./pages/shared/ChangePassword"));
const AuditPage = lazy(() => import("./pages/owner/Audit"));
import StatusPage from "./pages/shared/Status";
const ShopPage = lazy(() => import("./pages/admin/Shop"));
const TablesPage = lazy(() => import("./pages/admin/Tables"));
const CustomerRegisterPage = lazy(() => import("./pages/customer/CustomerRegister"));
const CustomerLoginPage = lazy(() => import("./pages/customer/CustomerLogin"));
const CustomerProfilePage = lazy(() => import("./pages/customer/CustomerProfile"));
const AdminCustomersPage = lazy(() => import("./pages/admin/AdminCustomers"));
import MenuPublicPage from "./pages/customer/MenuPublic";
import LandingPage from "./pages/customer/Landing";
const MenuAdminPage = lazy(() => import("./pages/admin/MenuAdmin"));
const InventoryPage = lazy(() => import("./pages/admin/Inventory"));
import CartPage from "./pages/customer/Cart";
const MyOrdersPage = lazy(() => import("./pages/customer/MyOrders"));
const PayOrderPage = lazy(() => import("./pages/customer/PayOrder"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPayments"));
const AdminOrdersPage = lazy(() => import("./pages/admin/AdminOrders"));
const ReservationsPage = lazy(() => import("./pages/customer/Reservations"));
const CheckinPage = lazy(() => import("./pages/shared/Checkin"));
const AdminReservationsPage = lazy(() => import("./pages/admin/AdminReservations"));
const StationQueuePage = lazy(() => import("./pages/kitchen/StationQueue"));
const QueueTrackPage = lazy(() => import("./pages/customer/QueueTrack"));
const RewardsPage = lazy(() => import("./pages/customer/Rewards"));
const AdminRewardsPage = lazy(() => import("./pages/admin/AdminRewards"));
const FinanceDashboardPage = lazy(() => import("./pages/owner/FinanceDashboard"));
const FinanceEntriesPage = lazy(() => import("./pages/owner/FinanceEntries"));
const CapacityDashboardPage = lazy(() => import("./pages/owner/CapacityDashboard"));
const AdminNotificationsPage = lazy(() => import("./pages/admin/AdminNotifications"));
const MyNotificationsPage = lazy(() => import("./pages/customer/MyNotifications"));

const NAV_BASE =
  "pa-lift pa-press inline-flex min-h-[44px] items-center rounded-lg border px-4 py-2 text-sm font-semibold tracking-wide transition-colors";
const NAV_IDLE = "border-ink-200 bg-white text-ink-700 hover:border-gold-600 hover:text-ink-900";
const NAV_ACTIVE = "border-ink-900 bg-ink-900 text-ink-50";

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
      // ตอบ 200 เสมอ — ลูกค้า (ซึ่งเกือบทุกคนไม่ใช่พนักงาน) จึงไม่เห็น 401 ใน console ทุกครั้งที่เปิดเว็บ
      setMe((await api.staffSession()).user);
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
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <Spinner label="กำลังโหลดระบบหลังร้าน…" />
      </div>
    );
  // หน้าสาธารณะ /status + หน้าลูกค้า ดูได้โดยไม่ต้อง login พนักงาน (Ticket 02/03)
  // session ลูกค้าแยกจาก staff (คุกกี้ csid vs sid) — หน้าลูกค้าโหลด session ของตัวเอง ไม่พึ่ง shell นี้
  if (!me)
    return (
      <PublicShell>
      <Suspense fallback={<p className="py-10 text-center"><Spinner label="กำลังโหลดหน้า…" /></p>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/menu" element={<MenuPublicPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/orders" element={<MyOrdersPage />} />
        <Route path="/track" element={<QueueTrackPage />} />
        <Route path="/pay/:id" element={<PayOrderPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/register" element={<CustomerRegisterPage />} />
        <Route path="/customer/login" element={<CustomerLoginPage />} />
        <Route path="/profile" element={<CustomerProfilePage />} />
        <Route path="/rewards" element={<RewardsPage />} />
        <Route path="/notifications" element={<MyNotificationsPage />} />
        <Route path="*" element={<LoginPage onLoggedIn={refresh} />} />
      </Routes>
      </Suspense>
      </PublicShell>
    );

  const isOwner = me.roles.includes("owner");
  const isManager = isOwner || me.roles.includes("admin");
  const canKitchen = isManager || me.roles.includes("kitchen");
  const canDrink = isManager || me.roles.includes("drink");
  const homePath = isOwner ? "/staff" : isManager ? "/shop" : "/password";
  // การจัดการพนักงานเป็นของ Owner คนเดียว (ตรงกับ server authorization)
  // การจัดการร้าน/โต๊ะ/สมาชิกเป็นของ Owner และ Admin (kitchen/drink ไม่มีเมนูและถูกปฏิเสธที่ server)

  const roleSurface = isOwner ? "role-owner" : isManager ? "role-admin" : canKitchen || canDrink ? "role-kitchen" : "role-staff";

  return (
    <div className={`min-h-screen bg-ink-50 text-ink-900 ${roleSurface}`}>
      <a href="#main-content" className="ui-skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="role-header border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <Link to={homePath} className="flex min-h-[44px] items-center gap-3">
            <span
              aria-hidden="true"
              className="pa-display flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900 text-lg text-gold-200"
            >
              ป
            </span>
            <span className="leading-tight">
              <span className="pa-display block text-lg">ร้านป้าอ้อ · หลังร้าน</span>
              <span className="block text-xs font-medium text-ink-500">
                ระบบจัดการพนักงานและบัญชีสำหรับทีมงาน
              </span>
            </span>
          </Link>

          <p className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-sm">
            <span className="font-semibold">{me.username}</span>
            <span aria-hidden="true" className="text-ink-300">
              |
            </span>
            <span className="text-ink-600">{me.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</span>
          </p>

          <nav aria-label="เมนูหลักหลังร้าน" className="role-nav flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <NavLink to="/status" className={({ isActive }) => navClass(isActive)}>
              สถานะร้าน
            </NavLink>
            <NavLink to="/menu" className={({ isActive }) => navClass(isActive)}>
              เมนู
            </NavLink>
            <NavLink to="/cart" className={({ isActive }) => navClass(isActive)}>
              ตะกร้า
            </NavLink>
            <NavLink to="/orders" className={({ isActive }) => navClass(isActive)}>
              คำสั่งซื้อ
            </NavLink>
            <NavLink to="/track" className={({ isActive }) => navClass(isActive)}>
              ติดตามคิว
            </NavLink>
            {canKitchen && (
              <NavLink to="/queue/kitchen" className={({ isActive }) => navClass(isActive)}>
                คิวครัว
              </NavLink>
            )}
            {canDrink && (
              <NavLink to="/queue/drink" className={({ isActive }) => navClass(isActive)}>
                คิวเครื่องดื่ม
              </NavLink>
            )}
            {canDrink && (
              <NavLink to="/admin/rewards" className={({ isActive }) => navClass(isActive)}>
                รางวัล/สะสมแต้ม
              </NavLink>
            )}
            <NavLink to="/reservations" className={({ isActive }) => navClass(isActive)}>
              การจอง
            </NavLink>
            {isManager && (
              <NavLink to="/checkin" className={({ isActive }) => navClass(isActive)}>
                เช็กอิน/รอบโต๊ะ
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/reservations" className={({ isActive }) => navClass(isActive)}>
                จัดการการจอง
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/orders" className={({ isActive }) => navClass(isActive)}>
                จัดการคำสั่งซื้อ
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/payments" className={({ isActive }) => navClass(isActive)}>
                การชำระเงิน
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/admin/notifications" className={({ isActive }) => navClass(isActive)}>
                แจ้งเตือน LINE
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/finance/dashboard" className={({ isActive }) => navClass(isActive)}>
                Dashboard การเงิน
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/capacity/dashboard" className={({ isActive }) => navClass(isActive)}>
                กำลังผลิต/เวลารอ
              </NavLink>
            )}
            {isManager && (
              <NavLink to="/finance/entries" className={({ isActive }) => navClass(isActive)}>
                รายรับ/รายจ่าย
              </NavLink>
            )}
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
              <NavLink to="/admin/inventory" className={({ isActive }) => navClass(isActive)}>
                วัตถุดิบ/สต๊อก
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
              className="inline-flex min-h-[44px] items-center rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-semibold tracking-wide text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
            </button>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="luxe-scene role-main mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <PageEnter>
        <Suspense fallback={<p className="py-10 text-center"><Spinner label="กำลังโหลดหน้า…" /></p>}>
        <Routes>
          <Route path="/status" element={<StatusPage />} />
          <Route path="/menu" element={<MenuPublicPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<MyOrdersPage />} />
          <Route path="/track" element={<QueueTrackPage />} />
          {canKitchen && <Route path="/queue/kitchen" element={<StationQueuePage station="kitchen" canManageCapacity={isManager} />} />}
          {canDrink && <Route path="/queue/drink" element={<StationQueuePage station="drink" canManageCapacity={isManager} />} />}
          {canDrink && <Route path="/admin/rewards" element={<AdminRewardsPage isManager={isManager} />} />}
          <Route path="/pay/:id" element={<PayOrderPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          {isManager && <Route path="/checkin" element={<CheckinPage />} />}
          {isManager && <Route path="/admin/reservations" element={<AdminReservationsPage />} />}
          {isManager && <Route path="/admin/orders" element={<AdminOrdersPage />} />}
          {isManager && <Route path="/admin/payments" element={<AdminPaymentsPage isOwner={isOwner} />} />}
          {isManager && <Route path="/admin/notifications" element={<AdminNotificationsPage />} />}
          <Route path="/notifications" element={<MyNotificationsPage />} />
          {isManager && <Route path="/finance/dashboard" element={<FinanceDashboardPage />} />}
          {isManager && <Route path="/finance/entries" element={<FinanceEntriesPage />} />}
          {isManager && <Route path="/capacity/dashboard" element={<CapacityDashboardPage />} />}
          {isManager && <Route path="/admin/menu" element={<MenuAdminPage />} />}
          {isManager && <Route path="/admin/inventory" element={<InventoryPage />} />}
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
        </Suspense>
        </PageEnter>
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
        <p className="text-xs text-ink-500">
          ร้านป้าอ้ออาหารตามสั่ง · สำหรับพนักงานและเจ้าของร้านเท่านั้น โปรดออกจากระบบทุกครั้งเมื่อใช้งานเสร็จ
        </p>
      </footer>
    </div>
  );
}
