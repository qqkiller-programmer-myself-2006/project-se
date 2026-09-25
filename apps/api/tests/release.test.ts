import { beforeEach, describe, expect, it, vi } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import {
  REQUEST_ID_HEADER,
  isKnownAuditAction,
  sanitizeForLog,
} from "../src/observability.js";

/**
 * Ticket 14 — release hardening (local-first, ไม่พึ่ง Docker/MySQL/เบราว์เซอร์จริง).
 * ใช้ MemoryStore + fake clock + HTTP seam เดิม ตรวจ:
 * 1. observability (health/ready/request-id/metrics gating)
 * 2. release slice ข้ามบทบาท (customer → staff → admin → owner)
 * 3. duplicate guards (จองชน/ชำระซ้ำ/คะแนนซ้ำ)
 * 4. security/PII (role matrix, CSRF, input limits, redaction, error taxonomy)
 */

const BASE_NOW = new Date("2026-09-14T03:00:00.000Z");
const isoPlus = (ms: number): string => new Date(BASE_NOW.getTime() + ms).toISOString();
const H = 3600_000;

describe("Ticket 14 release hardening (local fake E2E + security + observability)", () => {
  let store: Store;
  let app: Express;
  let now: Date;
  let tableA1: string;
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

  beforeEach(async () => {
    now = new Date(BASE_NOW);
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(now) });
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const t = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "A1", capacity: 4 });
    expect(t.status).toBe(201);
    tableA1 = t.body.table.id as string;
    token = await csrfToken(owner);
    const f = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: "อาหารจานเดียว",
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    expect(f.status).toBe(201);
    foodId = f.body.item.id as string;
    token = await csrfToken(owner);
    const d = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: "เครื่องดื่ม",
      name: "ชาเย็น",
      price: 25,
      kind: "drink",
    });
    expect(d.status).toBe(201);
    drinkId = d.body.item.id as string;
  });

  it("observability: health/ready สะท้อน request-id; metrics เฉพาะ Owner", async () => {
    const anon = request.agent(app);
    const health = await anon.get("/api/health").set(REQUEST_ID_HEADER, "release-probe-1");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.headers[REQUEST_ID_HEADER]).toBe("release-probe-1");

    const generated = await anon.get("/api/health");
    expect(generated.status).toBe(200);
    expect(typeof generated.headers[REQUEST_ID_HEADER]).toBe("string");
    expect(String(generated.headers[REQUEST_ID_HEADER]).length).toBeGreaterThan(0);

    const ready = await anon.get("/api/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.ok).toBe(true);
    expect(ready.headers[REQUEST_ID_HEADER]).toBeDefined();

    // metrics ต้อง login ก่อน (401) และเฉพาะ Owner (admin 403, owner 200)
    expect((await anon.get("/api/metrics/summary")).status).toBe(401);
    const admin = await loginAs("admin1", "AdminPass123");
    const adminMetrics = await admin.get("/api/metrics/summary");
    expect(adminMetrics.status).toBe(403);
    expect(adminMetrics.body.code).toBe("FORBIDDEN");
    const owner = await loginAs("owner", "OwnerPass123");
    const metrics = await owner.get("/api/metrics/summary");
    expect(metrics.status).toBe(200);
    expect(metrics.body.migrationCount).toBe(16);
    expect(typeof metrics.body.version).toBe("string");
  });

  it("release slice: ลูกค้าจอง → สั่ง → จ่ายเงินสด → งานคิวแยกฝ่าย → ใบเสร็จ; ข้ามฝ่ายถูกปฏิเสธ", async () => {
    const customer = await registerCustomer("ลูกค้า รีลีส", "0819990001");
    let token = await csrfToken(customer);
    const reserved = await customer.post("/api/reservations").set("x-csrf-token", token).send({
      tableId: tableA1,
      partySize: 2,
      reservedAt: isoPlus(2 * H),
      idempotencyKey: randomUUID(),
    });
    expect(reserved.status).toBe(201);
    expect(reserved.body.reservation.code).toMatch(/^RSV-\d{8}-[A-Z0-9]{4}$/);

    token = await csrfToken(customer);
    const ordered = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [
        { menuId: foodId, quantity: 1 },
        { menuId: drinkId, quantity: 2 },
      ],
      idempotencyKey: randomUUID(),
    });
    expect(ordered.status).toBe(201);
    const order = ordered.body.order;
    expect(order.total).toBe(100);

    token = await csrfToken(customer);
    const intent = await customer.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 120,
    });
    expect(intent.status).toBe(201);
    const paymentId = intent.body.payment.id as string;

    const owner = await loginAs("owner", "OwnerPass123");
    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${paymentId}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: 120, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("paid");
    expect(confirmed.body.receipt.receiptNumber).toMatch(/^RCP-\d{8}-[A-Z0-9]{4}$/);
    expect(confirmed.body.payment.changeAmount).toBe(20);

    token = await csrfToken(owner);
    const ensured = await owner.post("/api/queue/ensure").set("x-csrf-token", token).send({ paymentId });
    expect([200, 201]).toContain(ensured.status);
    const stations = (ensured.body.jobs as { station: string }[]).map((j) => j.station).sort();
    expect(stations).toEqual(["drink", "kitchen"]);

    // ensure ซ้ำเป็น no-op (ไม่สร้าง job/audit ซ้ำ)
    token = await csrfToken(owner);
    const replay = await owner.post("/api/queue/ensure").set("x-csrf-token", token).send({ paymentId });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);

    const jobs = ensured.body.jobs as { id: string; station: string }[];
    const kitchenJob = jobs.find((j) => j.station === "kitchen")!;
    const kitchen = await loginAs("kitchen1", "Kitchen123");
    token = await csrfToken(kitchen);
    const claimed = await kitchen.post(`/api/queue/${kitchenJob.id}/claim`).set("x-csrf-token", token).send({});
    expect(claimed.status).toBe(200);

    // ผู้ดูแลเครื่องดื่มแตะงานครัวไม่ได้ (403 + error code)
    const drink = await loginAs("drink1", "DrinkPass1");
    token = await csrfToken(drink);
    const cross = await drink.post(`/api/queue/${kitchenJob.id}/claim`).set("x-csrf-token", token).send({});
    expect(cross.status).toBe(403);
    expect(typeof cross.body.error).toBe("string");
  });

  it("duplicate guards: จองชนกันสำเร็จรายการเดียว; คำสั่งซื้อ/ชำระเงิน replay ไม่สร้างซ้ำ", async () => {
    const customer = await registerCustomer("ลูกค้า แข่ง", "0819990002");
    const at = isoPlus(3 * H);
    const [a, b] = await Promise.all(
      [randomUUID(), randomUUID()].map(async (key) => {
        const token = await csrfToken(customer);
        return customer.post("/api/reservations").set("x-csrf-token", token).send({
          tableId: tableA1,
          partySize: 2,
          reservedAt: at,
          idempotencyKey: key,
        });
      }),
    );
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(winner.body.reservation.code).toMatch(/^RSV-\d{8}-[A-Z0-9]{4}$/);
    expect(JSON.stringify(loser.body)).not.toContain("RSV-");
    expect(loser.body.code).toBe("CONFLICT");

    const key = randomUUID();
    const payload = {
      serviceType: "takeaway",
      items: [{ menuId: foodId, quantity: 1 }],
      guestName: "คุณมินตรา",
      guestPhone: "0812345678",
      idempotencyKey: key,
    };
    const anon = request.agent(app);
    let token = await csrfToken(anon);
    const first = await anon.post("/api/orders").set("x-csrf-token", token).send(payload);
    expect(first.status).toBe(201);
    token = await csrfToken(anon);
    const second = await anon.post("/api/orders").set("x-csrf-token", token).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.deduplicated).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);

    const orderId = first.body.order.id as string;
    const payKey = randomUUID();
    token = await csrfToken(anon);
    const p1 = await anon.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: payKey,
      receivedAmount: 50,
      phone: "0812345678",
    });
    expect(p1.status).toBe(201);
    token = await csrfToken(anon);
    const p2 = await anon.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: payKey,
      receivedAmount: 50,
      phone: "0812345678",
    });
    expect(p2.status).toBe(200);
    expect(p2.body.deduplicated).toBe(true);
    expect(p2.body.payment.id).toBe(p1.body.payment.id);
  });

  it("security/PII: role matrix + CSRF + input limits + redaction + error taxonomy", async () => {
    const kitchen = await loginAs("kitchen1", "Kitchen123");
    const usersByKitchen = await kitchen.get("/api/users");
    expect(usersByKitchen.status).toBe(403);
    expect(usersByKitchen.body.code).toBe("FORBIDDEN");

    // ไม่มี CSRF token → 403 (login ต้องมี CSRF ด้วย)
    const anon = request.agent(app);
    const noCsrf = await anon.post("/api/auth/login").send({ username: "owner", password: "OwnerPass123" });
    expect(noCsrf.status).toBe(403);

    // ลูกค้าแตะหลังร้านไม่ได้ (401/403 ก็ได้ แต่ต้องไม่ใช่ 200); kitchen แตะ audit ลูกค้าไม่ได้ (403)
    const customer = await registerCustomer("ลูกค้า เกต", "0819990003");
    expect([401, 403]).toContain((await customer.get("/api/admin/customers")).status);
    expect((await kitchen.get("/api/audit/customers")).status).toBe(403);

    // input limits: ชื่อโต๊ะยาวเกินถูกปฏิเสธ 400 (ไม่ 500/เงียบ)
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const tooLong = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "T".repeat(65), capacity: 2 });
    expect(tooLong.status).toBe(400);

    // public snapshot ไม่มี PII
    const status = await anon.get("/api/shop/status");
    expect(status.status).toBe(200);
    const rawStatus = JSON.stringify(status.body);
    for (const leak of ["081999", "passwordHash", "token", "secret", "line_sub", "providerSubject"]) {
      expect(rawStatus).not.toContain(leak);
    }

    // audit ลูกค้า mask เบอร์ (08******) และไม่มี hash/token
    const audits = await owner.get("/api/audit/customers?limit=50");
    expect(audits.status).toBe(200);
    const rawAudit = JSON.stringify(audits.body);
    expect(rawAudit).not.toContain("passwordHash");
    expect(rawAudit).not.toContain("Customer123");

    // error taxonomy: conflict มี code เสมอ
    token = await csrfToken(owner);
    const dup1 = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "ซ้ำ", capacity: 2 });
    expect(dup1.status).toBe(201);
    token = await csrfToken(owner);
    const dup2 = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "ซ้ำ", capacity: 2 });
    expect(dup2.status).toBe(409);
    expect(dup2.body.code).toBe("CONFLICT");
  });

  it("audit taxonomy + log redaction: ทุก action อยู่ใน catalog; secret ถูก redact", () => {
    expect(isKnownAuditAction("payment_paid")).toBe(true);
    expect(isKnownAuditAction("definitely_not_an_action")).toBe(false);
    const cleaned = sanitizeForLog({
      username: "owner",
      passwordHash: "hash-abc",
      lineSub: "U123",
      nested: { accessToken: "tok", amount: 50 },
      phone: "0812345678",
    }) as Record<string, unknown>;
    expect(cleaned["passwordHash"]).toBe("[REDACTED]");
    expect(cleaned["lineSub"]).toBe("[REDACTED]");
    expect((cleaned["nested"] as Record<string, unknown>)["accessToken"]).toBe("[REDACTED]");
    expect(cleaned["username"]).toBe("owner");
    expect(cleaned["phone"]).toBe("08******78");
  });

  it("500 ที่ไม่คาดคิดถูก log ฝั่ง server พร้อม request-id โดยไม่รั่ว secret", async () => {
    // จำลอง DB พังระหว่างอ่านเมนูสาธารณะ
    store.listPublicMenuWithOptions = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", sessionToken: "s3cr3t" });
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await request(app).get("/api/menu/public").set(REQUEST_ID_HEADER, "boom-1");
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "เกิดข้อผิดพลาดภายในระบบ", code: "INTERNAL" });
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = String(spy.mock.calls[0]![0]);
      expect(logged).toContain("boom-1");
      expect(logged).toContain("ECONNREFUSED");
      expect(logged).toContain("/api/menu/public");
      expect(logged).not.toContain("s3cr3t");
    } finally {
      spy.mockRestore();
    }
  });

  it("audit ที่เขียนจริงทั้งหมดใช้ action ที่รู้จัก (กัน typo ของ action ใหม่)", async () => {
    const customer = await registerCustomer("ลูกค้า ออดิต", "0819990004");
    const token = await csrfToken(customer);
    await customer.post("/api/reservations").set("x-csrf-token", token).send({
      tableId: tableA1,
      partySize: 2,
      reservedAt: isoPlus(4 * H),
      idempotencyKey: randomUUID(),
    });
    const items = await store.listAudit("all", 500);
    expect(items.length).toBeGreaterThan(0);
    const unknown = items.filter((a) => !isKnownAuditAction(String(a.action)));
    expect(unknown).toEqual([]);
  });
});
