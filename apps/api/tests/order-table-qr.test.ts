import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

/**
 * สั่งอาหารจาก QR ที่ติดบนโต๊ะ
 *
 * ลูกค้าที่สแกน QR รู้แค่รหัสโต๊ะ ไม่มีทางรู้ roundId และไม่มี endpoint สาธารณะ
 * ให้ถาม — server จึงต้องหารอบที่เปิดอยู่ของโต๊ะนั้นให้เอง
 * โต๊ะที่ยังไม่เช็กอินยังต้องปฏิเสธ เพื่อไม่ให้คำสั่งซื้อไปโผล่โต๊ะที่ไม่มีใครนั่ง
 */
describe("Ticket 06: สั่งที่โต๊ะด้วยรหัสโต๊ะจาก QR", () => {
  let store: Store;
  let app: Express;
  let menuId: string;
  let tableA1: string;
  let tableB2: string;

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

  async function createTable(owner: Agent, name: string, capacity: number): Promise<string> {
    const token = await csrfToken(owner);
    const res = await owner.post("/api/tables").set("x-csrf-token", token).send({ name, capacity });
    expect(res.status).toBe(201);
    return res.body.table.id as string;
  }

  /** เช็กอินลูกค้าหนึ่งคนที่โต๊ะ เพื่อให้โต๊ะนั้นมีรอบเปิดอยู่ */
  async function seatTable(tableId: string, phone: string): Promise<string> {
    const customer = await registerCustomer(`ลูกค้า ${phone}`, phone);
    let token = await csrfToken(customer);
    const reserved = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send({
        tableId,
        partySize: 2,
        reservedAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        idempotencyKey: randomUUID(),
      });
    expect(reserved.status).toBe(201);
    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    const checkin = await admin
      .post("/api/checkin")
      .set("x-csrf-token", token)
      .send({ code: reserved.body.reservation.code, partySize: 2 });
    expect(checkin.status).toBe(201);
    expect(checkin.body.round.status).toBe("open");
    return checkin.body.round.id as string;
  }

  /** สั่งแบบ Guest โดยแนบเฉพาะรหัสโต๊ะ เหมือนที่เว็บทำหลังสแกน QR */
  async function orderAtTable(over: Record<string, unknown> = {}) {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    return agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({
        serviceType: "dine_in",
        items: [{ menuId, quantity: 1 }],
        guestName: "คุณมินตรา",
        guestPhone: "0812345678",
        idempotencyKey: randomUUID(),
        ...over,
      });
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const menu = await owner
      .post("/api/menu")
      .set("x-csrf-token", token)
      .send({ category: "อาหารจานเดียว", name: "ข้าวผัดป้าอ้อ", price: 50, kind: "food" });
    expect(menu.status).toBe(201);
    menuId = menu.body.item.id as string;
    tableA1 = await createTable(owner, "A1", 2);
    tableB2 = await createTable(owner, "B2", 6);
  });

  it("โต๊ะที่เช็กอินแล้ว: ส่งแค่ tableId ก็ผูกกับรอบที่เปิดอยู่ให้เอง", async () => {
    const roundId = await seatTable(tableA1, "0811111111");
    const res = await orderAtTable({ tableId: tableA1 });
    expect(res.status).toBe(201);
    expect(res.body.order.tableId).toBe(tableA1);
    expect(res.body.order.roundId).toBe(roundId);
  });

  it("โต๊ะที่ยังไม่เช็กอิน: 409 พร้อมบอกให้ไปเช็กอินก่อน (ไม่ไปผูกโต๊ะอื่น)", async () => {
    await seatTable(tableA1, "0811111111");
    const res = await orderAtTable({ tableId: tableB2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("เช็กอิน");
  });

  it("รหัสโต๊ะที่ไม่มีจริง: 404 ไม่ใช่ผูกมั่วหรือสั่งผ่านเฉย ๆ", async () => {
    await seatTable(tableA1, "0811111111");
    const res = await orderAtTable({ tableId: "ไม่มีโต๊ะนี้" });
    expect(res.status).toBe(404);
  });

  it("สั่งกลับบ้านแต่แนบโต๊ะมาด้วย: 409 (ผูกโต๊ะได้เฉพาะกินที่ร้าน)", async () => {
    await seatTable(tableA1, "0811111111");
    const res = await orderAtTable({ tableId: tableA1, serviceType: "takeaway" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("รับประทานที่ร้าน");
  });

  it("ส่ง roundId มาเองยังทำงานเหมือนเดิม และโต๊ะต้องตรงกับรอบ", async () => {
    const roundId = await seatTable(tableA1, "0811111111");
    const ok = await orderAtTable({ tableId: tableA1, roundId });
    expect(ok.status).toBe(201);
    expect(ok.body.order.roundId).toBe(roundId);

    const mismatch = await orderAtTable({ tableId: tableB2, roundId });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toContain("โต๊ะไม่ตรงกับรอบ");
  });

  it("ไม่แนบโต๊ะเลย: สั่งได้ตามปกติและไม่ผูกรอบ", async () => {
    const res = await orderAtTable();
    expect(res.status).toBe(201);
    expect(res.body.order.tableId).toBeNull();
    expect(res.body.order.roundId).toBeNull();
  });

  it("สถานะโต๊ะสาธารณะบอกว่าสั่งได้ไหม โดยไม่หลุดข้อมูลลูกค้าหรือรหัสรอบ", async () => {
    await seatTable(tableA1, "0811111111");

    const seated = await request(app).get(`/api/tables/${tableA1}/public-status`);
    expect(seated.status).toBe(200);
    expect(seated.body.table).toEqual({ id: tableA1, name: "A1", zone: null });
    expect(seated.body.ready).toBe(true);
    expect(typeof seated.body.openedAt).toBe("string");
    // DTO ต้องแคบ: ไม่มีรหัสรอบ ชื่อลูกค้า หรือจำนวนคน
    const leaked = JSON.stringify(seated.body);
    expect(leaked).not.toContain("roundId");
    expect(leaked).not.toContain("partySize");
    expect(leaked).not.toContain("customer");

    const empty = await request(app).get(`/api/tables/${tableB2}/public-status`);
    expect(empty.status).toBe(200);
    expect(empty.body.ready).toBe(false);
    expect(empty.body.openedAt).toBeNull();

    expect((await request(app).get("/api/tables/ไม่มีโต๊ะนี้/public-status")).status).toBe(404);
  });

  it("โต๊ะที่งดใช้งานไม่พร้อมสั่ง แม้จะมีรอบเปิดค้างอยู่", async () => {
    await seatTable(tableA1, "0811111111");
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const off = await owner.patch(`/api/tables/${tableA1}`).set("x-csrf-token", token).send({ isEnabled: false });
    expect(off.status).toBe(200);

    const res = await request(app).get(`/api/tables/${tableA1}/public-status`);
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
  });

  it("idempotencyKey เดิมจากโต๊ะเดิม: คืนคำสั่งซื้อเดิม ไม่สร้างซ้ำ", async () => {
    await seatTable(tableA1, "0811111111");
    const key = randomUUID();
    const first = await orderAtTable({ tableId: tableA1, idempotencyKey: key });
    expect(first.status).toBe(201);
    const again = await orderAtTable({ tableId: tableA1, idempotencyKey: key });
    expect(again.status).toBe(200);
    expect(again.body.deduplicated).toBe(true);
    expect(again.body.order.id).toBe(first.body.order.id);
  });
});
