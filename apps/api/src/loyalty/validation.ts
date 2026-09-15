import { randomUUID } from "node:crypto";
import {
  LOYALTY_REASON_MAX,
  REWARD_IMAGE_URL_MAX,
  REWARD_NAME_MAX,
  REWARD_POINTS_MAX,
  REWARD_POINTS_MIN,
  REWARD_QUOTA_MAX,
  ConflictError,
  type RedemptionStatus,
  type Reward,
} from "../types.js";

/**
 * Ticket 10: กฎ validation คะแนน/รางวัล (pure — ใช้ร่วมกันทั้ง memory/MySQL
 * ผ่าน store และ router เรียก normalize ก่อนส่งเข้า store; ห้าม duplicate semantics ที่ router)
 * - earn: เครื่องดื่มที่ร่วมรายการ 1 หน่วย = 1 คะแนน เฉพาะ paid + delivered/completed;
 *   รางวัลราคา 0 ไม่ได้คะแนน
 * - redeem: reserve (กันคะแนน+quota, idempotency key) → consume (หักถาวร + สร้าง
 *   งานคิวเครื่องดื่มราคา 0 ครั้งเดียว) / release (คืนคะแนน+quota)
 * - QR Walk-in: ครั้งเดียว อายุ 10 นาที; Guest ผูกภายใน 24 ชม. เบอร์เดียวกัน
 */

function fail(message: string): never {
  throw new Error(message);
}

export function normalizeRewardName(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุชื่อรางวัล");
  const v = value.trim();
  if (!v) fail("กรุณาระบุชื่อรางวัล");
  if (v.length > REWARD_NAME_MAX) fail(`ชื่อรางวัลต้องไม่เกิน ${REWARD_NAME_MAX} ตัวอักษร`);
  return v;
}

export function normalizeRewardImageUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") fail("ลิงก์รูปภาพต้องเป็นข้อความ");
  const v = value.trim();
  if (!v) return null;
  if (v.length > REWARD_IMAGE_URL_MAX) fail("ลิงก์รูปภาพยาวเกินไป");
  if (!/^https?:\/\/.+/i.test(v)) fail("ลิงก์รูปภาพต้องขึ้นต้นด้วย http:// หรือ https://");
  return v;
}

export function normalizeRewardPointsCost(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("คะแนนที่ใช้แลกต้องเป็นจำนวนเต็ม");
  if (n < REWARD_POINTS_MIN) fail(`คะแนนที่ใช้แลกต้องไม่น้อยกว่า ${REWARD_POINTS_MIN} คะแนน`);
  if (n > REWARD_POINTS_MAX) fail(`คะแนนที่ใช้แลกต้องไม่เกิน ${REWARD_POINTS_MAX} คะแนน`);
  return n;
}

/** จำนวนสิทธิ์ทั้งหมด (null/ว่าง = ไม่จำกัด; 0 = หยุดรับ) */
export function normalizeRewardQuotaTotal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" && (value as string).trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("จำนวนสิทธิ์ต้องเป็นจำนวนเต็ม");
  if (n < 0) fail("จำนวนสิทธิ์ต้องไม่ติดลบ");
  if (n > REWARD_QUOTA_MAX) fail(`จำนวนสิทธิ์ต้องไม่เกิน ${REWARD_QUOTA_MAX}`);
  return n;
}

export function normalizeLoyaltyReason(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุเหตุผล");
  const v = value.trim();
  if (!v) fail("กรุณาระบุเหตุผล");
  if (v.length > LOYALTY_REASON_MAX) fail(`เหตุผลต้องไม่เกิน ${LOYALTY_REASON_MAX} ตัวอักษร`);
  return v;
}

export function normalizeLoyaltyIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("คำขอขาดรหัสป้องกันการส่งซ้ำ กรุณาลองใหม่อีกครั้ง");
  }
  const v = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) {
    fail("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  return v;
}

/** สร้าง idempotency key ใหม่ (ฝั่ง web ใช้ตอนกดแลกคะแนน) */
export function generateLoyaltyIdempotencyKey(): string {
  return randomUUID();
}

/** รหัส QR Walk-in ที่ลูกค้ากรอก/สแกน (`WALKIN-<token>`) */
export function normalizeWalkinCode(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุรหัส QR");
  const v = value.trim().toUpperCase();
  if (!/^WALKIN-[A-Z0-9]{4,32}$/.test(v)) fail("รหัส QR ไม่ถูกต้อง");
  return v;
}

/** สร้าง payload QR Walk-in แบบ deterministic (`WALKIN-<token>`) */
export function buildWalkinCode(token: string): string {
  return `WALKIN-${token.toUpperCase()}`;
}

/** สร้าง token สุ่มสำหรับ QR Walk-in (6 ตัวอักษร A–Z0–9 กันชนที่ store) */
export function generateWalkinToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** สร้างรหัสอ้างอิงการแลก (RDM-XXXXXX) */
export function generateRedemptionCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 6; i += 1) {
    rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RDM-${rand}`;
}

/**
 * ตรวจว่ารางวัลพร้อมแลกหรือไม่ (สถานะ + ช่วงเวลา + quota):
 * คืน null เมื่อพร้อม; คืนข้อความเหตุผล (ไทย) เมื่อหยุดรับ
 */
export function rewardBlockReason(reward: Reward, now: Date): string | null {
  if (!reward.isActive) return "รางวัลนี้ปิดรับแลกชั่วคราว";
  if (reward.startsAt && new Date(reward.startsAt).getTime() > now.getTime()) {
    return "รางวัลนี้ยังไม่ถึงช่วงเวลาแลก";
  }
  if (reward.endsAt && new Date(reward.endsAt).getTime() < now.getTime()) {
    return "รางวัลนี้หมดช่วงเวลาแลกแล้ว";
  }
  if (reward.quotaTotal !== null && reward.quotaUsed >= reward.quotaTotal) {
    return "สิทธิ์แลกของรางวัลนี้หมดแล้ว";
  }
  return null;
}

/**
 * ตรวจ transition ของ redemption (ขัดกัน → ConflictError = 409):
 * - reserved → consumed (ร้านรับ) / released (ปฏิเสธ/ยกเลิก)
 * - consumed/released ปิดงานแล้วห้ามเปลี่ยนต่อ
 */
export function assertRedemptionTransition(from: RedemptionStatus, to: RedemptionStatus): void {
  if (from === "reserved" && (to === "consumed" || to === "released")) return;
  if (from === "consumed" || from === "released") {
    throw new ConflictError("รายการแลกนี้ปิดงานแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก");
  }
  throw new ConflictError(`เปลี่ยนสถานะการแลกจาก ${from} เป็น ${to} ไม่ได้`);
}

/**
 * hash ของข้อมูล reserve สำหรับตรวจ idempotency:
 * key เดิม + payload เดิม = ส่งซ้ำ → คืนรายการเดิม
 * key เดิม + payload ต่างกัน = ขัดแย้ง → 409
 */
export function redemptionPayloadHash(payload: { customerId: string; rewardId: string }): string {
  return `${payload.customerId}|${payload.rewardId}`;
}
