import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

/** วัน wall-clock กรุงเทพปัจจุบันแบบ deterministic (+07:00 ตลอดปี ไม่มี DST) */
function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function bangkokHour(): number {
  return new Date(Date.now() + 7 * 3600_000).getUTCHours();
}

describe("Ticket 11 finance reports dashboard and CSV (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let foodId: string;
  let drinkId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  // CSRF double-submit: ต้องดึงโทเค็น (GET) ให้เสร็จก่อนสร้าง POST request
  // เสมอ — ห้าม await csrfToken() ข้างใน .set() เพราะ supertest ผูกคุกกี้
  // ณ ตอนสร้าง request ทำให้ส่งคุกกี้ csrf เก่า + header ใหม่แล้วได้ 403
  async function postCsrf(agent: Agent, url: string, body: unknown) {
    const token = await csrfToken(agent);
    return agent.post(url).set("x-csrf-token", token).send(body as Record<string, unknown>);
  }

  async function patchCsrf(agent: Agent, url: string, body: unknown) {
    const token = await csrfToken(agent);
    return agent.patch(url).set("x-csrf-token", token).send(body as Record<string, unknown>);
  }

  async function deleteCsrf(agent: Agent, url: string, body: unknown) {
    const token = await csrfToken(agent);
    return agent.delete(url).set("x-csrf-token", token).send(body as Record<string, unknown>);
  }

  async function loginAs(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/auth/login").set("x-csrf-token", token).send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function registerCustomer(name: string, phone: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent.post("/api/customers/register").set("x-csrf-token", token).send({ name, phone, password });
    expect(res.status).toBe(201);
    return agent;
  }

  async function createMenu(agent: Agent, name: string, kind: "food" | "drink", price: number): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/menu").set("x-csrf-token", token).send({
      category: kind === "food" ? "อาหารจานเดียว" : "เครื่องดื่ม",
      name,
      price,
      kind,
    });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function payOrderCash(payer: Agent, orderId: string, total: number, phone?: string): Promise<string> {
    const created = await postCsrf(payer, "/api/payments", {
      orderId,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: total,
      ...(phone ? { phone } : {}),
    });
    expect(created.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    const confirmed = await postCsrf(owner, `/api/payments/${created.body.payment.id}/confirm-cash`, {
      receivedAmount: total,
      reason: "รับเงินหน้าร้าน",
    });
    expect(confirmed.status).toBe(200);
    return created.body.payment.id as string;
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({
      username: "owner",
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    app = createApp({ store });
    const owner = await loginAs("owner", "OwnerPass123");
    foodId = await createMenu(owner, "ข้าวผัด", "food", 50);
    drinkId = await createMenu(owner, "ชาเย็น", "drink", 30);
  });

  it("Owner สร้าง/อ่าน/แก้/ลบรายการรายจ่ายจริงพร้อม audit", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const created = await postCsrf(owner, "/api/finance/entries", {
      kind: "expense",
      category: "ingredients",
      amount: 1500,
      occurredAt: "2026-09-15T08:00",
      note: "บิลตลาดเช้า",
      reason: "ซื้อหมูและไก่ประจำสัปดาห์",
    });
    expect(created.status).toBe(201);
    expect(created.body.entry).toMatchObject({ kind: "expense", category: "ingredients", amount: 1500 });
    // "2026-09-15T08:00" กรุงเทพ = 01:00Z วันเดียวกัน
    expect(created.body.entry.occurredAt).toBe("2026-09-15T01:00:00.000Z");
    const id = created.body.entry.id as string;

    const got = await owner.get(`/api/finance/entries/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.entry.id).toBe(id);

    const listed = await owner.get("/api/finance/entries?kind=expense&limit=50");
    expect(listed.status).toBe(200);
    expect(listed.body.entries.map((e: { id: string }) => e.id)).toContain(id);

    const patched = await patchCsrf(owner, `/api/finance/entries/${id}`, {
      amount: 1600,
      reason: "แก้ยอดตามบิลจริง",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.entry.amount).toBe(1600);

    const deleted = await deleteCsrf(owner, `/api/finance/entries/${id}`, { reason: "บันทึกซ้ำ" });
    expect(deleted.status).toBe(200);
    expect((await owner.get(`/api/finance/entries/${id}`)).status).toBe(404);

    const audit = await owner.get("/api/audit/finance?limit=100");
    expect(audit.status).toBe(200);
    const actions = (audit.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("finance_entry_created");
    expect(actions).toContain("finance_entry_updated");
    expect(actions).toContain("finance_entry_deleted");
  });

  it("validation รายการเงิน: หมวดผิด kind/ยอดไม่ถูกต้อง/ไม่มีเหตุผล/วันที่ผิด ถูกปฏิเสธ", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const base = {
      kind: "expense",
      category: "ingredients",
      amount: 100,
      occurredAt: "2026-09-15T08:00",
      reason: "ทดสอบ",
    };
    // หมวดรายรับใช้กับ expense ไม่ได้
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, category: "catering" })).status).toBe(400);
    // ยอด 0/ติดลบ/ทศนิยมเกิน 2 ตำแหน่ง
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, amount: 0 })).status).toBe(400);
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, amount: -5 })).status).toBe(400);
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, amount: 10.123 })).status).toBe(400);
    // ไม่มีเหตุผล / วันที่รูปแบบผิด
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, reason: "  " })).status).toBe(400);
    expect((await postCsrf(owner, "/api/finance/entries", { ...base, occurredAt: "เมื่อวาน" })).status).toBe(400);
    // UTC ISO เต็มรับได้ตรง ๆ
    const iso = await postCsrf(owner, "/api/finance/entries", {
      kind: "income",
      category: "catering",
      amount: 2000,
      occurredAt: "2026-09-15T01:00:00.000Z",
      reason: "รับจัดเลี้ยง",
    });
    expect(iso.status).toBe(201);
  });

  it("สิทธิ์: kitchen ถูกปฏิเสธ 403, ลูกค้า/Guest 401, ไม่ login 401", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const created = await postCsrf(owner, "/api/users", {
      username: "cook1",
      password: "CookPass123",
      roles: ["kitchen"],
    });
    expect(created.status).toBe(201);
    const kitchen = await loginAs("cook1", "CookPass123");
    expect((await kitchen.get("/api/finance/entries")).status).toBe(403);
    expect(
      (
        await postCsrf(kitchen, "/api/finance/entries", {
          kind: "expense",
          category: "labor",
          amount: 100,
          occurredAt: "2026-09-15T08:00",
          reason: "ทดสอบ",
        })
      ).status,
    ).toBe(403);
    expect((await kitchen.get("/api/finance/dashboard")).status).toBe(403);
    expect((await kitchen.get("/api/finance/reports?from=2026-09-15&to=2026-09-15")).status).toBe(403);
    expect((await kitchen.get("/api/finance/export?kind=sales&from=2026-09-15&to=2026-09-15")).status).toBe(403);
    expect((await kitchen.get("/api/audit/finance")).status).toBe(403);

    const customer = await registerCustomer("คุณลูกค้า", "0812345678", "Customer123");
    expect((await customer.get("/api/finance/entries")).status).toBe(401);
    expect((await customer.get("/api/finance/dashboard")).status).toBe(401);

    const anon = request.agent(app);
    expect((await anon.get("/api/finance/entries")).status).toBe(401);
  });

  it("รายรับนับ paid ครั้งเดียว หัก refunds และกำไรกระทบยอดตรงกัน", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const customer = await registerCustomer("คุณเอ", "0822222222", "Customer123");
    const token = await csrfToken(customer);
    const orderRes = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: foodId, quantity: 2 }],
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    const total = orderRes.body.order.total as number;
    expect(total).toBe(100);
    const orderId = orderRes.body.order.id as string;
    const paymentId = await payOrderCash(customer, orderId, total);

    const today = bangkokToday();
    const reportRes = await owner.get(`/api/finance/reports?granularity=day&from=${today}&to=${today}`);
    expect(reportRes.status).toBe(200);
    const bucket = reportRes.body.report.buckets[0];
    expect(bucket.grossRevenue).toBe(100);
    expect(bucket.refunds).toBe(0);
    expect(bucket.netRevenue).toBe(100);
    expect(bucket.paidOrders).toBe(1);

    // บันทึกรายรับมือ + รายจ่ายจริง แล้วตรวจกำไร = net + income − expense
    expect(
      (
        await postCsrf(owner, "/api/finance/entries", {
          kind: "income",
          category: "catering",
          amount: 500,
          occurredAt: `${today}T08:00`,
          reason: "รับจัดเลี้ยง",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postCsrf(owner, "/api/finance/entries", {
          kind: "expense",
          category: "labor",
          amount: 200,
          occurredAt: `${today}T09:00`,
          reason: "ค่าแรง",
        })
      ).status,
    ).toBe(201);
    const after = await owner.get(`/api/finance/reports?granularity=day&from=${today}&to=${today}`);
    const b2 = after.body.report.buckets[0];
    expect(b2.manualIncome).toBe(500);
    expect(b2.actualExpense).toBe(200);
    expect(b2.grossProfit).toBe(100 + 500 - 200);

    // คืนเงิน: หักครั้งเดียว net เหลือ 0 (100 − 100)
    const refund = await postCsrf(owner, `/api/payments/${paymentId}/refund`, { reason: "ลูกค้าขอยกเลิก" });
    expect(refund.status).toBe(200);
    const refunded = await owner.get(`/api/finance/reports?granularity=day&from=${today}&to=${today}`);
    const b3 = refunded.body.report.buckets[0];
    expect(b3.grossRevenue).toBe(100);
    expect(b3.refunds).toBe(100);
    expect(b3.netRevenue).toBe(0);
    expect(b3.grossProfit).toBe(0 + 500 - 200);
  });

  it("ต้นทุนประมาณการแยกจากรายจ่ายจริง (ไม่หักซ้ำในกำไร)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const ing = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({
      name: "ข้าวสาร",
      unit: "กรัม",
      latestCost: 0.05,
      initialOnHand: 10000,
    });
    expect(ing.status).toBe(201);
    token = await csrfToken(owner);
    const recipe = await owner.post("/api/inventory/recipes").set("x-csrf-token", token).send({
      targetType: "menu",
      targetId: foodId,
      lines: [{ ingredientId: ing.body.item.id, qty: 100 }],
    });
    expect(recipe.status).toBe(201);

    const customer = await registerCustomer("คุณบี", "0833333333", "Customer123");
    token = await csrfToken(customer);
    const orderRes = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: foodId, quantity: 1 }],
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    // ต้นทุนประมาณการ 100 กรัม × 0.05 = 5 บาท
    expect(orderRes.body.order.estimatedCost).toBe(5);
    await payOrderCash(customer, orderRes.body.order.id, orderRes.body.order.total);

    const today = bangkokToday();
    const reportRes = await owner.get(`/api/finance/reports?granularity=day&from=${today}&to=${today}`);
    const bucket = reportRes.body.report.buckets[0];
    expect(bucket.estimatedCost).toBe(5);
    // กำไรต้องไม่หักต้นทุนประมาณการซ้ำ (net 50 − expense 0)
    expect(bucket.grossProfit).toBe(bucket.netRevenue + bucket.manualIncome - bucket.actualExpense);
  });

  it("buckets วัน/เดือน/ปี ตรง Asia/Bangkok (ข้ามเที่ยงคืนนับวันใหม่)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    // 2026-09-14T17:30Z = 2026-09-15 00:30 กรุงเทพ → ต้องอยู่ bucket 2026-09-15
    expect(
      (
        await postCsrf(owner, "/api/finance/entries", {
          kind: "expense",
          category: "utilities",
          amount: 77,
          occurredAt: "2026-09-14T17:30:00.000Z",
          reason: "ค่าไฟข้ามคืน",
        })
      ).status,
    ).toBe(201);
    const day = await owner.get("/api/finance/reports?granularity=day&from=2026-09-15&to=2026-09-15");
    expect(day.status).toBe(200);
    expect(day.body.report.buckets).toHaveLength(1);
    expect(day.body.report.buckets[0].actualExpense).toBe(77);
    const prevDay = await owner.get("/api/finance/reports?granularity=day&from=2026-09-14&to=2026-09-14");
    expect(prevDay.body.report.buckets[0].actualExpense).toBe(0);

    const month = await owner.get("/api/finance/reports?granularity=month&from=2026-09-01&to=2026-09-30");
    expect(month.status).toBe(200);
    expect(month.body.report.buckets.map((b: { bucket: string }) => b.bucket)).toContain("2026-09");
    const sept = month.body.report.buckets.find((b: { bucket: string }) => b.bucket === "2026-09");
    expect(sept.actualExpense).toBe(77);

    const year = await owner.get("/api/finance/reports?granularity=year&from=2026-01-01&to=2026-12-31");
    expect(year.status).toBe(200);
    const y2026 = year.body.report.buckets.find((b: { bucket: string }) => b.bucket === "2026");
    expect(y2026.actualExpense).toBe(77);
    expect(year.body.report.total.actualExpense).toBe(77);
  });

  it("query ผิด: granularity ชนิดวันที่ ช่วงวันที่ ถูกปฏิเสธ 400", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    expect((await owner.get("/api/finance/reports?granularity=hour&from=2026-09-15&to=2026-09-15")).status).toBe(400);
    expect((await owner.get("/api/finance/reports?from=2026-09-16&to=2026-09-15")).status).toBe(400);
    expect((await owner.get("/api/finance/reports?from=15-09-2026&to=2026-09-15")).status).toBe(400);
    expect((await owner.get("/api/finance/dashboard?date=2026-13-01")).status).toBe(400);
    expect((await owner.get("/api/finance/export?kind=profit&from=2026-09-15&to=2026-09-15")).status).toBe(400);
  });

  it("Dashboard KPI: ยอดขาย บิล บิลเฉลี่ย เมนูขายดี ชั่วโมงหนาแน่น occupancy", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const table = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "A1", capacity: 4 });
    expect(table.status).toBe(201);

    const customer = await registerCustomer("คุณซี", "0844444444", "Customer123");
    token = await csrfToken(customer);
    const orderRes = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [
        { menuId: foodId, quantity: 2 },
        { menuId: drinkId, quantity: 1 },
      ],
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    await payOrderCash(customer, orderRes.body.order.id, orderRes.body.order.total);

    const today = bangkokToday();
    const res = await owner.get(`/api/finance/dashboard?date=${today}`);
    expect(res.status).toBe(200);
    const d = res.body.dashboard;
    expect(d.date).toBe(today);
    expect(d.grossRevenue).toBe(130);
    expect(d.paidOrders).toBe(1);
    expect(d.averageTicket).toBe(130);
    expect(d.topMenus[0]).toMatchObject({ menuName: "ข้าวผัด", quantity: 2, revenue: 100 });
    expect(d.topMenus.map((m: { menuName: string }) => m.menuName)).toContain("ชาเย็น");
    expect(d.peakHours.map((h: { hour: number }) => h.hour)).toContain(bangkokHour());
    expect(d.occupancy).toMatchObject({ enabledTables: 1, freeTables: 1, occupiedTables: 0 });
  });

  it("วิเคราะห์ top-menus และ peak-hours ผ่าน endpoints ตรง", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const customer = await registerCustomer("คุณดี", "0855555555", "Customer123");
    const token = await csrfToken(customer);
    const orderRes = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: drinkId, quantity: 3 }],
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    await payOrderCash(customer, orderRes.body.order.id, orderRes.body.order.total);

    const today = bangkokToday();
    const top = await owner.get(`/api/finance/analytics/top-menus?from=${today}&to=${today}&limit=5`);
    expect(top.status).toBe(200);
    expect(top.body.items[0]).toMatchObject({ menuName: "ชาเย็น", quantity: 3, revenue: 90 });
    const peak = await owner.get(`/api/finance/analytics/peak-hours?from=${today}&to=${today}`);
    expect(peak.status).toBe(200);
    const hour = peak.body.hours.find((h: { hour: number }) => h.hour === bangkokHour());
    expect(hour.paidOrders).toBe(1);
    expect(hour.revenue).toBe(90);
  });

  it("CSV export: BOM + ปกปิด PII + ครบ 5 kinds", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const guestPhone = "0866666666";
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const orderRes = await guest.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      guestName: "คุณแขก",
      guestPhone,
      items: [{ menuId: foodId, quantity: 1 }],
      idempotencyKey: randomUUID(),
    });
    expect(orderRes.status).toBe(201);
    const orderNumber = orderRes.body.order.orderNumber as string;
    await payOrderCash(guest, orderRes.body.order.id, orderRes.body.order.total, guestPhone);
    token = await csrfToken(owner);
    const ing = await owner.post("/api/inventory/ingredients").set("x-csrf-token", token).send({
      name: "น้ำตาล",
      unit: "กรัม",
      latestCost: 0.02,
      initialOnHand: 500,
    });
    expect(ing.status).toBe(201);

    const today = bangkokToday();
    for (const kind of ["sales", "orders", "finance", "stock", "queue"] as const) {
      const res = await owner.get(`/api/finance/export?kind=${kind}&from=${today}&to=${today}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain(".csv");
      const text = res.text as string;
      // UTF-8 BOM
      expect(text.charCodeAt(0)).toBe(0xfeff);
      // เบอร์ดิบต้องไม่หลุดในไฟล์ใด ๆ
      expect(text).not.toContain(guestPhone);
    }
    const sales = (await owner.get(`/api/finance/export?kind=sales&from=${today}&to=${today}`)).text as string;
    expect(sales).toContain(orderNumber);
    expect(sales.split("\r\n")[0]).toContain("order_number");
    const ordersCsv = (await owner.get(`/api/finance/export?kind=orders&from=${today}&to=${today}`)).text as string;
    expect(ordersCsv).toContain(orderNumber);
    // ชื่อ/เบอร์ถูกมาสก์ (ก*** และ 08******66)
    expect(ordersCsv).toContain("08******66");
    expect(ordersCsv).not.toContain("คุณแขก");
    const stock = (await owner.get(`/api/finance/export?kind=stock&from=${today}&to=${today}`)).text as string;
    expect(stock).toContain("น้ำตาล");
    const queue = (await owner.get(`/api/finance/export?kind=queue&from=${today}&to=${today}`)).text as string;
    expect(queue).toContain(orderNumber);
  });
});
