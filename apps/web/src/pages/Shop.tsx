import { useEffect, useState } from "react";
import { api, WEEKDAY_KEYS, type AuditItem, type ShopConfig, type WeeklySchedule, type WeekdayKey } from "../lib/api";
import { blankWeek, mergeWeek } from "../lib/shop-week";
import {
  Alert,
  PageHeader,
  Panel,
  Spinner,
  inputClass,
  primaryButtonClass,
} from "../components/ui";
import { ScheduleDayField } from "../components/ScheduleDayField";
import { OverridePanel, type OverrideFormBody } from "../components/OverridePanel";
import { ShopAuditList } from "../components/ShopAuditList";

/** หน้าจัดการร้านสำหรับ Owner/Admin: เวลาประจำสัปดาห์ + เปิด–ปิดชั่วคราว + ประวัติ */
export default function ShopPage() {
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [shopName, setShopName] = useState("");
  const [week, setWeek] = useState<WeeklySchedule>(blankWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [overriding, setOverriding] = useState(false);

  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      const cfg = await api.shopConfig();
      setConfig(cfg);
      setShopName(cfg.shopName);
      setWeek(mergeWeek(cfg.schedule));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลร้านไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
    try {
      setAuditError(null);
      setAudit((await api.shopAudit()).items);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "โหลดประวัติร้านไม่สำเร็จ");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function setDayClosed(d: WeekdayKey, closed: boolean) {
    setWeek((w) => ({ ...w, [d]: { closed, intervals: closed ? [] : w[d]!.intervals.length > 0 ? w[d]!.intervals : [{ open: "09:00", close: "21:00" }] } }));
  }

  function setInterval(d: WeekdayKey, i: number, key: "open" | "close", value: string) {
    setWeek((w) => ({
      ...w,
      [d]: { ...w[d]!, intervals: w[d]!.intervals.map((iv, j) => (j === i ? { ...iv, [key]: value } : iv)) },
    }));
  }

  function addInterval(d: WeekdayKey) {
    setWeek((w) => {
      if (w[d]!.intervals.length >= 4) return w;
      return { ...w, [d]: { ...w[d]!, intervals: [...w[d]!.intervals, { open: "09:00", close: "21:00" }] } };
    });
  }

  function removeInterval(d: WeekdayKey, i: number) {
    setWeek((w) => ({ ...w, [d]: { ...w[d]!, intervals: w[d]!.intervals.filter((_, j) => j !== i) } }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      setError(null);
      setNotice(null);
      const saved = await api.saveSchedule(shopName.trim(), week);
      setConfig(saved);
      setShopName(saved.shopName);
      setWeek(mergeWeek(saved.schedule));
      setNotice("บันทึกเวลาทำการแล้ว");
      setAudit((await api.shopAudit()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function applyOverride(body: OverrideFormBody) {
    if (overriding) return;
    setOverriding(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.setOverride(body);
      setConfig((c) => (c ? { ...c, override: res.override, expiredOverride: null } : c));
      setNotice(body.mode === "closed" ? "ปิดร้านชั่วคราวแล้ว" : "เปิดร้านชั่วคราวแล้ว");
      setAudit((await api.shopAudit()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สั่งเปิด–ปิดชั่วคราวไม่สำเร็จ");
    } finally {
      setOverriding(false);
    }
  }

  async function clear() {
    if (overriding) return;
    setOverriding(true);
    try {
      setError(null);
      setNotice(null);
      await api.clearOverride();
      setConfig((c) => (c ? { ...c, override: null, expiredOverride: null } : c));
      setNotice("ล้างคำสั่งชั่วคราวแล้ว กลับไปใช้ตารางประจำสัปดาห์");
      setAudit((await api.shopAudit()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ล้างคำสั่งไม่สำเร็จ");
    } finally {
      setOverriding(false);
    }
  }

  if (loading) {
    return (
      <p className="py-10 text-center">
        <Spinner label="กำลังโหลดข้อมูลร้าน…" />
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการร้าน"
        description="กำหนดชื่อร้าน ตารางเวลาเปิดประจำสัปดาห์ และคำสั่งเปิด–ปิดชั่วคราว (ชั่วคราวชนะตารางเสมอ) การเปลี่ยนทุกครั้งถูกบันทึกประวัติ"
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

      <Panel label="ตารางเวลาเปิดประจำสัปดาห์" className="space-y-4">
        <form onSubmit={save} aria-label="ฟอร์มเวลาทำการ" className="space-y-4">
          <div>
            <label htmlFor="shop-name" className="mb-1 block text-sm font-semibold text-ink-800">
              ชื่อร้าน
            </label>
            <input
              id="shop-name"
              className={`${inputClass} max-w-md`}
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={120}
              placeholder="ชื่อร้านที่แสดงในหน้าสาธารณะ"
            />
          </div>
          <div className="space-y-3">
            {WEEKDAY_KEYS.map((d) => (
              <ScheduleDayField
                key={d}
                dayKey={d}
                day={week[d]!}
                onToggleClosed={setDayClosed}
                onChangeInterval={setInterval}
                onAddInterval={addInterval}
                onRemoveInterval={removeInterval}
              />
            ))}
          </div>
          <button type="submit" disabled={saving} aria-busy={saving} className={primaryButtonClass}>
            {saving && <span className="ui-spinner" aria-hidden="true" />}
            {saving ? "กำลังบันทึก…" : "บันทึกเวลาทำการ"}
          </button>
        </form>
      </Panel>

      <Panel label="คำสั่งเปิด–ปิดชั่วคราว">
        <OverridePanel
          override={config?.override ?? null}
          expiredOverride={config?.expiredOverride ?? null}
          busy={overriding}
          onApply={(body) => applyOverride(body)}
          onClear={clear}
        />
      </Panel>

      <Panel label="ประวัติการเปลี่ยนสถานะร้าน">
        <ShopAuditList items={audit} error={auditError} />
      </Panel>
    </div>
  );
}
