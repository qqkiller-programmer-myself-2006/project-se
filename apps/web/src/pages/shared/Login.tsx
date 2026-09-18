import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Alert, inputClass, primaryButtonClass } from "../../components/ui";

export default function LoginPage({ onLoggedIn }: { onLoggedIn?: () => Promise<void> }) {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const usernameInvalid = touched && username.trim() === "";
  const passwordInvalid = touched && password === "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!username.trim() || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      setPassword("");
      // รีเฟรช session ระดับ App ก่อนนำทาง ไม่เช่นนั้น App ยังเห็น me=null แล้ววนกลับหน้าล็อกอิน
      await onLoggedIn?.();
      nav("/staff");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-center py-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 text-center">
          <p
            aria-hidden="true"
            className="pa-display mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-ink-900 text-lg text-gold-200"
          >
            ป
          </p>
          <p className="luxe-kicker mt-3">ร้านป้าอ้ออาหารตามสั่ง · หลังร้าน</p>
        </div>
        <form
          onSubmit={submit}
          noValidate
          aria-label="ฟอร์มเข้าสู่ระบบ"
          aria-busy={busy}
          className="luxe-card w-full p-6 sm:p-7"
        >
          <div className="space-y-1">
            <h1 className="pa-display text-center text-2xl text-ink-900">เข้าสู่ระบบพนักงาน</h1>
            <p className="text-center text-sm text-ink-600">
              สำหรับพนักงานและเจ้าของร้านเท่านั้น โปรดใช้ชื่อผู้ใช้ที่ได้รับจากเจ้าของร้าน
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="username" className="mb-1 block text-sm font-semibold text-ink-800">
                ชื่อผู้ใช้
              </label>
              <input
                id="username"
                name="username"
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                maxLength={64}
                aria-required="true"
                aria-invalid={usernameInvalid}
                aria-describedby={usernameInvalid ? "username-error" : undefined}
                placeholder="เช่น kitchen1"
              />
              {usernameInvalid && (
                <p id="username-error" className="mt-1 text-sm font-medium text-red-700">
                  กรุณากรอกชื่อผู้ใช้
                </p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink-800">
                รหัสผ่าน
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={passwordInvalid}
                aria-describedby={passwordInvalid ? "password-error" : "login-hint"}
                placeholder="รหัสผ่านของบัญชีพนักงาน"
              />
              {passwordInvalid ? (
                <p id="password-error" className="mt-1 text-sm font-medium text-red-700">
                  กรุณากรอกรหัสผ่าน
                </p>
              ) : (
                <p id="login-hint" className="mt-1 text-xs text-ink-500">
                  ลืมรหัสผ่าน? โปรดติดต่อเจ้าของร้านเพื่อรีเซ็ต ไม่มีสมัครสมาชิกจากหน้านี้
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4">
              <Alert tone="error" role="alert">
                {error}
              </Alert>
            </div>
          )}
          <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryButtonClass} mt-5 w-full`}>
            {busy && (
              <span className="ui-spinner" aria-hidden="true" />
            )}
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </button>
          <p className="mt-3 text-center text-xs text-ink-500">
            ระบบจะล็อกชั่วคราวหากกรอกรหัสผิดหลายครั้งติดกันเพื่อความปลอดภัย
          </p>
        </form>
      </div>
    </div>
  );
}
