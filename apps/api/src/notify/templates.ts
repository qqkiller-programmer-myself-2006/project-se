/**
 * Ticket 12: เทมเพลตข้อความภาษาไทย (pure — ไม่มี I/O, ไม่มี secret)
 * ทุกเทมเพลตคืนข้อความล้วน ≤2000 อักษร ใช้ชื่อ/เลขเอกสาร/ยอด/เวลาเท่านั้น
 * วันที่แสดงเป็น wall-clock กรุงเทพ (Asia/Bangkok) ที่ caller แปลงมาให้แล้ว
 */

export interface ReservationTemplateInput {
  code: string;
  tableName: string;
  partySize: number;
  reservedAtBangkok: string;
}

export interface PaymentTemplateInput {
  orderNumber: string;
  amount: number;
  receiptNumber?: string | null;
}

export interface OrderTemplateInput {
  orderNumber: string;
  tableName?: string | null;
}

export interface LoyaltyTemplateInput {
  points: number;
  balance: number;
  rewardName?: string | null;
}

function fmtBaht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export function reservationCreatedMessage(i: ReservationTemplateInput): string {
  return (
    `ร้านป้าอ้อ: รับการจอง ${i.code} แล้ว\n` +
    `โต๊ะ ${i.tableName} · ${i.partySize} ท่าน\n` +
    `เวลานัด ${i.reservedAtBangkok} น.\n` +
    `กรุณามาก่อนเวลานัด 15 นาที ขอบคุณค่ะ/ครับ`
  );
}

export function reservationCancelledMessage(i: Pick<ReservationTemplateInput, "code">): string {
  return (
    `ร้านป้าอ้อ: ยกเลิกการจอง ${i.code} แล้ว\n` +
    `หากต้องการจองใหม่ กรุณาทำรายการผ่านหน้าเว็บ ขอบคุณค่ะ/ครับ`
  );
}

export function reservationReminderMessage(
  i: ReservationTemplateInput & { checkinCode: string },
): string {
  return (
    `ร้านป้าอ้อ: เตือนนัดอีก 30 นาที\n` +
    `การจอง ${i.code} โต๊ะ ${i.tableName} · ${i.partySize} ท่าน\n` +
    `เวลานัด ${i.reservedAtBangkok} น.\n` +
    `รหัสเช็กอิน ${i.checkinCode}`
  );
}

export function paymentPaidMessage(i: PaymentTemplateInput): string {
  const receipt = i.receiptNumber ? `\nใบเสร็จ ${i.receiptNumber}` : "";
  return (
    `ร้านป้าอ้อ: รับชำระคำสั่งซื้อ ${i.orderNumber} แล้ว ${fmtBaht(i.amount)}${receipt}\n` +
    `ครัวเริ่มทำตามคิว ติดตามสถานะได้ในหน้าเว็บ ขอบคุณค่ะ/ครับ`
  );
}

export function paymentManualReviewMessage(i: Pick<PaymentTemplateInput, "orderNumber">): string {
  return (
    `ร้านป้าอ้อ: ได้รับหลักฐานชำระของคำสั่งซื้อ ${i.orderNumber} แล้ว\n` +
    `อยู่ระหว่างให้พนักงานตรวจสอบ กรุณารอสักครู่ ติดตามผลได้ในหน้าเว็บ`
  );
}

export function orderReadyMessage(i: OrderTemplateInput): string {
  const table = i.tableName ? ` (โต๊ะ ${i.tableName})` : "";
  return (
    `ร้านป้าอ้อ: คำสั่งซื้อ ${i.orderNumber}${table} พร้อมรับครบแล้ว\n` +
    `กรุณารับอาหารที่จุดรับได้เลย ขอบคุณค่ะ/ครับ`
  );
}

export function orderDeliveredMessage(i: OrderTemplateInput): string {
  return (
    `ร้านป้าอ้อ: ส่งมอบคำสั่งซื้อ ${i.orderNumber} ครบแล้ว\n` +
    `ขอบคุณที่ใช้บริการ หากมีข้อเสนอแนะแจ้งพนักงานได้เลยค่ะ/ครับ`
  );
}

export function loyaltyEarnedMessage(i: LoyaltyTemplateInput): string {
  return (
    `ร้านป้าอ้อ: ได้รับ ${i.points} คะแนนสะสมแล้ว (คงเหลือ ${i.balance} คะแนน)\n` +
    `สะสมครบ 10 คะแนนแลกเครื่องดื่มได้ 1 แก้ว`
  );
}

export function loyaltyRedeemedMessage(i: LoyaltyTemplateInput): string {
  const reward = i.rewardName ? ` (${i.rewardName})` : "";
  return (
    `ร้านป้าอ้อ: ใช้คะแนน ${i.points} คะแนนแล้ว${reward} คงเหลือ ${i.balance} คะแนน\n` +
    `แสดงรหัสแลกรับกับพนักงานเครื่องดื่มได้เลย`
  );
}
