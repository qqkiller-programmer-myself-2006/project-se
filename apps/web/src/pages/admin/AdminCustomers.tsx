import { useCallback, useEffect, useState } from "react";
import { api, type AdminCustomerDetail, type AdminCustomerItem } from "../../lib/api";
import { Alert, Badge, dangerButtonClass, inputClass, PageHeader, Panel, secondaryButtonClass, Spinner, successButtonClass } from "../../components/ui";

export default function AdminCustomersPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminCustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminCustomerDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const search = useCallback(async (needle: string) => {
    setSearching(true);
    setError(null);
    try {
      setItems((await api.adminCustomers(needle)).customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void search("");
  }, [search]);

  async function openDetail(id: string) {
    setDetailBusy(true);
    setActionMsg(null);
    try {
      setSelected(await api.adminCustomerDetail(id));
    } catch (err) {
      setActionMsg({ tone: "error", text: err instanceof Error ? err.message : "ดูรายละเอียดไม่สำเร็จ" });
    } finally {
      setDetailBusy(false);
    }
  }

  async function setActive(id: string, active: boolean) {
    setDetailBusy(true);
    setActionMsg(null);
    try {
      const updated = active ? await api.adminCustomerActivate(id) : await api.adminCustomerDeactivate(id);
      setSelected((prev) => (prev ? { ...prev, customer: updated.customer } : prev));
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, isActive: updated.customer.isActive } : c)));
      setActionMsg({ tone: "success", text: active ? "เปิดบัญชีแล้ว" : "ปิดบัญชีแล้วยกเลิกเซสชันทั้งหมดแล้ว" });
    } catch (err) {
      setActionMsg({ tone: "error", text: err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ" });
    } finally {
      setDetailBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="จัดการสมาชิก" description="ค้นหา ดูรายละเอียด และปิด/เปิดบัญชีลูกค้า (เฉพาะ Owner/Admin)" />
      <Panel label="ค้นหาสมาชิก">
        <form
          role="search"
          aria-label="ค้นหาสมาชิก"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="mc-q" className="sr-only">ค้นหาด้วยชื่อ เบอร์โทร หรืออีเมล</label>
          <input id="mc-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาด้วยชื่อ เบอร์โทร หรืออีเมล" />
          <button type="submit" disabled={searching} aria-busy={searching} className={secondaryButtonClass}>
            {searching ? "กำลังค้น…" : "ค้นหา"}
          </button>
        </form>
        {error && <div className="mt-3"><Alert tone="error" role="alert">{error}</Alert></div>}
        <div className="mt-3" aria-live="polite">
          {loading ? (
            <Spinner label="กำลังโหลดรายชื่อสมาชิก…" />
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-3 py-6 text-center text-sm text-ink-600">
              {q ? `ไม่พบสมาชิกที่ตรงกับ “${q}”` : "ยังไม่มีบัญชีสมาชิก"}
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200" aria-label="รายชื่อสมาชิก">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openDetail(c.id)}
                    className="flex w-full min-h-[44px] flex-wrap items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-brand-50"
                  >
                    <span className="font-semibold text-ink-900">{c.isDeleted ? "ลูกค้าที่ลบบัญชี" : c.name}</span>
                    <span className="text-sm text-ink-600">{c.phone ?? "—"}</span>
                    <span className="flex flex-wrap gap-1">
                      {c.isDeleted ? (
                        <Badge tone="neutral">ลบบัญชีแล้ว</Badge>
                      ) : c.isActive ? (
                        <Badge tone="active">ใช้งาน</Badge>
                      ) : (
                        <Badge tone="inactive">ปิดใช้งาน</Badge>
                      )}
                      {c.lineLinked && <Badge tone="brand">LINE</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {selected && (
        <Panel label={`รายละเอียดสมาชิก ${selected.customer.name}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="pa-display text-base text-ink-900">{selected.customer.isDeleted ? "ลูกค้าที่ลบบัญชี" : selected.customer.name}</h2>
            {selected.customer.isDeleted ? <Badge tone="neutral">ลบบัญชีแล้ว</Badge> : selected.customer.isActive ? <Badge tone="active">ใช้งาน</Badge> : <Badge tone="inactive">ปิดใช้งาน</Badge>}
            {selected.line.linked ? <Badge tone="brand">เชื่อม LINE แล้ว</Badge> : <Badge tone="neutral">ยังไม่เชื่อม LINE</Badge>}
          </div>
          <dl className="mt-2 space-y-1 text-sm text-ink-700">
            <div className="flex gap-2"><dt className="font-semibold">เบอร์โทร:</dt><dd>{selected.customer.phone ?? "— (นิรนาม)"}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">อีเมล:</dt><dd>{selected.customer.email ?? "—"}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">LINE:</dt><dd>{selected.line.linked ? `เชื่อมแล้ว${selected.line.displayName ? ` (${selected.line.displayName})` : ""}` : "ยังไม่เชื่อม"}</dd></div>
          </dl>
          {actionMsg && (
            <div className="mt-3">
              <Alert tone={actionMsg.tone} role={actionMsg.tone === "error" ? "alert" : "status"}>{actionMsg.text}</Alert>
            </div>
          )}
          {!selected.customer.isDeleted && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.customer.isActive ? (
                <button type="button" onClick={() => void setActive(selected.customer.id, false)} disabled={detailBusy} aria-busy={detailBusy} className={dangerButtonClass}>
                  {detailBusy ? "กำลังปิด…" : "ปิดบัญชี"}
                </button>
              ) : (
                <button type="button" onClick={() => void setActive(selected.customer.id, true)} disabled={detailBusy} aria-busy={detailBusy} className={successButtonClass}>
                  {detailBusy ? "กำลังเปิด…" : "เปิดบัญชี"}
                </button>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
