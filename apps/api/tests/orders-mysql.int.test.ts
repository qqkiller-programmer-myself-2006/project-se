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
    "SKIP Ticket05 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 05 บน MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 */
describe.skipIf(!hasTestDb)("ticket05 orders with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `o${Date.now().toString(36)}_`;
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
    // migration รันซ้ำได้ (รวม 006): สร้าง store ครั้งที่สองต้องไม่พัง
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
    // ลบเฉพาะข้อมูล prefix ของรันนี้ (ห้ามแตะแถวอื่นในฐานข้อมูลทดสอบ)
    await admin.query("DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.guest_name LIKE ?", [
      `${prefix}%`,
    ]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("สร้างคำสั่งซื้อ Guest + idempotency + snapshot บน MySQL จริง", async () => {
    const owner = await loginAgent(ownerName, "OwnerPass123");
    const cat = `${prefix}อาหาร`;
    let token = await csrfToken(owner);
    const menu = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: cat,
      name: "ข้าวผัด",
      price: 50,
      kind: "food",
    });
    expect(menu.status).toBe(201);
    const menuId = menu.body.item.id as string;

    const guest = request.agent(app);
    const key = randomUUID();
    const body = {
      serviceType: "takeaway",
      items: [{ menuId, quantity: 2 }],
      guestName: `${prefix}มินตรา`,
      guestPhone: "0812345678",
      idempotencyKey: key,
    };
    token = await csrfToken(guest);
    const created = await guest.post("/api/orders").set("x-csrf-token", token).send(body);
    expect(created.status).toBe(201);
    expect(created.body.order.total).toBe(100);

    // ส่งซ้ำ key เดิม → คืนของเดิม ไม่สร้างซ้ำ
    token = await csrfToken(guest);
    const replay = await guest.post("/api/orders").set("x-csrf-token", token).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.order.id).toBe(created.body.order.id);

    // เปลี่ยนสถานะ + audit
    token = await csrfToken(owner);
    const done = await owner
      .patch(`/api/orders/${created.body.order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ทดสอบ MySQL" });
    expect(done.status).toBe(200);

    const audits = await owner.get("/api/audit/orders");
    expect(audits.status).toBe(200);
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain("order_status_changed");
  });

  it("transaction rollback: audit เขียนไม่ได้ → order ที่ insert แล้วถูกย้อนหมด", async () => {
    const before = await store.listOrders({ limit: 200 });
    const menu = await store.listPublicMenuItems();
    expect(menu.length).toBeGreaterThan(0);
    await expect(
      store.createOrder(
        {
          guestName: "rollback",
          guestPhone: "0812345678",
          serviceType: "takeaway",
          idempotencyKey: randomUUID(),
          items: [{ menuId: menu[0]!.id, quantity: 1 }],
        },
        // username ยาวเกินคอลัมน์ audit (VARCHAR 64) → insert audit ล้มเหลว → rollback ทั้ง order
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    expect(await store.listOrders({ limit: 200 })).toHaveLength(before.length);
  });
});
