import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { assertOrderEditable, orderLinesSignature } from "../src/orders/edit.js";

describe("Issue #42 assertOrderEditable / orderLinesSignature (domain)", () => {
  it("แก้ได้เฉพาะ pending_payment ที่ยังไม่มีคำขอชำระและยังไม่ตัดสต๊อก", () => {
    expect(() => assertOrderEditable({ status: "pending_payment", stockConsumed: false }, false)).not.toThrow();
    expect(() => assertOrderEditable({ status: "completed", stockConsumed: false }, false)).toThrow(/รอชำระเงิน/);
    expect(() => assertOrderEditable({ status: "cancelled", stockConsumed: false }, false)).toThrow(/รอชำระเงิน/);
    expect(() => assertOrderEditable({ status: "pending_payment", stockConsumed: false }, true)).toThrow(/คำขอชำระเงิน/);
    expect(() => assertOrderEditable({ status: "pending_payment", stockConsumed: true }, false)).toThrow(/คำขอชำระเงิน/);
  });

  it("ลายเซ็นไม่สนลำดับบรรทัด/ลำดับตัวเลือก แต่แยกจำนวน/หมายเหตุ/ตัวเลือก", () => {
    const a = { menuId: "m1", quantity: 1, note: null, optionIds: ["o2", "o1"], specialRequest: null };
    const b = { menuId: "m2", quantity: 2, note: "ไม่ผัก", optionIds: [], specialRequest: "เผ็ดน้อย" };
    expect(orderLinesSignature([a, b])).toBe(orderLinesSignature([b, { ...a, optionIds: ["o1", "o2"] }]));
    expect(orderLinesSignature([a])).not.toBe(orderLinesSignature([{ ...a, quantity: 2 }]));
    expect(orderLinesSignature([a])).not.toBe(orderLinesSignature([{ ...a, note: "x" }]));
    expect(orderLinesSignature([a])).not.toBe(orderLinesSignature([{ ...a, optionIds: ["o1"] }]));
    expect(orderLinesSignature([{ ...a, note: undefined }])).toBe(orderLinesSignature([{ ...a, note: "" }]));
  });
});

