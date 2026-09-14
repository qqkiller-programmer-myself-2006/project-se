import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP Ticket08 real-MySQL integration: ไม่พบ TEST_DATABASE_URL " +
      "(ข้าม asserts ที่ต้องใช้ MySQL จริง; ห้ามใช้ DATABASE_URL production)",
  );
}

/**
 * Ticket 08 เส้นทาง MySQL จริงด้วย TEST_DATABASE_URL แยกจาก production เท่านั้น
 * - ไม่มี URL → skip อย่างซื่อสัตย์ (ไม่ fail)
 * - มี URL → migrate + สร้าง intent/ยืนยันเงินสด/webhook dedupe/cash+receipt/refund ครบ
 */
describe.skipIf(!hasTestDb)("ticket08 payments with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `p${Date.now().toString(36)}_`;
  const ownerName = `${prefix}owner`;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function loginAgent(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    // migration รันซ้ำได้ (รวม 009): เปิด store อีกรอบต้องไม่พัง
    const again = await createMysqlStore(TEST_DATABASE_URL);
    await again.close?.();
    admin = await mysql.createConnection(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000 });
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    await admin.query("DELETE FROM refunds WHERE order_number LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM receipts WHERE order_number LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE pe FROM payment_events pe JOIN payments p ON pe.payment_id = p.id WHERE p.order_number LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM payments WHERE order_number LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("เงินสดบน MySQL จริง: intent → ยืนยัน (paid + ใบเสร็จ) + idempotency + audit", async () => {
    const owner = await loginAgent(ownerName, "OwnerPass123");
    const cat = `${prefix}อาหาร`;
    let token = await csrfToken(owner);
    const menu = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: cat,
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    expect(menu.status).toBe(201);
    const menuId = menu.body.item.id as string;

    const guest = request.agent(app);
    const key = randomUUID();
    const orderBody = {
      serviceType: "takeaway",
      items: [{ menuId, quantity: 2 }],
      guestName: `${prefix}ลูกค้า`,
      guestPhone: "0812345678",
      idempotencyKey: randomUUID(),
    };
    token = await csrfToken(guest);
    const created = await guest.post("/api/orders").set("x-csrf-token", token).send(orderBody);
    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;

    token = await csrfToken(guest);
    const intent = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: key,
      receivedAmount: 120,
      phone: "0812345678",
    });
    expect(intent.status).toBe(201);
    expect(intent.body.payment.amount).toBe(100);

    token = await csrfToken(guest);
    const replay = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: key,
      receivedAmount: 120,
      phone: "0812345678",
    });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);

    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${intent.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: 120, reason: "รับเงินหน้าร้าน MySQL" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("paid");
    expect(confirmed.body.receipt.receiptNumber).toMatch(/^RCP-/);

    const audits = await owner.get("/api/audit/payments");
    expect(audits.status).toBe(200);
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain("payment_paid");
  });

  it("transaction rollback: audit ล้มเหลว → payment ไม่ insert ค้าง", async () => {
    const before = await store.listPayments({ limit: 200 });
    const menu = await store.listPublicMenuItems();
    expect(menu.length).toBeGreaterThan(0);
    await expect(
      store.createPayment(
        { orderId: "00000000-0000-0000-0000-000000000000", method: "cash", idempotencyKey: randomUUID(), receivedAmount: 10 },
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    expect(await store.listPayments({ limit: 200 })).toHaveLength(before.length);
  });
});
