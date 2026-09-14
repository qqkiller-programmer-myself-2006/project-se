import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminOrdersPage from "../src/pages/AdminOrders";

const pending = {
  id: "o1",
  orderNumber: "ORD-20260914-AB12",
  customerId: null,
  guestName: "มินตรา",
  guestPhone: "0812345678",
  channel: "web",
  serviceType: "takeaway",
  status: "pending_payment",
  subtotal: 100,
  total: 100,
  scheduledAt: null,
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  items: [
    {
      id: "i1",
      orderId: "o1",
      menuId: "m1",
      menuName: "ข้าวผัดป้าอ้อ",
      unitPrice: 50,
      quantity: 2,
      lineTotal: 100,
      note: null,
    },
  ],
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/csrf"))
        return { ok: true, json: async () => ({ csrfToken: "t" }) };
      return handler(String(url), init);
    }),
  );
}

describe("หน้าจัดการคำสั่งซื้อหลังร้าน (Ticket 05)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดคำสั่งซื้อ…")).toBeInTheDocument();
  });

  it("แสดงรายการพร้อมเจ้าของ + เปลี่ยนสถานะพร้อมเหตุผลสำเร็จ", async () => {
    const user = userEvent.setup();
    const patched: { status?: string; reason?: string } = {};
    stubFetch((url, init) => {
      if (url.includes("/api/orders?") || url.endsWith("/api/orders"))
        return { ok: true, json: async () => ({ orders: [pending] }) };
      if (url.includes("/api/audit/orders")) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes("/api/orders/o1/status") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { status: string; reason: string };
        patched.status = body.status;
        patched.reason = body.reason;
        return { ok: true, json: async () => ({ order: { ...pending, status: body.status } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ORD-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByText(/Guest: มินตรา 0812345678/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ดูและจัดการ ORD-20260914-AB12/ }));
    // เหตุผลว่าง → error ฝั่ง client
    await user.click(screen.getByRole("button", { name: "บันทึกสถานะ" }));
    expect(await screen.findByText("กรุณาระบุเหตุผลในการเปลี่ยนสถานะ")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/เหตุผล/), "ลูกค้าชำระครบแล้ว ปิดงาน");
    await user.click(screen.getByRole("button", { name: "บันทึกสถานะ" }));
    expect(patched).toMatchObject({ status: "completed", reason: "ลูกค้าชำระครบแล้ว ปิดงาน" });
    // ปิดงานแล้ว — ฟอร์มหายไป เหลือข้อความปิดงาน
    expect(await screen.findByText("คำสั่งซื้อนี้ปิดงานแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก")).toBeInTheDocument();
  });

  it("empty state เมื่อไม่มีคำสั่งซื้อตามเงื่อนไข", async () => {
    stubFetch((url) => {
      if (url.includes("/api/orders")) return { ok: true, json: async () => ({ orders: [] }) };
      if (url.includes("/api/audit/orders")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีคำสั่งซื้อตามเงื่อนไข")).toBeInTheDocument();
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
      return { ok: true, json: async () => ({ orders: [], items: [] }) };
    });
    render(
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีคำสั่งซื้อตามเงื่อนไข")).toBeInTheDocument();
  });
});
