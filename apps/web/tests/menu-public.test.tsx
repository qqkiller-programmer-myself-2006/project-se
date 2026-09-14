import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MenuPublicPage from "../src/pages/MenuPublic";

const groups = [
  {
    category: "อาหารจานเดียว",
    items: [
      {
        id: "1",
        category: "อาหารจานเดียว",
        name: "ข้าวผัดป้าอ้อ",
        description: "ข้าวผัดหอม ๆ",
        imageUrl: "https://example.com/khao-phad.jpg",
        price: 50,
        kind: "food",
        sortOrder: 0,
      },
    ],
  },
  {
    category: "เครื่องดื่ม",
    items: [
      {
        id: "2",
        category: "เครื่องดื่ม",
        name: "ชาเย็น",
        description: null,
        imageUrl: null,
        price: 25,
        kind: "drink",
        sortOrder: 0,
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

describe("หน้าเมนูสาธารณะ (Ticket 04)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงเมนูแยกหมวด พร้อมชื่อ รายละเอียด รูป ราคา ประเภท", async () => {
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดหอม ๆ")).toBeInTheDocument();
    expect(screen.getByText(/50 บาท/)).toBeInTheDocument();
    expect(screen.getAllByText("อาหาร").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("เครื่องดื่ม").length).toBeGreaterThanOrEqual(1);
    const img = screen.getByAltText("รูปข้าวผัดป้าอ้อ") as HTMLImageElement;
    expect(img.src).toContain("khao-phad.jpg");
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดเมนู…")).toBeInTheDocument();
  });

  it("empty state เมื่อยังไม่มีเมนูพร้อมขาย", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ groups: [] }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีเมนูพร้อมขาย")).toBeInTheDocument();
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
      return { ok: true, json: async () => ({ groups }) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
  });

  it("กรองตามประเภทและคำค้นได้", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: true, json: async () => ({ groups }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("ประเภท"), "drink");
    expect(screen.queryByText("ข้าวผัดป้าอ้อ")).not.toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
    // ค้นหาด้วยคำค้น: กลับเป็นทั้งหมดก่อนแล้วพิมพ์คำค้น
    await user.selectOptions(screen.getByLabelText("ประเภท"), "");
    await user.type(screen.getByLabelText("ค้นหาชื่อหรือรายละเอียด"), "ชาเย็น");
    expect(screen.queryByText("ข้าวผัดป้าอ้อ")).not.toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
  });
});
