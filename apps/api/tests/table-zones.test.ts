import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { buildTableAvailability } from "../src/reservations/validation.js";
import type { ShopTable } from "../src/types.js";

/** จันทร์ 2026-09-14 10:00 กรุงเทพ = 03:00 UTC */
const BASE_NOW = new Date("2026-09-14T03:00:00.000Z");
const H = 3600_000;
const at = (ms: number): string => new Date(BASE_NOW.getTime() + ms).toISOString();

function table(over: Partial<ShopTable>): ShopTable {
  return {
    id: randomUUID(),
    name: "T",
    capacity: 4,
    isEnabled: true,
    zone: null,
    createdAt: BASE_NOW.toISOString(),
    updatedAt: BASE_NOW.toISOString(),
    ...over,
  };
}

describe("buildTableAvailability", () => {
  it("ตัดโต๊ะที่งดใช้งาน เรียงตามโซนแล้วชื่อแบบตัวเลข และบอกสถานะ/โต๊ะแนะนำ", () => {
    const d10 = table({ name: "D10", zone: "dining", capacity: 4 });
    const d2 = table({ name: "D2", zone: "dining", capacity: 2 });
    const f1 = table({ name: "F1", zone: "front", capacity: 6 });
    const x = table({ name: "X1", zone: null, capacity: 8 });
    const off = table({ name: "OFF", zone: "front", isEnabled: false });
    const result = buildTableAvailability([d10, x, off, d2, f1], 3, new Set([f1.id]));
    expect(result.tables.map((t) => t.name)).toEqual(["F1", "D2", "D10", "X1"]);
    expect(result.tables.map((t) => t.status)).toEqual(["booked", "too_small", "available", "available"]);
    expect(result.recommendedTableId).toBe(d10.id);
    expect(Object.keys(result.tables[0]!).sort()).toEqual(["capacity", "id", "name", "status", "zone"]);
  });
});

describe("โซนโต๊ะและผังสถานะโต๊ะสำหรับการจอง (HTTP)", () => {
  let store: Store;
  let app: Express;
  let owner: Agent;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    return res.body.csrfToken as string;
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(BASE_NOW) });
    owner = request.agent(app);
    const token = await csrfToken(owner);
    const login = await owner.post("/api/auth/login").set("x-csrf-token", token).send({ username: "owner", password: "OwnerPass123" });
    expect(login.status).toBe(200);
  });

  it("สร้างโต๊ะพร้อมโซน แก้โซน ล้างโซน และปฏิเสธโซนที่ไม่รู้จัก", async () => {
    const token = await csrfToken(owner);
    const created = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "D1", capacity: 4, zone: "dining" });
    expect(created.status).toBe(201);
    expect(created.body.table.zone).toBe("dining");
    const id = created.body.table.id as string;

    const noZone = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "Z1", capacity: 2 });
    expect(noZone.body.table.zone).toBeNull();

    const moved = await owner.patch(`/api/tables/${id}`).set("x-csrf-token", token).send({ zone: "sala" });
    expect(moved.status).toBe(200);
    expect(moved.body.table.zone).toBe("sala");

    const cleared = await owner.patch(`/api/tables/${id}`).set("x-csrf-token", token).send({ zone: null });
    expect(cleared.body.table.zone).toBeNull();

    const bad = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "B1", capacity: 2, zone: "roof" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/โซน/);

    const audit = await owner.get("/api/audit/shop");
    expect(JSON.stringify(audit.body.items)).toContain("โซนศาลากลางแจ้ง");
  });

  it("availability ไม่ต้อง login คืนสถานะโต๊ะ ณ เวลานัด และไม่มีข้อมูลการจอง", async () => {
    const token = await csrfToken(owner);
    const small = (await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "F1", capacity: 2, zone: "front" })).body.table.id as string;
    const big = (await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "D1", capacity: 6, zone: "dining" })).body.table.id as string;

    const customer = request.agent(app);
    const ctoken = await csrfToken(customer);
    const reg = await customer.post("/api/customers/register").set("x-csrf-token", ctoken).send({ name: "ลูกค้า", phone: "0812345678", password: "Customer123" });
    expect(reg.status).toBe(201);
    const booked = await customer
      .post("/api/reservations")
      .set("x-csrf-token", ctoken)
      .send({ tableId: big, partySize: 4, reservedAt: at(3 * H), idempotencyKey: randomUUID() });
    expect(booked.status).toBe(201);

    const guest = request(app);
    const overlapping = await guest.get(`/api/reservations/availability?partySize=4&reservedAt=${encodeURIComponent(at(4 * H))}`);
    expect(overlapping.status).toBe(200);
    expect(overlapping.body.tables).toEqual([
      { id: small, name: "F1", capacity: 2, zone: "front", status: "too_small" },
      { id: big, name: "D1", capacity: 6, zone: "dining", status: "booked" },
    ]);
    expect(overlapping.body.recommendedTableId).toBeNull();

    const later = await guest.get(`/api/reservations/availability?partySize=2&reservedAt=${encodeURIComponent(at(6 * H))}`);
    expect(later.body.tables.map((t: { status: string }) => t.status)).toEqual(["available", "available"]);
    expect(later.body.recommendedTableId).toBe(small);

    const bad = await guest.get("/api/reservations/availability?partySize=0&reservedAt=x");
    expect(bad.status).toBe(400);
    const missing = await guest.get("/api/reservations/availability?partySize=2");
    expect(missing.status).toBe(400);
  });
});
