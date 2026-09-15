import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import MenuPublicPage from "../src/pages/MenuPublic";
import CartPage from "../src/pages/Cart";
import MyOrdersPage from "../src/pages/MyOrders";
import ReservationsPage from "../src/pages/Reservations";
import RewardsPage from "../src/pages/Rewards";
import MyNotificationsPage from "../src/pages/MyNotifications";
import { DEMO_MODE_LABEL } from "../src/lib/demo";

const DEMO_LABEL = DEMO_MODE_LABEL;

function stubOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/api/auth/csrf"))
        return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
      throw new TypeError("Failed to fetch");
    }),
  );
}

function renderPage(path: string, Page: () => JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>,
  );
}

describe("UI redesign demo mode (Ticket 15)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("เมนูออฟไลน์: แสดงข้อมูลตัวอย่าง + ป้ายโหมดสาธิต + แถบเชื่อมต่อแบบไม่บังเนื้อหา", async () => {
    stubOffline();
    renderPage("/menu", MenuPublicPage);
    expect(await screen.findByText("ข้าวผัดป้าอ้อ (ตัวอย่าง)")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/)).toBeInTheDocument();
    // เนื้อหายังใช้งานได้: ช่องค้นหา + ปุ่มลองเชื่อมต่ออีกครั้งมีชื่อเข้าถึงได้
    expect(screen.getByLabelText("ค้นหาชื่อหรือรายละเอียด")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ลองเชื่อมต่อเซิร์ฟเวอร์อีกครั้ง" }),
    ).toBeInTheDocument();
  });

  it("HTTP 500 ไม่ถือว่าออฟไลน์: แสดง error จริง ไม่แสดงป้ายสาธิต", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith("/api/auth/csrf"))
          return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
        if (u.includes("/api/menu/public"))
          return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    renderPage("/menu", MenuPublicPage);
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    expect(screen.queryByText(DEMO_LABEL)).not.toBeInTheDocument();
  });

  it("ตะกร้าออฟไลน์: เลือกเมนูตัวอย่างได้ ป้ายสาธิตมองเห็น", async () => {
    stubOffline();
    renderPage("/cart", CartPage);
    expect(await screen.findByText("ข้าวผัดป้าอ้อ (ตัวอย่าง)")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("button", { name: "เพิ่มข้าวผัดป้าอ้อ (ตัวอย่าง)ลงตะกร้า" }),
    ).toBeInTheDocument();
  });

  it("คำสั่งซื้อออฟไลน์: แสดงคำสั่งซื้อตัวอย่าง ไม่ใช่หน้าว่าง", async () => {
    stubOffline();
    renderPage("/orders", MyOrdersPage);
    expect(await screen.findByText(/ORD-DEMO-0001/)).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("การจองออฟไลน์: แสดงการจองตัวอย่าง ไม่ใช่หน้าว่าง", async () => {
    stubOffline();
    renderPage("/reservations", ReservationsPage);
    expect(await screen.findByText(/RSV-DEMO01/)).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("สะสมแต้มออฟไลน์: แสดงแต้มและรางวัลตัวอย่าง", async () => {
    stubOffline();
    renderPage("/rewards", RewardsPage);
    expect((await screen.findAllByText("ชาเย็นฟรี 1 แก้ว (ตัวอย่าง)")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("แจ้งเตือนออฟไลน์: แสดงข้อความตัวอย่างในเว็บได้", async () => {
    stubOffline();
    renderPage("/notifications", MyNotificationsPage);
    expect(await screen.findByText(/RSV-DEMO01/)).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("เชลล์สาธารณะ: เนวิเกชันมีป้ายชื่อภาษาไทย + ลิงก์ครบ + skip link", async () => {
    stubOffline();
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <App />
      </MemoryRouter>,
    );
    const nav = await screen.findByRole("navigation", { name: "เมนูลูกค้า" });
    for (const name of ["เมนู", "ตะกร้า", "คำสั่งซื้อ", "จองโต๊ะ", "สะสมแต้ม", "แจ้งเตือน"]) {
      expect(nav).toHaveTextContent(name);
    }
    expect(screen.getByText("ข้ามไปยังเนื้อหาหลัก")).toBeInTheDocument();
    // รอเนื้อหาสาธิตก่อนตรวจปุ่ม (เมนูออฟไลน์มีปุ่ม retry หลังโหลดเสร็จ)
    await screen.findByText("ข้าวผัดป้าอ้อ (ตัวอย่าง)");
    // ทุกปุ่มที่มองเห็นต้องมีชื่อเข้าถึงได้ (ไม่มีปุ่มไอคอนลอยไร้ป้าย)
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      const name = btn.getAttribute("aria-label") ?? btn.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});
