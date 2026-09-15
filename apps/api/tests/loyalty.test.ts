import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

describe("Ticket 10 loyalty points and rewards (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let foodId: string;
  let drinkId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  // CSRF double-submit: ต้องดึงโทเค็น (GET) ให้เสร็จก่อนสร้าง POST request
  // เสมอ — ห้าม await csrfToken() ข้างใน .set() เพราะ supertest ผูกคุกกี้
  // ณ ตอนสร้าง request ทำให้ส่งคุกกี้ csrf เก่า + header ใหม่แล้วได้ 403
  async function postCsrf(agent: Agent, url: string, body: unknown) {
    const token = await csrfToken(agent);
    return agent.post(url).set("x-csrf-token", token).send(body as Record<string, unknown>);
  }

  async function loginAs(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function registerCustomer(name: string, phone: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/customers/register").set("x-csrf-token", token).send({ name, phone, password });
    expect(res.status).toBe(201);
    return agent;
  }

  async function createMenu(agent: Agent, category: string, name: string, kind: "food" | "drink"): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/menu").set("x-csrf-token", token).send({
      category,
      name,
      price: kind === "food" ? 50 : 30,
      kind,
    });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function memberOrder(agent: Agent, items: { menuId: string; quantity: number }[]): Promise<{ id: string; total: number }> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items,
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    return { id: res.body.order.id as string, total: res.body.order.total as number };
  }

  async function guestOrder(guestPhone: string, items: { menuId: string; quantity: number }[]): Promise<{ id: string; total: number }> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items,
      guestName: "คุณแขก",
      guestPhone,
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    return { id: res.body.order.id as string, total: res.body.order.total as number };
  }

  async function payCash(payer: Agent, orderId: string, total: number, phone?: string): Promise<{ paymentId: string }> {
    const token = await csrfToken(payer);
    const created = await payer.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: total,
      ...(phone ? { phone } : {}),
    });
    expect(created.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    const confirmToken = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", confirmToken)
      .send({ receivedAmount: total, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    return { paymentId: created.body.payment.id as string };
  }

  async function deliverAllDrink(drinkAgent: Agent, orderId: string): Promise<void> {
    const listed = await drinkAgent.get(`/api/queue?station=drink&orderId=${orderId}&limit=50`);
    expect(listed.status).toBe(200);
    expect(listed.body.jobs.length).toBeGreaterThan(0);
    for (const job of listed.body.jobs as { id: string; quantity: number }[]) {
      let token = await csrfToken(drinkAgent);
      expect((await drinkAgent.post(`/api/queue/${job.id}/claim`).set("x-csrf-token", token).send({})).status).toBe(200);
      token = await csrfToken(drinkAgent);
      expect((await drinkAgent.post(`/api/queue/${job.id}/start`).set("x-csrf-token", token).send({})).status).toBe(200);
      token = await csrfToken(drinkAgent);
      expect(
        (await drinkAgent.post(`/api/queue/${job.id}/ready`).set("x-csrf-token", token).send({ qty: job.quantity })).status,
      ).toBe(200);
      token = await csrfToken(drinkAgent);
      expect(
        (await drinkAgent.post(`/api/queue/${job.id}/deliver`).set("x-csrf-token", token).send({ qty: job.quantity })).status,
      ).toBe(200);
    }
  }

  async function balanceOf(customer: Agent): Promise<number> {
    const res = await customer.get("/api/loyalty/balance");
    expect(res.status).toBe(200);
    return res.body.balance as number;
  }

  async function createReward(owner: Agent, patch: Record<string, unknown> = {}): Promise<string> {
    const token = await csrfToken(owner);
    const res = await owner.post("/api/rewards").set("x-csrf-token", token).send({
      name: "ชาเย็นฟรี 1 แก้ว",
      menuId: drinkId,
      pointsCost: 2,
      ...patch,
    });
    expect(res.status).toBe(201);
    return res.body.reward.id as string;
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("KitchenPass123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass123", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    foodId = await createMenu(owner, "อาหารจานเดียว", "ข้าวผัดป้าอ้อ", "food");
    drinkId = await createMenu(owner, "เครื่องดื่ม", "ชาเย็นป้าอ้อ", "drink");
  });

  it("สะสม 1 แต้มต่อเครื่องดื่ม 1 หน่วยเฉพาะ paid+delivered และเรียกซ้ำเป็น no-op", async () => {
    const customer = await registerCustomer("ลูกค้าเอ", "0811111111", "Customer11");
    const drink = await loginAs("drink1", "DrinkPass123");
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(customer, order.id, order.total);

    // ยังไม่ส่งมอบ = ยังไม่ได้คะแนน
    expect(await balanceOf(customer)).toBe(0);

    await deliverAllDrink(drink, order.id);
    expect(await balanceOf(customer)).toBe(2);

    const ledger = await customer.get("/api/loyalty/ledger?limit=50");
    expect(ledger.status).toBe(200);
    expect(ledger.body.balance).toBe(2);
    const earnEntries = (ledger.body.entries as { source: string; points: number }[]).filter((e) => e.source === "order");
    expect(earnEntries.reduce((n, e) => n + e.points, 0)).toBe(2);

    // เรียกซ้ำเป็น no-op: ไม่เขียน ledger/audit ซ้ำ
    const auditBefore = (await (await loginAs("owner", "OwnerPass123")).get("/api/audit/loyalty?limit=200")).body.items.length;
    const again = await store.earnPointsForOrder(order.id, { actorId: "test" }, new Date());
    expect(again).toMatchObject({ earned: 0, deduplicated: true });
    expect(await balanceOf(customer)).toBe(2);
    const ledgerAfter = await customer.get("/api/loyalty/ledger?limit=50");
    expect((ledgerAfter.body.entries as unknown[]).length).toBe(ledger.body.entries.length);
    const auditAfter = (await (await loginAs("owner", "OwnerPass123")).get("/api/audit/loyalty?limit=200")).body.items.length;
    expect(auditAfter).toBe(auditBefore);
  });

  it("ปิดงาน completed สะสมเต็มจำนวนโดยไม่ต้องส่งมอบ ส่วนอาหารไม่ได้คะแนน", async () => {
    const customer = await registerCustomer("ลูกค้าบี", "0822222222", "Customer11");
    const order = await memberOrder(customer, [
      { menuId: drinkId, quantity: 1 },
      { menuId: foodId, quantity: 3 },
    ]);
    await payCash(customer, order.id, order.total);
    expect(await balanceOf(customer)).toBe(0);

    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const closed = await owner
      .patch(`/api/orders/${order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ลูกค้ารับของครบหน้าร้าน" });
    expect(closed.status).toBe(200);
    // อาหาร 3 จานไม่ได้คะแนน ได้เฉพาะเครื่องดื่ม 1 หน่วย
    expect(await balanceOf(customer)).toBe(1);
  });

  it("รางวัลมี quota/ช่วงเวลา/สถานะ + หยุดรับเมื่อสิทธิ์หมด ช่วงเวลาผ่าน หรือปิดขาย", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const customer = await registerCustomer("ลูกค้าซี", "0833333333", "Customer11");
    const drink = await loginAs("drink1", "DrinkPass123");

    // แต้มไม่พอถูกปฏิเสธ
    const rewardId = await createReward(owner, { quotaTotal: 1 });
    const poor = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(poor.status).toBe(409);

    // สะสม 2 แต้มแล้วแลกได้
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(customer, order.id, order.total);
    await deliverAllDrink(drink, order.id);
    expect(await balanceOf(customer)).toBe(2);
    const ok = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(ok.status).toBe(201);
    expect(ok.body.redemption.status).toBe("reserved");

    // quota หมดแล้ว รายที่สองถูกปฏิเสธ
    const other = await registerCustomer("ลูกค้าดี", "0844444444", "Customer11");
    const order2 = await memberOrder(other, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(other, order2.id, order2.total);
    await deliverAllDrink(drink, order2.id);
    const full = await postCsrf(other, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(full.status).toBe(409);

    // หมดช่วงเวลา / ปิดขาย ถูกปฏิเสธ
    const expiredId = await createReward(owner, { name: "รางวัลหมดเขต", endsAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await postCsrf(other, `/api/rewards/${expiredId}/redeem`, { idempotencyKey: randomUUID() });
    expect(expired.status).toBe(409);
    const closedId = await createReward(owner, { name: "รางวัลปิดขาย", isActive: false });
    const closed = await postCsrf(other, `/api/rewards/${closedId}/redeem`, { idempotencyKey: randomUUID() });
    expect(closed.status).toBe(409);
  });

  it("สต๊อกพร้อมขายไม่พอแลกไม่ได้ (กันขายเกินตั้งแต่ reserve)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    // เมนูแยกสำหรับเคสนี้ + สูตรที่วัตถุดิบเป็น 0
    const limitedId = await createMenu(owner, "เครื่องดื่ม", "โกโก้จำกัด", "drink");
    let token = await csrfToken(owner);
    const ing = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({ name: "ผงโกโก้", unit: "กรัม" });
    expect(ing.status).toBe(201);
    token = await csrfToken(owner);
    const recipe = await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({
      targetType: "menu",
      targetId: limitedId,
      lines: [{ ingredientId: ing.body.item.id, qty: 10 }],
    });
    expect(recipe.status).toBe(201);
    token = await csrfToken(owner);
    const reward = await owner.post("/api/rewards").set("x-csrf-token", token).send({
      name: "โกโก้ฟรี",
      menuId: limitedId,
      pointsCost: 1,
    });
    expect(reward.status).toBe(201);

    const customer = await registerCustomer("ลูกค้าอี", "0855555555", "Customer11");
    const drink = await loginAs("drink1", "DrinkPass123");
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 1 }]);
    await payCash(customer, order.id, order.total);
    await deliverAllDrink(drink, order.id);
    const res = await postCsrf(customer, `/api/rewards/${reward.body.reward.id}/redeem`, { idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
  });

  it("reserve→consume/release idempotent และ consume สร้างงานคิวเครื่องดื่มราคา 0 ครั้งเดียว", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const drink = await loginAs("drink1", "DrinkPass123");
    const customer = await registerCustomer("ลูกค้าเอฟ", "0866666666", "Customer11");
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(customer, order.id, order.total);
    await deliverAllDrink(drink, order.id);
    const rewardId = await createReward(owner);

    const key = randomUUID();
    const first = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: key });
    expect(first.status).toBe(201);
    const again = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: key });
    expect(again.status).toBe(200);
    expect(again.body.deduplicated).toBe(true);
    expect(again.body.redemption.id).toBe(first.body.redemption.id);

    // key เดิม + payload ต่างกัน (รางวัลอื่น) = 409
    const otherReward = await createReward(owner, { name: "รางวัลที่สอง" });
    const conflict = await postCsrf(customer, `/api/rewards/${otherReward}/redeem`, { idempotencyKey: key });
    expect(conflict.status).toBe(409);

    // consume สร้างงานคิวเครื่องดื่มราคา 0 ครั้งเดียว (เรียกซ้ำคืนงานเดิม)
    const redemptionId = first.body.redemption.id as string;
    const consumed = await postCsrf(drink, `/api/redemptions/${redemptionId}/consume`, {});
    expect(consumed.status).toBe(200);
    expect(consumed.body.redemption.status).toBe("consumed");
    expect(consumed.body.job).toMatchObject({ station: "drink", quantity: 1, orderId: null, paymentId: null });
    expect(consumed.body.job.rewardRedemptionId ?? consumed.body.redemption.queueJobId).toBeTruthy();
    const consumedAgain = await postCsrf(drink, `/api/redemptions/${redemptionId}/consume`, {});
    expect(consumedAgain.status).toBe(200);
    expect(consumedAgain.body.job.id).toBe(consumed.body.job.id);

    // consume แล้ว release ไม่ได้ (ปิดงานแล้ว)
    const releaseClosed = await postCsrf(drink, `/api/redemptions/${redemptionId}/release`, { reason: "ลองคืนหลังรับแล้ว" });
    expect(releaseClosed.status).toBe(409);

    // งานคิวรางวัลไม่สร้างคะแนนซ้ำ: ledger มีแค่ earn 2 + consume −2
    const ledger = await customer.get("/api/loyalty/ledger?limit=50");
    const points = (ledger.body.entries as { points: number; source: string }[]).reduce((n, e) => n + e.points, 0);
    expect(points).toBe(0);
    expect(await balanceOf(customer)).toBe(0);

    // แต้มเหลือ 0 แล้ว (ใช้ไปกับรางวัลแรก) → แลกซ้ำถูกปฏิเสธคะแนนไม่พอ
    const second = await postCsrf(customer, `/api/rewards/${otherReward}/redeem`, { idempotencyKey: randomUUID() });
    expect(second.status).toBe(409);
  });

  it("release คืนคะแนนให้แลกใหม่ได้ และเรียกซ้ำเป็น no-op", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const drink = await loginAs("drink1", "DrinkPass123");
    const customer = await registerCustomer("ลูกค้าจี", "0877777777", "Customer11");
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(customer, order.id, order.total);
    await deliverAllDrink(drink, order.id);
    const rewardId = await createReward(owner);

    const reserved = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(reserved.status).toBe(201);

    const released = await postCsrf(drink, `/api/redemptions/${reserved.body.redemption.id}/release`, { reason: "วัตถุดิบหมดชั่วคราว" });
    expect(released.status).toBe(200);
    expect(released.body.redemption.status).toBe("released");
    expect(released.body.deduplicated).toBe(false);

    const releasedAgain = await postCsrf(drink, `/api/redemptions/${reserved.body.redemption.id}/release`, { reason: "วัตถุดิบหมดชั่วคราว" });
    expect(releasedAgain.status).toBe(200);
    expect(releasedAgain.body.deduplicated).toBe(true);

    // คะแนนกันไว้ถูกคืน → แลกใหม่ได้ (แต้มยังครบ 2)
    expect(await balanceOf(customer)).toBe(2);
    const retry = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(retry.status).toBe(201);
  });

  it("แลกพร้อมกันไม่ใช้คะแนน/quota เกิน (หนึ่งสิทธิ์ได้ผู้เดียว)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const drink = await loginAs("drink1", "DrinkPass123");
    const rewardId = await createReward(owner, { quotaTotal: 1 });
    const agents: Agent[] = [];
    for (const [name, phone] of [["คู่แข่งหนึ่ง", "0888888811"], ["คู่แข่งสอง", "0888888822"]] as const) {
      const c = await registerCustomer(name, phone, "Customer11");
      const order = await memberOrder(c, [{ menuId: drinkId, quantity: 2 }]);
      await payCash(c, order.id, order.total);
      await deliverAllDrink(drink, order.id);
      agents.push(c);
    }
    const results = await Promise.all(
      agents.map(async (c) => postCsrf(c, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("QR Walk-in ใช้ครั้งเดียว อายุ 10 นาที (fake clock) และใช้ซ้ำถูกปฏิเสธ", async () => {
    let now = new Date("2026-09-15T08:00:00.000Z");
    const clockStore = createMemoryStore();
    const clockApp = createApp({ store: clockStore, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(now) });
    async function staffLoginClock(username: string, password: string): Promise<Agent> {
      const agent = request.agent(clockApp);
      const csrf = await agent.get("/api/auth/csrf");
      expect(csrf.status).toBe(200);
      const res = await agent.post("/api/auth/login").set("x-csrf-token", csrf.body.csrfToken as string).send({ username, password });
      expect(res.status).toBe(200);
      return agent;
    }
    await clockStore.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await clockStore.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass123", 10), roles: ["drink"] });
    const drink = await staffLoginClock("drink1", "DrinkPass123");
    let csrf = await drink.get("/api/auth/csrf");
    const issued = await drink.post("/api/loyalty/walkin/issue").set("x-csrf-token", csrf.body.csrfToken as string).send({});
    expect(issued.status).toBe(201);
    expect(issued.body.token.code as string).toMatch(/^WALKIN-[A-Z0-9]{4,32}$/);

    // ลูกค้าสแกนผ่าน app หลักไม่ได้ (store คนละตัว) — สมัครใน clockApp แทน
    async function registerClock(name: string, phone: string): Promise<Agent> {
      const agent = request.agent(clockApp);
      const t = await agent.get("/api/auth/csrf");
      const res = await agent.post("/api/customers/register").set("x-csrf-token", t.body.csrfToken as string).send({ name, phone, password: "Customer11" });
      expect(res.status).toBe(201);
      return agent;
    }
    const customer = await registerClock("ลูกค้าเอช", "0899999911");
    csrf = await customer.get("/api/auth/csrf");
    const scanned = await customer.post("/api/loyalty/walkin/scan").set("x-csrf-token", csrf.body.csrfToken as string).send({ code: issued.body.token.code });
    expect(scanned.status).toBe(200);
    expect(scanned.body.earned).toBe(1);
    const bal = await customer.get("/api/loyalty/balance");
    expect(bal.body.balance).toBe(1);

    // ใช้ซ้ำถูกปฏิเสธ (แม้เป็นลูกค้าอื่น)
    const other = await registerClock("ลูกค้าไอ", "0899999922");
    csrf = await other.get("/api/auth/csrf");
    const reuse = await other.post("/api/loyalty/walkin/scan").set("x-csrf-token", csrf.body.csrfToken as string).send({ code: issued.body.token.code });
    expect(reuse.status).toBe(409);

    // QR ใหม่ออกตอน 08:00 สแกนตอน 08:11 = หมดอายุ
    csrf = await drink.get("/api/auth/csrf");
    const issued2 = await drink.post("/api/loyalty/walkin/issue").set("x-csrf-token", csrf.body.csrfToken as string).send({});
    expect(issued2.status).toBe(201);
    now = new Date("2026-09-15T08:11:00.000Z");
    csrf = await customer.get("/api/auth/csrf");
    const expired = await customer.post("/api/loyalty/walkin/scan").set("x-csrf-token", csrf.body.csrfToken as string).send({ code: issued2.body.token.code });
    expect(expired.status).toBe(409);
  });

  it("Guest ผูกคำสั่งซื้อเข้าบัญชีภายใน 24 ชม. เบอร์เดียวกัน เกินเวลาหรือเบอร์ไม่ตรงถูกปฏิเสธ", async () => {
    let now = new Date("2026-09-15T08:00:00.000Z");
    const clockStore = createMemoryStore();
    const clockApp = createApp({ store: clockStore, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(now) });
    const ownerAgent = request.agent(clockApp);
    let t = await ownerAgent.get("/api/auth/csrf");
    await clockStore.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await clockStore.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass123", 10), roles: ["drink"] });
    const loginRes = await ownerAgent.post("/api/auth/login").set("x-csrf-token", t.body.csrfToken as string).send({ username: "owner", password: "OwnerPass123" });
    expect(loginRes.status).toBe(200);
    t = await ownerAgent.get("/api/auth/csrf");
    const menuRes = await ownerAgent.post("/api/menu").set("x-csrf-token", t.body.csrfToken as string).send({ category: "เครื่องดื่ม", name: "ชาเย็น", price: 30, kind: "drink" });
    expect(menuRes.status).toBe(201);
    const menuId = menuRes.body.item.id as string;

    // Guest สั่ง + จ่าย + ส่งมอบครบ (2 แก้ว)
    const guest = request.agent(clockApp);
    t = await guest.get("/api/auth/csrf");
    const orderRes = await guest.post("/api/orders").set("x-csrf-token", t.body.csrfToken as string).send({
      serviceType: "takeaway",
      items: [{ menuId, quantity: 2 }],
      guestName: "คุณแขก",
      guestPhone: "0812345678",
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.id as string;
    const total = orderRes.body.order.total as number;
    t = await guest.get("/api/auth/csrf");
    const payRes = await guest.post("/api/payments").set("x-csrf-token", t.body.csrfToken as string).send({
      orderId,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: total,
      phone: "0812345678",
    });
    expect(payRes.status).toBe(201);
    t = await ownerAgent.get("/api/auth/csrf");
    const confirm = await ownerAgent.post(`/api/payments/${payRes.body.payment.id}/confirm-cash`).set("x-csrf-token", t.body.csrfToken as string).send({ receivedAmount: total, reason: "รับเงินหน้าร้าน" });
    expect(confirm.status).toBe(200);
    const drinkAgent = request.agent(clockApp);
    t = await drinkAgent.get("/api/auth/csrf");
    const drinkLogin = await drinkAgent.post("/api/auth/login").set("x-csrf-token", t.body.csrfToken as string).send({ username: "drink1", password: "DrinkPass123" });
    expect(drinkLogin.status).toBe(200);
    const jobs = await drinkAgent.get(`/api/queue?station=drink&orderId=${orderId}&limit=50`);
    for (const job of jobs.body.jobs as { id: string; quantity: number }[]) {
      for (const [path, body] of [["claim", {}], ["start", {}], ["ready", { qty: job.quantity }], ["deliver", { qty: job.quantity }]] as const) {
        t = await drinkAgent.get("/api/auth/csrf");
        const r = await drinkAgent.post(`/api/queue/${job.id}/${path}`).set("x-csrf-token", t.body.csrfToken as string).send(body);
        expect(r.status).toBe(200);
      }
    }

    // สมัครลูกค้าเบอร์เดียวกันแล้วผูก → ได้คะแนนที่ยังไม่มีผู้รับ
    const customer = request.agent(clockApp);
    t = await customer.get("/api/auth/csrf");
    const reg = await customer.post("/api/customers/register").set("x-csrf-token", t.body.csrfToken as string).send({ name: "อดีตแขก", phone: "0812345678", password: "Customer11" });
    expect(reg.status).toBe(201);
    t = await customer.get("/api/auth/csrf");
    const linked = await customer.post("/api/loyalty/guest/link").set("x-csrf-token", t.body.csrfToken as string).send({ orderId });
    expect(linked.status).toBe(200);
    expect(linked.body.earned).toBe(2);
    const bal = await customer.get("/api/loyalty/balance");
    expect(bal.body.balance).toBe(2);

    // ผูกซ้ำถูกปฏิเสธ
    t = await customer.get("/api/auth/csrf");
    const dup = await customer.post("/api/loyalty/guest/link").set("x-csrf-token", t.body.csrfToken as string).send({ orderId });
    expect(dup.status).toBe(409);

    // เบอร์ไม่ตรงถูกปฏิเสธ
    const stranger = request.agent(clockApp);
    t = await stranger.get("/api/auth/csrf");
    const regOther = await stranger.post("/api/customers/register").set("x-csrf-token", t.body.csrfToken as string).send({ name: "คนอื่น", phone: "0800000001", password: "Customer11" });
    expect(regOther.status).toBe(201);
    const guest2 = request.agent(clockApp);
    t = await guest2.get("/api/auth/csrf");
    const order2 = await guest2.post("/api/orders").set("x-csrf-token", t.body.csrfToken as string).send({
      serviceType: "takeaway",
      items: [{ menuId, quantity: 1 }],
      guestName: "แขกสอง",
      guestPhone: "0800000002",
      idempotencyKey: randomUUID(),
    });
    expect(order2.status).toBe(201);
    t = await stranger.get("/api/auth/csrf");
    const mismatch = await stranger.post("/api/loyalty/guest/link").set("x-csrf-token", t.body.csrfToken as string).send({ orderId: order2.body.order.id });
    expect(mismatch.status).toBe(409);

    // เกิน 24 ชม. ถูกปฏิเสธ
    now = new Date("2026-09-16T09:30:00.000Z");
    const lateGuest = request.agent(clockApp);
    t = await lateGuest.get("/api/auth/csrf");
    const lateOrder = await lateGuest.post("/api/orders").set("x-csrf-token", t.body.csrfToken as string).send({
      serviceType: "takeaway",
      items: [{ menuId, quantity: 1 }],
      guestName: "แขกสาย",
      guestPhone: "0800000001",
      idempotencyKey: randomUUID(),
    });
    expect(lateOrder.status).toBe(201);
    now = new Date("2026-09-17T10:31:00.000Z");
    t = await stranger.get("/api/auth/csrf");
    const late = await stranger.post("/api/loyalty/guest/link").set("x-csrf-token", t.body.csrfToken as string).send({ orderId: lateOrder.body.order.id });
    expect(late.status).toBe(409);
  });

  it("รวมบัญชี atomic + กันย้ายซ้ำ และคืนเงินย้อนคะแนนพร้อมกัน double-reversal", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const drink = await loginAs("drink1", "DrinkPass123");
    const source = await registerCustomer("ต้นทาง", "0810101010", "Customer11");
    const target = await registerCustomer("ปลายทาง", "0820202020", "Customer11");
    for (const [c, qty] of [[source, 2], [target, 1]] as const) {
      const order = await memberOrder(c, [{ menuId: drinkId, quantity: qty }]);
      await payCash(c, order.id, order.total);
      await deliverAllDrink(drink, order.id);
    }
    expect(await balanceOf(source)).toBe(2);
    expect(await balanceOf(target)).toBe(1);

    const sourceId = (await source.get("/api/customers/me")).body.customer.id as string;
    const targetId = (await target.get("/api/customers/me")).body.customer.id as string;
    const merged = await postCsrf(owner, "/api/loyalty/merge", { sourceCustomerId: sourceId, targetCustomerId: targetId });
    expect(merged.status).toBe(200);
    expect(merged.body.movedPoints).toBe(2);
    expect(merged.body.deduplicated).toBe(false);
    expect(await balanceOf(target)).toBe(3);

    // บัญชีต้นทางถูกปิด
    const sourceMe = await source.get("/api/customers/me");
    expect(sourceMe.status).toBe(401);

    // ย้ายซ้ำเป็น no-op
    const mergedAgain = await postCsrf(owner, "/api/loyalty/merge", { sourceCustomerId: sourceId, targetCustomerId: targetId });
    expect(mergedAgain.status).toBe(200);
    expect(mergedAgain.body.deduplicated).toBe(true);
    expect(await balanceOf(target)).toBe(3);

    // คืนเงินย้อนคะแนน (รักษาประวัติ — ledger โตขึ้น ไม่มีการลบ)
    const refundable = await memberOrder(target, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(target, refundable.id, refundable.total);
    await deliverAllDrink(drink, refundable.id);
    expect(await balanceOf(target)).toBe(5);
    const ledgerBefore = (await target.get("/api/loyalty/ledger?limit=100")).body.entries as unknown[];
    const payment = await store.getOrderPayment(refundable.id);
    const refunded = await postCsrf(owner, `/api/payments/${payment!.id}/refund`, { reason: "ลูกค้าเปลี่ยนใจก่อนเริ่มทำ" });
    expect(refunded.status).toBe(200);
    expect(await balanceOf(target)).toBe(3);
    const ledgerAfter = (await target.get("/api/loyalty/ledger?limit=100")).body.entries as { source: string; points: number }[];
    expect(ledgerAfter.length).toBeGreaterThan(ledgerBefore.length);
    expect(ledgerAfter.filter((e) => e.source === "refund").reduce((n, e) => n + e.points, 0)).toBe(-2);

    // reverse ซ้ำด้วย refund เดิมเป็น no-op (กัน double-reversal)
    const reversed = await postCsrf(owner, "/api/loyalty/reverse", { orderId: refundable.id, refundId: refunded.body.refund.id });
    expect(reversed.status).toBe(200);
    expect(reversed.body.deduplicated).toBe(true);
    expect(await balanceOf(target)).toBe(3);
  });

  it("role isolation: kitchen/guest/ลูกค้ารายอื่นถูกปฏิเสธ, audit มีเฉพาะ Owner/Admin", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    const drink = await loginAs("drink1", "DrinkPass123");
    const customer = await registerCustomer("ลูกค้าเค", "0830303030", "Customer11");
    const other = await registerCustomer("ลูกค้าล", "0840404040", "Customer11");

    // Guest (ไม่มี session) ดูยอดไม่ได้
    expect((await request(app).get("/api/loyalty/balance")).status).toBe(401);
    // ลูกค้าใช้ endpoint พนักงานไม่ได้
    expect((await postCsrf(customer, "/api/rewards", {})).status).toBe(401);
    // kitchen สร้างรางวัล/ออก QR/ดูคิวแลกไม่ได้
    expect((await postCsrf(kitchen, "/api/rewards", {})).status).toBe(403);
    expect((await postCsrf(kitchen, "/api/loyalty/walkin/issue", {})).status).toBe(403);
    expect((await kitchen.get("/api/redemptions/pending")).status).toBe(403);
    // drink ออก QR + ดูคิวแลกได้ แต่จัดการรางวัลไม่ได้
    expect((await postCsrf(drink, "/api/rewards", {})).status).toBe(403);
    expect((await drink.get("/api/redemptions/pending")).status).toBe(200);

    // เตรียม redemption ของ customer แล้วให้ other มาปล่อย → 403, kitchen มารับ → 403
    const order = await memberOrder(customer, [{ menuId: drinkId, quantity: 2 }]);
    await payCash(customer, order.id, order.total);
    await deliverAllDrink(drink, order.id);
    const rewardId = await createReward(owner);
    const reserved = await postCsrf(customer, `/api/rewards/${rewardId}/redeem`, { idempotencyKey: randomUUID() });
    expect(reserved.status).toBe(201);
    const redemptionId = reserved.body.redemption.id as string;
    expect((await postCsrf(other, `/api/redemptions/${redemptionId}/release`, { reason: "แอบปล่อยของคนอื่น" })).status).toBe(403);
    expect((await postCsrf(kitchen, `/api/redemptions/${redemptionId}/consume`, {})).status).toBe(403);

    // audit: owner/admin ดูได้, drink/kitchen/ลูกค้าดูไม่ได้
    expect((await owner.get("/api/audit/loyalty?limit=50")).status).toBe(200);
    expect(((await owner.get("/api/audit/loyalty?limit=50")).body.items as { action: string }[]).some((i) => i.action.startsWith("loyalty_"))).toBe(true);
    const admin = await loginAs("admin1", "AdminPass123");
    expect((await admin.get("/api/audit/loyalty?limit=50")).status).toBe(200);
    expect((await drink.get("/api/audit/loyalty?limit=50")).status).toBe(403);
    expect((await kitchen.get("/api/audit/loyalty?limit=50")).status).toBe(403);
    expect((await customer.get("/api/audit/loyalty?limit=50")).status).toBe(401);

    // responses ไม่มีข้อมูลลับรั่ว
    const bodies = [reserved.body, (await owner.get("/api/audit/loyalty?limit=5")).body];
    for (const b of bodies) {
      const raw = JSON.stringify(b);
      for (const secret of ["passwordHash", "password_hash", "codeVerifier", "token", "secret"]) {
        if (secret === "token") continue; // WalkinQrToken.code เป็น payload ที่ตั้งใจเปิดเผย
        expect(raw).not.toContain(secret);
      }
    }
  });

  it("Guest ผูกคำสั่งซื้อผ่าน HTTP หลัก: สั่งเป็น Guest แล้วสมัครสมาชิกเบอร์เดียวกันรับคะแนน", async () => {
    const drink = await loginAs("drink1", "DrinkPass123");
    const guestPhone = "0891234567";
    const order = await guestOrder(guestPhone, [{ menuId: drinkId, quantity: 1 }]);
    await payCash(request.agent(app), order.id, order.total, guestPhone);
    await deliverAllDrink(drink, order.id);

    const customer = await registerCustomer("อดีตแขกสอง", guestPhone, "Customer11");
    const linked = await postCsrf(customer, "/api/loyalty/guest/link", { orderId: order.id });
    expect(linked.status).toBe(200);
    expect(linked.body.earned).toBe(1);
    expect(await balanceOf(customer)).toBe(1);
    const mine = await customer.get("/api/orders/mine?limit=10");
    expect((mine.body.orders as { id: string }[]).some((o) => o.id === order.id)).toBe(true);
  });
});
