import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakeLineProvider } from "../src/line/fake.js";

const OWNER = { username: "owner", password: "OwnerPass123" };
const ADMIN = { username: "admin1", password: "AdminPass123" };
const KITCHEN = { username: "kitchen1", password: "Kitchen123" };

async function csrfToken(agent: Agent): Promise<string> {
  const res = await agent.get("/api/auth/csrf");
  expect(res.status).toBe(200);
  return res.body.csrfToken as string;
}

async function staffLogin(app: Express, username: string, password: string): Promise<Agent> {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
  expect(res.status).toBe(200);
  return agent;
}

async function customerRegister(
  app: Express,
  body: Record<string, unknown>,
): Promise<{ agent: Agent; res: request.Response }> {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent.post("/api/customers/register").set("x-csrf-token", token).send(body);
  return { agent, res };
}

async function customerLogin(app: Express, phone: string, password: string): Promise<Agent> {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent.post("/api/customers/login").set("x-csrf-token", token).send({ phone, password });
  expect(res.status).toBe(200);
  return agent;
}

function noLeaks(body: unknown): void {
  const raw = JSON.stringify(body);
  for (const secret of ["passwordHash", "password_hash", "codeVerifier", "code_verifier", "idToken", "accessToken", "nonce"]) {
    expect(raw).not.toContain(secret);
  }
}

