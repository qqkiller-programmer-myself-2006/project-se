import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import { openSqlAdmin, type SqlAdmin } from "./helpers/sql-admin.js";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP Issue#55 real-DB receipt QR integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

const SECRET = "integration-receipt-qr-secret-0123";

/**
 * Issue #55 บน SQL store จริงเท่านั้น (รันได้ทั้ง MySQL และ Postgres/Supabase — production ใช้ Postgres ผ่านชั้น pg-compat):
 * ผูกคำสั่งซื้อด้วย QR ใบเสร็จ — ใช้ครั้งเดียว, หมดอายุ 24 ชม., ไม่ซ้ำกับ guest-link, แต้มเข้าตามกติกาเดิม
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - **ต้องรันกับฐานข้อมูลจริงก่อน deploy**: CI ปกติไม่มี DB จึงไม่ได้พิสูจน์ SQL ส่วนนี้ (ไม่มี migration ใหม่)
 */
describe.skipIf(!hasTestDb)("issue55 receipt QR claim with real SQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: SqlAdmin;
  let offsetMs = 0;
  const prefix = `r${Date.now().toString(36)}_`;
  const ownerName = `${prefix}owner`;
  const customerIds: string[] = [];
  let drinkId = "";

  async function csrfToken(agent: Agent): Promise<string> {
    return (await agent.get("/api/auth/csrf")).body.csrfToken as string;
  }

  async function post(agent: Agent, url: string, body: Record<string, unknown>) {
    const token = await csrfToken(agent);
    return agent.post(url).set("x-csrf-token", token).send(body);
  }

  async function registerCustomer(): Promise<{ agent: Agent; id: string }> {
    const agent = request.agent(app);
    const phone = `08${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await post(agent, "/api/customers/register", { name: `${prefix}ลูกค้า`, phone, password: "Customer11" });
    expect(res.status).toBe(201);
    const id = res.body.customer.id as string;
    customerIds.push(id);
    return { agent, id };
  }

  async function paidGuestOrder(owner: Agent) {
    const guest = request.agent(app);
    const phone = "0812345678";
    const created = await post(guest, "/api/orders", {
      serviceType: "takeaway",
      items: [{ menuId: drinkId, quantity: 2 }],
      guestName: `${prefix}แขก`,
      guestPhone: phone,
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    const order = created.body.order as { id: string; total: number };
    const pay = await post(guest, "/api/payments", {
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: order.total,
      phone,
    });
    expect(pay.status).toBe(201);
    const confirmed = await post(owner, `/api/payments/${pay.body.payment.id}/confirm-cash`, {
      receivedAmount: order.total,
      reason: "รับเงินหน้าร้าน",
    });
    expect(confirmed.status).toBe(200);
    const receipt = await guest.get(`/api/receipts/by-payment/${pay.body.payment.id}?phone=${phone}`);
    expect(receipt.status).toBe(200);
    return { order, paymentId: pay.body.payment.id as string, code: receipt.body.claimQr?.code as string };
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    admin = await openSqlAdmin(TEST_DATABASE_URL);
    app = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      receiptQrSecret: SECRET,
      now: () => new Date(Date.now() + offsetMs),
    });
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
    const owner = request.agent(app);
    expect((await post(owner, "/api/auth/login", { username: ownerName, password: "OwnerPass123" })).status).toBe(200);
    const drink = await post(owner, "/api/menu", { category: `${prefix}เครื่องดื่ม`, name: "ชาทดสอบ", price: 30, kind: "drink" });
    expect(drink.status).toBe(201);
    drinkId = drink.body.item.id as string;
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    const orderSel = "SELECT id FROM orders WHERE guest_name LIKE ?";
    const like = `${prefix}%`;
    if (customerIds.length > 0) {
      const ph = customerIds.map(() => "?").join(",");
      await admin.query(`DELETE FROM loyalty_transactions WHERE customer_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM guest_link_claims WHERE customer_id IN (${ph})`, customerIds);
    }
    await admin.query(`DELETE FROM queue_jobs WHERE order_id IN (${orderSel})`, [like]);
    await admin.query("DELETE FROM refunds WHERE order_number IN (SELECT order_number FROM orders WHERE guest_name LIKE ?)", [like]);
    await admin.query("DELETE FROM receipts WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [like]);
    await admin.query("DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?))", [like]);
    await admin.query(`DELETE FROM payments WHERE order_id IN (${orderSel})`, [like]);
    await admin.query(`DELETE FROM order_stock_usage WHERE order_id IN (${orderSel})`, [like]);
    await admin.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [like]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [like]);
    if (customerIds.length > 0) {
      const ph = customerIds.map(() => "?").join(",");
      await admin.query(`DELETE FROM customer_sessions WHERE customer_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM customers WHERE id IN (${ph})`, customerIds);
    }
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [like]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("สแกนผูกออเดอร์เข้าบัญชี: customer_id + guest_link_claims ถูกบันทึก, ใช้ซ้ำ/ผูกเบอร์ซ้ำ 409, ปิดงานแล้วแต้มเข้า 2", async () => {
    const owner = request.agent(app);
    expect((await post(owner, "/api/auth/login", { username: ownerName, password: "OwnerPass123" })).status).toBe(200);
    const { order, code } = await paidGuestOrder(owner);
    expect(code).toMatch(/^RCPT-[0-9A-F]{32}-[0-9A-F]{24}$/);

    const a = await registerCustomer();
    const claimed = await post(a.agent, "/api/loyalty/receipt/claim", { code });
    expect(claimed.status).toBe(200);
    expect(claimed.body.earned).toBe(0);
    const orderRows = await admin.query<{ customer_id: string }>("SELECT customer_id FROM orders WHERE id = ?", [order.id]);
    expect(orderRows[0]!.customer_id).toBe(a.id);
    const claimRows = await admin.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM guest_link_claims WHERE order_id = ?", [order.id]);
    expect(admin.num(claimRows[0]!.n)).toBe(1);

    // ใช้ครั้งเดียว: คนอื่น/คนเดิม/ผูกด้วยเบอร์ ถูกปฏิเสธ
    const b = await registerCustomer();
    expect((await post(b.agent, "/api/loyalty/receipt/claim", { code })).status).toBe(409);
    expect((await post(a.agent, "/api/loyalty/receipt/claim", { code })).status).toBe(409);
    expect((await post(a.agent, "/api/loyalty/guest/link", { orderId: order.id })).status).toBe(409);

    // ปิดงาน → แต้มเข้าตามกติกาเดิม (ชา 2 แก้ว = 2 แต้ม) ครั้งเดียว
    const token = await csrfToken(owner);
    const done = await owner
      .patch(`/api/orders/${order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "รับของครบ" });
    expect(done.status).toBe(200);
    const pointRows = await admin.query<{ p: string | number }>("SELECT COALESCE(SUM(points), 0) AS p FROM loyalty_transactions WHERE customer_id = ?", [a.id]);
    expect(admin.num(pointRows[0]!.p)).toBe(2);
  }, 60000);

  it("หมดอายุ 24 ชม. → 409 และไม่ผูกอะไร", async () => {
    const owner = request.agent(app);
    expect((await post(owner, "/api/auth/login", { username: ownerName, password: "OwnerPass123" })).status).toBe(200);
    const { order, code } = await paidGuestOrder(owner);
    const c = await registerCustomer();
    offsetMs = 25 * 60 * 60 * 1000;
    try {
      const res = await post(c.agent, "/api/loyalty/receipt/claim", { code });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/หมดอายุ/);
    } finally {
      offsetMs = 0;
    }
    const orderRows = await admin.query<{ customer_id: string | null }>("SELECT customer_id FROM orders WHERE id = ?", [order.id]);
    expect(orderRows[0]!.customer_id).toBeNull();
  }, 60000);
});
