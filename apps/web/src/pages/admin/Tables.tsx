import { useEffect, useState } from "react";
import { TABLE_ZONES, TABLE_ZONE_LABELS, api, type ShopTable, type TableZone } from "../../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  Spinner,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  successButtonClass,
  dangerButtonClass,
} from "../../components/ui";

function parseZone(value: string): TableZone | null {
  return (TABLE_ZONES as readonly string[]).includes(value) ? (value as TableZone) : null;
}

function ZoneSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">ยังไม่กำหนดโซน (ไม่แสดงบนผังร้าน)</option>
      {TABLE_ZONES.map((zone) => (
        <option key={zone} value={zone}>
          {TABLE_ZONE_LABELS[zone]}
        </option>
      ))}
    </select>
  );
}

/** หน้าจัดการโต๊ะสำหรับ Owner/Admin: เพิ่ม/แก้ชื่อ ความจุ โซน/พร้อมใช้งาน–งดใช้งาน (ไม่มีลบ) */
export default function TablesPage() {
  const [tables, setTables] = useState<ShopTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [zone, setZone] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShopTable | null>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editZone, setEditZone] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      setTables((await api.listTables()).tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลโต๊ะไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    const cap = Number(capacity);
    if (!name.trim() || !Number.isInteger(cap) || cap < 1 || cap > 50) {
      setError("กรุณาระบุชื่อโต๊ะ และความจุเป็นจำนวนเต็ม 1–50");
      return;
    }
    setCreating(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.createTable(name.trim(), cap, parseZone(zone));
      setNotice(`เพิ่มโต๊ะ ${res.table.name} แล้ว`);
      setName("");
      setCapacity("4");
      setZone("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มโต๊ะไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busyId) return;
    const cap = Number(editCapacity);
    if (!editName.trim() || !Number.isInteger(cap) || cap < 1 || cap > 50) {
      setError("กรุณาระบุชื่อโต๊ะ และความจุเป็นจำนวนเต็ม 1–50");
      return;
    }
    setBusyId(editing.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.updateTable(editing.id, {
        name: editName.trim(),
        capacity: cap,
        zone: parseZone(editZone),
      });
      setNotice(`บันทึกโต๊ะ ${res.table.name} แล้ว`);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกโต๊ะไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(table: ShopTable) {
    if (busyId) return;
    setBusyId(table.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.updateTable(table.id, { isEnabled: !table.isEnabled });
      setNotice(res.table.isEnabled ? `เปิดใช้งานโต๊ะ ${res.table.name} แล้ว` : `งดใช้งานโต๊ะ ${res.table.name} แล้ว`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนสถานะโต๊ะไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  const enabledCount = tables.filter((t) => t.isEnabled).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการโต๊ะ"
        description={`เพิ่ม แก้ชื่อ/ความจุ/โซน และสลับพร้อมใช้งาน–งดใช้งาน (ไม่มีการลบข้อมูล) · พร้อมใช้งาน ${enabledCount} จากทั้งหมด ${tables.length} โต๊ะ`}
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

      <Panel label="เพิ่มโต๊ะ" className="space-y-4">
        <form onSubmit={create} aria-label="ฟอร์มเพิ่มโต๊ะ" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="table-name" className="mb-1 block text-sm font-semibold text-ink-800">
                ชื่อโต๊ะ (ไม่ซ้ำ)
              </label>
              <input
                id="table-name"
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                placeholder="เช่น A1"
              />
            </div>
            <div>
              <label htmlFor="table-capacity" className="mb-1 block text-sm font-semibold text-ink-800">
                ความจุ (1–50 ที่นั่ง)
              </label>
              <input
                id="table-capacity"
                className={inputClass}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                inputMode="numeric"
                placeholder="เช่น 4"
              />
            </div>
            <div>
              <label htmlFor="table-zone" className="mb-1 block text-sm font-semibold text-ink-800">
                โซนที่นั่ง
              </label>
              <ZoneSelect id="table-zone" value={zone} onChange={setZone} />
            </div>
          </div>
          <button type="submit" disabled={creating} aria-busy={creating} className={primaryButtonClass}>
            {creating && <span className="ui-spinner" aria-hidden="true" />}
            {creating ? "กำลังเพิ่ม…" : "เพิ่มโต๊ะ"}
          </button>
        </form>
      </Panel>

      <Panel label="รายการโต๊ะ" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink-900">โต๊ะทั้งหมด ({tables.length})</h2>
          <button type="button" onClick={() => void refresh()} disabled={loading} className={secondaryButtonClass}>
            {loading ? "กำลังโหลด…" : "โหลดใหม่"}
          </button>
        </div>
        {loading ? (
          <p className="py-6 text-center">
            <Spinner label="กำลังโหลดรายการโต๊ะ…" />
          </p>
        ) : tables.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-8 text-center">
            <p className="font-semibold text-ink-800">ยังไม่มีโต๊ะ</p>
            <p className="mt-1 text-sm text-ink-600">เพิ่มโต๊ะแรกจากแบบฟอร์มด้านบน ระบบจะแสดงรายการที่นี่</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {tables.map((t) => (
              <li key={t.id} className="space-y-2 rounded-xl border border-ink-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-bold text-ink-900">
                    โต๊ะ {t.name}{" "}
                    <span className="text-sm font-medium text-ink-500">
                      · {t.capacity} ที่นั่ง · {t.zone ? TABLE_ZONE_LABELS[t.zone] : "ยังไม่กำหนดโซน"}
                    </span>
                  </p>
                  <Badge tone={t.isEnabled ? "active" : "inactive"}>
                    {t.isEnabled ? "พร้อมใช้งาน" : "งดใช้งาน"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={`จัดการโต๊ะ ${t.name}`}>
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    className={secondaryButtonClass}
                    onClick={() => {
                      setEditing(t);
                      setEditName(t.name);
                      setEditCapacity(String(t.capacity));
                      setEditZone(t.zone ?? "");
                    }}
                  >
                    แก้ชื่อ/ความจุ/โซน
                  </button>
                  {t.isEnabled ? (
                    <button type="button" disabled={busyId === t.id} className={dangerButtonClass} onClick={() => void toggle(t)}>
                      {busyId === t.id ? "กำลังบันทึก…" : "งดใช้งาน"}
                    </button>
                  ) : (
                    <button type="button" disabled={busyId === t.id} className={successButtonClass} onClick={() => void toggle(t)}>
                      {busyId === t.id ? "กำลังบันทึก…" : "เปิดใช้งาน"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <Panel label="แก้ชื่อ ความจุ และโซนโต๊ะ">
          <form onSubmit={saveEdit} aria-label="ฟอร์มแก้โต๊ะ" className="space-y-3">
            <h2 className="font-semibold text-ink-900">แก้โต๊ะ {editing.name}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="edit-table-name" className="mb-1 block text-sm font-semibold text-ink-800">
                  ชื่อโต๊ะ (ไม่ซ้ำ)
                </label>
                <input id="edit-table-name" className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={64} />
              </div>
              <div>
                <label htmlFor="edit-table-capacity" className="mb-1 block text-sm font-semibold text-ink-800">
                  ความจุ (1–50)
                </label>
                <input id="edit-table-capacity" className={inputClass} value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <label htmlFor="edit-table-zone" className="mb-1 block text-sm font-semibold text-ink-800">
                  โซนที่นั่ง
                </label>
                <ZoneSelect id="edit-table-zone" value={editZone} onChange={setEditZone} />
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
