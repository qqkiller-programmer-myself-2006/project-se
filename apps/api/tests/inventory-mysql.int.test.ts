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
    "SKIP Ticket07 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 07 บน MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 */
describe.skipIf(!hasTestDb)("ticket07 menu options, recipes and inventory with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `i${Date.now().toString(36)}_`;
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
    // migration รันซ้ำได้ (รวม 008): สร้าง store ครั้งที่สองต้องไม่พัง
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
    await admin.query("DELETE FROM order_stock_usage WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [`${prefix}%`]);
    await admin.query("DELETE oi FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM stock_ledger WHERE reason LIKE ?", [`%${prefix}%`]);
    await admin.query("DELETE FROM recipe_lines WHERE recipe_id IN (SELECT id FROM recipes WHERE created_by = ?)", [ownerName]);
    await admin.query("DELETE FROM recipes WHERE created_by = ?", [ownerName]);
    await admin.query("DELETE FROM menu_options WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM menu_option_groups WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM ingredients WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("ตัวเลือก + สูตร + จองสต๊อกตอนยืนยัน + ตัดจริง บน MySQL จริง", async () => {
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

    token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: `${prefix}ขนาด` });
    expect(group.status).toBe(201);
    const groupId = group.body.group.id as string;

    token = await csrfToken(owner);
    const opt = await owner.post(`/api/menu/option-groups/${groupId}/options`).set("x-csrf-token", token).send({ name: `${prefix}พิเศษ`, priceDelta: 10 });
    expect(opt.status).toBe(201);
    const optionId = opt.body.option.id as string;

    token = await csrfToken(owner);
    const ing = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({
      name: `${prefix}ข้าวสาร`,
      unit: "กรัม",
      latestCost: 0.05,
      initialOnHand: 100,
    });
    expect(ing.status).toBe(201);
    const ingId = ing.body.item.id as string;

    token = await csrfToken(owner);
    const recipe = await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({
      targetType: "menu",
      targetId: menuId,
      lines: [{ ingredientId: ingId, qty: 10 }],
    });
    expect(recipe.status).toBe(201);
    expect(recipe.body.recipe.version).toBe(1);

    // สั่งพร้อมตัวเลือก: ราคา 50+10, จองข้าวสาร 10 กรัม
    const guest = request.agent(app);
    const key = randomUUID();
    token = await csrfToken(guest);
    const created = await guest.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId, quantity: 1, options: [optionId], specialRequest: "เผ็ดน้อย" }],
      guestName: `${prefix}มินตรา`,
      guestPhone: "0812345678",
      idempotencyKey: key,
    });
    expect(created.status).toBe(201);
    expect(created.body.order.total).toBe(60);
    expect(created.body.order.stockReserved).toBe(true);
    expect(created.body.order.items[0].specialRequest).toBe("เผ็ดน้อย");

    // ตัดจริงเมื่อเริ่มทำ
    token = await csrfToken(owner);
    const consumed = await owner.post(`/api/orders/${created.body.order.id}/consume`).set("x-csrf-token", token).send({});
    expect(consumed.status).toBe(200);
    expect(consumed.body.order.stockConsumed).toBe(true);

    token = await csrfToken(owner);
    const after = await owner.get(`/api/inventory/ingredients/${ingId}`);
    expect(after.body.item).toMatchObject({ onHand: 90, reserved: 0 });

    // ledger มีร่องรอยจอง + ตัดของคำสั่งซื้อนี้
    token = await csrfToken(owner);
    const ledger = await owner.get(`/api/inventory/ledger?orderId=${created.body.order.id}&limit=50`);
    expect(ledger.status).toBe(200);
    expect((ledger.body.entries as { op: string }[]).map((e) => e.op).sort()).toEqual(["consume", "reserve"]);
  });

  it("transaction rollback: audit เขียนไม่ได้ → การสร้างวัตถุดิบถูกย้อนหมด", async () => {
    const before = await store.listIngredients({ includeDisabled: true });
    await expect(
      store.createIngredient(
        { name: `${prefix}ของย้อน`, unit: "กรัม" },
        // username ยาวเกินคอลัมน์ audit (VARCHAR 64) → insert audit ล้มเหลว → rollback ทั้งแถว
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    expect(await store.listIngredients({ includeDisabled: true })).toHaveLength(before.length);
  });
});
