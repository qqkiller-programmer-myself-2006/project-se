import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CartPage from "../src/pages/customer/Cart";
import MyOrdersPage from "../src/pages/customer/MyOrders";
import { OrderCard } from "../src/components/OrderCard";
import {
  CART_EDIT_STORAGE_KEY,
  CART_STORAGE_KEY,
  loadCart,
  loadCartEdit,
  orderToCartLines,
  saveCartEdit,
} from "../src/lib/cart";
import type { OrderDetail } from "../src/lib/api";

const groups = [
  {
    category: "อาหารจานเดียว",
    items: [
      { id: "m1", category: "อาหารจานเดียว", name: "ข้าวผัดป้าอ้อ", description: null, imageUrl: null, price: 50, kind: "food", sortOrder: 0, optionGroups: [] },
      { id: "m2", category: "อาหารจานเดียว", name: "ผัดไทย", description: null, imageUrl: null, price: 60, kind: "food", sortOrder: 1, optionGroups: [] },
    ],
  },
];

function makeOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "o1",
    orderNumber: "ORD-20260914-AB12",
    customerId: null,
    guestName: "คุณมินตรา",
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
        note: "ไม่ใส่ผัก",
        selectedOptions: [],
        specialRequest: "เผ็ดน้อย",
        estimatedCost: 0,
      },
    ],
    ...over,
  } as OrderDetail;
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
    return handler(String(url), init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const unauth = { ok: false, status: 401, json: async () => ({ error: "x" }) };

describe("Issue #42 cart edit-session helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("บันทึก/โหลด/ล้าง session แก้ไข และเมินข้อมูลเสีย", () => {
    expect(loadCartEdit()).toBeNull();
    saveCartEdit({ orderId: "o1", orderNumber: "ORD-1", phone: "0812345678" });
    expect(loadCartEdit()).toEqual({ orderId: "o1", orderNumber: "ORD-1", phone: "0812345678" });
    saveCartEdit({ orderId: "o2", orderNumber: "ORD-2", phone: null });
    expect(loadCartEdit()?.phone).toBeNull();
    saveCartEdit(null);
    expect(loadCartEdit()).toBeNull();
    localStorage.setItem(CART_EDIT_STORAGE_KEY, "{not json");
    expect(loadCartEdit()).toBeNull();
    localStorage.setItem(CART_EDIT_STORAGE_KEY, JSON.stringify({ orderNumber: "x" }));
    expect(loadCartEdit()).toBeNull();
  });

  it("orderToCartLines แปลงรายการ (ตัวเลือก/หมายเหตุ/ความต้องการเฉพาะ) และบีบจำนวนให้อยู่ในช่วงตะกร้า", () => {
    const lines = orderToCartLines({
      items: [
        { menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", selectedOptions: [{ optionId: "a" }, { optionId: "a" }], specialRequest: "เผ็ดน้อย" },
        { menuId: "m2", quantity: 99, note: null, selectedOptions: [], specialRequest: null },
      ],
    });
    expect(lines).toEqual([
      { menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", options: ["a"], specialRequest: "เผ็ดน้อย" },
      { menuId: "m2", quantity: 20, note: "", options: [], specialRequest: "" },
    ]);
  });
});

describe("Issue #42 OrderCard ปุ่มแก้ไข", () => {
  it("แสดงเฉพาะออเดอร์รอชำระที่ส่ง onEdit และกดแล้วเรียกกลับ", async () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <OrderCard order={makeOrder()} payTo="/pay/o1" onEdit={onEdit} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /แก้ไขรายการคำสั่งซื้อ ORD-20260914-AB12/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "ชำระเงิน" })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OrderCard order={makeOrder({ status: "completed" })} payTo="/pay/o1" onEdit={onEdit} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /แก้ไขรายการ/ })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OrderCard order={makeOrder()} payTo="/pay/o1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /แก้ไขรายการ/ })).not.toBeInTheDocument();
  });
});

