import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MyOrdersPage from "../src/pages/customer/MyOrders";

const memberOrder = {
  id: "o1",
  orderNumber: "ORD-20260914-AB12",
  customerId: "c1",
  guestName: null,
  guestPhone: null,
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
      note: "ไม่ใส่ผัก",
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

describe("หน้าคำสั่งซื้อของฉัน (Ticket 05)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดคำสั่งซื้อ…")).toBeInTheDocument();
  });

  it("สมาชิกเห็นเฉพาะคำสั่งซื้อของตนเองพร้อมรายการย่อย", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/session"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/orders/mine")) return { ok: true, json: async () => ({ orders: [memberOrder] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ORD-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByText(/ข้าวผัดป้าอ้อ/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใส่ผัก/)).toBeInTheDocument();
    expect(screen.getByText("รอชำระเงิน")).toBeInTheDocument();
  });

  it("ช่องค้นหา Guest อยู่บนสุด และกรองคำสั่งซื้อตามวันที่สั่ง (เวลาไทย)", async () => {
    const user = userEvent.setup();
    const older = { ...memberOrder, id: "o2", orderNumber: "ORD-20260913-ZZ99", createdAt: "2026-09-13T03:00:00.000Z" };
    // 2026-09-14T20:00Z = 15 ก.ย. 03:00 เวลาไทย — ต้องนับเป็นวันที่ 15 ไม่ใช่ 14
    const lateNight = { ...memberOrder, id: "o3", orderNumber: "ORD-20260915-LN01", createdAt: "2026-09-14T20:00:00.000Z" };
    stubFetch((url) => {
      if (url.includes("/api/customers/me")) return { ok: true, json: async () => ({ customer: { id: "c1", name: "สมชาย" } }) };
      if (url.includes("/api/orders/mine")) return { ok: true, json: async () => ({ orders: [memberOrder, older, lateNight] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    await screen.findByText(/พบ 3 คำสั่งซื้อ/);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/Guest/);

    fireEvent.change(screen.getByLabelText("กรองตามวันที่สั่ง"), { target: { value: "2026-09-15" } });
    expect(screen.getByText("พบ 1 จาก 3 คำสั่งซื้อในวันที่เลือก")).toBeInTheDocument();
    expect(screen.getByText(/ORD-20260915-LN01/)).toBeInTheDocument();
    expect(screen.queryByText(/ORD-20260913-ZZ99/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ดูทุกวัน" }));
    expect(screen.getByText("พบ 3 คำสั่งซื้อ")).toBeInTheDocument();
  });

  it("empty state เมื่อสมาชิกยังไม่มีคำสั่งซื้อ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/session"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/orders/mine")) return { ok: true, json: async () => ({ orders: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีคำสั่งซื้อ")).toBeInTheDocument();
  });

  it("Guest ค้นหาด้วยเลข + เบอร์สำเร็จ และเบอร์ผิดแสดง error", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/customers/session")) return { ok: true, json: async () => ({ customer: null }) };
      if (url.includes("/api/orders/lookup")) {
        if (url.includes("phone=0899999999"))
          return { ok: false, status: 404, json: async () => ({ error: "ไม่พบคำสั่งซื้อ" }) };
        return { ok: true, json: async () => ({ order: { ...memberOrder, customerId: null, guestName: "มินตรา", guestPhone: "0812345678" } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ค้นหาด้วยเลขคำสั่งซื้อ (Guest)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("เลขคำสั่งซื้อ"), "ORD-20260914-AB12");
    await user.type(screen.getByLabelText("เบอร์โทรที่ใช้สั่ง"), "0899999999");
    await user.click(screen.getByRole("button", { name: "ค้นหาคำสั่งซื้อ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่พบคำสั่งซื้อ");

    await user.clear(screen.getByLabelText("เบอร์โทรที่ใช้สั่ง"));
    await user.type(screen.getByLabelText("เบอร์โทรที่ใช้สั่ง"), "0812345678");
    await user.click(screen.getByRole("button", { name: "ค้นหาคำสั่งซื้อ" }));
    expect(await screen.findByText("ORD-20260914-AB12")).toBeInTheDocument();
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let mineCalls = 0;
    stubFetch((url) => {
      if (url.includes("/api/customers/session"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/orders/mine")) {
        mineCalls += 1;
        if (mineCalls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return { ok: true, json: async () => ({ orders: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MyOrdersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีคำสั่งซื้อ")).toBeInTheDocument();
  });
});
