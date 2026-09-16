import { createHash, randomUUID } from "node:crypto";
import {
  ConflictError,
  RESERVATION_NOTE_MAX,
  RESERVATION_PARTY_MAX,
  RESERVATION_PARTY_MIN,
  RESERVATION_REASON_MAX,
  type ReservationStatus,
  type ShopTable,
  TABLE_ZONES,
  type TableZone,
} from "../types.js";

/**
 * Ticket 06: กฎ validation การจองและรอบการใช้โต๊ะ (pure — ใช้ร่วมกันทั้ง
 * Memory/MySQL ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store;
 * ห้าม duplicate semantics ที่ router)
 *
 * - จองล่วงหน้าได้ไม่เกิน 3 วัน และต้องก่อนเวลานัดอย่างน้อย 60 นาที
 * - ยกเลิกได้ก่อนเวลานัดอย่างน้อย 60 นาที
 * - หน้าต่างทับซ้อน (overlap window): การจองหนึ่งรายการถือครองโต๊ะเป็นเวลา
 *   `RESERVATION_SLOT_MINUTES` (120 นาที) นับจากเวลานัด — การจองสองรายการ
 *   บนโต๊ะเดียวกันทับซ้อนกันเมื่อ |t1 - t2| < 120 นาที
 * - โต๊ะแนะนำ = โต๊ะพร้อมใช้งานที่เล็กที่สุดซึ่งรองรับจำนวนคนและว่างในช่วงนั้น
 * - เช็กอินตรวจจำนวนคนจริง (1–50) และเปิดรอบการใช้โต๊ะได้เพียงครั้งเดียว
 * - ปิดรอบได้เมื่อไม่มีคำสั่งซื้อรอชำระ (pending_payment) ผูกอยู่
 */

export const RESERVATION_MAX_ADVANCE_DAYS = 3;
export const RESERVATION_MIN_LEAD_MINUTES = 60;
export const RESERVATION_CANCEL_BEFORE_MINUTES = 60;
/**
 * หน้าต่างถือครองโต๊ะต่อการจองหนึ่งรายการ (นาที) — ใช้ตรวจทับซ้อนทั้ง
 * Memory/MySQL ผ่านฟังก์ชัน `isReservationOverlapping` เดียวกัน
 */
export const RESERVATION_SLOT_MINUTES = 120;

export interface NormalizedReservationInput {
  tableId: string;
  partySize: number;
  reservedAt: string;
  note: string | null;
  idempotencyKey: string | null;
}

export function normalizeTableId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("กรุณาเลือกโต๊ะสำหรับการจอง");
  }
  return value.trim();
}

export function normalizePartySize(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) throw new Error("จำนวนผู้ใช้บริการต้องเป็นจำนวนเต็ม");
  if (n < RESERVATION_PARTY_MIN) throw new Error("จำนวนผู้ใช้บริการต้องมากกว่าศูนย์");
  if (n > RESERVATION_PARTY_MAX) throw new Error(`จำนวนผู้ใช้บริการต้องไม่เกิน ${RESERVATION_PARTY_MAX} คน`);
  return n;
}

export function normalizeReservationNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("หมายเหตุการจองต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > RESERVATION_NOTE_MAX) throw new Error(`หมายเหตุการจองต้องไม่เกิน ${RESERVATION_NOTE_MAX} ตัวอักษร`);
  return v;
}

export function normalizeReservationReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("กรุณาระบุเหตุผล");
  const v = value.trim();
  if (!v) throw new Error("กรุณาระบุเหตุผล");
  if (v.length > RESERVATION_REASON_MAX) throw new Error(`เหตุผลต้องไม่เกิน ${RESERVATION_REASON_MAX} ตัวอักษร`);
  return v;
}

