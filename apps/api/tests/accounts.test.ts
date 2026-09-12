import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, parseRoles, type Store } from "../src/store.js";

const OWNER = { username: "owner", password: "OwnerPass123" };

async function seedOwner(store: Store, username = OWNER.username, password = OWNER.password) {
  return store.createUser({
    username,
    passwordHash: await bcrypt.hash(password, 10),
    roles: ["owner"],
  });
}

/**
 * หมายเหตุ: ต้องเรียก GET csrf ให้เสร็จ "ก่อน" สร้างคำขอ POST เสมอ
 * เพราะ supertest agent ผูกคุกกี้ตอนสร้างคำขอ — login เองก็ต้องมี CSRF token
 */
async function csrfToken(agent: Agent): Promise<string> {
  const res = await agent.get("/api/auth/csrf");
  expect(res.status).toBe(200);
  expect(res.body.csrfToken).toBeDefined();
  return res.body.csrfToken as string;
}

async function loginAgent(app: Express, username: string, password: string): Promise<Agent> {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", token)
    .send({ username, password });
  expect(res.status).toBe(200);
  return agent;
}

function noLeaks(body: unknown): void {
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("passwordHash");
  expect(raw).not.toContain("OwnerPass123");
  expect(raw).not.toContain("NewPass");
}

async function ownerWithCsrf(app: Express): Promise<{ agent: Agent; token: string }> {
  const agent = await loginAgent(app, OWNER.username, OWNER.password);
  const token = await csrfToken(agent);
  return { agent, token };
}

