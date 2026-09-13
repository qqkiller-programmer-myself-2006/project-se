import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakeLineProvider } from "../src/line/fake.js";

async function csrfToken(agent: Agent): Promise<string> {
  const res = await agent.get("/api/auth/csrf");
  expect(res.status).toBe(200);
  return res.body.csrfToken as string;
}

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

describe("Ticket 03 LINE callback success atomic seam (linkLineIdentityWithConsume)", () => {
  it("store: link + consume + success audit สำเร็จพร้อมกัน; ใช้ซ้ำ/peek/consume ธรรมดาต่อไม่ได้ (replay)", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer(
      { name: "สำเร็จ", phone: "0812345678", email: null, passwordHash: "h" },
      {},
    );
    await s.createLineTx(txInput(c.id, "st-success"));

    const done = await s.linkLineIdentityWithConsume(
      "st-success",
      new Date(),
      { providerSubject: "U-success-1", displayName: "ไลน์" },
      { actorId: c.id, ip: "127.0.0.1" },
    );
    expect(done?.link.providerSubject).toBe("U-success-1");
    expect(done?.link.customerId).toBe(c.id);
    expect(done?.tx.usedAt).not.toBeNull();
    expect(done?.tx.redirectAfter).toBe("/profile");
    expect((await s.getLineLink(c.id))?.providerSubject).toBe("U-success-1");

    // one-time: replay ด้วย state เดิมต้องได้ null โดยไม่เขียน audit เพิ่ม
    const before = (await s.listAudit("customer_", 100)).length;
    expect(
      await s.linkLineIdentityWithConsume("st-success", new Date(), { providerSubject: "U-other" }, {}),
    ).toBeNull();
    expect(await s.peekLineTx("st-success", new Date())).toBeNull();
    expect(await s.consumeLineTx("st-success", new Date())).toBeNull();
    expect(await s.consumeLineTxWithAudit("st-success", new Date(), {}, "x")).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);

    const linked = (await s.listAudit("customer_", 100)).filter(
      (a) => a.action === "customer_line_linked" && a.targetId === c.id,
    );
    expect(linked).toHaveLength(1);
    noSecrets(JSON.stringify(linked), ["st-success", "U-success-1".slice(0, 0)]);
  });

  it("store: success audit ล้มเหลวต้อง rollback ทั้ง link/consume (retry ได้, ไม่มี audit ค้าง)", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const c = await flaky.createCustomer(
      { name: "พัง", phone: "0822222222", email: null, passwordHash: "h" },
      {},
    );
    await flaky.createLineTx(txInput(c.id, "st-rollback"));

    await expect(
      flaky.linkLineIdentityWithConsume(
        "st-rollback",
        new Date(),
        { providerSubject: "U-rollback-1" },
        { actorId: c.id },
      ),
    ).rejects.toThrow();

    // rollback: ไม่มี link, state ยังไม่ถูกใช้ (retry ได้), ไม่มี success audit
    expect(await flaky.getLineLink(c.id)).toBeNull();
    expect((await flaky.peekLineTx("st-rollback", new Date()))?.customerId).toBe(c.id);
    expect((await flaky.consumeLineTx("st-rollback", new Date()))?.state).toBe("st-rollback");
    expect(
      (await flaky.listAudit("customer_", 100)).some((a) => a.action === "customer_line_linked"),
    ).toBe(false);
  });

  it("store: link ขัดแย้ง (sub ซ้ำข้ามบัญชี) ต้อง rollback การ consume (state ยังใช้ได้)", async () => {
    const s = createMemoryStore();
    const a = await s.createCustomer({ name: "เอ", phone: "0833333331", email: null, passwordHash: "h" }, {});
    const b = await s.createCustomer({ name: "บี", phone: "0833333332", email: null, passwordHash: "h" }, {});
    await s.linkLineIdentity(a.id, { providerSubject: "U-dup" }, {});
    await s.createLineTx(txInput(b.id, "st-conflict"));

    await expect(
      s.linkLineIdentityWithConsume("st-conflict", new Date(), { providerSubject: "U-dup" }, { actorId: b.id }),
    ).rejects.toThrow(/บัญชีอื่น/);

    // state ไม่ถูก consume (failure path ภายหลังยัง consume พร้อม failure audit ได้)
    expect((await s.peekLineTx("st-conflict", new Date()))?.customerId).toBe(b.id);
    expect(await s.getLineLink(b.id)).toBeNull();
  });

  it("store: state ไม่มี/ใช้แล้ว/หมดอายุ → null โดยไม่เขียน audit และไม่สร้าง link", async () => {
    const s = createMemoryStore();
    const c = await s.createCustomer({ name: "ว่าง", phone: "0844444444", email: null, passwordHash: "h" }, {});
    const before = (await s.listAudit("customer_", 100)).length;

    expect(
      await s.linkLineIdentityWithConsume("st-missing", new Date(), { providerSubject: "U-x" }, {}),
    ).toBeNull();
    await s.createLineTx(txInput(c.id, "st-exp", -1000));
    expect(
      await s.linkLineIdentityWithConsume("st-exp", new Date(), { providerSubject: "U-x" }, {}),
    ).toBeNull();

    expect(await s.getLineLink(c.id)).toBeNull();
    expect((await s.listAudit("customer_", 100)).length).toBe(before);
  });
});

