import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminReservationsPage from "../src/pages/AdminReservations";

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

describe("หน้าจัดการการจองหลังร้าน (Ticket 06)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดการจอง…")).toBeInTheDocument();
  });

  it("ค้นหาแล้วเห็นรายการพร้อมปุ่มจัดการ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/admin/reservations")) return { ok: true, json: async () => ({ reservations: [reservation] }) };
      if (url.includes("/api/audit/reservations")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("RSV-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูและจัดการ RSV-20260914-AB12" })).toBeInTheDocument();
  });

  it("empty state เมื่อไม่มีการจองตามเงื่อนไข", async () => {
    stubFetch((url) => {
      if (url.includes("/api/admin/reservations")) return { ok: true, json: async () => ({ reservations: [] }) };
      if (url.includes("/api/audit/reservations")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีการจองตามเงื่อนไข")).toBeInTheDocument();
  });

  it("เลือกแล้วเปลี่ยนสถานะพร้อมเหตุผลสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/admin/reservations") && (!init || init.method === undefined || init.method === "GET"))
        return { ok: true, json: async () => ({ reservations: [reservation] }) };
      if (url.includes("/api/audit/reservations")) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes("/status"))
        return { ok: true, json: async () => ({ reservation: { ...reservation, status: "confirmed" } }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "ดูและจัดการ RSV-20260914-AB12" }));
    expect(await screen.findByText("เปลี่ยนสถานะ RSV-20260914-AB12")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/เหตุผล/), "โทรยืนยันแล้ว");
    await user.click(screen.getByRole("button", { name: "บันทึกสถานะ" }));
    expect(await screen.findByText(/เปลี่ยนสถานะ RSV-20260914-AB12 เป็นยืนยันแล้ว/)).toBeInTheDocument();
  });

  it("ไม่กรอกเหตุผลแจ้งเตือนก่อนเรียก API", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/admin/reservations")) return { ok: true, json: async () => ({ reservations: [reservation] }) };
      if (url.includes("/api/audit/reservations")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "ดูและจัดการ RSV-20260914-AB12" }));
    await user.click(await screen.findByRole("button", { name: "บันทึกสถานะ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาระบุเหตุผลในการเปลี่ยนสถานะ");
  });

  it("error state พร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubFetch((url) => {
      if (url.includes("/api/audit/reservations")) return { ok: true, json: async () => ({ items: [] }) };
      if (url.includes("/api/admin/reservations")) {
        calls += 1;
        if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return { ok: true, json: async () => ({ reservations: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <AdminReservationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีการจองตามเงื่อนไข")).toBeInTheDocument();
  });
});
