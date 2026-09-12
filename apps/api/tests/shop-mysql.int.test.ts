import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import type { Express } from "express";
import mysql from "mysql2/promise";
import { createApp } from "../src/app.js";
import { createMysqlStore, type Store } from "../src/store.js";
import { WEEKDAY_KEYS, type WeeklySchedule, type WeekdayKey } from "../src/shop/schedule.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP Ticket02 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 02 บน MySQL จริงเท่านั้น — ใช้ TEST_DATABASE_URL แยกจาก production เสมอ
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 * - ทำความสะอาดข้อมูลทดสอบทั้งหมดหลังจบ
 */
describe.skipIf(!hasTestDb)("ticket02 shop status and tables with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  let app: Express;
  let admin: mysql.Connection;
  const prefix = `s${Date.now().toString(36)}_`;
  const ownerName = `${prefix}owner`;
  const tableNames = [`${prefix}A1`, `${prefix}B2`];

  async function csrfToken(agent: Agent): Promise<string> {
    const res = await agent.get("/api/auth/csrf");
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  async function loginAgent(username: string, password: string): Promise<Agent> {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", token)
      .send({ username, password });
    expect(res.status).toBe(200);
    return agent;
  }

  function fullWeek(): WeeklySchedule {
    const days = {} as WeeklySchedule;
    for (const key of WEEKDAY_KEYS) days[key] = { closed: false, intervals: [{ open: "09:00", close: "21:00" }] };
    return days;
  }

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    // migration รันซ้ำได้: สร้าง store ครั้งที่สองต้องไม่พัง
    const again = await createMysqlStore(TEST_DATABASE_URL);
    await again.close?.();
    admin = await mysql.createConnection(TEST_DATABASE_URL);
    app = createApp({ store, loginRateMax: 1000 });
    const first = await store.createFirstOwner({
      username: ownerName,
      passwordHash: await bcrypt.hash("OwnerPass123", 10),
      roles: ["owner"],
    });
    expect(first.created).toBe(true);
  }, 60000);

  afterAll(async () => {
    if (!hasTestDb) return;
    await admin.query("DELETE FROM shop_override WHERE id = 1");
    if (tableNames.length > 0) {
      const placeholders = tableNames.map(() => "?").join(",");
      await admin.query(`DELETE FROM shop_tables WHERE name IN (${placeholders})`, tableNames);
    }
    await admin.query(
      "DELETE FROM audit_logs WHERE actor_username = ? OR target_username = ?",
      [ownerName, ownerName],
    );
    await admin.query(
      "DELETE s FROM sessions s JOIN users u ON s.user_id = u.id WHERE u.username = ?",
      [ownerName],
    );
    await admin.query("DELETE FROM users WHERE username = ?", [ownerName]);
    await admin?.end();
    await store?.close?.();
  });

  it("schedule/override/table CRUD บน MySQL จริง + public snapshot สอดคล้อง", async () => {
    const owner = await loginAgent(ownerName, "OwnerPass123");
    let token = await csrfToken(owner);
    const put = await owner.put("/api/shop/schedule").set("x-csrf-token", token).send({ schedule: fullWeek() });
    expect(put.status).toBe(200);
    expect(put.body.schedule["1"].intervals).toEqual([{ open: "09:00", close: "21:00" }]);

    token = await csrfToken(owner);
    const t1 = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: tableNames[0], capacity: 4 });
    expect(t1.status).toBe(201);
    token = await csrfToken(owner);
    const tDup = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: tableNames[0], capacity: 2 });
    expect(tDup.status).toBe(409);
    // ชื่อซ้ำต้องไม่ทิ้ง audit บางส่วน
    const auditsAfterDup = (await owner.get("/api/audit/shop")).body.items as { action: string; detail: string | null }[];
    expect(auditsAfterDup.filter((a) => a.action === "shop_table_created" && a.detail?.includes(tableNames[0]!))).toHaveLength(1);

    token = await csrfToken(owner);
    const t2 = await owner.post("/api/tables").set("x-csrf-token", token).send({ name: tableNames[1], capacity: 2 });
    expect(t2.status).toBe(201);
    token = await csrfToken(owner);
    const dis = await owner.patch(`/api/tables/${t2.body.table.id}`).set("x-csrf-token", token).send({ isEnabled: false });
    expect(dis.status).toBe(200);
    expect(dis.body.table.isEnabled).toBe(false);

    token = await csrfToken(owner);
    const ov = await owner.post("/api/shop/override").set("x-csrf-token", token).send({ mode: "closed", reason: "ทดสอบ MySQL" });
    expect(ov.status).toBe(201);

    const status = await request(app).get("/api/shop/status");
    expect(status.status).toBe(200);
    expect(status.body.isTemporary).toBe(true);
    expect(status.body.reason).toBe("ทดสอบ MySQL");
    expect(status.body.tables.enabled).toBe(1);
    expect(status.body.serviceWindow).toBeDefined();

    token = await csrfToken(owner);
    expect((await owner.delete("/api/shop/override").set("x-csrf-token", token)).status).toBe(200);

    const audit = await owner.get("/api/audit/shop");
    const actions = (audit.body.items as { action: string }[]).map((i) => i.action);
    for (const a of ["shop_schedule_updated", "shop_table_created", "shop_table_updated", "shop_override_set", "shop_override_cleared"]) {
      expect(actions).toContain(a);
    }
  });

  it("transaction rollback: audit เขียนไม่ได้ → ชื่อ+ตารางที่เขียนแล้วถูกย้อนหมด", async () => {
    const before = await store.getShopSnapshot();
    const auditsBefore = await store.listAudit("shop_", 500);
    // actorUsername ยาวเกิน VARCHAR(64) ทำให้ audit INSERT ล้มเหลวกลาง transaction
    // (name/schedule upsert สำเร็จก่อน) — ต้อง rollback ทั้งหมด
    await expect(
      store.saveShopConfig(
        { shopName: `${prefix}ชื่อใหม่`, schedule: fullWeek() },
        { actorId: "x", actorUsername: "u".repeat(100), ip: "127.0.0.1" },
      ),
    ).rejects.toThrow();
    const after = await store.getShopSnapshot();
    expect(after.shopName).toBe(before.shopName);
    expect(after.schedule).toEqual(before.schedule);
    expect(await store.listAudit("shop_", 500)).toHaveLength(auditsBefore.length);
  });

  it("override datetime round-trip ผ่าน MySQL + effective ตรงกับ public", async () => {
    const actor = { actorId: "x", actorUsername: ownerName, ip: "127.0.0.1" };
    const expires = new Date(Date.now() + 3600_000).toISOString();
    const saved = await store.setShopOverride(
      { mode: "closed", reason: "รอบ MySQL", expectedReopenAt: expires, expiresAt: expires, createdBy: ownerName },
      actor,
    );
    expect(saved.reason).toBe("รอบ MySQL");
    expect(new Date(saved.expiresAt!).getTime()).toBe(new Date(expires).getTime());
    const snap = await store.getShopSnapshot();
    expect(snap.override?.reason).toBe("รอบ MySQL");
    expect(await store.clearShopOverride(actor)).toBe(true);
    expect(await store.getOverride()).toBeNull();
  });
});