describe("Ticket 03 LINE callback success path via HTTP (atomic + replay)", () => {
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

  async function startLink(agent: Agent): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/customers/line/start").set("x-csrf-token", token).send({});
    expect(res.status).toBe(201);
    const state = new URL(res.body.authorizeUrl as string).searchParams.get("state")!;
    expect(state).toHaveLength(64);
    return state;
  }

  beforeEach(() => {
    now = new Date("2026-09-13T10:00:00.000Z");
    store = createMemoryStore();
    fake = new FakeLineProvider();
    app = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: fake,
      now: () => new Date(now),
      lineRedirectUri: "https://shop.example.test/line/callback",
    });
  });

  it("route: สำเร็จ redirect 302 line=linked (preserve) แล้ว replay ได้ expired_or_used โดยไม่มี linked audit ซ้ำ", async () => {
    const agent = await registerCustomer();
    const state = await startLink(agent);

    const first = await agent.get("/api/customers/line/callback").query({ code: "c1", state }).redirects(0);
    expect(first.status).toBe(302);
    const firstLoc = first.headers["location"] as string;
    expect(firstLoc).toMatch(/^\/profile\?line=linked$/);
    noSecrets(firstLoc, ["c1", state]);
    expect((await agent.get("/api/customers/line/status")).body.linked).toBe(true);

    const replay = await agent.get("/api/customers/line/callback").query({ code: "c2", state }).redirects(0);
    expect(replay.status).toBe(302);
    const replayLoc = replay.headers["location"] as string;
    expect(replayLoc).toContain("line=error");
    expect(replayLoc).toContain("expired_or_used");
    noSecrets(replayLoc, ["c2", state]);

    // success audit มีเพียงหนึ่งครั้ง (replay ไม่เขียน audit เพิ่ม)
    const cid = (await store.findCustomerByPhone("0812345678"))!.id;
    const linked = (await store.listAudit("customer_", 100)).filter(
      (a) => a.action === "customer_line_linked" && a.targetId === cid,
    );
    expect(linked).toHaveLength(1);
    expect((await store.getLineLink(cid))?.providerSubject).toBe("Ufake-sub-001");
  });

  it("route: success audit ล้มเหลว → rollback (ไม่มี link) แล้ว redirect 302 internal ผ่าน failure seam", async () => {
    const flaky = createMemoryStore({ failAudit: (i) => i.action === "customer_line_linked" });
    const flakyApp = createApp({
      store: flaky,
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: new FakeLineProvider(),
      now: () => new Date(now),
      lineRedirectUri: "https://shop.example.test/line/callback",
    });
    const jar = request.agent(flakyApp);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "โรลแบ็ก", phone: "0855555555", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    expect(started.status).toBe(201);
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;

    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-rb", state }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    // seam สำเร็จล้มเหลวที่ success audit → inner catch เขียน failure audit แล้วตอบ internal
    expect(loc).toContain("line=error");
    expect(loc).toContain("reason=internal");
    noSecrets(loc, ["c-rb", state]);

    // rollback: ต้องไม่มี link และไม่มี success audit (มีเพียง failure audit จาก failure seam)
    const cid = (await flaky.findCustomerByPhone("0855555555"))!.id;
    expect(await flaky.getLineLink(cid)).toBeNull();
    expect((await jar.get("/api/customers/line/status")).body.linked).toBe(false);
    const audits = await flaky.listAudit("customer_", 100);
    expect(audits.some((a) => a.action === "customer_line_linked" && a.targetId === cid)).toBe(false);
    expect(
      audits.filter((a) => a.action === "customer_line_link_failed" && a.targetId === cid),
    ).toHaveLength(1);
  });
});

