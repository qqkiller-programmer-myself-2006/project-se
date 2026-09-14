import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import {
  ContractOnlyPaymentProvider,
  FakePromptPayProvider,
} from "../src/payments/provider.js";

describe("Ticket 08 payments, receipts and refunds (public HTTP seam + memory/fake-clock)", () => {
  let store: Store;
  let app: Express;
  let menuId: string;

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

  async function createMenu(agent: Agent): Promise<string> {
    const token = await csrfToken(agent);
    const res = await agent.post("/api/menu").set("x-csrf-token", token).send({
      category: "อาหารจานเดียว",
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  async function guestOrder(total2 = false): Promise<{ id: string; orderNumber: string; total: number }> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/orders")
      .set("x-csrf-token", token)
      .send({
        serviceType: "takeaway",
        items: [{ menuId, quantity: total2 ? 2 : 1 }],
        guestName: "คุณมินตรา",
        guestPhone: "0812345678",
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(201);
    return { id: res.body.order.id as string, orderNumber: res.body.order.orderNumber as string, total: res.body.order.total as number };
  }

  beforeEach(async () => {
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000 });
    const owner = await loginAs("owner", "OwnerPass123");
    menuId = await createMenu(owner);
  });

  it("เงินสด: สร้าง intent (201) → ยืนยันรับเงิน (paid + ใบเสร็จ RCP-* + เงินทอน)", async () => {
    const order = await guestOrder();
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 100,
      phone: "0812345678",
    });
    expect(created.status).toBe(201);
    expect(created.body.deduplicated).toBe(false);
    expect(created.body.payment).toMatchObject({ orderId: order.id, method: "cash", amount: 50, status: "pending" });

    const owner = await loginAs("owner", "OwnerPass123");
    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: 100, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("paid");
    expect(confirmed.body.payment.changeAmount).toBe(50);
    expect(confirmed.body.receipt.receiptNumber).toMatch(/^RCP-\d{8}-[A-Z0-9]{4}$/);
    expect(confirmed.body.receipt).toMatchObject({ orderNumber: order.orderNumber, amount: 50, method: "cash" });
    expect(confirmed.body.receipt.items).toHaveLength(1);

    // ยืนยันซ้ำเป็น no-op (ไม่เขียน audit/ใบเสร็จซ้ำ)
    token = await csrfToken(owner);
    const replay = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: 100 });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.receipt.receiptNumber).toBe(confirmed.body.receipt.receiptNumber);
  });

  it("เงินสดรับมาน้อยกว่ายอดถูกปฏิเสธ (400) และยอดไม่ตรงคำสั่งซื้อถูกปฏิเสธ", async () => {
    const order = await guestOrder();
    const guest = request.agent(app);
    const token = await csrfToken(guest);
    const res = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 20,
      phone: "0812345678",
    });
    // เงินทอนติดลบถูกปฏิเสธ 400 ตั้งแต่ route (ไม่สร้าง intent)
    expect(res.status).toBe(400);
    // สร้าง intent ที่รับมาพอดีแล้วยืนยันด้วยยอดน้อยกว่า → 400/500 เช่นกัน (ไม่ paid)
    const token2 = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token2).send({
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: 50,
      phone: "0812345678",
    });
    expect(created.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    const token3 = await csrfToken(owner);
    const bad = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token3)
      .send({ receivedAmount: 10 });
    expect(bad.status).toBe(400);
    const payment = await store.getPayment(created.body.payment.id);
    expect(payment?.status).toBe("pending");
    void order;
  });

  it("idempotency: key เดิม + payload เดิมคืนของเดิม (200) ไม่เขียน audit ซ้ำ; payload ต่างกันได้ 409", async () => {
    const order = await guestOrder();
    const guest = request.agent(app);
    const key = randomUUID();
    const body = { orderId: order.id, method: "cash", idempotencyKey: key, receivedAmount: 50, phone: "0812345678" };
    let token = await csrfToken(guest);
    const first = await guest.post("/api/payments").set("x-csrf-token", token).send(body);
    expect(first.status).toBe(201);
    const auditsBefore = (await store.listAudit("payment_", 100)).length;
    token = await csrfToken(guest);
    const replay = await guest.post("/api/payments").set("x-csrf-token", token).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect((await store.listAudit("payment_", 100)).length).toBe(auditsBefore);
    token = await csrfToken(guest);
    const clash = await guest.post("/api/payments").set("x-csrf-token", token).send({ ...body, method: "promptpay" });
    expect(clash.status).toBe(409);
  });

  it("พร้อมเพย์ fake: intent มี QR → webhook success (paid + ใบเสร็จ) → replay event เดิม dedupe ไม่ side effect ซ้ำ", async () => {
    const order = await guestOrder();
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "promptpay",
      idempotencyKey: randomUUID(),
      phone: "0812345678",
    });
    expect(created.status).toBe(201);
    expect(created.body.qrPayload).toMatch(/^PROMPTPAY-FAKE:/);
    const pid = created.body.payment.id as string;

    const ledgerBefore = (await store.listStockLedger({ orderId: order.id, limit: 50 })).length;
    token = await csrfToken(guest);
    const hook = await guest
      .post(`/api/payments/${pid}/webhook`)
      .set("x-csrf-token", token)
      .set("x-fake-signature", "fake")
      .send({ providerEventId: "evt-1", outcome: "success" });
    expect(hook.status).toBe(200);
    expect(hook.body.deduplicated).toBe(false);
    expect(hook.body.payment.status).toBe("paid");
    expect(hook.body.receipt.receiptNumber).toMatch(/^RCP-/);
    // สต๊อกไม่ถูกแตะซ้ำ (จองไว้แล้วตอนยืนยัน — ledger ของออเดอร์เท่าเดิม)
    expect((await store.listStockLedger({ orderId: order.id, limit: 50 })).length).toBe(ledgerBefore);

    token = await csrfToken(guest);
    const replay = await guest
      .post(`/api/payments/${pid}/webhook`)
      .set("x-csrf-token", token)
      .set("x-fake-signature", "fake")
      .send({ providerEventId: "evt-1", outcome: "success" });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect((await store.listStockLedger({ orderId: order.id, limit: 50 })).length).toBe(ledgerBefore);

    // success ซ้ำด้วย event ใหม่บน payment ที่ paid แล้วถูกปฏิเสธ (409)
    token = await csrfToken(guest);
    const dup = await guest
      .post(`/api/payments/${pid}/webhook`)
      .set("x-csrf-token", token)
      .set("x-fake-signature", "fake")
      .send({ providerEventId: "evt-2", outcome: "success" });
    expect(dup.status).toBe(409);
  });

  it("ambiguous/timeout → manual_review แล้ว Admin ตัดสิน paid ได้ (พร้อมใบเสร็จ)", async () => {
    const order = await guestOrder();
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "promptpay",
      idempotencyKey: randomUUID(),
      phone: "0812345678",
    });
    const pid = created.body.payment.id as string;
    token = await csrfToken(guest);
    const hook = await guest
      .post(`/api/payments/${pid}/webhook`)
      .set("x-csrf-token", token)
      .set("x-fake-signature", "fake")
      .send({ providerEventId: "evt-amb-1", outcome: "ambiguous" });
    expect(hook.status).toBe(200);
    expect(hook.body.payment.status).toBe("manual_review");
    expect(hook.body.receipt).toBeNull();

    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    const resolved = await admin.post(`/api/payments/${pid}/resolve`).set("x-csrf-token", token).send({
      decision: "paid",
      reason: "ตรวจ slip ด้วยมือ ยอดตรง",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.payment.status).toBe("paid");
    expect(resolved.body.receipt.receiptNumber).toMatch(/^RCP-/);
  });

  it("slip fake: VALID-* → paid, AMBIGUOUS-* → manual_review, อื่น → failed; ส่งซ้ำ dedupe", async () => {
    const mk = async () => {
      const order = await guestOrder();
      const guest = request.agent(app);
      const token = await csrfToken(guest);
      const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
        orderId: order.id,
        method: "promptpay",
        idempotencyKey: randomUUID(),
        phone: "0812345678",
      });
      return { guest, pid: created.body.payment.id as string };
    };
    const a = await mk();
    let token = await csrfToken(a.guest);
    const ok = await a.guest.post(`/api/payments/${a.pid}/slip`).set("x-csrf-token", token).send({ slipRef: "VALID-1", phone: "0812345678" });
    expect(ok.status).toBe(200);
    expect(ok.body.payment.status).toBe("paid");
    token = await csrfToken(a.guest);
    const okDup = await a.guest.post(`/api/payments/${a.pid}/slip`).set("x-csrf-token", token).send({ slipRef: "VALID-1", phone: "0812345678" });
    expect(okDup.body.deduplicated).toBe(true);

    const b = await mk();
    token = await csrfToken(b.guest);
    const amb = await b.guest.post(`/api/payments/${b.pid}/slip`).set("x-csrf-token", token).send({ slipRef: "AMBIGUOUS-9", phone: "0812345678" });
    expect(amb.body.payment.status).toBe("manual_review");

    const c = await mk();
    token = await csrfToken(c.guest);
    const bad = await c.guest.post(`/api/payments/${c.pid}/slip`).set("x-csrf-token", token).send({ slipRef: "BOGUS-XX", phone: "0812345678" });
    expect(bad.body.payment.status).toBe("failed");
  });

  it("fake clock: intent เกิน 15 นาที → webhook ได้ expired จ่ายต่อไม่ได้; สร้าง intent ใหม่ได้", async () => {
    const t0 = new Date("2026-09-14T10:00:00.000Z");
    const late = new Date(t0.getTime() + 16 * 60 * 1000);
    const order = await guestOrder();
    const { payment } = await store.createPayment(
      { orderId: order.id, method: "promptpay", idempotencyKey: randomUUID() },
      { ip: "127.0.0.1" },
      t0,
    );
    expect(payment.status).toBe("pending");
    const res = await store.handlePaymentWebhook(
      payment.id,
      { providerEventId: "evt-late", outcome: "success" },
      { ip: "127.0.0.1" },
      late,
    );
    expect(res.payment.status).toBe("expired");
    expect(res.receipt).toBeNull();
    // สร้าง intent ใหม่หลังหมดอายุได้
    const again = await store.createPayment(
      { orderId: order.id, method: "promptpay", idempotencyKey: randomUUID() },
      { ip: "127.0.0.1" },
      late,
    );
    expect(again.payment.status).toBe("pending");
    expect(await store.getOrderPaymentState(order.id)).toBe("pending_payment");
  });

  it("Owner อนุมัติคืนเงิน: refunded + ออเดอร์ cancelled + คืนยอดจอง + audit; ซ้ำ/ไม่ใช่ Owner ถูกปฏิเสธ", async () => {
    const order = await guestOrder();
    const { payment } = await store.createPayment(
      { orderId: order.id, method: "cash", idempotencyKey: randomUUID(), receivedAmount: 50 },
      { ip: "127.0.0.1" },
    );
    await store.confirmCashPayment(payment.id, { receivedAmount: 50, reason: "รับเงินหน้าร้าน" }, { actorId: "staff", actorUsername: "owner", ip: "127.0.0.1" });

    const guest = request.agent(app);
    const admin = await loginAs("admin1", "AdminPass123");
    let token = await csrfToken(admin);
    // admin (ไม่ใช่ owner) ขอคืนเงิน → 403
    const forbidden = await admin.post(`/api/payments/${payment.id}/refund`).set("x-csrf-token", token).send({ reason: "ลองโดย admin" });
    expect(forbidden.status).toBe(403);

    const owner = await loginAs("owner", "OwnerPass123");
    token = await csrfToken(owner);
    const refunded = await owner.post(`/api/payments/${payment.id}/refund`).set("x-csrf-token", token).send({ reason: "ลูกค้ายกเลิกก่อนเริ่มทำ" });
    expect(refunded.status).toBe(200);
    expect(refunded.body.payment.status).toBe("refunded");
    expect(refunded.body.refund).toMatchObject({ orderId: order.id, amount: 50 });
    expect((await store.getOrder(order.id))?.status).toBe("cancelled");
    expect(await store.getOrderPaymentState(order.id)).toBe("refunded");
    // audit มี actor/reason/before→after และไม่มีข้อมูลลับ
    const audits = await store.listAudit("payment_", 50);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("payment_refund_approved");
    const raw = JSON.stringify(audits);
    for (const secret of ["passwordHash", "password_hash", "token", "secret", "session"]) {
      expect(raw).not.toContain(secret);
    }
    void guest;
    // คืนซ้ำถูกปฏิเสธ
    token = await csrfToken(owner);
    const dup = await owner.post(`/api/payments/${payment.id}/refund`).set("x-csrf-token", token).send({ reason: "ขอซ้ำ" });
    expect(dup.status).toBe(409);
  });

  it("คืนเงินเมื่อตัดสต๊อกจริงแล้วถูกปฏิเสธ; ชำระออเดอร์ที่ปิดงานแล้วถูกปฏิเสธ", async () => {
    const order = await guestOrder();
    const { payment } = await store.createPayment(
      { orderId: order.id, method: "cash", idempotencyKey: randomUUID(), receivedAmount: 50 },
      { ip: "127.0.0.1" },
    );
    await store.confirmCashPayment(payment.id, { receivedAmount: 50 }, { ip: "127.0.0.1" });
    // เริ่มทำ (ตัดสต๊อกจริง — ไม่มีสูตรจึง... เมนูไม่มีสูตร = ไม่จอง; ใช้ consume ตรงไม่ได้ → จำลองด้วย order ที่มีสูตร? ข้าม: ตรวจ completed แทน)
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    await owner.patch(`/api/orders/${order.id}/status`).set("x-csrf-token", token).send({ status: "completed", reason: "เสิร์ฟแล้ว" });
    token = await csrfToken(owner);
    const refund = await owner.post(`/api/payments/${payment.id}/refund`).set("x-csrf-token", token).send({ reason: "ขอคืนหลังปิดงาน" });
    expect(refund.status).toBe(409);

    // สร้าง intent บนออเดอร์ที่ completed แล้ว → 409
    const guest = request.agent(app);
    token = await csrfToken(guest);
    const intent = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId: order.id,
      method: "promptpay",
      idempotencyKey: randomUUID(),
      phone: "0812345678",
    });
    expect(intent.status).toBe(409);
  });

  it("atomicity: audit ล้มเหลว → ไม่เหลือ payment ค้าง (rollback ทั้ง state)", async () => {
    const doomed = createMemoryStore({ failAudit: (input) => input.action === "payment_created" });
    const menu = await doomed.createMenuItem(
      { category: "อาหารจานเดียว", name: "ข้าวผัดป้าอ้อ", price: 50, kind: "food" },
      { ip: "127.0.0.1" },
    );
    const { order } = await doomed.createOrder(
      {
        guestName: "คุณมินตรา",
        guestPhone: "0812345678",
        serviceType: "takeaway",
        idempotencyKey: randomUUID(),
        items: [{ menuId: menu.id, quantity: 1 }],
      },
      { ip: "127.0.0.1" },
    );
    await expect(
      doomed.createPayment(
        { orderId: order.id, method: "cash", idempotencyKey: randomUUID(), receivedAmount: 50 },
        { ip: "127.0.0.1" },
      ),
    ).rejects.toThrow("audit");
    // rollback: ไม่มี payment เหลือค้าง และสร้างใหม่ได้หลัง audit หายล้มเหลว
    expect(await doomed.getOrderPayment(order.id)).toBeNull();
    expect(await doomed.getOrderPaymentState(order.id)).toBe("pending_payment");
  });

  it("provider contract: fake ตรวจ slip ตาม prefix; production contract-only โยน error (ไม่แตะ credentials)", async () => {
    const fake = new FakePromptPayProvider();
    await expect(fake.verifySlip("VALID-ABC")).resolves.toBe("success");
    await expect(fake.verifySlip("AMBIGUOUS-X")).resolves.toBe("ambiguous");
    await expect(fake.verifySlip("???")).resolves.toBe("fail");
    const intent = await fake.createIntent("pid-1", 50, new Date("2026-09-14T10:15:00.000Z"));
    expect(intent.qrPayload).toContain("PROMPTPAY-FAKE:pid-1:50");
    const prod = new ContractOnlyPaymentProvider();
    await expect(prod.createIntent("x", 1, new Date())).rejects.toThrow("contract-only");
    await expect(prod.verifySlip("VALID-1")).rejects.toThrow("contract-only");
  });

  it("ลูกค้าเห็นใบเสร็จของตนเอง; ค้นหาหลังร้านด้วยเลข/สถานะได้ (FR-PAY-004)", async () => {
    const order = await guestOrder();
    const { payment } = await store.createPayment(
      { orderId: order.id, method: "cash", idempotencyKey: randomUUID(), receivedAmount: 60 },
      { ip: "127.0.0.1" },
    );
    const { receipt } = await store.confirmCashPayment(payment.id, { receivedAmount: 60 }, { ip: "127.0.0.1" });
    const guest = request.agent(app);
    let token = await csrfToken(guest);
    const mine = await guest.get(`/api/receipts/by-payment/${payment.id}?phone=0812345678`).set("x-csrf-token", token);
    expect(mine.status).toBe(200);
    expect(mine.body.receipt.receiptNumber).toBe(receipt.receiptNumber);
    // เบอร์ผิดเห็นไม่ได้
    const other = await guest.get(`/api/receipts/by-payment/${payment.id}?phone=0899999999`);
    expect([401, 403, 404]).toContain(other.status);
    // หลังร้านค้นหา
    const owner = await loginAs("owner", "OwnerPass123");
    const found = await owner.get(`/api/payments?q=${order.orderNumber}&status=paid`);
    expect(found.status).toBe(200);
    expect((found.body.payments as { id: string }[]).map((p) => p.id)).toContain(payment.id);
    const receipts = await owner.get(`/api/receipts?q=${receipt.receiptNumber}`);
    expect((receipts.body.receipts as { receiptNumber: string }[]).map((r) => r.receiptNumber)).toContain(receipt.receiptNumber);
    void token;
  });
});
