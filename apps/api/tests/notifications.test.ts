import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakeLineMessagingProvider } from "../src/notify/messaging.js";
import { enqueueDueReminders } from "../src/routes/notifications.js";

describe("Ticket 12 LINE notifications outbox and reliability (public HTTP seam + memory)", () => {
  let store: Store;
  let app: Express;
  let messaging: FakeLineMessagingProvider;
  let tableId: string;

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

  async function registerCustomer(name: string, phone: string): Promise<{ agent: Agent; id: string }> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer11" });
    expect(res.status).toBe(201);
    return { agent, id: res.body.customer.id as string };
  }

  function noSecrets(body: unknown): void {
    const raw = JSON.stringify(body);
    for (const secret of [
      "providerSubject",
      "accessToken",
      "access_token",
      "idToken",
      "refreshToken",
      "clientSecret",
      "channelSecret",
    ]) {
      expect(raw).not.toContain(secret);
    }
  }

  beforeEach(async () => {
    store = createMemoryStore();
    messaging = new FakeLineMessagingProvider();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("KitchenPass123", 10), roles: ["kitchen"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, messaging });
    const owner = await loginAs("owner", "OwnerPass123");
    const table = await store.createShopTable(
      { name: "เอ1", capacity: 4 },
      { actorId: "seed", actorUsername: "owner", ip: null },
    );
    tableId = table.id;
    void owner;
  });

  async function reserveAs(customer: Agent, reservedAt: string): Promise<{ id: string; code: string }> {
    const token = await csrfToken(customer);
    const res = await customer.post("/api/reservations").set("x-csrf-token", token).send({
      tableId,
      partySize: 2,
      reservedAt,
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    return { id: res.body.reservation.id as string, code: res.body.reservation.code as string };
  }

  it("สร้างการจองเข้าคิวแจ้งเตือนอัตโนมัติ และ eventKey ซ้ำเป็น no-op", async () => {
    const { id: customerId } = await registerCustomer("ลูกค้าแจ้งเตือน", "0812345678");
    void customerId;
    const customer = await (async () => {
      const agent = request.agent(app);
      const token = await csrfToken(agent);
      const res = await agent.post("/api/customers/login").set("x-csrf-token", token).send({
        phone: "0812345678",
        password: "Customer11",
      });
      expect(res.status).toBe(200);
      return agent;
    })();
    const reservedAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const { id } = await reserveAs(customer, reservedAt);
    const queued = await store.getNotificationByEventKey(`reservation_created:${id}`);
    expect(queued).not.toBeNull();
    expect(queued!.kind).toBe("reservation_created");
    expect(queued!.status).toBe("pending");
    expect(queued!.message).toContain("รับการจอง");
    // เรียกซ้ำด้วย eventKey เดิม → dedupe ไม่เพิ่มแถว/audit
    const auditsBefore = await store.listAudit("notification_", 100);
    const again = await store.queueNotification(
      {
        eventKey: `reservation_created:${id}`,
        kind: "reservation_created",
        customerId: queued!.customerId,
        message: "ข้อความอื่นต้องไม่ทับของเดิม",
      },
      { actorId: null },
      new Date(),
    );
    expect(again.deduplicated).toBe(true);
    expect(again.notification.message).toContain("รับการจอง");
    const auditsAfter = await store.listAudit("notification_", 100);
    expect(auditsAfter.length).toBe(auditsBefore.length);
  });

  it("flush ส่งสำเร็จเมื่อมี LINE link → sent และ provider ได้รับข้อความ", async () => {
    const { id: customerId } = await registerCustomer("ลูกค้าไลน์", "0822345678");
    await store.linkLineIdentity(
      customerId,
      { providerSubject: "Ulinked-001", displayName: "ลูกค้าไลน์" },
      { actorId: customerId },
    );
    const customer = await (async () => {
      const agent = request.agent(app);
      const token = await csrfToken(agent);
      await agent.post("/api/customers/login").set("x-csrf-token", token).send({
        phone: "0822345678",
        password: "Customer11",
      });
      return agent;
    })();
    const { id } = await reserveAs(customer, new Date(Date.now() + 2 * 3600_000).toISOString());
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const run = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({ limit: 50 });
    expect(run.status).toBe(200);
    expect(run.body.result.sent).toBe(1);
    expect(messaging.calls).toHaveLength(1);
    expect(messaging.calls[0]!.to).toBe("Ulinked-001");
    expect(messaging.calls[0]!.message).toContain("รับการจอง");
    const done = await store.getNotificationByEventKey(`reservation_created:${id}`);
    expect(done!.status).toBe("sent");
    expect(done!.sentAt).not.toBeNull();
    noSecrets(run.body);
  });

  it("ไม่มี LINE link → skipped แต่ลูกค้าอ่านในเว็บได้ (web fallback)", async () => {
    const { agent, id: customerId } = await registerCustomer("ลูกค้าไม่เชื่อม", "0832345678");
    void agent;
    const customer = await (async () => {
      const a = request.agent(app);
      const token = await csrfToken(a);
      await a.post("/api/customers/login").set("x-csrf-token", token).send({
        phone: "0832345678",
        password: "Customer11",
      });
      return a;
    })();
    const { id } = await reserveAs(customer, new Date(Date.now() + 2 * 3600_000).toISOString());
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const run = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({});
    expect(run.status).toBe(200);
    expect(run.body.result.skipped).toBe(1);
    const skipped = await store.getNotificationByEventKey(`reservation_created:${id}`);
    expect(skipped!.status).toBe("skipped");
    // web fallback: เจ้าของอ่านของตนเองได้
    const mine = await customer.get("/api/notifications/mine/list?limit=50");
    expect(mine.status).toBe(200);
    expect(mine.body.lineLinked).toBe(false);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].message).toContain("รับการจอง");
    noSecrets(mine.body);
    void customerId;
  });

  it("ปิด consent → skipped; เปิดใหม่ + retry ด้วยมือ → ส่งได้", async () => {
    const { id: customerId } = await registerCustomer("ลูกค้าปิดรับ", "0842345678");
    await store.linkLineIdentity(
      customerId,
      { providerSubject: "Ulinked-002", displayName: "ลูกค้าปิดรับ" },
      { actorId: customerId },
    );
    await store.setNotificationConsent(customerId, false, { actorId: customerId });
    const customer = await (async () => {
      const a = request.agent(app);
      const token = await csrfToken(a);
      await a.post("/api/customers/login").set("x-csrf-token", token).send({
        phone: "0842345678",
        password: "Customer11",
      });
      return a;
    })();
    const { id } = await reserveAs(customer, new Date(Date.now() + 2 * 3600_000).toISOString());
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const run = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({});
    expect(run.body.result.skipped).toBe(1);
    // เปิด consent ใหม่แล้ว retry ด้วยมือ
    await store.setNotificationConsent(customerId, true, { actorId: customerId });
    const queued = await store.getNotificationByEventKey(`reservation_created:${id}`);
    token = await csrfToken(owner);
    const retried = await owner
      .post(`/api/notifications/${queued!.id}/retry`)
      .set("x-csrf-token", token)
      .send({ reason: "ลูกค้าเปิดรับแล้ว" });
    expect(retried.status).toBe(200);
    expect(retried.body.notification.status).toBe("pending");
    token = await csrfToken(owner);
    const run2 = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({});
    expect(run2.body.result.sent).toBe(1);
    expect(messaging.calls).toHaveLength(1);
  });

  it("provider ล้มเหลวซ้ำ → failed มี backoff; ครบ 5 ครั้ง → dead_letter", async () => {
    messaging.behavior.failSend = true;
    const { id: customerId } = await registerCustomer("ลูกค้าล้มเหลว", "0852345678");
    await store.linkLineIdentity(
      customerId,
      { providerSubject: "Ulinked-003", displayName: "ลูกค้าล้มเหลว" },
      { actorId: customerId },
    );
    const customer = await (async () => {
      const a = request.agent(app);
      const token = await csrfToken(a);
      await a.post("/api/customers/login").set("x-csrf-token", token).send({
        phone: "0852345678",
        password: "Customer11",
      });
      return a;
    })();
    const { id } = await reserveAs(customer, new Date(Date.now() + 2 * 3600_000).toISOString());
    const owner = await loginAs("owner", "OwnerPass123");
    const now = new Date();
    // รอบ 1–4: failed + nextRetryAt ขยับตาม backoff
    let current = now;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const due = await store.listDueNotifications(current, 50);
      expect(due.map((n) => n.eventKey)).toContain(`reservation_created:${id}`);
      const fakeNow = new Date(current.getTime());
      const claimed = await store.claimNotification(due.find((n) => n.eventKey === `reservation_created:${id}`)!.id, fakeNow);
      expect(claimed!.attempts).toBe(attempt);
      const { computeNotificationBackoff } = await import("../src/notify/validation.js");
      const backoff = computeNotificationBackoff(claimed!.attempts, fakeNow, claimed!.maxAttempts);
      const failed = await store.failNotificationSend(
        claimed!.id,
        { error: "ส่งข้อความไม่สำเร็จ (fake)", nextRetryAt: backoff },
        { actorId: "owner" },
        fakeNow,
      );
      expect(failed.status).toBe("failed");
      expect(failed.nextRetryAt).not.toBeNull();
      current = new Date(new Date(failed.nextRetryAt!).getTime() + 1000);
    }
    // รอบ 5: attempt ครบ max → dead_letter
    const due5 = await store.listDueNotifications(current, 50);
    const claimed5 = await store.claimNotification(
      due5.find((n) => n.eventKey === `reservation_created:${id}`)!.id,
      current,
    );
    expect(claimed5!.attempts).toBe(5);
    const { computeNotificationBackoff: backoff5 } = await import("../src/notify/validation.js");
    expect(backoff5(claimed5!.attempts, current, claimed5!.maxAttempts)).toBeNull();
    const dead = await store.failNotificationSend(
      claimed5!.id,
      { error: "ส่งข้อความไม่สำเร็จ (fake)", nextRetryAt: null },
      { actorId: "owner" },
      current,
    );
    expect(dead.status).toBe("dead_letter");
    // route run-outbox ไม่แตะ dead_letter แล้ว
    const token = await csrfToken(owner);
    const run = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({});
    expect(run.body.result.checked).toBe(0);
    const audits = await store.listAudit("notification_", 100);
    expect(audits.some((a) => a.action === "notification_dead_letter")).toBe(true);
  });

  it("timeout ของ provider เป็น retryable และ error ถูก sanitize", async () => {
    messaging.behavior.timeout = true;
    const { id: customerId } = await registerCustomer("ลูกค้า timeout", "0862345678");
    await store.linkLineIdentity(
      customerId,
      { providerSubject: "Ulinked-004", displayName: "ลูกค้า timeout" },
      { actorId: customerId },
    );
    await store.queueNotification(
      {
        eventKey: "payment_paid:pay-timeout-1",
        kind: "payment_paid",
        customerId,
        orderId: "order-timeout-1",
        message: "ร้านป้าอ้อ: รับชำระคำสั่งซื้อ ORD-X แล้ว 50 บาท",
      },
      { actorId: null },
      new Date(),
    );
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    const run = await owner.post("/api/notifications/run-outbox").set("x-csrf-token", token).send({});
    expect(run.body.result.failed).toBe(1);
    const failed = await store.getNotificationByEventKey("payment_paid:pay-timeout-1");
    expect(failed!.status).toBe("failed");
    expect(failed!.lastError).not.toBeNull();
    expect(failed!.lastError!.length).toBeLessThanOrEqual(500);
  });

  it("scheduler เตือน 30 นาทีกวาดถูกหน้าต่าง และรันซ้ำเป็น no-op", async () => {
    const { id: customerId } = await registerCustomer("ลูกค้าเตือน", "0872345678");
    const base = new Date("2026-09-15T10:00:00.000Z");
    // จองล่วงหน้า 3 ชม. (ผ่านกฎ ≥60 นาที) แล้วจำลองเวลามาใกล้เวลานัด 30 นาที
    await store.createReservation(
      {
        customerId,
        tableId,
        partySize: 3,
        reservedAt: new Date(base.getTime() + 3 * 3600_000).toISOString(),
        note: null,
        idempotencyKey: randomUUID(),
      },
      { actorId: customerId },
      base,
    );
    const target = await store.getReservationByCode(
      (await store.listCustomerReservations(customerId, 10))[0]!.code,
    );
    expect(target).not.toBeNull();
    // ใช้ fake now = reservedAt − 30 นาที แล้วรัน scheduler
    const fakeNow = new Date(new Date(target!.reservedAt).getTime() - 30 * 60_000);
    const first = await enqueueDueReminders(store, fakeNow, { actorId: null });
    expect(first.checked).toBe(1);
    expect(first.queued).toBe(1);
    const reminder = await store.getNotificationByEventKey(`reservation_reminder:${target!.id}`);
    expect(reminder).not.toBeNull();
    expect(reminder!.kind).toBe("reservation_reminder");
    expect(reminder!.message).toContain("เตือนนัดอีก 30 นาที");
    const second = await enqueueDueReminders(store, fakeNow, { actorId: null });
    expect(second.queued).toBe(0);
    expect(second.deduplicated).toBe(1);
  });

  it("RBAC: kitchen เรียก outbox ไม่ได้, guest อ่าน mine ไม่ได้, ลูกค้าแตะหลังร้านไม่ได้", async () => {
    const kitchen = await loginAs("kitchen1", "KitchenPass123");
    const denied = await kitchen.get("/api/notifications?limit=10");
    expect(denied.status).toBe(403);
    const anon = request.agent(app);
    const mineDenied = await anon.get("/api/notifications/mine/list");
    expect(mineDenied.status).toBe(401);
    const { agent } = await registerCustomer("ลูกค้า rbac", "0882345678");
    const customerList = await agent.get("/api/notifications?limit=10");
    expect(customerList.status).toBe(401);
    const token = await csrfToken(agent);
    const customerRetry = await agent.post("/api/notifications/xxx/retry").set("x-csrf-token", token).send({});
    expect([401, 403, 404]).toContain(customerRetry.status);
  });

  it("ชำระเงินสดสำเร็จเข้าคิว payment_paid โดยไม่พังเมื่อ notify มีปัญหา", async () => {
    // เมนู + คำสั่งซื้อ Guest (ไม่มี customerId → flush จะ skipped แต่ต้อง queued)
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const menu = await owner.post("/api/menu").set("x-csrf-token", token).send({
      category: "อาหารจานเดียว",
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    expect(menu.status).toBe(201);
    const guest = request.agent(app);
    token = await csrfToken(guest);
    const order = await guest.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "takeaway",
      items: [{ menuId: menu.body.item.id, quantity: 2 }],
      guestName: "คุณมินตรา",
      guestPhone: "0812345678",
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id as string;
    const total = order.body.order.total as number;
    token = await csrfToken(guest);
    const created = await guest.post("/api/payments").set("x-csrf-token", token).send({
      orderId,
      method: "cash",
      idempotencyKey: randomUUID(),
      receivedAmount: total,
      phone: "0812345678",
    });
    expect(created.status).toBe(201);
    token = await csrfToken(owner);
    const confirmed = await owner
      .post(`/api/payments/${created.body.payment.id}/confirm-cash`)
      .set("x-csrf-token", token)
      .send({ receivedAmount: total, reason: "รับเงินหน้าร้าน" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("paid");
    const queued = await store.getNotificationByEventKey(`payment_paid:${created.body.payment.id}`);
    expect(queued).not.toBeNull();
    expect(queued!.message).toContain("รับชำระ");
  });

  it("แลกคะแนน QR walk-in เข้าคิว loyalty_earned (drink ออก QR + ลูกค้าสแกน)", async () => {
    const drink = await (async () => {
      await store.createUser({
        username: "drink1",
        passwordHash: await bcrypt.hash("DrinkPass123", 10),
        roles: ["drink"],
      });
      return loginAs("drink1", "DrinkPass123");
    })();
    let token = await csrfToken(drink);
    const issued = await drink.post("/api/loyalty/walkin/issue").set("x-csrf-token", token).send({});
    expect(issued.status).toBe(201);
    const { agent } = await registerCustomer("ลูกค้า walkin", "0892345678");
    token = await csrfToken(agent);
    const scanned = await agent
      .post("/api/loyalty/walkin/scan")
      .set("x-csrf-token", token)
      .send({ code: issued.body.token.code });
    expect(scanned.status).toBe(200);
    const queued = await store.listNotifications({ customerId: undefined, limit: 200 });
    const earned = queued.filter((n) => n.kind === "loyalty_earned");
    expect(earned.length).toBe(1);
    expect(earned[0]!.message).toContain("คะแนน");
  });

  it("filter status/kind + audit ไม่มี secrets", async () => {
    const { id: customerId } = await registerCustomer("ลูกค้า filter", "0802345678");
    await store.queueNotification(
      {
        eventKey: "order_ready:order-filter-1",
        kind: "order_ready",
        customerId,
        orderId: "order-filter-1",
        message: "ร้านป้าอ้อ: คำสั่งซื้อ ORD-1 พร้อมรับครบแล้ว",
      },
      { actorId: null },
      new Date(),
    );
    const owner = await loginAs("owner", "OwnerPass123");
    const filtered = await owner.get("/api/notifications?kind=order_ready&status=pending&limit=10");
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    expect(filtered.body.items[0].kind).toBe("order_ready");
    const empty = await owner.get("/api/notifications?kind=payment_paid&status=sent&limit=10");
    expect(empty.body.items).toHaveLength(0);
    const audits = await store.listAudit("notification_", 100);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    noSecrets({ audits, items: filtered.body.items });
  });
});
