import { useState } from "react";
import type { ShopOverride } from "../lib/api";
import { fmtBangkok } from "../lib/shop-week";
import { parseBangkokWall } from "../lib/bangkok-time";
import { Alert, Badge, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

export interface OverrideFormBody {
  mode: "open" | "closed";
  reason?: string;
  expectedReopenAt?: string;
  expiresAt?: string;
}

export interface OverridePanelProps {
  override: ShopOverride | null;
  expiredOverride: ShopOverride | null;
  busy: boolean;
  onApply: (body: OverrideFormBody) => Promise<void>;
  onClear: () => Promise<void>;
}

export type OverrideBodyResult = { ok: true; body: OverrideFormBody } | { ok: false; error: string };

/**
 * ประกอบ request body จากค่าฟอร์ม (pure — unit test ได้โดยไม่ต้อง render)
 * แปลง datetime-local (wall-clock กรุงเทพ) เป็น UTC ISO และตรวจความถูกต้องก่อนเรียก API
 */
export function buildOverrideBody(input: {
  mode: "open" | "closed";
  reason: string;
  expected: string;
  expires: string;
}): OverrideBodyResult {
  const body: OverrideFormBody = { mode: input.mode };
  if (input.reason.trim()) body.reason = input.reason.trim();
  if (input.expected) {
    const parsed = parseBangkokWall(input.expected);
    if (!parsed.ok) return { ok: false, error: `คาดว่าจะเปิด: ${parsed.error}` };
    body.expectedReopenAt = parsed.iso;
  }
  if (input.expires) {
    const parsed = parseBangkokWall(input.expires);
    if (!parsed.ok) return { ok: false, error: `หมดอายุคำสั่ง: ${parsed.error}` };
    body.expiresAt = parsed.iso;
  }
  return { ok: true, body };
}

/** แผงคำสั่งเปิด–ปิดชั่วคราว (สกัดจาก ShopPage — markup และ accessible name เดิม) */
export function OverridePanel({ override, expiredOverride, busy, onApply, onClear }: OverridePanelProps) {
  const [mode, setMode] = useState<"open" | "closed">("closed");
  const [reason, setReason] = useState("");
  const [expected, setExpected] = useState("");
  const [expires, setExpires] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);
    // datetime-local คือ wall-clock กรุงเทพ (Asia/Bangkok) — ห้าม new Date(value) ตรง ๆ
    // เพราะเบราว์เซอร์จะตีความเป็น timezone ของเครื่องนั้น
    const built = buildOverrideBody({ mode, reason, expected, expires });
    if (!built.ok) {
      setLocalError(built.error);
      return;
    }
    await onApply(built.body);
    setReason("");
    setExpected("");
    setExpires("");
  }

  return (
    <div className="space-y-4">
      {override ? (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={override.mode === "open" ? "success" : "danger"}>
              {override.mode === "open" ? "เปิดชั่วคราว" : "ปิดชั่วคราว"}
            </Badge>
            {override.reason && <span className="text-ink-800">เหตุผล: {override.reason}</span>}
          </p>
          {override.expectedReopenAt && (
            <p className="text-sm text-ink-600">คาดว่าจะเปิด: {fmtBangkok(override.expectedReopenAt)}</p>
          )}
          {override.expiresAt && (
            <p className="text-sm text-ink-600">หมดอายุคำสั่งเมื่อ: {fmtBangkok(override.expiresAt)}</p>
          )}
          <button type="button" onClick={() => void onClear()} disabled={busy} aria-busy={busy} className={secondaryButtonClass}>
            {busy ? "กำลังล้าง…" : "ล้างคำสั่ง กลับไปใช้ตารางปกติ"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-600">ขณะนี้ไม่มีคำสั่งชั่วคราว ร้านใช้ตารางประจำสัปดาห์</p>
      )}
      {expiredOverride && (
        <Alert tone="info" role="status">
          คำสั่งล่าสุดหมดอายุแล้ว ({expiredOverride.mode === "open" ? "เปิด" : "ปิด"}ชั่วคราว
          {expiredOverride.reason ? `: ${expiredOverride.reason}` : ""}) ร้านกลับไปใช้ตารางประจำสัปดาห์
          กดล้างคำสั่งเพื่อเอาแถวที่หมดอายุออก
        </Alert>
      )}
      <form onSubmit={submit} aria-label="ฟอร์มเปิดปิดชั่วคราว" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ov-mode" className="mb-1 block text-sm font-semibold text-ink-800">
              คำสั่ง
            </label>
            <select id="ov-mode" value={mode} onChange={(e) => setMode(e.target.value as "open" | "closed")} className={inputClass}>
              <option value="closed">ปิดชั่วคราว (ต้องระบุเหตุผล)</option>
              <option value="open">เปิดชั่วคราว</option>
            </select>
          </div>
          <div>
            <label htmlFor="ov-expected" className="mb-1 block text-sm font-semibold text-ink-800">
              คาดว่าจะเปิด เวลา Asia/Bangkok (แสดงผลเท่านั้น)
            </label>
            <input id="ov-expected" type="datetime-local" className={inputClass} value={expected} onChange={(e) => setExpected(e.target.value)} />
            <p className="mt-1 text-xs text-ink-500">เวลากรุงเทพฯ บอกให้ลูกค้าทราบ ไม่ได้ทำให้คำสั่งหมดอายุ</p>
          </div>
        </div>
        <div>
          <label htmlFor="ov-expires" className="mb-1 block text-sm font-semibold text-ink-800">
            หมดอายุคำสั่งเมื่อ เวลา Asia/Bangkok (ถ้ามี — ต้องเป็นเวลาในอนาคต)
          </label>
          <input id="ov-expires" type="datetime-local" className={inputClass} value={expires} onChange={(e) => setExpires(e.target.value)} />
          <p className="mt-1 text-xs text-ink-500">เวลากรุงเทพฯ พอถึงเวลาคำสั่งสิ้นผลทันที ร้านกลับไปใช้ตารางประจำสัปดาห์</p>
        </div>
        <div>
          <label htmlFor="ov-reason" className="mb-1 block text-sm font-semibold text-ink-800">
            เหตุผล{mode === "closed" ? " (บังคับเมื่อปิด)" : " (ถ้ามี)"}
          </label>
          <input
            id="ov-reason"
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder={mode === "closed" ? "เช่น ไฟดับชั่วคราว" : "เหตุผลเพิ่มเติม (ถ้ามี)"}
          />
        </div>
        <button type="submit" disabled={busy} aria-busy={busy} className={primaryButtonClass}>
          {busy && <span className="ui-spinner" aria-hidden="true" />}
          {busy ? "กำลังสั่ง…" : mode === "closed" ? "สั่งปิดชั่วคราว" : "สั่งเปิดชั่วคราว"}
        </button>
        {localError && (
          <Alert tone="error" role="alert">
            {localError}
          </Alert>
        )}
      </form>
    </div>
  );
}
