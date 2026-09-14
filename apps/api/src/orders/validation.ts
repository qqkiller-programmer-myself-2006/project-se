import { createHash, randomUUID } from "node:crypto";
import {
  ORDER_GUEST_NAME_MAX,
  ORDER_MAX_LINES,
  ORDER_NOTE_MAX,
  ORDER_QTY_MAX,
  ORDER_QTY_MIN,
  ORDER_REASON_MAX,
  ConflictError,
  type OrderServiceType,
  type OrderStatus,
} from "../types.js";

/**
 * Ticket 05: กฎ validation คำสั่งซื้อ (pure — ใช้ร่วมกันทั้ง memory/MySQL ผ่าน store
 * และ router เรียก normalize ก่อนส่งเข้า store; ห้าม duplicate semantics ที่ router)
 * - serviceType: dine_in | takeaway | preorder (preorder ต้องมีเวลานัด)
 * - quantity: จำนวนเต็ม 1–20 ต่อรายการ; 1 คำสั่งซื้อมี 1–20 รายการ
 * - note: optional (null/"" → null) ยาวไม่เกิน 200
 * - guest: ชื่อ 1–120 (trim); เบอร์ normalize ด้วย normalizeThaiPhone ของ Ticket 03
 *   (router เป็นผู้เรียก — ไฟล์นี้รับค่าที่ normalize แล้วมาตรวจรูปทรงซ้ำแบบกันพลาด)
 * - scheduledAt: เฉพาะ preorder — ต้องเป็นเวลาอนาคต (อย่างน้อย 30 นาทีข้างหน้า)
 *   และไม่เกิน 7 วัน; dine_in/takeaway ห้ามระบุ
 * - idempotencyKey: UUID ที่ client สร้างต่อการกดยืนยันหนึ่งครั้ง
 * - status: pending_payment (เริ่มต้น) | completed | cancelled;
 *   เปลี่ยนได้เฉพาะ pending_payment → completed/cancelled โดย Owner/Admin
 */

export interface NormalizedOrderLine {
  menuId: string;
  quantity: number;
  note: string | null;
  /** รหัสตัวเลือกที่เลือกในรายการนี้ (ตรวจว่าเป็นของเมนูนี้และเปิดขายที่ store) */
  optionIds: string[];
  /** ความต้องการเฉพาะ — ข้อความล้วน ไม่เปลี่ยนราคา */
  specialRequest: string | null;
}

export function normalizeServiceType(value: unknown): OrderServiceType {
  if (value !== "dine_in" && value !== "takeaway" && value !== "preorder") {
    throw new Error("กรุณาเลือกวิธีรับบริการ (รับประทานที่ร้าน กลับบ้าน หรือล่วงหน้า)");
  }
  return value;
}

export function normalizeMenuId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("รายการในตะกร้าไม่ถูกต้อง (ไม่พบเมนู)");
  }
  return value.trim();
}

export function normalizeQuantity(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) throw new Error("จำนวนต้องเป็นจำนวนเต็ม");
  if (n < ORDER_QTY_MIN) throw new Error("จำนวนต้องมากกว่าศูนย์");
  if (n > ORDER_QTY_MAX) throw new Error(`จำนวนต่อรายการต้องไม่เกิน ${ORDER_QTY_MAX}`);
  return n;
}

export function normalizeOrderNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("หมายเหตุต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > ORDER_NOTE_MAX) throw new Error(`หมายเหตุต้องไม่เกิน ${ORDER_NOTE_MAX} ตัวอักษร`);
  return v;
}

export function normalizeGuestName(value: unknown): string {
  if (typeof value !== "string") throw new Error("กรุณาระบุชื่อผู้สั่ง");
  const v = value.trim();
  if (!v) throw new Error("กรุณาระบุชื่อผู้สั่ง");
  if (v.length > ORDER_GUEST_NAME_MAX) throw new Error(`ชื่อผู้สั่งต้องไม่เกิน ${ORDER_GUEST_NAME_MAX} ตัวอักษร`);
  return v;
}

/** กัน store รับเบอร์ดิบโดยตรง: ต้องเป็น 0 + ตัวเลข 10 หลัก (router normalize ด้วย normalizeThaiPhone ก่อน) */
export function assertNormalizedPhone(value: unknown): string {
  if (typeof value !== "string" || !/^0[0-9]{9}$/.test(value)) {
    throw new Error("เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0 (เช่น 0812345678)");
  }
  return value;
}

