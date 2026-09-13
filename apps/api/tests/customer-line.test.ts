import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakeLineProvider } from "../src/line/fake.js";
import { DisabledLineProvider } from "../src/line/adapter.js";

const OWNER = { username: "owner", password: "OwnerPass123" };

async function csrfToken(agent: Agent): Promise<string> {
  const res = await agent.get("/api/auth/csrf");
  expect(res.status).toBe(200);
  return res.body.csrfToken as string;
}

describe("Ticket 03 LINE link flow (fake provider)", () => {
  let store: Store;
  let app: Express;
  let fake: FakeLineProvider;
  let now: Date;

  async function registerCustomer(phone = "0812345678"): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name: "ลูกค้า", phone, password: "Customer11" });
    expect(res.status).toBe(201);
    return agent;
  }

  /** เริ่ม flow แล้วดึง state จาก authorizeUrl (ไม่แตะ verifier ฝั่ง server) */
  async function startLink(agent: Agent, redirect = "/profile"): Promise<{ authorizeUrl: string; state: string }> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/customers/line/start").set("x-csrf-token", token).send({ redirect });
    expect(res.status).toBe(201);
    const authorizeUrl = res.body.authorizeUrl as string;
    expect(authorizeUrl).toContain("https://access.line.me/oauth2/v2.1/authorize");
    expect(authorizeUrl).toContain("code_challenge_method=S256");
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    expect(state).toHaveLength(64);
    return { authorizeUrl, state };
  }

  beforeEach(async () => {
    now = new Date("2026-09-12T10:00:00.000Z");
    store = createMemoryStore();
    await store.createUser({ username: OWNER.username, passwordHash: await bcrypt.hash(OWNER.password, 10), roles: ["owner"] });
    fake = new FakeLineProvider();
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, line: fake, now: () => new Date(now), lineRedirectUri: "https://shop.example.test/line/callback" });
  });

  it("เชื่อมสำเร็จ: start → callback redirect 302 ไป UI/fallback พร้อม line=linked", async () => {
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    const cb = await agent.get("/api/customers/line/callback").query({ code: "authcode-1", state }).redirects(0);
    expect(cb.status).toBe(302);
    const location = cb.headers["location"] as string;
    // same-origin fallback (ไม่ได้ตั้ง CUSTOMER_UI_URL ในเทสต์): path ภายใน + query status เท่านั้น
    expect(location).toMatch(/^\/profile\?line=linked$/);
    // ห้ามมี code/token/secret/state/nonce ใน redirect query
    expect(location).not.toContain("authcode-1");
    expect(location).not.toContain(state);
    expect(location).not.toContain("fake-id-token");
    expect(location).not.toContain("token");
    const status = await agent.get("/api/customers/line/status");
    expect(status.body).toMatchObject({ linked: true, displayName: "ลูกค้าทดสอบ" });
    // admin เห็นว่าเชื่อมแล้ว
    const owner = request.agent(app);
    const ot = await csrfToken(owner);
    await owner.post("/api/auth/login").set("x-csrf-token", ot).send({ username: OWNER.username, password: OWNER.password });
    const id = (await store.findCustomerByPhone("0812345678"))!.id;
    const detail = await owner.get(`/api/admin/customers/${id}`);
    expect(detail.body.line.linked).toBe(true);
  });

  it("state ใช้ซ้ำครั้งที่สอง redirect error (one-time atomic consume)", async () => {
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    const first = await agent.get("/api/customers/line/callback").query({ code: "c1", state }).redirects(0);
    expect(first.status).toBe(302);
    expect(first.headers["location"] as string).toContain("line=linked");
    const replay = await agent.get("/api/customers/line/callback").query({ code: "c2", state }).redirects(0);
    expect(replay.status).toBe(302);
    expect(replay.headers["location"] as string).toContain("line=error");
    expect(replay.headers["location"] as string).toContain("expired_or_used");
  });

  it("state หมดอายุ (เกิน 10 นาที) redirect error", async () => {
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    now = new Date(now.getTime() + 11 * 60 * 1000);
    const cb = await agent.get("/api/customers/line/callback").query({ code: "c1", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("line=error");
  });

  it("state มั่ว/ไม่มี code/error callback redirect error (ไม่ค้างเป็น JSON)", async () => {
    const agent = await registerCustomer();
    const badState = await agent.get("/api/customers/line/callback").query({ code: "c", state: "nope" }).redirects(0);
    expect(badState.status).toBe(302);
    expect(badState.headers["location"] as string).toContain("line=error");
    const noState = await agent.get("/api/customers/line/callback").query({ code: "c" }).redirects(0);
    expect(noState.status).toBe(302);
    expect(noState.headers["location"] as string).toContain("line=error");
    const { state } = await startLink(agent);
    const denied = await agent.get("/api/customers/line/callback").query({ error: "access_denied", state }).redirects(0);
    expect(denied.status).toBe(302);
    expect(denied.headers["location"] as string).toContain("reason=cancelled");
    // state ถูก consume แล้ว ใช้ต่อไม่ได้
    const reuse = await agent.get("/api/customers/line/callback").query({ code: "c", state }).redirects(0);
    expect(reuse.status).toBe(302);
    expect(reuse.headers["location"] as string).toContain("line=error");
  });

  it("ห้ามรับ LINE user ID จาก request body — callback ที่แนบ sub ปลอมถูกเพิกเฉย", async () => {
    fake.behavior.sub = "Ureal-sub-999";
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    const cb = await agent
      .get("/api/customers/line/callback")
      .query({ code: "c1", state })
      // ช่องทางนอก spec: ต่อให้แนบ sub ปลอมมาใน query/body ระบบต้องใช้ claims จาก adapter เท่านั้น
      .query({ sub: "Uattacker", lineUserId: "Uattacker" } as unknown as Record<string, string>)
      .redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("line=linked");
    const link = await store.getLineLink((await store.findCustomerByPhone("0812345678"))!.id);
    expect(link!.providerSubject).toBe("Ureal-sub-999");
  });

  it("ลูกค้าหนึ่งบัญชีเชื่อมซ้ำถูกปฏิเสธ 409; LINE เดียวกันผูกสองบัญชี redirect conflict", async () => {
    const a = await registerCustomer("0811111111");
    const b = await registerCustomer("0822222222");
    // A เชื่อมสำเร็จ (sub ตั้งต้นของ fake)
    const s1 = await startLink(a);
    const cbA = await a.get("/api/customers/line/callback").query({ code: "cA", state: s1.state }).redirects(0);
    expect(cbA.status).toBe(302);
    expect(cbA.headers["location"] as string).toContain("line=linked");
    // A เริ่มใหม่ไม่ได้ (มี link อยู่แล้ว)
    const tA = await csrfToken(a);
    expect((await a.post("/api/customers/line/start").set("x-csrf-token", tA).send({})).status).toBe(409);
    // B ใช้ LINE เดียวกัน (sub เดียวกัน) → redirect conflict
    const s2 = await startLink(b);
    const cbB = await b.get("/api/customers/line/callback").query({ code: "cB", state: s2.state }).redirects(0);
    expect(cbB.status).toBe(302);
    expect(cbB.headers["location"] as string).toContain("line=error");
    expect(cbB.headers["location"] as string).toContain("reason=conflict");
  });

  it("nonce ไม่ตรง / signature เสีย / issuer-audience-expiry ผิด → redirect verify_failed และไม่สร้าง link", async () => {
    for (const mode of ["nonce", "signature", "issuer", "audience", "expiry"] as const) {
      const s = createMemoryStore();
      const f = new FakeLineProvider("fake-channel-id", { failVerify: mode });
      const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
      const jar = request.agent(a);
      const t0 = await csrfToken(jar);
      await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "x", phone: "0833333333", password: "Customer11" });
      const t1 = await csrfToken(jar);
      const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
      const st = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
      const cb = await jar.get("/api/customers/line/callback").query({ code: "c", state: st }).redirects(0);
      expect(cb.status).toBe(302);
      expect(cb.headers["location"] as string).toContain("line=error");
      expect(cb.headers["location"] as string).toContain("reason=verify_failed");
      expect((await jar.get("/api/customers/line/status")).body.linked).toBe(false);
    }
  });

  it("exchange ล้มเหลว (provider 5xx/timeout) redirect exchange_failed และไม่สร้าง link", async () => {
    fake.behavior.failExchange = true;
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    const cb = await agent.get("/api/customers/line/callback").query({ code: "c", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("reason=exchange_failed");
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(false);
  });

  it("ยกเลิกการเชื่อม: unlink สำเร็จ + เรียก adapter.deauthorize + audit; ไม่มี link ได้ 404", async () => {
    const agent = await registerCustomer();
    const t0 = await csrfToken(agent);
    expect((await agent.post("/api/customers/line/unlink").set("x-csrf-token", t0)).status).toBe(404);
    const { state } = await startLink(agent);
    await agent.get("/api/customers/line/callback").query({ code: "c", state });
    // fake ต้องบันทึกว่า deauthorize ถูกเรียกด้วย subject ที่ถูกต้อง (P1: assert deauthorize called)
    const t1 = await csrfToken(agent);
    const unlink = await agent.post("/api/customers/line/unlink").set("x-csrf-token", t1);
    expect(unlink.status).toBe(200);
    expect(fake.deauthorized).toHaveLength(1);
    expect(fake.deauthorized[0]).toBe("Ufake-sub-001");
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(false);
  });

  it("deauthorize ล้มเหลว → unlink ถูกปฏิเสธ 502 และ link ยังอยู่", async () => {
    fake.behavior.failDeauthorize = true;
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    await agent.get("/api/customers/line/callback").query({ code: "c", state });
    const t = await csrfToken(agent);
    expect((await agent.post("/api/customers/line/unlink").set("x-csrf-token", t)).status).toBe(502);
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(true);
  });

  it("Real provider deauthorize ห้ามสำเร็จแบบเงียบ — unlink/delete คง link ไว้และตอบ 502", async () => {
    const { RealLineProvider } = await import("../src/line/real.js");
    const real = new RealLineProvider({
      channelId: "real-cid",
      channelSecret: "real-secret",
      redirectUri: "https://shop.example.test/line/callback",
    });
    // deauthorize ต้องโยน explicit error เสมอ (ไม่มี user access token ระยะยาว) ห้าม resolve เงียบ
    await expect(real.deauthorize("U123")).rejects.toMatchObject({ code: "LINE_DEAUTHORIZE_FAILED" });
    const s = createMemoryStore();
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: real, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const jt0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", jt0).send({ name: "จริง", phone: "0812345678", password: "Customer11" });
    // สร้าง link ตรงผ่าน store (ข้าม callback ที่ต้องใช้ network) แล้วลอง unlink/delete
    const cid = (await s.findCustomerByPhone("0812345678"))!.id;
    await s.linkLineIdentity(cid, { providerSubject: "U123" }, {});
    const jt1 = await csrfToken(jar);
    expect((await jar.post("/api/customers/line/unlink").set("x-csrf-token", jt1)).status).toBe(502);
    expect(await s.getLineLink(cid)).not.toBeNull();
    const jt2 = await csrfToken(jar);
    expect((await jar.delete("/api/customers/me").set("x-csrf-token", jt2)).status).toBe(502);
    expect(await s.getLineLink(cid)).not.toBeNull();
  });

  it("ลบบัญชีที่เชื่อม LINE: ถอน link + เรียก deauthorize + ล้างเซสชัน อะตอมมิก", async () => {
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    await agent.get("/api/customers/line/callback").query({ code: "c", state });
    const id = (await store.findCustomerByPhone("0812345678"))!.id;
    const t = await csrfToken(agent);
    expect((await agent.delete("/api/customers/me").set("x-csrf-token", t)).status).toBe(200);
    expect(fake.deauthorized).toHaveLength(1);
    expect(fake.deauthorized[0]).toBe("Ufake-sub-001");
    expect(await store.getLineLink(id)).toBeNull();
  });

  it("redirect นอก allowlist ถูกบังคับเป็น /profile; production ไม่ตั้งค่าได้ 503", async () => {
    const agent = await registerCustomer();
    const t = await csrfToken(agent);
    const evil = await agent.post("/api/customers/line/start").set("x-csrf-token", t).send({ redirect: "https://evil.example.com" });
    expect(evil.status).toBe(201);
    const st = new URL(evil.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await agent.get("/api/customers/line/callback").query({ code: "c", state: st }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toMatch(/^\/profile\?line=linked$/);

    const unconfigured = createApp({ store: createMemoryStore(), line: new DisabledLineProvider() });
    const jar = request.agent(unconfigured);
    const jt = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", jt).send({ name: "u", phone: "0844444444", password: "Customer11" });
    const jt2 = await csrfToken(jar);
    expect((await jar.post("/api/customers/line/start").set("x-csrf-token", jt2).send({})).status).toBe(503);
  });

  it("callback redirect ไป CUSTOMER_UI_URL ที่ตั้งไว้ (absolute) และไม่รั่ว secret ใน query", async () => {
    const uiApp = createApp({
      store: createMemoryStore(),
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: new FakeLineProvider(),
      now: () => new Date(now),
      lineRedirectUri: "https://shop.example.test/line/callback",
      customerUiBaseUrl: "https://app.example.test",
    });
    const jar = request.agent(uiApp);
    const jt = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", jt).send({ name: "ยู", phone: "0812345678", password: "Customer11" });
    const jt2 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", jt2).send({ redirect: "/customer/profile" });
    const st = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await jar.get("/api/customers/line/callback").query({ code: "secret-code-123", state: st }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toBe("https://app.example.test/customer/profile?line=linked");
    expect(loc).not.toContain("secret-code-123");
    expect(loc).not.toContain(st);
    // error case ก็ absolute และไม่มี secret เช่นกัน
    const jt3 = await csrfToken(jar);
    void jt3;
    const bad = await jar.get("/api/customers/line/callback").query({ code: "x", state: "nope" }).redirects(0);
    expect((bad.headers["location"] as string).startsWith("https://app.example.test/")).toBe(true);
    expect(bad.headers["location"] as string).toContain("line=error");
    expect(bad.headers["location"] as string).not.toContain("code=");
    expect(bad.headers["location"] as string).not.toContain("state=");
  });

  it("callback พร้อมกันสองครั้ง (concurrent) มีเพียงครั้งเดียวที่ redirect สำเร็จ", async () => {
    const agent = await registerCustomer();
    const { state } = await startLink(agent);
    const [r1, r2] = await Promise.all([
      agent.get("/api/customers/line/callback").query({ code: "c", state }).redirects(0),
      agent.get("/api/customers/line/callback").query({ code: "c", state }).redirects(0),
    ]);
    expect(r1.status).toBe(302);
    expect(r2.status).toBe(302);
    const locs = [r1.headers["location"] as string, r2.headers["location"] as string];
    // ห้าม linked ทั้งคู่ — ต้องมี linked หนึ่งครั้งและ error หนึ่งครั้ง
    expect(locs.filter((l) => l.includes("line=linked"))).toHaveLength(1);
    expect(locs.filter((l) => l.includes("line=error"))).toHaveLength(1);
  });

  it("callback atomic: failure audit ล้มเหลว → rollback state แล้ว retry ด้วย state เดิมจน linked", async () => {
    // fail เฉพาะ failure audit: cancelled branch ต้องไม่เหลือ consumed-แต่-no-audit
    const s = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_failed" });
    const f = new FakeLineProvider();
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ลูกค้า", phone: "0812345678", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    expect(started.status).toBe(201);
    const st = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    // cancelled branch: consume+audit พังพร้อมกัน → outer catch ตอบ 302 internal (ไม่รั่ว secret)
    const cancelled = await jar.get("/api/customers/line/callback").query({ error: "access_denied", state: st }).redirects(0);
    expect(cancelled.status).toBe(302);
    const cancelledLoc = cancelled.headers["location"] as string;
    expect(cancelledLoc).toContain("reason=internal");
    expect(cancelledLoc).not.toContain(st);
    expect((await s.listAudit("customer_", 100)).some((x) => x.action === "customer_line_link_failed")).toBe(false);
    // state ถูก rollback จึง retry ด้วย state เดิม + code จริงได้ → linked (link audit ไม่โดน fail)
    const retry = await jar.get("/api/customers/line/callback").query({ code: "c-retry", state: st }).redirects(0);
    expect(retry.status).toBe(302);
    expect(retry.headers["location"] as string).toContain("line=linked");
    expect((await jar.get("/api/customers/line/status")).body.linked).toBe(true);
  });
});

describe("Ticket 03 LINE callback failure atomic seam (consumeLineTxWithAudit)", () => {
  const txInput = (customerId: string, state: string, expiresInMs = 60000) => ({
    customerId,
    state,
    nonce: `n-${state}`,
    codeVerifier: "v".repeat(64),
    redirectAfter: "/profile" as string | null,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });

  function noSecrets(raw: string, secrets: string[]): void {
    for (const s of secrets) {
      if (s) expect(raw).not.toContain(s);
    }
  }

  it("store seam: consume + failure audit สำเร็จพร้อมกัน; ใช้ซ้ำ/หมดอายุ/ไม่มี → null โดยไม่เขียน audit", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "ซีม", phone: "0812345678", email: null, passwordHash: "h" }, {});
    await s.createLineTx(txInput(c.id, "st-ok"));
    // peek ไม่เปลี่ยน state (consume ต่อได้)
    expect((await s.peekLineTx("st-ok", new Date()))?.customerId).toBe(c.id);
    const tx = await s.consumeLineTxWithAudit("st-ok", new Date(), { ip: "127.0.0.1" }, "แลก authorization code ไม่สำเร็จ");
    expect(tx?.customerId).toBe(c.id);
    expect(tx?.usedAt).not.toBeNull();
    // one-time: ใช้ซ้ำไม่ได้ทั้ง seam และ consume ธรรมดา
    expect(await s.consumeLineTxWithAudit("st-ok", new Date(), {}, "x")).toBeNull();
    expect(await s.consumeLineTx("st-ok", new Date())).toBeNull();
    expect(await s.peekLineTx("st-ok", new Date())).toBeNull();
    const audits = await s.listAudit("customer_", 100);
    const failed = audits.filter((a) => a.action === "customer_line_link_failed" && a.targetId === c.id);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.success).toBe(false);
    expect(failed[0]!.detail).toBe("แลก authorization code ไม่สำเร็จ");
    noSecrets(JSON.stringify(failed[0]), ["st-ok", `n-st-ok`, "v".repeat(64)]);

    // ไม่มี/หมดอายุ → null และไม่มี audit เพิ่ม
    const before = (await s.listAudit("customer_", 100)).length;
    expect(await s.consumeLineTxWithAudit("st-missing", new Date(), {}, "x")).toBeNull();
    await s.createLineTx(txInput(c.id, "st-exp", -1000));
    expect(await s.consumeLineTxWithAudit("st-exp", new Date(), {}, "x")).toBeNull();
    expect(await s.peekLineTx("st-exp", new Date())).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);
  });

  it("store seam: audit ล้มเหลวต้อง rollback การ consume (retry ได้, ไม่มี audit ค้าง)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_failed" });
    const c = await flaky.createCustomer({ name: "พัง", phone: "0822222222", email: null, passwordHash: "h" }, {});
    await flaky.createLineTx(txInput(c.id, "st-flaky"));
    await expect(flaky.consumeLineTxWithAudit("st-flaky", new Date(), {}, "แลก authorization code ไม่สำเร็จ")).rejects.toThrow();
    // state ต้องยังไม่ถูกใช้ (retry ด้วย seam เดิมสำเร็จเมื่อ audit ผ่าน — พิสูจน์ผ่าน store ปกติที่ใช้ state เดียวกันไม่ได้ จึงตรวจผ่าน consume ธรรมดา)
    expect((await flaky.consumeLineTx("st-flaky", new Date()))?.customerId).toBe(c.id);
    expect((await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_line_link_failed")).toBe(false);
  });

  it("route: exchange ล้มเหลว → 302 exchange_failed พร้อม failure audit และ state ถูก consume", async () => {
    const s = createMemoryStore();
    const f = new FakeLineProvider();
    f.behavior.failExchange = true;
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "แลก", phone: "0833333333", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await jar.get("/api/customers/line/callback").query({ code: "code-xyz", state }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toContain("reason=exchange_failed");
    noSecrets(loc, ["code-xyz", state, "fake-id-token", "token", "nonce"]);
    const cid = (await s.findCustomerByPhone("0833333333"))!.id;
    const failed = (await s.listAudit("customer_", 100)).filter(
      (e) => e.action === "customer_line_link_failed" && e.targetId === cid,
    );
    expect(failed).toHaveLength(1);
    noSecrets(JSON.stringify(failed), ["code-xyz", state]);
    // state ถูก consume แล้ว — ใช้ต่อได้ expired_or_used
    const reuse = await jar.get("/api/customers/line/callback").query({ code: "code-xyz", state }).redirects(0);
    expect((reuse.headers["location"] as string)).toContain("expired_or_used");
  });

  it("route: audit ใน failure branch ล้มเหลว → 302 internal โดย state ไม่ถูก consume (retry ได้)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_link_failed" });
    const f = new FakeLineProvider();
    f.behavior.failExchange = true;
    const a = createApp({ store: flaky, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ออดิต", phone: "0844444444", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("reason=internal");
    // ไม่มี failure audit ค้าง และ state ยังไม่ถูกใช้ (consume ธรรมดายังได้)
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_link_failed")).toBe(false);
    expect((await flaky.consumeLineTx(state, new Date()))?.state).toBe(state);
  });
});

