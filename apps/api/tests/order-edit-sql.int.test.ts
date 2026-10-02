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
    "SKIP Issue#42 real-DB order edit integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Issue #42 บน SQL store จริงเท่านั้น (รันได้ทั้ง MySQL และ Postgres/Supabase — production ใช้ Postgres ผ่านชั้น pg-compat):
 * แก้ไขรายการในออเดอร์เดิมต้องคืนยอดจองเดิม + จองใหม่ใน transaction เดียว
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - **ต้องรันกับฐานข้อมูลจริงก่อน deploy**: CI ปกติไม่มี DB จึงไม่ได้พิสูจน์ SQL ส่วนนี้
 */
describe.skipIf(!hasTestDb)("issue42 order edit with real SQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: SqlAdmin;
  const prefix = `e${Date.now().toString(36)}_`;
  const ownerName = `${prefix}owner`;
  let foodId = "";
  let drinkId = "";
  let ingredientId = "";

  async function csrfToken(agent: Agent): Promise<string> {
    return (await agent.get("/api/auth/csrf")).body.csrfToken as string;
  }

  async function loginAgent(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function reserved(): Promise<number> {
    const rows = await admin.query<{ reserved: string | number }>("SELECT reserved FROM ingredients WHERE id = ?", [ingredientId]);
    return admin.num(rows[0]!.reserved);
  }

  async function usageRows(orderId: string): Promise<number> {
    const rows = await admin.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM order_stock_usage WHERE order_id = ?", [orderId]);
    return admin.num(rows[0]!.n);
  }

  async function putItems(agent: Agent, orderId: string, body: Record<string, unknown>) {
    const token = await csrfToken(agent);
    return agent.put(`/api/orders/${orderId}/items`).set("x-csrf-token", token).send(body);
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    admin = await openSqlAdmin(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000 });
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
    const owner = await loginAgent(ownerName, "OwnerPass123");
    const cat = `${prefix}อาหาร`;
    let token = await csrfToken(owner);
    const food = await owner.post("/api/menu").set("x-csrf-token", token).send({ category: cat, name: "ข้าวผัดทดสอบ", price: 50, kind: "food" });
    expect(food.status).toBe(201);
    foodId = food.body.item.id as string;
    token = await csrfToken(owner);
    const drink = await owner.post("/api/menu").set("x-csrf-token", token).send({ category: cat, name: "ชาทดสอบ", price: 25, kind: "drink" });
    expect(drink.status).toBe(201);
    drinkId = drink.body.item.id as string;
    token = await csrfToken(owner);
    const ing = await owner
      .post("/api/inventory/ingredients")
      .set("x-csrf-token", token)
      .send({ name: `${prefix}ข้าวสาร`, unit: "กรัม", latestCost: 0.05, initialOnHand: 100 });
    expect(ing.status).toBe(201);
    ingredientId = ing.body.item.id as string;
    token = await csrfToken(owner);
    const recipe = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: foodId, lines: [{ ingredientId, qty: 10 }] });
    expect(recipe.status).toBe(201);
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    await admin.query("DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?))", [`${prefix}%`]);
    await admin.query("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [`${prefix}%`]);
    await admin.query("DELETE FROM order_stock_usage WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [`${prefix}%`]);
    await admin.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE guest_name LIKE ?)", [`${prefix}%`]);
    await admin.query("DELETE FROM orders WHERE guest_name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM stock_ledger WHERE ingredient_id = ?", [ingredientId]);
    await admin.query("DELETE FROM recipe_lines WHERE recipe_id IN (SELECT id FROM recipes WHERE created_by = ?)", [ownerName]);
    await admin.query("DELETE FROM recipes WHERE created_by = ?", [ownerName]);
    await admin.query("DELETE FROM ingredients WHERE name LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM menu_items WHERE category LIKE ?", [`${prefix}%`]);
    await admin.query("DELETE FROM audit_logs WHERE actor_username = ?", [ownerName]);
    await admin.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)", [ownerName]);
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("แก้รายการ: ยอด/รายการ/ยอดจองเปลี่ยนใน tx เดียว, ไม่พอ → rollback, replay เดิม no-op, ชำระแล้วแก้ไม่ได้", async () => {
    const guest = request.agent(app);
    const phone = "0812345678";
    let token = await csrfToken(guest);
    const created = await guest.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: foodId, quantity: 3 }],
      guestName: `${prefix}คุณมินตรา`,
      guestPhone: phone,
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    const order = created.body.order as { id: string; orderNumber: string };
    expect(await reserved()).toBe(30);
    expect(await usageRows(order.id)).toBe(1);

    // เพิ่มจำนวน + เพิ่มเมนูไม่มีสูตร → ยอดจอง 30 → 50, เลข/id เดิม
    const edited = await putItems(guest, order.id, {
      phone,
      items: [
        { menuId: foodId, quantity: 5, note: "ไม่ใส่ผัก" },
        { menuId: drinkId, quantity: 1 },
      ],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.changed).toBe(true);
    expect(edited.body.order).toMatchObject({ id: order.id, orderNumber: order.orderNumber, total: 275 });
    expect(edited.body.order.items).toHaveLength(2);
    expect(await reserved()).toBe(50);
    expect(await usageRows(order.id)).toBe(1);

    // replay เดิม → changed:false และยอดจองไม่ขยับ
    const replay = await putItems(guest, order.id, {
      phone,
      items: [
        { menuId: foodId, quantity: 5, note: "ไม่ใส่ผัก" },
        { menuId: drinkId, quantity: 1 },
      ],
    });
    expect(replay.status).toBe(200);
    expect(replay.body.changed).toBe(false);
    expect(await reserved()).toBe(50);

    // สต๊อกไม่พอ (11 จาน = 110 > 100) → 409 และ tx ย้อนกลับ: ยอดจอง/รายการ/ยอดรวมต้องเท่าเดิม
    const tooMany = await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 11 }] });
    expect(tooMany.status).toBe(409);
    expect(await reserved()).toBe(50);
    expect(await usageRows(order.id)).toBe(1);
    const itemRows = await admin.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?", [order.id]);
    expect(admin.num(itemRows[0]!.n)).toBe(2);
    const totalRows = await admin.query<{ total: string | number }>("SELECT total FROM orders WHERE id = ?", [order.id]);
    expect(admin.num(totalRows[0]!.total)).toBe(275);

    // เปลี่ยนเป็นเมนูไม่มีสูตร → คืนยอดจองทั้งหมดและไม่มี usage ค้าง
    const noRecipe = await putItems(guest, order.id, { phone, items: [{ menuId: drinkId, quantity: 2 }] });
    expect(noRecipe.status).toBe(200);
    expect(await reserved()).toBe(0);
    expect(await usageRows(order.id)).toBe(0);

    // มีคำขอชำระเงินแล้วแก้ไม่ได้
    token = await csrfToken(guest);
    const intent = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 50,
      phone,
    });
    expect(intent.status).toBe(201);
    const blocked = await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 1 }] });
    expect(blocked.status).toBe(409);
    expect(await reserved()).toBe(0);
  }, 60000);
});
