import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

function guestOrder(over: Record<string, unknown> = {}) {
  return {
    serviceType: "takeaway",
    items: [{ menuId: "__MENU__", quantity: 1 }],
    guestName: "คุณมินตรา",
    guestPhone: "0812345678",
    idempotencyKey: randomUUID(),
    ...over,
  };
}

describe("Ticket 07 menu options, recipes and inventory (public HTTP seam)", () => {
  let store: Store;
  let app: Express;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function loginAs(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function registerCustomer(name: string, phone: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
    return agent;
  }

  async function createMenu(agent: Agent, body: Record<string, unknown>): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/menu").set("x-csrf-token", token).send(body);
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function createIngredient(agent: Agent, body: Record<string, unknown>): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/inventory/ingredients").set("x-csrf-token", token).send(body);
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  let owner: Agent;
  let admin: Agent;
  let kitchen: Agent;
  let menuId: string;
  let drinkId: string;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    owner = await loginAs("owner", "OwnerPass123");
    admin = await loginAs("admin1", "AdminPass123");
    kitchen = await loginAs("kitchen1", "Kitchen123");
    menuId = await createMenu(owner, { category: "อาหารจานเดียว", name: "ข้าวผัดป้าอ้อ", price: 50, kind: "food" });
    drinkId = await createMenu(owner, { category: "เครื่องดื่ม", name: "ชาเย็น", price: 25, kind: "drink" });
  });

  // ---------- กลุ่มตัวเลือก + ตัวเลือก ----------

  it("Admin สร้างกลุ่ม/ตัวเลือกได้; ชื่อซ้ำในเมนู/กลุ่มเดิมได้ 409; audit ครบ", async () => {
    let token = await csrfToken(admin);
    const group = await admin
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "ขนาด", sortOrder: 0 });
    expect(group.status).toBe(201);
    const groupId = group.body.group.id as string;

    // ชื่อกลุ่มซ้ำในเมนูเดียวกัน → 409
    token = await csrfToken(admin);
    const dupGroup = await admin
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "ขนาด" });
    expect(dupGroup.status).toBe(409);

    // ตัวเลือก +10 บาท
    token = await csrfToken(admin);
    const opt = await admin
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "พิเศษ", priceDelta: 10 });
    expect(opt.status).toBe(201);
    expect(opt.body.option).toMatchObject({ name: "พิเศษ", priceDelta: 10, isEnabled: true });

    // ชื่อตัวเลือกซ้ำในกลุ่มเดียวกัน → 409
    token = await csrfToken(admin);
    const dupOpt = await admin
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "พิเศษ" });
    expect(dupOpt.status).toBe(409);

    // หลังร้านดูกลุ่มพร้อมตัวเลือก
    const listed = await admin.get(`/api/menu/${menuId}/option-groups`);
    expect(listed.status).toBe(200);
    expect(listed.body.groups).toHaveLength(1);
    expect(listed.body.groups[0].options).toHaveLength(1);

    // audit มีเหตุการณ์สร้างกลุ่ม + ตัวเลือก (ไม่มีข้อมูลลับ)
    const audits = await admin.get("/api/audit/menu?limit=100");
    expect(audits.status).toBe(200);
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("menu_option_group_created");
    expect(actions).toContain("menu_option_created");
    const raw = JSON.stringify(audits.body);
    for (const secret of ["passwordHash", "password_hash", "token", "secret"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("แก้ชื่อ/ปิดขายตัวเลือก: เปลี่ยน isEnabled อย่างเดียวเป็น status_changed; เมนู archive จัดการต่อไม่ได้", async () => {
    let token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ขนาด" });
    const groupId = group.body.group.id as string;
    token = await csrfToken(owner);
    const opt = await owner
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "พิเศษ", priceDelta: 10 });
    const optionId = opt.body.option.id as string;

    // ปิดขายอย่างเดียว → menu_option_status_changed
    token = await csrfToken(owner);
    const disabled = await owner
      .patch(`/api/menu/options/${optionId}`)
      .set("x-csrf-token", token)
      .send({ isEnabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.option.isEnabled).toBe(false);
    const audits = await owner.get("/api/audit/menu?limit=100");
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("menu_option_status_changed");

    // archive เมนูแล้วสร้างกลุ่มต่อไม่ได้ (409)
    token = await csrfToken(owner);
    const archived = await owner.post(`/api/menu/${menuId}/archive`).set("x-csrf-token", token).send({});
    expect(archived.status).toBe(200);
    token = await csrfToken(owner);
    const afterArchive = await owner
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "ท็อปปิ้ง" });
    expect(afterArchive.status).toBe(409);
  });

  it("สิทธิ์: kitchen/drink/Guest จัดการตัวเลือกไม่ได้ (403/401) และ validation ไทยชัดเจน (400)", async () => {
    const guest = request.agent(app);
    let token = await csrfToken(kitchen);
    const denied = await kitchen
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "ขนาด" });
    expect(denied.status).toBe(403);

    token = await csrfToken(guest);
    const guestDenied = await guest
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "ขนาด" });
    expect(guestDenied.status).toBe(401);

    // ชื่อว่าง → 400
    token = await csrfToken(admin);
    const bad = await admin
      .post(`/api/menu/${menuId}/option-groups`)
      .set("x-csrf-token", token)
      .send({ name: "   " });
    expect(bad.status).toBe(400);
    // เมนูไม่มีอยู่ → 404
    token = await csrfToken(admin);
    const missing = await admin
      .post("/api/menu/no-such-menu/option-groups")
      .set("x-csrf-token", token)
      .send({ name: "ขนาด" });
    expect(missing.status).toBe(404);
  });

  // ---------- เมนูสาธารณะพร้อมตัวเลือก + สถานะพร้อมขาย ----------

  it("public เห็นกลุ่มตัวเลือกที่เปิดขาย + ป้ายวัตถุดิบหมดเมื่อสต๊อกไม่พอ", async () => {
    // กลุ่ม + ตัวเลือก (ปิดขายหนึ่งตัว → public ไม่เห็นตัวนั้น)
    let token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ขนาด" });
    const groupId = group.body.group.id as string;
    token = await csrfToken(owner);
    const special = await owner
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "พิเศษ", priceDelta: 10 });
    token = await csrfToken(owner);
    const plain = await owner
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "ธรรมดา", priceDelta: 0 });
    token = await csrfToken(owner);
    await owner.patch(`/api/menu/options/${plain.body.option.id}`).set("x-csrf-token", token).send({ isEnabled: false });

    // วัตถุดิบ 5 กรัม แต่สูตรใช้ 10 กรัม/จาน → inStock false
    const ingId = await createIngredient(owner, { name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 5 });
    token = await csrfToken(owner);
    const recipe = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: ingId, qty: 10 }] });
    expect(recipe.status).toBe(201);
    expect(recipe.body.recipe.version).toBe(1);

    const guest = request.agent(app);
    const pub = await guest.get("/api/menu/public");
    expect(pub.status).toBe(200);
    const fried = (pub.body.groups as { category: string; items: Record<string, unknown>[] }[])
      .flatMap((g) => g.items)
      .find((m) => m["id"] === menuId) as unknown as {
      optionGroups: { id: string; options: { id: string; name: string }[] }[];
      inStock: boolean;
    };
    expect(fried.inStock).toBe(false);
    expect(fried.optionGroups).toHaveLength(1);
    expect(fried.optionGroups[0]!.options.map((o) => o.name)).toEqual(["พิเศษ"]);
    void special;
  });

  // ---------- คำสั่งซื้อพร้อมตัวเลือก: snapshot ราคา + validation ----------

  it("สั่งพร้อมตัวเลือก: ราคารวมส่วนต่าง + snapshot ชื่อ/ราคา + เปลี่ยนราคาภายหลังไม่กระทบ", async () => {
    let token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ขนาด" });
    const groupId = group.body.group.id as string;
    token = await csrfToken(owner);
    const opt = await owner
      .post(`/api/menu/option-groups/${groupId}/options`)
      .set("x-csrf-token", token)
      .send({ name: "พิเศษ", priceDelta: 10 });
    const optionId = opt.body.option.id as string;

    const guest = request.agent(app);
    token = await csrfToken(guest);
    const created = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 2, options: [optionId], specialRequest: "เผ็ดน้อย" }] }));
    expect(created.status).toBe(201);
    const order = created.body.order;
    expect(order.total).toBe(120);
    expect(order.items[0]).toMatchObject({ menuName: "ข้าวผัดป้าอ้อ", unitPrice: 60, quantity: 2, lineTotal: 120 });
    expect(order.items[0].selectedOptions).toMatchObject([
      { groupName: "ขนาด", optionId, optionName: "พิเศษ", priceDelta: 10 },
    ]);
    expect(order.items[0].specialRequest).toBe("เผ็ดน้อย");

    // เปลี่ยนส่วนต่างราคาภายหลัง → คำสั่งซื้อเดิมไม่เปลี่ยน
    token = await csrfToken(owner);
    await owner.patch(`/api/menu/options/${optionId}`).set("x-csrf-token", token).send({ priceDelta: 99 });
    const again = await guest.get(`/api/orders/lookup?number=${order.orderNumber}&phone=0812345678`);
    expect(again.status).toBe(200);
    expect(again.body.order.items[0].unitPrice).toBe(60);
    expect(again.body.order.total).toBe(120);
  });

  it("ตัวเลือกผิดกฎถูกปฏิเสธ 409: ข้ามเมนู/ปิดขาย/กลุ่มละเกิน 1 ตัว; ความต้องการเฉพาะยาวเกินได้ 400", async () => {
    let token = await csrfToken(owner);
    const g1 = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ขนาด" });
    const g1Id = g1.body.group.id as string;
    token = await csrfToken(owner);
    const big = await owner.post(`/api/menu/option-groups/${g1Id}/options`).set("x-csrf-token", token).send({ name: "พิเศษ", priceDelta: 10 });
    token = await csrfToken(owner);
    const small = await owner.post(`/api/menu/option-groups/${g1Id}/options`).set("x-csrf-token", token).send({ name: "ธรรมดา", priceDelta: 0 });
    token = await csrfToken(owner);
    const g2 = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ท็อปปิ้ง" });
    token = await csrfToken(owner);
    const egg = await owner.post(`/api/menu/option-groups/${g2.body.group.id}/options`).set("x-csrf-token", token).send({ name: "เพิ่มไข่", priceDelta: 12 });
    // ตัวเลือกของเมนูเครื่องดื่ม (ข้ามเมนู)
    token = await csrfToken(owner);
    const dg = await owner.post(`/api/menu/${drinkId}/option-groups`).set("x-csrf-token", token).send({ name: "ระดับหวาน" });
    token = await csrfToken(owner);
    const sweet = await owner.post(`/api/menu/option-groups/${dg.body.group.id}/options`).set("x-csrf-token", token).send({ name: "หวานน้อย", priceDelta: 0 });
    // ปิดขายตัวหนึ่ง
    token = await csrfToken(owner);
    await owner.patch(`/api/menu/options/${small.body.option.id}`).set("x-csrf-token", token).send({ isEnabled: false });

    const guest = request.agent(app);
    async function tryOrder(items: unknown[]): Promise<number> {
      const t = await csrfToken(guest);
      const res = await guest.post("/api/orders").set("x-csrf-token", t).send(guestOrder({ items }));
      return res.status;
    }
    // กลุ่มเดียวกัน 2 ตัวเลือก → 409
    expect(await tryOrder([{ menuId, quantity: 1, options: [big.body.option.id, small.body.option.id] }])).toBe(409);
    // ตัวเลือกปิดขาย → 409
    expect(await tryOrder([{ menuId, quantity: 1, options: [small.body.option.id] }])).toBe(409);
    // ตัวเลือกของเมนูอื่น → 409
    expect(await tryOrder([{ menuId, quantity: 1, options: [sweet.body.option.id] }])).toBe(409);
    // รหัสที่ไม่มีอยู่ → 409
    expect(await tryOrder([{ menuId, quantity: 1, options: [randomUUID()] }])).toBe(409);
    // ความต้องการเฉพาะยาวเกิน 200 → 400
    expect(await tryOrder([{ menuId, quantity: 1, specialRequest: "ก".repeat(201) }])).toBe(400);
    // สองกลุ่มคนละตัวเลือก → ผ่าน (201)
    expect(
      await tryOrder([{ menuId, quantity: 1, options: [big.body.option.id, egg.body.option.id] }]),
    ).toBe(201);
  });

  // ---------- วัตถุดิบ + ธุรกรรมสต๊อก + ledger ----------

  it("วัตถุดิบ CRUD: สร้างพร้อมยอดเริ่มต้น + ชื่อซ้ำ 409 + หน่วยเปลี่ยนไม่ได้ + audit", async () => {
    const ingId = await createIngredient(owner, {
      name: "ข้าวสาร",
      unit: "กรัม",
      reorderThreshold: 100,
      latestCost: 0.05,
      initialOnHand: 500,
    });
    let token = await csrfToken(owner);
    const got = await owner.get(`/api/inventory/ingredients/${ingId}`);
    expect(got.status).toBe(200);
    expect(got.body.item).toMatchObject({ name: "ข้าวสาร", unit: "กรัม", onHand: 500, reserved: 0, available: 500 });

    // ชื่อซ้ำ → 409
    token = await csrfToken(owner);
    const dup = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({ name: "ข้าวสาร", unit: "กรัม" });
    expect(dup.status).toBe(409);

    // แก้ทุน/ระดับเตือนได้; หน่วยไม่มีช่องให้แก้ (ส่ง unit มาถูกเพิกเฉย)
    token = await csrfToken(owner);
    const patched = await owner
      .patch(`/api/inventory/ingredients/${ingId}`)
      .set("x-csrf-token", token)
      .send({ latestCost: 0.06, unit: "กิโลกรัม" });
    expect(patched.status).toBe(200);
    expect(patched.body.item).toMatchObject({ unit: "กรัม", latestCost: 0.06 });

    const audits = await owner.get("/api/audit/inventory?limit=100");
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("ingredient_created");
    expect(actions).toContain("ingredient_updated");
  });

  it("ธุรกรรมสต๊อก: รับเข้า/ของเสีย/adjust + ledger ก่อน-หลัง + กันติดลบ 409 + reserve ผ่านช่องนี้ไม่ได้", async () => {
    const ingId = await createIngredient(owner, { name: "นมสด", unit: "มิลลิลิตร", initialOnHand: 1000 });
    let token = await csrfToken(owner);
    const waste = await owner
      .post(`/api/inventory/ingredients/${ingId}/stock`)
      .set("x-csrf-token", token)
      .send({ op: "waste", qty: 200, reason: "หกตอนชง" });
    expect(waste.status).toBe(201);
    expect(waste.body.ingredient).toMatchObject({ onHand: 800, available: 800 });
    expect(waste.body.entry).toMatchObject({ op: "waste", deltaOnHand: -200, beforeOnHand: 1000, afterOnHand: 800 });

    // ใช้เกินคงเหลือ → 409 และยอดไม่เปลี่ยน
    token = await csrfToken(owner);
    const over = await owner
      .post(`/api/inventory/ingredients/${ingId}/stock`)
      .set("x-csrf-token", token)
      .send({ op: "expire", qty: 9999, reason: "ทดสอบ" });
    expect(over.status).toBe(409);
    token = await csrfToken(owner);
    const still = await owner.get(`/api/inventory/ingredients/${ingId}`);
    expect(still.body.item.onHand).toBe(800);

    // reserve เป็นของระบบจากคำสั่งซื้อเท่านั้น → 400
    token = await csrfToken(owner);
    const sys = await owner
      .post(`/api/inventory/ingredients/${ingId}/stock`)
      .set("x-csrf-token", token)
      .send({ op: "reserve", qty: 10, reason: "ทดสอบ" });
    expect(sys.status).toBe(400);

    // ledger ใหม่สุดก่อน + audit stock_updated
    const ledger = await owner.get(`/api/inventory/ledger?ingredientId=${ingId}&limit=50`);
    expect(ledger.status).toBe(200);
    expect((ledger.body.entries as { op: string }[]).map((e) => e.op)).toEqual(["waste", "receive"]);
    const audits = await owner.get("/api/audit/inventory?limit=100");
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain("stock_updated");
  });

  it("สิทธิ์สต๊อก: kitchen/drink/ลูกค้าดูหรือขยับสต๊อกไม่ได้", async () => {
    const ingId = await createIngredient(owner, { name: "ไข่ไก่", unit: "ฟอง", initialOnHand: 30 });
    void ingId;
    const customer = await registerCustomer("คุณลูกค้า", "0891112222");

    let token = await csrfToken(kitchen);
    expect((await kitchen.get("/api/inventory/ingredients")).status).toBe(403);
    token = await csrfToken(kitchen);
    expect(
      (await kitchen.post(`/api/inventory/ingredients/${ingId}/stock`).set("x-csrf-token", token).send({ op: "waste", qty: 1, reason: "x" })).status,
    ).toBe(403);

    const cToken = await csrfToken(customer);
    expect((await customer.get("/api/inventory/ingredients")).status).toBe(401);

    const guest = request.agent(app);
    token = await csrfToken(guest);
    expect((await guest.get("/api/inventory/ledger?limit=10")).status).toBe(401);
  });

  // ---------- สูตรแบบ versioned ----------

  it("สูตร versioned: สร้าง v1/v2 + ต้นทุนจากทุนล่าสุด + วัตถุดิบงดใช้/ไม่มีอยู่ถูกปฏิเสธ", async () => {
    const rice = await createIngredient(owner, { name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 1000 });
    const egg = await createIngredient(owner, { name: "ไข่ไก่", unit: "ฟอง", latestCost: 4, initialOnHand: 100 });
    let token = await csrfToken(owner);
    const v1 = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: rice, qty: 100 }] });
    expect(v1.status).toBe(201);
    expect(v1.body.recipe).toMatchObject({ version: 1, estimatedCostPerUnit: 5 });

    token = await csrfToken(owner);
    const v2 = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: rice, qty: 100 }, { ingredientId: egg, qty: 1 }] });
    expect(v2.status).toBe(201);
    expect(v2.body.recipe).toMatchObject({ version: 2, estimatedCostPerUnit: 9 });

    const history = await owner.get(`/api/inventory/recipes?targetType=menu&targetId=${menuId}`);
    expect(history.status).toBe(200);
    expect((history.body.recipes as { version: number }[]).map((r) => r.version)).toEqual([1, 2]);
    const latest = await owner.get(`/api/inventory/recipes/latest?targetType=menu&targetId=${menuId}`);
    expect(latest.body.recipe.version).toBe(2);

    // วัตถุดิบงดใช้ → 409
    token = await csrfToken(owner);
    await owner.patch(`/api/inventory/ingredients/${egg}`).set("x-csrf-token", token).send({ isEnabled: false });
    token = await csrfToken(owner);
    const disabled = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: egg, qty: 1 }] });
    expect(disabled.status).toBe(409);

    // วัตถุดิบไม่มีอยู่ → 404; เป้าหมายไม่มีอยู่ → 404; สูตรว่าง → 400
    token = await csrfToken(owner);
    expect(
      (await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: randomUUID(), qty: 1 }] })).status,
    ).toBe(404);
    token = await csrfToken(owner);
    expect(
      (await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: randomUUID(), lines: [{ ingredientId: rice, qty: 1 }] })).status,
    ).toBe(404);
    token = await csrfToken(owner);
    expect(
      (await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: menuId, lines: [] })).status,
    ).toBe(400);
  });

  // ---------- วงจรจอง/ตัดสต๊อกผูกกับคำสั่งซื้อ ----------

  it("จองตอนยืนยัน + แข่งสต๊อกชิ้นสุดท้ายสำเร็จรายเดียว + ยกเลิกคืนยอดจอง", async () => {
    const rice = await createIngredient(owner, { name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 100 });
    let token = await csrfToken(owner);
    await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: rice, qty: 10 }] });

    const guest = request.agent(app);
    token = await csrfToken(guest);
    const first = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 6 }] }));
    expect(first.status).toBe(201);
    expect(first.body.order.stockReserved).toBe(true);
    expect(first.body.order.estimatedCost).toBe(3);

    // พร้อมขายเหลือ 40 กรัม (พอ 4 จาน) — สั่ง 5 จานต้อง 409 และไม่สร้างคำสั่งซื้อ
    const before = (await owner.get("/api/orders?limit=200")).body.orders as unknown[];
    token = await csrfToken(guest);
    const over = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 5 }] }));
    expect(over.status).toBe(409);
    const after = (await owner.get("/api/orders?limit=200")).body.orders as unknown[];
    expect(after).toHaveLength(before.length);

    // แข่งกันสองรายพร้อมกัน (รายละ 4 จาน = 40 กรัม พอรายเดียว) → สำเร็จรายเดียว
    // (agent แยกกัน — คุกกี้ CSRF ของแต่ละรายต้องตรงกับ header ของตัวเอง)
    const guest1 = request.agent(app);
    const guest2 = request.agent(app);
    const t1 = await csrfToken(guest1);
    const t2 = await csrfToken(guest2);
    const [r1, r2] = await Promise.all([
      guest1.post("/api/orders").set("x-csrf-token", t1).send(guestOrder({ items: [{ menuId, quantity: 4 }] })),
      guest2.post("/api/orders").set("x-csrf-token", t2).send(guestOrder({ items: [{ menuId, quantity: 4 }] })),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([201, 409]);

    // ยกเลิกคำสั่งซื้อแรกก่อนเริ่มทำ → คืนยอดจอง (พร้อมขายกลับมา)
    token = await csrfToken(owner);
    const cancelled = await owner
      .patch(`/api/orders/${first.body.order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "cancelled", reason: "ลูกค้าเปลี่ยนใจ" });
    expect(cancelled.status).toBe(200);
    token = await csrfToken(owner);
    const ing = await owner.get(`/api/inventory/ingredients/${rice}`);
    // จองค้างเฉพาะคำสั่งซื้อที่ชนะการแข่ง (40 กรัม)
    expect(ing.body.item.reserved).toBe(40);
    const audits = await owner.get("/api/audit/orders?limit=100");
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("order_stock_reserved");
    expect(actions).toContain("order_stock_released");
  });

  it("ตัดจริงเมื่อเริ่มทำ: kitchen ตัดได้ + เรียกซ้ำเป็น no-op + ไม่มีสูตร/ยกเลิกแล้วตัดไม่ได้", async () => {
    const rice = await createIngredient(owner, { name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 100 });
    let token = await csrfToken(owner);
    await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: rice, qty: 10 }] });

    const guest = request.agent(app);
    token = await csrfToken(guest);
    const created = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 2 }] }));
    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;

    // kitchen ตัดสต๊อกได้ (พนักงานหลังร้านทุกบทบาท)
    let kToken = await csrfToken(kitchen);
    const consumed = await kitchen.post(`/api/orders/${orderId}/consume`).set("x-csrf-token", kToken).send({});
    expect(consumed.status).toBe(200);
    expect(consumed.body.order.stockConsumed).toBe(true);
    expect(consumed.body.deduplicated).toBe(false);

    token = await csrfToken(owner);
    const ing = await owner.get(`/api/inventory/ingredients/${rice}`);
    expect(ing.body.item).toMatchObject({ onHand: 80, reserved: 0 });

    // เรียกซ้ำ → no-op ไม่เขียน ledger/audit ซ้ำ
    kToken = await csrfToken(kitchen);
    const replay = await kitchen.post(`/api/orders/${orderId}/consume`).set("x-csrf-token", kToken).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    const ledger = await owner.get(`/api/inventory/ledger?orderId=${orderId}&limit=50`);
    expect((ledger.body.entries as { op: string }[]).filter((e) => e.op === "consume")).toHaveLength(1);

    // เมนูไม่มีสูตร → ตัดไม่ได้ 409
    token = await csrfToken(guest);
    const noRecipe = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId: drinkId, quantity: 1 }] }));
    expect(noRecipe.status).toBe(201);
    kToken = await csrfToken(kitchen);
    const noStock = await kitchen.post(`/api/orders/${noRecipe.body.order.id}/consume`).set("x-csrf-token", kToken).send({});
    expect(noStock.status).toBe(409);

    // ยกเลิกแล้วตัดไม่ได้ 409; ลูกค้า/Guest ตัดไม่ได้ 401
    token = await csrfToken(owner);
    await owner.patch(`/api/orders/${noRecipe.body.order.id}/status`).set("x-csrf-token", token).send({ status: "cancelled", reason: "ทดสอบ" });
    kToken = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/orders/${noRecipe.body.order.id}/consume`).set("x-csrf-token", kToken).send({})).status).toBe(409);
    const customer = await registerCustomer("คุณลูกค้า", "0891112222");
    const cToken = await csrfToken(customer);
    expect((await customer.post(`/api/orders/${orderId}/consume`).set("x-csrf-token", cToken).send({})).status).toBe(401);
  });

  it("สูตรของตัวเลือกรวมในยอดจองด้วย + ต้นทุนรวมฐานเมนูและตัวเลือก", async () => {
    const rice = await createIngredient(owner, { name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 1000 });
    const egg = await createIngredient(owner, { name: "ไข่ไก่", unit: "ฟอง", latestCost: 4, initialOnHand: 100 });
    let token = await csrfToken(owner);
    await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "menu", targetId: menuId, lines: [{ ingredientId: rice, qty: 100 }] });
    token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${menuId}/option-groups`).set("x-csrf-token", token).send({ name: "ท็อปปิ้ง" });
    token = await csrfToken(owner);
    const opt = await owner
      .post(`/api/menu/option-groups/${group.body.group.id}/options`)
      .set("x-csrf-token", token)
      .send({ name: "เพิ่มไข่", priceDelta: 12 });
    const optionId = opt.body.option.id as string;
    token = await csrfToken(owner);
    await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({ targetType: "option", targetId: optionId, lines: [{ ingredientId: egg, qty: 2 }] });

    const guest = request.agent(app);
    token = await csrfToken(guest);
    const created = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 1, options: [optionId] }] }));
    expect(created.status).toBe(201);
    // ราคาขาย 50+12; ต้นทุน 100*0.05 + 2*4 = 13
    expect(created.body.order.total).toBe(62);
    expect(created.body.order.estimatedCost).toBe(13);
    expect(created.body.order.items[0].estimatedCost).toBe(13);

    token = await csrfToken(owner);
    const riceAfter = await owner.get(`/api/inventory/ingredients/${rice}`);
    const eggAfter = await owner.get(`/api/inventory/ingredients/${egg}`);
    expect(riceAfter.body.item.reserved).toBe(100);
    expect(eggAfter.body.item.reserved).toBe(2);
  });
});
