import { useEffect, useState } from "react";
import { TABLE_ROUND_STATUS_LABELS, api, type ShopTable, type TableRoundDetail } from "../lib/api";
import { Badge } from "../components/ui";
import { Alert, Panel, Spinner, inputClass, primaryButtonClass, secondaryButtonClass } from "../components/ui";

/**
 * หน้าเช็กอินและรอบการใช้โต๊ะ (Ticket 06 — Owner/Admin เท่านั้น):
 * - เช็กอินด้วยรหัสจอง เบอร์โทร หรือ QR แล้วเปิดรอบการใช้โต๊ะ
 * - ดูรอบที่เปิดอยู่และปิดรอบเมื่อยอดครบ (ไม่มีออเดอร์รอชำระผูกอยู่)
 * - server ปฏิเสธ kitchen/drink/guest ทุกเส้น (403/401)
 */
export default function CheckinPage() {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [tableId, setTableId] = useState("");
  const [tables, setTables] = useState<ShopTable[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkOk, setCheckOk] = useState<string | null>(null);

  const [rounds, setRounds] = useState<TableRoundDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [openRounds, tableList] = await Promise.all([
        api.roundsList("open"),
        api.listTables().catch(() => ({ tables: [] as ShopTable[] })),
      ]);
      setRounds(openRounds.rounds);
      setTables(tableList.tables.filter((t) => t.isEnabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรอบการใช้โต๊ะไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function checkin() {
    if (checking) return;
    setCheckError(null);
    setCheckOk(null);
    if (!code.trim() && !phone.trim()) {
      setCheckError("กรุณาระบุรหัสการจองหรือเบอร์โทร");
      return;
    }
    const n = Number(partySize);
    if (!Number.isInteger(n) || n < 1) {
      setCheckError("จำนวนผู้ใช้บริการจริงต้องเป็นจำนวนเต็มมากกว่าศูนย์");
      return;
    }
    try {
      setChecking(true);
      const res = await api.checkin({
        code: code.trim() ? code.trim() : undefined,
        phone: phone.trim() ? phone.trim() : undefined,
        partySize: n,
        tableId: tableId ? tableId : undefined,
      });
      setCheckOk(`เช็กอิน ${res.reservation.code} สำเร็จ เปิดรอบโต๊ะ ${res.round.tableName} จำนวน ${res.round.partySize} คนแล้ว`);
      setCode("");
      setPhone("");
      setTableId("");
      setRounds((await api.roundsList("open")).rounds);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "เช็กอินไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  }

  async function closeRound(id: string, tableName: string) {
    if (closingId) return;
    setCloseError(null);
    try {
      setClosingId(id);
      await api.roundClose(id);
      setRounds((list) => list.filter((r) => r.id !== id));
      setCheckOk(`ปิดรอบโต๊ะ ${tableName} แล้ว`);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "ปิดรอบไม่สำเร็จ");
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">เช็กอินและรอบการใช้โต๊ะ</h1>
          <p className="mt-1 text-sm text-ink-600">ค้นหาด้วยรหัสจองหรือเบอร์โทร ตรวจจำนวนจริง แล้วเปิดรอบโต๊ะเพียงครั้งเดียว</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          {loading ? "กำลังโหลด…" : "โหลดใหม่"}
        </button>
      </header>

      <Panel label="เช็กอิน">
        <div className="space-y-3">
          <h2 className="text-base font-bold text-ink-900">เช็กอินลูกค้า</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="checkin-code" className="mb-1 block text-sm font-semibold text-ink-800">
                รหัสการจอง (เช่น RSV-20260914-AB12)
              </label>
              <input
                id="checkin-code"
                className={inputClass}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="หรือเว้นว่างแล้วใช้เบอร์โทร"
              />
            </div>
            <div>
              <label htmlFor="checkin-phone" className="mb-1 block text-sm font-semibold text-ink-800">
                เบอร์โทรลูกค้า
              </label>
              <input
                id="checkin-phone"
                className={inputClass}
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="เช่น 0812345678"
              />
            </div>
            <div>
              <label htmlFor="checkin-party" className="mb-1 block text-sm font-semibold text-ink-800">
                จำนวนผู้ใช้บริการจริง (คน)
              </label>
              <input
                id="checkin-party"
                className={inputClass}
                inputMode="numeric"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="checkin-table" className="mb-1 block text-sm font-semibold text-ink-800">
                เปลี่ยนโต๊ะ (ถ้าโต๊ะตามจองไม่พอ)
              </label>
              <select id="checkin-table" className={inputClass} value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">ใช้โต๊ะตามการจอง</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (รองรับ {t.capacity} คน)
                  </option>
                ))}
              </select>
            </div>
          </div>
          {checkError ? (
            <Alert tone="error" role="alert">
              {checkError}
            </Alert>
          ) : null}
          {checkOk ? (
            <Alert tone="success" role="status">
              {checkOk}
            </Alert>
          ) : null}
          <button
            type="button"
            onClick={() => void checkin()}
            disabled={checking}
            aria-busy={checking}
            className={primaryButtonClass}
          >
            {checking ? "กำลังเช็กอิน…" : "เช็กอินและเปิดรอบโต๊ะ"}
          </button>
        </div>
      </Panel>

      <Panel label="รอบการใช้โต๊ะที่เปิดอยู่">
        <div className="space-y-3">
          <h2 className="text-base font-bold text-ink-900">รอบที่เปิดอยู่</h2>
          {loading ? (
            <p className="py-6 text-center">
              <Spinner label="กำลังโหลดรอบโต๊ะ…" />
            </p>
          ) : error ? (
            <div className="space-y-3">
              <Alert tone="error" role="alert">
                {error}
              </Alert>
              <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
                ลองใหม่
              </button>
            </div>
          ) : rounds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center">
              <p className="font-semibold text-ink-800">ไม่มีรอบการใช้โต๊ะที่เปิดอยู่</p>
              <p className="mt-1 text-sm text-ink-600">เช็กอินการจองด้านบนเพื่อเปิดรอบใหม่</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p role="status" className="text-sm text-ink-600">
                เปิดอยู่ {rounds.length} รอบ
              </p>
              {closeError ? (
                <Alert tone="error" role="alert">
                  {closeError}
                </Alert>
              ) : null}
              <ul className="space-y-2.5">
                {rounds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200 bg-white p-3">
                    <div className="min-w-0">
                      <p className="font-bold text-ink-900">โต๊ะ {r.tableName}</p>
                      <p className="text-sm text-ink-600">
                        {r.partySize} คน · เปิด {new Date(r.openedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === "open" ? "active" : "neutral"}>{TABLE_ROUND_STATUS_LABELS[r.status]}</Badge>
                      <button
                        type="button"
                        onClick={() => void closeRound(r.id, r.tableName)}
                        disabled={closingId === r.id}
                        aria-busy={closingId === r.id}
                        className={secondaryButtonClass}
                      >
                        {closingId === r.id ? "กำลังปิด…" : `ปิดรอบ ${r.tableName}`}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