describe("Ticket 03 LINE callback ordering contract (peek → exchange → verify → linkWithConsume)", () => {
  it("route: สำเร็จต้อง peek ก่อนแลก code และ consume พร้อม link+audit ใน seam เดียว (ห้าม raw consume/link, ไม่รั่ว secret)", async () => {
    const inner = createMemoryStore();
    const calls: string[] = [];
    const spyStore: Store = {
      ...inner,
      peekLineTx: async (state, now) => {
        calls.push("peek");
        return inner.peekLineTx(state, now);
      },
      consumeLineTx: async (state, now) => {
        calls.push("consume-raw");
        return inner.consumeLineTx(state, now);
      },
      consumeLineTxWithAudit: async (state, now, actor, detail) => {
        calls.push("consume-with-audit");
        return inner.consumeLineTxWithAudit(state, now, actor, detail);
      },
      linkLineIdentity: async (customerId, input, actor) => {
        calls.push("link-raw");
        return inner.linkLineIdentity(customerId, input, actor);
      },
      linkLineIdentityWithConsume: async (state, now, input, actor) => {
        calls.push("link-with-consume");
        return inner.linkLineIdentityWithConsume(state, now, input, actor);
      },
    };
    const fake = new FakeLineProvider();
    const origExchange = fake.exchangeCode.bind(fake);
    fake.exchangeCode = async (input) => {
      calls.push("exchange");
      return origExchange(input);
    };
    const origVerify = fake.verifyIdToken.bind(fake);
    fake.verifyIdToken = async (idToken, nonce) => {
      calls.push("verify");
      return origVerify(idToken, nonce);
    };
    const now = new Date("2026-09-13T10:00:00.000Z");
    const app = createApp({
      store: spyStore,
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: fake,
      now: () => new Date(now),
      lineRedirectUri: "https://shop.example.test/line/callback",
    });
    const jar = request.agent(app);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "ลำดับ", phone: "0812345678", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    expect(started.status).toBe(201);
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    calls.length = 0;

    const first = await jar.get("/api/customers/line/callback").query({ code: "c-order-1", state }).redirects(0);
    expect(first.status).toBe(302);
    const firstLoc = first.headers["location"] as string;
    expect(firstLoc).toMatch(/^\/profile\?line=linked$/);
    noSecrets(firstLoc, ["c-order-1", state, "fake-id-token", "fake-access"]);

    // ordering: peek → exchange → verify → link-with-consume เท่านั้น
    expect(calls).toEqual(["peek", "exchange", "verify", "link-with-consume"]);
    expect(calls).not.toContain("consume-raw");
    expect(calls).not.toContain("link-raw");
    expect(calls).not.toContain("consume-with-audit");

    // atomic success: link + consume + linked audit เกิดพร้อมกัน ไม่มี failure audit
    const cid = (await spyStore.findCustomerByPhone("0812345678"))!.id;
    expect((await spyStore.getLineLink(cid))?.providerSubject).toBe("Ufake-sub-001");
    expect(await spyStore.peekLineTx(state, new Date())).toBeNull();
    const audits = await spyStore.listAudit("customer_", 100);
    expect(audits.filter((a) => a.action === "customer_line_linked" && a.targetId === cid)).toHaveLength(1);
    expect(audits.some((a) => a.action === "customer_line_link_failed" && a.targetId === cid)).toBe(false);
    noSecrets(JSON.stringify(audits), ["c-order-1", state]);

    // replay: peek-miss → expired_or_used โดยไม่เขียน linked audit เพิ่มและไม่รั่ว secret
    calls.length = 0;
    const replay = await jar.get("/api/customers/line/callback").query({ code: "c-order-2", state }).redirects(0);
    expect(replay.status).toBe(302);
    const replayLoc = replay.headers["location"] as string;
    expect(replayLoc).toContain("expired_or_used");
    noSecrets(replayLoc, ["c-order-2", state]);
    expect(calls).toEqual(["peek"]);
    expect((await spyStore.listAudit("customer_", 100)).filter((a) => a.action === "customer_line_linked" && a.targetId === cid)).toHaveLength(1);
  });

  it("route: exchange ล้มเหลวต้อง consume พร้อม failure audit ใน seam เดียว (ห้าม raw consume, ไม่รั่ว secret, retry ได้ expired_or_used)", async () => {
    const inner = createMemoryStore();
    const calls: string[] = [];
    const spyStore: Store = {
      ...inner,
      peekLineTx: async (state, now) => {
        calls.push("peek");
        return inner.peekLineTx(state, now);
      },
      consumeLineTx: async (state, now) => {
        calls.push("consume-raw");
        return inner.consumeLineTx(state, now);
      },
      consumeLineTxWithAudit: async (state, now, actor, detail) => {
        calls.push("consume-with-audit");
        return inner.consumeLineTxWithAudit(state, now, actor, detail);
      },
      linkLineIdentityWithConsume: async (state, now, input, actor) => {
        calls.push("link-with-consume");
        return inner.linkLineIdentityWithConsume(state, now, input, actor);
      },
    };
    const fake = new FakeLineProvider();
    fake.behavior.failExchange = true;
    const now = new Date("2026-09-13T10:00:00.000Z");
    const app = createApp({
      store: spyStore,
      loginRateMax: 1000,
      customerRateMax: 1000,
      line: fake,
      now: () => new Date(now),
      lineRedirectUri: "https://shop.example.test/line/callback",
    });
    const jar = request.agent(app);
    const t0 = await csrfToken(jar);
    await jar.post("/api/customers/register").set("x-csrf-token", t0).send({ name: "แลกพัง", phone: "0822222222", password: "Customer11" });
    const t1 = await csrfToken(jar);
    const started = await jar.post("/api/customers/line/start").set("x-csrf-token", t1).send({});
    const state = new URL(started.body.authorizeUrl as string).searchParams.get("state")!;
    calls.length = 0;

    const cb = await jar.get("/api/customers/line/callback").query({ code: "c-fail-1", state }).redirects(0);
    expect(cb.status).toBe(302);
    const loc = cb.headers["location"] as string;
    expect(loc).toContain("reason=exchange_failed");
    noSecrets(loc, ["c-fail-1", state, "fake-id-token"]);

    // ordering ล้มเหลว: peek → consume-with-audit (ไม่มี raw consume/link-with-consume)
    expect(calls).toEqual(["peek", "consume-with-audit"]);
    expect(calls).not.toContain("consume-raw");
    expect(calls).not.toContain("link-with-consume");

    const cid = (await spyStore.findCustomerByPhone("0822222222"))!.id;
    expect(await spyStore.getLineLink(cid)).toBeNull();
    const failed = (await spyStore.listAudit("customer_", 100)).filter(
      (a) => a.action === "customer_line_link_failed" && a.targetId === cid,
    );
    expect(failed).toHaveLength(1);
    noSecrets(JSON.stringify(failed), ["c-fail-1", state]);

    // state ถูก consume แล้ว → retry ด้วย state เดิมได้ expired_or_used (ไม่เขียน audit เพิ่ม)
    const before = (await spyStore.listAudit("customer_", 100)).length;
    const retry = await jar.get("/api/customers/line/callback").query({ code: "c-fail-1", state }).redirects(0);
    expect((retry.headers["location"] as string)).toContain("expired_or_used");
    expect((await spyStore.listAudit("customer_", 100)).length).toBe(before);
  });
});
