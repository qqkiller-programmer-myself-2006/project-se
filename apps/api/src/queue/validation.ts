import {
  QUEUE_REASON_MAX,
  QUEUE_SLOT_MINUTES,
  QUEUE_STANDARD_PREP_MINUTES,
  QUEUE_STATUSES,
  ConflictError,
  type MenuKind,
  type OrderServiceType,
  type QueueJob,
  type QueueStation,
  type QueueStatus,
} from "../types.js";

/**
 * Ticket 09: กฎ validation งานคิวครัว/เครื่องดื่ม (pure — ใช้ร่วมกันทั้ง memory/MySQL
 * ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store; ห้าม duplicate semantics ที่ router)
 * - station: food → kitchen, drink → drink (ตัดสินจาก menu kind ตาม Ticket 04 contract)
 * - readyAt: งานทั่วไป = เวลาชำระ/ยืนยัน; งานล่วงหน้า = เวลานัด − เวลาทำประมาณการ
 * - lifecycle: queued → claimed → preparing → ready → delivered (+ cancelled ก่อนเริ่มทำ)
 * - partial: readyQty/deliveredQty ทยอยได้ ไม่เกินยอดงาน (ส่งมอบไม่เกินทำเสร็จ)
 * - FIFO ต่อฝ่ายตาม readyAt (preorder บล็อกจนถึง readyAt; priority/remake แทรกได้)
 */

/** แยกฝ่ายจาก menu kind (Ticket 04 contract: kind food|drink เท่านั้น) */
export function classifyStation(kind: MenuKind): QueueStation {
  if (kind === "drink") return "drink";
  if (kind === "food") return "kitchen";
  throw new Error("ประเภทเมนูไม่ถูกต้อง (ต้องเป็นอาหารหรือเครื่องดื่ม)");
}

/** เวลาทำประมาณการของฝ่าย (นาที) — preorder ใช้ลบจากเวลานัด */
export function standardPrepMinutes(station: QueueStation): number {
  return QUEUE_STANDARD_PREP_MINUTES[station];
}

/**
 * คำนวณเวลาพร้อมทำ (readyAt):
 * - preorder: เวลานัด − เวลาทำประมาณการของฝ่าย (บล็อกจนถึงเวลานี้)
 * - อื่น ๆ: เวลาชำระ/ยืนยัน (พร้อมทำทันที)
 */
export function computeReadyAt(input: {
  serviceType: OrderServiceType;
  scheduledAt: string | null;
  paidAt: Date;
  station: QueueStation;
}): string {
  if (input.serviceType === "preorder" && input.scheduledAt) {
    const scheduled = new Date(input.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) throw new Error("เวลานัดรับไม่ถูกต้อง");
    const ready = new Date(scheduled.getTime() - standardPrepMinutes(input.station) * 60 * 1000);
    return ready.toISOString();
  }
  return input.paidAt.toISOString();
}

/** จุดเริ่มสล็อต 15 นาทีที่เวลาตกอยู่ (UTC — ใช้จัดกำลังผลิต/slot) */
export function slotStartOf(at: Date): Date {
  const ms = QUEUE_SLOT_MINUTES * 60 * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/** คีย์สล็อต `station@slotStartISO` สำหรับนับกำลังผลิต */
export function slotKeyOf(station: QueueStation, at: Date): string {
  return `${station}@${slotStartOf(at).toISOString()}`;
}

export function normalizeStation(value: unknown): QueueStation {
  if (value !== "kitchen" && value !== "drink") {
    throw new Error("ฝ่ายงานคิวไม่ถูกต้อง (ต้องเป็นครัวหรือเครื่องดื่ม)");
  }
  return value;
}

export function normalizeQueueStatus(value: unknown): QueueStatus {
  if (typeof value !== "string" || !(QUEUE_STATUSES as string[]).includes(value)) {
    throw new Error("สถานะงานคิวไม่ถูกต้อง");
  }
  return value as QueueStatus;
}

/** เหตุผลสำหรับ priority/remake/cancel (1–500 ตัวอักษร บังคับมี) */
export function normalizeQueueReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("กรุณาระบุเหตุผล");
  const v = value.trim();
  if (!v) throw new Error("กรุณาระบุเหตุผล");
  if (v.length > QUEUE_REASON_MAX) throw new Error(`เหตุผลต้องไม่เกิน ${QUEUE_REASON_MAX} ตัวอักษร`);
  return v;
}

