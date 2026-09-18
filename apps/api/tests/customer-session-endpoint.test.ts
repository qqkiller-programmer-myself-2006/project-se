import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

/**
 * `GET /api/customers/session` — "ตอนนี้มี session ลูกค้าไหม" ตอบ 200 เสมอ
 *
 * `/api/customers/me` ตอบ 401 เมื่อไม่มี session ซึ่งถูกต้องสำหรับ endpoint
 * ที่ต้องล็อกอิน แต่หน้าสาธารณะต้องถามทุกครั้งที่โหลด และเบราว์เซอร์ log 401
 * เป็น error เสมอ — console ของ guest จึงเต็มไปด้วย error ปลอม
 */
describe("Ticket 03: สถานะ session ลูกค้าแบบสาธารณะ", () => {
  let store: Store;
  let app: Express;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function registerCustomer(agent: Agent, name: string, phone: string): Promise<void> {
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
  }

  beforeEach(() => {
    store = createMemoryStore();
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
  });

  it("guest ได้ 200 พร้อม customer: null ไม่ใช่ 401", async () => {
    const res = await request(app).get("/api/customers/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: null });
  });

  it("สมาชิกที่ล็อกอินอยู่ได้ข้อมูลตัวเอง เท่ากับที่ /me ให้", async () => {
    const agent = request.agent(app);
    await registerCustomer(agent, "สมชาย ใจดี", "0811111111");

    const session = await agent.get("/api/customers/session");
    expect(session.status).toBe(200);
    expect(session.body.customer).toMatchObject({ name: "สมชาย ใจดี", phone: "0811111111" });

    const me = await agent.get("/api/customers/me");
    expect(me.status).toBe(200);
    expect(session.body.customer).toEqual(me.body.customer);
    // ต้องไม่หลุดข้อมูลลับ
    expect(JSON.stringify(session.body)).not.toContain("passwordHash");
  });

  it("ออกจากระบบแล้วกลับเป็น null (ยังคง 200)", async () => {
    const agent = request.agent(app);
    await registerCustomer(agent, "สมหญิง", "0822222222");
    const token = await csrfToken(agent);
    expect((await agent.post("/api/customers/logout").set("x-csrf-token", token).send({})).status).toBe(200);

    const res = await agent.get("/api/customers/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: null });
  });

  it("คุกกี้ที่ใช้ไม่ได้แล้วถือว่ายังไม่ล็อกอิน และถูกล้างทิ้ง", async () => {
    const res = await request(app).get("/api/customers/session").set("Cookie", "csid=no-such-session-id");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: null });
    // ล้างคุกกี้ค้างให้เลย ไม่ปล่อยให้ผู้ใช้ไปหาเองว่าทำไมเข้าไม่ได้
    expect(String(res.headers["set-cookie"] ?? "")).toContain("csid=");
  });

  it("บัญชีถูกปิดใช้งานระหว่างที่ session ยังอยู่ → null", async () => {
    const agent = request.agent(app);
    await registerCustomer(agent, "สมปอง", "0833333333");
    const customers = await store.listCustomers("", 10);
    const target = customers.find((c) => c.phone === "0833333333");
    expect(target).toBeDefined();
    await store.setCustomerActive(target!.id, false, { actorId: null, actorUsername: null, ip: "127.0.0.1" });

    const res = await agent.get("/api/customers/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: null });
  });
});
