import { useCallback, useEffect, useState } from "react";
import {
  FINANCE_CATEGORY_LABELS,
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_INCOME_CATEGORIES,
  api,
  type AuditItem,
  type FinanceCategory,
  type FinanceEntry,
  type FinanceKind,
} from "../lib/api";
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
} from "../components/ui";
import { utcIsoToBangkokWall } from "../lib/bangkok-time";

function fmtBaht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

const KIND_LABELS: Record<FinanceKind, string> = {
  income: "รายรับมือ",
  expense: "รายจ่ายจริง",
};

/**
 * หน้าบันทึกรายรับมือ/รายจ่ายจริง (Ticket 11 — Owner/Admin เท่านั้น):
 * - CRUD พร้อมหมวด จำนวน วันเกิดรายการ หมายเหตุ เหตุผล และผู้บันทึก
 * - ทุก mutation มี audit trail (finance_entry_*) ดูได้ท้ายหน้า
 */
export default function FinanceEntriesPage() {
  const [kind, setKind] = useState<FinanceKind | "">("");
  const [items, setItems] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  const [fKind, setFKind] = useState<FinanceKind>("expense");
  const [fCategory, setFCategory] = useState<string>("ingredients");
  const [fAmount, setFAmount] = useState("");
  const [fOccurredAt, setFOccurredAt] = useState("");
  const [fNote, setFNote] = useState("");
  const [fReason, setFReason] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [eCategory, setECategory] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eOccurredAt, setEOccurredAt] = useState("");
  const [eNote, setENote] = useState("");
  const [eReason, setEReason] = useState("");
  const [rowMsg, setRowMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await api.financeEntries({ kind: kind || undefined })).entries);
      setAudit((await api.financeAudit()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการเงินไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(e: FinanceEntry) {
    setEditing(e);
    setECategory(e.category);
    setEAmount(String(e.amount));
    setEOccurredAt(utcIsoToBangkokWall(e.occurredAt) ?? "");
    setENote(e.note ?? "");
    setEReason("");
    setRowMsg(null);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormMsg(null);
    try {
      await api.financeEntryCreate({
        kind: fKind,
        category: fCategory,
        amount: Number(fAmount),
        occurredAt: fOccurredAt,
        note: fNote || null,
        reason: fReason,
      });
      setFormMsg({ tone: "success", text: "บันทึกรายการเงินแล้ว" });
      setFAmount("");
      setFOccurredAt("");
      setFNote("");
      setFReason("");
      await load();
    } catch (err) {
      setFormMsg({ tone: "error", text: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setFormBusy(false);
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setRowMsg(null);
    try {
      await api.financeEntryUpdate(editing.id, {
        category: eCategory,
        amount: Number(eAmount),
        occurredAt: eOccurredAt,
        note: eNote || null,
        reason: eReason,
      });
      setRowMsg({ tone: "success", text: "แก้ไขรายการเงินแล้ว" });
      setEditing(null);
      await load();
    } catch (err) {
      setRowMsg({ tone: "error", text: err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ" });
    } finally {
      setEditBusy(false);
    }
  }

  async function submitDelete(id: string) {
    setEditBusy(true);
    setRowMsg(null);
    try {
      await api.financeEntryDelete(id, deleteReason);
      setRowMsg({ tone: "success", text: "ลบรายการเงินแล้ว" });
      setDeletingId(null);
      setDeleteReason("");
      await load();
    } catch (err) {
      setRowMsg({ tone: "error", text: err instanceof Error ? err.message : "ลบไม่สำเร็จ" });
    } finally {
      setEditBusy(false);
    }
  }

  const categories = fKind === "expense" ? FINANCE_EXPENSE_CATEGORIES : FINANCE_INCOME_CATEGORIES;

  return (
    <div className="space-y-5">
      <PageHeader
        title="รายรับมือ / รายจ่ายจริง"
        description="บันทึกรายจ่ายจริง (ซื้อวัตถุดิบ ค่าแรง ค่าสาธารณูปโภค) และรายรับนอกคำสั่งซื้อ พร้อมเหตุผลและผู้บันทึกทุกครั้ง"
        actions={
          <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-ink-700">
            ประเภท
            <select value={kind} onChange={(e) => setKind(e.target.value as FinanceKind | "")} className={inputClass}>
              <option value="">ทั้งหมด</option>
              <option value="income">รายรับมือ</option>
              <option value="expense">รายจ่ายจริง</option>
            </select>
          </label>
        }
      />

      <Panel label="บันทึกรายการใหม่" labelledBy="fin-new-title">
        <h2 id="fin-new-title" className="text-base font-bold text-ink-900">
          บันทึกรายการใหม่
        </h2>
        {formMsg && (
          <div className="mt-2">
            <Alert tone={formMsg.tone === "success" ? "success" : "error"} role={formMsg.tone === "success" ? "status" : "alert"}>
              {formMsg.text}
            </Alert>
          </div>
        )}
        <form onSubmit={(e) => void submitCreate(e)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
            ประเภท
            <select
              value={fKind}
              onChange={(e) => {
                const k = e.target.value as FinanceKind;
                setFKind(k);
                setFCategory(k === "expense" ? "ingredients" : "other_income");
              }}
              className={inputClass}
            >
              <option value="expense">รายจ่ายจริง</option>
              <option value="income">รายรับมือ</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
            หมวดหมู่
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={inputClass}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {FINANCE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
            จำนวนเงิน (บาท)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={fAmount}
              onChange={(e) => setFAmount(e.target.value)}
              placeholder="เช่น 1500"
              required
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
            วันเกิดรายการ (กรุงเทพฯ)
            <input
              type="datetime-local"
              value={fOccurredAt}
              onChange={(e) => setFOccurredAt(e.target.value)}
              required
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700 sm:col-span-2">
            หมายเหตุ (ไม่บังคับ)
            <input
              type="text"
              value={fNote}
              onChange={(e) => setFNote(e.target.value)}
              maxLength={500}
              placeholder="เช่น บิลเลขที่ หรือรายละเอียดเพิ่มเติม"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700 sm:col-span-2">
            เหตุผล (บังคับ ใช้ตรวจสอบย้อนหลัง)
            <input
              type="text"
              value={fReason}
              onChange={(e) => setFReason(e.target.value)}
              maxLength={500}
              required
              placeholder="เช่น ซื้อหมู/ไก่ประจำสัปดาห์"
              className={inputClass}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={formBusy} className={primaryButtonClass}>
              {formBusy ? "กำลังบันทึก…" : "บันทึกรายการ"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel label="รายการเงิน" labelledBy="fin-list-title">
        <h2 id="fin-list-title" className="text-base font-bold text-ink-900">
          รายการเงิน ({items.length})
        </h2>
        {loading ? (
          <div className="mt-2">
            <Spinner label="กำลังโหลดรายการเงิน…" />
          </div>
        ) : error ? (
          <div className="mt-2">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-2">
            <Alert tone="info" role="status">
              ยังไม่มีรายการเงิน กดแบบฟอร์มด้านบนเพื่อบันทึกรายการแรก
            </Alert>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 dark:bg-ink-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.kind === "expense" ? "danger" : "success"}>{KIND_LABELS[e.kind]}</Badge>
                  <span className="font-semibold text-ink-900 dark:text-ink-50">
                    {(FINANCE_CATEGORY_LABELS[e.category as FinanceCategory] ?? e.category) as string}
                  </span>
                  <span className="ml-auto font-bold text-[#1E40AF] dark:text-blue-300">{fmtBaht(e.amount)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {utcIsoToBangkokWall(e.occurredAt)?.replace("T", " ")} น. · ผู้บันทึก {e.actorUsername ?? "-"}
                  {e.note ? ` · ${e.note}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(e)} className={secondaryButtonClass}>
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeletingId(e.id);
                      setDeleteReason("");
                      setRowMsg(null);
                    }}
                    className={dangerButtonClass}
                  >
                    ลบ
                  </button>
                </div>
                {deletingId === e.id && (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void submitDelete(e.id);
                    }}
                    className="mt-2 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3"
                  >
                    <label className="flex flex-col gap-1 text-sm font-semibold text-red-800">
                      เหตุผลการลบ (บังคับ)
                      <input
                        type="text"
                        value={deleteReason}
                        onChange={(ev) => setDeleteReason(ev.target.value)}
                        maxLength={500}
                        required
                        className={inputClass}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={editBusy} className={dangerButtonClass}>
                        {editBusy ? "กำลังลบ…" : "ยืนยันลบ"}
                      </button>
                      <button type="button" onClick={() => setDeletingId(null)} className={secondaryButtonClass}>
                        ยกเลิก
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {rowMsg && (
          <div className="mt-3">
            <Alert tone={rowMsg.tone === "success" ? "success" : "error"} role={rowMsg.tone === "success" ? "status" : "alert"}>
              {rowMsg.text}
            </Alert>
          </div>
        )}
        {editing && (
          <form
            onSubmit={(e) => void submitEdit(e)}
            className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-[#1E40AF]/25 bg-blue-50/50 p-3 sm:grid-cols-2"
          >
            <p className="text-sm font-bold text-ink-900 sm:col-span-2">กำลังแก้ไข: {KIND_LABELS[editing.kind]} · {fmtBaht(editing.amount)}</p>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
              หมวดหมู่
              <select
                value={eCategory}
                onChange={(e) => setECategory(e.target.value)}
                className={inputClass}
              >
                {(editing.kind === "expense" ? FINANCE_EXPENSE_CATEGORIES : FINANCE_INCOME_CATEGORIES).map((c) => (
                  <option key={c} value={c}>
                    {FINANCE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
              จำนวนเงิน (บาท)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={eAmount}
                onChange={(e) => setEAmount(e.target.value)}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
              วันเกิดรายการ (กรุงเทพฯ)
              <input
                type="datetime-local"
                value={eOccurredAt}
                onChange={(e) => setEOccurredAt(e.target.value)}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
              หมายเหตุ
              <input
                type="text"
                value={eNote}
                onChange={(e) => setENote(e.target.value)}
                maxLength={500}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700 sm:col-span-2">
              เหตุผลการแก้ไข (บังคับ)
              <input
                type="text"
                value={eReason}
                onChange={(e) => setEReason(e.target.value)}
                maxLength={500}
                required
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" disabled={editBusy} className={primaryButtonClass}>
                {editBusy ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
              </button>
              <button type="button" onClick={() => setEditing(null)} className={secondaryButtonClass}>
                ยกเลิก
              </button>
            </div>
          </form>
        )}
      </Panel>

      <Panel label="ประวัติการเงิน" labelledBy="fin-audit-title">
        <h2 id="fin-audit-title" className="text-base font-bold text-ink-900">
          ประวัติการเงิน
        </h2>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">ยังไม่มีประวัติ</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {audit.slice(0, 30).map((a) => (
              <li key={a.id} className="rounded-xl border border-ink-200 px-3 py-2 text-sm">
                <span className="font-semibold">{a.action}</span>{" "}
                <span className="text-ink-500">โดย {a.actorUsername ?? "-"} · {a.detail ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
