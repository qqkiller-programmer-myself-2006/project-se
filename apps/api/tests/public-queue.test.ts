import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { buildPublicQueue, publicOrderRef } from "../src/queue/publicQueue.js";
import type { QueueJob } from "../src/types.js";

const NOW = new Date("2026-09-14T10:00:00.000Z");

function job(over: Partial<QueueJob>): QueueJob {
  return {
    id: randomUUID(),
    orderId: randomUUID(),
    orderNumber: "ORD-20260914-AAAA",
    paymentId: randomUUID(),
    orderItemId: randomUUID(),
    menuId: randomUUID(),
    menuName: "ข้าวผัดลับ",
    station: "kitchen",
    quantity: 1,
    readyQty: 0,
    deliveredQty: 0,
    status: "queued",
    readyAt: "2026-09-14T09:50:00.000Z",
    tableId: null,
    roundId: null,
    isRemake: false,
    isPriority: false,
    reason: null,
    claimedBy: null,
    rewardRedemptionId: null,
    createdAt: "2026-09-14T09:50:00.000Z",
    updatedAt: "2026-09-14T09:50:00.000Z",
    ...over,
  };
}

describe("Issue #43 buildPublicQueue (domain)", () => {
  it("รหัสย่อเป็นส่วนท้ายของเลขคำสั่งซื้อ ไม่ใช่เลขเต็ม", () => {
    expect(publicOrderRef("ORD-20260914-ab12")).toBe("AB12");
    expect(publicOrderRef("ORD-20260914-AB12")).not.toContain("20260914");
  });

  it("รวมหลายฝ่ายเป็นแถวเดียวต่อออเดอร์ และนับ ahead เฉพาะออเดอร์ที่ยังไม่พร้อม", () => {
    const jobs = [
      job({ orderNumber: "ORD-1-AAAA", station: "kitchen", status: "preparing", readyAt: "2026-09-14T09:40:00.000Z" }),
      job({ orderNumber: "ORD-1-AAAA", station: "drink", status: "ready", readyAt: "2026-09-14T09:40:00.000Z" }),
      job({ orderNumber: "ORD-2-BBBB", status: "queued", readyAt: "2026-09-14T09:45:00.000Z" }),
      job({ orderNumber: "ORD-3-CCCC", status: "ready", readyAt: "2026-09-14T09:46:00.000Z" }),
      job({ orderNumber: "ORD-4-DDDD", status: "queued", readyAt: "2026-09-14T09:47:00.000Z" }),
    ];
    const { entries, counts } = buildPublicQueue(jobs, NOW);
    expect(entries).toEqual([
      { ref: "AAAA", status: "preparing", ahead: 0 },
      { ref: "BBBB", status: "waiting", ahead: 1 },
      { ref: "CCCC", status: "ready", ahead: 0 },
      { ref: "DDDD", status: "waiting", ahead: 2 },
    ]);
    expect(counts).toEqual({ waiting: 2, preparing: 1, ready: 1 });
  });

  it("ข้ามงานที่ส่งมอบ/ยกเลิกแล้ว และ preorder ที่ readyAt ยังไม่ถึง", () => {
    const jobs = [
      job({ orderNumber: "ORD-1-AAAA", status: "delivered" }),
      job({ orderNumber: "ORD-2-BBBB", status: "cancelled" }),
      job({ orderNumber: "ORD-3-CCCC", status: "queued", readyAt: "2026-09-14T12:00:00.000Z" }),
      job({ orderNumber: "ORD-4-DDDD", status: "queued" }),
    ];
    expect(buildPublicQueue(jobs, NOW).entries).toEqual([{ ref: "DDDD", status: "waiting", ahead: 0 }]);
  });

  it("คืนเฉพาะ ref/status/ahead — ไม่มีฟิลด์ส่วนตัวหลุด", () => {
    const { entries } = buildPublicQueue([job({ menuName: "เมนูลับ", claimedBy: "somchai" })], NOW);
    expect(Object.keys(entries[0]!).sort()).toEqual(["ahead", "ref", "status"]);
  });

  it("จำกัดจำนวนแถวที่คืน แต่ counts ยังนับครบ", () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job({ orderNumber: `ORD-1-X${i}` }));
    const snap = buildPublicQueue(jobs, NOW, 2);
    expect(snap.entries).toHaveLength(2);
    expect(snap.counts.waiting).toBe(5);
  });
});

