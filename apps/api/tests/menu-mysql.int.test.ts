import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import mysql from "mysql2/promise";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP Ticket04 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 04 บน MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 */
describe.skipIf(!hasTestDb)("ticket04 menu catalog with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `m${Date.now().toString(36)}_`;
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
    // migration รันซ้ำได้ (รวม 005): สร้าง store ครั้งที่สองต้องไม่พัง
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
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("CRUD + public + audit บน MySQL จริง", async () => {
    const owner = await loginAgent(ownerName, "OwnerPass123");
    const cat = `${prefix}อาหาร`;
    let token = await csrfToken(owner);
    const c = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: cat,
      name: "ข้าวผัด",
      price: 50,
      kind: "food",
    });
    expect(c.status).toBe(201);

    token = await csrfToken(owner);
    const dup = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: cat,
      name: "ข้าวผัด",
      price: 60,
      kind: "food",
    });
    expect(dup.status).toBe(409);

    const pub = await request(app).get("/api/menu/public");
    expect(pub.status).toBe(200);
    const mine = (pub.body.groups as { category: string }[]).filter((g) => g.category === cat);
    expect(mine).toHaveLength(1);

    token = await csrfToken(owner);
    const audit = await owner.get("/api/audit/menu");
    expect(audit.status).toBe(200);
    expect((audit.body.items as { action: string }[]).map((i) => i.action)).toContain("menu_created");
  });

  it("transaction rollback: audit เขียนไม่ได้ → menu ที่ insert แล้วถูกย้อนหมด", async () => {
    const before = await store.listMenuItems({ includeArchived: true });
    await expect(
      store.createMenuItem(
        { category: `${prefix}อาหาร`, name: "เมนูย้อน", price: 10, kind: "food" },
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    expect(await store.listMenuItems({ includeArchived: true })).toHaveLength(before.length);
  });
});
