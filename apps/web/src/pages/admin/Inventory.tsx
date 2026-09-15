import { useEffect, useMemo, useState } from "react";
import {
  MANUAL_STOCK_OPS,
  STOCK_OP_LABELS,
  api,
  type Ingredient,
  type ManualStockOp,
  type MenuItem,
  type MenuOptionGroupDetail,
  type Recipe,
  type StockLedgerEntry,
} from "../../lib/api";
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
} from "../../components/ui";

function fmtQty(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function fmtBaht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

interface RecipeLineDraft {
  ingredientId: string;
  qty: string;
}

/**
 * หน้าจัดการวัตถุดิบและสต๊อกสำหรับ Owner/Admin (Ticket 07):
 * - เพิ่ม/แก้ไขวัตถุดิบ (ชื่อ unique, หน่วยกำหนดตอนสร้างเปลี่ยนไม่ได้) + เปิดใช้/งดใช้
 * - รับเข้า/รับคืน/ของเสีย/หมดอายุ/ใช้ส่วนตัว/ปรับยอดตรวจนับ พร้อมเหตุผลทุกครั้ง
 * - ดูประวัติธุรกรรมสต๊อก (append-only) ของวัตถุดิบที่เลือก
 * - สร้างสูตรแบบ versioned ให้เมนูหรือตัวเลือก + ดูประวัติเวอร์ชันและต้นทุนประมาณการ
 */
export default function InventoryPage() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [cost, setCost] = useState("0");
  const [initial, setInitial] = useState("0");
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [editName, setEditName] = useState("");
  const [editThreshold, setEditThreshold] = useState("0");
  const [editCost, setEditCost] = useState("0");
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---------- แผงสต๊อก/ประวัติของวัตถุดิบที่เลือก ----------
  const [selectedId, setSelectedId] = useState("");
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [stockOp, setStockOp] = useState<ManualStockOp>("receive");
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [stockRef, setStockRef] = useState("");
  const [moving, setMoving] = useState(false);

  // ---------- แผงสูตร ----------
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [targetType, setTargetType] = useState<"menu" | "option">("menu");
  const [targetMenuId, setTargetMenuId] = useState("");
  const [targetOptionId, setTargetOptionId] = useState("");
  const [menuOptions, setMenuOptions] = useState<MenuOptionGroupDetail[]>([]);
  const [lines, setLines] = useState<RecipeLineDraft[]>([{ ingredientId: "", qty: "" }]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const targetId = targetType === "menu" ? targetMenuId : targetOptionId;
  const optionChoices = useMemo(
    () => menuOptions.flatMap((g) => g.options.map((o) => ({ ...o, groupName: g.name }))),
    [menuOptions],
  );

  async function refresh(disabled = showDisabled) {
    try {
      setError(null);
      setItems((await api.ingredients(disabled)).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดวัตถุดิบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function refreshLedger(id: string) {
    setLedgerLoading(true);
    try {
      setLedger((await api.stockLedger({ ingredientId: id, limit: 20 })).entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดประวัติสต๊อกไม่สำเร็จ");
    } finally {
      setLedgerLoading(false);
    }
  }

  async function refreshRecipes(type: "menu" | "option", id: string) {
    if (!id) {
      setRecipes([]);
      return;
    }
    setRecipesLoading(true);
    try {
      setRecipes((await api.recipes(type, id)).recipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดสูตรไม่สำเร็จ");
    } finally {
      setRecipesLoading(false);
    }
  }

  useEffect(() => {
    void refresh(false);
    api
      .menuList({ includeArchived: false })
      .then((r) => setMenus(r.items))
      .catch(() => setMenus([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void refreshLedger(selectedId);
    else setLedger([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (targetType === "option" && targetMenuId) {
      api
        .menuOptionGroups(targetMenuId)
        .then((r) => setMenuOptions(r.groups))
        .catch(() => setMenuOptions([]));
    } else {
      setMenuOptions([]);
    }
    setTargetOptionId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetMenuId]);

  useEffect(() => {
    void refreshRecipes(targetType, targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  async function toggleDisabled(next: boolean) {
    setShowDisabled(next);
    setLoading(true);
    await refresh(next);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!name.trim() || !unit.trim()) {
      setError("กรุณาระบุชื่อวัตถุดิบและหน่วย (เช่น กรัม ฟอง มิลลิลิตร ถุง)");
      return;
    }
    setCreating(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.ingredientCreate({
        name: name.trim(),
        unit: unit.trim(),
        reorderThreshold: Number(threshold) || 0,
        latestCost: Number(cost) || 0,
        initialOnHand: Number(initial) || 0,
      });
      setNotice(`เพิ่มวัตถุดิบ ${res.item.name} แล้ว`);
      setName("");
      setUnit("");
      setThreshold("0");
      setCost("0");
      setInitial("0");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มวัตถุดิบไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: Ingredient) {
    setEditing(item);
    setEditName(item.name);
    setEditThreshold(String(item.reorderThreshold));
    setEditCost(String(item.latestCost));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busyId) return;
    if (!editName.trim()) {
      setError("กรุณาระบุชื่อวัตถุดิบ");
      return;
    }
    setBusyId(editing.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.ingredientUpdate(editing.id, {
        name: editName.trim(),
        reorderThreshold: Number(editThreshold) || 0,
        latestCost: Number(editCost) || 0,
      });
      setNotice(`บันทึกวัตถุดิบ ${res.item.name} แล้ว`);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกวัตถุดิบไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(item: Ingredient) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      setError(null);
      setNotice(null);
      const res = await api.ingredientUpdate(item.id, { isEnabled: !item.isEnabled });
      setNotice(res.item.isEnabled ? `เปิดใช้วัตถุดิบ ${res.item.name} แล้ว` : `งดใช้วัตถุดิบ ${res.item.name} แล้ว`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนสถานะวัตถุดิบไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function moveStock(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || moving) return;
    const qty = Number(stockQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("กรุณาระบุปริมาณมากกว่า 0 (ทศนิยมได้ไม่เกิน 3 ตำแหน่ง)");
      return;
    }
    if (!stockReason.trim()) {
      setError("กรุณาระบุเหตุผลของธุรกรรมสต๊อก");
      return;
    }
    setMoving(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.stockMove(selected.id, {
        op: stockOp,
        qty,
        reason: stockReason.trim(),
        reference: stockRef.trim() || null,
      });
      setNotice(`บันทึก${STOCK_OP_LABELS[stockOp]} ${selected.name} แล้ว คงเหลือ ${fmtQty(res.ingredient.onHand)} ${res.ingredient.unit}`);
      setStockQty("");
      setStockReason("");
      setStockRef("");
      await refresh();
      await refreshLedger(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกสต๊อกไม่สำเร็จ");
    } finally {
      setMoving(false);
    }
  }

  async function saveRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (savingRecipe) return;
    if (!targetId) {
      setError("กรุณาเลือกเมนูหรือตัวเลือกเป้าหมายของสูตร");
      return;
    }
    const parsed = lines
      .filter((l) => l.ingredientId)
      .map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty) }));
    if (parsed.length === 0 || parsed.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
      setError("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ และปริมาณต้องมากกว่า 0");
      return;
    }
    setSavingRecipe(true);
    try {
      setError(null);
      setNotice(null);
      const res = await api.recipeCreate({ targetType, targetId, lines: parsed });
      setNotice(`สร้างสูตรเวอร์ชัน ${res.recipe.version} แล้ว (ต้นทุนประมาณ ${fmtBaht(res.recipe.estimatedCostPerUnit)}/หน่วย)`);
      setLines([{ ingredientId: "", qty: "" }]);
      await refreshRecipes(targetType, targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างสูตรไม่สำเร็จ");
    } finally {
      setSavingRecipe(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการวัตถุดิบและสต๊อก"
        description={`รับเข้า ตัดจ่าย และปรับยอดวัตถุดิบพร้อมเหตุผลทุกครั้ง · ทั้งหมด ${items.length} รายการ`}
        actions={
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-ink-300 bg-white px-4 py-2 text-sm font-semibold text-ink-800">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={showDisabled}
              onChange={(e) => void toggleDisabled(e.target.checked)}
            />
            แสดงวัตถุดิบที่งดใช้
          </label>
        }
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

      <Panel label="เพิ่มวัตถุดิบ">
        <form aria-label="ฟอร์มเพิ่มวัตถุดิบ" className="space-y-3" onSubmit={(e) => void create(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ing-name" className="mb-1 block text-sm font-semibold text-ink-800">
                ชื่อวัตถุดิบ (ไม่เกิน 120 ตัวอักษร)
              </label>
              <input
                id="ing-name"
                className={inputClass}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น ข้าวสาร"
              />
            </div>
            <div>
              <label htmlFor="ing-unit" className="mb-1 block text-sm font-semibold text-ink-800">
                หน่วย (กำหนดครั้งเดียว เปลี่ยนภายหลังไม่ได้)
              </label>
              <input
                id="ing-unit"
                className={inputClass}
                value={unit}
                maxLength={32}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="เช่น กรัม ฟอง มิลลิลิตร ถุง"
              />
            </div>
            <div>
              <label htmlFor="ing-threshold" className="mb-1 block text-sm font-semibold text-ink-800">
                ระดับเตือนสต๊อกต่ำ
              </label>
              <input
                id="ing-threshold"
                className={inputClass}
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="เช่น 100"
              />
            </div>
            <div>
              <label htmlFor="ing-cost" className="mb-1 block text-sm font-semibold text-ink-800">
                ราคาทุนล่าสุดต่อหน่วย (บาท)
              </label>
              <input
                id="ing-cost"
                className={inputClass}
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="เช่น 0.05"
              />
            </div>
            <div>
              <label htmlFor="ing-initial" className="mb-1 block text-sm font-semibold text-ink-800">
                ยอดเริ่มต้น (บันทึกเป็นรับเข้า “ยอดเริ่มต้น”)
              </label>
              <input
                id="ing-initial"
                className={inputClass}
                inputMode="decimal"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
                placeholder="เช่น 500"
              />
            </div>
          </div>
          <button type="submit" disabled={creating} aria-busy={creating} className={primaryButtonClass}>
            {creating ? "กำลังเพิ่ม…" : "เพิ่มวัตถุดิบ"}
          </button>
        </form>
      </Panel>

      <Panel label="รายการวัตถุดิบ">
        {loading ? (
          <p className="py-6 text-center">
            <Spinner label="กำลังโหลดวัตถุดิบ…" />
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
            <p className="font-semibold text-ink-800">ยังไม่มีวัตถุดิบ</p>
            <p className="mt-1 text-sm text-ink-600">เพิ่มวัตถุดิบจากฟอร์มด้านบนเพื่อเริ่มนับสต๊อก</p>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const low = item.isEnabled && item.available < item.reorderThreshold;
              const active = selectedId === item.id;
              return (
                <li
                  key={item.id}
                  className={`rounded-xl border p-3 ${active ? "border-brand-600 bg-brand-50" : "border-ink-200 bg-white"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-ink-900">{item.name}</p>
                      <p className="text-sm text-ink-600">
                        คงเหลือ {fmtQty(item.onHand)} {item.unit} · จอง {fmtQty(item.reserved)} · พร้อมขาย{" "}
                        {fmtQty(item.available)} {item.unit}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        {item.isEnabled ? <Badge tone="success">เปิดใช้</Badge> : <Badge tone="inactive">งดใช้</Badge>}
                        {low && <Badge tone="danger">ต่ำกว่าระดับเตือน ({fmtQty(item.reorderThreshold)} {item.unit})</Badge>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedId(active ? "" : item.id)}
                        aria-pressed={active}
                        className={secondaryButtonClass}
                      >
                        {active ? "ซ่อนสต๊อก" : "จัดการสต๊อก"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        aria-label={`แก้ไข${item.name}`}
                        className={secondaryButtonClass}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleEnabled(item)}
                        disabled={busyId === item.id}
                        aria-label={`${item.isEnabled ? "งดใช้" : "เปิดใช้"}${item.name}`}
                        className={dangerButtonClass}
                      >
                        {item.isEnabled ? "งดใช้" : "เปิดใช้"}
                      </button>
                    </div>
                  </div>
                  {editing?.id === item.id && (
                    <form aria-label={`ฟอร์มแก้ไข${item.name}`} className="mt-3 space-y-2 border-t border-ink-100 pt-3" onSubmit={(e) => void saveEdit(e)}>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <label htmlFor={`edit-ing-name-${item.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                            ชื่อวัตถุดิบ
                          </label>
                          <input
                            id={`edit-ing-name-${item.id}`}
                            className={inputClass}
                            value={editName}
                            maxLength={120}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        </div>
                        <div>
                          <label htmlFor={`edit-ing-threshold-${item.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                            ระดับเตือน
                          </label>
                          <input
                            id={`edit-ing-threshold-${item.id}`}
                            className={inputClass}
                            inputMode="decimal"
                            value={editThreshold}
                            onChange={(e) => setEditThreshold(e.target.value)}
                          />
                        </div>
                        <div>
                          <label htmlFor={`edit-ing-cost-${item.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                            ราคาทุนล่าสุด (บาท)
                          </label>
                          <input
                            id={`edit-ing-cost-${item.id}`}
                            className={inputClass}
                            inputMode="decimal"
                            value={editCost}
                            onChange={(e) => setEditCost(e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-ink-500">หน่วย “{item.unit}” เปลี่ยนไม่ได้หลังสร้าง (กันสูตรอ้างหน่วยผิด)</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={busyId === item.id} className={primaryButtonClass}>
                          บันทึก
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className={secondaryButtonClass}>
                          ยกเลิก
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {selected && (
        <Panel label={`สต๊อกของ${selected.name}`}>
          <div className="space-y-4">
            <form aria-label={`ฟอร์มบันทึกสต๊อก${selected.name}`} className="space-y-3" onSubmit={(e) => void moveStock(e)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="stock-op" className="mb-1 block text-sm font-semibold text-ink-800">
                    ประเภท
                  </label>
                  <select
                    id="stock-op"
                    className={inputClass}
                    value={stockOp}
                    onChange={(e) => setStockOp(e.target.value as ManualStockOp)}
                  >
                    {MANUAL_STOCK_OPS.map((op) => (
                      <option key={op} value={op}>
                        {STOCK_OP_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="stock-qty" className="mb-1 block text-sm font-semibold text-ink-800">
                    ปริมาณ ({selected.unit} มากกว่า 0)
                  </label>
                  <input
                    id="stock-qty"
                    className={inputClass}
                    inputMode="decimal"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    placeholder="เช่น 100"
                  />
                </div>
                <div>
                  <label htmlFor="stock-reason" className="mb-1 block text-sm font-semibold text-ink-800">
                    เหตุผล (บังคับ ไม่เกิน 500 ตัวอักษร)
                  </label>
                  <input
                    id="stock-reason"
                    className={inputClass}
                    value={stockReason}
                    maxLength={500}
                    onChange={(e) => setStockReason(e.target.value)}
                    placeholder="เช่น ซื้อจากตลาดเช้า"
                  />
                </div>
                <div>
                  <label htmlFor="stock-ref" className="mb-1 block text-sm font-semibold text-ink-800">
                    เลขอ้างอิง (ไม่บังคับ เช่น เลขบิล)
                  </label>
                  <input
                    id="stock-ref"
                    className={inputClass}
                    value={stockRef}
                    maxLength={120}
                    onChange={(e) => setStockRef(e.target.value)}
                    placeholder="เช่น BILL-001"
                  />
                </div>
              </div>
              <button type="submit" disabled={moving} aria-busy={moving} className={primaryButtonClass}>
                {moving ? "กำลังบันทึก…" : "บันทึกสต๊อก"}
              </button>
            </form>

            <div className="space-y-2">
              <h2 className="text-base font-bold text-ink-900">ประวัติล่าสุด (20 รายการ)</h2>
              {ledgerLoading ? (
                <p className="py-4 text-center">
                  <Spinner label="กำลังโหลดประวัติ…" />
                </p>
              ) : ledger.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-600">
                  ยังไม่มีประวัติของวัตถุดิบนี้
                </p>
              ) : (
                <ul className="space-y-2">
                  {ledger.map((en) => (
                    <li key={en.id} className="rounded-xl border border-ink-200 p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={en.op === "waste" || en.op === "expire" ? "danger" : "neutral"}>
                          {STOCK_OP_LABELS[en.op]}
                        </Badge>
                        <span className="font-semibold text-ink-900">
                          คงเหลือ {fmtQty(en.beforeOnHand)} → {fmtQty(en.afterOnHand)} {selected.unit}
                        </span>
                        <span className="text-ink-600">
                          จอง {fmtQty(en.beforeReserved)} → {fmtQty(en.afterReserved)}
                        </span>
                      </p>
                      <p className="mt-1 text-ink-600">
                        {en.reason} · {en.actorUsername ?? "ระบบ"} · {fmtDateTime(en.createdAt)}
                        {en.orderId ? ` · คำสั่งซื้อ ${en.reference ?? ""}` : ""}
                        {en.reference && !en.orderId ? ` · อ้างอิง ${en.reference}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel label="สูตรเมนูและตัวเลือก">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            สูตรเป็นแบบ versioned — ทุกครั้งที่แก้ไขคือการสร้างเวอร์ชันใหม่ เวอร์ชันเก่าคงไว้ตรวจสอบย้อนหลัง
            คำสั่งซื้อยืนยันใหม่อ้างสูตรล่าสุดเสมอ
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="recipe-type" className="mb-1 block text-sm font-semibold text-ink-800">
                เป้าหมาย
              </label>
              <select
                id="recipe-type"
                className={inputClass}
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as "menu" | "option")}
              >
                <option value="menu">สูตรฐานของเมนู</option>
                <option value="option">สูตรเพิ่มเติมของตัวเลือก</option>
              </select>
            </div>
            <div>
              <label htmlFor="recipe-menu" className="mb-1 block text-sm font-semibold text-ink-800">
                เมนู
              </label>
              <select
                id="recipe-menu"
                className={inputClass}
                value={targetMenuId}
                onChange={(e) => setTargetMenuId(e.target.value)}
              >
                <option value="">— เลือกเมนู —</option>
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.category} · {m.name}
                  </option>
                ))}
              </select>
            </div>
            {targetType === "option" && (
              <div>
                <label htmlFor="recipe-option" className="mb-1 block text-sm font-semibold text-ink-800">
                  ตัวเลือก
                </label>
                <select
                  id="recipe-option"
                  className={inputClass}
                  value={targetOptionId}
                  onChange={(e) => setTargetOptionId(e.target.value)}
                >
                  <option value="">— เลือกตัวเลือก —</option>
                  {optionChoices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.groupName} · {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <form aria-label="ฟอร์มสร้างสูตร" className="space-y-3" onSubmit={(e) => void saveRecipe(e)}>
            {lines.map((line, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <div>
                  <label htmlFor={`recipe-ing-${i}`} className="mb-1 block text-sm font-semibold text-ink-800">
                    วัตถุดิบที่ {i + 1}
                  </label>
                  <select
                    id={`recipe-ing-${i}`}
                    className={inputClass}
                    value={line.ingredientId}
                    onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ingredientId: e.target.value } : l)))}
                  >
                    <option value="">— เลือกวัตถุดิบ —</option>
                    {items
                      .filter((it) => it.isEnabled)
                      .map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.unit})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`recipe-qty-${i}`} className="mb-1 block text-sm font-semibold text-ink-800">
                    ปริมาณต่อ 1 หน่วยขาย
                  </label>
                  <input
                    id={`recipe-qty-${i}`}
                    className={inputClass}
                    inputMode="decimal"
                    value={line.qty}
                    onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty: e.target.value } : l)))}
                    placeholder="เช่น 100"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => setLines((ls) => (ls.length <= 1 ? ls : ls.filter((_, j) => j !== i)))}
                    disabled={lines.length <= 1}
                    aria-label={`ลบบรรทัดที่ ${i + 1}`}
                    className={dangerButtonClass}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setLines((ls) => (ls.length >= 50 ? ls : [...ls, { ingredientId: "", qty: "" }]))}
                disabled={lines.length >= 50}
                className={secondaryButtonClass}
              >
                เพิ่มบรรทัดวัตถุดิบ
              </button>
              <button type="submit" disabled={savingRecipe} aria-busy={savingRecipe} className={primaryButtonClass}>
                {savingRecipe ? "กำลังสร้าง…" : "สร้างสูตรเวอร์ชันใหม่"}
              </button>
            </div>
          </form>

          <div className="space-y-2">
            <h2 className="text-base font-bold text-ink-900">ประวัติเวอร์ชัน{targetId ? ` (${recipes.length} เวอร์ชัน)` : ""}</h2>
            {!targetId ? (
              <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-600">
                เลือกเมนูหรือตัวเลือกเป้าหมายเพื่อดูประวัติสูตร
              </p>
            ) : recipesLoading ? (
              <p className="py-4 text-center">
                <Spinner label="กำลังโหลดสูตร…" />
              </p>
            ) : recipes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-600">
                เป้าหมายนี้ยังไม่มีสูตร — คำสั่งซื้อจะไม่ตรวจสต๊อกรายการนี้จนกว่าจะมีสูตร
              </p>
            ) : (
              <ul className="space-y-2">
                {[...recipes].reverse().map((r) => (
                  <li key={r.id} className="rounded-xl border border-ink-200 p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">เวอร์ชัน {r.version}</Badge>
                      <span className="font-semibold text-ink-900">ต้นทุนประมาณ {fmtBaht(r.estimatedCostPerUnit)}/หน่วย</span>
                      <span className="text-ink-600">
                        โดย {r.createdBy ?? "ระบบ"} · {fmtDateTime(r.createdAt)}
                      </span>
                    </p>
                    <p className="mt-1 text-ink-600">
                      {r.lines.length} วัตถุดิบ:{" "}
                      {r.lines
                        .map((l) => {
                          const ing = items.find((it) => it.id === l.ingredientId);
                          return `${ing?.name ?? "วัตถุดิบ"} ${fmtQty(l.qty)} ${ing?.unit ?? ""}`;
                        })
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
