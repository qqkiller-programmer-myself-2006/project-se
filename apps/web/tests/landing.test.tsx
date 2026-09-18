import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LandingPage from "../src/pages/customer/Landing";
import { CART_STORAGE_KEY } from "../src/lib/cart";
import { TABLE_CONTEXT_STORAGE_KEY } from "../src/lib/tableContext";

const MENU = {
  groups: [
    {
      category: "อาหารตามสั่ง",
      items: [
        {
          id: "m1",
          name: "ข้าวผัดหมู",
          description: "ผัดสดทีละจาน",
          price: 45,
          kind: "food",
          imageUrl: "/menu/pad.jpg",
          inStock: true,
          optionGroups: [],
        },
        {
          id: "m2",
          name: "ชาใต้",
          description: null,
          price: 25,
          kind: "drink",
          imageUrl: null,
          inStock: true,
          optionGroups: [],
        },
      ],
    },
  ],
};

const SHOP = {
  shopName: "ร้านป้าอ้ออาหารตามสั่ง",
  isOpen: true,
  isTemporary: false,
  reason: null,
  expectedReopenAt: null,
  today: { date: "2026-09-18", weekday: 5, closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
  serviceWindow: null,
  tables: { enabled: 4, free: 3, occupied: 1 },
  customerCount: 0,
};

function stubApi(menu: unknown = MENU, menuStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      if (u.includes("/api/menu/public")) {
        if (menuStatus !== 200) {
          return { ok: false, status: menuStatus, json: async () => ({ error: `เกิดข้อผิดพลาด (${menuStatus})` }) };
        }
        return ok(menu);
      }
      if (u.includes("/api/shop/status")) return ok(SHOP);
      return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
    }),
  );
}

function renderLanding(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("หน้าแรกของลูกค้า (landing)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("แสดงปกหน้า เวลาเปิด และเมนูที่สั่งได้", async () => {
    stubApi();
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ผัดร้อนทีละกระทะ");
    expect(await screen.findByText("เปิดอยู่ · วันนี้ 09:00–21:00")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "เมนูที่สั่งได้วันนี้" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ดูทั้งหมด 2 เมนู/ })).toHaveAttribute("href", "/menu");
  });

  it("ตู้โชว์บอกบานหน้าเป็นข้อความ และเพิ่มลงตะกร้าได้จริง", async () => {
    stubApi();
    renderLanding();
    // ข้อมูลบานหน้าต้องอ่านได้โดยไม่พึ่ง canvas (canvas เป็นของประดับ)
    expect(await screen.findByText(/บานหน้า: ข้าวผัดหมู/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มลงตะกร้า/ }));
    expect(await screen.findByText("เพิ่ม ข้าวผัดหมู ลงตะกร้าแล้ว")).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]") as { menuId: string; quantity: number }[];
    expect(saved).toEqual([{ menuId: "m1", quantity: 1, note: "", options: [], specialRequest: "" }]);
  });

  it("หมุนด้วยปุ่มถัดไปแล้วบานหน้าเปลี่ยน", async () => {
    stubApi();
    renderLanding();
    await screen.findByText(/บานหน้า: ข้าวผัดหมู/);
    await userEvent.click(screen.getByRole("button", { name: "หมุนไปเมนูถัดไป" }));
    expect(await screen.findByText(/บานหน้า: ชาใต้/)).toBeInTheDocument();
  });

  it("สแกน QR จากโต๊ะแล้วเห็นบริบทโต๊ะและจำไว้ข้ามหน้า", async () => {
    stubApi();
    renderLanding("/?table=S4");
    expect(await screen.findByText(/กำลังสั่งที่โต๊ะ S4/)).toBeInTheDocument();
    expect(sessionStorage.getItem(TABLE_CONTEXT_STORAGE_KEY)).toBe("S4");
  });

  it("ร้านยังไม่เปิดขายเมนูแสดง empty state พร้อมทางไปดูสถานะร้าน", async () => {
    stubApi({ groups: [] });
    renderLanding();
    expect(await screen.findByText("วันนี้ยังไม่เปิดขายเมนู")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ดูสถานะร้าน/ })).toHaveAttribute("href", "/status");
  });

  it("เมนูโหลดไม่ได้แสดง error พร้อมปุ่มลองใหม่ (ไม่ใช่หน้าว่าง)", async () => {
    stubApi(undefined, 503);
    renderLanding();
    expect(await screen.findByRole("alert")).toHaveTextContent("เกิดข้อผิดพลาด (503)");
    // ปกหน้ายังอยู่ — error ของเมนูไม่ควรกินทั้งหน้า
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ผัดร้อนทีละกระทะ");
    await waitFor(() => expect(screen.getByRole("button", { name: /ลองใหม่/ })).toBeEnabled());
  });
});
