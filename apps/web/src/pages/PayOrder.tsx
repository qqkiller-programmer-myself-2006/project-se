import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type OrderDetail, type OrderPaymentState, type Payment } from "../lib/api";
import { OrderCard } from "../components/OrderCard";
import { PaymentPanel } from "../components/PaymentPanel";
import { Alert, Spinner, inputClass, primaryButtonClass } from "../components/ui";

/**
 * หน้าชำระเงินของลูกค้า (Ticket 08):
 * - สมาชิกเห็นคำสั่งซื้อของตนเอง; Guest ระบุเบอร์โทรที่ใช้สั่ง (?phone=)
 * - สร้างคำขอชำระ ส่ง slip จำลอง ดูใบเสร็จ
 */
export default function PayOrderPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(params.get("phone") ?? "");
  const [phoneSent, setPhoneSent] = useState(params.get("phone") ?? "");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [state, setState] = useState<OrderPaymentState>("pending_payment");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(withPhone: string) {
    setLoading(true);
    setError(null);
    try {
      const o = (await api.orderGet(id, withPhone || undefined)).order;
      setOrder(o);
      const p = await api.orderPayment(o.id, withPhone || undefined);
      setPayment(p.payment);
      setState(p.paymentState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคำสั่งซื้อไม่สำเร็จ");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(phoneSent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#pay-main" className="ui-skip-link">
        ข้ามไปยังชำระเงิน
      </a>
      <header className="text-center">
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">ชำระเงิน</h1>
        <p className="mt-1 text-sm text-ink-600">ชำระเต็มจำนวนก่อนคำสั่งซื้อเข้าคิวทำ · ใบเสร็จออกทันทีเมื่อสำเร็จ</p>
      </header>

      <main id="pay-main" aria-label="ชำระเงิน" className="space-y-4">
        {loading ? (
          <p className="py-10 text-center">
            <Spinner label="กำลังโหลดคำสั่งซื้อ…" />
          </p>
        ) : error || !order ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error ?? "ไม่พบคำสั่งซื้อ"}
            </Alert>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="pay-phone" className="mb-1 block text-sm font-semibold text-ink-800">
                  เบอร์โทรที่ใช้สั่ง (สำหรับ Guest)
                </label>
                <input
                  id="pay-phone"
                  className={inputClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="เช่น 0812345678"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhoneSent(phone.trim());
                  void load(phone.trim());
                }}
                className={`${primaryButtonClass} self-end`}
              >
                โหลดใหม่
              </button>
            </div>
            <p className="text-sm text-ink-600">
              <Link to="/orders" className="font-semibold text-brand-700 underline underline-offset-2">
                กลับไปคำสั่งซื้อของฉัน
              </Link>
            </p>
          </div>
        ) : (
          <>
            <OrderCard order={order} />
            <PaymentPanel
              order={order}
              phone={phoneSent || undefined}
              initialPayment={payment}
              initialState={state}
              onChanged={() => void load(phoneSent)}
            />
          </>
        )}
      </main>
    </div>
  );
}
