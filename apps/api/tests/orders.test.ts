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
    items: [{ menuId: "__MENU__", quantity: 2, note: "ไม่ใส่ผัก" }],
    guestName: "คุณมินตรา",
    guestPhone: "0812345678",
    idempotencyKey: randomUUID(),
    ...over,
  };
}

describe("Ticket 05 orders and cart (public HTTP seam)", () => {
  let store: Store;
  let app: Express;
  let menuId: string;
  let drinkId: string;

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
    let token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
    token = await csrfToken(agent);
    void token;
    return agent;
  }

  async function createMenu(agent: Agent, body: Record<string, unknown>): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/menu").set("x-csrf-token", token).send(body);
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    menuId = await createMenu(owner, {
      category: "อาหารจานเดียว",
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    drinkId = await createMenu(owner, {
      category: "เครื่องดื่ม",
      name: "ชาเย็น",
      price: 25,
      kind: "drink",
    });
  });

  it("Guest ยืนยันตะกร้าได้: 201 + เลขคำสั่งซื้อ + snapshot ราคา/ชื่อ + ยอดรวม", async () => {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 2, note: "ไม่ใส่ผัก" }] }));
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBe(false);
    const order = res.body.order;
    expect(order.orderNumber).toMatch(/^ORD-\d{8}-[A-Z0-9]{4}$/);
    expect(order.status).toBe("pending_payment");
    expect(order.channel).toBe("web");
    expect(order.serviceType).toBe("takeaway");
    expect(order.guestName).toBe("คุณมินตรา");
    expect(order.total).toBe(100);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      menuId,
      menuName: "ข้าวผัดป้าอ้อ",
      unitPrice: 50,
      quantity: 2,
      lineTotal: 100,
      note: "ไม่ใส่ผัก",
    });
    const raw = JSON.stringify(res.body);
    for (const secret of ["passwordHash", "password_hash", "token", "secret", "session"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("idempotency: key เดิม + payload เดิมคืนของเดิม (200) ไม่สร้างซ้ำ; payload ต่างกันได้ 409", async () => {
    const agent = request.agent(app);
    const key = randomUUID();
    const body = guestOrder({ items: [{ menuId, quantity: 1 }] });
    let token = await csrfToken(agent);
    const first = await agent.post("/api/orders").set("x-csrf-token", token).send({ ...body, idempotencyKey: key });
    expect(first.status).toBe(201);
    token = await csrfToken(agent);
    const replay = await agent.post("/api/orders").set("x-csrf-token", token).send({ ...body, idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.order.id).toBe(first.body.order.id);
    // key เดิมแต่เปลี่ยนจำนวน → ขัดแย้ง
    token = await csrfToken(agent);
    const conflict = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({ ...body, items: [{ menuId, quantity: 5 }], idempotencyKey: key });
    expect(conflict.status).toBe(409);
  });

  it("validation: ตะกร้าว่าง/จำนวนผิด/หมายเหตุยาว/เบอร์ผิด/ไม่มีชื่อ ถูกปฏิเสธ 400", async () => {
    const agent = request.agent(app);
    const cases: Record<string, unknown>[] = [
      guestOrder({ items: [] }),
      guestOrder({ items: [{ menuId, quantity: 0 }] }),
      guestOrder({ items: [{ menuId, quantity: 21 }] }),
      guestOrder({ items: [{ menuId, quantity: 1, note: "x".repeat(201) }] }),
      guestOrder({ guestName: "  " }),
      guestOrder({ guestPhone: "123" }),
      guestOrder({ serviceType: "delivery" }),
      guestOrder({ idempotencyKey: "not-a-uuid" }),
      guestOrder({ serviceType: "dine_in", scheduledAt: new Date(Date.now() + 3600_000).toISOString() }),
      guestOrder({ serviceType: "preorder" }),
      guestOrder({ serviceType: "preorder", scheduledAt: new Date(Date.now() - 1000).toISOString() }),
    ];
    for (const body of cases) {
      const token = await csrfToken(agent);
      const res = await agent.post("/api/orders").set("x-csrf-token", token).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("เมนูปิดขายหรือ archive แล้วสั่งไม่ได้ (409) และราคา snapshot ไม่เปลี่ยนตามเมนูภายหลัง", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const off = await owner.patch(`/api/menu/${drinkId}`).set("x-csrf-token", token).send({ status: "unavailable" });
    expect(off.status).toBe(200);

    const agent = request.agent(app);
    token = await csrfToken(agent);
    const blocked = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId: drinkId, quantity: 1 }] }));
    expect(blocked.status).toBe(409);

    // สั่งเมนูที่ขายได้ แล้วขึ้นราคา — คำสั่งซื้อเดิมต้องตรึงราคาเก่า
    token = await csrfToken(agent);
    const ok = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 1 }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.order.total).toBe(50);

    token = await csrfToken(owner);
    const repriced = await owner.patch(`/api/menu/${menuId}`).set("x-csrf-token", token).send({ price: 60 });
    expect(repriced.status).toBe(200);

    const reread = await agent.get(`/api/orders/${ok.body.order.id}?phone=0812345678`);
    expect(reread.status).toBe(200);
    expect(reread.body.order.total).toBe(50);
    expect(reread.body.order.items[0].unitPrice).toBe(50);
  });

  it("preorder ต้องมีเวลานัดในอนาคต (30 นาที–7 วัน) และ dine_in/takeaway สร้างได้", async () => {
    const agent = request.agent(app);
    let token = await csrfToken(agent);
    const future = new Date(Date.now() + 2 * 3600_000).toISOString();
    const pre = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ serviceType: "preorder", scheduledAt: future, items: [{ menuId, quantity: 1 }] }));
    expect(pre.status).toBe(201);
    expect(pre.body.order.serviceType).toBe("preorder");
    expect(new Date(pre.body.order.scheduledAt as string).getTime()).toBeGreaterThan(Date.now());

    token = await csrfToken(agent);
    const dine = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ serviceType: "dine_in", items: [{ menuId, quantity: 1 }] }));
    expect(dine.status).toBe(201);
    expect(dine.body.order.scheduledAt).toBeNull();
  });

  it("สมาชิกสั่งและดูเฉพาะของตนเอง (/mine) — ไม่เห็นของผู้อื่น", async () => {
    const a = await registerCustomer("ลูกค้า เอ", "0811111111");
    const b = await registerCustomer("ลูกค้า บี", "0822222222");
    let token = await csrfToken(a);
    const created = await a
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({ serviceType: "takeaway", items: [{ menuId, quantity: 1 }], idempotencyKey: randomUUID() });
    expect(created.status).toBe(201);
    expect(created.body.order.customerId).toBeTruthy();
    expect(created.body.order.guestName).toBeNull();

    const mineA = await a.get("/api/orders/mine");
    expect(mineA.status).toBe(200);
    expect(mineA.body.orders).toHaveLength(1);

    const mineB = await b.get("/api/orders/mine");
    expect(mineB.status).toBe(200);
    expect(mineB.body.orders).toHaveLength(0);

    // B เปิดดูของ A ตรง ๆ ถูกปฏิเสธ
    const cross = await b.get(`/api/orders/${created.body.order.id}`);
    expect(cross.status).toBe(403);

    // ไม่ login ดู /mine ไม่ได้
    const anon = await request(app).get("/api/orders/mine");
    expect(anon.status).toBe(401);
  });

  it("Guest lookup ด้วยเลข + เบอร์: ตรงเห็น, เบอร์ผิดได้ 404", async () => {
    const agent = request.agent(app);
    let token = await csrfToken(agent);
    const created = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 1 }] }));
    expect(created.status).toBe(201);
    const number = created.body.order.orderNumber as string;

    const found = await agent.get(`/api/orders/lookup?number=${encodeURIComponent(number)}&phone=0812345678`);
    expect(found.status).toBe(200);
    expect(found.body.order.id).toBe(created.body.order.id);

    const wrong = await agent.get(`/api/orders/lookup?number=${encodeURIComponent(number)}&phone=0899999999`);
    expect(wrong.status).toBe(404);
  });

  it("kitchen/drink ดูหรือจัดการคำสั่งซื้อไม่ได้ (403) ส่วน admin/owner ได้", async () => {
    const agent = request.agent(app);
    let token = await csrfToken(agent);
    const created = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 1 }] }));
    const id = created.body.order.id as string;

    const kitchen = await loginAs("kitchen1", "Kitchen123");
    expect((await kitchen.get("/api/orders")).status).toBe(403);
    expect((await kitchen.get(`/api/orders/${id}`)).status).toBe(403);
    token = await csrfToken(kitchen);
    expect(
      (await kitchen.patch(`/api/orders/${id}/status`).set("x-csrf-token", token).send({ status: "completed", reason: "x" })).status,
    ).toBe(403);
    expect((await kitchen.get("/api/audit/orders")).status).toBe(403);

    const admin = await loginAs("admin1", "AdminPass123");
    const list = await admin.get("/api/orders");
    expect(list.status).toBe(200);
    expect(list.body.orders.length).toBeGreaterThanOrEqual(1);
    const search = await admin.get(`/api/orders?q=${encodeURIComponent(created.body.order.orderNumber)}`);
    expect(search.body.orders).toHaveLength(1);
  });

  it("Admin เปลี่ยนสถานะพร้อมเหตุผล + audit ก่อน/หลัง; ปิดงานแล้วเปลี่ยนอีกไม่ได้", async () => {
    const agent = request.agent(app);
    let token = await csrfToken(agent);
    const created = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId, quantity: 1 }] }));
    const id = created.body.order.id as string;

    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    const noReason = await admin.patch(`/api/orders/${id}/status`).set("x-csrf-token", token).send({ status: "completed" });
    expect(noReason.status).toBe(400);

    token = await csrfToken(admin);
    const done = await admin
      .patch(`/api/orders/${id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ลูกค้าชำระครบแล้ว ปิดงาน" });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe("completed");

    const audits = await admin.get("/api/audit/orders");
    expect(audits.status).toBe(200);
    const changed = (audits.body.items as { action: string; detail: string }[]).find((a) => a.action === "order_status_changed");
    expect(changed).toBeTruthy();
    expect(changed!.detail).toContain("pending_payment → completed");
    expect(changed!.detail).toContain("ลูกค้าชำระครบแล้ว ปิดงาน");
    const made = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(made).toContain("order_created");

    // ปิดงานแล้วเปลี่ยนอีกไม่ได้
    token = await csrfToken(admin);
    const again = await admin
      .patch(`/api/orders/${id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "cancelled", reason: "เปลี่ยนใจ" });
    expect(again.status).toBe(409);
  });

  it("audit ล้มเหลว → คำสั่งซื้อถูก rollback ทั้งหมด (ไม่มี partial order)", async () => {
    const failing = createMemoryStore({
      failAudit: (input) => input.action === "order_created",
    });
    const failingApp = createApp({ store: failing, loginRateMax: 1000, customerRateMax: 1000 });
    // seed ผ่าน store ตรง: สร้างเมนูใน store (audit เมนูไม่ถูก block — block เฉพาะ order_created)
    const menu = await failing.createMenuItem(
      { category: "อาหาร", name: "ข้าว", price: 10, kind: "food" },
      {},
    );
    const before = await failing.listOrders({ limit: 50 });
    const agent = request.agent(failingApp);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send(guestOrder({ items: [{ menuId: menu.id, quantity: 1 }] }));
    expect(res.status).toBe(500);
    expect(await failing.listOrders({ limit: 50 })).toHaveLength(before.length);
  });
});
