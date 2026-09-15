import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import MenuPublicPage from "../src/pages/customer/MenuPublic";
import RewardsPage from "../src/pages/customer/Rewards";
import MyNotificationsPage from "../src/pages/customer/MyNotifications";
import { PUBLIC_NAV } from "../src/components/shell";
import { DEMO_MODE_LABEL, isOfflineError } from "../src/lib/demo";

const DEMO_LABEL = DEMO_MODE_LABEL;

/** Simulate total network outage: every fetch rejects like a browser offline. */
function stubOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

function renderWithRouter(ui: React.ReactElement, initialEntries = ["/"]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

describe("โหมดสาธิตเมื่อ API ใช้ไม่ได้ (Ticket 15)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("isOfflineError แยก network ล้มเหลวออกจาก HTTP error", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Error("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Error("เซิร์ฟเวอร์ขัดข้อง"))).toBe(false);
    expect(isOfflineError(new Error("เกิดข้อผิดพลาด (500)"))).toBe(false);
  });

  it("หน้าเมนูออฟไลน์แสดงข้อมูลตัวอย่างพร้อมป้ายโหมดสาธิต", async () => {
    stubOffline();
    renderWithRouter(<MenuPublicPage />, ["/menu"]);
    const labels = await screen.findAllByText(DEMO_LABEL);
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("ข้าวผัดป้าอ้อ (ตัวอย่าง)")).toBeInTheDocument();
    // แบนเนอร์เชื่อมต่อเป็น non-blocking: เนื้อหายังอยู่ + มีปุ่มลองใหม่ที่มีชื่อเข้าถึงได้
    expect(screen.getByRole("button", { name: "ลองเชื่อมต่อเซิร์ฟเวอร์อีกครั้ง" })).toBeInTheDocument();
  });

  it("หน้าสะสมแต้มออฟไลน์แสดงยอด/รางวัลตัวอย่างพร้อมป้ายโหมดสาธิต", async () => {
    stubOffline();
    renderWithRouter(<RewardsPage />, ["/rewards"]);
    const labels = await screen.findAllByText(DEMO_LABEL);
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText("ชาเย็นฟรี 1 แก้ว (ตัวอย่าง)")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "โหลดข้อมูลสะสมแต้มใหม่" })).toBeInTheDocument();
  });

  it("หน้าแจ้งเตือนออฟไลน์แสดงข้อความตัวอย่างพร้อมป้ายโหมดสาธิต", async () => {
    stubOffline();
    renderWithRouter(<MyNotificationsPage />, ["/notifications"]);
    const labels = await screen.findAllByText(DEMO_LABEL);
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/RSV-DEMO01/)).toBeInTheDocument();
  });

  it("shell สาธารณะมี nav ครบทุกเส้นทางพร้อมไอคอน และปุ่มไอคอนล้วนมีชื่อเข้าถึงได้", async () => {
    stubOffline();
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <App />
      </MemoryRouter>,
    );
    const nav = await screen.findByRole("navigation", { name: "เมนูลูกค้า" });
    // ครบทุกรายการตาม PUBLIC_NAV (ผูกกับ shell จริง ไม่ hardcode ป้ายชื่อ)
    expect(PUBLIC_NAV.length).toBeGreaterThanOrEqual(7);
    for (const item of PUBLIC_NAV) {
      const link = within(nav).getByRole("link", { name: item.label });
      expect(link).toHaveAttribute("href", item.to);
    }
    // ไอคอนตกแต่งต้องซ่อนจาก accessibility tree (ไม่มีรูปที่ไม่มีชื่อ)
    const imgs = screen.queryAllByRole("img");
    for (const img of imgs) {
      expect(img).toHaveAttribute("aria-label");
    }
    // ข้ามไปยังเนื้อหาหลัก + landmark หลัก (หน้าร้านมี main ของเชลล์ + main ของเนื้อหา)
    expect(screen.getByText("ข้ามไปยังเนื้อหาหลัก")).toBeInTheDocument();
    const mains = await screen.findAllByRole("main");
    expect(mains.length).toBeGreaterThanOrEqual(1);
  });
});
