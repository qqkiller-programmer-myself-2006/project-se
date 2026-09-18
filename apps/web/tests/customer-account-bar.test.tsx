import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import type { PublicCustomer } from "../src/lib/api";

function customer(): PublicCustomer {
  return {
    id: "c1",
    name: "สมชาย ใจดี",
    phone: "0812345678",
    email: null,
    isActive: true,
    isDeleted: false,
    createdAt: new Date().toISOString(),
  };
}

/** stub ทั้งแอป: ไม่มี session พนักงาน, session ลูกค้าเปลี่ยนได้ตามเทสต์ */
function stubApp(signedIn: boolean) {
  let me: PublicCustomer | null = signedIn ? customer() : null;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.endsWith("/api/auth/me")) return err(401, "กรุณาเข้าสู่ระบบก่อน");
      if (u.endsWith("/api/customers/logout")) {
        me = null;
        return ok({ ok: true });
      }
      if (u.endsWith("/api/customers/me")) {
        return me ? ok({ customer: me }) : err(401, "กรุณาเข้าสู่ระบบก่อน");
      }
      return err(404, "ไม่พบ");
    }),
  );
  return calls;
}

describe("แถบบัญชีสมาชิกในเชลล์ลูกค้า", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("guest เห็นทางเข้าสู่ระบบและสมัครสมาชิกจากหัวเว็บ", async () => {
    stubApp(false);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
    expect(bar).toHaveTextContent("สมัครสมาชิก");
    expect(screen.queryByRole("button", { name: /ออกจากระบบ/ })).not.toBeInTheDocument();
  });

  it("สมาชิกที่เข้าสู่ระบบแล้วเห็นชื่อตัวเองและปุ่มออกจากระบบ", async () => {
    stubApp(true);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /สมชาย ใจดี/ });
    expect(link).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /ออกจากระบบ/ })).toBeInTheDocument();
  });

  it("กดออกจากระบบแล้วเรียก API และหัวเว็บกลับเป็น guest", async () => {
    const calls = stubApp(true);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /ออกจากระบบ/ }));
    await waitFor(() => expect(calls.some((c) => c === "POST /api/customers/logout")).toBe(true));
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
    expect(screen.queryByRole("button", { name: /ออกจากระบบ/ })).not.toBeInTheDocument();
  });
});
