import type { NotificationKind } from "../types.js";
import {
  loyaltyEarnedMessage,
  loyaltyRedeemedMessage,
  orderDeliveredMessage,
  orderReadyMessage,
  paymentManualReviewMessage,
  paymentPaidMessage,
  reservationCancelledMessage,
  reservationCreatedMessage,
  reservationReminderMessage,
} from "./templates.js";

/**
 * Ticket 12: mapping business event → notification input (pure — ไม่มี I/O)
 * eventKey แบบ `kind:refId` ทำให้ producer เรียกซ้ำได้โดย outbox dedupe ให้เอง
 */

export interface NotificationEventInput {
  eventKey: string;
  kind: NotificationKind;
  customerId: string | null;
  orderId: string | null;
  reservationId: string | null;
  paymentId: string | null;
  message: string;
}

export function reservationCreatedEvent(input: {
  reservationId: string;
  code: string;
  customerId: string;
  tableName: string;
  partySize: number;
  reservedAtBangkok: string;
}): NotificationEventInput {
  return {
    eventKey: `reservation_created:${input.reservationId}`,
    kind: "reservation_created",
    customerId: input.customerId,
    orderId: null,
    reservationId: input.reservationId,
    paymentId: null,
    message: reservationCreatedMessage(input),
  };
}

export function reservationCancelledEvent(input: {
  reservationId: string;
  code: string;
  customerId: string;
}): NotificationEventInput {
  return {
    eventKey: `reservation_cancelled:${input.reservationId}`,
    kind: "reservation_cancelled",
    customerId: input.customerId,
    orderId: null,
    reservationId: input.reservationId,
    paymentId: null,
    message: reservationCancelledMessage(input),
  };
}

export function reservationReminderEvent(input: {
  reservationId: string;
  code: string;
  customerId: string;
  tableName: string;
  partySize: number;
  reservedAtBangkok: string;
  checkinCode: string;
}): NotificationEventInput {
  return {
    eventKey: `reservation_reminder:${input.reservationId}`,
    kind: "reservation_reminder",
    customerId: input.customerId,
    orderId: null,
    reservationId: input.reservationId,
    paymentId: null,
    message: reservationReminderMessage(input),
  };
}

export function paymentPaidEvent(input: {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  receiptNumber: string | null;
  customerId: string | null;
}): NotificationEventInput {
  return {
    eventKey: `payment_paid:${input.paymentId}`,
    kind: "payment_paid",
    customerId: input.customerId,
    orderId: input.orderId,
    reservationId: null,
    paymentId: input.paymentId,
    message: paymentPaidMessage(input),
  };
}

export function paymentManualReviewEvent(input: {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
}): NotificationEventInput {
  return {
    eventKey: `payment_manual_review:${input.paymentId}`,
    kind: "payment_manual_review",
    customerId: input.customerId,
    orderId: input.orderId,
    reservationId: null,
    paymentId: input.paymentId,
    message: paymentManualReviewMessage(input),
  };
}

/** รวมพร้อมรับครบทุก job เป็นเหตุการณ์เดียวต่อคำสั่งซื้อ (ลดซ้ำตาม D08) */
export function orderReadyEvent(input: {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  tableName?: string | null;
}): NotificationEventInput {
  return {
    eventKey: `order_ready:${input.orderId}`,
    kind: "order_ready",
    customerId: input.customerId,
    orderId: input.orderId,
    reservationId: null,
    paymentId: null,
    message: orderReadyMessage(input),
  };
}

/** ส่งมอบครบแล้ว — เหตุการณ์เดียวต่อคำสั่งซื้อ */
export function orderDeliveredEvent(input: {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
}): NotificationEventInput {
  return {
    eventKey: `order_delivered:${input.orderId}`,
    kind: "order_delivered",
    customerId: input.customerId,
    orderId: input.orderId,
    reservationId: null,
    paymentId: null,
    message: orderDeliveredMessage(input),
  };
}

export function loyaltyEarnedEvent(input: {
  /** อ้างอิงกันซ้ำ (orderId สำหรับคะแนนจากคำสั่งซื้อ, รหัส QR/claim สำหรับช่องทางอื่น) */
  refId: string;
  orderId?: string | null;
  customerId: string;
  points: number;
  balance: number;
}): NotificationEventInput {
  return {
    eventKey: `loyalty_earned:${input.refId}:${input.customerId}`,
    kind: "loyalty_earned",
    customerId: input.customerId,
    orderId: input.orderId ?? null,
    reservationId: null,
    paymentId: null,
    message: loyaltyEarnedMessage(input),
  };
}

export function loyaltyRedeemedEvent(input: {
  redemptionId: string;
  customerId: string;
  points: number;
  balance: number;
  rewardName?: string | null;
}): NotificationEventInput {
  return {
    eventKey: `loyalty_redeemed:${input.redemptionId}`,
    kind: "loyalty_redeemed",
    customerId: input.customerId,
    orderId: null,
    reservationId: null,
    paymentId: null,
    message: loyaltyRedeemedMessage(input),
  };
}
