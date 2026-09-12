import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

/** จันทร์ 2026-09-07 10:00 +07:00 = จันทร์ 03:00 UTC */
const MON_10_BKK = new Date("2026-09-07T03:00:00.000Z");

function fullWeek(open = "09:00", close = "17:00"): Record<string, { closed: boolean; intervals: { open: string; close: string }[] }> {
  const days: Record<string, { closed: boolean; intervals: { open: string; close: string }[] }> = {};
  for (let d = 0; d <= 6; d += 1) days[String(d)] = { closed: false, intervals: [{ open, close }] };
  return days;
}

describe("Ticket 02 shop status and tables (public HTTP seam)", () => {
  let store: Store;
  let app: Express;
  let now: Date;

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

  async function managerWithCsrf(agent: Agent): Promise<string> {
    return csrfToken(agent);
  }

  beforeEach(async () => {
    now = new Date(MON_10_BKK);
    store = createMemoryStore();
    await store.createUser({ username: "owner", passwordHash: await bcrypt.hash("OwnerPass123", 10), roles: ["owner"] });
    await store.createUser({ username: "admin1", passwordHash: await bcrypt.hash("AdminPass123", 10), roles: ["admin"] });
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000, now: () => new Date(now) });
  });

  it("public snapshot ไม่ต้อง login มีฟิลด์ครบ ไม่มีข้อมูลหลังร้าน/ส่วนบุคคล", async () => {
    const res = await request(app).get("/api/shop/status");
    expect(res.status).toBe(200);
    expect(res.body.shopName).toBe("ร้านป้าอ้ออาหารตามสั่ง");
    expect(res.body.isOpen).toBe(true); // จันทร์ 10:00 อยู่ใน 09:00–21:00 default
    expect(res.body.isTemporary).toBe(false);
    expect(res.body.today.weekday).toBe(1);
    expect(res.body.tables).toEqual({ enabled: 0, free: 0, occupied: 0 });
    expect(res.body.customerCount).toBe(0);
    const raw = JSON.stringify(res.body);
    for (const secret of ["passwordHash", "password_hash", "roles", "audit", "actor", "username", "sid", "session"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("คำนวณ Asia/Bangkok + ขอบเขตเปิด/ปิดตรงตัว และวันปิดทั้งวัน", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await managerWithCsrf(owner);
    const days = fullWeek("09:00", "17:00");
    days["0"] = { closed: true, intervals: [] }; // อาทิตย์ปิด
    const put = await owner.put("/api/shop/schedule").set("x-csrf-token", token).send({ schedule: days });
    expect(put.status).toBe(200);

    now = new Date("2026-09-07T01:59:00.000Z"); // จันทร์ 08:59 BKK
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(false);
    now = new Date("2026-09-07T02:00:00.000Z"); // จันทร์ 09:00 ตรง
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(true);
    now = new Date("2026-09-07T09:59:00.000Z"); // จันทร์ 16:59
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(true);
    now = new Date("2026-09-07T10:00:00.000Z"); // จันทร์ 17:00 ตรง (end-exclusive)
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(false);
    now = new Date("2026-09-06T05:00:00.000Z"); // อาทิตย์ 12:00 BKK ปิดทั้งวัน
    const sunday = await request(app).get("/api/shop/status");
    expect(sunday.body.isOpen).toBe(false);
    expect(sunday.body.today.closed).toBe(true);
  });

  it("ช่วงข้ามเที่ยงคืน: คืนศุกร์เปิด ดึกวันเสาร์นับต่อ เช้าวันเสาร์หลังช่วงปิด", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await managerWithCsrf(owner);
    const days = fullWeek("09:00", "17:00");
    days["5"] = { closed: false, intervals: [{ open: "18:00", close: "02:00" }] }; // ศุกร์ข้ามคืน
    days["6"] = { closed: false, intervals: [{ open: "09:00", close: "17:00" }] };
    expect((await owner.put("/api/shop/schedule").set("x-csrf-token", token).send({ schedule: days })).status).toBe(200);

    now = new Date("2026-09-04T16:00:00.000Z"); // ศุกร์ 23:00 BKK
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(true);
    now = new Date("2026-09-04T18:00:00.000Z"); // เสาร์ 01:00 BKK (จากศุกร์)
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(true);
    now = new Date("2026-09-04T20:00:00.000Z"); // เสาร์ 03:00 หมดช่วง
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(false);
  });

  it("validate ตาราง: เวลาผิด ซ้อนทับ overnight ผิดตำแหน่ง ข้ามวันซ้อน ถูกปฏิเสธ 400", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await managerWithCsrf(owner);
    async function putSchedule(schedule: unknown): Promise<number> {
      const t = await csrfToken(owner);
      return (await owner.put("/api/shop/schedule").set("x-csrf-token", t).send({ schedule })).status;
    }
    void token;
    const bad1 = fullWeek(); bad1["1"] = { closed: false, intervals: [{ open: "25:00", close: "26:00" }] };
    expect(await putSchedule(bad1)).toBe(400);
    const bad2 = fullWeek(); bad2["1"] = { closed: false, intervals: [{ open: "09:00", close: "12:00" }, { open: "11:00", close: "13:00" }] };
    expect(await putSchedule(bad2)).toBe(400);
    const bad3 = fullWeek(); bad3["1"] = { closed: true, intervals: [{ open: "09:00", close: "10:00" }] };
    expect(await putSchedule(bad3)).toBe(400);
    const bad4 = fullWeek();
    bad4["1"] = { closed: false, intervals: [{ open: "18:00", close: "02:00" }, { open: "20:00", close: "22:00" }] }; // overnight ไม่ท้ายสุด
    expect(await putSchedule(bad4)).toBe(400);
    const bad5 = fullWeek();
    bad5["1"] = { closed: false, intervals: [{ open: "18:00", close: "10:00" }] }; // ลากถึง 10:00 ซ้อนวันอังคาร 09:00
    expect(await putSchedule(bad5)).toBe(400);
  });

  it("override ชนะตาราง + หมดอายุ + ล้างกลับ + ปิดต้องมีเหตุผล", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await managerWithCsrf(owner);
    // ปิดชั่วคราวโดยไม่มีเหตุผล → 400
    expect((await owner.post("/api/shop/override").set("x-csrf-token", token).send({ mode: "closed" })).status).toBe(400);
    // expiresAt ในอดีต/ตรงปัจจุบัน → 400 (ต้องอยู่ในอนาคตเท่านั้น)
    token = await csrfToken(owner);
    expect(
      (
        await owner.post("/api/shop/override").set("x-csrf-token", token).send({
          mode: "closed", reason: "ย้อนหลัง", expiresAt: new Date(now.getTime() - 1000).toISOString(),
        })
      ).status,
    ).toBe(400);
    token = await csrfToken(owner);
    const set = await owner.post("/api/shop/override").set("x-csrf-token", token).send({
      mode: "closed", reason: "ไฟดับ", expectedReopenAt: "2026-09-07T06:00:00.000Z",
    });
    expect(set.status).toBe(201);
    const closed = await request(app).get("/api/shop/status");
    expect(closed.body.isOpen).toBe(false);
    expect(closed.body.isTemporary).toBe(true);
    expect(closed.body.reason).toBe("ไฟดับ");
    expect(closed.body.expectedReopenAt).toBe("2026-09-07T06:00:00.000Z");

    // override มี expiresAt ในอนาคต → ยังมีผล; พอ clock เลย expiry → ถูกข้ามทั้ง public และ management
    token = await csrfToken(owner);
    const future = await owner.post("/api/shop/override").set("x-csrf-token", token).send({
      mode: "closed", reason: "ซ่อมไฟ", expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    expect(future.status).toBe(201);
    const cfgActive = await owner.get("/api/shop/schedule");
    expect(cfgActive.body.override?.reason).toBe("ซ่อมไฟ");
    expect(cfgActive.body.expiredOverride).toBeNull();
    now = new Date(now.getTime() + 2 * 3600_000); // เลย expiry
    expect((await request(app).get("/api/shop/status")).body.isTemporary).toBe(false);
    const cfgExpired = await owner.get("/api/shop/schedule");
    expect(cfgExpired.body.override).toBeNull();
    expect(cfgExpired.body.expiredOverride?.reason).toBe("ซ่อมไฟ");
    // ล้างของหมดอายุ → cleared true (ลบแถวจริง) และไม่มี expired ค้าง
    token = await csrfToken(owner);
    expect((await owner.delete("/api/shop/override").set("x-csrf-token", token)).body.cleared).toBe(true);
    expect((await owner.get("/api/shop/schedule")).body.expiredOverride).toBeNull();

    // เปิดชั่วคราวนอกเวลาทำการ
    now = new Date("2026-09-07T16:00:00.000Z"); // จันทร์ 23:00 BKK ปิดแล้ว
    expect((await request(app).get("/api/shop/status")).body.isOpen).toBe(false);
    token = await csrfToken(owner);
    await owner.post("/api/shop/override").set("x-csrf-token", token).send({ mode: "open" });
    const forced = await request(app).get("/api/shop/status");
    expect(forced.body.isOpen).toBe(true);
    expect(forced.body.isTemporary).toBe(true);

    // ล้างกลับไปใช้ตาราง
    token = await csrfToken(owner);
    const cleared = await owner.delete("/api/shop/override").set("x-csrf-token", token);
    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBe(true);
    const back = await request(app).get("/api/shop/status");
    expect(back.body.isTemporary).toBe(false);
    expect(back.body.isOpen).toBe(false);
  });

  it("สิทธิ์: Owner/Admin ได้, Kitchen/Drink/guest ถูกปฏิเสธที่ server", async () => {
    const guestSchedule = await request(app).get("/api/shop/schedule");
    expect(guestSchedule.status).toBe(401);

    const admin = await loginAs("admin1", "AdminPass123");
    expect((await admin.get("/api/shop/schedule")).status).toBe(200);
    expect((await admin.get("/api/tables")).status).toBe(200);
    expect((await admin.get("/api/audit/shop")).status).toBe(200);

    for (const [u, p] of [["kitchen1", "Kitchen123"], ["drink1", "DrinkPass1"]] as const) {
      const staff = await loginAs(u, p);
      const t = await csrfToken(staff);
      expect((await staff.get("/api/shop/schedule")).status).toBe(403);
      expect((await staff.put("/api/shop/schedule").set("x-csrf-token", t).send({ schedule: fullWeek() })).status).toBe(403);
      const t2 = await csrfToken(staff);
      expect((await staff.post("/api/shop/override").set("x-csrf-token", t2).send({ mode: "open" })).status).toBe(403);
      const t3 = await csrfToken(staff);
      expect((await staff.delete("/api/shop/override").set("x-csrf-token", t3)).status).toBe(403);
      const t4 = await csrfToken(staff);
      expect((await staff.post("/api/tables").set("x-csrf-token", t4).send({ name: "X", capacity: 2 })).status).toBe(403);
      const t5 = await csrfToken(staff);
      expect((await staff.patch("/api/tables/x").set("x-csrf-token", t5).send({ capacity: 2 })).status).toBe(403);
      expect((await staff.get("/api/tables")).status).toBe(403);
      expect((await staff.get("/api/audit/shop")).status).toBe(403);
    }
  });

  it("audit บันทึกทุกการเปลี่ยน schedule/override/table โดยไม่มี secret", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    await owner.put("/api/shop/schedule").set("x-csrf-token", token).send({ shopName: "ร้านป้าอ้อ (ทดสอบ)", schedule: fullWeek() });
    token = await csrfToken(owner);
    await owner.post("/api/shop/override").set("x-csrf-token", token).send({ mode: "closed", reason: "ทดสอบ" });
    token = await csrfToken(owner);
    await owner.delete("/api/shop/override").set("x-csrf-token", token);
    token = await csrfToken(owner);
    const c = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: "A1", capacity: 4 });
    token = await csrfToken(owner);
    await owner.patch(`/api/tables/${c.body.table.id}`).set("x-csrf-token", token).send({ capacity: 6 });

    const audit = await owner.get("/api/audit/shop");
    expect(audit.status).toBe(200);
    const actions = (audit.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["shop_schedule_updated", "shop_name_updated", "shop_override_set", "shop_override_cleared", "shop_table_created", "shop_table_updated"]) {
      expect(actions).toContain(a);
    }
    const raw = JSON.stringify(audit.body);
    expect(raw).not.toContain("OwnerPass123");
    expect(raw).not.toContain("passwordHash");
  });

  it("โต๊ะ: validate/unique/enable-disable, ไม่มี delete, ไม่มี occupied boolean หลอก", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    async function postTable(body: Record<string, unknown>): Promise<{ status: number; body: { table?: { id: string } } }> {
      const t = await csrfToken(owner);
      const r = await owner.post("/api/tables").set("x-csrf-token", t).send(body);
      return { status: r.status, body: r.body as { table?: { id: string } } };
    }
    expect((await postTable({ name: "", capacity: 4 })).status).toBe(400);
    expect((await postTable({ name: "A1", capacity: 0 })).status).toBe(400);
    expect((await postTable({ name: "A1", capacity: 51 })).status).toBe(400);
    expect((await postTable({ name: "A1", capacity: 2.5 })).status).toBe(400);

    const created = await postTable({ name: "A1", capacity: 4 });
    expect(created.status).toBe(201);
    expect((await postTable({ name: "A1", capacity: 2 })).status).toBe(409);
    expect((await postTable({ name: "  A1  ", capacity: 2 })).status).toBe(409); // trim แล้วซ้ำ
    const created2 = await postTable({ name: "B2", capacity: 2 });
    expect(created2.status).toBe(201);

    // rename ซ้ำ → 409
    const t = await csrfToken(owner);
    expect((await owner.patch(`/api/tables/${created2.body.table!.id}`).set("x-csrf-token", t).send({ name: "A1" })).status).toBe(409);
    // capacity ผิด → 400
    const t2 = await csrfToken(owner);
    expect((await owner.patch(`/api/tables/${created2.body.table!.id}`).set("x-csrf-token", t2).send({ capacity: 0 })).status).toBe(400);
    // patch ว่าง → 400
    const t3 = await csrfToken(owner);
    expect((await owner.patch(`/api/tables/${created2.body.table!.id}`).set("x-csrf-token", t3).send({})).status).toBe(400);

    // โต๊ะไม่มี occupied boolean หลอก
    const list = await owner.get("/api/tables");
    expect(list.status).toBe(200);
    for (const tb of list.body.tables as Record<string, unknown>[]) {
      expect(tb).not.toHaveProperty("occupied");
      expect(tb).not.toHaveProperty("isOccupied");
    }

    // งดใช้งาน A1 → public free ลด
    const t4 = await csrfToken(owner);
    await owner.patch(`/api/tables/${created.body.table!.id}`).set("x-csrf-token", t4).send({ isEnabled: false });
    const status = await request(app).get("/api/shop/status");
    expect(status.body.tables).toEqual({ enabled: 1, free: 1, occupied: 0 });

    // ไม่มี delete endpoint
    const t5 = await csrfToken(owner);
    expect((await owner.delete(`/api/tables/${created.body.table!.id}`).set("x-csrf-token", t5)).status).toBe(404);
  });

  it("snapshot สอดคล้องกับ occupancy provider (free = enabled - occupied)", async () => {
    const withOcc = createApp({
      store,
      loginRateMax: 1000,
      now: () => new Date(now),
      occupancy: () => ({ occupiedTables: 2, customerCount: 7 }),
    });
    const owner = await loginAs("owner", "OwnerPass123");
    const t = await csrfToken(owner);
    await owner.post("/api/tables").set("x-csrf-token", t).send({ name: "A1", capacity: 4 });
    const t2 = await csrfToken(owner);
    await owner.post("/api/tables").set("x-csrf-token", t2).send({ name: "A2", capacity: 4 });
    const t3 = await csrfToken(owner);
    await owner.post("/api/tables").set("x-csrf-token", t3).send({ name: "A3", capacity: 4 });
    const res = await request(withOcc).get("/api/shop/status");
    expect(res.body.tables).toEqual({ enabled: 3, free: 1, occupied: 2 });
    expect(res.body.customerCount).toBe(7);
    void withOcc;
  });

  it("serviceWindow ชี้ overnight ของเมื่อวานตอน 01:00 และหายไปที่ขอบปิด", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await managerWithCsrf(owner);
    const days = fullWeek("09:00", "17:00");
    days["5"] = { closed: false, intervals: [{ open: "18:00", close: "02:00" }] };
    days["6"] = { closed: true, intervals: [] };
    expect((await owner.put("/api/shop/schedule").set("x-csrf-token", token).send({ schedule: days })).status).toBe(200);

    now = new Date("2026-09-04T18:00:00.000Z"); // เสาร์ 01:00 BKK
    const spill = await request(app).get("/api/shop/status");
    expect(spill.body.isOpen).toBe(true);
    expect(spill.body.serviceWindow).toEqual({ sourceWeekday: "5", open: "18:00", close: "02:00", overnight: true });
    // today ยังแสดงตารางของวันนี้ (ปิดทั้งวัน) — รอบที่เปิดอยู่มาจากเมื่อวาน
    expect(spill.body.today).toMatchObject({ weekday: 6, closed: true });

    now = new Date("2026-09-04T19:00:00.000Z"); // เสาร์ 02:00 ตรง = ปิดแล้ว
    const boundary = await request(app).get("/api/shop/status");
    expect(boundary.body.isOpen).toBe(false);
    expect(boundary.body.serviceWindow).toBeNull();
  });

  it("timezone-less ถูกปฏิเสธ 400 พร้อมข้อความไทย, Z/+07:00 รับและ canonicalize เป็น UTC", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    async function postOverride(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
      const t = await csrfToken(owner);
      const r = await owner.post("/api/shop/override").set("x-csrf-token", t).send(body);
      return { status: r.status, body: r.body as Record<string, unknown> };
    }

    // ไม่มี timezone ทั้ง expiresAt และ expectedReopenAt → 400 ข้อความไทย
    const noTz1 = await postOverride({ mode: "closed", reason: "x", expiresAt: "2026-09-12T18:30" });
    expect(noTz1.status).toBe(400);
    expect(String(noTz1.body["error"])).toMatch(/timezone/);
    const noTz2 = await postOverride({ mode: "closed", reason: "x", expectedReopenAt: "2026-09-12T18:30" });
    expect(noTz2.status).toBe(400);
    expect(String(noTz2.body["error"])).toMatch(/timezone/);
    // offset รูปแบบผิด → 400
    const badOff = await postOverride({ mode: "closed", reason: "x", expiresAt: "2026-09-12T18:30:00+99:99" });
    expect(badOff.status).toBe(400);

    // Z รับตามเดิม (future เทียบ clock ที่ฉีด) และเก็บ canonical
    const zOk = await postOverride({
      mode: "closed",
      reason: "z-test",
      expectedReopenAt: "2026-09-12T11:30:00.000Z",
      expiresAt: "2026-09-12T12:00:00.000Z",
    });
    expect(zOk.status).toBe(201);
    const cfg1 = await owner.get("/api/shop/schedule");
    expect((cfg1.body.override as { expiresAt: string }).expiresAt).toBe("2026-09-12T12:00:00.000Z");

    // +07:00 exact: 2026-09-12T18:30:00+07:00 => 2026-09-12T11:30:00.000Z
    const offOk = await postOverride({
      mode: "closed",
      reason: "off-test",
      expiresAt: "2026-09-12T18:30:00+07:00",
    });
    expect(offOk.status).toBe(201);
    const cfg2 = await owner.get("/api/shop/schedule");
    expect((cfg2.body.override as { expiresAt: string }).expiresAt).toBe("2026-09-12T11:30:00.000Z");
    const status = await request(app).get("/api/shop/status");
    expect(status.body.isTemporary).toBe(true);

    // future-expiry validation ยังทำงานกับค่ามี timezone (อดีตแบบ Z → 400)
    const past = await postOverride({ mode: "closed", reason: "x", expiresAt: "2026-09-01T00:00:00.000Z" });
    expect(past.status).toBe(400);
  });

  it("audit ล้มเหลว → mutation ผ่าน HTTP ตอบ 500 และไม่เหลือ partial state/audit", async () => {
    const faultyStore = createMemoryStore({ failAudit: (input) => input.action.startsWith("shop_") });
    await faultyStore.createUser({
      username: "owner",
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    const faultyApp = createApp({ store: faultyStore, loginRateMax: 1000, now: () => new Date(now) });
    const agent = request.agent(faultyApp);
    const loginToken = (await agent.get("/api/auth/csrf")).body.csrfToken as string;
    const login = await agent.post("/api/auth/login").set("x-csrf-token", loginToken).send({
      username: "owner",
      password: "OwnerPass123",
    });
    expect(login.status).toBe(200);

    async function authed(method: "put" | "post" | "patch", path: string, body: Record<string, unknown>): Promise<number> {
      const t = (await agent.get("/api/auth/csrf")).body.csrfToken as string;
      const r = method === "put" ? agent.put(path) : method === "post" ? agent.post(path) : agent.patch(path);
      return (await r.set("x-csrf-token", t).send(body)).status;
    }

    // ทุก mutation ร้าน/โต๊ะต้องพังแบบ 500 (audit เขียนไม่ได้) ไม่ใช่ 2xx
    expect(await authed("put", "/api/shop/schedule", { shopName: "ร้านใหม่", schedule: fullWeek() })).toBe(500);
    expect(await authed("post", "/api/shop/override", { mode: "closed", reason: "x" })).toBe(500);
    expect(await authed("post", "/api/tables", { name: "A1", capacity: 4 })).toBe(500);

    // ไม่มี partial state: ชื่อ/ตาราง/override/โต๊ะคงเดิม และไม่มี audit shop_* เลย
    const status = await request(faultyApp).get("/api/shop/status");
    expect(status.body.shopName).toBe("ร้านป้าอ้ออาหารตามสั่ง");
    expect(status.body.tables).toEqual({ enabled: 0, free: 0, occupied: 0 });
    expect(status.body.isTemporary).toBe(false);
    const audit = await agent.get("/api/audit/shop");
    expect(audit.body.items).toHaveLength(0);
  });
});
