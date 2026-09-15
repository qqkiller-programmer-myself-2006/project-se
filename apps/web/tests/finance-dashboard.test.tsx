import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import FinanceDashboardPage from "../src/pages/FinanceDashboard";
import FinanceEntriesPage from "../src/pages/FinanceEntries";

const dashboard = {
  date: "2026-09-15",
  netSales: 100,
  grossRevenue: 100,
  refunds: 0,
  paidOrders: 2,
  averageTicket: 50,
  manualIncome: 500,
  actualExpense: 200,
  grossProfit: 400,
  estimatedCost: 5,
  topMenus: [
    { menuId: "m1", menuName: "ข้าวผัด", quantity: 2, revenue: 100 },
    { menuId: "m2", menuName: "ชาเย็น", quantity: 1, revenue: 30 },
  ],
  peakHours: [{ hour: 12, paidOrders: 2, revenue: 130 }],
  occupancy: { enabledTables: 3, freeTables: 2, occupiedTables: 1, customerCount: 4 },
  lowStockCount: 1,
};

const report = {
  granularity: "day",
  from: "2026-09-15",
  to: "2026-09-15",
  buckets: [
    {
      bucket: "2026-09-15",
      grossRevenue: 100,
      refunds: 0,
      netRevenue: 100,
      manualIncome: 500,
      actualExpense: 200,
      grossProfit: 400,
      paidOrders: 2,
      estimatedCost: 5,
    },
  ],
  total: {
    bucket: "2026-09-15..2026-09-15",
    grossRevenue: 100,
    refunds: 0,
    netRevenue: 100,
    manualIncome: 500,
    actualExpense: 200,
    grossProfit: 400,
    paidOrders: 2,
    estimatedCost: 5,
  },
};

const entryItem = {
  id: "fe1",
  kind: "expense",
  category: "ingredients",
  amount: 1500,
  occurredAt: "2026-09-15T01:00:00.000Z",
  note: "บิลตลาดเช้า",
  reason: "ซื้อหมูประจำสัปดาห์",
  actorId: "u1",
  actorUsername: "owner",
  createdAt: "2026-09-15T02:00:00.000Z",
  updatedAt: "2026-09-15T02:00:00.000Z",
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  // คืน handler output ตรง ๆ (รูป { ok, status, json } เหมือน admin-rewards.test.tsx)
  // ห้ามห่อ json() ซ้ำ — ไม่เช่นนั้น res.json() จะคืนฟังก์ชันแทน payload
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
  );
}

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });

describe("Dashboard การเงิน (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading แล้วแสดง KPI เมนูขายดี ชั่วโมงหนาแน่น occupancy และลิงก์ CSV", async () => {
    stubFetch((u) => {
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/finance/dashboard")) return ok({ dashboard });
      if (u.includes("/api/finance/reports")) return ok({ report });
      return err(404, "ไม่พบ");
    });
    render(
      <MemoryRouter>
        <FinanceDashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("กำลังโหลด Dashboard การเงิน…")).toBeInTheDocument();
    await screen.findByText("Dashboard การเงิน");
    // KPI (ยอดขายสุทธิ 100 บาท ซ้ำกับเมนูขายดี — ใช้ getAllByText)
    expect(screen.getAllByText("100 บาท").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("400 บาท")).toBeInTheDocument();
    // เมนูขายดี + ชั่วโมงหนาแน่น + occupancy
    expect(screen.getByText("ข้าวผัด")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("4 คน")).toBeInTheDocument();
    // รายงาน + CSV links (5 kinds)
    expect(screen.getByText("2026-09-15")).toBeInTheDocument();
    for (const label of ["ยอดขาย", "คำสั่งซื้อ", "รายรับ/รายจ่ายมือ", "สต๊อก", "เวลาคิว"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("โหลดไม่สำเร็จแสดง error และโหลดใหม่ได้", async () => {
    const user = userEvent.setup();
    let first = true;
    stubFetch((u) => {
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/finance/dashboard")) {
        if (first) {
          first = false;
          return err(500, "ระบบขัดข้อง");
        }
        return ok({ dashboard });
      }
      if (u.includes("/api/finance/reports")) return ok({ report });
      return err(404, "ไม่พบ");
    });
    render(
      <MemoryRouter>
        <FinanceDashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("ระบบขัดข้อง");
    await user.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    await waitFor(() => expect(screen.getByText("400 บาท")).toBeInTheDocument());
  });
});

describe("บันทึกรายรับมือ/รายจ่ายจริง (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงรายการ ปุ่มแก้ไข/ลบ และบันทึกใหม่สำเร็จ", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    stubFetch((u, init) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/finance/entries") && method === "GET" && !u.includes("/api/finance/entries/")) {
        return ok({ entries: [entryItem] });
      }
      if (u.endsWith("/api/finance/entries") && method === "POST") return ok({ entry: { ...entryItem, id: "fe2" } });
      if (u.includes("/api/audit/finance")) return ok({ items: [] });
      return err(404, "ไม่พบ");
    });
    render(
      <MemoryRouter>
        <FinanceEntriesPage />
      </MemoryRouter>,
    );
    await screen.findByText("วัตถุดิบ");
    expect(screen.getByText("1,500 บาท")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แก้ไข" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบ" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("เช่น 1500"), "200");
    await user.click(screen.getByLabelText("วันเกิดรายการ (กรุงเทพฯ)"));
    await user.type(screen.getByLabelText("วันเกิดรายการ (กรุงเทพฯ)"), "2026-09-15T08:00");
    await user.type(screen.getByPlaceholderText("เช่น ซื้อหมู/ไก่ประจำสัปดาห์"), "ค่าแรงล้างจาน");
    await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
    await screen.findByText("บันทึกรายการเงินแล้ว");
    expect(calls.some((c) => c.startsWith("POST /api/finance/entries"))).toBe(true);
  });

  it("บันทึกไม่สำเร็จแสดงข้อความ error จาก server", async () => {
    const user = userEvent.setup();
    stubFetch((u, init) => {
      const method = init?.method ?? "GET";
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/finance/entries") && method === "GET") return ok({ entries: [] });
      if (u.endsWith("/api/finance/entries") && method === "POST") return err(400, "จำนวนเงินต้องมากกว่า 0");
      if (u.includes("/api/audit/finance")) return ok({ items: [] });
      return err(404, "ไม่พบ");
    });
    render(
      <MemoryRouter>
        <FinanceEntriesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/ยังไม่มีรายการเงิน/);
    await user.type(screen.getByPlaceholderText("เช่น 1500"), "0");
    await user.type(screen.getByLabelText("วันเกิดรายการ (กรุงเทพฯ)"), "2026-09-15T08:00");
    await user.type(screen.getByPlaceholderText("เช่น ซื้อหมู/ไก่ประจำสัปดาห์"), "ทดสอบ");
    await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
    await screen.findByText("จำนวนเงินต้องมากกว่า 0");
  });
});
