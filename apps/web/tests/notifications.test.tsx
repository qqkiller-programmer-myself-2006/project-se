import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminNotificationsPage from "../src/pages/admin/AdminNotifications";
import MyNotificationsPage from "../src/pages/customer/MyNotifications";

const item = {
  id: "n1",
  eventKey: "reservation_created:r1",
  kind: "reservation_created",
  customerId: "c1",
  orderId: null,
  reservationId: "r1",
  paymentId: null,
  message: "ร้านป้าอ้อ: รับการจอง RSV-1 แล้ว",
  status: "failed",
  attempts: 2,
  maxAttempts: 5,
  nextRetryAt: "2026-09-15T10:01:00.000Z",
  lastError: "ส่งข้อความไม่สำเร็จ (fake)",
  sentAt: null,
  createdAt: "2026-09-15T09:00:00.000Z",
  updatedAt: "2026-09-15T09:05:00.000Z",
};

function stubAdmin(overrides?: { items?: typeof item[]; failList?: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/notifications/run-outbox") && method === "POST") {
        return ok({ result: { checked: 1, sent: 1, failed: 0, skipped: 0, deadLetter: 0 }, message: "ตรวจ 1 รายการ ส่งแล้ว 1 รายการ" });
      }
      if (u.includes("/api/notifications/run-reminders") && method === "POST") {
        return ok({ result: { checked: 2, queued: 1, deduplicated: 1 }, message: "ตรวจ 2 การจอง เข้าคิวใหม่ 1 รายการ" });
      }
      if (u.includes("/api/notifications/") && u.endsWith("/retry") && method === "POST") {
        return ok({ notification: { ...item, status: "pending", attempts: 0 }, message: "รับคำสั่งส่งซ้ำแล้ว" });
      }
      if (u.includes("/api/notification-consents/") && method === "GET") {
        return ok({ customerId: "c1", enabled: false });
      }
      if (u.includes("/api/notification-consents") && method === "POST") {
        return ok({ customerId: "c1", enabled: true, message: "เปิดรับแจ้งเตือนแล้ว" });
      }
      if (u.includes("/api/notifications?")) {
        if (overrides?.failList) return err(500, "โหลดคิวแจ้งเตือนไม่สำเร็จ");
        return ok({ items: overrides?.items ?? [item], kindLabels: {}, statusLabels: {} });
      }
      return err(404, "ไม่พบ");
    }),
  );
}

function stubMine(overrides?: { items?: typeof item[]; consent?: boolean; linked?: boolean; fail?: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/notifications/mine/consent") && method === "PATCH") {
        const enabled = !(overrides?.consent ?? true);
        return ok({ enabled, message: enabled ? "เปิดรับแจ้งเตือนแล้ว" : "ปิดรับแจ้งเตือนแล้ว" });
      }
      if (u.includes("/api/notifications/mine/list")) {
        if (overrides?.fail) return err(401, "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน");
        return ok({
          items: overrides?.items ?? [item],
          consentEnabled: overrides?.consent ?? true,
          lineLinked: overrides?.linked ?? false,
          kindLabels: {},
          statusLabels: {},
        });
      }
      return err(404, "ไม่พบ");
    }),
  );
}

describe("Ticket 12 notifications web", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("หลังร้านเห็นคิว + สั่งส่งซ้ำ + flush + reminders ได้", async () => {
    stubAdmin();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("ร้านป้าอ้อ: รับการจอง RSV-1 แล้ว")).toBeInTheDocument());
    expect(screen.getAllByText("รอส่งซ้ำ").length).toBeGreaterThanOrEqual(1);
    // สั่งส่งซ้ำรายแถว
    await user.click(screen.getByRole("button", { name: "ส่งซ้ำ" }));
    await waitFor(() => expect(screen.getByText("รับคำสั่งส่งซ้ำแล้ว")).toBeInTheDocument());
    // flush คิวค้าง
    await user.click(screen.getByRole("button", { name: "ส่งคิวค้างตอนนี้" }));
    await waitFor(() => expect(screen.getByText(/ตรวจ 1 รายการ ส่งแล้ว 1 รายการ/)).toBeInTheDocument());
    // กวาดเตือน 30 นาที
    await user.click(screen.getByRole("button", { name: "กวาดเตือน 30 นาที" }));
    await waitFor(() => expect(screen.getByText(/ตรวจ 2 การจอง เข้าคิวใหม่ 1 รายการ/)).toBeInTheDocument());
  });

  it("หลังร้านเห็น empty/error states ถูกต้อง", async () => {
    stubAdmin({ items: [] });
    render(
      <MemoryRouter>
        <AdminNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/ยังไม่มีการแจ้งเตือนตามเงื่อนไขนี้/)).toBeInTheDocument());
  });

  it("หลังร้านโหลดล้มเหลวแสดง error + ลองใหม่ได้", async () => {
    stubAdmin({ failList: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("โหลดคิวแจ้งเตือนไม่สำเร็จ")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it("หลังร้านตรวจ/ตั้ง consent ลูกค้าได้", async () => {
    stubAdmin();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("ร้านป้าอ้อ: รับการจอง RSV-1 แล้ว")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("เช่น c-xxxx"), "c1");
    await user.click(screen.getByRole("button", { name: "ตรวจ" }));
    await waitFor(() => expect(screen.getByText(/ปิดรับแจ้งเตือนอยู่/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "เปิดรับ" }));
    await waitFor(() => expect(screen.getByText("เปิดรับแจ้งเตือนแล้ว")).toBeInTheDocument());
  });

  it("ลูกค้าอ่าน web fallback + เห็นแบนเนอร์ยังไม่เชื่อม LINE + toggle consent ได้", async () => {
    stubMine({ linked: false, consent: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MyNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("ร้านป้าอ้อ: รับการจอง RSV-1 แล้ว")).toBeInTheDocument());
    expect(screen.getByText(/ยังไม่เชื่อม LINE/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ปิดรับแจ้งเตือน LINE" }));
    await waitFor(() => expect(screen.getByText("ปิดรับแจ้งเตือนแล้ว")).toBeInTheDocument());
  });

  it("ลูกค้ายังไม่ login เห็น error + ว่างเปล่าเมื่อไม่มีข้อความ", async () => {
    stubMine({ fail: true });
    render(
      <MemoryRouter>
        <MyNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน")).toBeInTheDocument());

    stubMine({ items: [] });
    render(
      <MemoryRouter>
        <MyNotificationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/ยังไม่มีการแจ้งเตือนสำหรับบัญชีนี้/)).toBeInTheDocument());
  });
});
