import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import type { PublicUser } from "../src/lib/api";

function owner(): PublicUser {
  return { id: "o", username: "owner", roles: ["owner"], isActive: true, createdAt: new Date().toISOString() };
}
function kitchen(): PublicUser {
  return { id: "k", username: "kitchen1", roles: ["kitchen"], isActive: true, createdAt: new Date().toISOString() };
}

function stubApp(me: PublicUser | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.endsWith("/api/auth/me")) return me ? ok({ user: me }) : err(401, "กรุณาเข้าสู่ระบบก่อน");
      if (u.includes("/api/admin/customers?") || u.endsWith("/api/admin/customers")) return ok({ customers: [] });
      if (u.includes("/api/admin/customers/")) return ok({ customer: { id: "c", name: "x", phone: null, email: null, isActive: true, isDeleted: false, createdAt: "" }, line: { linked: false } });
      if (u.includes("/api/shop/status"))
        return ok({ shopName: "ร้านป้าอ้ออาหารตามสั่ง", isOpen: true, isTemporary: false, reason: null, expectedReopenAt: null, today: { date: "2026-09-07", weekday: 1, closed: false, intervals: [{ open: "09:00", close: "21:00" }] }, tables: { enabled: 1, free: 1, occupied: 0 }, customerCount: 0 });
      if (u.includes("/api/shop/schedule")) return ok({ shopName: "x", schedule: {}, override: null });
      if (u.includes("/api/audit/")) return ok({ items: [] });
      if (u.includes("/api/tables")) return ok({ tables: [] });
      if (u.endsWith("/api/users")) return ok({ users: [] });
      if (u.endsWith("/api/customers/register") && init?.method === "POST") return ok({ customer: { id: "c", name: "x", phone: "0812345678", email: null, isActive: true, isDeleted: false, createdAt: "" } });
      if (u.endsWith("/api/customers/me") && (!init?.method || init.method === "GET")) return err(401, "กรุณาเข้าสู่ระบบก่อน");
      return err(404, "ไม่พบ");
    }),
  );
}

describe("shell Ticket 03: หน้าลูกค้า + เมนูสมาชิก", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("guest เปิด /register และ /customer/login ได้โดยไม่ต้อง login พนักงาน", async () => {
    stubApp(null);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "สมัครสมาชิก" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ฟอร์มเข้าสู่ระบบ")).not.toBeInTheDocument();
  });

  it("owner เห็นเมนูสมาชิกและเปิดหน้าจัดการได้", async () => {
    stubApp(owner());
    render(
      <MemoryRouter initialEntries={["/admin/customers"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "จัดการสมาชิก" });
    expect(screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" })).toHaveTextContent("สมาชิก");
  });

  it("kitchen ไม่เห็นเมนูสมาชิก", async () => {
    stubApp(kitchen());
    render(
      <MemoryRouter initialEntries={["/password"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "เปลี่ยนรหัสผ่านของฉัน" });
    expect(screen.queryByRole("link", { name: "สมาชิก" })).not.toBeInTheDocument();
  });
});
