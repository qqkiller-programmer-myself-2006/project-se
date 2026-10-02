import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import {
  RECEIPT_QR_WINDOW_HOURS,
  isReceiptQrActive,
  issueReceiptQrCode,
  looksLikeReceiptQrCode,
  receiptQrExpiresAt,
  resolveReceiptQrSecret,
  verifyReceiptQrCode,
} from "../src/loyalty/receiptQr.js";

const SECRET = "test-receipt-qr-secret-0123456789";
const PAYMENT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("Issue #55 receiptQr token (domain)", () => {
  it("ออก token ตายตัวต่อใบเสร็จ รูปแบบ RCPT-<32hex>-<24hex> ตัวพิมพ์ใหญ่ และตรวจกลับได้", () => {
    const code = issueReceiptQrCode(PAYMENT_ID, SECRET);
    expect(code).toMatch(/^RCPT-[0-9A-F]{32}-[0-9A-F]{24}$/);
    expect(issueReceiptQrCode(PAYMENT_ID, SECRET)).toBe(code);
    expect(verifyReceiptQrCode(code, SECRET)).toEqual({ paymentId: PAYMENT_ID });
    expect(verifyReceiptQrCode(`  ${code.toLowerCase()} `, SECRET)).toEqual({ paymentId: PAYMENT_ID });
    expect(looksLikeReceiptQrCode(code)).toBe(true);
  });

  it("ปฏิเสธ token ที่ลายเซ็น/payment id ถูกแก้, secret ผิด, หรือรูปแบบผิด", () => {
    const code = issueReceiptQrCode(PAYMENT_ID, SECRET);
    const [prefix, id, sig] = code.split("-") as [string, string, string];
    const flip = (s: string) => (s[0] === "0" ? "1" : "0") + s.slice(1);
    expect(verifyReceiptQrCode(`${prefix}-${id}-${flip(sig)}`, SECRET)).toBeNull();
    expect(verifyReceiptQrCode(`${prefix}-${flip(id)}-${sig}`, SECRET)).toBeNull();
    expect(verifyReceiptQrCode(code, "another-secret-0123456789")).toBeNull();
    for (const bad of ["", "RCPT-", "WALKIN-AB12CD", `${code}-X`, code.slice(0, -1), 123, null, undefined]) {
      expect(verifyReceiptQrCode(bad, SECRET)).toBeNull();
    }
    expect(looksLikeReceiptQrCode("WALKIN-AB12CD")).toBe(false);
  });

  it("payment id ผิดรูปแบบ → ออก token ไม่ได้", () => {
    expect(() => issueReceiptQrCode("not-a-uuid", SECRET)).toThrow(/ไม่ถูกต้อง/);
  });

  it("secret: ตั้งเอง/production ไม่ตั้ง=ปิด/ไม่ production=สุ่ม/สั้นเกิน=ผิดพลาด", () => {
    expect(resolveReceiptQrSecret({ RECEIPT_QR_SECRET: "x".repeat(16) })).toBe("x".repeat(16));
    expect(resolveReceiptQrSecret({ NODE_ENV: "production" })).toBeNull();
    expect(resolveReceiptQrSecret({ NODE_ENV: "production", RECEIPT_QR_SECRET: "  " })).toBeNull();
    const dev1 = resolveReceiptQrSecret({ NODE_ENV: "development" });
    const dev2 = resolveReceiptQrSecret({ NODE_ENV: "development" });
    expect(dev1).toMatch(/^[0-9a-f]{64}$/);
    expect(dev1).not.toBe(dev2);
    expect(() => resolveReceiptQrSecret({ RECEIPT_QR_SECRET: "short" })).toThrow(/16/);
  });

  it("หมดอายุ 24 ชม. นับจากเวลาชำระเงิน (ขอบเขตพอดียังใช้ได้)", () => {
    const paidAt = "2026-09-15T08:00:00.000Z";
    expect(RECEIPT_QR_WINDOW_HOURS).toBe(24);
    expect(receiptQrExpiresAt(paidAt)).toBe("2026-09-16T08:00:00.000Z");
    expect(isReceiptQrActive(paidAt, new Date("2026-09-16T08:00:00.000Z"))).toBe(true);
    expect(isReceiptQrActive(paidAt, new Date("2026-09-16T08:00:00.001Z"))).toBe(false);
  });
});

