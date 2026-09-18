import { useCallback, useEffect, useState } from "react";
import {
  REDEMPTION_STATUS_LABELS,
  api,
  type AuditItem,
  type Reward,
  type RewardRedemption,
  type WalkinQrToken,
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
  successButtonClass,
} from "../../components/ui";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDateInput(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * หน้าจัดการรางวัลและการแลกแต้มหลังร้าน (Ticket 10 — session พนักงานเท่านั้น):
 * - ฝ่ายเครื่องดื่ม/Owner/Admin: รายการรอรับ (consume/release) + ออก QR Walk-in
 * - เฉพาะ Owner/Admin: จัดการแคตตาลอกรางวัล + ดูประวัติคะแนน (server ปฏิเสธสิทธิ์ที่เหลือ)
 * - ไม่เรียก endpoint ฝั่งลูกค้า — ไม่เห็นยอด/ประวัติแต้มของลูกค้ารายบุคคล
 */
export default function AdminRewardsPage({ isManager }: { isManager: boolean }) {
  const [pending, setPending] = useState<RewardRedemption[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");

  const [qr, setQr] = useState<WalkinQrToken | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrMsg, setQrMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [formMsg, setFormMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [fName, setFName] = useState("");
  const [fMenuId, setFMenuId] = useState("");
  const [fPoints, setFPoints] = useState("");
  const [fQuota, setFQuota] = useState("");
  const [fImageUrl, setFImageUrl] = useState("");
  const [fStartsAt, setFStartsAt] = useState("");
  const [fEndsAt, setFEndsAt] = useState("");

  const [editing, setEditing] = useState<Reward | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [eName, setEName] = useState("");
  const [ePoints, setEPoints] = useState("");
  const [eQuota, setEQuota] = useState("");
  const [eActive, setEActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPending((await api.pendingRedemptions()).redemptions);
      if (isManager) {
        setRewards((await api.rewardsList()).rewards);
        setAudit(await api.loyaltyAudit().then((r) => r.items));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "โหลดข้อมูลรางวัลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  async function consume(id: string) {
    if (rowBusyId) return;
    setRowBusyId(id);
    setRowMsg(null);
    try {
      const { redemption } = await api.redemptionConsume(id);
      setRowMsg({ tone: "success", text: `รับรายการ ${redemption.code} แล้ว ส่งงานคิวเครื่องดื่มให้ร้านทำต่อ` });
      await load();
    } catch (err) {
      setRowMsg({ tone: "error", text: err instanceof Error ? err.message : "รับรายการไม่สำเร็จ" });
    } finally {
      setRowBusyId(null);
    }
  }

  async function release(id: string) {
    if (!releaseReason.trim()) {
      setRowMsg({ tone: "error", text: "กรุณาระบุเหตุผลปฏิเสธ/ยกเลิก" });
      return;
    }
    setRowBusyId(id);
    setRowMsg(null);
    try {
      await api.redemptionRelease(id, releaseReason.trim());
      setRowMsg({ tone: "success", text: "ปฏิเสธรายการและคืนคะแนนให้ลูกค้าแล้ว" });
      setReleaseId(null);
      setReleaseReason("");
      await load();
    } catch (err) {
      setRowMsg({ tone: "error", text: err instanceof Error ? err.message : "ปฏิเสธรายการไม่สำเร็จ" });
    } finally {
      setRowBusyId(null);
    }
  }

  async function issueQr() {
    if (qrBusy) return;
    setQrBusy(true);
    setQrMsg(null);
    try {
      const { token } = await api.walkinIssue();
      setQr(token);
      setQrMsg({ tone: "success", text: "ออกรหัส QR แล้ว แสดงให้ลูกค้าสแกนภายใน 10 นาที (ใช้ได้ครั้งเดียว)" });
    } catch (err) {
      setQrMsg({ tone: "error", text: err instanceof Error ? err.message : "ออก QR ไม่สำเร็จ" });
    } finally {
      setQrBusy(false);
    }
  }

  async function createReward(e: React.FormEvent) {
    e.preventDefault();
    const pointsCost = Number(fPoints);
    if (!fName.trim() || !fMenuId.trim() || !Number.isInteger(pointsCost) || pointsCost < 1) {
      setFormMsg({ tone: "error", text: "กรุณากรอกชื่อรางวัล รหัสเมนู และคะแนนที่ใช้ (จำนวนเต็มตั้งแต่ 1)" });
      return;
    }
    const quotaTotal = fQuota.trim() === "" ? null : Number(fQuota);
    if (quotaTotal !== null && (!Number.isInteger(quotaTotal) || quotaTotal < 1)) {
      setFormMsg({ tone: "error", text: "จำนวนสิทธิ์ต้องเป็นจำนวนเต็มตั้งแต่ 1 หรือเว้นว่างไว้ (ไม่จำกัด)" });
      return;
    }
    setFormBusy(true);
    setFormMsg(null);
    try {
      const { reward } = await api.rewardCreate({
        name: fName.trim(),
        menuId: fMenuId.trim(),
        pointsCost,
        quotaTotal,
        imageUrl: fImageUrl.trim() ? fImageUrl.trim() : null,
        startsAt: parseDateInput(fStartsAt),
        endsAt: parseDateInput(fEndsAt),
        isActive: true,
      });
      setFormMsg({ tone: "success", text: `สร้างรางวัล “${reward.name}” แล้ว` });
      setFName("");
      setFMenuId("");
      setFPoints("");
      setFQuota("");
      setFImageUrl("");
      setFStartsAt("");
      setFEndsAt("");
      await load();
    } catch (err) {
      setFormMsg({ tone: "error", text: err instanceof Error ? err.message : "สร้างรางวัลไม่สำเร็จ" });
    } finally {
      setFormBusy(false);
    }
  }

  function startEdit(r: Reward) {
    setEditing(r);
    setEName(r.name);
    setEPoints(String(r.pointsCost));
    setEQuota(r.quotaTotal === null ? "" : String(r.quotaTotal));
    setEActive(r.isActive);
    setFormMsg(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const pointsCost = Number(ePoints);
    if (!eName.trim() || !Number.isInteger(pointsCost) || pointsCost < 1) {
      setFormMsg({ tone: "error", text: "กรุณากรอกชื่อรางวัลและคะแนนที่ใช้ให้ถูกต้อง" });
      return;
    }
    const quotaTotal = eQuota.trim() === "" ? null : Number(eQuota);
    if (quotaTotal !== null && (!Number.isInteger(quotaTotal) || quotaTotal < 0)) {
      setFormMsg({ tone: "error", text: "จำนวนสิทธิ์ต้องเป็นจำนวนเต็มตั้งแต่ 0 หรือเว้นว่างไว้" });
      return;
    }
    setEditBusy(true);
    try {
      await api.rewardUpdate(editing.id, { name: eName.trim(), pointsCost, quotaTotal, isActive: eActive });
      setFormMsg({ tone: "success", text: "บันทึกรางวัลแล้ว" });
      setEditing(null);
      await load();
    } catch (err) {
      setFormMsg({ tone: "error", text: err instanceof Error ? err.message : "บันทึกรางวัลไม่สำเร็จ" });
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleActive(r: Reward) {
    if (rowBusyId) return;
    setRowBusyId(r.id);
    setRowMsg(null);
    try {
      await api.rewardUpdate(r.id, { isActive: !r.isActive });
      setRowMsg({ tone: "success", text: r.isActive ? `ปิดขาย “${r.name}” แล้ว` : `เปิดขาย “${r.name}” แล้ว` });
      await load();
    } catch (err) {
      setRowMsg({ tone: "error", text: err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ" });
    } finally {
      setRowBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 text-center">
        <Spinner label="กำลังโหลดข้อมูลรางวัล…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-10">
        <Alert tone="error" role="alert">{loadError}</Alert>
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        title="รางวัลและการแลกแต้ม"
        description="รับรายการแลกของลูกค้า ออก QR Walk-in และจัดการแคตตาลอกรางวัล"
        actions={
          <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
            โหลดใหม่
          </button>
        }
      />

      {rowMsg && <Alert tone={rowMsg.tone} role={rowMsg.tone === "error" ? "alert" : "status"}>{rowMsg.text}</Alert>}

      <Panel label="รายการรอรับ">
        <h2 className="pa-display text-base text-ink-900">รายการรอรับ ({pending.length})</h2>
        <p className="mt-1 text-sm text-ink-600">กดรับเพื่อสร้างงานคิวเครื่องดื่มราคา 0 ให้ร้านทำต่อ หรือปฏิเสธเพื่อคืนคะแนนให้ลูกค้า</p>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">ไม่มีรายการรอรับในขณะนี้</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-semibold text-ink-900">
                    {r.rewardName} <span className="font-normal text-ink-500">({r.code})</span>
                  </p>
                  <Badge tone="brand">{REDEMPTION_STATUS_LABELS[r.status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-600">{r.menuName} · ขอแลกเมื่อ {fmtTime(r.createdAt)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={rowBusyId !== null}
                    aria-busy={rowBusyId === r.id}
                    onClick={() => void consume(r.id)}
                    className={successButtonClass}
                  >
                    {rowBusyId === r.id ? "กำลังรับ…" : "รับรายการ"}
                  </button>
                  {releaseId === r.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void release(r.id);
                      }}
                      className="flex min-w-0 flex-1 flex-wrap items-end gap-2 basis-64"
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <label htmlFor={`admin-release-${r.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                          เหตุผลปฏิเสธ
                        </label>
                        <input
                          id={`admin-release-${r.id}`}
                          className={inputClass}
                          value={releaseReason}
                          onChange={(e) => setReleaseReason(e.target.value)}
                          placeholder="เช่น วัตถุดิบหมด"
                          maxLength={500}
                        />
                      </div>
                      <button type="submit" disabled={rowBusyId !== null} className={dangerButtonClass}>
                        ยืนยันปฏิเสธ
                      </button>
                      <button
                        type="button"
                        disabled={rowBusyId !== null}
                        onClick={() => {
                          setReleaseId(null);
                          setReleaseReason("");
                        }}
                        className={secondaryButtonClass}
                      >
                        ไว้ก่อน
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={rowBusyId !== null}
                      onClick={() => {
                        setReleaseId(r.id);
                        setReleaseReason("");
                        setRowMsg(null);
                      }}
                      className={dangerButtonClass}
                    >
                      ปฏิเสธ
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="ออก QR Walk-in">
        <h2 className="pa-display text-base text-ink-900">ออก QR Walk-in</h2>
        <p className="mt-1 text-sm text-ink-600">รหัสใช้ได้ครั้งเดียวภายใน 10 นาที ลูกค้าสแกนรับ 1 แต้ม (ไม่ซ้ำกับคะแนนคำสั่งซื้อ)</p>
        <div className="mt-3">
          <button type="button" onClick={() => void issueQr()} disabled={qrBusy} aria-busy={qrBusy} className={primaryButtonClass}>
            {qrBusy ? "กำลังออก…" : "ออกรหัส QR ใหม่"}
          </button>
        </div>
        {qrMsg && (
          <div className="mt-3">
            <Alert tone={qrMsg.tone} role={qrMsg.tone === "error" ? "alert" : "status"}>{qrMsg.text}</Alert>
          </div>
        )}
        {qr && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3" aria-live="polite">
            <p className="text-sm text-ink-600">ให้ลูกค้ากรอกรหัสนี้ในหน้าสะสมแต้ม</p>
            <p className="mt-1 text-2xl font-bold tracking-wide text-brand-800" aria-label={`รหัสคิวอาร์ ${qr.code}`}>{qr.code}</p>
            <p className="mt-1 text-sm text-ink-600">หมดอายุ {fmtTime(qr.expiresAt)}</p>
          </div>
        )}
      </Panel>

      {isManager ? (
        <>
          <Panel label="สร้างรางวัลใหม่">
            <h2 className="pa-display text-base text-ink-900">สร้างรางวัลใหม่</h2>
            {formMsg && (
              <div className="mt-3">
                <Alert tone={formMsg.tone} role={formMsg.tone === "error" ? "alert" : "status"}>{formMsg.text}</Alert>
              </div>
            )}
            <form onSubmit={createReward} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rw-name" className="mb-1 block text-sm font-semibold text-ink-800">ชื่อรางวัล</label>
                <input id="rw-name" className={inputClass} value={fName} onChange={(e) => setFName(e.target.value)} maxLength={120} required />
              </div>
              <div>
                <label htmlFor="rw-menu" className="mb-1 block text-sm font-semibold text-ink-800">รหัสเมนูเครื่องดื่ม</label>
                <input id="rw-menu" className={inputClass} value={fMenuId} onChange={(e) => setFMenuId(e.target.value)} placeholder="ดูรหัสจากหน้าจัดการเมนู" autoComplete="off" required />
              </div>
              <div>
                <label htmlFor="rw-points" className="mb-1 block text-sm font-semibold text-ink-800">คะแนนที่ใช้ (แต้ม)</label>
                <input id="rw-points" type="number" min={1} step={1} className={inputClass} value={fPoints} onChange={(e) => setFPoints(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="rw-quota" className="mb-1 block text-sm font-semibold text-ink-800">จำนวนสิทธิ์ (เว้นว่าง = ไม่จำกัด)</label>
                <input id="rw-quota" type="number" min={1} step={1} className={inputClass} value={fQuota} onChange={(e) => setFQuota(e.target.value)} placeholder="ไม่จำกัด" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="rw-image" className="mb-1 block text-sm font-semibold text-ink-800">ลิงก์รูป (ไม่บังคับ)</label>
                <input id="rw-image" type="url" className={inputClass} value={fImageUrl} onChange={(e) => setFImageUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <label htmlFor="rw-start" className="mb-1 block text-sm font-semibold text-ink-800">เริ่มแลกได้ (เว้นว่าง = ทันที)</label>
                <input id="rw-start" type="datetime-local" className={inputClass} value={fStartsAt} onChange={(e) => setFStartsAt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="rw-end" className="mb-1 block text-sm font-semibold text-ink-800">หมดเขต (เว้นว่าง = ไม่จำกัด)</label>
                <input id="rw-end" type="datetime-local" className={inputClass} value={fEndsAt} onChange={(e) => setFEndsAt(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" disabled={formBusy} aria-busy={formBusy} className={primaryButtonClass}>
                  {formBusy ? "กำลังสร้าง…" : "สร้างรางวัล"}
                </button>
              </div>
            </form>
          </Panel>

          <Panel label="รางวัลทั้งหมด">
            <h2 className="pa-display text-base text-ink-900">รางวัลทั้งหมด ({rewards.length})</h2>
            {rewards.length === 0 ? (
              <p className="mt-2 text-sm text-ink-600">ยังไม่มีรางวัล สร้างรางวัลแรกจากแบบฟอร์มด้านบน</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {rewards.map((r) => (
                  <li key={r.id} className="rounded-xl border border-ink-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 font-semibold text-ink-900">{r.name}</p>
                      <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "เปิดขาย" : "ปิดขาย"}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-600">
                      {r.menuName} · ใช้ {r.pointsCost} แต้ม · ใช้ไป {r.quotaUsed}{r.quotaTotal === null ? " (ไม่จำกัดสิทธิ์)" : `/${r.quotaTotal} สิทธิ์`}
                    </p>
                    {editing?.id === r.id ? (
                      <form onSubmit={saveEdit} className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`erw-name-${r.id}`} className="mb-1 block text-sm font-semibold text-ink-800">ชื่อรางวัล</label>
                          <input id={`erw-name-${r.id}`} className={inputClass} value={eName} onChange={(e) => setEName(e.target.value)} maxLength={120} required />
                        </div>
                        <div>
                          <label htmlFor={`erw-points-${r.id}`} className="mb-1 block text-sm font-semibold text-ink-800">คะแนนที่ใช้</label>
                          <input id={`erw-points-${r.id}`} type="number" min={1} step={1} className={inputClass} value={ePoints} onChange={(e) => setEPoints(e.target.value)} required />
                        </div>
                        <div>
                          <label htmlFor={`erw-quota-${r.id}`} className="mb-1 block text-sm font-semibold text-ink-800">จำนวนสิทธิ์ (เว้นว่าง = ไม่จำกัด)</label>
                          <input id={`erw-quota-${r.id}`} type="number" min={0} step={1} className={inputClass} value={eQuota} onChange={(e) => setEQuota(e.target.value)} />
                        </div>
                        <div className="flex min-h-[44px] items-center gap-2">
                          <input id={`erw-active-${r.id}`} type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} className="h-5 w-5 accent-brand-600" />
                          <label htmlFor={`erw-active-${r.id}`} className="text-sm font-semibold text-ink-800">เปิดขาย</label>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          <button type="submit" disabled={editBusy} aria-busy={editBusy} className={primaryButtonClass}>
                            {editBusy ? "กำลังบันทึก…" : "บันทึก"}
                          </button>
                          <button type="button" disabled={editBusy} onClick={() => setEditing(null)} className={secondaryButtonClass}>
                            ยกเลิก
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => startEdit(r)} className={secondaryButtonClass}>
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          disabled={rowBusyId !== null}
                          onClick={() => void toggleActive(r)}
                          className={secondaryButtonClass}
                        >
                          {r.isActive ? "ปิดขาย" : "เปิดขาย"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel label="ประวัติคะแนนและรางวัล">
            <h2 className="pa-display text-base text-ink-900">ประวัติคะแนนและรางวัล</h2>
            {audit.length === 0 ? (
              <p className="mt-2 text-sm text-ink-600">ยังไม่มีประวัติ (ดูได้เฉพาะ Owner/Admin ไม่มีข้อมูลลับลูกค้า)</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {audit.map((a) => (
                  <li key={a.id} className="rounded-xl border border-ink-200 px-3 py-2 text-sm">
                    <span className="font-medium text-ink-900">{a.action}</span>
                    {a.detail && <span className="block truncate text-ink-600">{a.detail}</span>}
                    <span className="block text-xs text-ink-500">
                      {a.actorUsername ?? "ระบบ"} · {fmtTime(a.at)}{a.success === false ? " · ไม่สำเร็จ" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : (
        <Panel label="ข้อจำกัดสิทธิ์">
          <p className="text-sm text-ink-600">
            ฝ่ายเครื่องดื่มจัดการได้เฉพาะรายการรอรับและ QR Walk-in — การสร้าง/แก้ไขรางวัลและประวัติเป็นของ Owner/Admin เท่านั้น
          </p>
        </Panel>
      )}

      <p className="text-xs text-ink-500">
        หมายเหตุ: รับรายการแลกสร้างงานคิวเครื่องดื่มราคา 0 หนึ่งงาน ไม่สร้างรายรับและไม่ได้คะแนนซ้ำ
      </p>
    </div>
  );
}
