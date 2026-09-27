import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { CustomerSessionProvider } from "../src/lib/customerSession";
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
      if (u.endsWith("/api/auth/session")) return ok({ user: null });
      if (u.endsWith("/api/customers/login") || u.endsWith("/api/customers/register")) {
        me = customer();
        return ok({ customer: me });
      }
      if (u.endsWith("/api/customers/line/status")) return ok({ linked: false, available: false });
      if (u.endsWith("/api/customers/logout")) {
        me = null;
        return ok({ ok: true });
      }
      // endpoint สาธารณะของเชลล์: ตอบ 200 เสมอ guest ได้ customer: null
      if (u.endsWith("/api/customers/session")) return ok({ customer: me });
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

  it("guest ไม่ยิง endpoint ที่ตอบ 401 เลย (console ต้องสะอาด)", async () => {
    const calls = stubApp(false);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
    expect(calls.filter((c) => c.endsWith("/api/customers/me"))).toHaveLength(0);
    // ถามครั้งเดียวต่อการเปิดแอป ไม่ใช่ทุกครั้งที่เปลี่ยนหน้า
    expect(calls.filter((c) => c.endsWith("/api/customers/session"))).toHaveLength(1);
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

  // main.tsx ครอบแอปด้วย provider — หัวเว็บกับหน้าเข้าสู่ระบบต้องใช้ session ก้อนเดียวกัน
  function renderWithSession(path: string) {
    return render(
      <CustomerSessionProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </CustomerSessionProvider>,
    );
  }

  it("เข้าสู่ระบบสำเร็จแล้วหัวเว็บเปลี่ยนเป็นชื่อสมาชิกทันที ไม่ต้องรีเฟรช", async () => {
    stubApp(false);
    renderWithSession("/customer/login");
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
    await userEvent.type(await screen.findByLabelText(/เบอร์โทร/), "0812345678");
    await userEvent.type(screen.getByLabelText(/รหัสผ่าน/), "Password11");
    await userEvent.click(screen.getByRole("button", { name: /^เข้าสู่ระบบ$/ }));
    await waitFor(() => expect(bar).toHaveTextContent("สมชาย ใจดี"));
    expect(bar).not.toHaveTextContent("สมัครสมาชิก");
  });

  it("สมัครสมาชิกสำเร็จแล้วหัวเว็บเปลี่ยนเป็นชื่อสมาชิกทันที", async () => {
    stubApp(false);
    renderWithSession("/register");
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
    await userEvent.type(await screen.findByLabelText(/ชื่อ/), "สมชาย ใจดี");
    await userEvent.type(screen.getByLabelText(/เบอร์โทร/), "0812345678");
    await userEvent.type(screen.getByLabelText(/รหัสผ่าน/), "Password11");
    await userEvent.click(screen.getByRole("button", { name: /^สมัครสมาชิก$/ }));
    await waitFor(() => expect(bar).toHaveTextContent("สมชาย ใจดี"));
  });

  it("ออกจากระบบจากหน้าโปรไฟล์แล้วหัวเว็บกลับเป็น guest", async () => {
    stubApp(true);
    renderWithSession("/profile");
    const bar = await screen.findByRole("navigation", { name: "บัญชีสมาชิก" });
    await waitFor(() => expect(bar).toHaveTextContent("สมชาย ใจดี"));
    const main = screen.getByRole("main");
    await userEvent.click(await within(main).findByRole("button", { name: /ออกจากระบบ/ }));
    await waitFor(() => expect(bar).toHaveTextContent("เข้าสู่ระบบ"));
  });
});
