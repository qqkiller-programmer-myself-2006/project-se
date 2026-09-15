import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminCustomersPage from "../src/pages/admin/AdminCustomers";

const list = [
  { id: "c1", name: "สมชาย", phone: "0811111111", email: null, isActive: true, isDeleted: false, createdAt: "", lineLinked: false },
  { id: "c2", name: "สมหญิง", phone: "0822222222", email: "y@example.com", isActive: false, isDeleted: false, createdAt: "", lineLinked: true },
];

function stubAdmin() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      if (u.includes("/api/admin/customers?") || u.endsWith("/api/admin/customers")) {
        const q = new URL(u, "http://x").searchParams.get("q") ?? "";
        return ok({ customers: list.filter((c) => !q || c.name.includes(q) || (c.phone ?? "").includes(q)) });
      }
      if (u.endsWith("/api/admin/customers/c1"))
        return ok({ customer: list[0], line: { linked: false } });
      if (u.endsWith("/api/admin/customers/c2"))
        return ok({ customer: list[1], line: { linked: true, displayName: "หญิง LINE" } });
      if (u.endsWith("/deactivate")) return ok({ customer: { ...list[0], isActive: false } });
      if (u.endsWith("/activate")) return ok({ customer: { ...list[1], isActive: true } });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
    }),
  );
  return calls;
}

describe("หน้าจัดการสมาชิกหลังร้าน (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading → แสดงรายชื่อพร้อม badge สถานะ/LINE", async () => {
    stubAdmin();
    render(
      <MemoryRouter>
        <AdminCustomersPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("กำลังโหลดรายชื่อสมาชิก…")).toBeInTheDocument();
    await screen.findByText("สมชาย");
    expect(screen.getByText("สมหญิง")).toBeInTheDocument();
    expect(screen.getByText("ใช้งาน")).toBeInTheDocument();
    expect(screen.getByText("ปิดใช้งาน")).toBeInTheDocument();
    expect(screen.getByText("LINE")).toBeInTheDocument();
  });

  it("ค้นหาส่ง q ไป server และกรองผล", async () => {
    const user = userEvent.setup();
    stubAdmin();
    render(
      <MemoryRouter>
        <AdminCustomersPage />
      </MemoryRouter>,
    );
    await screen.findByText("สมชาย");
    await user.type(screen.getByLabelText("ค้นหาด้วยชื่อ เบอร์โทร หรืออีเมล"), "สมหญิง");
    await user.click(screen.getByRole("button", { name: "ค้นหา" }));
    await screen.findByText("สมหญิง");
    expect(screen.queryByText("สมชาย")).not.toBeInTheDocument();
  });

  it("กดรายชื่อดูรายละเอียด + ปิดบัญชีได้", async () => {
    const user = userEvent.setup();
    stubAdmin();
    render(
      <MemoryRouter>
        <AdminCustomersPage />
      </MemoryRouter>,
    );
    await screen.findByText("สมชาย");
    await user.click(screen.getByRole("button", { name: /สมชาย/ }));
    await screen.findByText("ยังไม่เชื่อม");
    await user.click(screen.getByRole("button", { name: "ปิดบัญชี" }));
    await screen.findByText(/ปิดบัญชีแล้วยกเลิกเซสชัน/);
  });

  it("empty state เมื่อไม่มีสมาชิก", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ customers: [] }) })),
    );
    render(
      <MemoryRouter>
        <AdminCustomersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีบัญชีสมาชิก")).toBeInTheDocument();
  });
});