export const PREORDER_MIN_LEAD_MINUTES = 30;
export const PREORDER_MAX_ADVANCE_DAYS = 7;

export function normalizeScheduledAt(
  serviceType: OrderServiceType,
  value: unknown,
  now: Date,
): string | null {
  if (serviceType !== "preorder") {
    if (value === undefined || value === null || value === "") return null;
    throw new Error("วิธีรับบริการนี้ไม่ต้องระบุเวลานัด");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("กรุณาระบุเวลานัดรับสำหรับคำสั่งซื้อล่วงหน้า");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("รูปแบบเวลานัดไม่ถูกต้อง");
  const min = now.getTime() + PREORDER_MIN_LEAD_MINUTES * 60 * 1000;
  if (d.getTime() < min) {
    throw new Error(`เวลานัดต้องล่วงหน้าอย่างน้อย ${PREORDER_MIN_LEAD_MINUTES} นาที`);
  }
  const max = now.getTime() + PREORDER_MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
  if (d.getTime() > max) {
    throw new Error(`เวลานัดต้องไม่เกิน ${PREORDER_MAX_ADVANCE_DAYS} วันล่วงหน้า`);
  }
  return d.toISOString();
}

export function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("คำขอขาดรหัสป้องกันการส่งซ้ำ กรุณาลองใหม่อีกครั้ง");
  }
  const v = value.trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    throw new Error("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  return v.toLowerCase();
}

/** สร้าง idempotency key ใหม่ (ฝั่ง web ใช้ตอนกดยืนยันตะกร้า) */
export function generateIdempotencyKey(): string {
  return randomUUID();
}

export function normalizeOrderLines(value: unknown): NormalizedOrderLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("กรุณาเลือกเมนูอย่างน้อย 1 รายการ");
  }
  if (value.length > ORDER_MAX_LINES) {
    throw new Error(`คำสั่งซื้อหนึ่งครั้งมีได้ไม่เกิน ${ORDER_MAX_LINES} รายการ`);
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = raw as { menuId?: unknown; quantity?: unknown; note?: unknown; options?: unknown; optionIds?: unknown; specialRequest?: unknown };
    const menuId = normalizeMenuId(row?.menuId);
    const quantity = normalizeQuantity(row?.quantity);
    const note = normalizeOrderNote(row?.note ?? null);
    // Ticket 07: ตัวเลือก (รับได้ทั้งคีย์ `options` และ `optionIds`) + ความต้องการเฉพาะ
    const optionIds = normalizeLineOptionIds(row?.options ?? row?.optionIds ?? []);
    const specialRequest = normalizeLineSpecialRequest(row?.specialRequest ?? null);
    // เมนูเดียวกันสั่งแยกหลายบรรทัดได้เมื่อตัวเลือก/หมายเหตุ/ความต้องการเฉพาะต่างกัน
    // (บรรทัดที่เหมือนกันทุกอย่างยังต้องรวมเป็นรายการเดียว)
    const key = `${menuId}|${[...optionIds].sort().join(",")}|${note ?? ""}|${specialRequest ?? ""}`;
    if (seen.has(key)) throw new Error("มีเมนูซ้ำกันในตะกร้า กรุณารวมเป็นรายการเดียว");
    seen.add(key);
    return { menuId, quantity, note, optionIds, specialRequest };
  });
}

/** normalize รหัสตัวเลือกแบบกันพลาด (ตรวจว่าเป็นของเมนูนี้/เปิดขายที่ store) */
function normalizeLineOptionIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("ตัวเลือกเมนูไม่ถูกต้อง");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || raw.trim().length === 0) throw new Error("ตัวเลือกเมนูไม่ถูกต้อง");
    const id = raw.trim();
    if (seen.has(id)) throw new Error("มีตัวเลือกซ้ำกันในรายการ กรุณาเลือกอย่างละครั้งเดียว");
    seen.add(id);
    out.push(id);
  }
  if (out.length > 20) throw new Error("ตัวเลือกในหนึ่งรายการมีได้ไม่เกิน 20 ตัวเลือก");
  return out;
}

