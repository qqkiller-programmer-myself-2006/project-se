import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import type { PublicUser } from "../src/lib/api";

const owner: PublicUser = {
  id: "owner-id",
  username: "owner",
  roles: ["owner"],
  isActive: true,
  createdAt: new Date().toISOString(),
};

describe("App ระดับ integration (login/session flow)", () => {
  let loggedIn: boolean;

  beforeEach(() => {
    loggedIn = false;
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
        const err = (status: number, message: string) => ({
          ok: false,
          status,
          json: async () => ({ error: message }),
        });
        if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
        if (u.endsWith("/api/auth/login") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { username: string; password: string };
          if (body.username === "owner" && body.password === "OwnerPass123") {
            loggedIn = true;
            return ok({ user: owner });
          }
          return err(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
        }
        if (u.endsWith("/api/auth/me")) {
          return loggedIn ? ok({ user: owner }) : err(401, "กรุณาเข้าสู่ระบบก่อน");
        }
        if (u.endsWith("/api/auth/logout")) {
          loggedIn = false;
          return ok({ ok: true, message: "ออกจากระบบแล้ว" });
        }
        if (u.endsWith("/api/auth/change-password")) {
          loggedIn = false; // server ยกเลิกทุกเซสชันหลังเปลี่ยนรหัส
          return ok({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่" });
        }
        if (u.endsWith("/api/users")) return ok({ users: [owner] });
        if (u.includes("/api/audit/")) return ok({ items: [] });
        if (u.includes("/api/users/")) return ok({ user: owner });
        return err(404, "ไม่พบ");
      }),
    );
  });

  it("login สำเร็จแล้วเห็นหน้าพนักงานทันที (ไม่วนกลับหน้าล็อกอิน)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText("ชื่อผู้ใช้"), "owner");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "OwnerPass123");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    // App รีเฟรช me แล้วจึงแสดงหน้าพนักงาน
    expect(await screen.findByRole("heading", { name: "จัดการพนักงาน" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ฟอร์มเข้าสู่ระบบ")).not.toBeInTheDocument();
  });

  it("ออกจากระบบแล้วกลับไปหน้าล็อกอิน", async () => {
    loggedIn = true;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/staff"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "จัดการพนักงาน" });
    await user.click(screen.getByRole("button", { name: "ออกจากระบบ" }));
    expect(await screen.findByLabelText("ชื่อผู้ใช้")).toBeInTheDocument();
  });

  it("เปลี่ยนรหัสผ่านสำเร็จแล้วต้องเข้าสู่ระบบใหม่", async () => {
    loggedIn = true;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/staff"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "จัดการพนักงาน" });
    await user.click(screen.getByRole("link", { name: "เปลี่ยนรหัสผ่าน" }));
    await user.type(await screen.findByLabelText("รหัสผ่านปัจจุบัน"), "OwnerPass123");
    await user.type(screen.getByLabelText(/รหัสผ่านใหม่/), "OwnerNew999");
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    // onChanged ล้าง session ฝั่ง UI แล้วกลับหน้าล็อกอิน
    expect(await screen.findByLabelText("ชื่อผู้ใช้")).toBeInTheDocument();
  });

  it("shell มี skip link, nav landmark และบอกหน้าปัจจุบัน (aria-current)", async () => {
    loggedIn = true;
    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /ประวัติการใช้งาน/ });
    expect(screen.getByRole("link", { name: "ข้ามไปยังเนื้อหาหลัก" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ประวัติ" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "พนักงาน" })).not.toHaveAttribute("aria-current");
    // บริบทผู้ใช้/บทบาทภาษาไทย
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("เจ้าของร้าน")).toBeInTheDocument();
  });
});
