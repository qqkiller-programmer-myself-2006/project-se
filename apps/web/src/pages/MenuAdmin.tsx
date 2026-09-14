import { useEffect, useMemo, useState } from "react";
import {
  MENU_KIND_LABELS,
  MENU_STATUS_LABELS,
  api,
  type MenuItem,
  type MenuKind,
  type MenuOptionGroupDetail,
  type MenuStatus,
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
  successButtonClass,
} from "../components/ui";

interface FormState {
  category: string;
  name: string;
  description: string;
  imageUrl: string;
  price: string;
  kind: MenuKind;
  status: MenuStatus;
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  category: "",
  name: "",
  description: "",
  imageUrl: "",
  price: "",
  kind: "food",
  status: "available",
  sortOrder: "0",
};

function toForm(m: MenuItem): FormState {
  return {
    category: m.category,
    name: m.name,
    description: m.description ?? "",
    imageUrl: m.imageUrl ?? "",
    price: String(m.price),
    kind: m.kind,
    status: m.status,
    sortOrder: String(m.sortOrder),
  };
}

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

/** หน้าจัดการเมนูสำหรับ Owner/Admin: เพิ่ม/แก้ไข/เปิด–ปิดขาย/archive (ไม่มีลบทำลาย) */
export default function MenuAdminPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kindFilter, setKindFilter] = useState<"" | MenuKind>("");
  const [statusFilter, setStatusFilter] = useState<"" | MenuStatus>("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  // ---------- Ticket 07: จัดการกลุ่มตัวเลือก + ตัวเลือกของเมนูที่เลือก ----------
  const [optionMenuId, setOptionMenuId] = useState("");
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroupDetail[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupSort, setGroupSort] = useState("0");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupSort, setEditGroupSort] = useState("0");
  const [optGroupId, setOptGroupId] = useState("");
  const [optName, setOptName] = useState("");
  const [optDelta, setOptDelta] = useState("0");
  const [optEnabled, setOptEnabled] = useState(true);
  const [optSort, setOptSort] = useState("0");
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editOptName, setEditOptName] = useState("");
  const [editOptDelta, setEditOptDelta] = useState("0");
  const [editOptSort, setEditOptSort] = useState("0");
  const [optionsBusy, setOptionsBusy] = useState(false);

  async function refresh(archived = showArchived) {
    try {
      setError(null);
      setItems((await api.menuList({ includeArchived: archived })).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการเมนูไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleArchived(next: boolean) {
    setShowArchived(next);
    setLoading(true);
    await refresh(next);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (m) =>
        (kindFilter === "" || m.kind === kindFilter) &&
        (statusFilter === "" || m.status === statusFilter) &&
        (!needle ||
          m.name.toLowerCase().includes(needle) ||
          m.category.toLowerCase().includes(needle) ||
          (m.description ?? "").toLowerCase().includes(needle)),
    );
  }, [items, kindFilter, statusFilter, q]);

  function set<F extends keyof FormState>(target: "form" | "edit", key: F, value: FormState[F]) {
    if (target === "form") setForm((f) => ({ ...f, [key]: value }));
    else setEditForm((f) => ({ ...f, [key]: value }));
  }

  function toPayload(f: FormState) {
    return {
      category: f.category.trim(),
      name: f.name.trim(),
      description: f.description.trim() ? f.description.trim() : null,
      imageUrl: f.imageUrl.trim() ? f.imageUrl.trim() : null,
      price: Number(f.price),
      kind: f.kind,
      status: f.status,
      sortOrder: Number(f.sortOrder),
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.menuCreate(toPayload(form));
      setNotice(`เพิ่มเมนู ${res.item.name} แล้ว`);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มเมนูไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busyId) return;
    setBusyId(editing.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.menuUpdate(editing.id, toPayload(editForm));
      setNotice(`บันทึกเมนู ${res.item.name} แล้ว`);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกเมนูไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(m: MenuItem) {
    if (busyId) return;
    setBusyId(m.id);
    try {
      setError(null);
      setNotice(null);
      const next: MenuStatus = m.status === "available" ? "unavailable" : "available";
      const res = await api.menuUpdate(m.id, { status: next });
      setNotice(
        res.item.status === "available" ? `เปิดขายเมนู ${res.item.name} แล้ว` : `ปิดขายเมนู ${res.item.name} แล้ว`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนสถานะเมนูไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function archive(m: MenuItem) {
    if (busyId) return;
    if (!window.confirm(`archive เมนู ${m.name} ใช่หรือไม่? เมนูจะซ่อนจากหน้าขายแต่คงประวัติไว้`)) return;
    setBusyId(m.id);
    try {
      setError(null);
      setNotice(null);
      await api.menuArchive(m.id);
      setNotice(`archive เมนู ${m.name} แล้ว`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "archive เมนูไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function restore(m: MenuItem) {
    if (busyId) return;
    setBusyId(m.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.menuRestore(m.id);
      setNotice(`นำเมนู ${res.item.name} กลับมาขายแล้ว`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "นำเมนูกลับมาไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  // ---------- Ticket 07: helpers จัดการตัวเลือก ----------

  async function loadOptionGroups(menuId: string) {
    if (!menuId) {
      setOptionGroups([]);
      return;
    }
    try {
      setOptionsLoading(true);
      setOptionsError(null);
      const res = await api.menuOptionGroups(menuId);
      setOptionGroups(res.groups);
      if (!res.groups.some((g) => g.id === optGroupId)) {
        setOptGroupId(res.groups[0]?.id ?? "");
      }
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "โหลดตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsLoading(false);
    }
  }

  function pickOptionMenu(menuId: string) {
    setOptionMenuId(menuId);
    setOptionsError(null);
    void loadOptionGroups(menuId);
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!optionMenuId || optionsBusy) return;
    setOptionsBusy(true);
    try {
      setOptionsError(null);
      setNotice(null);
      const res = await api.menuOptionGroupCreate(optionMenuId, {
        name: groupName.trim(),
        sortOrder: Number(groupSort),
      });
      setNotice(`เพิ่มกลุ่มตัวเลือก ${res.group.name} แล้ว`);
      setGroupName("");
      setGroupSort("0");
      await loadOptionGroups(optionMenuId);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "เพิ่มกลุ่มตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsBusy(false);
    }
  }

  async function saveGroup(groupId: string) {
    if (optionsBusy) return;
    setOptionsBusy(true);
    try {
      setOptionsError(null);
      setNotice(null);
      const res = await api.menuOptionGroupUpdate(groupId, {
        name: editGroupName.trim(),
        sortOrder: Number(editGroupSort),
      });
      setNotice(`บันทึกกลุ่มตัวเลือก ${res.group.name} แล้ว`);
      setEditingGroupId(null);
      await loadOptionGroups(optionMenuId);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "บันทึกกลุ่มตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsBusy(false);
    }
  }

  async function createOption(e: React.FormEvent) {
    e.preventDefault();
    if (!optGroupId || optionsBusy) return;
    setOptionsBusy(true);
    try {
      setOptionsError(null);
      setNotice(null);
      const res = await api.menuOptionCreate(optGroupId, {
        name: optName.trim(),
        priceDelta: Number(optDelta),
        isEnabled: optEnabled,
        sortOrder: Number(optSort),
      });
      setNotice(`เพิ่มตัวเลือก ${res.option.name} แล้ว`);
      setOptName("");
      setOptDelta("0");
      setOptSort("0");
      setOptEnabled(true);
      await loadOptionGroups(optionMenuId);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "เพิ่มตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsBusy(false);
    }
  }

  async function saveOption(optionId: string) {
    if (optionsBusy) return;
    setOptionsBusy(true);
    try {
      setOptionsError(null);
      setNotice(null);
      const res = await api.menuOptionUpdate(optionId, {
        name: editOptName.trim(),
        priceDelta: Number(editOptDelta),
        sortOrder: Number(editOptSort),
      });
      setNotice(`บันทึกตัวเลือก ${res.option.name} แล้ว`);
      setEditingOptionId(null);
      await loadOptionGroups(optionMenuId);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "บันทึกตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsBusy(false);
    }
  }

  async function toggleOptionEnabled(groupId: string, optionId: string, next: boolean) {
    if (optionsBusy) return;
    setOptionsBusy(true);
    try {
      setOptionsError(null);
      setNotice(null);
      await api.menuOptionUpdate(optionId, { isEnabled: next });
      setNotice(next ? "เปิดขายตัวเลือกแล้ว" : "ปิดขายตัวเลือกแล้ว");
      void groupId;
      await loadOptionGroups(optionMenuId);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "เปลี่ยนสถานะตัวเลือกไม่สำเร็จ");
    } finally {
      setOptionsBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการเมนู"
        description={`เพิ่ม แก้ไข เปิด–ปิดขาย และ archive เมนู (ไม่มีการลบทำลาย) · ทั้งหมด ${items.length} รายการ`}
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

      <Panel label="เพิ่มเมนู" className="space-y-4">
        <form onSubmit={create} aria-label="ฟอร์มเพิ่มเมนู" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="menu-category" className="mb-1 block text-sm font-semibold text-ink-800">
                หมวดหมู่ (ไม่เกิน 64 ตัวอักษร)
              </label>
              <input
                id="menu-category"
                className={inputClass}
                value={form.category}
                onChange={(e) => set("form", "category", e.target.value)}
                maxLength={64}
                placeholder="เช่น อาหารจานเดียว"
              />
            </div>
            <div>
              <label htmlFor="menu-name" className="mb-1 block text-sm font-semibold text-ink-800">
                ชื่อเมนู (ไม่เกิน 120 ตัวอักษร)
              </label>
              <input
                id="menu-name"
                className={inputClass}
                value={form.name}
                onChange={(e) => set("form", "name", e.target.value)}
                maxLength={120}
                placeholder="เช่น ข้าวผัดป้าอ้อ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="menu-desc" className="mb-1 block text-sm font-semibold text-ink-800">
                รายละเอียด (ไม่บังคับ ไม่เกิน 500 ตัวอักษร)
              </label>
              <textarea
                id="menu-desc"
                className={inputClass}
                value={form.description}
                onChange={(e) => set("form", "description", e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="เช่น ข้าวผัดหอม ๆ ใส่ไข่"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="menu-image" className="mb-1 block text-sm font-semibold text-ink-800">
                URL รูปภาพ (ไม่บังคับ ต้องเป็น http/https)
              </label>
              <input
                id="menu-image"
                className={inputClass}
                value={form.imageUrl}
                onChange={(e) => set("form", "imageUrl", e.target.value)}
                inputMode="url"
                placeholder="เช่น https://example.com/khao-phad.jpg"
              />
            </div>
            <div>
              <label htmlFor="menu-price" className="mb-1 block text-sm font-semibold text-ink-800">
                ราคา (บาท ไม่ติดลบ)
              </label>
              <input
                id="menu-price"
                className={inputClass}
                value={form.price}
                onChange={(e) => set("form", "price", e.target.value)}
                inputMode="decimal"
                placeholder="เช่น 50"
              />
            </div>
            <div>
              <label htmlFor="menu-sort" className="mb-1 block text-sm font-semibold text-ink-800">
                ลำดับแสดงผล (0–10000)
              </label>
              <input
                id="menu-sort"
                className={inputClass}
                value={form.sortOrder}
                onChange={(e) => set("form", "sortOrder", e.target.value)}
                inputMode="numeric"
                placeholder="เช่น 0"
              />
            </div>
            <div>
              <label htmlFor="menu-kind" className="mb-1 block text-sm font-semibold text-ink-800">
                ประเภท
              </label>
              <select
                id="menu-kind"
                className={inputClass}
                value={form.kind}
                onChange={(e) => set("form", "kind", e.target.value as MenuKind)}
              >
                <option value="food">{MENU_KIND_LABELS.food}</option>
                <option value="drink">{MENU_KIND_LABELS.drink}</option>
              </select>
            </div>
            <div>
              <label htmlFor="menu-status" className="mb-1 block text-sm font-semibold text-ink-800">
                สถานะเริ่มต้น
              </label>
              <select
                id="menu-status"
                className={inputClass}
                value={form.status}
                onChange={(e) => set("form", "status", e.target.value as MenuStatus)}
              >
                <option value="available">{MENU_STATUS_LABELS.available}</option>
                <option value="unavailable">{MENU_STATUS_LABELS.unavailable}</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={creating} aria-busy={creating} className={primaryButtonClass}>
            {creating && <span className="ui-spinner" aria-hidden="true" />}
            {creating ? "กำลังเพิ่ม…" : "เพิ่มเมนู"}
          </button>
        </form>
      </Panel>

      <Panel label="รายการเมนู" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="menu-filter-q" className="mb-1 block text-sm font-semibold text-ink-800">
              ค้นหา
            </label>
            <input
              id="menu-filter-q"
              className={inputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ หมวด หรือรายละเอียด"
            />
          </div>
          <div>
            <label htmlFor="menu-filter-kind" className="mb-1 block text-sm font-semibold text-ink-800">
              ประเภท
            </label>
            <select
              id="menu-filter-kind"
              className={inputClass}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as "" | MenuKind)}
            >
              <option value="">ทั้งหมด</option>
              <option value="food">{MENU_KIND_LABELS.food}</option>
              <option value="drink">{MENU_KIND_LABELS.drink}</option>
            </select>
          </div>
          <div>
            <label htmlFor="menu-filter-status" className="mb-1 block text-sm font-semibold text-ink-800">
              สถานะ
            </label>
            <select
              id="menu-filter-status"
              className={inputClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | MenuStatus)}
            >
              <option value="">ทั้งหมด</option>
              <option value="available">{MENU_STATUS_LABELS.available}</option>
              <option value="unavailable">{MENU_STATUS_LABELS.unavailable}</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold text-ink-800">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={showArchived}
              onChange={(e) => void toggleArchived(e.target.checked)}
            />
            แสดงเมนูที่ archive แล้วด้วย
          </label>
          <button type="button" onClick={() => void refresh()} disabled={loading} className={secondaryButtonClass}>
            {loading ? "กำลังโหลด…" : "โหลดใหม่"}
          </button>
        </div>

        {loading ? (
          <p className="py-6 text-center">
            <Spinner label="กำลังโหลดรายการเมนู…" />
          </p>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-8 text-center">
            <p className="font-semibold text-ink-800">ยังไม่มีเมนู</p>
            <p className="mt-1 text-sm text-ink-600">เพิ่มเมนูแรกจากแบบฟอร์มด้านบน ระบบจะแสดงรายการที่นี่</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((m) => (
              <li key={m.id} className="space-y-2 rounded-xl border border-ink-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-bold text-ink-900">
                    {m.name}{" "}
                    <span className="text-sm font-medium text-ink-500">
                      · {m.category} · {fmtPrice(m.price)}
                    </span>
                  </p>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone="brand">{MENU_KIND_LABELS[m.kind]}</Badge>
                    <Badge tone={m.status === "available" ? "success" : "danger"}>
                      {MENU_STATUS_LABELS[m.status]}
                    </Badge>
                    {m.isArchived && <Badge tone="inactive">archive แล้ว</Badge>}
                  </span>
                </div>
                {m.description ? <p className="text-sm text-ink-600">{m.description}</p> : null}
                <div className="flex flex-wrap gap-2" role="group" aria-label={`จัดการเมนู ${m.name}`}>
                  <button
                    type="button"
                    disabled={busyId === m.id || m.isArchived}
                    className={secondaryButtonClass}
                    onClick={() => {
                      setEditing(m);
                      setEditForm(toForm(m));
                    }}
                  >
                    แก้ไข
                  </button>
                  {m.status === "available" ? (
                    <button
                      type="button"
                      disabled={busyId === m.id || m.isArchived}
                      className={dangerButtonClass}
                      onClick={() => void toggleStatus(m)}
                    >
                      {busyId === m.id ? "กำลังบันทึก…" : "ปิดขาย"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === m.id || m.isArchived}
                      className={successButtonClass}
                      onClick={() => void toggleStatus(m)}
                    >
                      {busyId === m.id ? "กำลังบันทึก…" : "เปิดขาย"}
                    </button>
                  )}
                  {m.isArchived ? (
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      className={successButtonClass}
                      onClick={() => void restore(m)}
                    >
                      {busyId === m.id ? "กำลังบันทึก…" : "นำกลับมาขาย"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      className={dangerButtonClass}
                      onClick={() => void archive(m)}
                    >
                      {busyId === m.id ? "กำลังบันทึก…" : "archive"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="ตัวเลือกของเมนู" className="space-y-4">
        <p className="text-sm text-ink-600">
          เลือกเมนูเพื่อจัดการกลุ่มตัวเลือก (เช่น ขนาด ท็อปปิ้ง) และตัวเลือกพร้อมส่วนต่างราคา
          ลูกค้าเลือกได้กลุ่มละ 1 ตัวเลือกต่อรายการ
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="option-menu" className="mb-1 block text-sm font-semibold text-ink-800">
              เมนูที่จัดการตัวเลือก
            </label>
            <select
              id="option-menu"
              className={inputClass}
              value={optionMenuId}
              onChange={(e) => pickOptionMenu(e.target.value)}
            >
              <option value="">— เลือกเมนู —</option>
              {items
                .filter((m) => !m.isArchived)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.category} · {m.name} ({fmtPrice(m.price)})
                  </option>
                ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadOptionGroups(optionMenuId)}
              disabled={!optionMenuId || optionsLoading}
              className={secondaryButtonClass}
            >
              {optionsLoading ? "กำลังโหลด…" : "โหลดใหม่"}
            </button>
          </div>
        </div>

        {optionsError ? (
          <Alert tone="error" role="alert">
            {optionsError}
          </Alert>
        ) : null}

        {optionMenuId ? (
          <div className="space-y-4">
            <form onSubmit={createGroup} aria-label="ฟอร์มเพิ่มกลุ่มตัวเลือก" className="space-y-3 rounded-xl bg-ink-50 p-3">
              <h3 className="font-bold text-ink-900">เพิ่มกลุ่มตัวเลือก</h3>
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
                <div>
                  <label htmlFor="group-name" className="mb-1 block text-sm font-semibold text-ink-800">
                    ชื่อกลุ่ม (เช่น ขนาด เพิ่มท็อปปิ้ง)
                  </label>
                  <input
                    id="group-name"
                    className={inputClass}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    maxLength={64}
                    placeholder="เช่น ขนาด"
                  />
                </div>
                <div>
                  <label htmlFor="group-sort" className="mb-1 block text-sm font-semibold text-ink-800">
                    ลำดับ (0–10000)
                  </label>
                  <input
                    id="group-sort"
                    className={inputClass}
                    value={groupSort}
                    onChange={(e) => setGroupSort(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={optionsBusy} aria-busy={optionsBusy} className={primaryButtonClass}>
                    {optionsBusy ? "กำลังบันทึก…" : "เพิ่มกลุ่ม"}
                  </button>
                </div>
              </div>
            </form>

            {optionsLoading ? (
              <p className="py-4 text-center">
                <Spinner label="กำลังโหลดตัวเลือก…" />
              </p>
            ) : optionGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center">
                <p className="font-semibold text-ink-800">เมนูนี้ยังไม่มีกลุ่มตัวเลือก</p>
                <p className="mt-1 text-sm text-ink-600">เพิ่มกลุ่มแรกจากแบบฟอร์มด้านบน</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {optionGroups.map((g) => (
                  <li key={g.id} className="space-y-2 rounded-xl border border-ink-200 p-3">
                    {editingGroupId === g.id ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto_auto]">
                        <input
                          aria-label="ชื่อกลุ่มตัวเลือก"
                          className={inputClass}
                          value={editGroupName}
                          onChange={(e) => setEditGroupName(e.target.value)}
                          maxLength={64}
                        />
                        <input
                          aria-label="ลำดับกลุ่ม"
                          className={inputClass}
                          value={editGroupSort}
                          onChange={(e) => setEditGroupSort(e.target.value)}
                          inputMode="numeric"
                        />
                        <button type="button" onClick={() => void saveGroup(g.id)} disabled={optionsBusy} className={primaryButtonClass}>
                          บันทึก
                        </button>
                        <button type="button" onClick={() => setEditingGroupId(null)} className={secondaryButtonClass}>
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-ink-900">
                          {g.name} <span className="text-sm font-medium text-ink-500">· ลำดับ {g.sortOrder}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupId(g.id);
                            setEditGroupName(g.name);
                            setEditGroupSort(String(g.sortOrder));
                          }}
                          className={secondaryButtonClass}
                        >
                          แก้ไขกลุ่ม
                        </button>
                      </div>
                    )}
                    <ul className="space-y-1.5">
                      {g.options.map((o) => (
                        <li
                          key={o.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2"
                        >
                          {editingOptionId === o.id ? (
                            <div className="grid w-full gap-2 sm:grid-cols-[1fr_8rem_8rem_auto_auto]">
                              <input
                                aria-label="ชื่อตัวเลือก"
                                className={inputClass}
                                value={editOptName}
                                onChange={(e) => setEditOptName(e.target.value)}
                                maxLength={120}
                              />
                              <input
                                aria-label="ส่วนต่างราคา"
                                className={inputClass}
                                value={editOptDelta}
                                onChange={(e) => setEditOptDelta(e.target.value)}
                                inputMode="decimal"
                              />
                              <input
                                aria-label="ลำดับตัวเลือก"
                                className={inputClass}
                                value={editOptSort}
                                onChange={(e) => setEditOptSort(e.target.value)}
                                inputMode="numeric"
                              />
                              <button type="button" onClick={() => void saveOption(o.id)} disabled={optionsBusy} className={primaryButtonClass}>
                                บันทึก
                              </button>
                              <button type="button" onClick={() => setEditingOptionId(null)} className={secondaryButtonClass}>
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm text-ink-900">
                                <span className="font-semibold">{o.name}</span>{" "}
                                <span className="text-ink-600">
                                  ({o.priceDelta === 0 ? "ไม่เพิ่มราคา" : `${o.priceDelta > 0 ? "+" : ""}${o.priceDelta} บาท`} · ลำดับ {o.sortOrder})
                                </span>{" "}
                                <Badge tone={o.isEnabled ? "success" : "danger"}>
                                  {o.isEnabled ? "เปิดขาย" : "ปิดขาย"}
                                </Badge>
                              </span>
                              <span className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingOptionId(o.id);
                                    setEditOptName(o.name);
                                    setEditOptDelta(String(o.priceDelta));
                                    setEditOptSort(String(o.sortOrder));
                                  }}
                                  className={secondaryButtonClass}
                                >
                                  แก้ไข
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void toggleOptionEnabled(g.id, o.id, !o.isEnabled)}
                                  disabled={optionsBusy}
                                  className={o.isEnabled ? dangerButtonClass : successButtonClass}
                                >
                                  {o.isEnabled ? "ปิดขาย" : "เปิดขาย"}
                                </button>
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    <form
                      onSubmit={createOption}
                      aria-label={`ฟอร์มเพิ่มตัวเลือกในกลุ่ม ${g.name}`}
                      className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto_auto]"
                    >
                      <input
                        aria-label={`ชื่อตัวเลือกใหม่ในกลุ่ม ${g.name}`}
                        className={inputClass}
                        value={optGroupId === g.id ? optName : ""}
                        onFocus={() => setOptGroupId(g.id)}
                        onChange={(e) => {
                          setOptGroupId(g.id);
                          setOptName(e.target.value);
                        }}
                        maxLength={120}
                        placeholder="ชื่อตัวเลือก เช่น พิเศษ"
                      />
                      <input
                        aria-label="ส่วนต่างราคา (บาท)"
                        className={inputClass}
                        value={optGroupId === g.id ? optDelta : "0"}
                        onFocus={() => setOptGroupId(g.id)}
                        onChange={(e) => {
                          setOptGroupId(g.id);
                          setOptDelta(e.target.value);
                        }}
                        inputMode="decimal"
                        placeholder="เช่น 10"
                      />
                      <input
                        aria-label="ลำดับ"
                        className={inputClass}
                        value={optGroupId === g.id ? optSort : "0"}
                        onFocus={() => setOptGroupId(g.id)}
                        onChange={(e) => {
                          setOptGroupId(g.id);
                          setOptSort(e.target.value);
                        }}
                        inputMode="numeric"
                        placeholder="0"
                      />
                      <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold text-ink-800">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-brand-600"
                          checked={optGroupId === g.id ? optEnabled : true}
                          onChange={(e) => {
                            setOptGroupId(g.id);
                            setOptEnabled(e.target.checked);
                          }}
                        />
                        เปิดขาย
                      </label>
                      <button
                        type="submit"
                        disabled={optionsBusy || optGroupId !== g.id}
                        onClick={() => setOptGroupId(g.id)}
                        className={primaryButtonClass}
                      >
                        เพิ่มตัวเลือก
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Panel>

      {editing && (
        <Panel label="แก้ไขเมนู">
          <form onSubmit={saveEdit} aria-label="ฟอร์มแก้เมนู" className="space-y-3">
            <h2 className="font-semibold text-ink-900">แก้เมนู {editing.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-menu-category" className="mb-1 block text-sm font-semibold text-ink-800">
                  หมวดหมู่
                </label>
                <input
                  id="edit-menu-category"
                  className={inputClass}
                  value={editForm.category}
                  onChange={(e) => set("edit", "category", e.target.value)}
                  maxLength={64}
                />
              </div>
              <div>
                <label htmlFor="edit-menu-name" className="mb-1 block text-sm font-semibold text-ink-800">
                  ชื่อเมนู
                </label>
                <input
                  id="edit-menu-name"
                  className={inputClass}
                  value={editForm.name}
                  onChange={(e) => set("edit", "name", e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="edit-menu-desc" className="mb-1 block text-sm font-semibold text-ink-800">
                  รายละเอียด
                </label>
                <textarea
                  id="edit-menu-desc"
                  className={inputClass}
                  value={editForm.description}
                  onChange={(e) => set("edit", "description", e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="edit-menu-image" className="mb-1 block text-sm font-semibold text-ink-800">
                  URL รูปภาพ
                </label>
                <input
                  id="edit-menu-image"
                  className={inputClass}
                  value={editForm.imageUrl}
                  onChange={(e) => set("edit", "imageUrl", e.target.value)}
                  inputMode="url"
                />
              </div>
              <div>
                <label htmlFor="edit-menu-price" className="mb-1 block text-sm font-semibold text-ink-800">
                  ราคา (บาท)
                </label>
                <input
                  id="edit-menu-price"
                  className={inputClass}
                  value={editForm.price}
                  onChange={(e) => set("edit", "price", e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label htmlFor="edit-menu-sort" className="mb-1 block text-sm font-semibold text-ink-800">
                  ลำดับแสดงผล
                </label>
                <input
                  id="edit-menu-sort"
                  className={inputClass}
                  value={editForm.sortOrder}
                  onChange={(e) => set("edit", "sortOrder", e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label htmlFor="edit-menu-kind" className="mb-1 block text-sm font-semibold text-ink-800">
                  ประเภท
                </label>
                <select
                  id="edit-menu-kind"
                  className={inputClass}
                  value={editForm.kind}
                  onChange={(e) => set("edit", "kind", e.target.value as MenuKind)}
                >
                  <option value="food">{MENU_KIND_LABELS.food}</option>
                  <option value="drink">{MENU_KIND_LABELS.drink}</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-menu-status" className="mb-1 block text-sm font-semibold text-ink-800">
                  สถานะ
                </label>
                <select
                  id="edit-menu-status"
                  className={inputClass}
                  value={editForm.status}
                  onChange={(e) => set("edit", "status", e.target.value as MenuStatus)}
                >
                  <option value="available">{MENU_STATUS_LABELS.available}</option>
                  <option value="unavailable">{MENU_STATUS_LABELS.unavailable}</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busyId !== null} aria-busy={busyId !== null} className={primaryButtonClass}>
                {busyId ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              <button type="button" onClick={() => setEditing(null)} className={secondaryButtonClass}>
                ยกเลิก
              </button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
