import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OrderDetail, type PublicCustomer } from "../lib/api";
import { OrderCard } from "../components/OrderCard";
import { Alert, Panel, inputClass, primaryButtonClass, secondaryButtonClass } from "../components/ui";
import { DepthHero, MotionReveal, Skeleton } from "../components/motion";
import { ConnectionBanner, DemoBadge } from "../components/demo";
import { Icon } from "../components/icons";
import { DEMO_ORDERS, isOfflineError } from "../lib/demo";

/**
 * หน้าคำสั่งซื้อของฉัน (Ticket 05):
 * - สมาชิกที่ login แล้วเห็นคำสั่งซื้อของตนเอง (ไม่เห็นของผู้อื่น)
 * - Guest ค้นหาด้วยเลขคำสั่งซื้อ + เบอร์โทรที่ใช้สั่ง
 */
export default function MyOrdersPage() {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [lookupNumber, setLookupNumber] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupOrder, setLookupOrder] = useState<OrderDetail | null>(null);

  async function loadMine() {
    try {
      setLoading(true);
      setError(null);
      setDemo(false);
      let me: PublicCustomer | null = null;
      try {
        me = (await api.customerMe()).customer;
      } catch (sessionErr) {
        // Offline: show deterministic demo orders instead of an empty page.
        if (isOfflineError(sessionErr)) {
          setCustomer(null);
          setSessionChecked(true);
          setOrders(DEMO_ORDERS);
          setDemo(true);
          return;
        }
        me = null;
      }
      setCustomer(me);
      setSessionChecked(true);
      if (me) {
        try {
          setOrders((await api.myOrders()).orders);
        } catch (ordersErr) {
          if (isOfflineError(ordersErr)) {
            setOrders(DEMO_ORDERS);
            setDemo(true);
          } else {
            throw ordersErr;
          }
        }
      } else {
        setOrders([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคำสั่งซื้อไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMine();
  }, []);

  async function lookup() {
    if (lookupLoading) return;
    setLookupError(null);
    setLookupOrder(null);
    if (!lookupNumber.trim() || !lookupPhone.trim()) {
      setLookupError("กรุณากรอกเลขคำสั่งซื้อและเบอร์โทรที่ใช้สั่ง");
      return;
    }
    try {
      setLookupLoading(true);
      setLookupOrder((await api.orderLookup(lookupNumber.trim(), lookupPhone.trim())).order);
    } catch (err) {
      // Offline: match against deterministic demo orders so Guest lookup stays usable.
      if (isOfflineError(err)) {
        const needle = lookupNumber.trim().toLowerCase();
        const found = DEMO_ORDERS.find((o) => o.orderNumber.toLowerCase() === needle);
        if (found) {
          setLookupOrder(found);
          setLookupError(null);
        } else {
          setLookupError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ค้นหาด้วยเลขคำสั่งซื้อตัวอย่าง เช่น ORD-DEMO-0001");
        }
      } else {
        setLookupError(err instanceof Error ? err.message : "ค้นหาคำสั่งซื้อไม่สำเร็จ");
      }
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#orders-main" className="ui-skip-link">
        ข้ามไปยังคำสั่งซื้อ
      </a>
      <DepthHero>
        <h1 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">คำสั่งซื้อของฉัน</h1>
        <p className="mt-1 inline-flex items-center gap-2 text-sm text-ink-600">
          <Icon name="order" size={18} />
          ติดตามสถานะคำสั่งซื้อและยอดที่ยืนยันไว้
        </p>
        {demo ? (
          <div className="mt-3 flex justify-center">
            <DemoBadge />
          </div>
        ) : null}
      </DepthHero>

      {demo ? <ConnectionBanner onRetry={() => void loadMine()} /> : null}

      <main id="orders-main" aria-label="คำสั่งซื้อของฉัน" className="space-y-4">
        {loading ? (
          <Panel label="กำลังโหลดคำสั่งซื้อ">
            <Skeleton label="กำลังโหลดคำสั่งซื้อ…" lines={5} />
          </Panel>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button type="button" onClick={() => void loadMine()} className={secondaryButtonClass}>
              ลองใหม่
            </button>
          </div>
        ) : (
          <>
            {(sessionChecked && customer) || demo ? (
              <Panel label="คำสั่งซื้อของสมาชิก">
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-ink-900">
                    {customer ? `คำสั่งซื้อของ ${customer.name}` : "คำสั่งซื้อตัวอย่าง"}
                  </h2>
                  {orders.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
                      <p className="font-semibold text-ink-800">ยังไม่มีคำสั่งซื้อ</p>
                      <p className="mt-1 text-sm text-ink-600">
                        <Link to="/cart" className="font-semibold text-brand-700 underline underline-offset-2">
                          ไปเลือกเมนูที่ตะกร้า
                        </Link>
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p role="status" className="text-sm text-ink-600">
                        พบ {orders.length} คำสั่งซื้อ
                      </p>
                      {orders.map((o, index) => (
                        <MotionReveal key={o.id} index={index}>
                          <OrderCard order={o} payTo={`/pay/${o.id}`} />
                        </MotionReveal>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            ) : sessionChecked && !demo ? (
              <Alert tone="info" role="status">
                ยังไม่ได้เข้าสู่ระบบบัญชีลูกค้า — สมาชิก{" "}
                <Link to="/customer/login" className="font-semibold text-brand-700 underline underline-offset-2">
                  เข้าสู่ระบบ
                </Link>{" "}
                เพื่อดูประวัติ หรือค้นหาด้วยเลขคำสั่งซื้อด้านล่าง
              </Alert>
            ) : null}

            <Panel label="ค้นหาคำสั่งซื้อ Guest">
              <div className="space-y-3">
                <h2 className="text-base font-bold text-ink-900">ค้นหาด้วยเลขคำสั่งซื้อ (Guest)</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="lookup-number" className="mb-1 block text-sm font-semibold text-ink-800">
                      เลขคำสั่งซื้อ
                    </label>
                    <input
                      id="lookup-number"
                      className={inputClass}
                      value={lookupNumber}
                      onChange={(e) => setLookupNumber(e.target.value)}
                      placeholder="เช่น ORD-20260914-AB12"
                    />
                  </div>
                  <div>
                    <label htmlFor="lookup-phone" className="mb-1 block text-sm font-semibold text-ink-800">
                      เบอร์โทรที่ใช้สั่ง
                    </label>
                    <input
                      id="lookup-phone"
                      className={inputClass}
                      value={lookupPhone}
                      inputMode="tel"
                      onChange={(e) => setLookupPhone(e.target.value)}
                      placeholder="เช่น 0812345678"
                    />
                  </div>
                </div>
                {lookupError ? (
                  <Alert tone="error" role="alert">
                    {lookupError}
                  </Alert>
                ) : null}
                <button
                  type="button"
                  onClick={() => void lookup()}
                  disabled={lookupLoading}
                  aria-busy={lookupLoading}
                  className={primaryButtonClass}
                >
                  {lookupLoading ? "กำลังค้นหา…" : "ค้นหาคำสั่งซื้อ"}
                </button>
                {lookupOrder ? <OrderCard order={lookupOrder} payTo={`/pay/${lookupOrder.id}?phone=${encodeURIComponent(lookupPhone.trim())}`} /> : null}
              </div>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
