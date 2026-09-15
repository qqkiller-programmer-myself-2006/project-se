import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CapacityDashboardPage from "../src/pages/owner/CapacityDashboard";
import QueueTrackPage from "../src/pages/customer/QueueTrack";

const overview = {
  at: "2026-09-15T03:00:00.000Z",
  stations: [
    { station: "kitchen", perSlot: 10, activeJobs: 1, unitsAhead: 2, estimatedWaitMin: 30, rangeMin: 30, rangeMax: 35, source: "baseline" },
    { station: "drink", perSlot: 10, activeJobs: 0, unitsAhead: 0, estimatedWaitMin: 5, rangeMin: 5, rangeMax: 10, source: "baseline" },
  ],
  enabledTables: 3,
  freeTables: 2,
  occupiedTables: 1,
  customerCount: 4,
};

const model = {
  version: "baseline-v1",
  kind: "baseline",
  enabled: true,
  thresholdMinutes: 0,
  timeoutMs: 500,
  samples: 0,
  maeBaseline: null,
  maeModel: null,
  trainedAt: null,
  updatedBy: null,
  updatedAt: "2026-09-15T03:00:00.000Z",
};

const accuracy = {
  samples: 0,
  maeBaseline: null,
  maeModel: null,
  meetsThreshold: false,
  thresholdMinutes: 0,
  gatheringSamples: true,
  fixtures: { name: "accuracy-fixtures-v1", samples: 6, maeBaseline: 5.5, maeModel: 1.5, modelWins: true },
  evaluatedAt: "2026-09-15T03:00:00.000Z",
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
  );
}

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });

function stubDashboard(handler?: (url: string, init?: RequestInit) => unknown) {
  stubFetch((u, init) => {
    if (String(u).endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
    if (u.includes("/api/capacity/overview")) return ok({ overview, sourceLabels: {}, nonGuarantee: "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน" });
    if (u.includes("/api/predictions/model")) return ok({ model, sourceLabels: {} });
    if (u.includes("/api/predictions/accuracy")) return ok({ accuracy, sourceLabels: {} });
    return handler?.(u, init) ?? ok({});
  });
}

describe("Dashboard กำลังผลิตและเวลารอ (Ticket 13, ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <CapacityDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดภาพรวมกำลังผลิต…")).toBeInTheDocument();
  });

  it("success: ภาพรวมรายฝ่าย + โต๊ะ + โมเดล + fixtures + ข้อความไม่รับประกัน", async () => {
    stubDashboard();
    render(
      <MemoryRouter>
        <CapacityDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ฝ่ายครัว")).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายเครื่องดื่ม")).toBeInTheDocument();
    expect(screen.getByText("ประมาณ 30–35 นาที")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("baseline-v1")).toBeInTheDocument();
    expect(screen.getByText("โมเดลดีกว่า")).toBeInTheDocument();
    expect(screen.getAllByText(/ไม่ใช่เวลารับประกัน/).length).toBeGreaterThan(0);
  });

  it("error state เมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch((u) => {
      if (u.includes("/api/capacity/overview")) return err(403, "สิทธิ์ไม่เพียงพอ");
      if (u.includes("/api/predictions/model")) return err(403, "สิทธิ์ไม่เพียงพอ");
      if (u.includes("/api/predictions/accuracy")) return err(403, "สิทธิ์ไม่เพียงพอ");
      return ok({});
    });
    render(
      <MemoryRouter>
        <CapacityDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
  });

  it("ประมาณเวลารอรายฝ่ายแล้วเห็นช่วง + แหล่งที่มา", async () => {
    const user = userEvent.setup();
    stubDashboard((u) => {
      if (u.includes("/api/capacity/wait"))
        return ok({
          estimate: {
            orderId: null,
            station: "drink",
            partySize: 2,
            perStation: [],
            estimatedWaitMin: 7,
            rangeMin: 7,
            rangeMax: 12,
            readyAtSlowest: null,
            source: "baseline",
            modelVersion: "baseline-v1",
            predictedAt: "2026-09-15T03:00:00.000Z",
            timeoutMs: 500,
            nonGuarantee: "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน",
          },
          featureId: "f1",
          sourceLabels: {},
        });
      return ok({});
    });
    render(
      <MemoryRouter>
        <CapacityDashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("ฝ่ายครัว");
    await user.selectOptions(screen.getByLabelText("ฝ่ายงาน (ประมาณเวลา)"), "drink");
    await user.click(screen.getByRole("button", { name: "ประมาณเวลา" }));
    expect(await screen.findByText("ประมาณ 7–12 นาที")).toBeInTheDocument();
  });

  it("สล็อตเต็มแสดงช่วงถัดไปที่ว่าง", async () => {
    const user = userEvent.setup();
    stubDashboard((u) => {
      if (u.includes("/api/capacity/preorder-check"))
        return ok({
          check: {
            station: "kitchen",
            scheduledAt: "2026-09-15T05:00:00.000Z",
            slotStart: "2026-09-15T05:00:00.000Z",
            slotEnd: "2026-09-15T05:15:00.000Z",
            used: 10,
            capacity: 10,
            available: false,
            estimatedWaitMin: 165,
            rangeMin: 165,
            rangeMax: 170,
            suggestedSlot: {
              station: "kitchen",
              slotStart: "2026-09-15T05:15:00.000Z",
              slotEnd: "2026-09-15T05:30:00.000Z",
              used: 0,
              capacity: 10,
              available: 10,
            },
          },
          nonGuarantee: "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน",
        });
      return ok({});
    });
    render(
      <MemoryRouter>
        <CapacityDashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("ฝ่ายครัว");
    const at = screen.getByLabelText("วันเวลานัดรับ");
    fireEvent.change(at, { target: { value: "2026-09-15T12:00" } });
    await user.click(screen.getByRole("button", { name: "ตรวจสล็อต" }));
    expect(await screen.findByText(/สล็อตเต็ม/)).toBeInTheDocument();
    expect(await screen.findByText(/ช่วงถัดไปที่ว่าง/)).toBeInTheDocument();
  });
});

