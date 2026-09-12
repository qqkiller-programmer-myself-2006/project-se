import { useEffect, useState } from "react";
import { api, type AuditItem } from "../lib/api";
import { Alert, Badge, PageHeader, Panel, Spinner, inputClass, secondaryButtonClass } from "../components/ui";

export const ACTION_LABELS: Record<string, string> = {
  login_success: "เข้าสู่ระบบสำเร็จ",
  login_failed: "เข้าสู่ระบบไม่สำเร็จ",
  logout: "ออกจากระบบ",
  user_created: "สร้างบัญชี",
  user_deactivated: "ปิดบัญชี",
  user_activated: "เปิดบัญชี",
  roles_changed: "เปลี่ยนบทบาท",
  password_changed: "เปลี่ยนรหัสผ่านตนเอง",
  password_reset: "รีเซ็ตรหัสผ่าน",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function fmtBangkok(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

type Category = "all" | "login" | "account";
type Result = "all" | "success" | "failed";

const CATEGORY_LABELS: Record<Category, string> = {
  all: "ทั้งหมด",
  login: "เข้าสู่ระบบ",
  account: "บัญชี/บทบาท",
};

const RESULT_LABELS: Record<Result, string> = {
  all: "ทั้งหมด",
  success: "สำเร็จ",
  failed: "ล้มเหลว",
};

export default function AuditPage() {
  const [logins, setLogins] = useState<AuditItem[]>([]);
  const [accounts, setAccounts] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("all");
  const [result, setResult] = useState<Result>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [l, a] = await Promise.all([api.loginAudit(), api.accountAudit()]);
        if (cancelled) return;
        setLogins(l.items);
        setAccounts(a.items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "โหลดประวัติไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function reload() {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [l, a] = await Promise.all([api.loginAudit(), api.accountAudit()]);
        setLogins(l.items);
        setAccounts(a.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "โหลดประวัติไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    })();
  }

  const shownLogins = logins.filter(
    (i) => result === "all" || (result === "success" ? i.success : !i.success),
  );
  const shownAccounts = accounts.filter(
    (i) => result === "all" || (result === "success" ? i.success : !i.success),
  );
  const totalShown = shownLogins.length + shownAccounts.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="ประวัติการใช้งาน (สำหรับ Owner)"
        description="ตรวจสอบการเข้าสู่ระบบสำเร็จ/ล้มเหลว และการเปลี่ยนแปลงบัญชีหรือบทบาท ข้อมูลเรียงจากล่าสุดและแสดงเวลา Asia/Bangkok"
        actions={
          <button type="button" onClick={reload} disabled={loading} className={secondaryButtonClass}>
            {loading ? "กำลังโหลด…" : "โหลดใหม่"}
          </button>
        }
      />

      {error && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}

      <Panel label="ตัวกรองประวัติ">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px] flex-1 sm:flex-none">
            <label htmlFor="audit-category" className="mb-1 block text-sm font-semibold text-ink-800">
              หมวด
            </label>
            <select
              id="audit-category"
              aria-label="กรองตามหมวด"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={`${inputClass} sm:w-52`}
            >
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px] flex-1 sm:flex-none">
            <label htmlFor="audit-result" className="mb-1 block text-sm font-semibold text-ink-800">
              ผล
            </label>
            <select
              id="audit-result"
              aria-label="กรองตามผล"
              value={result}
              onChange={(e) => setResult(e.target.value as Result)}
              className={`${inputClass} sm:w-52`}
            >
              {(Object.keys(RESULT_LABELS) as Result[]).map((r) => (
                <option key={r} value={r}>
                  {RESULT_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p aria-live="polite" className="mt-2 text-sm text-ink-600">
          {loading ? "กำลังโหลดประวัติ…" : `พบ ${totalShown} รายการตามเงื่อนไขปัจจุบัน`}
        </p>
      </Panel>

      {loading ? (
        <p className="py-8 text-center">
          <Spinner label="กำลังโหลดประวัติการใช้งาน…" />
        </p>
      ) : (
        <div aria-live="polite" className="space-y-5">
          {(category === "all" || category === "login") && (
            <Panel label="ประวัติการเข้าสู่ระบบ" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-ink-900">เข้าสู่ระบบสำเร็จ/ล้มเหลว</h2>
                <Badge tone="neutral">{shownLogins.length} รายการ</Badge>
              </div>
              {shownLogins.length === 0 ? (
                <EmptyState message="ยังไม่มีประวัติการเข้าสู่ระบบตามเงื่อนไขนี้" />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {shownLogins.map((i) => (
                    <li key={i.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                      <Badge tone={i.success ? "success" : "danger"}>{actionLabel(i.action)}</Badge>
                      <span className="font-semibold text-ink-900">ผู้ใช้: {i.targetUsername ?? "-"}</span>
                      <span className="text-sm text-ink-500">{fmtBangkok(i.at)}</span>
                      {i.detail && (
                        <span className="text-sm text-ink-600">{i.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {(category === "all" || category === "account") && (
            <Panel label="ประวัติบัญชีและบทบาท" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-ink-900">การเปลี่ยนบัญชี/บทบาท</h2>
                <Badge tone="neutral">{shownAccounts.length} รายการ</Badge>
              </div>
              {shownAccounts.length === 0 ? (
                <EmptyState message="ยังไม่มีประวัติบัญชี/บทบาทตามเงื่อนไขนี้" />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {shownAccounts.map((i) => (
                    <li key={i.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{actionLabel(i.action)}</Badge>
                        <Badge tone={i.success ? "success" : "danger"}>
                          {i.success ? "สำเร็จ" : "ล้มเหลว"}
                        </Badge>
                      </span>
                      <span className="text-sm text-ink-800">
                        <span className="font-semibold">{i.actorUsername ?? "-"}</span>
                        <span aria-hidden="true"> → </span>
                        <span className="font-semibold">{i.targetUsername ?? "-"}</span>
                      </span>
                      <span className="text-sm text-ink-500">{fmtBangkok(i.at)}</span>
                      {i.detail && (
                        <span className="text-sm text-ink-600">{i.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink-600">{message}</p>
    </div>
  );
}