describe("Ticket 03 LINE callback success atomic seam (linkLineIdentityWithConsume)", () => {
  const txInput = (customerId: string, state: string, expiresInMs = 60000) => ({
    customerId,
    state,
    nonce: `n-${state}`,
    codeVerifier: "v".repeat(64),
    redirectAfter: "/profile" as string | null,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });

  async function startAndGetState(agent: Agent): Promise<string> {
    const t = await csrfToken(agent);
    const started = await agent.post("/api/customers/line/start").set("x-csrf-token", t).send({});
    expect(started.status).toBe(201);
    return new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
  }

  async function registerAgent(a: Express, phone: string): Promise<Agent> {
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    const res = await jar
      .post("/api/customers/register")
      .set("x-csrf-token", t0)
      .send({ name: "ลูกค้า", phone, password: "Customer11" });
    expect(res.status).toBe(201);
    return jar;
  }

  it("store seam: สำเร็จผูก link + consume + success audit พร้อมกัน; ใช้ซ้ำ/ไม่มี/หมดอายุ → null โดยไม่เขียน audit", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "ซีม", phone: "0812345678", email: null, passwordHash: "h" }, {});
    await s.createLineTx(txInput(c.id, "st-link-ok"));
    const done = await s.linkLineIdentityWithConsume(
      "st-link-ok",
      new Date(),
      { providerSubject: "U-success-1", displayName: "ลูกค้าทดสอบ" },
      { actorId: c.id, ip: "127.0.0.1" },
    );
    expect(done?.link.providerSubject).toBe("U-success-1");
    expect(done?.link.customerId).toBe(c.id);
    expect(done?.tx.usedAt).not.toBeNull();
    expect(done?.tx.redirectAfter).toBe("/profile");
    expect((await s.getLineLink(c.id))?.providerSubject).toBe("U-success-1");
    // one-time: ใช้ซ้ำไม่ได้ทั้ง seam ใหม่และ consume ธรรมดา และไม่เขียน audit เพิ่ม
    const auditCount = (await s.listAudit("customer_", 100)).length;
    expect(await s.linkLineIdentityWithConsume("st-link-ok", new Date(), { providerSubject: "U-other" }, {})).toBeNull();
    expect(await s.consumeLineTx("st-link-ok", new Date())).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(auditCount);
    const linked = (await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_linked");
    expect(linked).toHaveLength(1);
    expect(linked[0]!.targetId).toBe(c.id);

    // ไม่มี/หมดอายุ → null และไม่เขียน audit เพิ่ม
    const before = (await s.listAudit("customer_", 100)).length;
    expect(await s.linkLineIdentityWithConsume("st-missing", new Date(), { providerSubject: "U-x" }, {})).toBeNull();
    await s.createLineTx(txInput(c.id, "st-link-exp", -1000));
    expect(await s.linkLineIdentityWithConsume("st-link-exp", new Date(), { providerSubject: "U-x" }, {})).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);
  });

  it("store seam: conflict ต้อง rollback การ consume (retry ได้, ไม่มี link/audit ค้าง)", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "หนึ่ง", phone: "0811111111", email: null, passwordHash: "h" }, {});
    const c2 = await s.createCustomer({ name: "สอง", phone: "0822222222", email: null, passwordHash: "h" }, {});
    await s.linkLineIdentity(c2.id, { providerSubject: "U-taken" }, {});

    // sub ชนกับบัญชีอื่น → ConflictError และ state ยังไม่ถูกใช้
    await s.createLineTx(txInput(c.id, "st-link-conflict"));
    await expect(
      s.linkLineIdentityWithConsume("st-link-conflict", new Date(), { providerSubject: "U-taken" }, {}),
    ).rejects.toThrow(/บัญชีอื่น/);
    expect(await s.getLineLink(c.id)).toBeNull();
    expect(
      (await s.listAudit("customer_", 100)).some(
        (e) => e.action === "customer_line_linked" && e.targetId === c.id,
      ),
    ).toBe(false);
    expect((await s.consumeLineTx("st-link-conflict", new Date()))?.customerId).toBe(c.id);

    // บัญชีตัวเองมี link อยู่แล้ว → ConflictError และ state ยังไม่ถูกใช้
    await s.linkLineIdentity(c.id, { providerSubject: "U-mine" }, {});
    await s.createLineTx(txInput(c.id, "st-link-dup"));
    await expect(
      s.linkLineIdentityWithConsume("st-link-dup", new Date(), { providerSubject: "U-new" }, {}),
    ).rejects.toThrow(/เชื่อม LINE ไว้แล้ว/);
    expect((await s.consumeLineTx("st-link-dup", new Date()))?.customerId).toBe(c.id);
  });

  it("store seam: success audit ล้มเหลวต้อง rollback ทั้ง link และ consume (retry ได้)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const c = await flaky.createCustomer({ name: "พัง", phone: "0833333333", email: null, passwordHash: "h" }, {});
    await flaky.createLineTx(txInput(c.id, "st-link-flaky"));
    await expect(
      flaky.linkLineIdentityWithConsume("st-link-flaky", new Date(), { providerSubject: "U-flaky" }, {}),
    ).rejects.toThrow();
    // ไม่มี link ค้าง ไม่มี success audit และ state ยังไม่ถูกใช้ (retry ได้)
    expect(await flaky.getLineLink(c.id)).toBeNull();
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_linked")).toBe(false);
    expect((await flaky.consumeLineTx("st-link-flaky", new Date()))?.customerId).toBe(c.id);
  });

  it("route: success audit + fallback audit ล้มเหลวพร้อมกัน → 302 internal โดย state ไม่ถูกใช้ (retry ได้)", async () => {
    const flaky = createMemoryStore({
      failAudit: (i) => i.action === "customer_line_linked" || i.action === "customer_line_link_failed",
    });
    const a = createApp({ store: flaky, loginRateMax: 1000, customerRateMax: 1000, line: new FakeLineProvider(), lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = await registerAgent(a, "0844444444");
    const state = await startAndGetState(jar);
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-success", state }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toContain("reason=internal");
    expect(loc).not.toContain("c-success");
    expect(loc).not.toContain(state);
    const cid = (await flaky.findCustomerByPhone("0844444444"))!.id;
    // ไม่มี link ค้าง ไม่มี audit ของผลลัพธ์ และ state ยังไม่ถูกใช้ (consume ธรรมดายังได้ → retry ได้)
    expect(await flaky.getLineLink(cid)).toBeNull();
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_linked")).toBe(false);
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_link_failed")).toBe(false);
    expect((await flaky.consumeLineTx(state, new Date()))?.customerId).toBe(cid);
    expect((await jar.get("/api/customers/line/status")).body.linked).toBe(false);
  });

  it("route: success audit ล้มเหลวอย่างเดียว → 302 internal พร้อม failure audit แต่ไม่มี link ค้าง (atomic)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const a = createApp({ store: flaky, loginRateMax: 1000, customerRateMax: 1000, line: new FakeLineProvider(), lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = await registerAgent(a, "0855555555");
    const state = await startAndGetState(jar);
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-atomic", state }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toContain("reason=internal");
    expect(loc).not.toContain("c-atomic");
    expect(loc).not.toContain(state);
    const cid = (await flaky.findCustomerByPhone("0855555555"))!.id;
    // link ถูก rollback (ไม่มี partial link) แต่ fallback failure audit ถูกเขียนและ state ถูก consume
    expect(await flaky.getLineLink(cid)).toBeNull();
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_linked")).toBe(false);
    const failed = (await flaky.listAudit("customer_", 100)).filter(
      (e) => e.action === "customer_line_link_failed" && e.targetId === cid,
    );
    expect(failed).toHaveLength(1);
    expect(await flaky.peekLineTx(state, new Date())).toBeNull();
    expect((await jar.get("/api/customers/line/status")).body.linked).toBe(false);
  });
});