describe("หน้าติดตามคิวแสดงเวลารอ (Ticket 13)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  const kitchenJob = {
    id: "job1",
    orderId: "order1",
    orderNumber: "ORD-20260914-AB12",
    paymentId: "pay1",
    orderItemId: "item1",
    menuId: "menu1",
    menuName: "ข้าวผัดป้าอ้อ",
    station: "kitchen",
    quantity: 2,
    readyQty: 0,
    deliveredQty: 0,
    status: "preparing",
    readyAt: "2026-09-14T03:00:00.000Z",
    tableId: "t1",
    roundId: "r1",
    isRemake: false,
    isPriority: false,
    reason: null,
    claimedBy: null,
    createdAt: "2026-09-14T03:00:00.000Z",
    updatedAt: "2026-09-14T03:00:00.000Z",
    tableName: "A1",
  };

  it("Guest ติดตามแล้วเห็นเวลารอโดยประมาณ + ข้อความไม่รับประกัน", async () => {
    const user = userEvent.setup();
    stubFetch((u) => {
      if (u.includes("/api/orders/lookup"))
        return ok({ order: { id: "order1", orderNumber: "ORD-20260914-AB12", total: 100, items: [] } });
      if (u.includes("/api/queue/order/"))
        return ok({ jobs: [kitchenJob], orderNumber: "ORD-20260914-AB12" });
      if (u.includes("/api/capacity/wait"))
        return ok({
          estimate: {
            orderId: "order1",
            station: null,
            partySize: 2,
            perStation: [],
            estimatedWaitMin: 30,
            rangeMin: 30,
            rangeMax: 35,
            readyAtSlowest: "2026-09-14T03:00:00.000Z",
            source: "baseline",
            modelVersion: "baseline-v1",
            predictedAt: "2026-09-14T03:00:00.000Z",
            timeoutMs: 500,
            nonGuarantee: "เวลารอโดยประมาณ ไม่ใช่เวลารับประกัน",
          },
          featureId: "f1",
          sourceLabels: {},
        });
      if (String(u).endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      return ok({});
    });
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/เลขคำสั่งซื้อ/), "ORD-20260914-AB12");
    await user.type(screen.getByLabelText(/เบอร์โทรที่ใช้สั่งซื้อ/), "0812345678");
    await user.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByText("เวลารอโดยประมาณ 30–35 นาที")).toBeInTheDocument();
    expect(await screen.findByText(/ไม่ใช่เวลารับประกัน/)).toBeInTheDocument();
  });
});
