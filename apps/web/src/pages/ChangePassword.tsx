import { useState } from "react";
import { api } from "../lib/api";
import { Alert, Panel, inputClass, primaryButtonClass } from "../components/ui";

export default function ChangePasswordPage({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const currentInvalid = touched && currentPassword === "";
  const newInvalid = touched && newPassword.length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (currentPassword === "" || newPassword.length < 8) {
      setError(
        currentPassword === ""
          ? "กรุณากรอกรหัสผ่านปัจจุบัน"
          : "รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร",
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      setError(null);
      setOk(null);
      const res = await api.changePassword(currentPassword, newPassword);
      setOk(res.message);
      setCurrent(""); // ล้างรหัสผ่านออกจาก state ทันทีที่สำเร็จ
      setNew("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">เปลี่ยนรหัสผ่านของฉัน</h1>
        <p className="mt-1 text-sm text-ink-600">
          ตั้งรหัสผ่านใหม่ที่เดายากและไม่ซ้ำกับที่อื่น หลังเปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์
        </p>
      </div>

      <Panel label="เปลี่ยนรหัสผ่าน">
        <form onSubmit={submit} noValidate aria-label="ฟอร์มเปลี่ยนรหัสผ่าน" aria-busy={busy} className="space-y-4">
          <ul className="list-disc space-y-1 rounded-xl bg-ink-50 px-4 py-3 pl-8 text-sm text-ink-700">
            <li>รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร</li>
            <li>ควรมีทั้งตัวอักษรและตัวเลข หลีกเลี่ยงวันเกิดหรือเบอร์โทร</li>
            <li>อย่าบอกรหัสผ่านให้ผู้อื่นทราบ</li>
          </ul>

          <div>
            <label htmlFor="current" className="mb-1 block text-sm font-semibold text-ink-800">
              รหัสผ่านปัจจุบัน
            </label>
            <input
              id="current"
              name="current-password"
              type="password"
              className={inputClass}
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              aria-required="true"
              aria-invalid={currentInvalid}
              placeholder="รหัสผ่านที่ใช้อยู่ตอนนี้"
            />
            {currentInvalid && (
              <p className="mt-1 text-sm font-medium text-red-700">กรุณากรอกรหัสผ่านปัจจุบัน</p>
            )}
          </div>
          <div>
            <label htmlFor="next" className="mb-1 block text-sm font-semibold text-ink-800">
              รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)
            </label>
            <input
              id="next"
              name="new-password"
              type="password"
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              aria-required="true"
              aria-invalid={newInvalid}
              aria-describedby="new-password-hint"
              placeholder="รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร"
            />
            <p id="new-password-hint" className="mt-1 text-xs text-ink-500">
              ความยาวปัจจุบัน {newPassword.length} / 8 ตัวอักษรขั้นต่ำ
            </p>
            {newInvalid && (
              <p className="mt-1 text-sm font-medium text-red-700">รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร</p>
            )}
          </div>

          {error && (
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          )}
          {ok && (
            <Alert tone="success" role="status">
              {ok}
            </Alert>
          )}
          <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryButtonClass} w-full sm:w-auto`}>
            {busy && <span className="ui-spinner" aria-hidden="true" />}
            {busy ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
