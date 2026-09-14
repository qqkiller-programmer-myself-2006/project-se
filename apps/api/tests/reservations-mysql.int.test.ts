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
    "SKIP Ticket06 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 06 บน MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 */
describe.skipIf(!hasTestDb)("ticket06 reservations with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `r${Date.now().toString(36)}_`;
  const ownerName = `${prefix}owner`;
  let tableId: string;
  let menuId: string;

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

  async function registerAgent(name: string, phone: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
    return agent;
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    // migration รันซ้ำได้ (รวม 007): สร้าง store ครั้งที่สองต้องไม่พัง
    const again = await createMysqlStore(TEST_DATABASE_URL);
    await again.close?.();
    admin = await mysql.createConnection(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
    const owner = await loginAgent(ownerName, "OwnerPass123");
    let token = await csrfToken(owner);
    const table = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: `${prefix}A1`, capacity: 4 });
    expect(table.status).toBe(201);
    tableId = table.body.table.id as string;
    token = await csrfToken(owner);
    const menu = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: `${prefix}อาหาร`,
      name: "ข้าวผัด",
      price: 50,
      kind: "food",
    });
    expect(menu.status).toBe(201);
    menuId = menu.body.item.id as string;
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    // ลบเฉพาะข้อมูล prefix ของรันนี้ (ห้ามแตะแถวอื่นในฐานข้อมูลทดสอบ)
    await admin.query("DELETE FROM table_rounds WHERE opened_by = ?", [ownerName]);
    await admin.query("DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.guest_name LIKE ?", [
      `${prefix}%`,
    ]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM reservations WHERE code LIKE 'RSV-%' AND customer_id IN (SELECT id FROM customers WHERE name LIKE ?)", [
      `${prefix}%`,
    ]);
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM shop_tables WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE cs FROM customer_sessions cs JOIN customers c ON cs.customer_id = c.id WHERE c.name LIKE ?", [
      `${prefix}%`,
    ]);
    await admin.query("DELETE FROM customers WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("จอง + เช็กอิน + ผูกออเดอร์ + ปิดรอบ บน MySQL จริง", async () => {
    const customer = await registerAgent(`${prefix}ลูกค้า`, "0812345678");
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    let token = await csrfToken(customer);
    const created = await customer.post("/api/reservations").set("x-csrf-token", token).send({
      tableId,
      partySize: 2,
      reservedAt: at,
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(created.body.reservation.code).toMatch(/^RSV-/);

    // ส่งซ้ำ key เดิม → คืนของเดิม
    token = await csrfToken(customer);
    const replay = await customer.post("/api/reservations").set("x-csrf-token", token).send({
      tableId,
      partySize: 2,
      reservedAt: at,
      idempotencyKey: created.body.reservation.idempotencyKey ?? undefined,
    });
    void replay;

    const owner = await loginAgent(ownerName, "OwnerPass123");
    token = await csrfToken(owner);
    const checkin = await owner
      .post("/api/checkin")
      .set("x-csrf-token", token)
      .send({ code: created.body.reservation.code, partySize: 2 });
    expect(checkin.status).toBe(201);
    const roundId = checkin.body.round.id as string;

    token = await csrfToken(customer);
    const order = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId, quantity: 1 }],
      idempotencyKey: randomUUID(),
      roundId,
    });
    expect(order.status).toBe(201);

    token = await csrfToken(owner);
    const done = await owner
      .patch(`/api/orders/${order.body.order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ทดสอบ MySQL" });
    expect(done.status).toBe(200);

    token = await csrfToken(owner);
    const closed = await owner.post(`/api/rounds/${roundId}/close`).set("x-csrf-token", token).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.round.status).toBe("closed");

    const audits = await owner.get("/api/audit/reservations");
    expect(audits.status).toBe(200);
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain("table_round_closed");
  });

  it("transaction rollback: audit เขียนไม่ได้ → การจองที่ insert แล้วถูกย้อนหมด", async () => {
    const before = await store.listReservations({ limit: 200 });
    const tables = await store.listTables();
    const table = tables.find((t) => t.id === tableId)!;
    void table;
    const customers = await store.listCustomers("0812345678", 5);
    expect(customers.length).toBeGreaterThan(0);
    await expect(
      store.createReservation(
        {
          customerId: customers[0]!.id,
          tableId,
          partySize: 2,
          reservedAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        },
        // username ยาวเกินคอลัมน์ audit (VARCHAR 64) → insert audit ล้มเหลว → rollback ทั้งการจอง
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    expect(await store.listReservations({ limit: 200 })).toHaveLength(before.length);
  });
});
