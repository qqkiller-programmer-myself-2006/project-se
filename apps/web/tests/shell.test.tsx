import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import type { PublicUser } from "../src/lib/api";

function owner(): PublicUser {
  return { id: "o", username: "owner", roles: ["owner"], isActive: true, createdAt: new Date().toISOString() };
}
function admin(): PublicUser {
  return { id: "a", username: "admin1", roles: ["admin"], isActive: true, createdAt: new Date().toISOString() };
}
function kitchen(): PublicUser {
  return { id: "k", username: "kitchen1", roles: ["kitchen"], isActive: true, createdAt: new Date().toISOString() };
}

function stubApp(me: PublicUser | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.endsWith("/api/auth/me")) return me ? ok({ user: me }) : err(401, "กรุณาเข้าสู่ระบบก่อน");
      if (u.includes("/api/shop/status"))
        return ok({
          shopName: "ร้านป้าอ้ออาหารตามสั่ง",
          isOpen: true,
          isTemporary: false,
          reason: null,
          expectedReopenAt: null,
          today: { date: "2026-09-07", weekday: 1, closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
          tables: { enabled: 1, free: 1, occupied: 0 },
          customerCount: 0,
        });
      if (u.includes("/api/shop/schedule")) return ok({ shopName: "ร้านป้าอ้ออาหารตามสั่ง", schedule: {}, override: null });
      if (u.includes("/api/audit/shop")) return ok({ items: [] });
      if (u.includes("/api/tables")) return ok({ tables: [] });
      if (u.includes("/api/audit/")) return ok({ items: [] });
      if (u.endsWith("/api/users")) return ok({ users: [] });
      return err(404, "ไม่พบ");
    }),
  );
}

describe("shell Ticket 02: public /status + เมนูตามบทบาท", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("guest เปิด /status ได้โดยไม่ต้อง login", async () => {
    stubApp(null);
    render(
      <MemoryRouter initialEntries={["/status"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ร้านป้าอ้ออาหารตามสั่ง")).toBeInTheDocument();
    expect(screen.queryByLabelText("ฟอร์มเข้าสู่ระบบ")).not.toBeInTheDocument();
  });

  it("owner เห็นเมนูร้าน โต๊ะ พนักงาน ประวัติ เปลี่ยนรหัสผ่าน", async () => {
    stubApp(owner());
    render(
      <MemoryRouter initialEntries={["/shop"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "จัดการร้าน" });
    const nav = screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" });
    for (const name of ["สถานะร้าน", "ร้าน", "โต๊ะ", "พนักงาน", "เปลี่ยนรหัสผ่าน", "ประวัติ"]) {
      expect(nav).toHaveTextContent(name);
    }
  });

  it("admin เห็นร้านและโต๊ะ แต่ไม่เห็นพนักงานและประวัติ", async () => {
    stubApp(admin());
    render(
      <MemoryRouter initialEntries={["/tables"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "จัดการโต๊ะ" });
    const nav = screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" });
    expect(nav).toHaveTextContent("ร้าน");
    expect(nav).toHaveTextContent("โต๊ะ");
    expect(nav).not.toHaveTextContent("พนักงาน");
    expect(nav).not.toHaveTextContent("ประวัติ");
  });

  it("kitchen เห็นเฉพาะเปลี่ยนรหัสผ่าน (+สถานะร้าน) ไม่เห็นร้าน โต๊ะ พนักงาน ประวัติ", async () => {
    stubApp(kitchen());
    render(
      <MemoryRouter initialEntries={["/password"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "เปลี่ยนรหัสผ่านของฉัน" });
    const nav = screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" });
    expect(nav).toHaveTextContent("เปลี่ยนรหัสผ่าน");
    expect(nav).not.toHaveTextContent("พนักงาน");
    expect(nav).not.toHaveTextContent("ประวัติ");
    // ลิงก์เมนูจัดการต้องไม่มี (ใช้ getAll ป้องกัน false positive จาก heading)
    expect(screen.queryByRole("link", { name: "ร้าน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "โต๊ะ" })).not.toBeInTheDocument();
  });
});
