import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import mysql from "mysql2/promise";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";
import { FakeLineProvider } from "../src/line/fake.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";

const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP real-MySQL customer integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Integration ลูกค้า + LINE กับ MySQL จริงเท่านั้น — TEST_DATABASE_URL แยกจาก production
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่ต่อ/migrate ไม่ได้ → FAIL
 * - ทำความสะอาดข้อมูลทดสอบทั้งหมดหลังจบ
 */
describe.skipIf(!hasTestDb)("Ticket 03 customers + LINE with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `c${Date.now().toString(36)}`;
  const phones: string[] = [];
  let phoneSeq = 0;
  const nextPhone = () => {
    phoneSeq += 1;
    // 10 หลักขึ้นต้น 08: ใช้ timestamp + seq ประกอบ (normalize แล้ว unique)
    const base = `${Date.now().toString().slice(-7)}${String(phoneSeq).padStart(1, "0")}`.slice(-8);
    const phone = `08${base}`;
    phones.push(phone);
    return phone;
  };

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function registerCustomer(name: string, password: string): Promise<{ agent: Agent; id: string }> {
    const phone = nextPhone();
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password });
    expect(res.status).toBe(201);
    return { agent, id: res.body.customer.id as string };
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    admin = await mysql.createConnection(TEST_DATABASE_URL);
    app = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: new FakeLineProvider(),
      lineRedirectUri: "https://shop.example.test/line/callback",
    });
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    const ids = await Promise.all(phones.map((p) => store.findCustomerByPhone(p).then((c) => c?.id).catch(() => undefined)));
    const customerIds = ids.filter((id): id is string => !!id);
    if (customerIds.length > 0) {
      const ph = customerIds.map(() => "?").join(",");
      await admin.query(`DELETE FROM customer_line_tx WHERE customer_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM customer_line_links WHERE customer_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM customer_sessions WHERE customer_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM audit_logs WHERE target_id IN (${ph})`, customerIds);
      await admin.query(`DELETE FROM customers WHERE id IN (${ph})`, customerIds);
    }
    await admin?.end();
    await store?.close?.();
  });

  it("สมัคร/login/me/profile/password บน MySQL จริง (parity กับ memory)", async () => {
    const { agent, id } = await registerCustomer("จริง", "RealPass11");
    expect((await agent.get("/api/customers/me")).body.customer.id).toBe(id);
    const t = await csrfToken(agent);
    const updated = await agent.patch("/api/customers/me").set("x-csrf-token", t).send({ name: "จริงใจ" });
    expect(updated.status).toBe(200);
    expect(updated.body.customer.name).toBe("จริงใจ");
    const t2 = await csrfToken(agent);
    expect(
      (await agent.post("/api/customers/change-password").set("x-csrf-token", t2).send({ currentPassword: "RealPass11", newPassword: "RealPass22" })).status,
    ).toBe(200);
    expect((await agent.get("/api/customers/me")).status).toBe(401);
  });

  it("unique เบอร์/ tx consume/ link conflict บน MySQL จริง", async () => {
    const phone = nextPhone();
    const jar = request.agent(app);
    const t0 = await csrfToken(jar);
    expect(
      (await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ซ้ำ", phone, password: "RealPass11" })).status,
    ).toBe(201);
    const jar2 = request.agent(app);
    const t1 = await csrfToken(jar2);
    expect(
      (await jar2.post("/api/customers/register").set("x-csrf-token", t1).send({ name: "ซ้ำ2", phone, password: "RealPass22" })).status,
    ).toBe(409);

    const customer = (await store.findCustomerByPhone(phone))!;
    await store.createLineTx({ customerId: customer.id, state: "st-mysql-1", nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: null, expiresAt: new Date(Date.now() + 60000).toISOString() });
    expect((await store.consumeLineTx("st-mysql-1", new Date()))!.customerId).toBe(customer.id);
    expect(await store.consumeLineTx("st-mysql-1", new Date())).toBeNull();
    await store.linkLineIdentity(customer.id, { providerSubject: "U-mysql-1" }, {});
    await expect(store.linkLineIdentity(customer.id, { providerSubject: "U-mysql-2" }, {})).rejects.toThrow();
  });

  it("LINE start → callback → unlink ผ่าน HTTP บน MySQL จริง", async () => {
    const { agent } = await registerCustomer("ไลน์", "LinePass11");
    const t = await csrfToken(agent);
    const started = await agent.post("/api/customers/line/start").set("x-csrf-token", t).send({});
    expect(started.status).toBe(201);
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await agent.get("/api/customers/line/callback").query({ code: "mysql-code", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("line=linked");
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(true);
    const t2 = await csrfToken(agent);
    expect((await agent.post("/api/customers/line/unlink").set("x-csrf-token", t2)).status).toBe(200);
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(false);
  });

  it("logout ลบ session + audit customer_logout ใน seam เดียว บน MySQL จริง", async () => {
    const { agent, id } = await registerCustomer("ออก", "LogoutPass11");
    const t = await csrfToken(agent);
    expect((await agent.post("/api/customers/logout").set("x-csrf-token", t)).status).toBe(200);
    expect((await agent.get("/api/customers/me")).status).toBe(401);
    const items = await store.listAudit("customer_", 100);
    expect(items.some((a) => a.action === "customer_logout" && a.targetId === id)).toBe(true);
  });

  it("consumeLineTxWithAudit + peekLineTx parity บน MySQL จริง (consume พร้อม failure audit ใน tx เดียว)", async () => {
    const { id } = await registerCustomer("ซีม", "SeamPass11");
    const state = `st-seam-${Date.now().toString(36)}`;
    await store.createLineTx({ customerId: id, state, nonce: `n-${state}`, codeVerifier: "v".repeat(64), redirectAfter: "/profile", expiresAt: new Date(Date.now() + 60000).toISOString() });
    // peek ไม่เปลี่ยน state
    expect((await store.peekLineTx(state, new Date()))?.customerId).toBe(id);
    expect((await store.peekLineTx(state, new Date()))?.usedAt).toBeNull();
    const tx = await store.consumeLineTxWithAudit(state, new Date(), { ip: "127.0.0.1" }, "แลก authorization code ไม่สำเร็จ");
    expect(tx?.customerId).toBe(id);
    expect(tx?.usedAt).not.toBeNull();
    // one-time: ใช้ซ้ำไม่ได้
    expect(await store.consumeLineTxWithAudit(state, new Date(), {}, "x")).toBeNull();
    expect(await store.peekLineTx(state, new Date())).toBeNull();
    const items = await store.listAudit("customer_", 200);
    const failed = items.filter((a) => a.action === "customer_line_link_failed" && a.targetId === id);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.success).toBe(false);
    // ไม่มี/หมดอายุ → null โดยไม่เขียน audit เพิ่ม
    const before = (await store.listAudit("customer_", 500)).length;
    expect(await store.consumeLineTxWithAudit(`st-missing-${Date.now().toString(36)}`, new Date(), {}, "x")).toBeNull();
    const expState = `st-exp-${Date.now().toString(36)}`;
    await store.createLineTx({ customerId: id, state: expState, nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: null, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await store.consumeLineTxWithAudit(expState, new Date(), {}, "x")).toBeNull();
    expect((await store.listAudit("customer_", 500)).length).toBe(before);
  });

  it("linkLineIdentityWithConsume parity บน MySQL จริง (link + consume + success audit ใน tx เดียว)", async () => {
    const { id } = await registerCustomer("สำเร็จ", "LinkedPass11");
    const state = `st-linked-${Date.now().toString(36)}`;
    const subject = `U-mysql-${Date.now().toString(36)}`;
    await store.createLineTx({ customerId: id, state, nonce: `n-${state}`, codeVerifier: "v".repeat(64), redirectAfter: "/profile", expiresAt: new Date(Date.now() + 60000).toISOString() });
    const done = await store.linkLineIdentityWithConsume(state, new Date(), { providerSubject: subject }, { actorId: id });
    expect(done?.link.providerSubject).toBe(subject);
    expect(done?.tx.usedAt).not.toBeNull();
    expect((await store.getLineLink(id))?.providerSubject).toBe(subject);
    // replay: ใช้ซ้ำไม่ได้
    expect(await store.linkLineIdentityWithConsume(state, new Date(), { providerSubject: "U-other" }, {})).toBeNull();
    expect(await store.peekLineTx(state, new Date())).toBeNull();
    const items = await store.listAudit("customer_", 200);
    expect(items.filter((a) => a.action === "customer_line_linked" && a.targetId === id)).toHaveLength(1);
  });

  it("linkLineIdentityWithConsume parity บน MySQL จริง (link + success audit + consume ใน tx เดียว)", async () => {
    const { id } = await registerCustomer("ลิงก์", "LinkPass11");
    const state = `st-link-${Date.now().toString(36)}`;
    await store.createLineTx({ customerId: id, state, nonce: `n-${state}`, codeVerifier: "v".repeat(64), redirectAfter: "/profile", expiresAt: new Date(Date.now() + 60000).toISOString() });
    const done = await store.linkLineIdentityWithConsume(state, new Date(), { providerSubject: `U-link-${Date.now().toString(36)}`, displayName: "ด" }, { actorId: id, ip: "127.0.0.1" });
    expect(done?.link.customerId).toBe(id);
    expect(done?.tx.usedAt).not.toBeNull();
    expect(await store.getLineLink(id)).not.toBeNull();
    // one-time: ใช้ซ้ำไม่ได้
    expect(await store.linkLineIdentityWithConsume(state, new Date(), { providerSubject: "U-other" }, {})).toBeNull();
    expect(await store.peekLineTx(state, new Date())).toBeNull();
    const items = await store.listAudit("customer_", 200);
    expect(items.filter((a) => a.action === "customer_line_linked" && a.targetId === id)).toHaveLength(1);
    // conflict (sub ซ้ำกับบัญชีแรก) ต้อง rollback การ consume — tx ของบัญชีที่สองยัง peek ได้
    const { id: id2 } = await registerCustomer("ขัด", "Conflict11");
    const state2 = `st-link2-${Date.now().toString(36)}`;
    await store.createLineTx({ customerId: id2, state: state2, nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: null, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await expect(store.linkLineIdentityWithConsume(state2, new Date(), { providerSubject: done!.link.providerSubject }, {})).rejects.toThrow();
    expect(await store.getLineLink(id2)).toBeNull();
    expect((await store.peekLineTx(state2, new Date()))?.customerId).toBe(id2);
  });

  it("migration 004 รันซ้ำได้ (createMysqlStore รอบสองต้องไม่พัง)", async () => {
    const again = await createMysqlStore(TEST_DATABASE_URL);
    const found = await again.listCustomers("", 1);
    expect(Array.isArray(found)).toBe(true);
    await again.close?.();
  });
});
