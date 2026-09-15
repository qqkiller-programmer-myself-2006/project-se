/**
 * Ticket 12: LINE Messaging provider seam (ส่ง push เท่านั้น — แยกจาก LINE Login ของ Ticket 03)
 * - production ต่อ LINE Messaging API ผ่าน adapter จริง (งานภายหลัง — ตอนนี้ contract-only)
 * - tests ฉีด Fake ผ่าน deps เท่านั้น ห้ามเรียกเครือข่ายจริงในเทสต์
 * - ยังไม่ตั้งค่า → Disabled โยน LineMessagingNotConfiguredError (route ตอบ 503)
 *
 * กฎเหล็ก: ห้าม log/เก็บ token, secret, authorization code หรือ LINE user ID เกินจำเป็น
 * (เก็บเฉพาะ subject ปลายทางใน outbox เพื่อส่งซ้ำ — ไม่เปิดผ่าน API สาธารณะ)
 */

export class LineMessagingNotConfiguredError extends Error {
  code = "LINE_MESSAGING_NOT_CONFIGURED";
  constructor(message = "ยังไม่เปิดใช้งานการส่ง LINE (ผู้ดูแลระบบยังไม่ตั้งค่าผู้ให้บริการ)") {
    super(message);
  }
}

export class LineMessagingTimeoutError extends Error {
  code = "LINE_MESSAGING_TIMEOUT";
  constructor(message = "ส่งข้อความหมดเวลา กรุณาลองใหม่") {
    super(message);
  }
}

export class LineMessagingSendError extends Error {
  code = "LINE_MESSAGING_SEND_FAILED";
}

export interface LinePushInput {
  /** LINE user ID ปลายทาง (จาก link ที่ยืนยันแล้วเท่านั้น — ห้ามรับจาก request body) */
  to: string;
  /** ข้อความภาษาไทย (≤2000 อักษร — route ตรวจก่อนส่ง) */
  message: string;
}

export interface LineMessagingProvider {
  readonly name: string;
  sendPush(input: LinePushInput): Promise<void>;
}

/** กรณี production ยังไม่ตั้งค่า — ทุกครั้ง fail-fast ทันที (ห้ามเงียบ) */
export class DisabledLineMessagingProvider implements LineMessagingProvider {
  readonly name = "disabled";
  sendPush(_input: LinePushInput): Promise<void> {
    throw new LineMessagingNotConfiguredError();
  }
}

export interface FakeLineMessagingBehavior {
  /** จำลองส่งล้มเหลวทั่วไป */
  failSend?: boolean;
  /** จำลอง timeout (retryable) */
  timeout?: boolean;
  /** ข้อความ error ที่กำหนดเอง (ต้องไม่มี secret — เทสต์เท่านั้น) */
  errorMessage?: string;
}

export interface FakePushCall {
  to: string;
  message: string;
}

/**
 * Fake สำหรับ tests: บันทึกทุก call ให้ contract tests ตรวจได้
 * ไม่แตะเครือข่ายจริง ไม่เก็บ token ใด ๆ
 */
export class FakeLineMessagingProvider implements LineMessagingProvider {
  readonly name = "fake";
  behavior: FakeLineMessagingBehavior;
  calls: FakePushCall[] = [];

  constructor(behavior: FakeLineMessagingBehavior = {}) {
    this.behavior = behavior;
  }

  async sendPush(input: LinePushInput): Promise<void> {
    this.calls.push({ to: input.to, message: input.message });
    if (this.behavior.timeout) {
      throw new LineMessagingTimeoutError();
    }
    if (this.behavior.failSend) {
      throw new LineMessagingSendError(this.behavior.errorMessage ?? "ส่งข้อความไม่สำเร็จ (fake)");
    }
  }
}
