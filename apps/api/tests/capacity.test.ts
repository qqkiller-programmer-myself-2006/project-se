import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakePredictionProvider } from "../src/predict/adapter.js";

describe("Ticket 13 capacity and wait prediction (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let foodId: string;
  let drinkId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function loginAs(username: string, password: string, target?: Express): Promise<Agent> {
    const agent = request.agent(target ?? app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
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

  async function guestOrder(items: { menuId: string; quantity: number }[], extra: Record<string, unknown> = {}): Promise<{ id: string; orderNumber: string; total: number }> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({
        serviceType: "takeaway",
        items,
        guestName: "คุณมินตรา",
        guestPhone: "0812345678",
        idempotencyKey: randomUUID(),
        ...extra,
      });
    expect(res.status).toBe(201);
    return { id: res.body.order.id as string, orderNumber: res.body.order.orderNumber as string, total: res.body.order.total as number };
  }

  /** ชำระเงินสดแบบครบวงจร: สร้าง intent (guest) → ยืนยัน (owner) → คืน payment ที่ paid */
  async function payCash(orderId: string, total: number): Promise<{ paymentId: string }> {
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: total,
      phone: "0812345678",
    });
    expect(created.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: total, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("paid");
    return { paymentId: created.body.payment.id as string };
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("KitchenPass123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass123", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    foodId = await createMenu(owner, "อาหารจานเดียว", "ข้าวผัดป้าอ้อ", "food");
    drinkId = await createMenu(owner, "เครื่องดื่ม", "ชาเย็นป้าอ้อ", "drink");
  });

  it("ภาพรวมกำลังผลิต: baseline ต่อฝ่าย + โต๊ะ + fake clock; kitchen เห็นเฉพาะฝ่ายตน", async () => {
    const fixedNow = new Date("2026-09-15T03:00:00.000Z");
    const clockApp = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, now: () => fixedNow });
    const owner = await loginAs("owner", "OwnerPass123", clockApp);
    const res = await owner.get("/api/capacity/overview");
    expect(res.status).toBe(200);
    expect(res.body.overview.at).toBe(fixedNow.toISOString());
    expect(res.body.overview.stations).toHaveLength(2);
    const kitchen = res.body.overview.stations.find((s: { station: string }) => s.station === "kitchen");
    expect(kitchen).toMatchObject({ perSlot: 10, activeJobs: 0, estimatedWaitMin: 15, rangeMin: 15, rangeMax: 20, source: "baseline" });
    expect(res.body.nonGuarantee).toContain("ไม่ใช่เวลารับประกัน");

    // kitchen ขอฝ่ายเครื่องดื่ม → 403; ไม่ระบุฝ่าย → เห็นเฉพาะครัว
    const kitchenAgent = await loginAs("kitchen1", "KitchenPass123", clockApp);
    const cross = await kitchenAgent.get("/api/capacity/overview?station=drink");
    expect(cross.status).toBe(403);
    const own = await kitchenAgent.get("/api/capacity/overview");
    expect(own.status).toBe(200);
    expect(own.body.overview.stations.map((s: { station: string }) => s.station)).toEqual(["kitchen"]);

    // ไม่ login → 401
    const anon = request.agent(clockApp);
    expect((await anon.get("/api/capacity/overview")).status).toBe(401);
  });

  it("เวลารอรายคำสั่งซื้อ: งานช้าที่สุดตัดสิน + readyAtSlowest + ช่วง + ข้อความไม่รับประกัน", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 2 }, { menuId: drinkId, quantity: 1 }]);
    await payCash(order.id, order.total);

    const owner = await loginAs("owner", "OwnerPass123");
    const res = await owner.get(`/api/capacity/wait?orderId=${order.id}&partySize=2`);
    expect(res.status).toBe(200);
    const e = res.body.estimate;
    // ครัว ahead=1 → 15×2=30; เครื่องดื่ม ahead=1 → 5×2=10; ช้าที่สุด = 30
    expect(e.perStation).toHaveLength(2);
    expect(e.estimatedWaitMin).toBe(30);
    expect(e.rangeMin).toBe(30);
    expect(e.rangeMax).toBe(35);
    expect(typeof e.readyAtSlowest).toBe("string");
    expect(e.source).toBe("baseline");
    expect(e.modelVersion).toBe("baseline-v1");
    expect(e.nonGuarantee).toContain("ไม่ใช่เวลารับประกัน");
    expect(typeof res.body.featureId).toBe("string");

    // party ใหญ่ +5 นาที
    const big = await owner.get(`/api/capacity/wait?orderId=${order.id}&partySize=6`);
    expect(big.body.estimate.estimatedWaitMin).toBe(35);

    // ไม่ระบุ orderId/station → 400
    expect((await owner.get("/api/capacity/wait")).status).toBe(400);
    // คำสั่งซื้อไม่มีจริง → 404
    expect((await owner.get(`/api/capacity/wait?orderId=${randomUUID()}`)).status).toBe(404);
  });

  it("ลูกค้าเห็นเฉพาะคำสั่งซื้อตนเอง; Guest ผิดเบอร์ถูกปฏิเสธ", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(order.id, order.total);

    // kitchen (staff ไม่ใช่ manager) ดู wait รายออเดอร์ → 403
    const kitchenAgent = await loginAs("kitchen1", "KitchenPass123");
    expect((await kitchenAgent.get(`/api/capacity/wait?orderId=${order.id}`)).status).toBe(403);

    // Guest เจ้าของเบอร์ดูได้
    const anon = request.agent(app);
    const mine = await anon.get(`/api/capacity/wait?orderId=${order.id}&phone=0812345678`);
    expect(mine.status).toBe(200);
    expect(mine.body.estimate.orderId).toBe(order.id);

    // Guest ผิดเบอร์ → 403; ไม่ส่งเบอร์ → 401
    expect((await anon.get(`/api/capacity/wait?orderId=${order.id}&phone=0899999999`)).status).toBe(403);
    expect((await anon.get(`/api/capacity/wait?orderId=${order.id}`)).status).toBe(401);
  });

  it("ตรวจสล็อตล่วงหน้า: ว่าง/เต็มเสนอช่วงถัดไป (preorder slot validation)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    // ตั้งกำลังผลิตครัวเหลือ 1 ต่องช่วง
    const cap = await owner.put("/api/queue/capacity").set("x-csrf-token", token).send({ station: "kitchen", perSlot: 1 });
    expect(cap.status).toBe(200);

    // readyAt ของ preorder = scheduledAt − 15 นาที (ตรงหนึ่งช่วงก่อนหน้าเสมอ)
    // จึงจองด้วย scheduledAt = จุดเริ่มช่วง + 15 นาที แล้วตรวจช่วงเดียวกัน
    const slotMs = 15 * 60 * 1000;
    const slotStart = new Date(Math.floor((Date.now() + 2 * 60 * 60 * 1000) / slotMs) * slotMs);
    const jobScheduledAt = new Date(slotStart.getTime() + slotMs).toISOString();
    const checkScheduledAt = new Date(slotStart.getTime() + 5 * 60 * 1000).toISOString();
    const pre = await guestOrder([{ menuId: foodId, quantity: 1 }], { serviceType: "preorder", scheduledAt: jobScheduledAt });
    await payCash(pre.id, pre.total);

    token = await csrfToken(owner);
    const full = await owner
      .post("/api/capacity/preorder-check")
      .set("x-csrf-token", token)
      .send({ station: "kitchen", scheduledAt: checkScheduledAt });
    expect(full.status).toBe(200);
    expect(full.body.check.available).toBe(false);
    expect(full.body.check.used).toBeGreaterThanOrEqual(1);
    expect(full.body.check.suggestedSlot).not.toBeNull();
    expect(full.body.nonGuarantee).toContain("ไม่ใช่เวลารับประกัน");

    // ช่วงอื่นที่ว่าง → available true + ไม่มี suggestion
    const other = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
    token = await csrfToken(owner);
    const free = await owner
      .post("/api/capacity/preorder-check")
      .set("x-csrf-token", token)
      .send({ station: "kitchen", scheduledAt: other });
    expect(free.status).toBe(200);
    expect(free.body.check.available).toBe(true);
    expect(free.body.check.suggestedSlot).toBeNull();

    // เวลาในอดีต → 400
    token = await csrfToken(owner);
    const past = await owner
      .post("/api/capacity/preorder-check")
      .set("x-csrf-token", token)
      .send({ station: "kitchen", scheduledAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(past.status).toBe(400);
  });

  it("fake adapter: success ใช้ model + metadata; fail/latency เกิน timeout fallback baseline", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(order.id, order.total);

    // default (disabled) → baseline
    const owner = await loginAs("owner", "OwnerPass123");
    const base = await owner.get(`/api/capacity/wait?orderId=${order.id}`);
    expect(base.body.estimate.source).toBe("baseline");

    // fake success → model
    const fakeApp = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      predictor: new FakePredictionProvider({ waitMin: 12, version: "fake-v9" }),
    });
    const owner2 = await loginAs("owner", "OwnerPass123", fakeApp);
    const modeled = await owner2.get(`/api/capacity/wait?orderId=${order.id}`);
    expect(modeled.status).toBe(200);
    expect(modeled.body.estimate.source).toBe("model");
    expect(modeled.body.estimate.modelVersion).toBe("fake-v9");
    expect(modeled.body.estimate.estimatedWaitMin).toBe(12);
    expect(modeled.body.estimate.rangeMin).toBe(12);
    expect(modeled.body.estimate.rangeMax).toBe(17);

    // fake fail → fallback baseline
    const failApp = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      predictor: new FakePredictionProvider({ fail: true }),
    });
    const owner3 = await loginAs("owner", "OwnerPass123", failApp);
    const fell = await owner3.get(`/api/capacity/wait?orderId=${order.id}`);
    expect(fell.body.estimate.source).toBe("baseline");
    expect(fell.body.estimate.modelVersion).toBe("baseline-v1");

    // latency เกิน timeout (50ms) → fallback baseline
    let token = await csrfToken(owner);
    const tuned = await owner.put("/api/predictions/model").set("x-csrf-token", token).send({ timeoutMs: 50 });
    expect(tuned.status).toBe(200);
    const slowApp = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      predictor: new FakePredictionProvider({ latencyMs: 300, waitMin: 5 }),
    });
    const owner4 = await loginAs("owner", "OwnerPass123", slowApp);
    const slow = await owner4.get(`/api/capacity/wait?orderId=${order.id}`);
    expect(slow.body.estimate.source).toBe("baseline");
  });

  it("feature capture ไม่มี PII + complete วัดจริง + accuracy fixtures + audit", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(order.id, order.total);
    const owner = await loginAs("owner", "OwnerPass123");

    const waited = await owner.get(`/api/capacity/wait?orderId=${order.id}&partySize=2`);
    const featureId = waited.body.featureId as string;

    const listed = await owner.get("/api/predictions/features?limit=10");
    expect(listed.status).toBe(200);
    const feature = listed.body.features.find((f: { id: string }) => f.id === featureId);
    expect(feature).toBeDefined();
    // ไม่มี PII: ต้องไม่มีคีย์ชื่อ/เบอร์/อีเมล/LINE โดยตรง
    const keys = Object.keys(feature) as string[];
    for (const forbidden of ["guestName", "guestPhone", "phone", "email", "lineUserId", "customerName", "displayName"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(feature).toMatchObject({ orderId: order.id, partySize: 2, source: "baseline", actualMin: null });
    expect(typeof feature.hourOfDay).toBe("number");

    // บันทึกเวลาจริง → error baseline ถูกคำนวณ; เรียกซ้ำ deduplicated
    let token = await csrfToken(owner);
    const done = await owner.post(`/api/predictions/features/${featureId}/complete`).set("x-csrf-token", token).send({ actualMin: 25 });
    expect(done.status).toBe(200);
    expect(done.body.feature.actualMin).toBe(25);
    expect(typeof done.body.feature.errorBaseline).toBe("number");
    expect(done.body.deduplicated).toBe(false);
    token = await csrfToken(owner);
    const again = await owner.post(`/api/predictions/features/${featureId}/complete`).set("x-csrf-token", token).send({ actualMin: 25 });
    expect(again.body.deduplicated).toBe(true);

    // accuracy: 1 ตัวอย่าง + fixtures + gathering (< 500)
    const acc = await owner.get("/api/predictions/accuracy");
    expect(acc.status).toBe(200);
    expect(acc.body.accuracy.samples).toBe(1);
    expect(typeof acc.body.accuracy.maeBaseline).toBe("number");
    expect(acc.body.accuracy.gatheringSamples).toBe(true);
    expect(acc.body.accuracy.fixtures.modelWins).toBe(true);

    // audit predictions มี requested + completed
    const audit = await owner.get("/api/audit/predictions?limit=50");
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain("prediction_requested");
    expect(actions).toContain("prediction_completed");
  });

  it("โมเดล: default baseline-v1; ตั้งค่าได้; เปิด external ต้องผ่านเกณฑ์ก่อน", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const got = await owner.get("/api/predictions/model");
    expect(got.body.model).toMatchObject({ version: "baseline-v1", kind: "baseline", enabled: true });

    let token = await csrfToken(owner);
    const updated = await owner.put("/api/predictions/model").set("x-csrf-token", token).send({ version: "baseline-v2", thresholdMinutes: 1, timeoutMs: 300 });
    expect(updated.status).toBe(200);
    expect(updated.body.model).toMatchObject({ version: "baseline-v2", thresholdMinutes: 1, timeoutMs: 300 });

    // เปิด external ทั้งที่ accuracy ไม่ผ่าน → 409
    token = await csrfToken(owner);
    const blocked = await owner.put("/api/predictions/model").set("x-csrf-token", token).send({ kind: "external", enabled: true });
    expect(blocked.status).toBe(409);

    // validation: timeout เกินช่วง → 400
    token = await csrfToken(owner);
    const bad = await owner.put("/api/predictions/model").set("x-csrf-token", token).send({ timeoutMs: 99999 });
    expect(bad.status).toBe(400);

    // kitchen เข้า model/accuracy ไม่ได้ → 403
    const kitchenAgent = await loginAs("kitchen1", "KitchenPass123");
    expect((await kitchenAgent.get("/api/predictions/model")).status).toBe(403);
    expect((await kitchenAgent.get("/api/predictions/accuracy")).status).toBe(403);
    expect((await kitchenAgent.get("/api/predictions/features")).status).toBe(403);
  });
});
