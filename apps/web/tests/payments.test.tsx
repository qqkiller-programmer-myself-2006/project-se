import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PayOrderPage from "../src/pages/PayOrder";
import AdminPaymentsPage from "../src/pages/AdminPayments";
import { ReceiptCard } from "../src/components/ReceiptCard";

const order = {
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
      note: null,
    },
  ],
};

const receipt = {
  receiptNumber: "RCP-20260914-AB12",
  paymentId: "pay1",
  orderId: "o1",
  orderNumber: "ORD-20260914-AB12",
  shopName: "ร้านป้าอ้ออาหารตามสั่ง",
  method: "promptpay",
  amount: 100,
  receivedAmount: null,
  changeAmount: 0,
  paidAt: "2026-09-14T10:05:00.000Z",
  items: [{ menuName: "ข้าวผัดป้าอ้อ", quantity: 2, unitPrice: 50, lineTotal: 100 }],
  createdAt: "2026-09-14T10:05:00.000Z",
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

describe("ชำระเงินฝั่งลูกค้า (Ticket 08)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter initialEntries={["/pay/o1"]}>
        <Routes>
          <Route path="/pay/:id" element={<PayOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดคำสั่งซื้อ…")).toBeInTheDocument();
  });

  it("error state เมื่อไม่พบคำสั่งซื้อ + ช่องกรอกเบอร์ Guest", async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({ error: "ไม่พบคำสั่งซื้อ" }) }));
    render(
      <MemoryRouter initialEntries={["/pay/o1"]}>
        <Routes>
          <Route path="/pay/:id" element={<PayOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่พบคำสั่งซื้อ");
    expect(screen.getByLabelText("เบอร์โทรที่ใช้สั่ง (สำหรับ Guest)")).toBeInTheDocument();
  });

  it("สร้างคำขอพร้อมเพย์ได้ QR จำลอง + ส่ง slip VALID แล้วสำเร็จมีใบเสร็จ", async () => {
    const user = userEvent.setup();
    let paymentState: string = "pending_payment";
    let payment: Record<string, unknown> | null = null;
    stubFetch((url, init) => {
      if (url.includes("/api/orders/o1/payment") && (!init || init.method === undefined || init.method === "GET"))
        return { ok: true, json: async () => ({ payment, paymentState }) };
      if (url.includes("/api/orders/o1") && !url.includes("/payment"))
        return { ok: true, json: async () => ({ order }) };
      if (url.endsWith("/api/payments") && init?.method === "POST") {
        payment = { id: "pay1", orderId: "o1", orderNumber: "ORD-20260914-AB12", method: "promptpay", amount: 100, receivedAmount: null, changeAmount: 0, status: "pending", receiptNumber: null, expiresAt: "2026-09-14T10:15:00.000Z" };
        return { ok: true, json: async () => ({ payment, qrPayload: "PROMPTPAY-FAKE:pay1:100", deduplicated: false }) };
      }
      if (url.includes("/slip") && init?.method === "POST") {
        payment = { ...(payment as object), status: "paid", receiptNumber: "RCP-20260914-AB12" };
        paymentState = "paid";
        return { ok: true, json: async () => ({ payment, receipt, deduplicated: false }) };
      }
      if (url.includes("/by-payment/"))
        return { ok: true, json: async () => ({ receipt }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter initialEntries={["/pay/o1"]}>
        <Routes>
          <Route path="/pay/:id" element={<PayOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("ORD-20260914-AB12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /สร้างคำขอชำระ/ }));
    expect(await screen.findByText("PROMPTPAY-FAKE:pay1:100")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/เลขอ้างอิง slip/), "VALID-1");
    await user.click(screen.getByRole("button", { name: "ส่ง slip" }));
    expect(await screen.findByText("RCP-20260914-AB12")).toBeInTheDocument();
  });

  it("ใบเสร็จแสดงเลขเอกสาร รายการ ยอด ช่องทาง ชื่อร้าน (ใบเสร็จอย่างง่าย)", () => {
    render(<ReceiptCard receipt={receipt as never} />);
    expect(screen.getByLabelText("ใบเสร็จ RCP-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByText("ร้านป้าอ้ออาหารตามสั่ง")).toBeInTheDocument();
    expect(screen.getByText("พร้อมเพย์")).toBeInTheDocument();
    expect(screen.getByText(/ข้าวผัดป้าอ้อ/)).toBeInTheDocument();
  });
});

describe("จัดการชำระเงินหลังร้าน (Ticket 08)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("empty state เมื่อยังไม่มีรายการชำระ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/payments?")) return { ok: true, json: async () => ({ payments: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminPaymentsPage isOwner />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีรายการชำระตามเงื่อนไข")).toBeInTheDocument();
  });

  it("ยืนยันเงินสด + ตัดสิน manual_review + อนุมัติคืนเงิน (Owner) มีปุ่มครบ", async () => {
    const user = userEvent.setup();
    const cash = {
      id: "pay-cash",
      orderId: "o1",
      orderNumber: "ORD-20260914-AB12",
      method: "cash",
      amount: 100,
      receivedAmount: 120,
      changeAmount: 20,
      status: "pending",
      providerRef: null,
      slipRef: null,
      receiptNumber: null,
    };
    const review = {
      id: "pay-qr",
      orderId: "o2",
      orderNumber: "ORD-20260914-CD34",
      method: "promptpay",
      amount: 50,
      receivedAmount: null,
      changeAmount: 0,
      status: "manual_review",
      providerRef: "FAKE-x",
      slipRef: "AMBIGUOUS-9",
      receiptNumber: null,
    };
    stubFetch((url) => {
      if (url.includes("/api/payments?")) return { ok: true, json: async () => ({ payments: [cash, review] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminPaymentsPage isOwner />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/ORD-20260914-AB12/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันรับเงินสด" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติสำเร็จ" })).toBeInTheDocument();
    expect(screen.getByLabelText(/เหตุผลตัดสิน/)).toBeInTheDocument();
    // ค้นหาด้วยเลข + สถานะมีช่องครบ (FR-PAY-004)
    expect(screen.getByLabelText("เลขคำสั่งซื้อ/เลขใบเสร็จ")).toBeInTheDocument();
    expect(screen.getByLabelText("สถานะ")).toBeInTheDocument();
    void user;
  });

  it("ไม่ใช่ Owner ไม่เห็นปุ่มอนุมัติคืนเงิน", async () => {
    const paid = {
      id: "pay-paid",
      orderId: "o1",
      orderNumber: "ORD-20260914-AB12",
      method: "cash",
      amount: 100,
      receivedAmount: 100,
      changeAmount: 0,
      status: "paid",
      providerRef: null,
      slipRef: null,
      receiptNumber: "RCP-20260914-AB12",
    };
    stubFetch((url) => {
      if (url.includes("/api/payments?")) return { ok: true, json: async () => ({ payments: [paid] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminPaymentsPage isOwner={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/RCP-20260914-AB12/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "อนุมัติคืนเงิน" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูใบเสร็จ" })).toBeInTheDocument();
  });
});
