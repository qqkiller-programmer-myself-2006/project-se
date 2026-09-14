import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

describe("Ticket 09 kitchen/drink queues and delivery (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let foodId: string;
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

  it("ชำระสำเร็จสร้าง jobs ครบทุกฝ่ายแบบ exactly-once (ย้ำซ้ำไม่เพิ่ม job/audit)", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 2 }, { menuId: drinkId, quantity: 1 }]);
    const { paymentId } = await payCash(order.id, order.total);

    const owner = await loginAs("owner", "OwnerPass123");
    const listed = await owner.get("/api/queue?limit=50");
    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toHaveLength(2);
    const stations = listed.body.jobs.map((j: { station: string }) => j.station).sort();
    expect(stations).toEqual(["drink", "kitchen"]);
    for (const j of listed.body.jobs) {
      expect(j).toMatchObject({ orderId: order.id, status: "queued", readyQty: 0, deliveredQty: 0 });
      expect(typeof j.readyAt).toBe("string");
    }

    const auditBefore = (await owner.get("/api/audit/queue?limit=100")).body.items.length;

    // ensure ซ้ำเป็น no-op (deduplicated:true ไม่เขียน audit ซ้ำ)
    const token = await csrfToken(owner);
    const again = await owner.post("/api/queue/ensure").set("x-csrf-token", token).send({ paymentId });
    expect(again.status).toBe(200);
    expect(again.body.deduplicated).toBe(true);
    expect(again.body.jobs).toHaveLength(2);
    const listed2 = await owner.get("/api/queue?limit=50");
    expect(listed2.body.jobs).toHaveLength(2);
    const auditAfter = (await owner.get("/api/audit/queue?limit=100")).body.items.length;
    expect(auditAfter).toBe(auditBefore);

    // payment ที่ยังไม่ paid สร้างคิวไม่ได้ (409)
    const unpaid = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    const guest = request.agent(app);
    const token2 = await csrfToken(guest);
    const intent = await guest.post("/api/payments").set("x-csrf-token", token2).send({
      orderId: unpaid.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: unpaid.total,
      phone: "0812345678",
    });
    expect(intent.status).toBe(201);
    const token3 = await csrfToken(owner);
    const bad = await owner.post("/api/queue/ensure").set("x-csrf-token", token3).send({ paymentId: intent.body.payment.id });
    expect(bad.status).toBe(409);
  });

  it("FIFO ต่อฝ่ายตาม readyAt; preorder บล็อกจนถึง readyAt", async () => {
    const first = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(first.id, first.total);
    const second = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(second.id, second.total);
    // preorder นัดอีก 2 ชม. → readyAt = นัด − 15 นาที (อนาคต = บล็อก)
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const pre = await guestOrder([{ menuId: foodId, quantity: 1 }], { serviceType: "preorder", scheduledAt });
    await payCash(pre.id, pre.total);

    const owner = await loginAs("owner", "OwnerPass123");
    const res = await owner.get("/api/queue?station=kitchen&limit=50");
    expect(res.status).toBe(200);
    const jobs = res.body.jobs as { orderId: string; readyAt: string }[];
    expect(jobs).toHaveLength(3);
    // FIFO: จ่ายก่อนขึ้นก่อน; preorder ที่ readyAt อนาคตอยู่ท้าย
    expect(jobs[0]!.orderId).toBe(first.id);
    expect(jobs[1]!.orderId).toBe(second.id);
    expect(jobs[2]!.orderId).toBe(pre.id);
    expect(new Date(jobs[2]!.readyAt).getTime()).toBeGreaterThan(Date.now());
    // readyAt preorder = scheduledAt − 15 นาที (เวลาทำมาตรฐานฝ่ายครัว)
    const expected = new Date(scheduledAt).getTime() - 15 * 60 * 1000;
    expect(Math.abs(new Date(jobs[2]!.readyAt).getTime() - expected)).toBeLessThan(5000);
  });

  it("kitchen/drink ข้ามฝ่ายถูกปฏิเสธ 403 ฝั่ง server", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 1 }, { menuId: drinkId, quantity: 1 }]);
    await payCash(order.id, order.total);

    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    // ขอดูฝ่ายเครื่องดื่ม → 403
    expect((await kitchen.get("/api/queue?station=drink")).status).toBe(403);
    expect((await kitchen.get("/api/queue/slots?station=drink&date=2026-09-14")).status).toBe(403);
    // ไม่ระบุฝ่าย → ได้เฉพาะงานครัว
    const mine = await kitchen.get("/api/queue?limit=50");
    expect(mine.status).toBe(200);
    expect(mine.body.jobs).toHaveLength(1);
    expect(mine.body.jobs[0].station).toBe("kitchen");

    const drink = await loginAs("drink1", "DrinkPass123");
    const drinkJobId = (await store.listQueueJobs({ station: "drink", limit: 10 }))[0]!.id;
    // kitchen ทำ action งานเครื่องดื่ม → 403
    const token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${drinkJobId}/claim`).set("x-csrf-token", token).send({})).status).toBe(403);
    // drink ทำได้
    const token2 = await csrfToken(drink);
    expect((await drink.post(`/api/queue/${drinkJobId}/claim`).set("x-csrf-token", token2).send({})).status).toBe(200);

    // ลูกค้า/Guest เข้าหน้าคิวพนักงานไม่ได้ (401)
    const guest = request.agent(app);
    expect((await guest.get("/api/queue")).status).toBe(401);
  });

  it("lifecycle + partial quantities (ทำเสร็จ/ส่งมอบแยกกัน ไม่เกินยอด)", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 3 }]);
    await payCash(order.id, order.total);
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    const jobId = (await kitchen.get("/api/queue?limit=50")).body.jobs[0].id as string;
    let token = await csrfToken(kitchen);

    // ข้ามขั้น queued → preparing ไม่ได้ (409)
    expect((await kitchen.post(`/api/queue/${jobId}/start`).set("x-csrf-token", token).send({})).status).toBe(409);
    expect((await kitchen.post(`/api/queue/${jobId}/claim`).set("x-csrf-token", token).send({})).status).toBe(200);

    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/start`).set("x-csrf-token", token).send({})).status).toBe(200);

    // ทำเสร็จบางส่วน (1/3) → ยัง preparing
    token = await csrfToken(kitchen);
    const part = await kitchen.post(`/api/queue/${jobId}/ready`).set("x-csrf-token", token).send({ qty: 1 });
    expect(part.status).toBe(200);
    expect(part.body.job).toMatchObject({ status: "preparing", readyQty: 1 });

    // ส่งมอบก่อน ready ครบ? ทำได้เฉพาะเมื่อ ready แล้ว → ตอนนี้ยัง preparing ส่งมอบไม่ได้ (409)
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/deliver`).set("x-csrf-token", token).send({ qty: 1 })).status).toBe(409);

    // ทำเสร็จครบ (3/3) → ready
    token = await csrfToken(kitchen);
    const done = await kitchen.post(`/api/queue/${jobId}/ready`).set("x-csrf-token", token).send({ qty: 2 });
    expect(done.status).toBe(200);
    expect(done.body.job).toMatchObject({ status: "ready", readyQty: 3 });

    // ทำเกินยอด → 409
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/ready`).set("x-csrf-token", token).send({ qty: 1 })).status).toBe(409);

    // ส่งมอบบางส่วน (1/3) → ยัง ready
    token = await csrfToken(kitchen);
    const d1 = await kitchen.post(`/api/queue/${jobId}/deliver`).set("x-csrf-token", token).send({ qty: 1 });
    expect(d1.status).toBe(200);
    expect(d1.body.job).toMatchObject({ status: "ready", deliveredQty: 1 });

    // ส่งมอบเกินทำเสร็จ → 409; ส่งมอบครบ → delivered
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/deliver`).set("x-csrf-token", token).send({ qty: 5 })).status).toBe(409);
    token = await csrfToken(kitchen);
    const d2 = await kitchen.post(`/api/queue/${jobId}/deliver`).set("x-csrf-token", token).send({ qty: 2 });
    expect(d2.status).toBe(200);
    expect(d2.body.job).toMatchObject({ status: "delivered", deliveredQty: 3 });

    // ปิดงานแล้วขยับต่อไม่ได้ (409)
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/priority`).set("x-csrf-token", token).send({ reason: "สายแล้ว" })).status).toBe(409);
  });

  it("remake/priority ต้องมีเหตุผล + audit; ทำใหม่ไม่คิดเงินซ้ำ", async () => {
    const order = await guestOrder([{ menuId: drinkId, quantity: 2 }]);
    await payCash(order.id, order.total);
    const drink = await loginAs("drink1", "DrinkPass123");
    const jobId = (await drink.get("/api/queue?limit=50")).body.jobs[0].id as string;

    // ไม่มีเหตุผล → 400
    let token = await csrfToken(drink);
    expect((await drink.post(`/api/queue/${jobId}/priority`).set("x-csrf-token", token).send({})).status).toBe(400);
    token = await csrfToken(drink);
    expect((await drink.post(`/api/queue/${jobId}/remake`).set("x-csrf-token", token).send({})).status).toBe(400);

    token = await csrfToken(drink);
    const pr = await drink.post(`/api/queue/${jobId}/priority`).set("x-csrf-token", token).send({ reason: "ลูกค้ารอหน้าร้าน" });
    expect(pr.status).toBe(200);
    expect(pr.body.job.isPriority).toBe(true);

    token = await csrfToken(drink);
    const rm = await drink.post(`/api/queue/${jobId}/remake`).set("x-csrf-token", token).send({ reason: "ทำผิดสูตร", quantity: 1 });
    expect(rm.status).toBe(200);
    expect(rm.body.job).toMatchObject({ isRemake: true, quantity: 1, status: "queued" });
    // ทำใหม่ผูก payment/order เดิม (ไม่คิดเงินซ้ำ — ไม่มี payment/audit ใบเสร็จเพิ่ม)
    expect(rm.body.job.paymentId).toBe(pr.body.job.paymentId);
    expect(rm.body.job.orderId).toBe(order.id);
    const payments = await store.listPayments({ limit: 50 });
    expect(payments.filter((p) => p.orderId === order.id)).toHaveLength(1);

    const owner = await loginAs("owner", "OwnerPass123");
    const audit = await owner.get("/api/audit/queue?limit=100");
    const actions = (audit.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("queue_priority");
    expect(actions).toContain("queue_remade");
  });

  it("ตัดสต๊อกจริงครั้งเดียวตอนเริ่มทำ; ตัดแล้วปฏิเสธ refund/cancel", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const ing = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({
      name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 1000,
    });
    expect(ing.status).toBe(201);
    const ingId = ing.body.item.id as string;
    token = await csrfToken(owner);
    const recipe = await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({
      targetType: "menu", targetId: foodId, lines: [{ ingredientId: ingId, qty: 100 }],
    });
    expect(recipe.status).toBe(201);

    // สั่ง 2 ชุด → จอง 200 กรัม
    const order = await guestOrder([{ menuId: foodId, quantity: 2 }]);
    const before = await owner.get(`/api/inventory/ingredients/${ingId}`);
    expect(before.body.item.reserved).toBe(200);

    const { paymentId } = await payCash(order.id, order.total);
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    const jobId = (await kitchen.get("/api/queue?limit=50")).body.jobs[0].id as string;

    // เริ่มทำ → ตัดจริงครั้งเดียว (onHand 1000→800, reserved 200→0)
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/claim`).set("x-csrf-token", token).send({})).status).toBe(200);
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/start`).set("x-csrf-token", token).send({})).status).toBe(200);
    const after = await owner.get(`/api/inventory/ingredients/${ingId}`);
    expect(after.body.item.onHand).toBe(800);
    expect(after.body.item.reserved).toBe(0);
    const ledger = await store.listStockLedger({ orderId: order.id, op: "consume", limit: 10 });
    expect(ledger).toHaveLength(1);

    // ยกเลิกงานหลังเริ่มทำ → 409; คืนเงินหลังตัดจริง → 409 (ตาม Ticket 08 contract)
    token = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/queue/${jobId}/cancel`).set("x-csrf-token", token).send({ reason: "ลูกค้าเปลี่ยนใจ" })).status).toBe(409);
    token = await csrfToken(owner);
    expect((await owner.post(`/api/payments/${paymentId}/refund`).set("x-csrf-token", token).send({ reason: "ลูกค้าขอคืน" })).status).toBe(409);

    // คืนเงินก่อนเริ่มทำได้ → jobs หยุดเดินต่อ
    const order2 = await guestOrder([{ menuId: drinkId, quantity: 1 }]);
    const paid2 = await payCash(order2.id, order2.total);
    token = await csrfToken(owner);
    const refund = await owner.post(`/api/payments/${paid2.paymentId}/refund`).set("x-csrf-token", token).send({ reason: "ทำผิดออเดอร์" });
    expect(refund.status).toBe(200);
    const drink = await loginAs("drink1", "DrinkPass123");
    const job2 = (await store.listQueueJobs({ limit: 50 })).find((j) => j.orderId === order2.id)!;
    token = await csrfToken(drink);
    expect((await drink.post(`/api/queue/${job2.id}/claim`).set("x-csrf-token", token).send({})).status).toBe(409);
  });

  it("ยกเลิกก่อนเริ่มคืนสถานะงาน; ลูกค้าเห็นเฉพาะคำสั่งซื้อตนเอง", async () => {
    const order = await guestOrder([{ menuId: foodId, quantity: 1 }]);
    await payCash(order.id, order.total);
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    const jobId = (await kitchen.get("/api/queue?limit=50")).body.jobs[0].id as string;

    let token = await csrfToken(kitchen);
    const cancelled = await kitchen.post(`/api/queue/${jobId}/cancel`).set("x-csrf-token", token).send({ reason: "วัตถุดิบหมด" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.status).toBe("cancelled");

    // Guest เจ้าของเบอร์ดูคิวของตนเองได้
    const guest = request.agent(app);
    const mine = await guest.get(`/api/queue/order/${order.id}?phone=0812345678`);
    expect(mine.status).toBe(200);
    expect(mine.body.jobs).toHaveLength(1);
    expect(mine.body.jobs[0].status).toBe("cancelled");
    // เบอร์ผิด → 403; ไม่แนบเบอร์ → 401
    expect((await guest.get(`/api/queue/order/${order.id}?phone=0899999999`)).status).toBe(403);
    expect((await guest.get(`/api/queue/order/${order.id}`)).status).toBe(401);

    // คำสั่งซื้อของคนอื่นดูไม่ได้
    const other = await guestOrder([{ menuId: foodId, quantity: 1 }], { guestPhone: "0899999999", guestName: "คุณบี" });
    expect((await guest.get(`/api/queue/order/${other.id}?phone=0812345678`)).status).toBe(403);
  });

  it("capacity/slots: default 10; Admin ตั้งได้; เต็มเสนอช่วงถัดไป", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const caps = await owner.get("/api/queue/capacity");
    expect(caps.status).toBe(200);
    expect(caps.body.capacities.find((c: { station: string }) => c.station === "kitchen").perSlot).toBe(10);

    // kitchen ตั้ง capacity ไม่ได้ (403)
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    let token = await csrfToken(kitchen);
    expect((await kitchen.put("/api/queue/capacity").set("x-csrf-token", token).send({ station: "kitchen", perSlot: 3 })).status).toBe(403);

    // owner ตั้งได้ + audit
    token = await csrfToken(owner);
    const set = await owner.put("/api/queue/capacity").set("x-csrf-token", token).send({ station: "kitchen", perSlot: 1 });
    expect(set.status).toBe(200);
    expect(set.body.capacity.perSlot).toBe(1);
    const audit = await owner.get("/api/audit/queue?limit=20");
    expect((audit.body.items as { action: string }[]).map((a) => a.action)).toContain("queue_capacity_updated");

    // slots วันนี้มี 96 ช่อง; next slot ชี้ช่องว่างถัดไป
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    const slots = await owner.get(`/api/queue/slots?station=kitchen&date=${today}`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots).toHaveLength(96);
    for (const s of slots.body.slots) {
      expect(s.capacity).toBe(1);
      expect(s.available).toBe(Math.max(0, 1 - s.used));
    }
    const next = await owner.get(`/api/queue/slots/next?station=kitchen&after=${encodeURIComponent(new Date().toISOString())}`);
    expect(next.status).toBe(200);
    expect(next.body.slot === null || typeof next.body.slot.slotStart === "string").toBe(true);
  });

  it("dine-in jobs ผูก table/round linkage; ไม่มีรอบสั่งที่โต๊ะไม่ได้", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const table = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "T1", capacity: 4 });
    expect(table.status).toBe(201);
    const tableId = table.body.table.id as string;

    // ระบุโต๊ะอย่างเดียวโดยไม่มีรอบ → 409 (ต้องเช็กอินก่อน — Ticket 06 contract)
    const anon = request.agent(app);
    token = await csrfToken(anon);
    const noRound = await anon.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId: foodId, quantity: 1 }],
      guestName: "คุณมินตรา",
      guestPhone: "0812345678",
      idempotencyKey: randomUUID(),
      tableId,
    });
    expect(noRound.status).toBe(409);

    // โฟลว์จริง: สมัครสมาชิก → จอง → เช็กอินเปิดรอบ → สั่งที่โต๊ะผูก round
    token = await csrfToken(anon);
    const reg = await anon.post("/api/customers/register").set("x-csrf-token", token).send({
      name: "ลูกค้า โต๊ะ", phone: "0891111111", password: "Customer123",
    });
    expect(reg.status).toBe(201);
    token = await csrfToken(anon);
    const reserved = await anon.post("/api/reservations").set("x-csrf-token", token).send({
      tableId, partySize: 2, reservedAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), idempotencyKey: randomUUID(),
    });
    expect(reserved.status).toBe(201);
    token = await csrfToken(owner);
    const checkin = await owner.post("/api/checkin").set("x-csrf-token", token).send({
      reservationId: reserved.body.reservation.id, partySize: 2,
    });
    expect(checkin.status).toBe(201);
    const roundId = checkin.body.round.id as string;

    token = await csrfToken(anon);
    const order = await anon.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId: foodId, quantity: 1 }, { menuId: drinkId, quantity: 1 }],
      idempotencyKey: randomUUID(),
      roundId,
    });
    expect(order.status).toBe(201);
    expect(order.body.order.tableId).toBe(tableId);
    expect(order.body.order.roundId).toBe(roundId);

    // ชำระ (สมาชิกเจ้าของ) → ยืนยันเงินสด → jobs ผูกโต๊ะ/รอบ
    token = await csrfToken(anon);
    const intent = await anon.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.body.order.id, method: "cash", idempotencyKey: randomUUID(), receivedAmount: order.body.order.total,
    });
    expect(intent.status).toBe(201);
    token = await csrfToken(owner);
    const confirmed = await owner.post(`/api/payments/${intent.body.payment.id}/confirm-cash`).set("x-csrf-token", token).send({
      receivedAmount: order.body.order.total, reason: "รับเงินหน้าร้าน",
    });
    expect(confirmed.status).toBe(200);

    const jobs = await store.listQueueJobs({ limit: 50 });
    const mine = jobs.filter((j) => j.orderId === order.body.order.id);
    expect(mine).toHaveLength(2);
    for (const j of mine) {
      expect(j.tableId).toBe(tableId);
      expect(j.roundId).toBe(roundId);
    }
    const kitchenView = await owner.get("/api/queue?station=kitchen&limit=50");
    const kj = (kitchenView.body.jobs as { orderId: string; tableName: string | null }[]).find((j) => j.orderId === order.body.order.id);
    expect(kj?.tableName).toBe("T1");
  });
});