describe("Issue #55 QR ใบเสร็จผูกแต้ม (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let offsetMs: number;
  let drinkId: string;
  let foodId: string;

  async function csrfToken(agent: Agent): Promise<string> {
    return (await agent.get("/api/auth/csrf")).body.csrfToken as string;
  }

  async function post(agent: Agent, url: string, body: Record<string, unknown>) {
    const token = await csrfToken(agent);
    return agent.post(url).set("x-csrf-token", token).send(body);
  }

  async function loginAs(username: string, password: string, a: Express = app): Promise<Agent> {
    const agent = request.agent(a);
    const res = await post(agent, "/api/auth/login", { username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  async function registerCustomer(name: string, phone: string): Promise<Agent> {
    const agent = request.agent(app);
    const res = await post(agent, "/api/customers/register", { name, phone, password: "Customer11" });
    expect(res.status).toBe(201);
    return agent;
  }

  async function menu(owner: Agent, name: string, kind: "food" | "drink", price: number): Promise<string> {
    const res = await post(owner, "/api/menu", { category: kind === "drink" ? "เครื่องดื่ม" : "อาหาร", name, price, kind });
    expect(res.status).toBe(201);
    return res.body.item.id as string;
  }

  /** Guest สั่ง (ชา 2 แก้ว + ข้าวผัด 1) แล้วชำระเงินสดสำเร็จ → คืน order + payment */
  async function paidGuestOrder(member?: Agent) {
    const buyer = member ?? request.agent(app);
    const body: Record<string, unknown> = {
      serviceType: "takeaway",
      items: [
        { menuId: drinkId, quantity: 2 },
        { menuId: foodId, quantity: 1 },
      ],
      idempotencyKey: randomUUID(),
    };
    if (!member) Object.assign(body, { guestName: "คุณแขก", guestPhone: "0812345678" });
    const created = await post(buyer, "/api/orders", body);
    expect(created.status).toBe(201);
    const order = created.body.order as { id: string; total: number };
    const pay = await post(buyer, "/api/payments", {
      orderId: order.id,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: order.total,
      ...(member ? {} : { phone: "0812345678" }),
    });
    expect(pay.status).toBe(201);
    const owner = await loginAs("owner", "OwnerPass123");
    const confirmed = await post(owner, `/api/payments/${pay.body.payment.id}/confirm-cash`, {
      receivedAmount: order.total,
      reason: "รับเงินหน้าร้าน",
    });
    expect(confirmed.status).toBe(200);
    return { order, paymentId: pay.body.payment.id as string, owner, buyer };
  }

  async function qrOf(buyer: Agent, paymentId: string, phone?: string) {
    return buyer.get(`/api/receipts/by-payment/${paymentId}${phone ? `?phone=${phone}` : ""}`);
  }

  async function complete(owner: Agent, orderId: string) {
    const token = await csrfToken(owner);
    const res = await owner
      .patch(`/api/orders/${orderId}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ลูกค้ารับของครบ" });
    expect(res.status).toBe(200);
  }

  async function balance(agent: Agent): Promise<number> {
    return (await agent.get("/api/loyalty/balance")).body.balance as number;
  }

  beforeEach(async () => {
    offsetMs = 0;
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    app = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      receiptQrSecret: SECRET,
      now: () => new Date(Date.now() + offsetMs),
    });
    const owner = await loginAs("owner", "OwnerPass123");
    drinkId = await menu(owner, "ชาเย็น", "drink", 30);
    foodId = await menu(owner, "ข้าวผัด", "food", 50);
  });

  it("ใบเสร็จของ Guest ที่ชำระแล้วมี claimQr (หมดอายุ = ชำระ + 24 ชม.); ก่อนชำระยังไม่มีใบเสร็จ", async () => {
    const { paymentId, buyer } = await paidGuestOrder();
    const res = await qrOf(buyer, paymentId, "0812345678");
    expect(res.status).toBe(200);
    expect(res.body.claimQr.code).toBe(issueReceiptQrCode(paymentId, SECRET));
    expect(res.body.claimQr.expiresAt).toBe(receiptQrExpiresAt(res.body.receipt.paidAt));
    // เรียกซ้ำได้ code เดิม (idempotent)
    expect((await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code).toBe(res.body.claimQr.code);
    // เบอร์ผิด/ไม่ใช่เจ้าของ → เห็นไม่ได้
    expect((await qrOf(request.agent(app), paymentId, "0899999999")).status).toBe(403);
  });

  it("ไม่ออก QR: ออเดอร์สมาชิก (ได้แต้มอัตโนมัติ), หมดอายุ 24 ชม., คืนเงินแล้ว, หรือไม่ได้ตั้ง secret", async () => {
    const member = await registerCustomer("สมาชิก", "0866666666");
    const mine = await paidGuestOrder(member);
    expect((await qrOf(member, mine.paymentId)).body.claimQr).toBeNull();

    const guest = await paidGuestOrder();
    expect((await qrOf(guest.buyer, guest.paymentId, "0812345678")).body.claimQr).not.toBeNull();
    offsetMs = (RECEIPT_QR_WINDOW_HOURS * 60 + 1) * 60 * 1000;
    expect((await qrOf(guest.buyer, guest.paymentId, "0812345678")).body.claimQr).toBeNull();
    offsetMs = 0;

    const refunded = await paidGuestOrder();
    const refund = await post(refunded.owner, `/api/payments/${refunded.paymentId}/refund`, { reason: "ลูกค้ายกเลิก" });
    expect(refund.status).toBe(200);
    expect((await qrOf(refunded.buyer, refunded.paymentId, "0812345678")).body.claimQr).toBeNull();

    const noSecretApp = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, receiptQrSecret: null });
    const res = await request.agent(noSecretApp).get(`/api/receipts/by-payment/${guest.paymentId}?phone=0812345678`);
    expect(res.status).toBe(200);
    expect(res.body.claimQr).toBeNull();
  });

  it("สแกนแล้วผูกออเดอร์เข้าบัญชีโดยไม่ต้องตรงเบอร์; แต้มเข้าตามกติกาเดิมเมื่อปิดงาน (ชา 2 แก้ว = 2 แต้ม อาหารไม่ได้)", async () => {
    const { order, paymentId, owner, buyer } = await paidGuestOrder();
    const code = (await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code as string;
    const customer = await registerCustomer("เพื่อนของแขก", "0877777777"); // คนละเบอร์กับที่สั่ง

    const claimed = await post(customer, "/api/loyalty/receipt/claim", { code });
    expect(claimed.status).toBe(200);
    expect(claimed.body.order.id).toBe(order.id);
    expect(claimed.body.order.customerId).not.toBeNull();
    expect(claimed.body.earned).toBe(0); // ยังไม่ส่งมอบ/ปิดงาน → แต้มยังไม่เข้า
    expect(await balance(customer)).toBe(0);

    await complete(owner, order.id);
    expect(await balance(customer)).toBe(2);
    const audits = await owner.get("/api/audit/loyalty?limit=100");
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain("loyalty_receipt_claimed");
  });

  it("ปิดงานก่อนแล้วค่อยสแกน → ได้แต้มทันที", async () => {
    const { order, paymentId, owner, buyer } = await paidGuestOrder();
    const code = (await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code as string;
    await complete(owner, order.id);
    const customer = await registerCustomer("ลูกค้า", "0877777777");
    const claimed = await post(customer, "/api/loyalty/receipt/claim", { code });
    expect(claimed.status).toBe(200);
    expect(claimed.body.earned).toBe(2);
    expect(await balance(customer)).toBe(2);
  });

  it("ใช้ครั้งเดียว: คนอื่น/คนเดิมสแกนซ้ำ และผูกด้วยเบอร์ (guest/link) หลังสแกน ถูกปฏิเสธ — แต้มไม่ซ้ำ", async () => {
    const { order, paymentId, owner, buyer } = await paidGuestOrder();
    const code = (await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code as string;
    await complete(owner, order.id);
    const first = await registerCustomer("คนแรก", "0812345678"); // เบอร์ตรงกับออเดอร์ (ผูกด้วยเบอร์ก็ได้)
    const second = await registerCustomer("คนที่สอง", "0877777777");

    expect((await post(first, "/api/loyalty/receipt/claim", { code })).status).toBe(200);
    const again = await post(first, "/api/loyalty/receipt/claim", { code });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/ถูกใช้ไปแล้ว/);
    expect((await post(second, "/api/loyalty/receipt/claim", { code })).status).toBe(409);
    expect((await post(first, "/api/loyalty/guest/link", { orderId: order.id })).status).toBe(409);
    expect(await balance(first)).toBe(2);
    expect(await balance(second)).toBe(0);
  });

  it("ผูกด้วยเบอร์ (guest/link) ไปก่อนแล้ว สแกน QR ภายหลังไม่ได้แต้มซ้ำ (409)", async () => {
    const { order, paymentId, owner, buyer } = await paidGuestOrder();
    const code = (await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code as string;
    await complete(owner, order.id);
    const byPhone = await registerCustomer("ผูกด้วยเบอร์", "0812345678");
    expect((await post(byPhone, "/api/loyalty/guest/link", { orderId: order.id })).status).toBe(200);
    const other = await registerCustomer("สแกนทีหลัง", "0877777777");
    expect((await post(other, "/api/loyalty/receipt/claim", { code })).status).toBe(409);
    expect(await balance(byPhone)).toBe(2);
    expect(await balance(other)).toBe(0);
  });

  it("ปฏิเสธ: ใบเสร็จของสมาชิก, หมดอายุ, คืนเงินแล้ว, code ปลอม/ผิดรูปแบบ, ไม่ล็อกอิน, ไม่ส่ง CSRF", async () => {
    const claimer = await registerCustomer("ลูกค้า", "0877777777");

    // ใบเสร็จของสมาชิกคนอื่น (ได้แต้มอัตโนมัติแล้ว)
    const member = await registerCustomer("สมาชิก", "0866666666");
    const mine = await paidGuestOrder(member);
    const memberCode = issueReceiptQrCode(mine.paymentId, SECRET);
    const memberTry = await post(claimer, "/api/loyalty/receipt/claim", { code: memberCode });
    expect(memberTry.status).toBe(409);
    expect(memberTry.body.error).toMatch(/มีเจ้าของแต้มแล้ว/);

    // หมดอายุ
    const stale = await paidGuestOrder();
    const staleCode = (await qrOf(stale.buyer, stale.paymentId, "0812345678")).body.claimQr.code as string;
    offsetMs = (RECEIPT_QR_WINDOW_HOURS * 60 + 1) * 60 * 1000;
    const expired = await post(claimer, "/api/loyalty/receipt/claim", { code: staleCode });
    expect(expired.status).toBe(409);
    expect(expired.body.error).toMatch(/หมดอายุ/);
    offsetMs = 0;

    // คืนเงินแล้ว
    const refunded = await paidGuestOrder();
    const refundedCode = (await qrOf(refunded.buyer, refunded.paymentId, "0812345678")).body.claimQr.code as string;
    expect((await post(refunded.owner, `/api/payments/${refunded.paymentId}/refund`, { reason: "ยกเลิก" })).status).toBe(200);
    expect((await post(claimer, "/api/loyalty/receipt/claim", { code: refundedCode })).status).toBe(409);

    // ปลอม/ผิดรูปแบบ/ใบเสร็จที่ไม่มีอยู่จริงแต่ลายเซ็นถูก
    expect((await post(claimer, "/api/loyalty/receipt/claim", { code: "RCPT-" + "0".repeat(32) + "-" + "0".repeat(24) })).status).toBe(400);
    expect((await post(claimer, "/api/loyalty/receipt/claim", { code: "WALKIN-AB12CD" })).status).toBe(400);
    expect((await post(claimer, "/api/loyalty/receipt/claim", { code: 123 })).status).toBe(400);
    expect((await post(claimer, "/api/loyalty/receipt/claim", { code: issueReceiptQrCode(randomUUID(), SECRET) })).status).toBe(404);

    // ต้องล็อกอินสมาชิก + CSRF
    const anon = request.agent(app);
    expect((await post(anon, "/api/loyalty/receipt/claim", { code: staleCode })).status).toBe(401);
    expect((await claimer.post("/api/loyalty/receipt/claim").send({ code: staleCode })).status).toBe(403);
  });

  it("สแกนแล้วคืนเงิน (ทำได้เฉพาะก่อนเริ่มทำ) → ออเดอร์ถูกยกเลิก ไม่มีแต้มค้างและปิดงานย้อนหลังไม่ได้", async () => {
    const { order, paymentId, owner, buyer } = await paidGuestOrder();
    const code = (await qrOf(buyer, paymentId, "0812345678")).body.claimQr.code as string;
    const customer = await registerCustomer("ลูกค้า", "0877777777");
    const claimed = await post(customer, "/api/loyalty/receipt/claim", { code });
    expect(claimed.status).toBe(200);
    expect(claimed.body.earned).toBe(0);
    expect((await post(owner, `/api/payments/${paymentId}/refund`, { reason: "คืนเงินลูกค้า" })).status).toBe(200);
    const token = await csrfToken(owner);
    const reopen = await owner
      .patch(`/api/orders/${order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ลองปิดงานหลังคืนเงิน" });
    expect(reopen.status).toBe(409);
    expect(await balance(customer)).toBe(0);
  });

  it("ไม่ได้ตั้ง secret (production) → สแกนได้ 503 ไม่ใช่ข้อผิดพลาดอื่น", async () => {
    const noSecretApp = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, receiptQrSecret: null });
    const agent = request.agent(noSecretApp);
    const res = await post(agent, "/api/loyalty/receipt/claim", { code: "RCPT-X" });
    expect(res.status).toBe(503);
  });
});
