import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CheckinPage from "../src/pages/shared/Checkin";

const openRound = {
  id: "round1",
  reservationId: "r1",
  tableId: "t1",
  tableName: "A1",
  partySize: 2,
  status: "open",
  openedAt: "2026-09-14T03:30:00.000Z",
  closedAt: null,
};

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

describe("หน้าเช็กอินและรอบโต๊ะ (Ticket 06)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดรอบโต๊ะ…")).toBeInTheDocument();
  });

  it("เห็นรอบที่เปิดอยู่พร้อมปุ่มปิดรอบ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/rounds")) return { ok: true, json: async () => ({ rounds: [openRound] }) };
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("โต๊ะ A1")).toBeInTheDocument();
    expect(screen.getByText("เปิดอยู่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดรอบ A1" })).toBeInTheDocument();
  });

  it("empty state เมื่อไม่มีรอบเปิดอยู่", async () => {
    stubFetch((url) => {
      if (url.includes("/api/rounds")) return { ok: true, json: async () => ({ rounds: [] }) };
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ไม่มีรอบการใช้โต๊ะที่เปิดอยู่")).toBeInTheDocument();
  });

  it("ไม่กรอกรหัสและเบอร์แจ้งเตือนก่อนเรียก API", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/rounds")) return { ok: true, json: async () => ({ rounds: [] }) };
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("เช็กอินลูกค้า")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เช็กอินและเปิดรอบโต๊ะ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาระบุรหัสการจองหรือเบอร์โทร");
  });

  it("เช็กอินสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/rounds") && (!init || init.method === undefined || init.method === "GET"))
        return { ok: true, json: async () => ({ rounds: [] }) };
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      if (url.includes("/api/checkin"))
        return {
          ok: true,
          json: async () => ({
            reservation: { code: "RSV-20260914-AB12" },
            round: openRound,
          }),
        };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("เช็กอินลูกค้า")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/รหัสการจอง/), "RSV-20260914-AB12");
    await user.click(screen.getByRole("button", { name: "เช็กอินและเปิดรอบโต๊ะ" }));
    expect(await screen.findByText(/เช็กอิน RSV-20260914-AB12 สำเร็จ/)).toBeInTheDocument();
  });

  it("เช็กอินล้มเหลว (โต๊ะไม่ว่าง) แสดง error", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/rounds")) return { ok: true, json: async () => ({ rounds: [] }) };
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      if (url.includes("/api/checkin"))
        return { ok: false, status: 409, json: async () => ({ error: "โต๊ะ A1 มีลูกค้าใช้อยู่ กรุณารอสักครู่ (รอจัดโต๊ะ)" }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("เช็กอินลูกค้า")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/รหัสการจอง/), "RSV-20260914-AB12");
    await user.click(screen.getByRole("button", { name: "เช็กอินและเปิดรอบโต๊ะ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีลูกค้าใช้อยู่");
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubFetch((url) => {
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables: [] }) };
      if (url.includes("/api/rounds")) {
        calls += 1;
        if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "โหลดไม่สำเร็จ" }) };
        return { ok: true, json: async () => ({ rounds: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <CheckinPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดไม่สำเร็จ");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ไม่มีรอบการใช้โต๊ะที่เปิดอยู่")).toBeInTheDocument();
  });
});