/** normalize ความต้องการเฉพาะแบบกันพลาด (ข้อความล้วน ไม่เปลี่ยนราคา) */
function normalizeLineSpecialRequest(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("ความต้องการเฉพาะต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > ORDER_NOTE_MAX) throw new Error(`ความต้องการเฉพาะต้องไม่เกิน ${ORDER_NOTE_MAX} ตัวอักษร`);
  return v;
}

export function normalizeOrderStatus(value: unknown): OrderStatus {
  if (value !== "pending_payment" && value !== "completed" && value !== "cancelled") {
    throw new Error("สถานะคำสั่งซื้อไม่ถูกต้อง");
  }
  return value;
}

/**
 * รุ่นแรกเปลี่ยนสถานะได้ทางเดียวจาก pending_payment เท่านั้น (โดย Owner/Admin):
 * pending_payment → completed (ปิดงาน) หรือ pending_payment → cancelled (ยกเลิก)
 * สถานะปลายทางแล้วห้ามเปลี่ยนต่อ (กันแก้ประวัติย้อนหลัง)
 * โยน ConflictError (409) เมื่อขัดกับสถานะปัจจุบัน — ไม่ใช่ 400 (รูปทรงถูกแล้ว)
 */
export function assertOrderStatusTransition(from: OrderStatus, to: OrderStatus): void {
  if (from !== "pending_payment") {
    throw new ConflictError("คำสั่งซื้อที่ปิดงานแล้วไม่สามารถเปลี่ยนสถานะได้อีก");
  }
  if (to === "pending_payment") throw new ConflictError("สถานะคำสั่งซื้อไม่ถูกต้อง");
}

export function normalizeStatusReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("กรุณาระบุเหตุผลในการเปลี่ยนสถานะ");
  const v = value.trim();
  if (!v) throw new Error("กรุณาระบุเหตุผลในการเปลี่ยนสถานะ");
  if (v.length > ORDER_REASON_MAX) throw new Error(`เหตุผลต้องไม่เกิน ${ORDER_REASON_MAX} ตัวอักษร`);
  return v;
}

/** เลขอ้างอิงอ่านได้: ORD-YYYYMMDD-XXXX (XXXX สุ่ม A–Z0–9 กันชนด้วยการ retry ที่ store) */
export function generateOrderNumber(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i += 1) {
    rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `ORD-${date}-${rand}`;
}

/**
 * hash ของข้อมูลคำสั่งซื้อสำหรับตรวจ idempotency:
 * key เดิม + payload เดิม = ส่งซ้ำ → คืนคำสั่งซื้อเดิม
 * key เดิม + payload ต่างกัน = ขัดแย้ง → 409 (กัน key ชนกันเงียบ ๆ)
 */
export function orderPayloadHash(payload: {
  customerId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  serviceType: OrderServiceType;
  scheduledAt: string | null;
  items: NormalizedOrderLine[];
}): string {
  const canonical = JSON.stringify({
    customerId: payload.customerId,
    guestName: payload.guestName,
    guestPhone: payload.guestPhone,
    serviceType: payload.serviceType,
    scheduledAt: payload.scheduledAt,
    items: [...payload.items]
      .sort((a, b) => a.menuId.localeCompare(b.menuId))
      // Ticket 07: ตัวเลือก (เรียงรหัสก่อน hash — ลำดับที่ส่งมาไม่กระทบการเทียบซ้ำ)
      // และความต้องการเฉพาะเป็นส่วนหนึ่งของ payload กัน key เดิมแต่คนละตัวเลือกชนกันเงียบ ๆ
      .map((i) => ({
        menuId: i.menuId,
        quantity: i.quantity,
        note: i.note,
        options: [...(i.optionIds ?? [])].sort(),
        specialRequest: i.specialRequest ?? null,
      })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** ปัดเศษเงิน 2 ตำแหน่ง (กัน floating point เพี้ยน เช่น 0.1+0.2) */
export function roundBaht(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * hash สคีมาเดิม (ก่อน Ticket 07 — ไม่มีตัวเลือก/ความต้องการเฉพาะ):
 * ใช้เทียบ idempotency key เก่าที่ยืนยันก่อน deploy Ticket 07 เท่านั้น
 * (กัน replay ของ key เก่าเพี้ยนเป็น 409; key ใหม่ใช้ orderPayloadHash เสมอ)
 */
export function orderPayloadHashWithoutOptions(payload: {
  customerId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  serviceType: OrderServiceType;
  scheduledAt: string | null;
  items: NormalizedOrderLine[];
}): string {
  const canonical = JSON.stringify({
    customerId: payload.customerId,
    guestName: payload.guestName,
    guestPhone: payload.guestPhone,
    serviceType: payload.serviceType,
    scheduledAt: payload.scheduledAt,
    items: [...payload.items]
      .sort((a, b) => a.menuId.localeCompare(b.menuId))
      .map((i) => ({ menuId: i.menuId, quantity: i.quantity, note: i.note })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
