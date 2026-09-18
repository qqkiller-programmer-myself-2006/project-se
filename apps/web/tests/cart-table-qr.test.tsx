import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CartPage from "../src/pages/customer/Cart";
import { CART_STORAGE_KEY } from "../src/lib/cart";
import { TABLE_CONTEXT_STORAGE_KEY } from "../src/lib/tableContext";

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
        inStock: true,
        optionGroups: [],
      },
    ],
  },
];

type OrderBody = { serviceType: string; tableId?: string };

/** stub เมนู + session guest + สถานะโต๊ะ + การยืนยันคำสั่งซื้อ */
function stubApi(tableReady: boolean, sent: OrderBody[], tableStatusFails = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/auth/csrf")) return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
      if (u.includes("/api/menu/public")) return { ok: true, status: 200, json: async () => ({ groups }) };
      if (u.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({ error: "x" }) };
      if (u.includes("/public-status")) {
        if (tableStatusFails) {
          return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            table: { id: "T-A1", name: "A1", zone: "dining" },
            ready: tableReady,
            openedAt: tableReady ? "2026-09-18T03:00:00.000Z" : null,
          }),
        };
      }
      if (u.includes("/api/orders") && init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)) as OrderBody);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            order: {
              id: "o1",
              orderNumber: "ORD-20260918-AB12",
              status: "pending_payment",
              total: 50,
              guestPhone: "0812345678",
              tableId: "T-A1",
              roundId: "r1",
              items: [],
            },
            deduplicated: false,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
    }),
  );
}

/** ตะกร้ามีของอยู่แล้ว 1 รายการ เพื่อให้ส่วนยืนยันคำสั่งซื้อแสดงผล */
function seedCart() {
  localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify([{ menuId: "m1", quantity: 1, note: "", options: [], specialRequest: "" }]),
  );
}

function renderCart() {
  return render(
    <MemoryRouter initialEntries={["/cart"]}>
      <CartPage />
    </MemoryRouter>,
  );
}

describe("ตะกร้ากับโต๊ะที่สแกน QR มา", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    seedCart();
  });

  it("โต๊ะเช็กอินแล้ว: บอกว่าผูกโต๊ะให้ และส่ง tableId ไปกับคำสั่งซื้อ", async () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "T-A1");
    const sent: OrderBody[] = [];
    stubApi(true, sent);
    renderCart();

    expect(await screen.findByText(/กำลังสั่งที่โต๊ะ A1/)).toBeInTheDocument();
    expect(await screen.findByText(/โต๊ะนี้เช็กอินแล้ว/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/ชื่อผู้สั่ง/), "คุณมินตรา");
    await userEvent.type(screen.getByLabelText(/เบอร์โทร/), "0812345678");
    await userEvent.click(screen.getByRole("button", { name: /ยืนยันคำสั่งซื้อ/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ serviceType: "dine_in", tableId: "T-A1" });
    expect(await screen.findByText(/ผูกกับโต๊ะ A1 แล้ว/)).toBeInTheDocument();
  });

  it("โต๊ะยังไม่เช็กอิน: เตือนตั้งแต่ก่อนยืนยัน ไม่ใช่ปล่อยให้รู้ตอนกด", async () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "T-A1");
    stubApi(false, []);
    renderCart();
    expect(await screen.findByText(/ยังไม่ได้เช็กอิน/)).toBeInTheDocument();
  });

  it('กด "ไม่ได้นั่งโต๊ะนี้" แล้วลืมโต๊ะ และไม่ส่ง tableId อีก', async () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "T-A1");
    const sent: OrderBody[] = [];
    stubApi(true, sent);
    renderCart();

    await userEvent.click(await screen.findByRole("button", { name: "ไม่ได้นั่งโต๊ะนี้" }));
    expect(screen.queryByText(/กำลังสั่งที่โต๊ะ/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem(TABLE_CONTEXT_STORAGE_KEY)).toBeNull();

    await userEvent.type(screen.getByLabelText(/ชื่อผู้สั่ง/), "คุณมินตรา");
    await userEvent.type(screen.getByLabelText(/เบอร์โทร/), "0812345678");
    await userEvent.click(screen.getByRole("button", { name: /ยืนยันคำสั่งซื้อ/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.tableId).toBeUndefined();
  });

  it("เปลี่ยนเป็นกลับบ้าน: ไม่ส่งโต๊ะไปด้วย และบอกว่าจะไม่ผูกโต๊ะ", async () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "T-A1");
    const sent: OrderBody[] = [];
    stubApi(true, sent);
    renderCart();

    await screen.findByText(/กำลังสั่งที่โต๊ะ A1/);
    await userEvent.click(screen.getByRole("radio", { name: "กลับบ้าน" }));
    expect(await screen.findByText(/จะไม่ผูกกับโต๊ะ/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/ชื่อผู้สั่ง/), "คุณมินตรา");
    await userEvent.type(screen.getByLabelText(/เบอร์โทร/), "0812345678");
    await userEvent.click(screen.getByRole("button", { name: /ยืนยันคำสั่งซื้อ/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ serviceType: "takeaway" });
    expect(sent[0]!.tableId).toBeUndefined();
  });

  it("ตรวจสถานะโต๊ะไม่ได้: ยังยืนยันได้ แต่บอกตรง ๆ ว่าอาจถูกปฏิเสธ", async () => {
    sessionStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, "T-A1");
    stubApi(true, [], true);
    renderCart();
    expect(await screen.findByText(/ตรวจสถานะโต๊ะไม่ได้/)).toBeInTheDocument();
    // ไม่รู้ชื่อโต๊ะก็ยังบอกรหัสโต๊ะที่สแกนมา
    expect(screen.getByText(/กำลังสั่งที่โต๊ะ T-A1/)).toBeInTheDocument();
  });

  it("ไม่ได้สแกน QR: หน้าตะกร้าเหมือนเดิม ไม่มีเรื่องโต๊ะ", async () => {
    const sent: OrderBody[] = [];
    stubApi(true, sent);
    renderCart();
    await screen.findByRole("button", { name: /ยืนยันคำสั่งซื้อ/ });
    expect(screen.queryByText(/กำลังสั่งที่โต๊ะ/)).not.toBeInTheDocument();
  });
});