describe("Ticket 03 LINE callback failure branches (cancel/invalid_response/conflict)", () => {
  function noSecrets(raw: string, secrets: string[]): void {
    for (const s of secrets) {
      if (s) expect(raw).not.toContain(s);
    }
  }

  it("route: cancel/invalid_response/conflict เขียน failure audit ผ่าน seam เดียว ไม่รั่ว secret", async () => {
    const s = createMemoryStore();
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: new FakeLineProvider(), lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ยก", phone: "0855555555", password: "Customer11" });
    const cid = (await s.findCustomerByPhone("0855555555"))!.id;
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const cancelState = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const denied = await jar.get("/api/customers/line/callback").query({ error: "access_denied", state: cancelState }).redirects(0);
    expect((denied.headers["location"] as string)).toContain("reason=cancelled");

    const t2 = await csrfToken(jar);
    const started2 = await jar.post("/api/customers/line/start").set("x-csrf-token", t2).send({});
    const noCodeState = new URL(started2.body.authorizeUrl as string).searchParams.get("state")!;
    const noCode = await jar.get("/api/customers/line/callback").query({ state: noCodeState }).redirects(0);
    expect((noCode.headers["location"] as string)).toContain("reason=invalid_response");

    const failed = (await s.listAudit("customer_", 100)).filter(
      (e) => e.action === "customer_line_link_failed" && e.targetId === cid,
    );
    expect(failed).toHaveLength(2);
    expect(failed.map((e) => e.detail).sort()).toEqual(["ข้อมูลจาก LINE ไม่ครบถ้วน", "ผู้ใช้ยกเลิกการเชื่อม LINE"].sort());
    for (const e of failed) {
      expect(e.success).toBe(false);
      noSecrets(JSON.stringify(e), [cancelState, noCodeState]);
    }
    noSecrets(
      [denied.headers["location"], noCode.headers["location"]].join(" "),
      [cancelState, noCodeState],
    );
  });
});