/** จำนวนทยอยทำ/ส่งมอบ: จำนวนเต็มบวก */
export function normalizeQueueQty(value: unknown): number {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) throw new Error("จำนวนต้องเป็นจำนวนเต็ม");
  if (n <= 0) throw new Error("จำนวนต้องมากกว่าศูนย์");
  return n;
}

/** กำลังผลิตต่อสล็อต: จำนวนเต็ม 1–1000 */
export function normalizeCapacityPerSlot(value: unknown): number {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) throw new Error("กำลังผลิตต้องเป็นจำนวนเต็ม");
  if (n < 1) throw new Error("กำลังผลิตต้องมากกว่าศูนย์");
  if (n > 1000) throw new Error("กำลังผลิตต้องไม่เกิน 1000 ต่องช่วง 15 นาที");
  return n;
}

/**
 * ตรวจ transition ของงานคิว (ขัดกัน → ConflictError = 409):
 * - queued → claimed / cancelled
 * - claimed → preparing / cancelled
 * - preparing → ready (ทำเสร็จครบ) / cancelled ไม่ได้ (เริ่มทำแล้ว)
 * - ready → delivered (ทยอยได้; ครบทุกรายการ = delivered)
 * - delivered/cancelled ปิดงานแล้วห้ามเปลี่ยนต่อ
 * หมายเหตุ: partial quantities ไม่เปลี่ยน status จนกว่ายอดจะครบ (store เป็นผู้ตัดสิน)
 */
export function assertQueueTransition(from: QueueStatus, to: QueueStatus): void {
  if (from === "queued" && (to === "claimed" || to === "cancelled")) return;
  if (from === "claimed" && (to === "preparing" || to === "cancelled")) return;
  if (from === "preparing" && to === "ready") return;
  if (from === "ready" && to === "delivered") return;
  if (from === "delivered" || from === "cancelled") {
    throw new ConflictError("งานคิวนี้ปิดงานแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก");
  }
  throw new ConflictError(`เปลี่ยนสถานะงานคิวจาก ${from} เป็น ${to} ไม่ได้`);
}

/** งานพร้อมทำหรือยัง (readyAt ถึงแล้ว + ยังไม่ปิดงาน) */
export function isJobBlocked(job: Pick<QueueJob, "readyAt" | "status">, now: Date): boolean {
  if (job.status === "cancelled" || job.status === "delivered") return false;
  return new Date(job.readyAt).getTime() > now.getTime();
}

/**
 * ตัวเทียบ FIFO ต่อฝ่าย (ใช้เรียงรายการคิว):
 * 1. งานที่พร้อมทำ (readyAt ถึงแล้ว) ขึ้นก่อนงานที่ยังถูกบล็อก
 * 2. งานเร่งด่วน (priority) ก่อนงานทั่วไป
 * 3. readyAt ก่อนขึ้นก่อน
 * 4. สร้างก่อนขึ้นก่อน (กันเสมอ)
 */
export function compareQueueJobs(
  a: Pick<QueueJob, "readyAt" | "isPriority" | "createdAt">,
  b: Pick<QueueJob, "readyAt" | "isPriority" | "createdAt">,
  now: Date,
): number {
  const aBlocked = new Date(a.readyAt).getTime() > now.getTime() ? 1 : 0;
  const bBlocked = new Date(b.readyAt).getTime() > now.getTime() ? 1 : 0;
  if (aBlocked !== bBlocked) return aBlocked - bBlocked;
  if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
  const t = new Date(a.readyAt).getTime() - new Date(b.readyAt).getTime();
  if (t !== 0) return t;
  return a.createdAt.localeCompare(b.createdAt);
}

/** เวลารอโดยประมาณ (นาที) จากเวลามาตรฐานของฝ่าย — ใช้จนกว่า Ticket 13 จะมีโมเดล */
export function estimateWaitMinutes(station: QueueStation, positionAhead: number): number {
  const per = standardPrepMinutes(station);
  return per + Math.max(0, positionAhead) * per;
}
