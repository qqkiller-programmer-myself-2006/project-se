import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CartPage from "../src/pages/Cart";

const groups = [
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

describe("หน้าตะกร้าและยืนยันคำสั่งซื้อ (Ticket 05)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("เพิ่มเมนูลงตะกร้า เห็นยอดรวม แล้ว Guest ยืนยันสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups }) };
      if (url.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({ error: "x" }) };
      if (url.includes("/api/orders") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { guestName: string; items: unknown[] };
        if (!body.guestName)
          return { ok: false, status: 400, json: async () => ({ error: "กรุณาระบุชื่อผู้สั่ง" }) };
        return {
          ok: true,
          json: async () => ({
            order: {
              id: "o1",
              orderNumber: "ORD-20260914-AB12",
              customerId: null,
              guestName: body.guestName,
              guestPhone: "0812345678",
              channel: "web",
              serviceType: "takeaway",
              status: "pending_payment",
              subtotal: 50,
              total: 50,
              scheduledAt: null,
              createdAt: "2026-09-14T10:00:00.000Z",
              updatedAt: "2026-09-14T10:00:00.000Z",
              items: [],
            },
            deduplicated: false,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    expect(screen.getByText("ตะกร้ายังว่างอยู่")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เพิ่มข้าวผัดป้าอ้อลงตะกร้า" }));
    expect(await screen.findByText("ในตะกร้า 1")).toBeInTheDocument();
    expect(screen.getByText(/ยอดรวมโดยประมาณ 50 บาท/)).toBeInTheDocument();

    // ยังไม่กรอกชื่อ Guest → server ปฏิเสธ
    await user.click(screen.getByRole("button", { name: /ยืนยันคำสั่งซื้อ/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาระบุชื่อผู้สั่ง");

    await user.type(screen.getByLabelText("ชื่อผู้สั่ง (Guest)"), "มินตรา");
    await user.type(screen.getByLabelText("เบอร์โทร (Guest)"), "0812345678");
    await user.click(screen.getByRole("button", { name: /ยืนยันคำสั่งซื้อ/ }));
    expect(await screen.findByText(/รับคำสั่งซื้อแล้ว เลขคำสั่งซื้อ ORD-20260914-AB12/)).toBeInTheDocument();
  });

  it("empty menu + error พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubFetch((url) => {
      if (url.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({}) };
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
      return { ok: true, json: async () => ({ groups: [] }) };
    });
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีเมนูพร้อมขาย")).toBeInTheDocument();
  });
});
