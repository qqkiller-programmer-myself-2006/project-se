import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StaffPage from "../src/pages/Staff";
import type { PublicUser } from "../src/lib/api";

const me: PublicUser = {
  id: "owner-id",
  username: "owner",
  roles: ["owner"],
  isActive: true,
  createdAt: new Date().toISOString(),
};

const staff: PublicUser = {
  id: "s1",
  username: "kitchen1",
  roles: ["kitchen", "drink"],
  isActive: true,
  createdAt: new Date().toISOString(),
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
      if (u.endsWith("/api/users") && (!init || !init.method || init.method === "GET"))
        return { ok: true, json: async () => ({ users: [me, staff] }) };
      if (u.endsWith("/api/users") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => ({ user: staff }) };
      return { ok: true, json: async () => ({ users: [me, staff] }) };
    }),
  );
}

describe("หน้าจัดการพนักงาน", () => {
  it("แสดงชื่อผู้ใช้ บทบาทภาษาไทย และฟอร์มสร้างพนักงาน", async () => {
    stubFetch();
    render(<StaffPage me={me} />);
    expect((await screen.findAllByText("kitchen1")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ครัว · เครื่องดื่ม/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toBeInTheDocument();
    expect(screen.getByText("สร้างบัญชีพนักงาน")).toBeInTheDocument();
  });

  it("สร้างพนักงานแล้วแสดงข้อความสำเร็จภาษาไทย", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<StaffPage me={me} />);
    await screen.findAllByText("kitchen1");
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "newstaff");
    await user.type(screen.getByLabelText(/รหัสผ่าน/), "NewStaff99");
    await user.click(screen.getByRole("button", { name: "สร้างบัญชี" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/สร้างบัญชี newstaff แล้ว/);
  });

  it("แสดง empty state เมื่อยังไม่มีพนักงาน", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
        return { ok: true, json: async () => ({ users: [] }) };
      }),
    );
    render(<StaffPage me={me} />);
    expect(await screen.findByText("ยังไม่มีบัญชีพนักงาน")).toBeInTheDocument();
  });

  it("แสดงสถานะเป็น badge และมี checkbox บทบาทที่แตะง่ายบนมือถือ", async () => {
    stubFetch();
    render(<StaffPage me={me} />);
    await screen.findAllByText("kitchen1");
    expect(screen.getAllByText("ใช้งานอยู่").length).toBeGreaterThanOrEqual(1);
    // checkbox บทบาทของ kitchen1 (แทน multi-select เดิม; มีทั้งตาราง desktop และการ์ด mobile)
    expect(screen.getAllByLabelText("ครัว ของ kitchen1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText("เครื่องดื่ม ของ kitchen1").length).toBeGreaterThanOrEqual(1);
  });

  it("กดรีเซ็ตรหัสผ่านแล้วเห็นชื่อบัญชีเป้าหมายและคำเตือนเซสชัน", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<StaffPage me={me} />);
    await screen.findAllByText("kitchen1");
    const resetButtons = screen.getAllByRole("button", { name: "รีเซ็ตรหัสผ่าน" });
    await user.click(resetButtons[0]!);
    expect(await screen.findByLabelText("ฟอร์มรีเซ็ตรหัสผ่าน")).toHaveTextContent(/kitchen1|owner/);
    expect(screen.getByLabelText("ฟอร์มรีเซ็ตรหัสผ่าน")).toHaveTextContent("เซสชันเดิมถูกยกเลิก");
  });
});
