import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StatusPage from "../src/pages/Status";

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => handler(String(url))),
  );
}

const openStatus = {
  shopName: "ร้านป้าอ้ออาหารตามสั่ง",
  isOpen: true,
  isTemporary: false,
  reason: null,
  expectedReopenAt: null,
  today: { date: "2026-09-07", weekday: 1, closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
  serviceWindow: { sourceWeekday: "1", open: "09:00", close: "21:00", overnight: false },
  tables: { enabled: 5, free: 5, occupied: 0 },
  customerCount: 0,
};

describe("หน้าสถานะร้านสาธารณะ", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("โหลดสำเร็จแสดงชื่อร้าน สถานะ เวลา โต๊ะ และผู้ใช้บริการ", async () => {
    stubFetch(() => ({ ok: true, json: async () => openStatus }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ร้านป้าอ้ออาหารตามสั่ง")).toBeInTheDocument();
    expect(screen.getByText("เปิดรับบริการ")).toBeInTheDocument();
    expect(screen.getAllByText(/09:00–21:00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/รอบที่เปิดอยู่ขณะนี้/)).toBeInTheDocument();
    expect(screen.getByText(/โต๊ะว่าง 5 \/ พร้อมใช้งาน 5/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้ใช้บริการ 0 คน/)).toBeInTheDocument();
  });

  it("ปิดชั่วคราวแสดงเหตุผลและเวลาเปิดคาดหมาย", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({
        ...openStatus,
        isOpen: false,
        isTemporary: true,
        reason: "ไฟดับชั่วคราว",
        expectedReopenAt: "2026-09-07T06:00:00.000Z",
      }),
    }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ปิดรับบริการ")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/ไฟดับชั่วคราว/);
  });

  it("ปิดทั้งวันแสดงข้อความปิดทั้งวัน", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({
        ...openStatus,
        isOpen: false,
        today: { date: "2026-09-06", weekday: 0, closed: true, intervals: [] },
      }),
    }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ปิดทั้งวัน")).toBeInTheDocument();
  });

  it("โหลดไม่สำเร็จแสดง error และลองใหม่ได้", async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return { ok: true, json: async () => openStatus };
      }),
    );
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ร้านป้าอ้ออาหารตามสั่ง")).toBeInTheDocument();
  });

  it("มี skip link และ landmark หลัก", async () => {
    stubFetch(() => ({ ok: true, json: async () => openStatus }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    await screen.findByText("ร้านป้าอ้ออาหารตามสั่ง");
    expect(screen.getByRole("link", { name: "ข้ามไปยังเนื้อหาหลัก" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "สถานะร้านปัจจุบัน" })).toBeInTheDocument();
  });

  it("เปิดจาก overnight เมื่อวานแสดงรอบที่เปิดอยู่พร้อมวันต้นทาง", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({
        ...openStatus,
        today: { date: "2026-09-05", weekday: 6, closed: true, intervals: [] },
        serviceWindow: { sourceWeekday: "5", open: "18:00", close: "02:00", overnight: true },
      }),
    }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ปิดทั้งวัน")).toBeInTheDocument();
    const active = await screen.findByText(/รอบที่เปิดอยู่ขณะนี้/);
    expect(active).toHaveTextContent("18:00–02:00");
    expect(active).toHaveTextContent("ข้ามเที่ยงคืน");
    expect(active).toHaveTextContent("ต่อเนื่องจากวันศุกร์");
  });

  it("ปิดแล้วไม่แสดงรอบที่เปิดอยู่", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ ...openStatus, isOpen: false, serviceWindow: null }),
    }));
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ปิดรับบริการ")).toBeInTheDocument();
    expect(screen.queryByText(/รอบที่เปิดอยู่ขณะนี้/)).not.toBeInTheDocument();
  });
});
