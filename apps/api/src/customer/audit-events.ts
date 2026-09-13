import type { AuditInput } from "../store.js";

/**
 * Pure audit-event factories สำหรับ Ticket 03 — Memory และ MySQL ใช้ชุดเดียวกัน
 * action/detail semantics จะได้ไม่ drift ระหว่าง adapter
 * กฎ: ไม่ใส่ passwordHash/token/secret/เบอร์ดิบเกินจำเป็นลง detail โดยเด็ดขาด
 */

export interface CustomerActor {
  actorId?: string | null;
  actorUsername?: string | null;
  ip?: string | null;
}

function base(actor: CustomerActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    ip: actor.ip ?? null,
    success: true,
  };
}

function failed(actor: CustomerActor): Pick<AuditInput, "actorId" | "actorUsername" | "ip" | "success"> {
  return { ...base(actor), success: false };
}

export function customerRegisteredEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_registered",
    targetId: customerId,
    detail: "สมัครบัญชีลูกค้าใหม่",
  };
}

export function customerLoginSuccessEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_login_success",
    targetId: customerId,
  };
}

export function customerLoginFailedEvent(
  detail: string,
  actor: CustomerActor & { targetId?: string | null },
): AuditInput {
  return {
    ...failed(actor),
    action: "customer_login_failed",
    targetId: actor.targetId ?? null,
    detail,
  };
}

export function customerLogoutEvent(customerId: string, actor: CustomerActor): AuditInput {
  return { ...base(actor), action: "customer_logout", targetId: customerId };
}

export function customerProfileUpdatedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_profile_updated",
    targetId: customerId,
    detail: "แก้ไขชื่อ/อีเมล",
  };
}

export function customerPasswordChangedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_password_changed",
    targetId: customerId,
    detail: "เปลี่ยนรหัสผ่าน (ยกเลิกเซสชันเดิมทั้งหมด)",
  };
}

export function customerDeletedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_deleted",
    targetId: customerId,
    detail: "ลบบัญชี: ทำ PII เป็นนิรนาม ถอนการเชื่อม LINE และยกเลิกเซสชันทั้งหมด",
  };
}

export function customerLineLinkStartedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_line_link_started",
    targetId: customerId,
    detail: "เริ่มขั้นตอนเชื่อม LINE (สร้าง state/nonce/PKCE)",
  };
}

export function customerLineLinkedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_line_linked",
    targetId: customerId,
    detail: "เชื่อม LINE สำเร็จ (ยืนยันตัวตนผ่านผู้ให้บริการแล้ว)",
  };
}

export function customerLineLinkFailedEvent(customerId: string | null, detail: string, actor: CustomerActor): AuditInput {
  return {
    ...failed(actor),
    action: "customer_line_link_failed",
    targetId: customerId,
    detail,
  };
}

export function customerLineUnlinkedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_line_unlinked",
    targetId: customerId,
    detail: "ยกเลิกการเชื่อม LINE (ลบความสัมพันธ์ภายใน + แจ้งผู้ให้บริการ)",
  };
}

export function customerDeactivatedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_deactivated",
    targetId: customerId,
    detail: "ปิดบัญชีลูกค้า (ยกเลิกเซสชันทั้งหมด)",
  };
}

export function customerActivatedEvent(customerId: string, actor: CustomerActor): AuditInput {
  return {
    ...base(actor),
    action: "customer_activated",
    targetId: customerId,
    detail: "เปิดบัญชีลูกค้าอีกครั้ง",
  };
}
