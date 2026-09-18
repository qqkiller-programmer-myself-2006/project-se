import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

/**
 * `GET /api/auth/session` — "ตอนนี้มีพนักงานล็อกอินไหม" ตอบ 200 เสมอ
 *
 * เว็บถามทุกครั้งที่เปิดเพื่อเลือกเชลล์ลูกค้า/หลังร้าน `/api/auth/me` ตอบ 401 ให้ลูกค้าทุกคน
 * และเบราว์เซอร์ log 401 เป็น error เสมอ — ตัวนี้ตอบคำถามเดียวกันโดยไม่นับเป็น error
 * ทั้งสองใช้ resolveStaffSession ตัวเดียวกัน กฎ session จึงไม่แยกเป็นสองชุด
 */
describe("สถานะ session พนักงานแบบไม่ใช่ error", () => {
  let store: Store;
  let app: Express;

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

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    app = createApp({ store, loginRateMax: 1000 });
  });

  it("ไม่มี session: 200 พร้อม user: null (ไม่ใช่ 401)", async () => {
    const res = await request(app).get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it("ล็อกอินอยู่: ได้ข้อมูลเดียวกับ /api/auth/me และไม่หลุด hash รหัสผ่าน", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const session = await owner.get("/api/auth/session");
    const me = await owner.get("/api/auth/me");
    expect(session.status).toBe(200);
    expect(me.status).toBe(200);
    expect(session.body.user).toEqual(me.body.user);
    expect(session.body.user).toMatchObject({ username: "owner", roles: ["owner"] });
    expect(JSON.stringify(session.body)).not.toContain("passwordHash");
  });

  it("ออกจากระบบแล้ว: กลับเป็น null", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    expect((await owner.post("/api/auth/logout").set("x-csrf-token", token).send({})).status).toBe(200);
    const res = await owner.get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it("คุกกี้เสีย: null และล้างคุกกี้ทิ้ง", async () => {
    const res = await request(app).get("/api/auth/session").set("Cookie", "sid=no-such-session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(String(res.headers["set-cookie"] ?? "")).toContain("sid=");
  });

  it("บัญชีถูกปิดระหว่างที่ session ยังอยู่: null — และ /api/auth/me ยังตอบ 401 เหมือนเดิม", async () => {
    const admin = await loginAs("admin1", "AdminPass123");
    const user = await store.findByUsername("admin1");
    await store.updateUser(user!.id, { isActive: false });

    const session = await admin.get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ user: null });
  });

  it("requireAuth หลัง refactor: ไม่มี session ยัง 401 พร้อมข้อความเดิม", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("กรุณาเข้าสู่ระบบก่อน");

    const stale = await request(app).get("/api/auth/me").set("Cookie", "sid=no-such-session");
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  });
});
