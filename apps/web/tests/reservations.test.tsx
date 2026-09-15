import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReservationsPage from "../src/pages/customer/Reservations";

const reservation = {
  id: "r1",
  code: "RSV-20260914-AB12",
  customerId: "c1",
  tableId: "t1",
  tableName: "A1",
  partySize: 2,
  reservedAt: "2026-09-14T05:00:00.000Z",
  status: "pending",
  note: null,
  createdAt: "2026-09-14T03:00:00.000Z",
  updatedAt: "2026-09-14T03:00:00.000Z",
  qr: "PAOR-RSV:RSV-20260914-AB12",
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

describe("หน้าจองโต๊ะของลูกค้า (Ticket 06)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดการจอง…")).toBeInTheDocument();
  });

  it("สมาชิกเห็นการจองของตนเองพร้อมรหัสและโต๊ะ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/me"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/reservations/mine"))
        return { ok: true, json: async () => ({ reservations: [reservation] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("RSV-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByText(/โต๊ะ A1/)).toBeInTheDocument();
    expect(screen.getByText("รอการยืนยัน")).toBeInTheDocument();
  });

  it("empty state เมื่อยังไม่มีการจอง", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/me"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/reservations/mine")) return { ok: true, json: async () => ({ reservations: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีการจอง")).toBeInTheDocument();
  });

  it("ยังไม่ login แสดงคำแนะนำให้เข้าสู่ระบบ (Guest จองไม่ได้)", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({ error: "x" }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/เข้าสู่ระบบบัญชีลูกค้า/)).toBeInTheDocument();
  });

  it("ดูโต๊ะแนะนำแล้วยืนยันการจองสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/customers/me"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/reservations/mine")) return { ok: true, json: async () => ({ reservations: [] }) };
      if (url.includes("/api/reservations/recommend"))
        return { ok: true, json: async () => ({ table: { id: "t1", name: "A1", capacity: 2 } }) };
      if (url.includes("/api/reservations") && !url.includes("mine"))
        return { ok: true, json: async () => ({ reservation, deduplicated: false }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("สร้างการจองใหม่")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ดูโต๊ะที่แนะนำ" }));
    expect(await screen.findByText(/โต๊ะที่แนะนำ: A1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByText(/จองสำเร็จ รหัส RSV-20260914-AB12/)).toBeInTheDocument();
  });

  it("สร้างการจองล้มเหลวแสดง error ภาษาไทย", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/customers/me"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/reservations/mine")) return { ok: true, json: async () => ({ reservations: [] }) };
      if (url.includes("/api/reservations"))
        return { ok: false, status: 409, json: async () => ({ error: "โต๊ะ A1 ไม่ว่างในช่วงเวลานี้แล้ว" }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("สร้างการจองใหม่")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ยืนยันการจอง" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("โต๊ะ A1 ไม่ว่างในช่วงเวลานี้แล้ว");
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let mineCalls = 0;
    stubFetch((url) => {
      if (url.includes("/api/customers/me"))
        return { ok: true, json: async () => ({ customer: { id: "c1", name: "ลูกค้า เอ" } }) };
      if (url.includes("/api/reservations/mine")) {
        mineCalls += 1;
        if (mineCalls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return { ok: true, json: async () => ({ reservations: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีการจอง")).toBeInTheDocument();
  });
});
