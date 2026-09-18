import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ShopStatus } from "../../lib/api";
import { WEEKDAY_LABELS, fmtBangkok } from "../../lib/shop-week";
import { Alert, Badge, Panel, Spinner } from "../../components/ui";

function fmtMaybe(iso: string | null): string {
  if (!iso) return "-";
  return fmtBangkok(iso);
}

/** หน้าสาธารณะ: ดูได้โดยไม่ต้องเข้าสู่ระบบ */
export default function StatusPage() {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setStatus(await api.shopStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดสถานะร้านไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6">
      <a href="#status-main" className="ui-skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="text-center">
        <p
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white shadow-sm"
        >
          ป
        </p>
        <h1 className="mt-2 text-xl font-bold text-ink-900 sm:text-2xl">สถานะร้านป้าอ้ออาหารตามสั่ง</h1>
        <p className="mt-1 text-sm text-ink-600">ดูสถานะเปิด–ปิดและโต๊ะว่างได้โดยไม่ต้องเข้าสู่ระบบ</p>
      </header>

      <main id="status-main" aria-label="สถานะร้านปัจจุบัน">
        {loading ? (
          <p className="py-10 text-center">
            <Spinner label="กำลังโหลดสถานะร้าน…" />
          </p>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
            <button type="button" onClick={() => void load()} className="inline-flex min-h-[44px] items-center rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm transition-colors hover:bg-ink-50">
              ลองใหม่
            </button>
          </div>
        ) : status ? (
          <div className="space-y-4">
            <Panel label="สถานะร้านปัจจุบัน" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="pa-display text-lg text-ink-900">{status.shopName}</h2>
                <Badge tone={status.isOpen ? "success" : "danger"}>
                  {status.isOpen ? "เปิดรับบริการ" : "ปิดรับบริการ"}
                </Badge>
              </div>
              {status.isTemporary && (
                <Alert tone="info" role="status">
                  คำสั่งชั่วคราว{status.reason ? `: ${status.reason}` : ""}
                  {status.expectedReopenAt ? ` · คาดว่าจะเปิด ${fmtMaybe(status.expectedReopenAt)}` : ""}
                </Alert>
              )}
              {status.isOpen && status.serviceWindow && (
                <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-800">
                  รอบที่เปิดอยู่ขณะนี้: {status.serviceWindow.open}–{status.serviceWindow.close}
                  {status.serviceWindow.overnight ? " (ข้ามเที่ยงคืน)" : ""}
                  {status.serviceWindow.sourceWeekday !== String(status.today.weekday)
                    ? ` · ต่อเนื่องจากวัน${WEEKDAY_LABELS[Number(status.serviceWindow.sourceWeekday)]}`
                    : ""}
                </p>
              )}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-ink-50 px-3 py-2.5">
                  <dt className="font-semibold text-ink-700">เวลาทำการวันนี้ ({WEEKDAY_LABELS[status.today.weekday]} {status.today.date})</dt>
                  <dd className="mt-0.5 text-ink-900">
                    {status.today.closed || status.today.intervals.length === 0
                      ? "ปิดทั้งวัน"
                      : status.today.intervals.map((iv) => `${iv.open}–${iv.close}`).join(" · ")}
                  </dd>
                </div>
                <div className="rounded-xl bg-ink-50 px-3 py-2.5">
                  <dt className="font-semibold text-ink-700">โต๊ะและผู้ใช้บริการ</dt>
                  <dd className="mt-0.5 text-ink-900">
                    โต๊ะว่าง {status.tables.free} / พร้อมใช้งาน {status.tables.enabled} · ผู้ใช้บริการ {status.customerCount} คน
                  </dd>
                </div>
              </dl>
            </Panel>
            <p className="text-center text-sm text-ink-500">
              <Link to="/login" className="font-semibold text-brand-700 underline underline-offset-2">
                สำหรับพนักงาน: เข้าสู่ระบบหลังร้าน
              </Link>
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
