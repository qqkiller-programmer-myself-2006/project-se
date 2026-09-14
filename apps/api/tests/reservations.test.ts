import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";
import { FakeReservationQrProvider } from "../src/reservations/qr.js";
import { createStoreOccupancyProvider } from "../src/reservations/occupancy.js";

/** จันทร์ 2026-09-14 10:00 กรุงเทพ = 03:00 UTC */
const BASE_NOW = new Date("2026-09-14T03:00:00.000Z");
const isoPlus = (ms: number): string => new Date(BASE_NOW.getTime() + ms).toISOString();
const H = 3600_000;
const DAY = 24 * H;

function reserveBody(over: Record<string, unknown> = {}) {
  return {
    partySize: 2,
    reservedAt: isoPlus(2 * H),
    idempotencyKey: randomUUID(),
    ...over,
  };
}

describe("Ticket 06 reservations and table rounds (public HTTP seam)", () => {
  let store: Store;
  let app: Express;
  let now: Date;
  let tableA1: string;
  let tableB2: string;

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

  async function registerCustomer(name: string, phone: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/customers/register")
      .set("x-csrf-token", token)
      .send({ name, phone, password: "Customer123" });
    expect(res.status).toBe(201);
    return agent;
  }

  async function createTable(owner: Agent, name: string, capacity: number): Promise<string> {
    const token = await csrfToken(owner);
    const res = await owner.post("/api/tables").set("x-csrf-token", token).send({ name, capacity });
    expect(res.status).toBe(201);
    return res.body.table.id as string;
  }

  beforeEach(async () => {
    now = new Date(BASE_NOW);
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(now) });
    const owner = await loginAs("owner", "OwnerPass123");
    tableA1 = await createTable(owner, "A1", 2);
    tableB2 = await createTable(owner, "B2", 6);
  });

  it("ลูกค้าสร้าง/ดู/ยกเลิกการจองของตนเองได้ (201 + รหัส RSV + QR) — Guest สร้างไม่ได้ 401", async () => {
    const customer = await registerCustomer("ลูกค้า เอ", "0811111111");
    let token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1 }));
    expect(created.status).toBe(201);
    expect(created.body.deduplicated).toBe(false);
    const r = created.body.reservation;
    expect(r.code).toMatch(/^RSV-\d{8}-[A-Z0-9]{4}$/);
    expect(r.status).toBe("pending");
    expect(r.tableId).toBe(tableA1);
    expect(r.qr).toContain(r.code);

    // ของฉันเห็น 1 รายการ
    const mine = await customer.get("/api/reservations/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.reservations).toHaveLength(1);

    // ดูรายละเอียดของตนเองได้
    const detail = await customer.get(`/api/reservations/mine/${r.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.reservation.code).toBe(r.code);

    // ยกเลิกก่อนนัดนาน ๆ ได้
    token = await csrfToken(customer);
    const cancelled = await customer
      .post(`/api/reservations/mine/${r.id}/cancel`)
      .set("x-csrf-token", token)
      .send({ reason: "ติดธุระ" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.reservation.status).toBe("cancelled");

    // Guest (ไม่ login) สร้างไม่ได้
    const anon = request.agent(app);
    token = await csrfToken(anon);
    const guestTry = await anon
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody());
    expect(guestTry.status).toBe(401);
  });

  it("กฎเวลา: ช้ากว่า 60 นาทีไม่ได้ / เกิน 3 วันไม่ได้ / ขอบเขตพอดีผ่าน; ยกเลิกก่อนนัด <60 นาทีไม่ได้", async () => {
    const customer = await registerCustomer("ลูกค้า บี", "0822222222");
    async function tryReserve(reservedAt: string): Promise<number> {
      const token = await csrfToken(customer);
      return (
        await customer.post("/api/reservations").set("x-csrf-token", token).send(reserveBody({ reservedAt }))
      ).status;
    }
    expect(await tryReserve(isoPlus(59 * 60_000))).toBe(400); // 59 นาที
    expect(await tryReserve(isoPlus(60 * 60_000))).toBe(201); // 60 นาทีพอดี
    expect(await tryReserve(isoPlus(3 * DAY))).toBe(201); // 3 วันพอดี
    expect(await tryReserve(isoPlus(3 * DAY + 60_000))).toBe(400); // เกิน 3 วัน
    expect(await tryReserve("not-a-date")).toBe(400);

    // ยกเลิกก่อนนัด 30 นาทีไม่ได้ (409) — สร้างตอน +2h แล้วย้าย clock ไป +90min (เหลือ 30 นาที)
    const token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ reservedAt: isoPlus(2 * H) }));
    expect(created.status).toBe(201);
    now = new Date(BASE_NOW.getTime() + 90 * 60_000);
    const token2 = await csrfToken(customer);
    const lateCancel = await customer
      .post(`/api/reservations/mine/${created.body.reservation.id}/cancel`)
      .set("x-csrf-token", token2)
      .send({ reason: "เปลี่ยนใจ" });
    expect(lateCancel.status).toBe(409);
  });

  it("เลือกโต๊ะเองหรือรับคำแนะนำ (เล็กที่สุดที่จุพอ) — โต๊ะงดใช้งาน/จุไม่พอ/ไม่ว่างถูกปฏิเสธ", async () => {
    const customer = await registerCustomer("ลูกค้า ซี", "0833333333");
    // แนะนำ: 2 คน → A1 (เล็กที่สุด)
    const rec = await customer.get(`/api/reservations/recommend?partySize=2&reservedAt=${encodeURIComponent(isoPlus(2 * H))}`);
    expect(rec.status).toBe(200);
    expect(rec.body.table?.name).toBe("A1");

    // จอง A1 ช่วงเดียวกันแล้ว → แนะนำ 2 คนกลายเป็น B2
    let token = await csrfToken(customer);
    const first = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1 }));
    expect(first.status).toBe(201);
    const rec2 = await customer.get(`/api/reservations/recommend?partySize=2&reservedAt=${encodeURIComponent(isoPlus(2 * H))}`);
    expect(rec2.body.table?.name).toBe("B2");

    // จองซ้ำโต๊ะเดิมช่วงทับซ้อน (ห่าง 30 นาที < 120 นาที window) → 409
    token = await csrfToken(customer);
    const clash = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, reservedAt: isoPlus(2 * H + 30 * 60_000) }));
    expect(clash.status).toBe(409);

    // ห่าง 121 นาที → ไม่ทับซ้อน จองได้
    token = await csrfToken(customer);
    const apart = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, reservedAt: isoPlus(2 * H + 121 * 60_000) }));
    expect(apart.status).toBe(201);

    // โต๊ะจุไม่พอ (A1 จุ 2 แต่ขอ 5) → 409
    token = await csrfToken(customer);
    const tooMany = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, partySize: 5 }));
    expect(tooMany.status).toBe(409);

    // โต๊ะงดใช้งาน → 409
    const owner = await loginAs("owner", "OwnerPass123");
    let ot = await csrfToken(owner);
    await owner.patch(`/api/tables/${tableB2}`).set("x-csrf-token", ot).send({ isEnabled: false });
    token = await csrfToken(customer);
    const disabled = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableB2, reservedAt: isoPlus(5 * H) }));
    expect(disabled.status).toBe(409);
  });

  it("idempotency: key เดิม + payload เดิมคืนของเดิม (200) ไม่เขียน audit ซ้ำ; payload ต่างกันได้ 409", async () => {
    const customer = await registerCustomer("ลูกค้า ดี", "0844444444");
    const key = randomUUID();
    let token = await csrfToken(customer);
    const first = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, idempotencyKey: key }));
    expect(first.status).toBe(201);

    const owner = await loginAs("owner", "OwnerPass123");
    const auditsBefore = (await owner.get("/api/audit/reservations")).body.items.length as number;

    token = await csrfToken(customer);
    const replay = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, idempotencyKey: key }));
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.reservation.id).toBe(first.body.reservation.id);
    const auditsAfter = (await owner.get("/api/audit/reservations")).body.items.length as number;
    expect(auditsAfter).toBe(auditsBefore);

    token = await csrfToken(customer);
    const conflict = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableB2, idempotencyKey: key }));
    expect(conflict.status).toBe(409);
  });

  it("concurrent ชนกันสำเร็จได้รายการเดียว และโต๊ะไม่ติดค้าง (จองช่วงอื่นต่อได้)", async () => {
    const customer = await registerCustomer("ลูกค้า อี", "0855555555");
    const at = isoPlus(2 * H);
    // สองคำขอชนกันพร้อมกันบนโต๊ะ/ช่วงเวลาเดียวกัน → สำเร็จได้รายการเดียว
    const t1 = await csrfToken(customer);
    const [r1, r2] = await Promise.all([
      customer.post("/api/reservations").set("x-csrf-token", t1).send(reserveBody({ tableId: tableA1, reservedAt: at })),
      customer.post("/api/reservations").set("x-csrf-token", t1).send(reserveBody({ tableId: tableA1, reservedAt: at })),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses).toContain(409);

    // โต๊ะไม่ติดค้าง: จองช่วงไม่ทับซ้อน (ห่าง 3 ชม.) ต้องสำเร็จ
    const t3 = await csrfToken(customer);
    const later = await customer
      .post("/api/reservations")
      .set("x-csrf-token", t3)
      .send(reserveBody({ tableId: tableA1, reservedAt: isoPlus(5 * H) }));
    expect(later.status).toBe(201);
  });

  it("audit ล้มเหลว → การจองถูก rollback ทั้งหมด (ไม่มี partial reservation)", async () => {
    const failing = createMemoryStore({ failAudit: (input) => input.action.startsWith("reservation_") });
    const failingApp = createApp({ store: failing, loginRateMax: 1000, customerRateMax: 1000, now: () => new Date(now) });
    const table = await failing.createShopTable({ name: "A9", capacity: 4 }, {});
    const customer = await failing.createCustomer(
      { name: "ลูกค้า ทดสอบ", phone: "0899999999", email: null, passwordHash: "x" },
      {},
    );
    const before = await failing.listReservations({ limit: 50 });
    await expect(
      failing.createReservation(
        { customerId: customer.id, tableId: table.id, partySize: 2, reservedAt: isoPlus(2 * H) },
        {},
        new Date(now),
      ),
    ).rejects.toThrow();
    expect(await failing.listReservations({ limit: 50 })).toHaveLength(before.length);
    void failingApp;
  });

  it("หลังร้าน: ค้นหา/ดู/เปลี่ยนสถานะ/ยกเลิก + audit actor/reason/before/after; kitchen/drink/guest ถูกปฏิเสธ", async () => {
    const customer = await registerCustomer("ลูกค้า เอฟ", "0866666666");
    let token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableB2 }));
    const id = created.body.reservation.id as string;
    const code = created.body.reservation.code as string;

    const admin = await loginAs("admin1", "AdminPass123");
    const search = await admin.get(`/api/admin/reservations?q=${encodeURIComponent(code)}`);
    expect(search.status).toBe(200);
    expect(search.body.reservations).toHaveLength(1);

    token = await csrfToken(admin);
    const confirmed = await admin
      .patch(`/api/admin/reservations/${id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "confirmed", reason: "โทรยืนยันแล้ว" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.reservation.status).toBe("confirmed");

    // เปลี่ยนข้าม seated ตรง ๆ ไม่ได้ (ต้องผ่านเช็กอิน)
    token = await csrfToken(admin);
    const badJump = await admin
      .patch(`/api/admin/reservations/${id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "seated", reason: "ลัด" });
    expect(badJump.status).toBe(400);

    // audit มี actor/reason/before/after
    const audits = await admin.get("/api/audit/reservations");
    expect(audits.status).toBe(200);
    const changed = (audits.body.items as { action: string; detail: string }[]).find(
      (a) => a.action === "reservation_status_changed",
    );
    expect(changed).toBeTruthy();
    expect(changed!.detail).toContain("pending → confirmed");
    expect(changed!.detail).toContain("โทรยืนยันแล้ว");
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toContain("reservation_created");

    // kitchen/drink ถูกปฏิเสธ 403 ทุกเส้นหลังร้าน + เช็กอิน + รอบ
    for (const [u, p] of [["kitchen1", "Kitchen123"], ["drink1", "DrinkPass1"]] as const) {
      const staff = await loginAs(u, p);
      expect((await staff.get("/api/admin/reservations")).status).toBe(403);
      expect((await staff.get(`/api/admin/reservations/${id}`)).status).toBe(403);
      const t = await csrfToken(staff);
      expect(
        (await staff.patch(`/api/admin/reservations/${id}/status`).set("x-csrf-token", t).send({ status: "cancelled", reason: "x" })).status,
      ).toBe(403);
      const t2 = await csrfToken(staff);
      expect(
        (await staff.post("/api/checkin").set("x-csrf-token", t2).send({ code, partySize: 2 })).status,
      ).toBe(403);
      expect((await staff.get("/api/rounds")).status).toBe(403);
    }

    // ไม่ login ดูหลังร้านไม่ได้ 401
    expect((await request(app).get("/api/admin/reservations")).status).toBe(401);

    // ลูกค้าคนอื่นดู/ยกเลิกของคนนี้ไม่ได้ 403
    const other = await registerCustomer("ลูกค้า จี", "0877777777");
    expect((await other.get(`/api/reservations/mine/${id}`)).status).toBe(403);
    const ot = await csrfToken(other);
    expect((await other.post(`/api/reservations/mine/${id}/cancel`).set("x-csrf-token", ot).send({})).status).toBe(403);
  });

  it("เช็กอินด้วยรหัส/เบอร์/QR ตรวจจำนวนจริง เปิดรอบได้ครั้งเดียว; โต๊ะไม่พอ → รอจัดโต๊ะ", async () => {
    const customer = await registerCustomer("ลูกค้า เอช", "0888888888");
    let token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1, partySize: 2 }));
    const code = created.body.reservation.code as string;
    const qrPayload = created.body.reservation.qr as string;

    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    const checkin = await admin
      .post("/api/checkin")
      .set("x-csrf-token", token)
      .send({ code, partySize: 2 });
    expect(checkin.status).toBe(201);
    expect(checkin.body.reservation.status).toBe("seated");
    expect(checkin.body.round.status).toBe("open");
    expect(checkin.body.round.tableId).toBe(tableA1);

    // เช็กอินซ้ำ → 409 (เปิดรอบได้ครั้งเดียว)
    token = await csrfToken(admin);
    const again = await admin.post("/api/checkin").set("x-csrf-token", token).send({ code, partySize: 2 });
    expect(again.status).toBe(409);

    // เช็กอินด้วยเบอร์เมื่อเหลือ active เดียว + ด้วย QR payload
    const c2 = await registerCustomer("ลูกค้า ไอ", "0891111111");
    token = await csrfToken(c2);
    await c2.post("/api/reservations").set("x-csrf-token", token).send(reserveBody({ tableId: tableB2, partySize: 3 }));
    token = await csrfToken(admin);
    const byPhone = await admin.post("/api/checkin").set("x-csrf-token", token).send({ phone: "0891111111", partySize: 3 });
    expect(byPhone.status).toBe(201);

    token = await csrfToken(admin);
    const byQr = await admin.post("/api/checkin").set("x-csrf-token", token).send({ qr: qrPayload, partySize: 2 });
    // จองแรก seated ไปแล้ว → 409 (ไม่ใช่ 400/500)
    expect(byQr.status).toBe(409);

    // โต๊ะตามจองจุไม่พอและไม่มีโต๊ะอื่น → รอจัดโต๊ะ 409 (สถานะคง confirmed)
    const c3 = await registerCustomer("ลูกค้า เจ", "0892222222");
    token = await csrfToken(c3);
    // ใช้โต๊ะเล็ก A1 ไม่ได้เพราะมีรอบเปิดอยู่ — จอง B2 (จุ 6) แต่เช็กอิน 7 คนไม่ได้อยู่ดี (เกิน max? ใช้ 6 คนบน A1 แทน)
    const r3 = await c3
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableB2, partySize: 2, reservedAt: isoPlus(6 * H) }));
    expect(r3.status).toBe(201);
    token = await csrfToken(admin);
    const waiting = await admin
      .post("/api/checkin")
      .set("x-csrf-token", token)
      .send({ code: r3.body.reservation.code, partySize: 50, tableId: tableA1 });
    // A1 จุ 2 ไม่พอ 50 → 409 พร้อมข้อความรอจัดโต๊ะ
    expect(waiting.status).toBe(409);
    expect(String(waiting.body.error)).toMatch(/ไม่พอ|รอจัดโต๊ะ/);
  });

  it("รอบผูกคำสั่งซื้อที่โต๊ะได้; รอบปิดรับคำสั่งซื้อใหม่ไม่ได้; ปิดรอบต้องไม่มีออเดอร์ค้าง", async () => {
    // เมนูสำหรับสั่ง
    const owner = await loginAs("owner", "OwnerPass123");
    let ot = await csrfToken(owner);
    const menu = await owner.post("/api/menu").set("x-csrf-token", ot).send({
      category: "อาหารจานเดียว",
      name: "ข้าวผัดป้าอ้อ",
      price: 50,
      kind: "food",
    });
    expect(menu.status).toBe(201);
    const menuId = menu.body.item.id as string;

    const customer = await registerCustomer("ลูกค้า เค", "0893333333");
    let token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableB2, partySize: 2 }));
    const code = created.body.reservation.code as string;

    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    const checkin = await admin.post("/api/checkin").set("x-csrf-token", token).send({ code, partySize: 2 });
    expect(checkin.status).toBe(201);
    const roundId = checkin.body.round.id as string;

    // สั่งที่โต๊ะผูก round (dine_in) ได้
    token = await csrfToken(customer);
    const order = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId, quantity: 1 }],
      idempotencyKey: randomUUID(),
      roundId,
    });
    expect(order.status).toBe(201);
    expect(order.body.order.roundId).toBe(roundId);
    expect(order.body.order.tableId).toBe(tableB2);

    // ปิดรอบทั้งที่มีออเดอร์รอชำระ → 409
    token = await csrfToken(admin);
    const closeBlocked = await admin.post(`/api/rounds/${roundId}/close`).set("x-csrf-token", token).send({});
    expect(closeBlocked.status).toBe(409);

    // ปิดงานออเดอร์ก่อน แล้วปิดรอบได้ (200) + การจอง → completed
    token = await csrfToken(admin);
    const done = await admin
      .patch(`/api/orders/${order.body.order.id}/status`)
      .set("x-csrf-token", token)
      .send({ status: "completed", reason: "ชำระครบแล้ว" });
    expect(done.status).toBe(200);
    token = await csrfToken(admin);
    const closed = await admin.post(`/api/rounds/${roundId}/close`).set("x-csrf-token", token).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.round.status).toBe("closed");
    const reread = await admin.get(`/api/admin/reservations/${created.body.reservation.id}`);
    expect(reread.body.reservation.status).toBe("completed");

    // รอบปิดแล้วสั่งใหม่ไม่ได้ 409
    token = await csrfToken(customer);
    const afterClose = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId, quantity: 1 }],
      idempotencyKey: randomUUID(),
      roundId,
    });
    expect(afterClose.status).toBe(409);

    // ระบุโต๊ะอย่างเดียวโดยไม่มีรอบ → 409 (ต้องเช็กอินก่อน)
    token = await csrfToken(customer);
    const noRound = await customer.post("/api/orders").set("x-csrf-token", token).send({
      serviceType: "dine_in",
      items: [{ menuId, quantity: 1 }],
      idempotencyKey: randomUUID(),
      tableId: tableB2,
    });
    expect(noRound.status).toBe(409);
  });

  it("public snapshot ไม่เปิดเผยข้อมูลลูกค้า (status + table-rounds)", async () => {
    const withOcc = createApp({
      store,
      loginRateMax: 1000,
      customerRateMax: 1000,
      now: () => new Date(now),
      occupancy: createStoreOccupancyProvider(store),
    });
    const customer = await registerCustomer("ลูกค้าลับ", "0894444444");
    let token = await csrfToken(customer);
    const created = await customer
      .post("/api/reservations")
      .set("x-csrf-token", token)
      .send(reserveBody({ tableId: tableA1 }));
    const admin = await loginAs("admin1", "AdminPass123");
    token = await csrfToken(admin);
    await admin.post("/api/checkin").set("x-csrf-token", token).send({ code: created.body.reservation.code, partySize: 2 });

    const status = await request(withOcc).get("/api/shop/status");
    expect(status.status).toBe(200);
    expect(status.body.tables).toEqual({ enabled: 2, free: 1, occupied: 1 });
    expect(status.body.customerCount).toBe(2);
    const rawStatus = JSON.stringify(status.body);
    for (const leak of ["ลูกค้าลับ", "0894444444", "RSV-", "customerId", "phone", "qr"]) {
      expect(rawStatus).not.toContain(leak);
    }

    const rounds = await request(app).get("/api/shop/table-rounds");
    expect(rounds.status).toBe(200);
    expect(rounds.body.rounds).toHaveLength(1);
    expect(rounds.body.rounds[0]).toEqual({
      tableId: tableA1,
      tableName: "A1",
      partySize: 2,
      openedAt: expect.any(String),
    });
    const rawRounds = JSON.stringify(rounds.body);
    for (const leak of ["ลูกค้าลับ", "0894444444", "RSV-", "customerId", "openedBy", "reservationId"]) {
      expect(rawRounds).not.toContain(leak);
    }
    void withOcc;
  });

  it("QR fake seam: encode/decode กลับได้ code เดิม, payload ผิดรูปโยน error ไทย, ไม่มี provider จริง", async () => {
    const fake = new FakeReservationQrProvider();
    expect(fake.kind).toBe("fake");
    const payload = fake.encode("RSV-20260914-AB12");
    expect(fake.decode(payload)).toBe("RSV-20260914-AB12");
    expect(fake.decode(payload.toLowerCase())).toBe("RSV-20260914-AB12");
    expect(() => fake.decode("not-a-qr")).toThrow("QR การจองไม่ถูกต้อง");
    expect(() => fake.encode("  ")).toThrow();
  });
});
