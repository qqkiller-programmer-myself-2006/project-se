import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MenuAdminPage from "../src/pages/MenuAdmin";
import CartPage from "../src/pages/Cart";

const menuItems = [
  {
    id: "m1",
    category: "อาหารจานเดียว",
    name: "ข้าวผัดป้าอ้อ",
    description: null,
    imageUrl: null,
    price: 50,
    kind: "food",
    status: "available",
    isArchived: false,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
];

const optionGroups = [
  {
    id: "g1",
    menuId: "m1",
    name: "ขนาด",
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    options: [
      {
        id: "o1",
        groupId: "g1",
        menuId: "m1",
        name: "พิเศษ",
        priceDelta: 10,
        isEnabled: true,
        sortOrder: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
  },
];

const publicGroups = [
  {
    category: "อาหารจานเดียว",
    items: [
      {
        id: "m1",
        category: "อาหารจานเดียว",
        name: "ข้าวผัดป้าอ้อ",
        description: null,
        imageUrl: null,
        price: 50,
        kind: "food",
        sortOrder: 0,
        optionGroups: [
          { id: "g1", name: "ขนาด", sortOrder: 0, options: [{ id: "o1", name: "พิเศษ", priceDelta: 10, sortOrder: 0 }] },
        ],
        inStock: true,
      },
    ],
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

describe("จัดการตัวเลือกเมนูหลังร้าน (Ticket 07)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("เลือกเมนูแล้วเห็นกลุ่มและตัวเลือก", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/menu/m1/option-groups")) return { ok: true, json: async () => ({ groups: optionGroups }) };
      if (url.includes("/api/menu")) return { ok: true, json: async () => ({ items: menuItems }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).not.toHaveLength(0);
    await user.selectOptions(screen.getByLabelText("เมนูที่จัดการตัวเลือก"), "m1");
    expect(await screen.findByText("ขนาด")).toBeInTheDocument();
    expect(screen.getByText("พิเศษ")).toBeInTheDocument();
  });

  it("เพิ่มกลุ่มตัวเลือกสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/menu/m1/option-groups") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => ({ group: { ...optionGroups[0], options: [] } }) };
      if (url.includes("/api/menu/m1/option-groups")) return { ok: true, json: async () => ({ groups: [] }) };
      if (url.includes("/api/menu")) return { ok: true, json: async () => ({ items: menuItems }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByText(/ข้าวผัดป้าอ้อ/)).not.toHaveLength(0);
    await user.selectOptions(screen.getByLabelText("เมนูที่จัดการตัวเลือก"), "m1");
    expect(await screen.findByText("เมนูนี้ยังไม่มีกลุ่มตัวเลือก")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/ชื่อกลุ่ม/), "ขนาด");
    await user.click(screen.getByRole("button", { name: "เพิ่มกลุ่ม" }));
    expect(await screen.findByRole("status")).toHaveTextContent("เพิ่มกลุ่มตัวเลือก ขนาด แล้ว");
  });
});

describe("ลูกค้าเลือกตัวเลือกในตะกร้า (Ticket 07)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("เห็นตัวเลือก เลือกแล้วราคารวมส่วนต่าง", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups: publicGroups }) };
      if (url.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({ error: "x" }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เพิ่มข้าวผัดป้าอ้อลงตะกร้า" }));
    // เลือกตัวเลือก "พิเศษ +10 บาท" ในตะกร้า
    const checkbox = await screen.findByRole("checkbox", { name: /พิเศษ/ });
    await user.click(checkbox);
    expect(screen.getByText(/ยอดรวมโดยประมาณ 60 บาท/)).toBeInTheDocument();
  });
});