describe("Issue #43 GET /api/queue/public (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let foodId: string;
  let drinkId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    return (await agent.get("/api/auth/csrf")).body.csrfToken as string;
  }

  async function loginAs(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function createMenu(agent: Agent, name: string, kind: "food" | "drink"): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/menu")
      .set("x-csrf-token", token)
      .send({ category: kind === "food" ? "อาหารจานเดียว" : "เครื่องดื่ม", name, price: 50, kind });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function paidOrder(items: { menuId: string; quantity: number }[]) {
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const order = await guest
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({
        serviceType: "takeaway",
        items,
        guestName: "คุณมินตรา",
        guestPhone: "0812345678",
        idempotencyKey: randomUUID(),
      });
    expect(order.status).toBe(201);
    const o = order.body.order as { id: string; orderNumber: string; total: number };
    token = await csrfToken(guest);
    const pay = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: o.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: o.total,
      phone: "0812345678",
    });
    expect(pay.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${pay.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: o.total, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    return o;
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    foodId = await createMenu(owner, "ข้าวผัดป้าอ้อ", "food");
    drinkId = await createMenu(owner, "ชาเย็นป้าอ้อ", "drink");
  });

  it("เปิดดูได้โดยไม่ล็อกอิน; คิวว่างได้ entries ว่าง", async () => {
    const res = await request(app).get("/api/queue/public");
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.counts).toEqual({ waiting: 0, preparing: 0, ready: 0 });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("รวมครัว+เครื่องดื่มเป็นคิวเดียว เปลี่ยนสถานะตามงาน และ response ไม่มีข้อมูลส่วนตัว", async () => {
    const first = await paidOrder([
      { menuId: foodId, quantity: 2 },
      { menuId: drinkId, quantity: 1 },
    ]);
    const second = await paidOrder([{ menuId: foodId, quantity: 1 }]);

    const res = await request(app).get("/api/queue/public");
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e: { ahead: number }) => e.ahead)).toEqual([0, 1]);
    expect(res.body.entries.every((e: { status: string }) => e.status === "waiting")).toBe(true);

    const body = JSON.stringify(res.body);
    for (const secret of [
      "0812345678",
      "คุณมินตรา",
      "ข้าวผัดป้าอ้อ",
      "ชาเย็นป้าอ้อ",
      first.id,
      second.id,
      first.orderNumber,
      second.orderNumber,
    ]) {
      expect(body).not.toContain(secret);
    }

    // ครัวทำ + ส่งของออเดอร์แรกให้พร้อม → สถานะเปลี่ยนและคิวถัดไปขยับ
    const owner = await loginAs("owner", "OwnerPass123");
    const jobs = (await owner.get("/api/queue?limit=50")).body.jobs as { id: string; orderId: string; quantity: number }[];
    for (const j of jobs.filter((x) => x.orderId === first.id)) {
      let token = await csrfToken(owner);
      expect((await owner.post(`/api/queue/${j.id}/claim`).set("x-csrf-token", token).send({})).status).toBe(200);
      token = await csrfToken(owner);
      expect((await owner.post(`/api/queue/${j.id}/start`).set("x-csrf-token", token).send({})).status).toBe(200);
      const mid = await request(app).get("/api/queue/public");
      expect(mid.body.entries[0].status).toBe("preparing");
      token = await csrfToken(owner);
      expect((await owner.post(`/api/queue/${j.id}/ready`).set("x-csrf-token", token).send({ qty: j.quantity })).status).toBe(200);
    }
    const after = await request(app).get("/api/queue/public");
    expect(after.body.counts).toEqual({ waiting: 1, preparing: 0, ready: 1 });
    const waiting = after.body.entries.find((e: { status: string }) => e.status === "waiting");
    expect(waiting.ahead).toBe(0);
  });
});
