import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MenuAdminPage from "../src/pages/MenuAdmin";

const items = [
  {
    id: "1",
    category: "อาหารจานเดียว",
    name: "ข้าวผัดป้าอ้อ",
    description: "ข้าวผัดหอม ๆ",
    imageUrl: null,
    price: 50,
    kind: "food",
    status: "available",
    isArchived: false,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "2",
    category: "เครื่องดื่ม",
    name: "ชาเย็น",
    description: null,
    imageUrl: null,
    price: 25,
    kind: "drink",
    status: "unavailable",
    isArchived: false,
    sortOrder: 0,
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

describe("หน้าจัดการเมนู (Owner/Admin, Ticket 04)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงรายการพร้อม badge ประเภท/สถานะภาษาไทย", async () => {
    stubFetch((url) => {
      if (url.includes("/api/menu")) return { ok: true, json: async () => ({ items }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    // ชื่อเมนูปรากฏทั้งในรายการและในตัวเลือกเมนูของส่วนจัดการตัวเลือก (Ticket 07) — ขอแค่อย่างน้อยหนึ่งจุด
    expect((await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("อาหาร").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("เครื่องดื่ม").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("เปิดขาย").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ปิดขาย").length).toBeGreaterThanOrEqual(1);
  });

  it("empty state เมื่อยังไม่มีเมนู", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ items: [] }) }));
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีเมนู")).toBeInTheDocument();
  });

  it("error state เมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "โหลดรายการเมนูไม่สำเร็จ" }) }));
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการเมนูไม่สำเร็จ");
  });

  it("เพิ่มเมนูสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (String(url).endsWith("/api/menu") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => ({ item: items[0] }) };
      return { ok: true, json: async () => ({ items }) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    // ชื่อเมนูปรากฏทั้งในรายการและในตัวเลือกเมนูของส่วนจัดการตัวเลือก (Ticket 07) — ขอแค่อย่างน้อยหนึ่งจุด
    expect((await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).length).toBeGreaterThanOrEqual(1);
    await user.type(screen.getByLabelText(/หมวดหมู่/), "อาหารจานเดียว");
    await user.type(screen.getByLabelText(/ชื่อเมนู/), "ข้าวผัดป้าอ้อ");
    await user.type(screen.getByLabelText(/ราคา/), "50");
    await user.click(screen.getByRole("button", { name: "เพิ่มเมนู" }));
    expect(await screen.findByRole("status")).toHaveTextContent("เพิ่มเมนู ข้าวผัดป้าอ้อ แล้ว");
  });

  it("ปิดขาย/เปิดขายสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (String(url).includes("/api/menu/1") && init?.method === "PATCH")
        return { ok: true, json: async () => ({ item: { ...items[0], status: "unavailable" } }) };
      return { ok: true, json: async () => ({ items }) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    // ชื่อเมนูปรากฏทั้งในรายการและในตัวเลือกเมนูของส่วนจัดการตัวเลือก (Ticket 07) — ขอแค่อย่างน้อยหนึ่งจุด
    expect((await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).length).toBeGreaterThanOrEqual(1);
    const group = screen.getByRole("group", { name: "จัดการเมนู ข้าวผัดป้าอ้อ" });
    await user.click(within(group).getByRole("button", { name: "ปิดขาย" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ปิดขายเมนู ข้าวผัดป้าอ้อ แล้ว");
  });

  it("archive ต้องยืนยันก่อน และสำเร็จแสดงข้อความ", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetch((url, init) => {
      if (String(url).includes("/api/menu/1/archive") && init?.method === "POST")
        return { ok: true, json: async () => ({ item: { ...items[0], isArchived: true } }) };
      return { ok: true, json: async () => ({ items }) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    // ชื่อเมนูปรากฏทั้งในรายการและในตัวเลือกเมนูของส่วนจัดการตัวเลือก (Ticket 07) — ขอแค่อย่างน้อยหนึ่งจุด
    expect((await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).length).toBeGreaterThanOrEqual(1);
    const group = screen.getByRole("group", { name: "จัดการเมนู ข้าวผัดป้าอ้อ" });
    await user.click(within(group).getByRole("button", { name: "archive" }));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("archive เมนู ข้าวผัดป้าอ้อ แล้ว");
    confirm.mockRestore();
  });
});
