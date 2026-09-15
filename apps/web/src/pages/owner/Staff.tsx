import { useEffect, useState } from "react";
import { api, ROLE_LABELS, type PublicUser, type Role } from "../../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  Spinner,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  successButtonClass,
} from "../../components/ui";

// หน้านี้แสดงเฉพาะ Owner (App ซ่อน route ไว้แล้ว) Owner กำหนดได้เฉพาะ admin/kitchen/drink
const ROLE_OPTIONS: Role[] = ["admin", "kitchen", "drink"];

type DoneFn = (m: { fn: () => Promise<unknown>; msg: string }) => Promise<void>;

export default function StaffPage({ me }: { me: PublicUser }) {
  void me;
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "", roles: ["kitchen"] as Role[] });
  const [resetFor, setResetFor] = useState<PublicUser | null>(null);
  const [newPass, setNewPass] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function refresh() {
    try {
      setError(null);
      setUsers((await api.listUsers()).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function toggleRole(list: Role[], r: Role): Role[] {
    return list.includes(r) ? list.filter((x) => x !== r) : [...list, r];
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return; // กันกดซ้ำ
    setCreating(true);
    try {
      setError(null);
      setNotice(null);
      await api.createUser(form.username.trim(), form.password, form.roles);
      setNotice(`สร้างบัญชี ${form.username.trim()} แล้ว`);
      setForm({ username: "", password: "", roles: ["kitchen"] }); // ล้างรหัสผ่านออกจาก state
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างบัญชีไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg: string): Promise<void> {
    try {
      setError(null);
      setNotice(null);
      await fn();
      setNotice(okMsg);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ");
    }
  }

  const roleOptions = ROLE_OPTIONS;
  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการพนักงาน"
        description="สร้าง ปิด/เปิดบัญชี และกำหนดบทบาทพนักงาน เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการในหน้านี้ได้ การเปลี่ยนแปลงมีผลทันทีและถูกบันทึกในประวัติ"
      />

      <div aria-live="polite" className="space-y-3">
        {error && (
          <Alert tone="error" role="alert" ariaLive="assertive">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="success" role="status">
            {notice}
          </Alert>
        )}
      </div>

      <Panel label="สร้างบัญชีพนักงาน" className="space-y-4">
        <div>
          <h2 className="font-semibold text-ink-900">สร้างบัญชีพนักงาน</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            ตั้งชื่อผู้ใช้ภาษาอังกฤษ รหัสผ่านอย่างน้อย 8 ตัวอักษร และเลือกบทบาทอย่างน้อย 1 บทบาท
          </p>
        </div>
        <form onSubmit={create} aria-label="ฟอร์มสร้างพนักงาน" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="new-username" className="mb-1 block text-sm font-semibold text-ink-800">
                ชื่อผู้ใช้
              </label>
              <input
                id="new-username"
                name="new-username"
                className={inputClass}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="off"
                maxLength={64}
                placeholder="เช่น kitchen1"
              />
              <p className="mt-1 text-xs text-ink-500">ใช้เข้าสู่ระบบแทนชื่อจริง ไม่ซ้ำกับบัญชีเดิม</p>
            </div>
            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm font-semibold text-ink-800">
                รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                className={inputClass}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
                placeholder="ตั้งรหัสผ่านเริ่มต้นให้พนักงาน"
              />
              <p className="mt-1 text-xs text-ink-500">แจ้งรหัสผ่านให้พนักงานทางช่องทางปลอดภัย แล้วให้พนักงานเปลี่ยนเอง</p>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-ink-800">บทบาท</legend>
              <div className="flex flex-wrap gap-2">
                {roleOptions.map((r) => (
                  <label
                    key={r}
                    className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                      form.roles.includes(r)
                        ? "border-brand-600 bg-brand-50 text-brand-800"
                        : "border-ink-300 bg-white text-ink-700 hover:border-ink-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-orange-700"
                      checked={form.roles.includes(r)}
                      onChange={() => setForm({ ...form, roles: toggleRole(form.roles, r) })}
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-500">หนึ่งบัญชีมีได้หลายบทบาท (ครัว/เครื่องดื่ม/ผู้ดูแลระบบ)</p>
            </fieldset>
          </div>
          <button type="submit" disabled={creating} aria-busy={creating} className={primaryButtonClass}>
            {creating && <span className="ui-spinner" aria-hidden="true" />}
            {creating ? "กำลังสร้าง…" : "สร้างบัญชี"}
          </button>
        </form>
      </Panel>

      <Panel label="รายชื่อพนักงาน" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink-900">
            รายชื่อพนักงาน{" "}
            <span className="text-sm font-medium text-ink-500">
              (ทั้งหมด {users.length} · ใช้งานอยู่ {activeCount})
            </span>
          </h2>
          <button type="button" onClick={() => void refresh()} disabled={loading} className={secondaryButtonClass}>
            {loading ? "กำลังโหลด…" : "โหลดใหม่"}
          </button>
        </div>

        {loading ? (
          <p className="py-6 text-center">
            <Spinner label="กำลังโหลดรายชื่อพนักงาน…" />
          </p>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-8 text-center">
            <p className="font-semibold text-ink-800">ยังไม่มีบัญชีพนักงาน</p>
            <p className="mt-1 text-sm text-ink-600">สร้างบัญชีแรกจากแบบฟอร์มด้านบน ระบบจะแสดงรายชื่อที่นี่</p>
          </div>
        ) : (
          <>
            {/* คอมพิวเตอร์: ตาราง */}
            <div className="hidden overflow-x-auto rounded-xl border border-ink-200 md:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-ink-700">
                    <th scope="col" className="p-3 font-semibold">ชื่อผู้ใช้</th>
                    <th scope="col" className="p-3 font-semibold">บทบาท</th>
                    <th scope="col" className="p-3 font-semibold">สถานะ</th>
                    <th scope="col" className="p-3 font-semibold">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {users.map((u) => (
                    <UserRow key={u.id} u={u} me={me} onDone={(m) => run(m.fn, m.msg)} onReset={setResetFor} />
                  ))}
                </tbody>
              </table>
            </div>
            {/* มือถือ: การ์ด */}
            <div className="space-y-3 md:hidden">
              {users.map((u) => (
                <article key={u.id} className="space-y-2.5 rounded-xl border border-ink-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-bold text-ink-900">{u.username}</p>
                    <StatusBadge isActive={u.isActive} />
                  </div>
                  <p className="text-sm text-ink-600">{u.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</p>
                  <UserActions u={u} me={me} onDone={(m) => run(m.fn, m.msg)} onReset={setResetFor} />
                </article>
              ))}
            </div>
          </>
        )}
      </Panel>

      {resetFor && (
        <Panel label="รีเซ็ตรหัสผ่าน">
          <form
            aria-label="ฟอร์มรีเซ็ตรหัสผ่าน"
            onSubmit={(e) => {
              e.preventDefault();
              if (resetting) return;
              const target = resetFor;
              const pw = newPass;
              setResetting(true);
              void (async () => {
                try {
                  await run(() => api.resetPassword(target.id, pw), `รีเซ็ตรหัสผ่านของ ${target.username} แล้ว เซสชันเดิมถูกยกเลิก`);
                  setResetFor(null);
                } finally {
                  setNewPass(""); // ล้างรหัสผ่านออกจาก state เสมอ
                  setResetting(false);
                }
              })();
            }}
            className="space-y-3"
          >
            <div>
              <h2 className="font-semibold text-ink-900">รีเซ็ตรหัสผ่านของ {resetFor.username}</h2>
              <p className="mt-0.5 text-sm text-ink-600">
                ตั้งรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร หลังรีเซ็ตเซสชันเดิมถูกยกเลิก พนักงานต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์
                กรุณาแจ้งรหัสผ่านใหม่ให้เจ้าตัวทางช่องทางปลอดภัย
              </p>
            </div>
            <div>
              <label htmlFor="reset-new-password" className="mb-1 block text-sm font-semibold text-ink-800">
                รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)
              </label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                className={`${inputClass} max-w-sm`}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="รหัสผ่านใหม่ของพนักงาน"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={resetting} aria-busy={resetting} className={primaryButtonClass}>
                {resetting && <span className="ui-spinner" aria-hidden="true" />}
                {resetting ? "กำลังรีเซ็ต…" : "ยืนยันรีเซ็ต"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetFor(null);
                  setNewPass("");
                }}
                className={secondaryButtonClass}
              >
                ยกเลิก
              </button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return <Badge tone={isActive ? "active" : "inactive"}>{isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}</Badge>;
}

function UserRow({
  u,
  me,
  onDone,
  onReset,
}: {
  u: PublicUser;
  me: PublicUser;
  onDone: DoneFn;
  onReset: (u: PublicUser) => void;
}) {
  return (
    <tr className="align-top transition-colors hover:bg-brand-50/60">
      <td className="p-3 font-semibold text-ink-900">{u.username}</td>
      <td className="p-3 text-ink-700">{u.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</td>
      <td className="p-3">
        <StatusBadge isActive={u.isActive} />
      </td>
      <td className="p-3">
        <UserActions u={u} me={me} onDone={onDone} onReset={onReset} />
      </td>
    </tr>
  );
}

function UserActions({
  u,
  me,
  onDone,
  onReset,
}: {
  u: PublicUser;
  me: PublicUser;
  onDone: DoneFn;
  onReset: (u: PublicUser) => void;
}) {
  void me;
  // Owner-only: server บังคับสิทธิ์ซ้ำทุกครั้ง (ห้ามปิด Owner คนสุดท้าย/ปิดบัญชีตนเอง)
  const [roles, setRoles] = useState<Role[]>(u.roles.filter((r) => r !== "owner"));
  const [busy, setBusy] = useState(false);

  function toggle(r: Role) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function act(m: { fn: () => Promise<unknown>; msg: string }) {
    if (busy) return; // กันกดซ้ำระหว่างรอผล
    setBusy(true);
    try {
      await onDone(m);
    } finally {
      setBusy(false);
    }
  }

  const isOwnerRow = u.roles.includes("owner");

  return (
    <div className="flex flex-col gap-2.5" aria-busy={busy}>
      <fieldset className="rounded-xl bg-ink-50 p-2.5" disabled={busy || isOwnerRow}>
        <legend className="px-1 text-xs font-semibold text-ink-600">บทบาทของ {u.username}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["admin", "kitchen", "drink"] as Role[]).map((r) => (
            <label
              key={r}
              className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                roles.includes(r)
                  ? "border-brand-600 bg-white text-brand-800"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-700"
                checked={roles.includes(r)}
                onChange={() => toggle(r)}
                aria-label={`${ROLE_LABELS[r]} ของ ${u.username}`}
              />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
        {isOwnerRow && (
          <p className="mt-1 px-1 text-xs text-ink-500">บัญชีเจ้าของร้านไม่แก้ไขบทบาทจากหน้านี้</p>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`จัดการบัญชี ${u.username}`}>
        {!isOwnerRow && (
          <button
            type="button"
            disabled={busy}
            className={secondaryButtonClass}
            onClick={() => void act({ fn: () => api.setRoles(u.id, roles), msg: `ปรับบทบาท ${u.username} แล้ว` })}
          >
            {busy ? "กำลังบันทึก…" : "บันทึกบทบาท"}
          </button>
        )}
        {!isOwnerRow &&
          (u.isActive ? (
            <button
              type="button"
              disabled={busy}
              className={dangerButtonClass}
              onClick={() => void act({ fn: () => api.deactivate(u.id), msg: `ปิดบัญชี ${u.username} แล้ว` })}
            >
              ปิดบัญชี
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={successButtonClass}
              onClick={() => void act({ fn: () => api.activate(u.id), msg: `เปิดบัญชี ${u.username} แล้ว` })}
            >
              เปิดบัญชี
            </button>
          ))}
        {!isOwnerRow && (
          <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => onReset(u)}>
            รีเซ็ตรหัสผ่าน
          </button>
        )}
      </div>
    </div>
  );
}