describe("Issue #42 หน้าคำสั่งซื้อของฉัน → ตะกร้าโหมดแก้ไข", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("กด 'แก้ไขรายการ' โหลดรายการเข้าตะกร้า จำออเดอร์ที่แก้ แล้วพาไปหน้าตะกร้า", async () => {
    const member = makeOrder({ customerId: "c1", guestName: null, guestPhone: null });
    stubFetch((url) => {
      if (url.includes("/api/customers/session")) return ok({ customer: { id: "c1", name: "สมชาย" } });
      if (url.includes("/api/orders/mine")) return ok({ orders: [member] });
      if (url.includes("/api/menu/public")) return ok({ groups });
      return ok({});
    });
    render(
      <MemoryRouter initialEntries={["/orders"]}>
        <Routes>
          <Route path="/orders" element={<MyOrdersPage />} />
          <Route path="/cart" element={<div>หน้าตะกร้า</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /แก้ไขรายการคำสั่งซื้อ ORD-20260914-AB12/ }));
    expect(await screen.findByText("หน้าตะกร้า")).toBeInTheDocument();
    expect(loadCart()).toEqual([{ menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", options: [], specialRequest: "เผ็ดน้อย" }]);
    expect(loadCartEdit()).toEqual({ orderId: "o1", orderNumber: "ORD-20260914-AB12", phone: null });
  });
});

describe("Issue #42 หน้าตะกร้าในโหมดแก้ไข", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", options: [], specialRequest: "" }]),
    );
    saveCartEdit({ orderId: "o1", orderNumber: "ORD-20260914-AB12", phone: "0812345678" });
  });

  function renderCart() {
    return render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    );
  }

  it("แสดงแบนเนอร์ซ่อนวิธีรับบริการ/ฟอร์ม Guest และบันทึกด้วย PUT พร้อมเบอร์", async () => {
    const user = userEvent.setup();
    const saved = makeOrder({ total: 160, subtotal: 160 });
    const fetchMock = stubFetch((url, init) => {
      if (url.includes("/api/menu/public")) return ok({ groups });
      if (url.includes("/api/customers/")) return unauth;
      if (url.includes("/api/orders/o1/items") && init?.method === "PUT") return ok({ order: saved, changed: true });
      return ok({});
    });
    renderCart();

    expect(await screen.findByText("กำลังแก้ไขคำสั่งซื้อ ORD-20260914-AB12")).toBeInTheDocument();
    expect(screen.queryByText("วิธีรับบริการ")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ชื่อผู้สั่ง/)).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /บันทึกการแก้ไข · / }));
    expect(await screen.findByText(/บันทึกการแก้ไขแล้ว เลขคำสั่งซื้อ ORD-20260914-AB12 ยอดรวมใหม่/)).toBeInTheDocument();

    const put = fetchMock.mock.calls.find(([u, init]) => String(u).includes("/api/orders/o1/items") && init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(String(put![1]!.body))).toEqual({
      items: [{ menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", options: null, specialRequest: null }],
      phone: "0812345678",
    });
    // ไม่สร้างออเดอร์ใหม่ และล้างตะกร้า/session แก้ไขหลังบันทึก
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith("/api/orders") && init?.method === "POST")).toBe(false);
    expect(loadCartEdit()).toBeNull();
    expect(loadCart()).toEqual([]);
  });

  it("server ปฏิเสธ (มีคำขอชำระแล้ว) → แสดง error คงตะกร้าและ session ไว้", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/menu/public")) return ok({ groups });
      if (url.includes("/api/customers/")) return unauth;
      if (url.includes("/api/orders/o1/items") && init?.method === "PUT")
        return { ok: false, status: 409, json: async () => ({ error: "คำสั่งซื้อนี้มีคำขอชำระเงินแล้ว แก้ไขไม่ได้ กรุณายกเลิกแล้วสั่งใหม่" }) };
      return ok({});
    });
    renderCart();
    await user.click(await screen.findByRole("button", { name: /บันทึกการแก้ไข · / }));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีคำขอชำระเงินแล้ว");
    expect(loadCartEdit()).not.toBeNull();
    expect(loadCart()).toHaveLength(1);
  });

  it("'ยกเลิกการแก้ไข' ล้างตะกร้าและกลับเป็นโหมดสั่งใหม่", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return ok({ groups });
      if (url.includes("/api/customers/")) return unauth;
      return ok({});
    });
    renderCart();
    await user.click(await screen.findByRole("button", { name: /ยกเลิกการแก้ไข/ }));
    expect(screen.queryByText(/กำลังแก้ไขคำสั่งซื้อ/)).not.toBeInTheDocument();
    expect(loadCartEdit()).toBeNull();
    expect(loadCart()).toEqual([]);
  });
});
