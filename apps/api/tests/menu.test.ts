import { beforeEach, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createMemoryStore, type Store } from "../src/store.js";

function validMenu(over: Record<string, unknown> = {}) {
  return {
    category: "อาหารจานเดียว",
    name: "ข้าวผัดป้าอ้อ",
    description: "ข้าวผัดหอม ๆ",
    imageUrl: "https://example.com/khao-phad.jpg",
    price: 50,
    kind: "food",
    status: "available",
    sortOrder: 1,
    ...over,
  };
}

describe("Ticket 04 menu catalog (public HTTP seam)", () => {
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
    await store.createUser({ username: "kitchen1", passwordHash: await bcrypt.hash("Kitchen123", 10), roles: ["kitchen"] });
    await store.createUser({ username: "drink1", passwordHash: await bcrypt.hash("DrinkPass1", 10), roles: ["drink"] });
    app = createApp({ store, loginRateMax: 1000 });
  });

  it("public ว่างเปล่าได้โดยไม่ต้อง login (empty state)", async () => {
    const res = await request(app).get("/api/menu/public");
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });



  it("สร้างเมนูแล้ว public เห็นแบบจัดกลุ่ม พร้อมชื่อ/รายละเอียด/รูป/ราคา/ประเภท", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const c1 = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu());
    expect(c1.status).toBe(201);
    expect(c1.body.item.id).toBeTruthy();
    token = await csrfToken(owner);
    const c2 = await owner
      .post("/api/menu")
      .set("x-csrf-token", token)
      .send(validMenu({ category: "เครื่องดื่ม", name: "ชาเย็น", price: 25, kind: "drink", imageUrl: null, description: null }));
    expect(c2.status).toBe(201);

    const pub = await request(app).get("/api/menu/public");
    expect(pub.status).toBe(200);
    expect(pub.body.groups).toHaveLength(2);
    // เรียงหมวดภาษาไทย: เครื่องดื่ม มาก่อน อาหารจานเดียว (ก < อ)? ตรวจแค่ว่ามีครบทั้งสองหมวด
    const cats = pub.body.groups.map((g: { category: string }) => g.category).sort();
    expect(cats).toEqual(["อาหารจานเดียว", "เครื่องดื่ม"].sort());
    const food = pub.body.groups.find((g: { category: string }) => g.category === "อาหารจานเดียว");
    expect(food.items[0]).toMatchObject({
      name: "ข้าวผัดป้าอ้อ",
      description: "ข้าวผัดหอม ๆ",
      imageUrl: "https://example.com/khao-phad.jpg",
      price: 50,
      kind: "food",
    });
    const raw = JSON.stringify(pub.body);
    for (const secret of ["passwordHash", "password_hash", "roles", "audit", "actor", "session", "cost"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("ปิดขายหรือ archive แล้ว public ไม่เห็น (พร้อมขายเท่านั้น)", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const c = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu());
    expect(c.status).toBe(201);
    const id = c.body.item.id as string;

    token = await csrfToken(owner);
    const off = await owner.patch(`/api/menu/${id}`).set("x-csrf-token", token).send({ status: "unavailable" });
    expect(off.status).toBe(200);
    expect((await request(app).get("/api/menu/public")).body.groups).toEqual([]);

    token = await csrfToken(owner);
    const on = await owner.patch(`/api/menu/${id}`).set("x-csrf-token", token).send({ status: "available" });
    expect(on.status).toBe(200);
    expect((await request(app).get("/api/menu/public")).body.groups).toHaveLength(1);

    token = await csrfToken(owner);
    const arch = await owner.post(`/api/menu/${id}/archive`).set("x-csrf-token", token).send({});
    expect(arch.status).toBe(200);
    expect(arch.body.item.isArchived).toBe(true);
    expect((await request(app).get("/api/menu/public")).body.groups).toEqual([]);

    // เมนู archive แก้ไขไม่ได้จนกว่าจะ restore
    token = await csrfToken(owner);
    const blocked = await owner.patch(`/api/menu/${id}`).set("x-csrf-token", token).send({ price: 60 });
    expect(blocked.status).toBe(409);

    token = await csrfToken(owner);
    const rest = await owner.post(`/api/menu/${id}/restore`).set("x-csrf-token", token).send({});
    expect(rest.status).toBe(200);
    expect((await request(app).get("/api/menu/public")).body.groups).toHaveLength(1);
  });

  it("Admin จัดการได้ แต่ kitchen/drink/guest ถูกปฏิเสธฝั่ง server", async () => {
    const admin = await loginAs("admin1", "AdminPass123");
    let token = await csrfToken(admin);
    const c = await admin.post("/api/menu").set("x-csrf-token", token).send(validMenu());
    expect(c.status).toBe(201);

    for (const [u, p] of [["kitchen1", "Kitchen123"], ["drink1", "DrinkPass1"]] as const) {
      const staff = await loginAs(u, p);
      const t = await csrfToken(staff);
      expect((await staff.post("/api/menu").set("x-csrf-token", t).send(validMenu({ name: "เมนูครัว" }))).status).toBe(403);
      expect((await staff.get("/api/menu")).status).toBe(403);
      expect((await staff.patch(`/api/menu/${c.body.item.id}`).set("x-csrf-token", t).send({ price: 99 }))).not.toBeNull();
      expect((await staff.patch(`/api/menu/${c.body.item.id}`).set("x-csrf-token", t).send({ price: 99 })).status).toBe(403);
      expect((await staff.post(`/api/menu/${c.body.item.id}/archive`).set("x-csrf-token", t).send({})).status).toBe(403);
      expect((await staff.get("/api/audit/menu")).status).toBe(403);
    }
    // guest ไม่ login → 401 (หลังร้าน) แต่ดู public ได้
    expect((await request(app).get("/api/menu")).status).toBe(401);
    expect((await request(app).get("/api/menu/public")).status).toBe(200);
  });

  it("validation: ชื่อ/ราคาติดลบ/หมวด/ประเภท/URL รูป", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const cases: { over: Record<string, unknown>; msg: RegExp }[] = [
      { over: { name: "   " }, msg: /ชื่อเมนู/ },
      { over: { price: -5 }, msg: /ไม่ติดลบ/ },
      { over: { price: 10.123 }, msg: /ทศนิยม/ },
      { over: { category: "" }, msg: /หมวดหมู่/ },
      { over: { kind: "snack" }, msg: /ประเภทเมนู/ },
      { over: { status: "soldout" }, msg: /สถานะเมนู/ },
      { over: { imageUrl: "not-a-url" }, msg: /URL รูปภาพ/ },
      { over: { imageUrl: "ftp://example.com/x.jpg" }, msg: /URL รูปภาพ/ },
      { over: { imageUrl: "//evil.example/x.jpg" }, msg: /URL รูปภาพ/ },
      { over: { imageUrl: "/\\evil.example/x.jpg" }, msg: /URL รูปภาพ/ },
      { over: { sortOrder: -1 }, msg: /ลำดับ/ },
    ];
    for (const { over, msg } of cases) {
      const token = await csrfToken(owner);
      const res = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu(over));
      expect(res.status).toBe(400);
      expect(String(res.body.error)).toMatch(msg);
    }
    // imageUrl ว่าง/ไม่ส่ง = ผ่าน (null)
    const token = await csrfToken(owner);
    const ok = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu({ name: "เมนูไร้รูป", imageUrl: "" }));
    expect(ok.status).toBe(201);
    expect(ok.body.item.imageUrl).toBeNull();
    // path ภายในเว็บ (แบบที่ migration 016 seed เมนูเครื่องดื่มไว้) ต้องบันทึก/แก้ไขต่อได้
    const localToken = await csrfToken(owner);
    const local = await owner
      .post("/api/menu")
      .set("x-csrf-token", localToken)
      .send(validMenu({ name: "ชาใต้ทดสอบ", imageUrl: "/menu/items/cha-tai.png" }));
    expect(local.status).toBe(201);
    expect(local.body.item.imageUrl).toBe("/menu/items/cha-tai.png");
  });

  it("ชื่อซ้ำในหมวดเดียวกันถูกปฏิเสธ (409) แต่ซ้ำข้ามหมวดได้", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    expect((await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu())).status).toBe(201);
    token = await csrfToken(owner);
    const dup = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu({ price: 60 }));
    expect(dup.status).toBe(409);
    expect(String(dup.body.error)).toMatch(/หมวดหมู่นี้แล้ว/);
    token = await csrfToken(owner);
    const cross = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu({ category: "เครื่องดื่ม" }));
    expect(cross.status).toBe(201);

    // แก้ให้ชนชื่อในหมวดเดียวกัน → 409
    token = await csrfToken(owner);
    const clash = await owner
      .patch(`/api/menu/${cross.body.item.id}`)
      .set("x-csrf-token", token)
      .send({ category: "อาหารจานเดียว" });
    expect(clash.status).toBe(409);
  });

  it("audit ครบทุกรูปแบบ มีก่อน/หลัง และไม่มีข้อมูลลับ", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    let token = await csrfToken(owner);
    const c = await owner.post("/api/menu").set("x-csrf-token", token).send(validMenu());
    const id = c.body.item.id as string;
    token = await csrfToken(owner);
    await owner.patch(`/api/menu/${id}`).set("x-csrf-token", token).send({ price: 55 });
    token = await csrfToken(owner);
    await owner.patch(`/api/menu/${id}`).set("x-csrf-token", token).send({ status: "unavailable" });
    token = await csrfToken(owner);
    await owner.post(`/api/menu/${id}/archive`).set("x-csrf-token", token).send({});
    token = await csrfToken(owner);
    await owner.post(`/api/menu/${id}/restore`).set("x-csrf-token", token).send({});

    token = await csrfToken(owner);
    const audit = await owner.get("/api/audit/menu");
    expect(audit.status).toBe(200);
    const actions = (audit.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["menu_created", "menu_updated", "menu_status_changed", "menu_archived", "menu_restored"]) {
      expect(actions).toContain(a);
    }
    const updated = (audit.body.items as { action: string; detail: string }[]).find((i) => i.action === "menu_updated");
    expect(updated?.detail).toMatch(/ก่อน.*หลัง/);
    const raw = JSON.stringify(audit.body);
    for (const secret of ["passwordHash", "password_hash", "token", "secret"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("atomicity: audit เขียนไม่ได้ → state ไม่ค้าง (ไม่มี partial)", async () => {
    const failing = createMemoryStore({ failAudit: () => true });
    await expect(
      failing.createMenuItem(
        { category: "อาหาร", name: "ผัดไทย", price: 45, kind: "food" },
        { actorId: "x", actorUsername: "owner" },
      ),
    ).rejects.toThrow();
    expect(await failing.listPublicMenuItems()).toEqual([]);
    expect(await failing.listMenuItems({ includeArchived: true })).toEqual([]);
  });

  it("เรียงลำดับ: หมวด → sortOrder → ชื่อ และ list หลังร้านมี filter", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    for (const m of [
      validMenu({ name: "ก ข้าว", sortOrder: 2 }),
      validMenu({ name: "ข ข้าว", sortOrder: 1 }),
      validMenu({ category: "เครื่องดื่ม", name: "ชาเย็น", price: 25, kind: "drink" }),
    ]) {
      const token = await csrfToken(owner);
      expect((await owner.post("/api/menu").set("x-csrf-token", token).send(m)).status).toBe(201);
    }
    const token = await csrfToken(owner);
    const list = await owner.get("/api/menu");
    expect(list.status).toBe(200);
    // collation ไทย: "เครื่องดื่ม" (ค) มาก่อน "อาหารจานเดียว" (อ); ในหมวดเดียวกัน sortOrder น้อยขึ้นก่อน
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual(["ชาเย็น", "ข ข้าว", "ก ข้าว"]);

    const drink = await owner.get("/api/menu?kind=drink");
    expect(drink.body.items).toHaveLength(1);
    const search = await owner.get("/api/menu?q=ชาเย็น");
    expect(search.body.items).toHaveLength(1);
    const one = await owner.get(`/api/menu/${list.body.items[0].id}`);
    expect(one.status).toBe(200);
    expect((await owner.get("/api/menu/nonexistent-id")).status).toBe(404);
  });

  it("ไม่มี DELETE ทำลายประวัติ และ id ไม่มีอยู่ตอบ 404", async () => {
    const owner = await loginAs("owner", "OwnerPass123");
    const token = await csrfToken(owner);
    expect((await owner.delete("/api/menu/some-id").set("x-csrf-token", token)).status).toBe(404);
  });
});
