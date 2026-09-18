import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode } from "react";
import type { BookingDay } from "../lib/reservationSlots";
import { Alert, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

type Props = {
  tableName: string;
  capacity: number;
  zoneLabel: string;
  partySize: number;
  partyMin: number;
  onPartyChange: (next: number) => void;
  days: BookingDay[];
  dateKey: string;
  onDateChange: (key: string) => void;
  times: string[];
  time: string;
  onTimeChange: (time: string) => void;
  whenText: string;
  note: string;
  onNoteChange: (note: string) => void;
  /** กำลังตรวจสอบโต๊ะว่างตามจำนวนคน/เวลาใหม่ — ยังกดจองไม่ได้ */
  checking: boolean;
  creating: boolean;
  error: string | null;
  /** เข้าสู่ระบบแล้วและไม่ใช่ผังตัวอย่าง */
  canBook: boolean;
  /** ข้อความแทนปุ่มจองเมื่อจองไม่ได้ (เช่น ให้เข้าสู่ระบบ) */
  blocked?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * ป๊อปอัปหลังแตะโต๊ะ — ให้ลูกค้าตรวจจำนวนคนและวันเวลาอีกครั้ง (แก้ได้ในนี้) ก่อนกดยืนยันจอง
 * Esc / ปุ่มปิด / คลิกนอกกรอบ = ปิดโดยยังเลือกโต๊ะไว้ · คืนโฟกัสให้ปุ่มที่เปิดเมื่อปิด
 */
export function ReservationConfirmDialog(props: Props) {
  const { partySize, partyMin, capacity, onClose } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = props.checking || props.creating;

  // portal ไปที่ body: บรรพบุรุษที่มี transform/perspective/preserve-3d (เช่นเลเยอร์ 3D ของหน้า)
  // ทำให้ position: fixed ยึดกล่องนั้นแทนหน้าจอ — ป๊อปอัปไปโผล่ท้ายหน้ายาว ๆ จนต้องเลื่อนหา
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink-900/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reserve-dialog-title"
        aria-describedby="reserve-dialog-desc"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="reserve-dialog-title"
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-xl font-bold text-ink-900 outline-none"
            >
              ยืนยันการจองโต๊ะ {props.tableName}
            </h2>
            <p id="reserve-dialog-desc" className="mt-0.5 text-sm text-ink-600">
              {props.zoneLabel} · รับได้ {capacity} ที่นั่ง — ตรวจจำนวนคนและเวลาอีกครั้งก่อนจอง
            </p>
          </div>
          <button type="button" className={`${secondaryButtonClass} flex-none px-3`} aria-label="ปิดหน้าต่างยืนยัน" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p id="reserve-dialog-party" className="mb-1.5 text-sm font-semibold text-ink-800">
              จำนวนคนที่จะมา
            </p>
            <div className="flex items-center gap-3" role="group" aria-labelledby="reserve-dialog-party">
              <button
                type="button"
                className={secondaryButtonClass}
                aria-label="ลดจำนวนคนที่จะมา"
                disabled={partySize <= partyMin || props.creating}
                onClick={() => props.onPartyChange(partySize - 1)}
              >
                −
              </button>
              <output className="min-w-[4.5rem] text-center text-2xl font-bold text-ink-900" aria-live="polite">
                {partySize} คน
              </output>
              <button
                type="button"
                className={secondaryButtonClass}
                aria-label="เพิ่มจำนวนคนที่จะมา"
                disabled={partySize >= capacity || props.creating}
                onClick={() => props.onPartyChange(partySize + 1)}
              >
                +
              </button>
            </div>
            {partySize >= capacity ? <p className="mt-1 text-xs text-ink-600">โต๊ะนี้นั่งได้สูงสุด {capacity} คน</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reserve-dialog-date" className="mb-1.5 block text-sm font-semibold text-ink-800">
                วันที่จอง
              </label>
              <select
                id="reserve-dialog-date"
                className={inputClass}
                value={props.dateKey}
                disabled={props.creating}
                onChange={(e) => props.onDateChange(e.target.value)}
              >
                {props.days.map((day) => (
                  <option key={day.key} value={day.key} disabled={day.closed}>
                    {day.label} · {day.closed ? "ปิดรับจองแล้ว" : day.dateLabel}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reserve-dialog-time" className="mb-1.5 block text-sm font-semibold text-ink-800">
                เวลาจอง
              </label>
              <select
                id="reserve-dialog-time"
                className={inputClass}
                value={props.time}
                disabled={props.creating}
                onChange={(e) => props.onTimeChange(e.target.value)}
              >
                {props.times.map((t) => (
                  <option key={t} value={t}>
                    {t} น.
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border-2 border-gold-500 bg-gold-100/60 p-3 text-center" role="status" aria-live="polite">
            <p className="text-xs font-semibold text-ink-600">สรุปการจอง</p>
            <p className="mt-0.5 text-base font-bold text-ink-900">
              {props.partySize} คน · {props.whenText}
            </p>
            <p className="text-xs text-ink-600">{props.checking ? "กำลังตรวจสอบว่าโต๊ะยังว่าง…" : "ร้านถือโต๊ะให้ 2 ชั่วโมงนับจากเวลานัด"}</p>
          </div>

          <div>
            <label htmlFor="res-note" className="mb-1 block text-sm font-semibold text-ink-800">
              หมายเหตุถึงร้าน (ถ้ามี)
            </label>
            <input
              id="res-note"
              className={inputClass}
              value={props.note}
              maxLength={200}
              disabled={props.creating}
              onChange={(e) => props.onNoteChange(e.target.value)}
              placeholder="เช่น มีเด็กเล็ก ขอเก้าอี้เสริม"
            />
          </div>

          {props.error ? (
            <Alert tone="error" role="alert">
              {props.error}
            </Alert>
          ) : null}
          {props.blocked}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={props.creating}>
              กลับไปแก้ไข
            </button>
            {props.canBook ? (
              <button
                type="button"
                className={`${primaryButtonClass} text-base`}
                onClick={props.onConfirm}
                disabled={busy}
                aria-busy={props.creating}
              >
                {props.creating ? "กำลังจอง…" : `ยืนยันจองโต๊ะ ${props.tableName}`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