describe("staff accounts vertical slice (public HTTP API)", () => {
  let store: Store;
  let app: Express;

  beforeEach(async () => {
    store = createMemoryStore();
    await seedOwner(store);
    app = createApp({ store, loginRateMax: 1000 });
  });

  it("bootstrap owner เข้าสู่ระบบ ดู session ปัจจุบัน และออกจากระบบได้", async () => {
    const agent = await loginAgent(app, OWNER.username, OWNER.password);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(OWNER.username);
    expect(me.body.user.roles).toContain("owner");
    noLeaks(me.body);
    const token = await csrfToken(agent);
    const out = await agent.post("/api/auth/logout").set("x-csrf-token", token);
    expect(out.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("login ไม่มี CSRF token หรือ token ผิด ถูกปฏิเสธ (403)", async () => {
    const bare = await request(app)
      .post("/api/auth/login")
      .send({ username: OWNER.username, password: OWNER.password });
    expect(bare.status).toBe(403);
    const jar = request.agent(app);
    const good = await csrfToken(jar);
    void good;
    const wrong = await jar
      .post("/api/auth/login")
      .set("x-csrf-token", "wrong-token")
      .send({ username: OWNER.username, password: OWNER.password });
    expect(wrong.status).toBe(403);
  });

  it("รหัสผ่านผิดหรือไม่มีผู้ใช้ ได้ 401 ข้อความเดียวกัน และบันทึก audit ล้มเหลว", async () => {
    async function loginAttempt(username: string, password: string) {
      const jar = request.agent(app);
      const token = await csrfToken(jar);
      return jar.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    }
    const wrong = await loginAttempt(OWNER.username, "WrongPass999");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatch(/ไม่ถูกต้อง/);
    const unknown = await loginAttempt("nobody", "Whatever123");
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error); // ไม่บอกใบ้ว่ามีผู้ใช้หรือไม่

    const agent = await loginAgent(app, OWNER.username, OWNER.password);
    const logins = await agent.get("/api/audit/logins");
    expect(logins.status).toBe(200);
    const actions = (logins.body.items as { action: string; success: boolean }[]).map(
      (i) => `${i.action}:${i.success}`,
    );
    expect(actions).toContain("login_failed:false");
    expect(actions).toContain("login_success:true");
  });

  it("X-Forwarded-For ปลอมไม่สามารถเลี่ยง rate limit ได้", async () => {
    const limited = createApp({ store: createMemoryStore(), loginRateMax: 3 });
    const spoofed = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"];
    let last = 0;
    for (const ip of spoofed) {
      const jar = request.agent(limited);
      const token = await csrfToken(jar);
      const r = await jar
        .post("/api/auth/login")
        .set("x-csrf-token", token)
        .set("X-Forwarded-For", ip)
        .send({ username: "x", password: "y" });
      last = r.status;
    }
    // trust proxy=false → นับตาม IP จริง ครั้งที่ 4 ต้องโดน 429 แม้ XFF ต่างกัน
    expect(last).toBe(429);
  });

  it("ไม่เข้าสู่ระบบเรียก API จัดการบัญชีไม่ได้ (401)", async () => {
    expect((await request(app).get("/api/users")).status).toBe(401);
    expect((await request(app).get("/api/audit/logins")).status).toBe(401);
    expect((await request(app).get("/api/audit/accounts")).status).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
  });

  it("Owner สร้างพนักงานหลายบทบาท (ครัว+เครื่องดื่ม) พนักงานเข้าสู่ระบบได้", async () => {
    const { agent, token } = await ownerWithCsrf(app);
    const created = await agent
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "kitchen1", password: "Kitchen123", roles: ["kitchen", "drink"] });
    expect(created.status).toBe(201);
    expect(created.body.user.roles).toEqual(expect.arrayContaining(["kitchen", "drink"]));
    noLeaks(created.body);

    const list = await agent.get("/api/users");
    expect(list.status).toBe(200);
    expect((list.body.users as { username: string }[]).map((u) => u.username)).toContain(
      "kitchen1",
    );

    const staff = await loginAgent(app, "kitchen1", "Kitchen123");
    const me = await staff.get("/api/auth/me");
    expect(me.body.user.roles).toEqual(expect.arrayContaining(["kitchen", "drink"]));
  });

  it("Owner กำหนดบทบาท admin ให้พนักงานได้ (admin ยังใช้งานทั่วไปได้ แต่จัดการบัญชีไม่ได้)", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    const created = await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "admin1", password: "AdminPass123", roles: ["admin", "kitchen"] });
    expect(created.status).toBe(201);
    const admin = await loginAgent(app, "admin1", "AdminPass123");
    expect((await admin.get("/api/auth/me")).status).toBe(200);
  });

  it("Admin ถูกปฏิเสธทุกการจัดการพนักงาน แม้เป้าหมายเป็นครัว/เครื่องดื่ม และยกระดับตนเองไม่ได้", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "admin1", password: "AdminPass123", roles: ["admin"] })
      .expect(201);
    const token2 = await csrfToken(owner);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token2)
      .send({ username: "kitchen1", password: "Kitchen123", roles: ["kitchen"] })
      .expect(201);
    const users = (await owner.get("/api/users")).body.users as {
      id: string;
      username: string;
    }[];
    const adminId = users.find((u) => u.username === "admin1")!.id;
    const kitchenId = users.find((u) => u.username === "kitchen1")!.id;
    const ownerId = users.find((u) => u.username === OWNER.username)!.id;

    const admin = await loginAgent(app, "admin1", "AdminPass123");
    const at = await csrfToken(admin);
    // อ่านรายชื่อก็ไม่ได้ (Owner คนเดียวเท่านั้น)
    expect((await admin.get("/api/users")).status).toBe(403);
    // สร้างพนักงานครัวก็ไม่ได้
    expect(
      (
        await admin
          .post("/api/users")
          .set("x-csrf-token", at)
          .send({ username: "nope1", password: "NopePass11", roles: ["kitchen"] })
      ).status,
    ).toBe(403);
    // เปลี่ยนบทบาทพนักงานครัวก็ไม่ได้
    expect(
      (await admin.patch(`/api/users/${kitchenId}/roles`).set("x-csrf-token", at).send({ roles: ["drink"] }))
        .status,
    ).toBe(403);
    // ปิดบัญชีพนักงานครัวก็ไม่ได้
    expect((await admin.post(`/api/users/${kitchenId}/deactivate`).set("x-csrf-token", at)).status).toBe(403);
    // รีเซ็ตรหัสพนักงานครัวก็ไม่ได้
    expect(
      (
        await admin
          .post(`/api/users/${kitchenId}/reset-password`)
          .set("x-csrf-token", at)
          .send({ newPassword: "Hacked12345" })
      ).status,
    ).toBe(403);
    // แตะ Owner ไม่ได้
    expect(
      (await admin.patch(`/api/users/${ownerId}/roles`).set("x-csrf-token", at).send({ roles: ["admin"] }))
        .status,
    ).toBe(403);
    expect((await admin.post(`/api/users/${ownerId}/deactivate`).set("x-csrf-token", at)).status).toBe(403);
    // ยกระดับตนเองไม่ได้
    expect(
      (await admin.patch(`/api/users/${adminId}/roles`).set("x-csrf-token", at).send({ roles: ["owner"] }))
        .status,
    ).toBe(403);
    expect(
      (await admin.patch(`/api/users/${adminId}/roles`).set("x-csrf-token", at).send({ roles: ["admin", "kitchen"] }))
        .status,
    ).toBe(403);
  });

  it("พนักงานครัวเรียก API จัดการบัญชีและ audit ไม่ได้ (403)", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "kitchen1", password: "Kitchen123", roles: ["kitchen"] })
      .expect(201);
    const staff = await loginAgent(app, "kitchen1", "Kitchen123");
    const staffToken = await csrfToken(staff);
    expect((await staff.get("/api/users")).status).toBe(403);
    expect((await staff.get("/api/audit/logins")).status).toBe(403);
    expect(
      (
        await staff
          .post("/api/users")
          .set("x-csrf-token", staffToken)
          .send({ username: "zzz", password: "Zzzzzzzz1", roles: ["kitchen"] })
      ).status,
    ).toBe(403);
  });

  it("รหัสผ่านเกิน 72 ไบต์ถูกปฏิเสธทั้งตอนสร้างและตอน login", async () => {
    const { agent, token } = await ownerWithCsrf(app);
    const long73 = "a".repeat(73);
    const t2 = await csrfToken(agent);
    expect(
      (
        await agent
          .post("/api/users")
          .set("x-csrf-token", t2)
          .send({ username: "longpw1", password: long73, roles: ["kitchen"] })
      ).status,
    ).toBe(400);
    // อักษรไทย 3 ไบต์/ตัว: 25 ตัว = 75 ไบต์
    const thaiLong = "ก".repeat(25);
    expect(Buffer.byteLength(thaiLong, "utf8")).toBe(75);
    const t3 = await csrfToken(agent);
    expect(
      (
        await agent
          .post("/api/users")
          .set("x-csrf-token", t3)
          .send({ username: "longpw2", password: thaiLong, roles: ["kitchen"] })
      ).status,
    ).toBe(400);
    const jar = request.agent(app);
    const lt = await csrfToken(jar);
    expect(
      (await jar.post("/api/auth/login").set("x-csrf-token", lt).send({ username: "owner", password: long73 }))
        .status,
    ).toBe(400);
    void token;
  });

  it("พนักงานเปลี่ยนรหัสผ่านตนเอง เซสชันเดิมใช้ไม่ได้ทันที", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "drink1", password: "DrinkPass1", roles: ["drink"] })
      .expect(201);
    const staff = await loginAgent(app, "drink1", "DrinkPass1");
    const staffToken = await csrfToken(staff);
    const changed = await staff
      .post("/api/auth/change-password")
      .set("x-csrf-token", staffToken)
      .send({ currentPassword: "DrinkPass1", newPassword: "DrinkNew99" });
    expect(changed.status).toBe(200);
    // เซสชันเดิมถูกยกเลิก
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    // รหัสเดิมใช้ไม่ได้ รหัสใหม่ใช้ได้
    async function attempt(password: string) {
      const jar = request.agent(app);
      const t = await csrfToken(jar);
      return jar.post("/api/auth/login").set("x-csrf-token", t).send({ username: "drink1", password });
    }
    expect((await attempt("DrinkPass1")).status).toBe(401);
    const again = await loginAgent(app, "drink1", "DrinkNew99");
    expect((await again.get("/api/auth/me")).status).toBe(200);
    // รหัสปัจจุบันผิด
    const againToken = await csrfToken(again);
    const bad = await again
      .post("/api/auth/change-password")
      .set("x-csrf-token", againToken)
      .send({ currentPassword: "ผิด", newPassword: "Another99" });
    expect(bad.status).toBe(400);
  });

  it("Owner รีเซ็ตรหัสผ่านแล้วเซสชันเดิมของพนักงานใช้ไม่ได้", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "kitchen9", password: "Kitchen999", roles: ["kitchen"] })
      .expect(201);
    const staff = await loginAgent(app, "kitchen9", "Kitchen999");
    const targetId = (
      (await owner.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === "kitchen9")!.id;
    const token2 = await csrfToken(owner);
    const reset = await owner
      .post(`/api/users/${targetId}/reset-password`)
      .set("x-csrf-token", token2)
      .send({ newPassword: "ResetPass77" });
    expect(reset.status).toBe(200);
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    await loginAgent(app, "kitchen9", "ResetPass77");
  });

  it("ปิดบัญชีแล้วเข้าสู่ระบบไม่ได้และเซสชันเดิมถูกยกเลิก เปิดใหม่ได้เฉพาะ Owner", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "temp1", password: "TempPass11", roles: ["drink"] })
      .expect(201);
    const staff = await loginAgent(app, "temp1", "TempPass11");
    const targetId = (
      (await owner.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === "temp1")!.id;
    const token2 = await csrfToken(owner);
    expect((await owner.post(`/api/users/${targetId}/deactivate`).set("x-csrf-token", token2)).status).toBe(
      200,
    );
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    const reloginJar = request.agent(app);
    const reloginToken = await csrfToken(reloginJar);
    const relogin = await reloginJar
      .post("/api/auth/login")
      .set("x-csrf-token", reloginToken)
      .send({ username: "temp1", password: "TempPass11" });
    expect(relogin.status).toBe(403);
    const token3 = await csrfToken(owner);
    expect((await owner.post(`/api/users/${targetId}/activate`).set("x-csrf-token", token3)).status).toBe(
      200,
    );
    await loginAgent(app, "temp1", "TempPass11");
  });

  it("เปลี่ยนบทบาทมีผลทันที (เซสชันเดิมถูกยกเลิก เข้าสู่ระบบใหม่เห็นบทบาทใหม่)", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "multi1", password: "MultiPass1", roles: ["kitchen"] })
      .expect(201);
    const staff = await loginAgent(app, "multi1", "MultiPass1");
    const targetId = (
      (await owner.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === "multi1")!.id;
    const token2 = await csrfToken(owner);
    const patched = await owner
      .patch(`/api/users/${targetId}/roles`)
      .set("x-csrf-token", token2)
      .send({ roles: ["drink"] });
    expect(patched.status).toBe(200);
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    const again = await loginAgent(app, "multi1", "MultiPass1");
    expect((await again.get("/api/auth/me")).body.user.roles).toEqual(["drink"]);
  });

  it("Owner ดูประวัติบัญชี/บทบาทได้ พนักงานดูไม่ได้", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    const c = await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "audit1", password: "AuditPass1", roles: ["kitchen"] });
    const targetId = c.body.user.id as string;
    const token2 = await csrfToken(owner);
    await owner.patch(`/api/users/${targetId}/roles`).set("x-csrf-token", token2).send({ roles: ["drink"] });
    const token3 = await csrfToken(owner);
    await owner
      .post(`/api/users/${targetId}/reset-password`)
      .set("x-csrf-token", token3)
      .send({ newPassword: "AuditNew99" });
    const token4 = await csrfToken(owner);
    await owner.post(`/api/users/${targetId}/deactivate`).set("x-csrf-token", token4);

    const accounts = await owner.get("/api/audit/accounts");
    expect(accounts.status).toBe(200);
    const actions = (accounts.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["user_created", "roles_changed", "password_reset", "user_deactivated"]) {
      expect(actions).toContain(a);
    }
    // บัญชีถูกปิดแล้วจึง login ไม่ได้
    const blockedJar = request.agent(app);
    const blockedToken = await csrfToken(blockedJar);
    const blocked = await blockedJar
      .post("/api/auth/login")
      .set("x-csrf-token", blockedToken)
      .send({ username: "audit1", password: "AuditNew99" });
    expect(blocked.status).toBe(403);
    const token5 = await csrfToken(owner);
    await owner.post(`/api/users/${targetId}/activate`).set("x-csrf-token", token5);
    const emp = await loginAgent(app, "audit1", "AuditNew99");
    expect((await emp.get("/api/audit/accounts")).status).toBe(403);
    expect((await emp.get("/api/audit/logins")).status).toBe(403);
  });

  it("ตรวจสอบ input: รหัสสั้น ชื่อซ้ำ ไม่มี hash ใน response และป้องกัน Owner คนสุดท้าย", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    const token2 = await csrfToken(owner);
    expect(
      (
        await owner
          .post("/api/users")
          .set("x-csrf-token", token2)
          .send({ username: "short1", password: "short", roles: ["kitchen"] })
      ).status,
    ).toBe(400);
    const token3 = await csrfToken(owner);
    expect(
      (
        await owner
          .post("/api/users")
          .set("x-csrf-token", token3)
          .send({ username: OWNER.username, password: "Another123", roles: ["kitchen"] })
      ).status,
    ).toBe(409);
    const ownerId = (
      (await owner.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === OWNER.username)!.id;
    const token4 = await csrfToken(owner);
    expect(
      (await owner.patch(`/api/users/${ownerId}/roles`).set("x-csrf-token", token4).send({ roles: ["admin"] }))
        .status,
    ).toBe(403);
    const token5 = await csrfToken(owner);
    expect((await owner.post(`/api/users/${ownerId}/deactivate`).set("x-csrf-token", token5)).status).toBe(403);
    void token;
  });

  it("ปฏิเสธบทบาทซ้ำตอนสร้างพนักงาน (400 ข้อความไทย) และยอมรับหลายบทบาทที่ไม่ซ้ำ", async () => {
    const { agent, token } = await ownerWithCsrf(app);
    const dupToken = await csrfToken(agent);
    const dup = await agent
      .post("/api/users")
      .set("x-csrf-token", dupToken)
      .send({ username: "dup1", password: "DupPass111", roles: ["kitchen", "kitchen"] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/ซ้ำ/);

    // Owner-role restriction เดิมยังทำงาน: บทบาทไม่ซ้ำแต่มี owner ต้องถูกปฏิเสธ 403
    const ownerToken = await csrfToken(agent);
    const ownerAttempt = await agent
      .post("/api/users")
      .set("x-csrf-token", ownerToken)
      .send({ username: "dupowner", password: "DupPass111", roles: ["owner", "admin"] });
    expect(ownerAttempt.status).toBe(403);

    // หลายบทบาทที่ไม่ซ้ำยังสร้างได้ตามเดิม
    const okToken = await csrfToken(agent);
    const ok = await agent
      .post("/api/users")
      .set("x-csrf-token", okToken)
      .send({ username: "multidup", password: "MultiPass11", roles: ["kitchen", "drink"] });
    expect(ok.status).toBe(201);
    expect(ok.body.user.roles).toEqual(expect.arrayContaining(["kitchen", "drink"]));
    void token;
  });

  it("ปฏิเสธบทบาทซ้ำตอนอัปเดตบทบาท (400 ข้อความไทย) และยอมรับหลายบทบาทที่ไม่ซ้ำ", async () => {
    const { agent, token } = await ownerWithCsrf(app);
    await agent
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "upd1", password: "UpdPass111", roles: ["kitchen"] })
      .expect(201);
    const targetId = (
      (await agent.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === "upd1")!.id;

    const dupToken = await csrfToken(agent);
    const dup = await agent
      .patch(`/api/users/${targetId}/roles`)
      .set("x-csrf-token", dupToken)
      .send({ roles: ["drink", "drink"] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/ซ้ำ/);

    // Owner-role restriction เดิมยังทำงานตอนอัปเดต
    const ownerToken = await csrfToken(agent);
    const ownerAttempt = await agent
      .patch(`/api/users/${targetId}/roles`)
      .set("x-csrf-token", ownerToken)
      .send({ roles: ["owner"] });
    expect(ownerAttempt.status).toBe(403);

    // หลายบทบาทที่ไม่ซ้ำยังอัปเดตได้ตามเดิม
    const okToken = await csrfToken(agent);
    const ok = await agent
      .patch(`/api/users/${targetId}/roles`)
      .set("x-csrf-token", okToken)
      .send({ roles: ["kitchen", "drink"] });
    expect(ok.status).toBe(200);
    expect(ok.body.user.roles).toEqual(expect.arrayContaining(["kitchen", "drink"]));
  });

  it("persistence normalize บทบาทซ้ำกันโดยไม่เปลี่ยน contract ภายนอก", async () => {
    const s = createMemoryStore();
    const hash = await bcrypt.hash("SomePass11", 10);
    const created = await s.createUser({ username: "memdup", passwordHash: hash, roles: ["kitchen", "kitchen"] });
    expect(created.roles).toEqual(["kitchen"]);
    const updated = await s.updateUser(created.id, { roles: ["drink", "drink", "kitchen"] });
    expect(updated.roles).toEqual(["drink", "kitchen"]);
    // ข้อมูลเก่าใน DB ที่มีค่าซ้ำถูก normalize ตอนอ่าน
    expect(parseRoles('["kitchen","kitchen"]')).toEqual(["kitchen"]);
  });

  it("mutation ที่เข้าสู่ระบบแล้วแต่ไม่มี CSRF token ถูกปฏิเสธ (403)", async () => {
    const agent = await loginAgent(app, OWNER.username, OWNER.password);
    expect(
      (await agent.post("/api/users").send({ username: "csrf1", password: "CsrfPass11", roles: ["kitchen"] }))
        .status,
    ).toBe(403);
  });

  it("จำกัดการลองเข้าสู่ระบบ (throttling)", async () => {
    const limited = createApp({ store: createMemoryStore(), loginRateMax: 3 });
    for (let i = 0; i < 3; i++) {
      const jar = request.agent(limited);
      const token = await csrfToken(jar);
      await jar.post("/api/auth/login").set("x-csrf-token", token).send({ username: "x", password: "y" });
    }
    const last = request.agent(limited);
    const lastToken = await csrfToken(last);
    const fourth = await last
      .post("/api/auth/login")
      .set("x-csrf-token", lastToken)
      .send({ username: "x", password: "y" });
    expect(fourth.status).toBe(429);
  });

  it("createFirstOwner ครั้งที่สองถูกปฏิเสธและ Owner มีคนเดียว", async () => {
    const s = createMemoryStore();
    const hash = await bcrypt.hash("OwnerPass123", 10);
    const first = await s.createFirstOwner({ username: "o1", passwordHash: hash, roles: ["owner"] });
    expect(first.created).toBe(true);
    const second = await s.createFirstOwner({ username: "o2", passwordHash: hash, roles: ["owner"] });
    expect(second).toEqual({ created: false, reason: "owner-exists" });
    expect(await s.countOwners()).toBe(1);
  });

  it("parseRoles รองรับทั้ง string และ array จาก mysql2 และปฏิเสธข้อมูลเสีย", () => {
    expect(parseRoles('["owner","kitchen"]')).toEqual(["owner", "kitchen"]);
    expect(parseRoles(["drink"])).toEqual(["drink"]);
    expect(() => parseRoles('{"a":1}')).toThrow();
    expect(() => parseRoles(["hacker"])).toThrow();
    expect(() => parseRoles([])).toThrow();
    expect(() => parseRoles(null)).toThrow();
  });

  it("login ชื่อผู้ใช้ยาวเกิน 64 ตัวอักษรถูกปฏิเสธ (กัน audit row ล้นคอลัมน์)", async () => {
    const jar = request.agent(app);
    const token = await csrfToken(jar);
    const res = await jar
      .post("/api/auth/login")
      .set("x-csrf-token", token)
      .send({ username: "u".repeat(65), password: "Whatever123" });
    expect(res.status).toBe(400);
  });

  it("เซสชันที่ version เก่ากว่า credential ปัจจุบันใช้ไม่ได้ แม้แถว session ยังอยู่", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "ver1", password: "Version111", roles: ["kitchen"] })
      .expect(201);
    const staff = await loginAgent(app, "ver1", "Version111");
    const target = (await store.findByUsername("ver1"))!;
    expect(target.passwordVersion).toBe(1);
    // เปลี่ยนรหัสตรงที่ store (bump version) โดยไม่ลบ sessions เพื่อแยกกลไก version ออกมา
    await store.setPassword(target.id, await bcrypt.hash("Version222", 10));
    expect((await store.findById(target.id))!.passwordVersion).toBe(2);
    // เซสชันเดิมต้องใช้ไม่ได้เพราะ version ไม่ตรง แม้แถวยังอยู่ใน store
    expect((await staff.get("/api/auth/me")).status).toBe(401);
  });

  it("เซสชันที่สร้างจากหลักฐาน stale (version เก่า) หลัง reset ใช้ไม่ได้ทันที", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "race1", password: "RacePass11", roles: ["kitchen"] })
      .expect(201);
    const victim = (await store.findByUsername("race1"))!;
    // จำลองผลของ reset/login race: reset เกิดก่อน (version 1 -> 2) แต่มีเซสชัน
    // ถูกสร้างด้วย version เก่า (หลักฐาน stale) หลัง reset
    await store.setPassword(victim.id, await bcrypt.hash("RaceReset99", 10));
    const staleSession = await store.createSession(victim.id, 1);
    const res = await request(app).get("/api/auth/me").set("Cookie", `sid=${staleSession.id}`);
    expect(res.status).toBe(401);
    // และแถว stale ถูกเก็บกวาด
    expect(await store.findSession(staleSession.id)).toBeNull();
  });

  it("เซสชันเดิมใช้ไม่ได้หลังปิดบัญชี และยังใช้ไม่ได้หลังเปิดบัญชีใหม่ (ต้อง login ใหม่)", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "cycle1", password: "CyclePass11", roles: ["kitchen"] })
      .expect(201);
    const staff = await loginAgent(app, "cycle1", "CyclePass11");
    const targetId = (await store.findByUsername("cycle1"))!.id;
    const t2 = await csrfToken(owner);
    await owner.post(`/api/users/${targetId}/deactivate`).set("x-csrf-token", t2).expect(200);
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    const t3 = await csrfToken(owner);
    await owner.post(`/api/users/${targetId}/activate`).set("x-csrf-token", t3).expect(200);
    // คุกกี้เดิมยังตายอยู่ ต้องเข้าสู่ระบบใหม่เท่านั้น
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    const again = await loginAgent(app, "cycle1", "CyclePass11");
    expect((await again.get("/api/auth/me")).status).toBe(200);
  });

  it("login หลัง reset ด้วยรหัสเก่าไม่ผ่าน (revalidation ปฏิเสธหลักฐาน stale)", async () => {
    const { agent: owner, token } = await ownerWithCsrf(app);
    await owner
      .post("/api/users")
      .set("x-csrf-token", token)
      .send({ username: "stale1", password: "StalePass11", roles: ["kitchen"] })
      .expect(201);
    const targetId = (await store.findByUsername("stale1"))!.id;
    const t2 = await csrfToken(owner);
    await owner
      .post(`/api/users/${targetId}/reset-password`)
      .set("x-csrf-token", t2)
      .send({ newPassword: "StaleNew99" })
      .expect(200);
    async function attempt(password: string) {
      const jar = request.agent(app);
      const t = await csrfToken(jar);
      return jar.post("/api/auth/login").set("x-csrf-token", t).send({ username: "stale1", password });
    }
    expect((await attempt("StalePass11")).status).toBe(401);
    expect((await attempt("StaleNew99")).status).toBe(200);
  });

  it("logout ลบคุกกี้ sid ด้วย attribute ตรงกับตอนตั้ง (Path=/, SameSite=Lax)", async () => {
    const agent = await loginAgent(app, OWNER.username, OWNER.password);
    const token = await csrfToken(agent);
    const out = await agent.post("/api/auth/logout").set("x-csrf-token", token);
    expect(out.status).toBe(200);
    const setCookies = out.headers["set-cookie"] as unknown as string[] | string | undefined;
    const joined = Array.isArray(setCookies) ? setCookies.join("; ") : String(setCookies ?? "");
    expect(joined).toMatch(/sid=/);
    expect(joined).toMatch(/Path=\//);
    expect(joined).toMatch(/SameSite=Lax/i);
  });
});
