import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.warn("SKIP payments SQL store integration: ไม่พบ TEST_DATABASE_URL (mysql:// หรือ postgres://)");
}

/**
 * อ่านสถานะชำระเงินของออเดอร์ที่มี payment แล้ว ผ่าน SQL store จริง
 * (memory store ในเทสต์อื่นไม่ผ่านโค้ดแปลงแถว SQL จึงจับบัคนี้ไม่ได้)
 * รันได้ทั้ง MySQL และ Supabase/PostgreSQL — ใช้ฐานข้อมูลทดสอบแยกเท่านั้น
 */
describe.skipIf(!hasTestDb)("payments ผ่าน SQL store จริง (TEST_DATABASE_URL)", () => {
  let store: Store;

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await store?.close?.();
  });

  it("ออเดอร์ที่สร้างคำขอพร้อมเพย์แล้ว อ่าน payment และสถานะได้ (หน้า /pay โหลด QR จากตรงนี้)", async () => {
    const menu = await store.listPublicMenuItems();
    expect(menu.length).toBeGreaterThan(0);
    const { order } = await store.createOrder(
      {
        guestName: "ทดสอบชำระเงิน",
        guestPhone: "0812345678",
        serviceType: "takeaway",
        idempotencyKey: randomUUID(),
        items: [{ menuId: menu[0]!.id, quantity: 1 }],
      },
      { ip: "127.0.0.1" },
    );
    const { payment } = await store.createPayment(
      { orderId: order.id, method: "promptpay", idempotencyKey: randomUUID() },
      { ip: "127.0.0.1" },
    );

    expect((await store.getOrderPayment(order.id))?.id).toBe(payment.id);
    expect(await store.getOrderPaymentState(order.id)).toBe("pending_payment");
  });
});
