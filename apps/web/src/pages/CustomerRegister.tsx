import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { previewThaiPhone } from "../lib/phone";
import { Alert, inputClass, primaryButtonClass } from "../components/ui";

export default function CustomerRegisterPage({ onRegistered }: { onRegistered?: () => Promise<void> }) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameInvalid = touched && name.trim() === "";
  const phoneInvalid = touched && previewThaiPhone(phone) === null;
  const passwordInvalid = touched && password.length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || previewThaiPhone(phone) === null || password.length < 8) {
      setError("กรุณากรอกชื่อ เบอร์โทร 10 หลัก และรหัสผ่านอย่างน้อย 8 ตัวอักษร");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.customerRegister(name.trim(), phone.trim(), password, email.trim() ? email.trim() : undefined);
      setPassword("");
      await onRegistered?.();
      nav("/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "สมัครสมาชิกไม่สำเร็จ");
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
        <form onSubmit={submit} noValidate aria-label="ฟอร์มสมัครสมาชิก" aria-busy={busy} className="w-full rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="space-y-1">
            <h1 className="text-center text-xl font-bold text-ink-900">สมัครสมาชิก</h1>
            <p className="text-center text-sm text-ink-600">ใช้จองโต๊ะและสะสมคะแนน เบอร์เดียวสมัครได้หนึ่งบัญชี</p>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="cr-name" className="mb-1 block text-sm font-semibold text-ink-800">ชื่อ</label>
              <input id="cr-name" name="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} aria-required="true" aria-invalid={nameInvalid} placeholder="เช่น สมชาย" />
              {nameInvalid && <p className="mt-1 text-sm font-medium text-red-700">กรุณาระบุชื่อ</p>}
            </div>
            <div>
              <label htmlFor="cr-phone" className="mb-1 block text-sm font-semibold text-ink-800">เบอร์โทรศัพท์</label>
              <input id="cr-phone" name="phone" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" required aria-required="true" aria-invalid={phoneInvalid} aria-describedby="cr-phone-hint" placeholder="เช่น 0812345678" />
              <p id="cr-phone-hint" className="mt-1 text-xs text-ink-500">ตัวเลข 10 หลักขึ้นต้นด้วย 0 (พิมพ์ +66 หรือมีขีดคั่นได้)</p>
              {phoneInvalid && <p className="mt-1 text-sm font-medium text-red-700">เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0</p>}
            </div>
            <div>
              <label htmlFor="cr-email" className="mb-1 block text-sm font-semibold text-ink-800">อีเมล (ไม่บังคับ)</label>
              <input id="cr-email" name="email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-describedby="cr-email-hint" placeholder="เช่น somchai@example.com" />
              <p id="cr-email-hint" className="mt-1 text-xs text-ink-500">เว้นว่างได้ ระบุแล้วต้องไม่ซ้ำกับสมาชิกอื่น</p>
            </div>
            <div>
              <label htmlFor="cr-password" className="mb-1 block text-sm font-semibold text-ink-800">รหัสผ่าน</label>
              <input id="cr-password" name="password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required aria-required="true" aria-invalid={passwordInvalid} placeholder="อย่างน้อย 8 ตัวอักษร" />
              {passwordInvalid && <p className="mt-1 text-sm font-medium text-red-700">รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร</p>}
            </div>
          </div>
          {error && <div className="mt-4"><Alert tone="error" role="alert">{error}</Alert></div>}
          <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryButtonClass} mt-5 w-full`}>
            {busy ? "กำลังสมัครสมาชิก…" : "สมัครสมาชิก"}
          </button>
          <p className="mt-3 text-center text-sm text-ink-600">
            มีบัญชีแล้ว? <Link to="/customer/login" className="font-semibold text-brand-700 underline">เข้าสู่ระบบ</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
