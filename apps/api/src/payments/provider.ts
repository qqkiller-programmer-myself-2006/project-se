/**
 * Ticket 08: Payment provider adapter contract + fake provider สำหรับ dev/test
 *
 * - `PaymentProvider` คือ contract ที่ production adapter ต้อง implement
 *   (createIntent/verifySlip/parseWebhook) — production adapter ยังเป็น
 *   contract-only (ไม่มี implementation จริงจนกว่าจะเลือกผู้ให้บริการตาม
 *   docs/REQUIREMENTS.md ข้อ 9.4)
 * - `FakePromptPayProvider` ใช้ใน dev/test เท่านั้น (local-first, ไม่มี network):
 *   สร้าง QR payload ปลอม + ตรวจ slip แบบ string-prefix (VALID-/AMBIGUOUS-)
 * - ห้ามอ่าน credentials จริง (SlipOK/PromptPay) ในโค้ด — fake mode ตรวจด้วย
 *   `isFakePaymentMode()` (PAOR_PAYMENT_FAKE=true หรือ NODE_ENV !== "production")
 *   เท่านั้น; production เรียก fake จะได้ 503 contract-only เสมอ
 */

export interface PromptPayIntent {
  /** QR payload ปลอมสำหรับแสดงให้ลูกค้าสแกน (ไม่มีข้อมูลลับ) */
  qrPayload: string;
  /** อ้างอิงผู้ให้บริการปลอม */
  providerRef: string;
  /** เวลาหมดอายุของ intent (ISO) */
  expiresAt: string;
}

export interface PaymentProvider {
  readonly name: "fake-promptpay" | "contract-only";
  createIntent(paymentId: string, amount: number, expiresAt: Date): Promise<PromptPayIntent>;
  /**
   * ตรวจ slip แบบ fake: `VALID-*` → success, `AMBIGUOUS-*` → ambiguous, อื่น → fail
   * (production contract-only โยน error — ไม่เรียก network จริง)
   */
  verifySlip(slipRef: string): Promise<"success" | "ambiguous" | "fail">;
}

export function isFakePaymentMode(): boolean {
  if (process.env["PAOR_PAYMENT_FAKE"] === "true") return true;
  return process.env["NODE_ENV"] !== "production";
}

export class FakePromptPayProvider implements PaymentProvider {
  readonly name = "fake-promptpay" as const;

  async createIntent(paymentId: string, amount: number, expiresAt: Date): Promise<PromptPayIntent> {
    if (!isFakePaymentMode()) {
      throw new Error("ผู้ให้บริการชำระเงินจริงยังไม่เปิดใช้งาน (contract-only)");
    }
    const rounded = Math.round(amount * 100) / 100;
    return {
      qrPayload: `PROMPTPAY-FAKE:${paymentId}:${rounded}`,
      providerRef: `FAKE-${paymentId.slice(0, 8)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verifySlip(slipRef: string): Promise<"success" | "ambiguous" | "fail"> {
    if (!isFakePaymentMode()) {
      throw new Error("ผู้ให้บริการชำระเงินจริงยังไม่เปิดใช้งาน (contract-only)");
    }
    const v = slipRef.trim();
    if (v.startsWith("VALID-")) return "success";
    if (v.startsWith("AMBIGUOUS-")) return "ambiguous";
    return "fail";
  }
}

/**
 * Production adapter (contract-only): มี interface ครบแต่ยังไม่ผูกกับ
 * ผู้ให้บริการจริง — เรียกเมื่อใดก็โยน error ให้ route ตอบ 503
 * (กันเผลอใช้ credentials จริงก่อนเลือกผู้ให้บริการตาม REQUIREMENTS ข้อ 9.4)
 */
export class ContractOnlyPaymentProvider implements PaymentProvider {
  readonly name = "contract-only" as const;

  async createIntent(_paymentId: string, _amount: number, _expiresAt: Date): Promise<PromptPayIntent> {
    throw new Error("ผู้ให้บริการชำระเงินจริงยังไม่เปิดใช้งาน (contract-only)");
  }

  async verifySlip(_slipRef: string): Promise<"success" | "ambiguous" | "fail"> {
    throw new Error("ผู้ให้บริการชำระเงินจริงยังไม่เปิดใช้งาน (contract-only)");
  }
}

/** เลือก provider ตามโหมด (tests ฉีด fake ผ่าน seam นี้) */
export function resolvePaymentProvider(): PaymentProvider {
  return isFakePaymentMode() ? new FakePromptPayProvider() : new ContractOnlyPaymentProvider();
}
