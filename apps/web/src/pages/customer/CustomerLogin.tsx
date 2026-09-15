import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Alert, inputClass, primaryButtonClass } from "../../components/ui";

export default function CustomerLoginPage({ onLoggedIn }: { onLoggedIn?: () => Promise<void> }) {
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const phoneInvalid = touched && phone.trim() === "";
  const passwordInvalid = touched && password === "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!phone.trim() || !password) {
      setError("กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.customerLogin(phone.trim(), password);
      setPassword("");
      await onLoggedIn?.();
      nav("/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-50 bg-[radial-gradient(circle_at_top,#ffedd5_0,transparent_55%)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 text-center">
          <p aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white shadow-sm">
            ป
          </p>
          <p className="mt-2 text-sm font-semibold text-brand-800">ร้านป้าอ้ออาหารตามสั่ง · สมาชิก</p>
        </div>
        <form onSubmit={submit} noValidate aria-label="ฟอร์มเข้าสู่ระบบสมาชิก" aria-busy={busy} className="w-full rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="space-y-1">
            <h1 className="text-center text-xl font-bold text-ink-900">เข้าสู่ระบบสมาชิก</h1>
            <p className="text-center text-sm text-ink-600">สำหรับลูกค้าที่สมัครสมาชิกไว้ (แยกจากบัญชีพนักงาน)</p>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="cl-phone" className="mb-1 block text-sm font-semibold text-ink-800">เบอร์โทรศัพท์</label>
              <input id="cl-phone" name="phone" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" required aria-required="true" aria-invalid={phoneInvalid} placeholder="เช่น 0812345678" />
              {phoneInvalid && <p className="mt-1 text-sm font-medium text-red-700">กรุณากรอกเบอร์โทรศัพท์</p>}
            </div>
            <div>
              <label htmlFor="cl-password" className="mb-1 block text-sm font-semibold text-ink-800">รหัสผ่าน</label>
              <input id="cl-password" name="password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required aria-required="true" aria-invalid={passwordInvalid} placeholder="รหัสผ่านของบัญชีสมาชิก" />
              {passwordInvalid && <p className="mt-1 text-sm font-medium text-red-700">กรุณากรอกรหัสผ่าน</p>}
            </div>
          </div>
          {error && <div className="mt-4"><Alert tone="error" role="alert">{error}</Alert></div>}
          <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryButtonClass} mt-5 w-full`}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </button>
          <p className="mt-3 text-center text-sm text-ink-600">
            ยังไม่มีบัญชี? <Link to="/register" className="font-semibold text-brand-700 underline">สมัครสมาชิก</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
