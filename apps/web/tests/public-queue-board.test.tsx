import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import QueueTrackPage from "../src/pages/customer/QueueTrack";
import PublicQueueBoard from "../src/pages/customer/PublicQueueBoard";

const snapshot = {
  entries: [
    { ref: "AB12", status: "preparing", ahead: 0 },
    { ref: "CD34", status: "waiting", ahead: 1 },
    { ref: "EF56", status: "waiting", ahead: 2 },
    { ref: "GH78", status: "ready", ahead: 0 },
  ],
  counts: { waiting: 2, preparing: 1, ready: 1 },
  updatedAt: "2026-09-14T10:00:00.000Z",
};

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function stubFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => {
    if (String(url).endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
    return handler(String(url));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("คิวรวมสาธารณะในหน้า /track (Issue #43)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("แสดงสรุปจำนวนและรายการคิวแบบไม่ระบุตัวตน", async () => {
    stubFetch(() => ok(snapshot));
    render(<PublicQueueBoard />);

    expect(await screen.findByText("#AB12")).toBeInTheDocument();
    expect(screen.getByText("รอทำ 2")).toBeInTheDocument();
    expect(screen.getByText("กำลังทำ 1")).toBeInTheDocument();
    expect(screen.getByText("พร้อมรับ 1")).toBeInTheDocument();
    expect(screen.getByText("คิวถัดไป")).toBeInTheDocument();
    expect(screen.getByText("มี 1 คิวก่อนหน้า")).toBeInTheDocument();
    expect(screen.getByText("มี 2 คิวก่อนหน้า")).toBeInTheDocument();
    expect(screen.getByText("พร้อมรับแล้ว")).toBeInTheDocument();
    expect(screen.getByText(/ไม่แสดงชื่อ เบอร์โทร หรือรายการอาหาร/)).toBeInTheDocument();
  });

  it("คิวว่าง → ข้อความว่าไม่มีคิวค้าง", async () => {
    stubFetch(() => ok({ entries: [], counts: { waiting: 0, preparing: 0, ready: 0 }, updatedAt: snapshot.updatedAt }));
    render(<PublicQueueBoard />);
    expect(await screen.findByText("ขณะนี้ไม่มีคิวค้างอยู่")).toBeInTheDocument();
  });

  it("โหลดไม่สำเร็จ → แสดง error", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) }));
    render(<PublicQueueBoard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
  });

  it("รีเฟรชอัตโนมัติทุก 15 วินาที และคงข้อมูลเดิมเมื่อรอบถัดไปล้มเหลว", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) return ok(snapshot);
      return { ok: false, status: 500, json: async () => ({ error: "ล้มชั่วคราว" }) };
    });
    render(<PublicQueueBoard />);
    expect(await screen.findByText("#AB12")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(calls).toBe(2);
    expect(screen.getByRole("alert")).toHaveTextContent("ล้มชั่วคราว");
    expect(screen.getByText("#AB12")).toBeInTheDocument();
  });

  it("แท็บ 'คิวทั้งหมด' ในหน้า /track เปิดคิวรวมโดยไม่ต้องกรอกเลข/เบอร์", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/api/queue/public")) return ok(snapshot);
      return ok({});
    });
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "คิวทั้งหมด" }));
    expect(await screen.findByText("#AB12")).toBeInTheDocument();
    expect(screen.queryByLabelText(/เลขคำสั่งซื้อ/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/queue/public"))).toBe(true);
  });
});
