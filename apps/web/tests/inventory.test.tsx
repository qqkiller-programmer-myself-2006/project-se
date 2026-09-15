import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InventoryPage from "../src/pages/admin/Inventory";

const items = [
  {
    id: "g1",
    name: "ข้าวสาร",
    unit: "กรัม",
    onHand: 500,
    reserved: 100,
    available: 400,
    reorderThreshold: 100,
    latestCost: 0.05,
    isEnabled: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "g2",
    name: "นมสด",
    unit: "มิลลิลิตร",
    onHand: 50,
    reserved: 0,
    available: 50,
    reorderThreshold: 100,
    latestCost: 0.02,
    isEnabled: true,
    createdAt: "",
    updatedAt: "",
  },
];

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

function baseStub(url: string) {
  if (url.includes("/api/inventory/ingredients")) return { ok: true, json: async () => ({ items }) };
  if (url.includes("/api/inventory/ledger")) return { ok: true, json: async () => ({ entries: [] }) };
  if (url.includes("/api/inventory/recipes")) return { ok: true, json: async () => ({ recipes: [] }) };
  if (url.includes("/api/menu/") && url.includes("option-groups"))
    return { ok: true, json: async () => ({ groups: [] }) };
  if (url.includes("/api/menu")) return { ok: true, json: async () => ({ items: [] }) };
  return { ok: true, json: async () => ({}) };
}

describe("หน้าจัดการวัตถุดิบและสต๊อก (Owner/Admin, Ticket 07)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงรายการพร้อมยอดพร้อมขายและป้ายต่ำกว่าระดับเตือน", async () => {
    stubFetch((url) => baseStub(url));
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวสาร")).toBeInTheDocument();
    expect(screen.getByText(/พร้อมขาย 400 กรัม/)).toBeInTheDocument();
    // นมสดพร้อมขาย 50 < ระดับเตือน 100 → ป้ายเตือน
    expect(screen.getByText(/ต่ำกว่าระดับเตือน/)).toBeInTheDocument();
  });

  it("empty state เมื่อยังไม่มีวัตถุดิบ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/inventory/ingredients")) return { ok: true, json: async () => ({ items: [] }) };
      return baseStub(url);
    });
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีวัตถุดิบ")).toBeInTheDocument();
  });

  it("error state เมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/inventory/ingredients"))
        return { ok: false, status: 500, json: async () => ({ error: "โหลดวัตถุดิบไม่สำเร็จ" }) };
      return baseStub(url);
    });
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดวัตถุดิบไม่สำเร็จ");
  });

  it("เพิ่มวัตถุดิบสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (String(url).endsWith("/api/inventory/ingredients") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => ({ item: items[0] }) };
      return baseStub(url);
    });
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวสาร")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/ชื่อวัตถุดิบ/), "ข้าวสาร");
    await user.type(screen.getByLabelText("หน่วย (กำหนดครั้งเดียว เปลี่ยนภายหลังไม่ได้)"), "กรัม");
    await user.click(screen.getByRole("button", { name: "เพิ่มวัตถุดิบ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("เพิ่มวัตถุดิบ ข้าวสาร แล้ว");
  });

  it("เลือกวัตถุดิบแล้วบันทึกสต๊อกสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (String(url).includes("/ingredients/g1/stock") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ingredient: { ...items[0], onHand: 600, available: 500 },
            entry: {
              id: "e1",
              ingredientId: "g1",
              op: "receive",
              deltaOnHand: 100,
              deltaReserved: 0,
              beforeOnHand: 500,
              afterOnHand: 600,
              beforeReserved: 100,
              afterReserved: 100,
              reason: "ซื้อจากตลาดเช้า",
              actorId: "u1",
              actorUsername: "owner",
              orderId: null,
              reference: null,
              createdAt: "2026-09-14T10:00:00.000Z",
            },
          }),
        };
      return baseStub(url);
    });
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวสาร")).toBeInTheDocument();
    const stockButtons = screen.getAllByRole("button", { name: "จัดการสต๊อก" });
    await user.click(stockButtons[0]!);
    await user.type(screen.getByLabelText("ปริมาณ (กรัม มากกว่า 0)"), "100");
    await user.type(screen.getByLabelText(/เหตุผล/), "ซื้อจากตลาดเช้า");
    await user.click(screen.getByRole("button", { name: "บันทึกสต๊อก" }));
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึก");
  });
});
