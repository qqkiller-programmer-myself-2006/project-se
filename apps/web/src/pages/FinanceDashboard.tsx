import { useCallback, useEffect, useState } from "react";
import {
  api,
  type FinanceCsvKind,
  type FinanceDashboard,
  type FinanceGranularity,
  type FinanceReport,
} from "../lib/api";
import { Alert, Badge, PageHeader, Panel, Spinner, inputClass, secondaryButtonClass } from "../components/ui";

function fmtBaht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function todayBangkok(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function padHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

const GRANULARITY_LABELS: Record<FinanceGranularity, string> = {
  day: "รายวัน",
  month: "รายเดือน",
  year: "รายปี",
};

const CSV_KIND_LABELS: Record<FinanceCsvKind, string> = {
  sales: "ยอดขาย",
  orders: "คำสั่งซื้อ",
  finance: "รายรับ/รายจ่ายมือ",
  stock: "สต๊อก",
  queue: "เวลาคิว",
};

/**
 * Dashboard การเงิน Owner/Admin (Ticket 11):
 * - KPI วันนี้: ยอดขายสุทธิ, คำสั่งซื้อที่ชำระ, บิลเฉลี่ย, กำไรเบื้องต้น,
 *   เมนูขายดี top5, ชั่วโมงหนาแน่น, occupancy, สต๊อกต่ำ
 * - รายงาน day/month/year + วิเคราะห์ + ส่งออก CSV (UTF-8 BOM, PII masking)
 * - รายรับนับ paid ครั้งเดียวหัก refunds; ต้นทุนประมาณการแสดงแยก ไม่หักซ้ำ
 */
export default function FinanceDashboardPage() {
  const [date, setDate] = useState(todayBangkok());
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [granularity, setGranularity] = useState<FinanceGranularity>("day");
  const [from, setFrom] = useState(todayBangkok());
  const [to, setTo] = useState(todayBangkok());
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      setDashboard((await api.financeDashboard(d)).dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด Dashboard ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReport() {
    setReportLoading(true);
    setReportError(null);
    try {
      setReport((await api.financeReport({ granularity, from, to })).report);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "โหลดรายงานไม่สำเร็จ");
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxPeak = Math.max(1, ...(dashboard?.peakHours.map((h) => h.revenue) ?? [1]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard การเงิน"
        description="ยอดขายสุทธิจากคำสั่งซื้อที่ชำระ (นับครั้งเดียว หักคืนเงินแล้ว) รวมกับรายรับมือ หักรายจ่ายจริง ต้นทุนประมาณการแสดงแยกเพื่อวิเคราะห์"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="fin-date" className="text-sm font-semibold text-ink-700">
              วันที่ (กรุงเทพฯ)
            </label>
            <input
              id="fin-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            <button type="button" onClick={() => void loadDashboard(date)} className={secondaryButtonClass}>
              โหลดใหม่
            </button>
          </div>
        }
      />

      {loading ? (
        <Panel label="กำลังโหลด Dashboard">
          <Spinner label="กำลังโหลด Dashboard การเงิน…" />
        </Panel>
      ) : error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : dashboard ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Panel label="ยอดขายสุทธิ" className="border-[#1E40AF]/20 bg-[#F8FAFC] dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500">ยอดขายสุทธิ (หักคืนเงิน)</p>
              <p className="mt-1 text-2xl font-bold text-[#1E40AF] dark:text-blue-300" aria-live="polite">
                {fmtBaht(dashboard.netSales)}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                รับรวม {fmtBaht(dashboard.grossRevenue)} · คืน {fmtBaht(dashboard.refunds)}
              </p>
            </Panel>
            <Panel label="คำสั่งซื้อที่ชำระ" className="border-[#3B82F6]/20 bg-[#F8FAFC] dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500">คำสั่งซื้อที่ชำระ</p>
              <p className="mt-1 text-2xl font-bold text-[#1E40AF] dark:text-blue-300" aria-live="polite">
                {dashboard.paidOrders.toLocaleString("th-TH")} <span className="text-sm font-medium">บิล</span>
              </p>
              <p className="mt-1 text-xs text-ink-500">บิลเฉลี่ย {fmtBaht(dashboard.averageTicket)}</p>
            </Panel>
            <Panel label="กำไรเบื้องต้น" className="border-[#D97706]/25 bg-[#F8FAFC] dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500">กำไรเบื้องต้น</p>
              <p className="mt-1 text-2xl font-bold text-[#D97706]" aria-live="polite">
                {fmtBaht(dashboard.grossProfit)}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                รับมือ {fmtBaht(dashboard.manualIncome)} · จ่ายจริง {fmtBaht(dashboard.actualExpense)}
              </p>
            </Panel>
            <Panel label="ต้นทุนประมาณการ" className="bg-[#F8FAFC] dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500">ต้นทุนวัตถุดิบ (ประมาณการ)</p>
              <p className="mt-1 text-2xl font-bold text-ink-800 dark:text-ink-100" aria-live="polite">
                {fmtBaht(dashboard.estimatedCost)}
              </p>
              <p className="mt-1 text-xs text-ink-500">เพื่อวิเคราะห์เท่านั้น ไม่หักซ้ำในกำไร</p>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel label="เมนูขายดี 5 อันดับ" labelledBy="fin-top-title">
              <h2 id="fin-top-title" className="text-base font-bold text-ink-900">
                เมนูขายดี 5 อันดับ
              </h2>
              {dashboard.topMenus.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">ยังไม่มียอดขายในวันที่เลือก</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {dashboard.topMenus.map((m, i) => (
                    <li
                      key={m.menuId}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-3 py-2 dark:bg-ink-800"
                    >
                      <span className="min-w-0">
                        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1E40AF] text-xs font-bold text-white" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className="font-semibold text-ink-900 dark:text-ink-50">{m.menuName}</span>{" "}
                        <span className="text-xs text-ink-500">× {m.quantity.toLocaleString("th-TH")}</span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-[#1E40AF] dark:text-blue-300">
                        {fmtBaht(m.revenue)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel label="ชั่วโมงหนาแน่น" labelledBy="fin-peak-title">
              <h2 id="fin-peak-title" className="text-base font-bold text-ink-900">
                ชั่วโมงหนาแน่น (กรุงเทพฯ)
              </h2>
              {dashboard.peakHours.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">ยังไม่มียอดขายในวันที่เลือก</p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {[...dashboard.peakHours]
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 8)
                    .map((h) => (
                      <li key={h.hour} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-xs font-semibold text-ink-600">{padHour(h.hour)}</span>
                        <span
                          className="h-4 min-w-1 rounded bg-[#3B82F6]"
                          style={{ width: `${Math.max(4, Math.round((h.revenue / maxPeak) * 100))}%` }}
                          role="img"
                          aria-label={`${padHour(h.hour)} ยอด ${fmtBaht(h.revenue)} ${h.paidOrders} บิล`}
                        />
                        <span className="shrink-0 text-xs text-ink-600">
                          {fmtBaht(h.revenue)} · {h.paidOrders} บิล
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel label="สถานะโต๊ะและผู้ใช้บริการ" labelledBy="fin-occ-title">
              <h2 id="fin-occ-title" className="text-base font-bold text-ink-900">
                สถานะโต๊ะและผู้ใช้บริการ
              </h2>
              {dashboard.occupancy ? (
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-ink-200 px-3 py-2">
                    <dt className="text-xs text-ink-500">โต๊ะพร้อมใช้</dt>
                    <dd className="text-lg font-bold">{dashboard.occupancy.enabledTables}</dd>
                  </div>
                  <div className="rounded-xl border border-ink-200 px-3 py-2">
                    <dt className="text-xs text-ink-500">โต๊ะว่าง / ไม่ว่าง</dt>
                    <dd className="text-lg font-bold">
                      {dashboard.occupancy.freeTables} / {dashboard.occupancy.occupiedTables}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-ink-200 px-3 py-2">
                    <dt className="text-xs text-ink-500">ผู้ใช้บริการจริง</dt>
                    <dd className="text-lg font-bold">{dashboard.occupancy.customerCount} คน</dd>
                  </div>
                  <div className="rounded-xl border border-ink-200 px-3 py-2">
                    <dt className="text-xs text-ink-500">วัตถุดิบใกล้หมด</dt>
                    <dd className="text-lg font-bold">
                      {dashboard.lowStockCount} รายการ{" "}
                      {dashboard.lowStockCount > 0 && <Badge tone="danger">ต้องเติม</Badge>}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-ink-500">ไม่มีข้อมูลโต๊ะ (ยังไม่ตั้งค่าโต๊ะในระบบ)</p>
              )}
            </Panel>

            <Panel label="ส่งออก CSV" labelledBy="fin-csv-title">
              <h2 id="fin-csv-title" className="text-base font-bold text-ink-900">
                ส่งออก CSV
              </h2>
              <p className="mt-1 text-xs text-ink-500">
                UTF-8 พร้อม BOM เปิดใน Excel ได้เลย · ปกปิดชื่อ/เบอร์ลูกค้าแล้ว · ช่วง {from} ถึง {to}
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(CSV_KIND_LABELS) as FinanceCsvKind[]).map((k) => (
                  <li key={k}>
                    <a
                      href={api.financeExportUrl(k, from, to)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#1E40AF]/30 bg-white px-3 py-2 text-sm font-semibold text-[#1E40AF] hover:bg-blue-50 dark:bg-ink-800 dark:text-blue-300"
                    >
                      {CSV_KIND_LABELS[k]}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      ) : (
        <Alert tone="info" role="status">
          ไม่มีข้อมูล Dashboard
        </Alert>
      )}

      <Panel label="รายงานการเงิน" labelledBy="fin-report-title">
        <div className="flex flex-wrap items-end gap-2">
          <h2 id="fin-report-title" className="w-full text-base font-bold text-ink-900">
            รายงานการเงิน
          </h2>
          <label className="flex min-h-[44px] flex-col text-xs font-semibold text-ink-600">
            ความละเอียด
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as FinanceGranularity)}
              className={inputClass}
            >
              {(Object.keys(GRANULARITY_LABELS) as FinanceGranularity[]).map((g) => (
                <option key={g} value={g}>
                  {GRANULARITY_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-[44px] flex-col text-xs font-semibold text-ink-600">
            จาก (กรุงเทพฯ)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex min-h-[44px] flex-col text-xs font-semibold text-ink-600">
            ถึง (กรุงเทพฯ)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
          <button type="button" onClick={() => void loadReport()} className={secondaryButtonClass} disabled={reportLoading}>
            {reportLoading ? "กำลังโหลด…" : "ดูรายงาน"}
          </button>
        </div>

        {reportLoading ? (
          <div className="mt-3">
            <Spinner label="กำลังโหลดรายงาน…" />
          </div>
        ) : reportError ? (
          <div className="mt-3">
            <Alert tone="error" role="alert">
              {reportError}
            </Alert>
          </div>
        ) : report ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-[#1E40AF] text-left text-white">
                  <th scope="col" className="px-3 py-2 font-semibold">ช่วง</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">รับรวม</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">คืนเงิน</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">สุทธิ</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">บิล</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">รับมือ</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">จ่ายจริง</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">กำไร</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">ต้นทุน(ประมาณ)</th>
                </tr>
              </thead>
              <tbody>
                {report.buckets.map((b) => (
                  <tr key={b.bucket} className="border-t border-ink-200">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">{b.bucket}</th>
                    <td className="px-3 py-2 text-right">{b.grossRevenue.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right">{b.refunds.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right font-semibold">{b.netRevenue.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right">{b.paidOrders.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right">{b.manualIncome.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right">{b.actualExpense.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#1E40AF] dark:text-blue-300">
                      {b.grossProfit.toLocaleString("th-TH")}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-500">{b.estimatedCost.toLocaleString("th-TH")}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#1E40AF]/40 bg-blue-50/50 font-bold dark:bg-ink-800">
                  <th scope="row" className="px-3 py-2 text-left">รวม</th>
                  <td className="px-3 py-2 text-right">{report.total.grossRevenue.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.refunds.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.netRevenue.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.paidOrders.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.manualIncome.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.actualExpense.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.grossProfit.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-right">{report.total.estimatedCost.toLocaleString("th-TH")}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-500">
              กำไรเบื้องต้น = สุทธิ + รับมือ − จ่ายจริง (หน่วย: บาท) · ต้นทุนประมาณการไม่หักซ้ำ
            </p>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
