import { beforeAll, afterAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import mysql from "mysql2/promise";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";

const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Integration กับ MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ข้าม (skip) ชัดเจนก็ต่อเมื่อไม่มี TEST_DATABASE_URL เท่านั้น
 * - ถ้าตั้งค่าไว้แล้วแต่เชื่อมต่อ/migrate ไม่ได้ เทสต์ต้อง FAIL (ห้าม catch แล้ว return)
 * - ทำความสะอาดข้อมูลทดสอบที่สร้างทั้งหมดหลังจบ
 */
describe.skipIf(!hasTestDb)("staff accounts with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `t${Date.now().toString(36)}_`;
  const createdUsers: string[] = [];
  const track = (username: string) => {
    createdUsers.push(username);
    return username;
  };

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function loginAgent(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", token)
      .send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function ownerWithCsrf(): Promise<{ agent: Agent; token: string }> {
    const agent = await loginAgent(ownerName, "OwnerPass123");
    return { agent, token: await csrfToken(agent) };
  }

  const ownerName = `${prefix}owner`;
  const staffName = `${prefix}staff`;
  const adminName = `${prefix}admin`;

  beforeAll(async () => {
    // ไม่มี try/catch: ต่อ/migrate ไม่ได้ต้อง FAIL
    store = await createMysqlStore(TEST_DATABASE_URL);
    admin = await mysql.createConnection(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000 });
    track(ownerName);
    track(staffName);
    track(adminName);
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    const names = createdUsers;
    if (names.length > 0) {
      const placeholders = names.map(() => "?").join(",");
      await admin.query(
        `DELETE FROM audit_logs WHERE actor_username IN (${placeholders}) OR target_username IN (${placeholders})`,
        [...names, ...names],
      );
      await admin.query(
        `DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username IN (${placeholders})`,
        names,
      );
      await admin.query(`DELETE FROM users WHERE username IN (${placeholders})`, names);
    }
    await admin?.end();
    await store?.close?.();
  });

  it("bootstrap ครั้งที่สองถูกปฏิเสธแบบ atomic และมี Owner ทดสอบคนเดียว", async () => {
    const again = await store.createFirstOwner({
      username: `${prefix}owner2`,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(again).toEqual({ created: false, reason: "owner-exists" });
    const owners = await store.listUsers();
    expect(owners.filter((u) => u.username.startsWith(prefix) && u.roles.includes("owner"))).toHaveLength(1);
  });

  it("login/me/audit ผ่าน MySQL จริง และรหัสผิดได้ 401", async () => {
    const agent = await loginAgent(ownerName, "OwnerPass123");
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.username).toBe(ownerName);
    const badJar = request.agent(app);
    const badToken = await csrfToken(badJar);
    expect(
      (await badJar.post("/api/auth/login").set("x-csrf-token", badToken).send({ username: ownerName, password: "WrongPass999" }))
        .status,
    ).toBe(401);
    const logins = await agent.get("/api/audit/logins");
    const actions = (logins.body.items as { action: string }[]).map((i) => i.action);
    expect(actions).toContain("login_success");
    expect(actions).toContain("login_failed");
  });

  it("login ไม่มี CSRF token ถูกปฏิเสธ (403)", async () => {
    expect(
      (await request(app).post("/api/auth/login").send({ username: ownerName, password: "OwnerPass123" })).status,
    ).toBe(403);
  });

  it("Owner สร้างพนักงาน/เปลี่ยนบทบาทมีผลทันที/รีเซ็ตแล้วยกเลิกเซสชัน/ปิดบัญชียกเลิกเซสชัน", async () => {
    const { agent: owner, token } = await ownerWithCsrf();
    expect(
      (
        await owner
          .post("/api/users")
          .set("x-csrf-token", token)
          .send({ username: staffName, password: "StaffPass123", roles: ["kitchen", "drink"] })
      ).status,
    ).toBe(201);
    const staff = await loginAgent(staffName, "StaffPass123");
    const targetId = (
      (await owner.get("/api/users")).body.users as { id: string; username: string }[]
    ).find((u) => u.username === staffName)!.id;

    const t2 = await csrfToken(owner);
    expect(
      (await owner.patch(`/api/users/${targetId}/roles`).set("x-csrf-token", t2).send({ roles: ["drink"] })).status,
    ).toBe(200);
    expect((await staff.get("/api/auth/me")).status).toBe(401);
    const staff2 = await loginAgent(staffName, "StaffPass123");
    expect((await staff2.get("/api/auth/me")).body.user.roles).toEqual(["drink"]);

    const t3 = await csrfToken(owner);
    expect(
      (
        await owner
          .post(`/api/users/${targetId}/reset-password`)
          .set("x-csrf-token", t3)
          .send({ newPassword: "ResetPass77" })
      ).status,
    ).toBe(200);
    expect((await staff2.get("/api/auth/me")).status).toBe(401);

    const t4 = await csrfToken(owner);
    expect((await owner.post(`/api/users/${targetId}/deactivate`).set("x-csrf-token", t4)).status).toBe(200);
    const relog = request.agent(app);
    const relogToken = await csrfToken(relog);
    expect(
      (await relog.post("/api/auth/login").set("x-csrf-token", relogToken).send({ username: staffName, password: "ResetPass77" }))
        .status,
    ).toBe(403);

    const accounts = await owner.get("/api/audit/accounts");
    const actions = (accounts.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["user_created", "roles_changed", "password_reset", "user_deactivated"]) {
      expect(actions).toContain(a);
    }
  });

  it("Admin ถูกปฏิเสธทุกการจัดการพนักงานบน MySQL จริง", async () => {
    const { agent: owner, token } = await ownerWithCsrf();
    expect(
      (
        await owner
          .post("/api/users")
          .set("x-csrf-token", token)
          .send({ username: adminName, password: "AdminPass123", roles: ["admin"] })
      ).status,
    ).toBe(201);
    const adminAgent = await loginAgent(adminName, "AdminPass123");
    const at = await csrfToken(adminAgent);
    expect((await adminAgent.get("/api/users")).status).toBe(403);
    expect(
      (
        await adminAgent
          .post("/api/users")
          .set("x-csrf-token", at)
          .send({ username: `${prefix}nope`, password: "NopePass11", roles: ["kitchen"] })
      ).status,
    ).toBe(403);
    expect((await adminAgent.get("/api/audit/logins")).status).toBe(403);
  });

  it("รหัสผ่านเกิน 72 ไบต์ถูกปฏิเสธบน MySQL จริง", async () => {
    const { agent: owner } = await ownerWithCsrf();
    const t = await csrfToken(owner);
    expect(
      (
        await owner
          .post("/api/users")
          .set("x-csrf-token", t)
          .send({ username: `${prefix}long`, password: "a".repeat(73), roles: ["kitchen"] })
      ).status,
    ).toBe(400);
  });
});
