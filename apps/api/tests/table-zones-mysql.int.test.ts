import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log("SKIP table zones real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL");
}

/** โซนโต๊ะ (migration 015) + ผังสถานะโต๊ะบน MySQL จริง — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ */
describe.skipIf(!hasTestDb)("table zones and availability with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let owner: Agent;
  const prefix = `z${Date.now().toString(36)}_`;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const username = `${prefix}owner`;
    await store.createUser({ username, passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    owner = request.agent(app);
    const token = await csrfToken(owner);
    const login = await owner.post("/api/auth/login").set("x-csrf-token", token).send({ username, password: "OwnerPass123" });
    expect(login.status).toBe(200);
  });

  afterAll(async () => {
    await store?.close?.();
  });

  it("บันทึก/แก้/ล้างโซน และผังสถานะโต๊ะสะท้อนการจองที่ทับช่วงเวลา", async () => {
    let token = await csrfToken(owner);
    const created = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: `${prefix}D1`, capacity: 4, zone: "dining" });
    expect(created.status).toBe(201);
    expect(created.body.table.zone).toBe("dining");
    const tableId = created.body.table.id as string;

    const moved = await owner.patch(`/api/tables/${tableId}`).set("x-csrf-token", token).send({ zone: "sala" });
    expect(moved.body.table.zone).toBe("sala");
    const kept = await owner.patch(`/api/tables/${tableId}`).set("x-csrf-token", token).send({ capacity: 6 });
    expect(kept.body.table.zone).toBe("sala");

    const customer = request.agent(app);
    token = await csrfToken(customer);
    const phone = `08${String(Date.now()).slice(-8)}`;
    const reg = await customer.post("/api/customers/register").set("x-csrf-token", token).send({ name: "ลูกค้าโซน", phone, password: "Customer123" });
    expect(reg.status).toBe(201);
    const reservedAt = new Date(Date.now() + 3 * 3600_000).toISOString();
    const booked = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send({ tableId, partySize: 2, reservedAt, idempotencyKey: randomUUID() });
    expect(booked.status).toBe(201);

    const overlap = new Date(Date.parse(reservedAt) + 60 * 60_000).toISOString();
    const res = await request(app).get(`/api/reservations/availability?partySize=2&reservedAt=${encodeURIComponent(overlap)}`);
    expect(res.status).toBe(200);
    expect(res.body.tables.find((t: { id: string }) => t.id === tableId)).toEqual({
      id: tableId,
      name: `${prefix}D1`,
      capacity: 6,
      zone: "sala",
      status: "booked",
    });

    const later = new Date(Date.parse(reservedAt) + 3 * 3600_000).toISOString();
    const free = await request(app).get(`/api/reservations/availability?partySize=2&reservedAt=${encodeURIComponent(later)}`);
    expect(free.body.tables.find((t: { id: string }) => t.id === tableId).status).toBe("available");

    token = await csrfToken(owner);
    const cleared = await owner.patch(`/api/tables/${tableId}`).set("x-csrf-token", token).send({ zone: null, isEnabled: false });
    expect(cleared.body.table.zone).toBeNull();
    const hidden = await request(app).get(`/api/reservations/availability?partySize=2&reservedAt=${encodeURIComponent(later)}`);
    expect(hidden.body.tables.some((t: { id: string }) => t.id === tableId)).toBe(false);
  });
});