/**
 * ตรวจเวลานัด: ต้องอยู่ข้างหน้าอย่างน้อย 60 นาที และไม่เกิน 3 วัน
 * ขอบเขต: เท่ากับ 60 นาทีพอดีผ่าน, เกิน 3 วันพอดีผ่าน (ใช้ ms เปรียบเทียบตรง)
 */
export function normalizeReservedAt(value: unknown, now: Date): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("กรุณาระบุวันเวลานัดหมาย");
  }
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) throw new Error("รูปแบบวันเวลานัดไม่ถูกต้อง");
  const min = now.getTime() + RESERVATION_MIN_LEAD_MINUTES * 60 * 1000;
  if (d.getTime() < min) {
    throw new Error(`จองล่วงหน้าอย่างน้อย ${RESERVATION_MIN_LEAD_MINUTES} นาทีก่อนเวลานัด`);
  }
  const max = now.getTime() + RESERVATION_MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
  if (d.getTime() > max) {
    throw new Error(`จองล่วงหน้าได้ไม่เกิน ${RESERVATION_MAX_ADVANCE_DAYS} วัน`);
  }
  return d.toISOString();
}

/** ยกเลิกได้เมื่อยังเหลือเวลาก่อนนัดอย่างน้อย 60 นาที */
export function assertCancellable(reservedAt: string, now: Date): void {
  const t = new Date(reservedAt).getTime();
  if (Number.isNaN(t)) throw new ConflictError("เวลานัดของการจองไม่ถูกต้อง");
  if (t - now.getTime() < RESERVATION_CANCEL_BEFORE_MINUTES * 60 * 1000) {
    throw new ConflictError(
      `ยกเลิกได้ก่อนเวลานัดอย่างน้อย ${RESERVATION_CANCEL_BEFORE_MINUTES} นาที กรุณาติดต่อร้านโดยตรง`,
    );
  }
}