describe("Ticket 03 LINE callback success atomic seam (linkLineIdentityWithConsume)", () => {
  const txInput = (customerId: string, state: string, expiresInMs = 60000) => ({
    customerId,
    state,
    nonce: `n-${state}`,
    codeVerifier: "v".repeat(64),
    redirectAfter: "/profile" as string | null,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });

  it("store: link + success audit + consume เกิดพร้อมกัน; ใช้ซ้ำ/หมดอายุ/ไม่มี → null โดยไม่เขียน audit", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "สำเร็จ", phone: "0812345678", email: null, passwordHash: "h" }, {});
    await s.createLineTx(txInput(c.id, "st-link-ok"));
    const done = await s.linkLineIdentityWithConsume(
      "st-link-ok",
      new Date(),
      { providerSubject: "U-success-1", displayName: "ด" },
      { actorId: c.id, ip: "127.0.0.1" },
    );
    expect(done?.link.providerSubject).toBe("U-success-1");
    expect(done?.link.customerId).toBe(c.id);
    expect(done?.tx.usedAt).not.toBeNull();
    expect(done?.tx.redirectAfter).toBe("/profile");
    expect(await s.getLineLink(c.id)).not.toBeNull();
    // one-time: ใช้ซ้ำไม่ได้ทั้ง seam ใหม่และ seam เก่า
    expect(await s.linkLineIdentityWithConsume("st-link-ok", new Date(), { providerSubject: "U-other" }, {})).toBeNull();
    expect(await s.consumeLineTx("st-link-ok", new Date())).toBeNull();
    expect(await s.peekLineTx("st-link-ok", new Date())).toBeNull();
    expect(await s.consumeLineTxWithAudit("st-link-ok", new Date(), {}, "x")).toBeNull();
    const audits = await s.listAudit("customer_", 100);
    const linked = audits.filter((a) => a.action === "customer_line_linked" && a.targetId === c.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.success).toBe(true);
    const failed = audits.filter((a) => a.action === "customer_line_link_failed" && a.targetId === c.id);
    expect(failed).toHaveLength(0);

    // ไม่มี/หมดอายุ → null และไม่มี audit/link เพิ่ม
    const before = (await s.listAudit("customer_", 100)).length;
    expect(await s.linkLineIdentityWithConsume("st-missing", new Date(), { providerSubject: "U-x" }, {})).toBeNull();
    await s.createLineTx(txInput(c.id, "st-link-exp", -1000));
    expect(await s.linkLineIdentityWithConsume("st-link-exp", new Date(), { providerSubject: "U-x" }, {})).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);
  });

  it("store: success audit ล้มเหลวต้อง rollback ทั้ง link และ consume (retry ได้)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const c = await flaky.createCustomer({ name: "พัง", phone: "0822222222", email: null, passwordHash: "h" }, {});
    await flaky.createLineTx(txInput(c.id, "st-link-flaky"));
    await expect(
      flaky.linkLineIdentityWithConsume("st-link-flaky", new Date(), { providerSubject: "U-flaky" }, {}),
    ).rejects.toThrow();
    // ไม่มี link ค้าง, state ยังไม่ถูกใช้ (peek/consume ยังได้), ไม่มี linked audit
    expect(await flaky.getLineLink(c.id)).toBeNull();
    expect((await flaky.peekLineTx("st-link-flaky", new Date()))?.customerId).toBe(c.id);
    expect((await flaky.consumeLineTx("st-link-flaky", new Date()))?.customerId).toBe(c.id);
    expect((await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_line_linked")).toBe(false);
  });

  it("store: link ขัดแย้ง (sub ซ้ำ/มี link แล้ว) ต้อง rollback การ consume (state ยังใช้ต่อได้)", async () => {
    const s = createMemoryStore();
    const a = await s.createCustomer({ name: "เอ", phone: "0833333333", email: null, passwordHash: "h" }, {});
    const b = await s.createCustomer({ name: "บี", phone: "0844444444", email: null, passwordHash: "h" }, {});
    await s.createLineTx(txInput(a.id, "st-a"));
    await s.linkLineIdentityWithConsume("st-a", new Date(), { providerSubject: "U-dup" }, {});
    // B ใช้ sub เดียวกัน → ConflictError และ tx ของ B ยังไม่ถูก consume
    await s.createLineTx(txInput(b.id, "st-b"));
    await expect(
      s.linkLineIdentityWithConsume("st-b", new Date(), { providerSubject: "U-dup" }, {}),
    ).rejects.toThrow(/บัญชีอื่น/);
    expect(await s.getLineLink(b.id)).toBeNull();
    expect((await s.peekLineTx("st-b", new Date()))?.customerId).toBe(b.id);
    expect((await s.listAudit("customer_", 100)).filter((x) => x.action === "customer_line_linked" && x.targetId === b.id)).toHaveLength(0);
    // A มี link แล้วขอ link ซ้ำด้วย state ใหม่ → ConflictError และ state ใหม่ยังไม่ถูก consume
    await s.createLineTx(txInput(a.id, "st-a2"));
    await expect(
      s.linkLineIdentityWithConsume("st-a2", new Date(), { providerSubject: "U-another" }, {}),
    ).rejects.toThrow(/เชื่อม LINE ไว้แล้ว/);
    expect((await s.peekLineTx("st-a2", new Date()))?.customerId).toBe(a.id);
  });

  it("route: callback สำเร็จเขียน linked audit + consume (replay ได้ expired_or_used)", async () => {
    const s = createMemoryStore();
    const f = new FakeLineProvider();
    const app = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(app);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ลิงก์", phone: "0855555555", password: "Customer11" });
    const cid = (await s.findCustomerByPhone("0855555555"))!.id;
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await jar.get("/api/customers/line/callback").query({ code: "code-ok", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("line=linked");
    expect(await s.getLineLink(cid)).not.toBeNull();
    const linked = (await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_linked" && e.targetId === cid);
    expect(linked).toHaveLength(1);
    // replay: peek-miss → expired_or_used และไม่มี linked audit เพิ่ม
    const replay = await jar.get("/api/customers/line/callback").query({ code: "code-ok", state }).redirects(0);
    expect((replay.headers["location"] as string)).toContain("expired_or_used");
    expect((await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_linked" && e.targetId === cid)).toHaveLength(1);
  });

  it("route: success audit ล้มเหลว → 302 internal พร้อม failure audit แต่ไม่มี link ค้าง (atomic)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const f = new FakeLineProvider();
    const app = createApp({ store: flaky, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(app);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "เฟล", phone: "0866666666", password: "Customer11" });
    const cid = (await flaky.findCustomerByPhone("0866666666"))!.id;
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-success", state }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("reason=internal");
    // link ถูก rollback (ไม่มี partial link) แต่ fallback failure audit ถูกเขียนและ state ถูก consume
    expect(await flaky.getLineLink(cid)).toBeNull();
    expect((await flaky.listAudit("customer_", 100)).some((e) => e.action === "customer_line_linked")).toBe(false);
    const failed = (await flaky.listAudit("customer_", 100)).filter(
      (e) => e.action === "customer_line_link_failed" && e.targetId === cid,
    );
    expect(failed).toHaveLength(1);
    expect(await flaky.peekLineTx(state, new Date())).toBeNull();
    expect((await jar.get("/api/customers/line/status")).body.linked).toBe(false);
    // replay หลัง consume → expired_or_used
    const replay = await jar.get("/api/customers/line/callback").query({ code: "c-success", state }).redirects(0);
    expect((replay.headers["location"] as string)).toContain("expired_or_used");
  });

  it("route: success-path conflict เขียน failure audit ผ่าน seam เดียว + consume (replay ได้ expired_or_used)", async () => {
    const s = createMemoryStore();
    const f = new FakeLineProvider();
    const app = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: f, lineRedirectUri: "https://shop.example.test/line/callback" });
    const jarA = request.agent(app);
    const tA0 = await csrfToken(jarA);
    await jarA.post("/api/customers/register").set("x-csrf-token", tA0).send({ name: "เอก", phone: "0877777777", password: "Customer11" });
    const tA1 = await csrfToken(jarA);
    const startedA = await jarA.post("/api/customers/line/start").set("x-csrf-token", tA1).send({});
    const stateA = new URL(startedA.body.authorizeUrl as string).searchParams.get("state")!;
    expect((await jarA.get("/api/customers/line/callback").query({ code: "cA", state: stateA }).redirects(0)).headers["location"] as string).toContain("line=linked");

    // B ใช้ LINE sub เดียวกัน (fake default) → conflict + failure audit + consume
    const jarB = request.agent(app);
    const tB0 = await csrfToken(jarB);
    await jarB.post("/api/customers/register").set("x-csrf-token", tB0).send({ name: "บี", phone: "0888888888", password: "Customer11" });
    const cidB = (await s.findCustomerByPhone("0888888888"))!.id;
    const tB1 = await csrfToken(jarB);
    const startedB = await jarB.post("/api/customers/line/start").set("x-csrf-token", tB1).send({});
    const stateB = new URL(startedB.body.authorizeUrl as string).searchParams.get("state")!;
    const cbB = await jarB.get("/api/customers/line/callback").query({ code: "cB", state: stateB }).redirects(0);
    expect((cbB.headers["location"] as string)).toContain("reason=conflict");
    expect(await s.getLineLink(cidB)).toBeNull();
    const failed = (await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_link_failed" && e.targetId === cidB);
    expect(failed).toHaveLength(1);
    // state ถูก consume แล้ว — ใช้ต่อได้ expired_or_used
    const reuse = await jarB.get("/api/customers/line/callback").query({ code: "cB", state: stateB }).redirects(0);
    expect((reuse.headers["location"] as string)).toContain("expired_or_used");
    // ฝั่ง conflict ต้องไม่มี success audit หลงเหลือ
    expect((await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_linked" && e.targetId === cidB)).toHaveLength(0);
  });
});

describe("Ticket 03 LINE callback race-null branches (seam ได้ null หลัง peek)", () => {
  it("route: แพ้ race แต่มี link แล้ว → redirect line=linked + ไม่เขียน audit ซ้ำ", async () => {
    // จำลอง concurrent callback ที่ชนะไปก่อน ระหว่าง peek กับ seam ของ request นี้:
    // hook ใน exchangeCode ทำ link+consume ตรงผ่าน store (state เดียวกัน) ก่อน route จะถึง seam
    const s = createMemoryStore();
    const now = new Date("2026-09-12T10:00:00.000Z");
    let midState = "";
    class WinnerFirstProvider extends FakeLineProvider {
      override async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }) {
        const cid = (await s.findCustomerByPhone("0831111111"))!.id;
        const won = await s.linkLineIdentityWithConsume(
          midState,
          new Date(now),
          { providerSubject: "Uwinner-001", displayName: "ผู้ชนะ" },
          { actorId: cid, ip: "127.0.0.1" },
        );
        expect(won).not.toBeNull();
        return super.exchangeCode(input);
      }
    }
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: new WinnerFirstProvider(), now: () => new Date(now), lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "แข่ง", phone: "0831111111", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    midState = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    // route: peek ผ่าน (state ยังสด) → hook ชนะก่อน → seam ได้ null → เห็น link → linked
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-race", state: midState }).redirects(0);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"] as string).toContain("line=linked");
    const cid = (await s.findCustomerByPhone("0831111111"))!.id;
    expect((await s.listAudit("customer_", 100)).filter((e) => e.action === "customer_line_linked" && e.targetId === cid)).toHaveLength(1);
  });

  it("route: แพ้ race แบบไม่มี link → redirect expired_or_used + ไม่เขียน audit เพิ่ม", async () => {
    // concurrent failure path ชนะไปก่อน: consume พร้อม failure audit แต่ไม่มี link
    const s = createMemoryStore();
    const now = new Date("2026-09-12T10:00:00.000Z");
    let midState = "";
    class FailureFirstProvider extends FakeLineProvider {
      override async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }) {
        const consumed = await s.consumeLineTxWithAudit(midState, new Date(now), { ip: "127.0.0.1" }, "แลก authorization code ไม่สำเร็จ");
        expect(consumed).not.toBeNull();
        return super.exchangeCode(input);
      }
    }
    const a = createApp({ store: s, loginRateMax: 1000, customerRateMax: 1000, line: new FailureFirstProvider(), now: () => new Date(now), lineRedirectUri: "https://shop.example.test/line/callback" });
    const jar = request.agent(a);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "แพ้", phone: "0841111111", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    midState = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    // route: peek ผ่าน → hook consume ก่อน → seam ได้ null → ไม่มี link → expired_or_used
    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-race", state: midState }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toContain("line=error");
    expect(loc).toContain("reason=expired_or_used");
    const cid = (await s.findCustomerByPhone("0841111111"))!.id;
    const audits = await s.listAudit("customer_", 100);
    // มีแค่ failure audit จาก hook ตรง ๆ 1 แถว — route ไม่เขียนเพิ่ม (ไม่ double-consume/double-audit)
    expect(audits.filter((e) => e.action === "customer_line_link_failed" && e.targetId === cid)).toHaveLength(1);
    expect(audits.filter((e) => e.action === "customer_line_linked" && e.targetId === cid)).toHaveLength(0);
    expect(await s.getLineLink(cid)).toBeNull();
  });
});