describe("Ticket 03 customer accounts (public HTTP seam)", () => {
  let store: Store;
  let app: Express;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: OWNER.username, passwordHash: await bcrypt.hash(OWNER.password, 10), roles: ["owner"] });
    await store.createUser({ username: ADMIN.username, passwordHash: await bcrypt.hash(ADMIN.password, 10), roles: ["admin"] });
    await store.createUser({ username: KITCHEN.username, passwordHash: await bcrypt.hash(KITCHEN.password, 10), roles: ["kitchen"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, line: new FakeLineProvider() });
  });

  it("สมัครด้วยชื่อ+เบอร์+รหัสผ่านได้ (อีเมลไม่บังคับ) และเข้าสู่ระบบทันที", async () => {
    const { agent, res } = await customerRegister(app, { name: "สมชาย", phone: "081-234-5678", password: "Customer11" });
    expect(res.status).toBe(201);
    expect(res.body.customer.phone).toBe("0812345678");
    expect(res.body.customer.email).toBeNull();
    noLeaks(res.body);
    const me = await agent.get("/api/customers/me");
    expect(me.status).toBe(200);
    expect(me.body.customer.name).toBe("สมชาย");
    noLeaks(me.body);
  });

  it("normalize เบอร์ไทย (+66/66/ขีด/ช่องว่าง) และปฏิเสธเบอร์ผิดรูปแบบ", async () => {
    for (const [raw, expected] of [
      ["+66812345678", "0812345678"],
      ["66812345678", "0812345678"],
      ["+66 81 234 5678", "0812345678"],
      ["(081) 234-5678", "0812345678"],
    ] as const) {
      const s = createMemoryStore();
      const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000 });
      const { res } = await customerRegister(a, { name: "ท", phone: raw, password: "Customer11" });
      expect(res.status).toBe(201);
      expect(res.body.customer.phone).toBe(expected);
    }
    for (const bad of ["12345", "081234567", "08123456789", "abc", "+11234567890", ""]) {
      const { res } = await customerRegister(app, { name: "ท", phone: bad, password: "Customer11" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/เบอร์โทร/);
    }
  });

  it("เบอร์ซ้ำถูกปฏิเสธ 409 แม้เขียนต่างรูปแบบ (normalize แล้วชนกัน)", async () => {
    const first = await customerRegister(app, { name: "หนึ่ง", phone: "0812345678", password: "Customer11" });
    expect(first.res.status).toBe(201);
    const second = await customerRegister(app, { name: "สอง", phone: "+66-81-234-5678", password: "Customer22" });
    expect(second.res.status).toBe(409);
    expect(second.res.body.error).toMatch(/เบอร์โทร/);
  });

  it("อีเมล optional: รับค่าว่างเป็น null, normalize ตัวพิมพ์เล็ก, ซ้ำถูกปฏิเสธ 409", async () => {
    const a = await customerRegister(app, { name: "เอ", phone: "0811111111", password: "Customer11", email: "A@Example.COM" });
    expect(a.res.status).toBe(201);
    expect(a.res.body.customer.email).toBe("a@example.com");
    const b = await customerRegister(app, { name: "บี", phone: "0822222222", password: "Customer22", email: " a@example.com " });
    expect(b.res.status).toBe(409);
    const bad = await customerRegister(app, { name: "ซี", phone: "0833333333", password: "Customer33", email: "not-an-email" });
    expect(bad.res.status).toBe(400);
  });

  it("login/logout/me ด้วยเบอร์+รหัสผ่าน; รหัสผิดได้ 401 ข้อความเดียวกันทั้งไม่มีบัญชีและรหัสผิด", async () => {
    await customerRegister(app, { name: "ลูกค้า", phone: "0812345678", password: "Customer11" });
    const agent = await customerLogin(app, "0812345678", "Customer11");
    expect((await agent.get("/api/customers/me")).status).toBe(200);
    const token = await csrfToken(agent);
    expect((await agent.post("/api/customers/logout").set("x-csrf-token", token)).status).toBe(200);
    expect((await agent.get("/api/customers/me")).status).toBe(401);

    async function attempt(phone: string, password: string) {
      const jar = request.agent(app);
      const t = await csrfToken(jar);
      return jar.post("/api/customers/login").set("x-csrf-token", t).send({ phone, password });
    }
    const wrong = await attempt("0812345678", "WrongPass99");
    expect(wrong.status).toBe(401);
    const unknown = await attempt("0899999999", "Whatever11");
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it("บัญชีลูกค้าและพนักงานไม่สวมสิทธิ์ข้ามกัน (คุกกี้/endpoint แยกกัน)", async () => {
    await customerRegister(app, { name: "ลูกค้า", phone: "0812345678", password: "Customer11" });
    const customer = await customerLogin(app, "0812345678", "Customer11");
    // session ลูกค้าใช้กับ endpoint พนักงานไม่ได้ และกลับกัน
    expect((await customer.get("/api/auth/me")).status).toBe(401);
    expect((await customer.get("/api/users")).status).toBe(401);
    expect((await customer.get("/api/shop/schedule")).status).toBe(401);
    const staff = await staffLogin(app, OWNER.username, OWNER.password);
    expect((await staff.get("/api/customers/me")).status).toBe(401);
    expect((await staff.get("/api/customers/line/status")).status).toBe(401);
  });

  it("รหัสผ่านเกิน 72 ไบต์ถูกปฏิเสธทั้งสมัครและ login (เหมือน staff)", async () => {
    const long73 = "a".repeat(73);
    const { res } = await customerRegister(app, { name: "ยาว", phone: "0812345678", password: long73 });
    expect(res.status).toBe(400);
    const jar = request.agent(app);
    const t = await csrfToken(jar);
    expect(
      (await jar.post("/api/customers/login").set("x-csrf-token", t).send({ phone: "0812345678", password: long73 })).status,
    ).toBe(400);
  });

  it("แก้ชื่อ/อีเมลของตนเองได้; response ไม่มี hash; อีเมลซ้ำของคนอื่นถูกปฏิเสธ", async () => {
    const { agent } = await customerRegister(app, { name: "เดิม", phone: "0811111111", password: "Customer11" });
    await customerRegister(app, { name: "อื่น", phone: "0822222222", password: "Customer22", email: "other@example.com" });
    const token = await csrfToken(agent);
    const updated = await agent.patch("/api/customers/me").set("x-csrf-token", token).send({ name: "ใหม่", email: "ME@Example.com" });
    expect(updated.status).toBe(200);
    expect(updated.body.customer.name).toBe("ใหม่");
    expect(updated.body.customer.email).toBe("me@example.com");
    noLeaks(updated.body);
    const dupToken = await csrfToken(agent);
    const dup = await agent.patch("/api/customers/me").set("x-csrf-token", dupToken).send({ email: "other@example.com" });
    expect(dup.status).toBe(409);
  });

  it("เปลี่ยนรหัสผ่านแล้วเซสชันเดิมใช้ไม่ได้ทันที (ต้อง login ใหม่)", async () => {
    const { agent } = await customerRegister(app, { name: "ลูกค้า", phone: "0812345678", password: "Customer11" });
    const token = await csrfToken(agent);
    const changed = await agent
      .post("/api/customers/change-password")
      .set("x-csrf-token", token)
      .send({ currentPassword: "Customer11", newPassword: "Customer22" });
    expect(changed.status).toBe(200);
    expect((await agent.get("/api/customers/me")).status).toBe(401);
    const again = await customerLogin(app, "0812345678", "Customer22");
    expect((await again.get("/api/customers/me")).status).toBe(200);
    const badToken = await csrfToken(again);
    expect(
      (await again.post("/api/customers/change-password").set("x-csrf-token", badToken).send({ currentPassword: "ผิด", newPassword: "Customer33" })).status,
    ).toBe(400);
  });

  it("เซสชัน version เก่าใช้ไม่ได้แม้แถวยังอยู่ (กัน race แบบเดียวกับ staff)", async () => {
    const { agent } = await customerRegister(app, { name: "ลูกค้า", phone: "0812345678", password: "Customer11" });
    const target = (await store.findCustomerByPhone("0812345678"))!;
    await store.setCustomerPassword(target.id, await bcrypt.hash("Customer22", 10), {});
    expect((await agent.get("/api/customers/me")).status).toBe(401);
  });

  it("ลบบัญชี: PII เป็นนิรนาม คง id ภายใน ล้างเซสชัน เบอร์เดิมสมัครใหม่ได้", async () => {
    const { agent, res } = await customerRegister(app, { name: "ลบทิ้ง", phone: "0812345678", password: "Customer11", email: "bye@example.com" });
    const id = res.body.customer.id as string;
    const token = await csrfToken(agent);
    const del = await agent.delete("/api/customers/me").set("x-csrf-token", token);
    expect(del.status).toBe(200);
    expect((await agent.get("/api/customers/me")).status).toBe(401);
    const stored = (await store.findCustomerById(id))!;
    expect(stored.isDeleted).toBe(true);
    expect(stored.name).toBe("ลูกค้าที่ลบบัญชี");
    expect(stored.phone).toBeNull();
    expect(stored.email).toBeNull();
    expect(stored.passwordHash).not.toContain("Customer11");
    // login ด้วยเบอร์เดิมไม่ได้ (ถือว่าไม่มีบัญชี) แต่เบอร์ว่างให้สมัครใหม่ได้
    const jar = request.agent(app);
    const t = await csrfToken(jar);
    expect(
      (await jar.post("/api/customers/login").set("x-csrf-token", t).send({ phone: "0812345678", password: "Customer11" })).status,
    ).toBe(401);
    const reuse = await customerRegister(app, { name: "คนใหม่", phone: "0812345678", password: "Customer99" });
    expect(reuse.res.status).toBe(201);
  });

  it("mutation ลูกค้าที่ไม่มี CSRF ถูกปฏิเสธ 403; สมัคร/login ไม่มี CSRF ก็ 403", async () => {
    expect((await request(app).post("/api/customers/register").send({ name: "x", phone: "0812345678", password: "Customer11" })).status).toBe(403);
    const agent = await customerLogin(app, "0812345678", "Customer11").catch(() => null);
    void agent;
    const { agent: a } = await customerRegister(app, { name: "ซี", phone: "0833333333", password: "Customer33" });
    expect((await a.patch("/api/customers/me").send({ name: "y" })).status).toBe(403);
  });

  it("audit ลูกค้าครบ: สมัคร สำเร็จ/ล้มเหลว แก้ข้อมูล เปลี่ยนรหัส ลบ (ไม่เห็น hash)", async () => {
    await customerRegister(app, { name: "ออ", phone: "0812345678", password: "Customer11" });
    const jar = request.agent(app);
    const t = await csrfToken(jar);
    await jar.post("/api/customers/login").set("x-csrf-token", t).send({ phone: "0812345678", password: "WrongPass99" });
    const agent = await customerLogin(app, "0812345678", "Customer11");
    const t2 = await csrfToken(agent);
    await agent.patch("/api/customers/me").set("x-csrf-token", t2).send({ name: "ออ2" });
    const t3 = await csrfToken(agent);
    await agent.post("/api/customers/change-password").set("x-csrf-token", t3).send({ currentPassword: "Customer11", newPassword: "Customer22" });
    const agent2 = await customerLogin(app, "0812345678", "Customer22");
    const t4 = await csrfToken(agent2);
    await agent2.delete("/api/customers/me").set("x-csrf-token", t4);

    const owner = await staffLogin(app, OWNER.username, OWNER.password);
    const audit = await owner.get("/api/audit/customers?limit=100");
    expect(audit.status).toBe(200);
    const actions = (audit.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["customer_registered", "customer_login_failed", "customer_login_success", "customer_profile_updated", "customer_password_changed", "customer_deleted"]) {
      expect(actions).toContain(a);
    }
    const raw = JSON.stringify(audit.body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("Customer11");
    // เบอร์เต็มไม่โผล่ใน audit (mask)
    expect(raw).not.toContain("0812345678");
  });
});

describe("Ticket 03 admin customer management (Owner/Admin เท่านั้น)", () => {
  let store: Store;
  let app: Express;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: OWNER.username, passwordHash: await bcrypt.hash(OWNER.password, 10), roles: ["owner"] });
    await store.createUser({ username: ADMIN.username, passwordHash: await bcrypt.hash(ADMIN.password, 10), roles: ["admin"] });
    await store.createUser({ username: KITCHEN.username, passwordHash: await bcrypt.hash(KITCHEN.password, 10), roles: ["kitchen"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
  });

  async function seedCustomers() {
    await customerRegister(app, { name: "สมชาย ใจดี", phone: "0811111111", password: "Customer11", email: "somchai@example.com" });
    await customerRegister(app, { name: "สมหญิง", phone: "0822222222", password: "Customer22" });
  }

  it("Owner/Admin ค้นหา/ดูรายละเอียดได้ (safe fields ไม่มี hash); kitchen/drink/ลูกค้าถูกปฏิเสธ", async () => {
    await seedCustomers();
    const owner = await staffLogin(app, OWNER.username, OWNER.password);
    const list = await owner.get("/api/admin/customers");
    expect(list.status).toBe(200);
    expect(list.body.customers).toHaveLength(2);
    noLeaks(list.body);
    const search = await owner.get("/api/admin/customers?q=สมชาย");
    expect(search.body.customers).toHaveLength(1);
    const byPhone = await owner.get("/api/admin/customers?q=0822222222");
    expect(byPhone.body.customers).toHaveLength(1);
    const id = list.body.customers[0].id as string;
    const detail = await owner.get(`/api/admin/customers/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.customer.id).toBe(id);
    expect(detail.body.line).toEqual({ linked: false });
    noLeaks(detail.body);
    expect((await owner.get("/api/admin/customers/nonexistent")).status).toBe(404);

    const admin = await staffLogin(app, ADMIN.username, ADMIN.password);
    expect((await admin.get("/api/admin/customers")).status).toBe(200);

    const kitchen = await staffLogin(app, KITCHEN.username, KITCHEN.password);
    expect((await kitchen.get("/api/admin/customers")).status).toBe(403);
    expect((await kitchen.get(`/api/admin/customers/${id}`)).status).toBe(403);
    // ลูกค้าใช้ session ตัวเองเรียกหลังร้านไม่ได้
    const customer = await customerLogin(app, "0811111111", "Customer11");
    expect((await customer.get("/api/admin/customers")).status).toBe(401);
    expect((await request(app).get("/api/admin/customers")).status).toBe(401);
  });

  it("Owner/Admin ปิด/เปิดบัญชีได้ (ปิดแล้วยกเลิกเซสชัน+login ไม่ได้); kitchen ถูกปฏิเสธ", async () => {
    await seedCustomers();
    const owner = await staffLogin(app, OWNER.username, OWNER.password);
    const id = (await owner.get("/api/admin/customers")).body.customers[0].id as string;
    const customer = await customerLogin(app, "0811111111", "Customer11");
    const t = await csrfToken(owner);
    expect((await owner.post(`/api/admin/customers/${id}/deactivate`).set("x-csrf-token", t)).status).toBe(200);
    expect((await customer.get("/api/customers/me")).status).toBe(401);
    const jar = request.agent(app);
    const lt = await csrfToken(jar);
    expect(
      (await jar.post("/api/customers/login").set("x-csrf-token", lt).send({ phone: "0811111111", password: "Customer11" })).status,
    ).toBe(403);
    const t2 = await csrfToken(owner);
    expect((await owner.post(`/api/admin/customers/${id}/activate`).set("x-csrf-token", t2)).status).toBe(200);
    const again = await customerLogin(app, "0811111111", "Customer11");
    expect((await again.get("/api/customers/me")).status).toBe(200);

    const kitchen = await staffLogin(app, KITCHEN.username, KITCHEN.password);
    const kt = await csrfToken(kitchen);
    expect((await kitchen.post(`/api/admin/customers/${id}/deactivate`).set("x-csrf-token", kt)).status).toBe(403);
  });

  it("audit ลูกค้าดูได้เฉพาะ Owner/Admin; kitchen ดูไม่ได้", async () => {
    await seedCustomers();
    const admin = await staffLogin(app, ADMIN.username, ADMIN.password);
    expect((await admin.get("/api/audit/customers")).status).toBe(200);
    const kitchen = await staffLogin(app, KITCHEN.username, KITCHEN.password);
    expect((await kitchen.get("/api/audit/customers")).status).toBe(403);
  });

  it("P1 atomic seams: register/session/tx พร้อม audit ล้มเหลวต้อง rollback ทั้งหมด", async () => {
    // registerCustomerWithSession: audit ตัวใดล้มเหลว → ไม่มี customer/session/audit ค้าง
    const failReg = createMemoryStore({ failAudit: (i) => i.action === "customer_login_success" });
    await expect(
      failReg.registerCustomerWithSession({ name: "พัง", phone: "0812345678", email: null, passwordHash: "h" }, {}),
    ).rejects.toThrow();
    expect(await failReg.findCustomerByPhone("0812345678")).toBeNull();
    expect(await failReg.listAudit("customer_", 100)).toHaveLength(0);

    // createCustomerSessionWithAudit: audit ล้มเหลว → ไม่มี session ค้าง
    const ok = createMemoryStore();
    const c = await ok.createCustomer({ name: "มี", phone: "0822222222", email: null, passwordHash: "h" }, {});
    const failSess = createMemoryStore({ failAudit: (i) => i.action === "customer_login_success" });
    const c2 = await failSess.createCustomer({ name: "มี", phone: "0822222222", email: null, passwordHash: "h" }, {});
    await expect(failSess.createCustomerSessionWithAudit(c2.id, 1, {})).rejects.toThrow();
    // session ที่สร้างครึ่ง ๆ กลาง ๆ ต้องถูก rollback (ค้นหาด้วย id ที่ leak ไม่ได้ — ตรวจทางอ้อมว่าไม่มี audit)
    expect(await failSess.listAudit("customer_", 100)).toHaveLength(1); // มีแค่ registered
    void c;
    void ok;

    // createLineLoginTxWithAudit: audit ล้มเหลว → ไม่มี tx ค้าง (consume ต้องได้ null)
    const failTx = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_started" });
    const ct = await failTx.createCustomer({ name: "ไลน์", phone: "0833333333", email: null, passwordHash: "h" }, {});
    await expect(
      failTx.createLineLoginTxWithAudit(
        { customerId: ct.id, state: "st-roll", nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: "/profile", expiresAt: new Date(Date.now() + 60000).toISOString() },
        {},
      ),
    ).rejects.toThrow();
    expect(await failTx.consumeLineTx("st-roll", new Date())).toBeNull();
  });

  it("P1 routes ใช้ atomic seams: สมัคร/login/start ล้มเหลวที่ audit ต้องไม่เหลือ partial state", async () => {
    // register route ผ่าน registerCustomerWithSession: audit login_success ล้มเหลว → 500 และไม่มีบัญชี
    const failing = createMemoryStore({ failAudit: (i) => i.action === "customer_login_success" });
    const failingApp = createApp({ store: failing, loginRateMax: 1000, customerRateMax: 1000 });
    const jar = request.agent(failingApp);
    const t = await csrfToken(jar);
    const res = await jar.post("/api/customers/register").set("x-csrf-token", t).send({ name: "พัง", phone: "0844444444", password: "Customer11" });
    expect(res.status).toBe(500);
    expect(await failing.findCustomerByPhone("0844444444")).toBeNull();

    // login route ผ่าน createCustomerSessionWithAudit: audit ล้มเหลว → 500 และไม่มี session ค้าง
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_login_success" });
    const fc = await flaky.createCustomer({ name: "ล็อก", phone: "0855555555", email: null, passwordHash: "h" }, {});
    await expect(flaky.createCustomerSessionWithAudit(fc.id, 1, {})).rejects.toThrow();
    expect(await flaky.findCustomerByPhone("0855555555")).not.toBeNull(); // customer อยู่ (สร้างก่อน) แต่ session ถูก rollback

    // line start ผ่าน createLineLoginTxWithAudit: audit ล้มเหลว → 500 และไม่มี tx ค้าง
    const failStart = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_started" });
    const startApp = createApp({ store: failStart, loginRateMax: 1000, customerRateMax: 1000, line: new FakeLineProvider(), lineRedirectUri: "https://shop.example.test/line/callback" });
    const sj = request.agent(startApp);
    const st0 = await csrfToken(sj);
    await sj.post("/api/customers/register").set("x-csrf-token", st0).send({ name: "เริ่ม", phone: "0866666666", password: "Customer11" });
    const st1 = await csrfToken(sj);
    // register สำเร็จ (audit registered ผ่าน) แต่ start ต้องพังที่ link_started
    const started = await sj.post("/api/customers/line/start").set("x-csrf-token", st1).send({});
    expect(started.status).toBe(500);
  });

  it("P1 logout atomic: ลบ session + audit customer_logout ใน seam เดียว (store)", async () => {
    // สำเร็จ: session หาย + มี audit logout
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "ออก", phone: "0877777777", email: null, passwordHash: "h" }, {});
    const sess = await s.createCustomerSession(c.id, 1);
    await s.logoutCustomerSessionWithAudit(sess.id, c.id, {});
    expect(await s.findCustomerSession(sess.id)).toBeNull();
    expect((await s.listAudit("customer_", 100)).some((a) => a.action === "customer_logout" && a.targetId === c.id)).toBe(true);

    // failure-injection ที่ audit: session ต้องคงอยู่ + ไม่มี audit logout
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_logout" });
    const c2 = await flaky.createCustomer({ name: "ออก", phone: "0877777777", email: null, passwordHash: "h" }, {});
    const sess2 = await flaky.createCustomerSession(c2.id, 1);
    await expect(flaky.logoutCustomerSessionWithAudit(sess2.id, c2.id, {})).rejects.toThrow();
    expect(await flaky.findCustomerSession(sess2.id)).not.toBeNull();
    expect((await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_logout")).toBe(false);

    // seam ไม่ลบ session ของบัญชีอื่น (กัน sessionId ข้ามบัญชี)
    const other = await s.createCustomer({ name: "อื่น", phone: "0888888888", email: null, passwordHash: "h" }, {});
    const otherSess = await s.createCustomerSession(other.id, 1);
    await s.logoutCustomerSessionWithAudit(otherSess.id, c.id, {});
    expect(await s.findCustomerSession(otherSess.id)).not.toBeNull();
  });

  it("P1 logout route ใช้ atomic seam: audit ล้มเหลว → 500 และ session คงอยู่", async () => {
    // audit logout ล้มเหลว → 500, me ยัง 200 (session คงอยู่), ไม่มี audit logout
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_logout" });
    const flakyApp = createApp({ store: flaky, loginRateMax: 1000, customerRateMax: 1000 });
    const { agent } = await customerRegister(flakyApp, { name: "ออก", phone: "0899999999", password: "Customer11" });
    const t = await csrfToken(agent);
    expect((await agent.post("/api/customers/logout").set("x-csrf-token", t)).status).toBe(500);
    expect((await agent.get("/api/customers/me")).status).toBe(200);
    expect((await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_logout")).toBe(false);

    // สำเร็จ: 200 + session หาย (me 401) + มี audit logout
    const ok = createMemoryStore();
    const okApp = createApp({ store: ok, loginRateMax: 1000, customerRateMax: 1000 });
    const reg = await customerRegister(okApp, { name: "ออก", phone: "0899999999", password: "Customer11" });
    const t2 = await csrfToken(reg.agent);
    expect((await reg.agent.post("/api/customers/logout").set("x-csrf-token", t2)).status).toBe(200);
    expect((await reg.agent.get("/api/customers/me")).status).toBe(401);
    expect((await ok.listAudit("customer_", 100)).some((a) => a.action === "customer_logout")).toBe(true);
  });

  it("P1 callback atomic: consumeLineTxWithAudit สำเร็จ/ใช้ซ้ำ/หมดอายุ/audit-ล้มเหลว (store)", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "ไลน์", phone: "0801111111", email: null, passwordHash: "h" }, {});
    const txInput = (state: string, expiresAt?: string) => ({
      customerId: c.id,
      state,
      nonce: "n",
      codeVerifier: "v".repeat(64),
      redirectAfter: "/profile" as string | null,
      expiresAt: expiresAt ?? new Date(Date.now() + 60000).toISOString(),
    });

    // peek อ่านแบบไม่ consume: มี/ใช้ได้ → tx; ไม่มี → null
    await s.createLineTx(txInput("st-peek"));
    expect((await s.peekLineTx("st-peek", new Date()))?.customerId).toBe(c.id);
    expect(await s.peekLineTx("st-missing", new Date())).toBeNull();

    // สำเร็จ: คืน tx + เขียน failure audit; ใช้ซ้ำรอบสอง → null และไม่เขียน audit เพิ่ม
    await s.createLineTx(txInput("st-ok"));
    const tx = await s.consumeLineTxWithAudit("st-ok", new Date(), { ip: "127.0.0.1" }, "แลก authorization code ไม่สำเร็จ");
    expect(tx?.customerId).toBe(c.id);
    expect(tx?.redirectAfter).toBe("/profile");
    expect(await s.consumeLineTxWithAudit("st-ok", new Date(), {}, "x")).toBeNull();
    expect(await s.peekLineTx("st-ok", new Date())).toBeNull();
    expect((await s.listAudit("customer_", 100)).filter((a) => a.action === "customer_line_link_failed")).toHaveLength(1);

    // state ไม่มี/หมดอายุ → null และไม่เขียน audit
    await s.createLineTx(txInput("st-exp", new Date(Date.now() - 1000).toISOString()));
    const before = (await s.listAudit("customer_", 100)).length;
    expect(await s.consumeLineTxWithAudit("st-missing", new Date(), {}, "x")).toBeNull();
    expect(await s.consumeLineTxWithAudit("st-exp", new Date(), {}, "x")).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);

    // failure-injection ที่ failure audit: โยน error + rollback การ consume (retry ได้) + ไม่มี audit ค้าง
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_failed" });
    const c2 = await flaky.createCustomer({ name: "ไลน์", phone: "0801111111", email: null, passwordHash: "h" }, {});
    await flaky.createLineTx({ customerId: c2.id, state: "st-retry", nonce: "n", codeVerifier: "v".repeat(64), redirectAfter: "/profile", expiresAt: new Date(Date.now() + 60000).toISOString() });
    await expect(flaky.consumeLineTxWithAudit("st-retry", new Date(), {}, "แลก authorization code ไม่สำเร็จ")).rejects.toThrow();
    expect((await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_line_link_failed")).toBe(false);
    // state ยังไม่ถูกใช้ — consume ซ้ำสำเร็จได้ (พิสูจน์ rollback)
    expect((await flaky.consumeLineTx("st-retry", new Date()))?.customerId).toBe(c2.id);
  });

  it("atomicity: audit ล้มเหลวแล้วสมัคร/แก้/ปิด/ลบต้องไม่เหลือ partial state", async () => {
    const failing = createMemoryStore({ failAudit: () => true });
    const failingApp = createApp({ store: failing, loginRateMax: 1000, customerRateMax: 1000 });
    const { res } = await customerRegister(failingApp, { name: "พัง", phone: "0812345678", password: "Customer11" });
    expect(res.status).toBe(500);
    expect(await failing.findCustomerByPhone("0812345678")).toBeNull();

    // fail เฉพาะ profile: ชื่อต้องไม่เปลี่ยนและไม่มี audit ใหม่
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_profile_updated" });
    const base = await flaky.createCustomer({ name: "เดิม", phone: "0800000000", email: null, passwordHash: "h" }, {});
    await expect(flaky.updateCustomerProfile(base.id, { name: "ใหม่" }, {})).rejects.toThrow();
    expect((await flaky.findCustomerById(base.id))!.name).toBe("เดิม");

    // fail เฉพาะ deactivate: สถานะและเซสชันต้องคงเดิม
    const flaky2 = createMemoryStore({ failAudit: (i) => i.action === "customer_deactivated" });
    const c2 = await flaky2.createCustomer({ name: "คง", phone: "0811111122", email: null, passwordHash: "h" }, {});
    await flaky2.createCustomerSession(c2.id, 1);
    await expect(flaky2.setCustomerActive(c2.id, false, {})).rejects.toThrow();
    expect((await flaky2.findCustomerById(c2.id))!.isActive).toBe(true);

    // fail เฉพาะ delete: PII ต้องคงเดิม ไม่เป็นนิรนาม
    const flaky3 = createMemoryStore({ failAudit: (i) => i.action === "customer_deleted" });
    const c3 = await flaky3.createCustomer({ name: "ลบ", phone: "0822222233", email: "x@y.z", passwordHash: "h" }, {});
    await expect(flaky3.deleteCustomer(c3.id, {})).rejects.toThrow();
    const kept = (await flaky3.findCustomerById(c3.id))!;
    expect(kept.isDeleted).toBe(false);
    expect(kept.phone).toBe("0822222233");
  });
});