/** สองเวลานัดทับซ้อนกันเมื่อห่างกันน้อยกว่า 120 นาที (หน้าต่างถือครองโต๊ะ) */
export function isReservationOverlapping(aReservedAt: string, bReservedAt: string): boolean {
  const a = new Date(aReservedAt).getTime();
  const b = new Date(bReservedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < RESERVATION_SLOT_MINUTES * 60 * 1000;
}

export function normalizeReservationIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const v = value.trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    throw new Error("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  return v.toLowerCase();
}

/** hash สำหรับตรวจ idempotency: key เดิม + payload เดิม = ส่งซ้ำ → คืนของเดิม */
export function reservationPayloadHash(payload: {
  customerId: string;
  tableId: string;
  partySize: number;
  reservedAt: string;
  note: string | null;
}): string {
  const canonical = JSON.stringify({
    customerId: payload.customerId,
    tableId: payload.tableId,
    partySize: payload.partySize,
    reservedAt: payload.reservedAt,
    note: payload.note,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** เลขอ้างอิงอ่านได้: RSV-YYYYMMDD-XXXX (กันชนด้วย retry ที่ store) */
export function generateReservationCode(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i += 1) {
    rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RSV-${date}-${rand}`;
}

export function generateReservationIdempotencyKey(): string {
  return randomUUID();
}

/**
 * โต๊ะที่จองได้ต้อง: พร้อมใช้งาน + ความจุพอ + ไม่มีการจอง active ทับซ้อน
 * `blockedTableIds` = โต๊ะที่มีการจอง active ทับซ้อนอยู่ (store คำนวณด้วย
 * isReservationOverlapping เดียวกันทั้ง Memory/MySQL)
 */
export function recommendTable(
  tables: ShopTable[],
  partySize: number,
  blockedTableIds: Set<string>,
): ShopTable | null {
  const candidates = tables
    .filter((t) => t.isEnabled && t.capacity >= partySize && !blockedTableIds.has(t.id))
    .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name, "th"));
  return candidates[0] ?? null;
}

/**
 * สถานะโต๊ะสำหรับผังให้ลูกค้าเลือก ณ เวลานัดหนึ่ง (เฉพาะโต๊ะที่เปิดใช้งาน):
 * - booked: มีการจอง active ทับช่วงเวลา
 * - too_small: ว่างแต่ที่นั่งไม่พอจำนวนคน
 * - available: เลือกจองได้
 * ไม่เปิดเผยข้อมูลการจอง/ลูกค้า — มีแค่ id ชื่อ ความจุ โซน และสถานะ
 */
export type TableAvailabilityStatus = "available" | "booked" | "too_small";

export interface TableAvailability {
  id: string;
  name: string;
  capacity: number;
  zone: TableZone | null;
  status: TableAvailabilityStatus;
}

export function buildTableAvailability(
  tables: ShopTable[],
  partySize: number,
  blockedTableIds: Set<string>,
): { tables: TableAvailability[]; recommendedTableId: string | null } {
  const zoneRank = (zone: TableZone | null): number => (zone ? TABLE_ZONES.indexOf(zone) : TABLE_ZONES.length);
  const list = tables
    .filter((t) => t.isEnabled)
    .sort(
      (a, b) =>
        zoneRank(a.zone) - zoneRank(b.zone) ||
        a.name.localeCompare(b.name, "th", { numeric: true }),
    )
    .map<TableAvailability>((t) => ({
      id: t.id,
      name: t.name,
      capacity: t.capacity,
      zone: t.zone,
      status: blockedTableIds.has(t.id) ? "booked" : t.capacity < partySize ? "too_small" : "available",
    }));
  const recommended = recommendTable(tables, partySize, blockedTableIds);
  return { tables: list, recommendedTableId: recommended?.id ?? null };
}

export type ReservationActorKind = "customer" | "manager";

/**
 * สถานะถัดไปที่เปลี่ยนได้ (โยน ConflictError 409 เมื่อขัดกับสถานะปัจจุบัน):
 * - ลูกค้า: pending/confirmed → cancelled (ต้องผ่าน assertCancellable ก่อน)
 * - หลังร้าน: pending → confirmed/cancelled, confirmed → cancelled/no_show,
 *   seated → completed (ผ่านการปิดรอบเท่านั้น — ห้ามข้าม), ทุก terminal ห้ามเปลี่ยนต่อ
 */
export function assertReservationStatusTransition(
  from: ReservationStatus,
  to: ReservationStatus,
  actor: ReservationActorKind,
): void {
  if (actor === "customer") {
    if (to !== "cancelled") throw new ConflictError("ลูกค้าทำได้เพียงยกเลิกการจองของตนเอง");
    if (from !== "pending" && from !== "confirmed") {
      throw new ConflictError("การจองนี้ยกเลิกไม่ได้แล้ว (เช็กอิน/จบงานไปแล้ว)");
    }
    return;
  }
  const allowed: Record<ReservationStatus, ReservationStatus[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["cancelled", "no_show"],
    // seated → completed เปลี่ยนผ่านการปิดรอบเท่านั้น (closeTableRound) ไม่ใช่ PATCH ตรง
    seated: [],
    completed: [],
    cancelled: [],
    no_show: [],
  };
  if (!allowed[from]!.includes(to)) {
    throw new ConflictError(`เปลี่ยนสถานะการจองจาก ${from} เป็น ${to} ไม่ได้`);
  }
}

export function normalizeReservationStatus(value: unknown): ReservationStatus {
  const all: ReservationStatus[] = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"];
  if (typeof value !== "string" || !all.includes(value as ReservationStatus)) {
    throw new Error("สถานะการจองไม่ถูกต้อง");
  }
  return value as ReservationStatus;
}

/** รหัสจองสำหรับเช็กอิน: RSV-... (trim, ตัวพิมพ์ใหญ่) หรือรหัสที่ store ออกให้ */
export function normalizeReservationCode(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("กรุณาระบุรหัสการจอง");
  }
  return value.trim().toUpperCase();
}