describe("Issue #42 PUT /api/orders/:id/items (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let owner: Agent;
  let foodId: string;
  let drinkId: string;
  let riceId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    return (await agent.get("/api/auth/csrf")).body.csrfToken as string;
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
    const res = await agent.post("/api/customers/register").set("x-csrf-token", token).send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
    return agent;
  }

  async function createMenu(name: string, kind: "food" | "drink", price: number): Promise<string> {
    const token = await csrfToken(owner);
    const res = await owner
      .post("/api/menu")
      .set("x-csrf-token", token)
      .send({ category: kind === "food" ? "อาหารจานเดียว" : "เครื่องดื่ม", name, price, kind });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function placeGuestOrder(items: { menuId: string; quantity: number }[]) {
    const guest = request.agent(app);
    const token = await csrfToken(guest);
    const res = await guest.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items,
      guestName: "คุณมินตรา",
      guestPhone: "0812345678",
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    return res.body.order as { id: string; orderNumber: string; total: number };
  }

  async function putItems(agent: Agent, orderId: string, body: Record<string, unknown>) {
    const token = await csrfToken(agent);
    return agent.put(`/api/orders/${orderId}/items`).set("x-csrf-token", token).send(body);
  }

  async function available(): Promise<number> {
    const res = await owner.get(`/api/inventory/ingredients/${riceId}`);
    expect(res.status).toBe(200);
    return res.body.item.available as number;
  }

  async function auditActions(): Promise<string[]> {
    const res = await owner.get("/api/audit/orders?limit=200");
    return (res.body.items as { action: string }[]).map((i) => i.action);
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    owner = await loginAs("owner", "OwnerPass123");
    foodId = await createMenu("ข้าวผัดป้าอ้อ", "food", 50);
    drinkId = await createMenu("ชาเย็น", "drink", 25);
    // วัตถุดิบ 100 หน่วย; ข้าวผัดใช้ 10 ต่อจาน (ชาเย็นไม่มีสูตร)
    let token = await csrfToken(owner);
    const ing = await owner
      .post("/api/inventory/ingredients")
      .set("x-csrf-token", token)
      .send({ name: "ข้าวสาร", unit: "กรัม", latestCost: 0.05, initialOnHand: 100 });
    expect(ing.status).toBe(201);
    riceId = ing.body.item.id as string;
    token = await csrfToken(owner);
    const recipe = await owner
      .post("/api/inventory/recipes")
      .set("x-csrf-token", token)
      .send({ targetType: "menu", targetId: foodId, lines: [{ ingredientId: riceId, qty: 10 }] });
    expect(recipe.status).toBe(201);
  });

  it("Guest เจ้าของเบอร์แก้รายการได้: ยอดคำนวณใหม่ เลข/id เดิม รายการถูกแทนที่ และมี audit", async () => {
    const order = await placeGuestOrder([{ menuId: foodId, quantity: 2 }]);
    expect(order.total).toBe(100);

    const guest = request.agent(app);
    const res = await putItems(guest, order.id, {
      phone: "081-234-5678",
      items: [
        { menuId: foodId, quantity: 3, note: "ไม่ใส่ผัก" },
        { menuId: drinkId, quantity: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.order).toMatchObject({ id: order.id, orderNumber: order.orderNumber, status: "pending_payment", total: 175 });
    const items = res.body.order.items as { menuName: string; quantity: number; note: string | null; lineTotal: number }[];
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.menuName === "ข้าวผัดป้าอ้อ")).toMatchObject({ quantity: 3, note: "ไม่ใส่ผัก", lineTotal: 150 });

    const fetched = await guest.get(`/api/orders/${order.id}?phone=0812345678`);
    expect(fetched.body.order.total).toBe(175);
    expect(await auditActions()).toContain("order_items_edited");
  });

  it("ส่งรายการเดิมซ้ำ → changed:false ไม่เขียน audit/ledger ซ้ำ", async () => {
    const order = await placeGuestOrder([{ menuId: foodId, quantity: 2 }]);
    const guest = request.agent(app);
    const body = { phone: "0812345678", items: [{ menuId: foodId, quantity: 4 }] };
    expect((await putItems(guest, order.id, body)).body.changed).toBe(true);
    const auditBefore = (await auditActions()).filter((a) => a === "order_items_edited").length;
    const availableBefore = await available();

    const again = await putItems(guest, order.id, body);
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(again.body.order.total).toBe(200);
    expect((await auditActions()).filter((a) => a === "order_items_edited").length).toBe(auditBefore);
    expect(await available()).toBe(availableBefore);
  });

  it("สิทธิ์: เบอร์ผิด 403, ไม่ส่งเบอร์ 401, สมาชิกคนอื่น 403, พนักงานครัว 403; สมาชิกเจ้าของและ Owner แก้ได้", async () => {
    const guestOrder = await placeGuestOrder([{ menuId: foodId, quantity: 1 }]);
    const stranger = request.agent(app);
    expect((await putItems(stranger, guestOrder.id, { phone: "0899999999", items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(403);
    expect((await putItems(stranger, guestOrder.id, { items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(401);
    expect((await putItems(await registerCustomer("คนอื่น", "0877777777"), guestOrder.id, { items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(403);
    const kitchen = await loginAs("kitchen1", "Kitchen123");
    expect((await putItems(kitchen, guestOrder.id, { items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(403);
    expect((await putItems(owner, guestOrder.id, { items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(200);

    // สมาชิก: เจ้าของแก้ได้ สมาชิกคนอื่นโดน 403
    const member = await registerCustomer("สมชาย", "0866666666");
    let token = await csrfToken(member);
    const created = await member.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: foodId, quantity: 1 }],
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    const memberOrderId = created.body.order.id as string;
    const other = await registerCustomer("สมหญิง", "0855555555");
    expect((await putItems(other, memberOrderId, { items: [{ menuId: foodId, quantity: 2 }] })).status).toBe(403);
    token = await csrfToken(member);
    const mine = await putItems(member, memberOrderId, { items: [{ menuId: drinkId, quantity: 2 }] });
    expect(mine.status).toBe(200);
    expect(mine.body.order.total).toBe(50);
  });

  it("แก้ไม่ได้เมื่อมีคำขอชำระเงินแล้ว / ยกเลิกแล้ว / ปิดงานแล้ว (409) และไม่เปลี่ยนข้อมูล", async () => {
    const guest = request.agent(app);
    const paid = await placeGuestOrder([{ menuId: foodId, quantity: 1 }]);
    let token = await csrfToken(guest);
    const intent = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: paid.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: paid.total,
      phone: "0812345678",
    });
    expect(intent.status).toBe(201);
    const blocked = await putItems(guest, paid.id, { phone: "0812345678", items: [{ menuId: foodId, quantity: 5 }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/คำขอชำระเงิน/);
    expect((await owner.get(`/api/orders/${paid.id}`)).body.order.total).toBe(50);

    for (const [status, reason] of [
      ["cancelled", "ลูกค้าขอยกเลิก"],
      ["completed", "ปิดงาน"],
    ] as const) {
      const o = await placeGuestOrder([{ menuId: foodId, quantity: 1 }]);
      token = await csrfToken(owner);
      const patched = await owner.patch(`/api/orders/${o.id}/status`).set("x-csrf-token", token).send({ status, reason });
      expect(patched.status).toBe(200);
      const res = await putItems(guest, o.id, { phone: "0812345678", items: [{ menuId: foodId, quantity: 2 }] });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/รอชำระเงิน/);
    }
  });

  it("validation: รายการว่าง/จำนวน 0 → 400; เมนูไม่พร้อมขาย/ไม่พบ → 409; ไม่พบคำสั่งซื้อ → 404", async () => {
    const order = await placeGuestOrder([{ menuId: foodId, quantity: 1 }]);
    const guest = request.agent(app);
    const phone = "0812345678";
    expect((await putItems(guest, order.id, { phone, items: [] })).status).toBe(400);
    expect((await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 0 }] })).status).toBe(400);
    expect((await putItems(guest, order.id, { phone, items: [{ menuId: randomUUID(), quantity: 1 }] })).status).toBe(409);
    expect((await putItems(guest, randomUUID(), { phone, items: [{ menuId: foodId, quantity: 1 }] })).status).toBe(404);

    // ตัวเลือกของเมนูอื่นใส่กับเมนูนี้ไม่ได้
    let token = await csrfToken(owner);
    const group = await owner.post(`/api/menu/${drinkId}/option-groups`).set("x-csrf-token", token).send({ name: "หวาน" });
    token = await csrfToken(owner);
    const opt = await owner
      .post(`/api/menu/option-groups/${group.body.group.id}/options`)
      .set("x-csrf-token", token)
      .send({ name: "หวานมาก", priceDelta: 5 });
    const wrong = await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 1, options: [opt.body.option.id] }] });
    expect(wrong.status).toBe(409);
    const right = await putItems(guest, order.id, { phone, items: [{ menuId: drinkId, quantity: 1, options: [opt.body.option.id] }] });
    expect(right.status).toBe(200);
    expect(right.body.order.total).toBe(30);
    expect(right.body.order.items[0].selectedOptions[0]).toMatchObject({ optionName: "หวานมาก", priceDelta: 5 });
  });

  it("สต๊อก: คืนยอดจองเดิมแล้วจองใหม่; ไม่พอ → 409 และ rollback ครบ; แก้เป็นเมนูไม่มีสูตร → คืนยอดทั้งหมด", async () => {
    const guest = request.agent(app);
    const phone = "0812345678";
    const order = await placeGuestOrder([{ menuId: foodId, quantity: 3 }]); // จอง 30
    expect(await available()).toBe(70);

    expect((await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 5 }] })).status).toBe(200); // จอง 50
    expect(await available()).toBe(50);

    // 11 จาน = 110 > 100 → 409 และสถานะเดิมต้องไม่เปลี่ยน (ยอดจอง/รายการ/ยอดรวม/audit)
    const auditBefore = (await auditActions()).filter((a) => a === "order_items_edited").length;
    const tooMany = await putItems(guest, order.id, { phone, items: [{ menuId: foodId, quantity: 11 }] });
    expect(tooMany.status).toBe(409);
    expect(await available()).toBe(50);
    const afterFail = (await owner.get(`/api/orders/${order.id}`)).body.order;
    expect(afterFail.total).toBe(250);
    expect(afterFail.items).toHaveLength(1);
    expect(afterFail.items[0].quantity).toBe(5);
    expect((await auditActions()).filter((a) => a === "order_items_edited").length).toBe(auditBefore);

    // เปลี่ยนเป็นเมนูที่ไม่มีสูตร → คืนยอดจองทั้งหมด
    expect((await putItems(guest, order.id, { phone, items: [{ menuId: drinkId, quantity: 2 }] })).status).toBe(200);
    expect(await available()).toBe(100);

    // ยกเลิกหลังแก้: ต้องไม่คืนยอดซ้ำ (ยอดจองถูกคืนไปแล้ว)
    const token = await csrfToken(owner);
    expect((await owner.patch(`/api/orders/${order.id}/status`).set("x-csrf-token", token).send({ status: "cancelled", reason: "ยกเลิก" })).status).toBe(200);
    expect(await available()).toBe(100);

    // ledger: มีทั้ง release และ reserve จากการแก้ไข
    const ledger = await owner.get(`/api/inventory/ledger?ingredientId=${riceId}&limit=100`);
    const ops = ledger.body.entries as { op: string }[];
    expect(ops.map((e) => e.op)).toEqual(expect.arrayContaining(["reserve", "release"]));
  });

  it("แก้ไขแล้วชำระเงินตามยอดใหม่ได้ (ยอดชำระ = ยอดหลังแก้)", async () => {
    const guest = request.agent(app);
    const order = await placeGuestOrder([{ menuId: foodId, quantity: 1 }]);
    const edited = await putItems(guest, order.id, { phone: "0812345678", items: [{ menuId: foodId, quantity: 4 }] });
    expect(edited.body.order.total).toBe(200);
    const token = await csrfToken(guest);
    const pay = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 200,
      phone: "0812345678",
    });
    expect(pay.status).toBe(201);
    expect(pay.body.payment.amount).toBe(200);
  });
});
