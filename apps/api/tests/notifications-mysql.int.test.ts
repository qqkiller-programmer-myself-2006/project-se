import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlStore, type Store } from "../src/store.js";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const hasTestDb = TEST_DATABASE_URL.length > 0;
if (!hasTestDb) {
  console.log(
    "SKIP Ticket12 real-MySQL integration: ไม่ได้ตั้งค่า TEST_DATABASE_URL " +
      "(ตั้งค่า URL ของฐานข้อมูลทดสอบแยก แล้วรันใหม่ ห้ามใช้ DATABASE_URL ของ production)",
  );
}

/**
 * Ticket 12 บน MySQL จริงเท่านั้น — parity ของ outbox seams (queue/dedupe/claim/fail/retry/consent)
 * - ไม่มี TEST_DATABASE_URL → skip ชัดเจน ไม่นับว่าผ่าน
 * - มี URL แล้วแต่เชื่อมต่อ/migrate ไม่ได้ → FAIL
 */
describe.skipIf(!hasTestDb)("ticket12 notifications with real MySQL (TEST_DATABASE_URL)", () => {
  let store: Store;
  const key = `it12-${Date.now().toString(36)}`;

  beforeAll(async () => {
    store = await createMysqlStore(TEST_DATABASE_URL);
    // migration รันซ้ำได้ (รวม 013): สร้าง store ครั้งที่สองต้องไม่พัง
    const again = await createMysqlStore(TEST_DATABASE_URL);
    await again.close?.();
  });

  afterAll(async () => {
    await store.close?.();
  });

  it("queue → dedupe → claim → fail → retry → complete ครบวงจร", async () => {
    const now = new Date();
    const first = await store.queueNotification(
      {
        eventKey: `${key}-ev1`,
        kind: "order_ready",
        customerId: null,
        orderId: "order-it12-1",
        message: "ร้านป้าอ้อ: คำสั่งซื้อ ORD-IT12 พร้อมรับครบแล้ว",
      },
      { actorId: null },
      now,
    );
    expect(first.deduplicated).toBe(false);
    expect(first.notification.status).toBe("pending");
    const dup = await store.queueNotification(
      {
        eventKey: `${key}-ev1`,
        kind: "order_ready",
        customerId: null,
        message: "ต้องไม่ทับ",
      },
      { actorId: null },
      now,
    );
    expect(dup.deduplicated).toBe(true);
    expect(dup.notification.id).toBe(first.notification.id);
    const claimed = await store.claimNotification(first.notification.id, now);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(1);
    // claim ซ้ำขณะ sending → null (กัน flush ซ้อน)
    expect(await store.claimNotification(first.notification.id, now)).toBeNull();
    const backoff = new Date(now.getTime() + 60_000).toISOString();
    const failed = await store.failNotificationSend(
      first.notification.id,
      { error: "fake fail", nextRetryAt: backoff },
      { actorId: null },
      now,
    );
    expect(failed.status).toBe("failed");
    // ยังไม่ถึงเวลา → ไม่ due
    expect(await store.listDueNotifications(now, 50).then((d) => d.map((n) => n.id))).not.toContain(
      first.notification.id,
    );
    // ถึงเวลา → due แล้ว retry ด้วยมือรีเซ็ตเป็น pending
    const retried = await store.retryNotification(
      first.notification.id,
      { reason: "int retry" },
      { actorId: null },
      now,
    );
    expect(retried.status).toBe("pending");
    expect(retried.attempts).toBe(0);
    const claimed2 = await store.claimNotification(first.notification.id, now);
    expect(claimed2!.attempts).toBe(1);
    const sent = await store.completeNotificationSend(first.notification.id, { actorId: null }, now);
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).not.toBeNull();
  });

  it("consent default เปิด; opt-out แล้วอ่านได้ false", async () => {
    const cid = `it12-customer-${Date.now().toString(36)}`;
    expect(await store.isNotificationEnabled(cid)).toBe(true);
    await store.setNotificationConsent(cid, false, { actorId: null });
    expect(await store.isNotificationEnabled(cid)).toBe(false);
    await store.setNotificationConsent(cid, true, { actorId: null });
    expect(await store.isNotificationEnabled(cid)).toBe(true);
  });
});
