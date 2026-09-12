import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, type Store } from "../src/store.js";
import { defaultWeeklySchedule } from "../src/shop/schedule.js";

const ACTOR = { actorId: "owner-id", actorUsername: "owner", ip: "127.0.0.1" };

describe("shop store atomicity (Ticket 02 review P1)", () => {
  let store: Store;

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("saveShopConfig เขียนชื่อ+ตาราง+audit พร้อมกัน และรู้ว่าเปลี่ยนชื่อหรือไม่", async () => {
    const schedule = defaultWeeklySchedule();
    schedule["0"] = { closed: true, intervals: [] };
    const res = await store.saveShopConfig({ shopName: "ร้านใหม่", schedule }, ACTOR);
    expect(res.shopName).toBe("ร้านใหม่");
    expect(res.nameChanged).toBe(true);
    expect(res.schedule["0"]).toEqual({ closed: true, intervals: [] });
    const audits = await store.listAudit("shop_", 10);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("shop_name_updated");
    expect(actions).toContain("shop_schedule_updated");

    // ชื่อเดิม → มีแค่ audit ตาราง
    const res2 = await store.saveShopConfig({ shopName: "ร้านใหม่", schedule }, ACTOR);
    expect(res2.nameChanged).toBe(false);
    const audits2 = await store.listAudit("shop_", 10);
    expect(audits2.filter((a) => a.action === "shop_name_updated")).toHaveLength(1);
  });

  it("audit ล้มเหลว → ไม่เหลือ state/audit บางส่วน และลำดับ audit ไม่แหว่ง", async () => {
    let fail = true;
    const faulty = createMemoryStore({ failAudit: () => fail });
    const schedule = defaultWeeklySchedule();
    schedule["1"] = { closed: true, intervals: [] };

    await expect(faulty.saveShopConfig({ shopName: "ร้านใหม่", schedule }, ACTOR)).rejects.toThrow();
    expect(await faulty.getShopName()).not.toBe("ร้านใหม่");
    expect((await faulty.getSchedule())["1"]!.closed).toBe(false);
    expect(await faulty.listAudit("shop_", 10)).toHaveLength(0);

    await expect(
      faulty.setShopOverride({ mode: "closed", reason: "x", createdBy: "owner" }, ACTOR),
    ).rejects.toThrow();
    expect(await faulty.getOverride()).toBeNull();

    await expect(faulty.createShopTable({ name: "A1", capacity: 4 }, ACTOR)).rejects.toThrow();
    expect(await faulty.listTables()).toHaveLength(0);

    // ปิด fault แล้วทำสำเร็จ — audit ตัวแรกต้องได้ id 1 (sequence ถูก rollback)
    fail = false;
    await faulty.saveShopConfig({ shopName: "ร้านใหม่", schedule }, ACTOR);
    const audits = await faulty.listAudit("shop_", 10);
    expect(Math.min(...audits.map((a) => a.id))).toBe(1);
    expect(await faulty.getShopName()).toBe("ร้านใหม่");
  });

  it("clearShopOverride คืน false และไม่เขียน audit เมื่อไม่มี override", async () => {
    expect(await store.clearShopOverride(ACTOR)).toBe(false);
    expect(await store.listAudit("shop_", 10)).toHaveLength(0);
    await store.setShopOverride({ mode: "open", createdBy: "owner" }, ACTOR);
    expect(await store.clearShopOverride(ACTOR)).toBe(true);
    expect((await store.listAudit("shop_", 10)).map((a) => a.action)).toContain("shop_override_cleared");
  });

  it("getShopSnapshot คืนข้อมูลชุดเดียวและเป็นสำเนา (แก้ผลลัพธ์ไม่กระทบ store)", async () => {
    await store.createShopTable({ name: "A1", capacity: 4 }, ACTOR);
    const snap = await store.getShopSnapshot();
    expect(snap.shopName).toBe("ร้านป้าอ้ออาหารตามสั่ง");
    expect(snap.tables).toHaveLength(1);
    expect(Object.keys(snap.schedule)).toHaveLength(7);
    snap.tables.pop();
    snap.shopName = "แก้เล่น";
    expect((await store.listTables())).toHaveLength(1);
    expect(await store.getShopName()).toBe("ร้านป้าอ้ออาหารตามสั่ง");
  });
});
