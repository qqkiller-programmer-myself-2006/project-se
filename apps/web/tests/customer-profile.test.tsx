import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CustomerProfilePage from "../src/pages/CustomerProfile";

const customer = { id: "c1", name: "สมชาย", phone: "0812345678", email: null, isActive: true, isDeleted: false, createdAt: "" };

function stubProfile(overrides?: { line?: { linked: boolean; displayName?: string | null }; meFails?: boolean }) {
  const line = overrides?.line ?? { linked: false };
  const calls: string[] = [];
  let opened: string | null = null;
  const originalOpen = window.open;
  window.open = vi.fn((url: string) => {
    opened = url;
    return null;
  }) as unknown as typeof window.open;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.endsWith("/api/customers/me") && (!init?.method || init.method === "GET"))
        return overrides?.meFails ? err(401, "กรุณาเข้าสู่ระบบก่อน") : ok({ customer });
      if (u.endsWith("/api/customers/me") && init?.method === "PATCH") return ok({ customer: { ...customer, name: "สมชายใหม่" } });
      if (u.endsWith("/api/customers/change-password")) return ok({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่" });
      if (u.endsWith("/api/customers/line/status")) return ok(line);
      if (u.endsWith("/api/customers/line/start")) return ok({ authorizeUrl: "https://access.line.me/oauth2/v2.1/authorize?state=x" });
      if (u.endsWith("/api/customers/line/unlink")) return ok({ ok: true, message: "ยกเลิกการเชื่อม LINE แล้ว" });
      if (u.endsWith("/api/customers/logout")) return ok({ ok: true });
      if (u.endsWith("/api/customers/me") && init?.method === "DELETE") return ok({ ok: true, message: "ลบบัญชีแล้ว" });
      return err(404, "ไม่พบ");
    }),
  );
  return { calls, opened: () => opened, restoreOpen: () => { window.open = originalOpen; } };
}

describe("หน้าโปรไฟล์ลูกค้า (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading แล้วแสดงข้อมูล เบอร์เปลี่ยนไม่ได้ และมีปุ่มออกจากระบบ", async () => {
    const stub = stubProfile();
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    expect(screen.getByText("กำลังโหลดข้อมูลสมาชิก…")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "โปรไฟล์ของฉัน" });
    expect(screen.getByText(/เบอร์โทร 0812345678/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ออกจากระบบ" })).toBeInTheDocument();
    stub.restoreOpen();
  });

  it("ไม่มี session แสดง error พร้อมปุ่มลองใหม่", async () => {
    const stub = stubProfile({ meFails: true });
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาเข้าสู่ระบบก่อน");
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    stub.restoreOpen();
  });

  it("บันทึกชื่อใหม่สำเร็จแสดง success", async () => {
    const user = userEvent.setup();
    const stub = stubProfile();
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "โปรไฟล์ของฉัน" });
    await user.clear(screen.getByLabelText("ชื่อ"));
    await user.type(screen.getByLabelText("ชื่อ"), "สมชายใหม่");
    await user.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText("บันทึกข้อมูลแล้ว");
    expect(stub.calls.some((c) => c.includes("PATCH") && c.includes("/api/customers/me"))).toBe(true);
    stub.restoreOpen();
  });

  it("เชื่อม LINE: กดเชื่อมเปิดแท็บใหม่ + ตรวจสถานะ; linked แล้วมีปุ่มยกเลิก", async () => {
    const user = userEvent.setup();
    const stub = stubProfile();
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "โปรไฟล์ของฉัน" });
    expect(screen.getByText("ยังไม่เชื่อม")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เชื่อม LINE" }));
    await screen.findByText(/เปิดหน้า LINE แล้ว/);
    expect(stub.opened()).toContain("https://access.line.me/oauth2/v2.1/authorize");
    await user.click(screen.getByRole("button", { name: "ตรวจสอบสถานะ" }));
    await waitFor(() => {
      expect(stub.calls.filter((c) => c.includes("/api/customers/line/status")).length).toBeGreaterThanOrEqual(2);
    });
    stub.restoreOpen();
  });

  it("linked แล้วกดยกเลิกการเชื่อมได้", async () => {
    const user = userEvent.setup();
    const stub = stubProfile({ line: { linked: true, displayName: "สมชาย LINE" } });
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    await screen.findByText("เชื่อมแล้ว");
    await user.click(screen.getByRole("button", { name: "ยกเลิกการเชื่อม" }));
    await screen.findByText("ยกเลิกการเชื่อม LINE แล้ว");
    stub.restoreOpen();
  });

  it("P2: query ?line=linked / ?line=error&reason=... จาก callback redirect แสดงผลถูกต้อง", async () => {
    const stub = stubProfile();
    render(
      <MemoryRouter initialEntries={["/profile?line=linked"]}>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    await screen.findByText("เชื่อม LINE สำเร็จแล้ว");
    stub.restoreOpen();
  });

  it("P2: query ?line=error แสดงข้อความตาม reason (ไม่มี secret ในข้อความ)", async () => {
    const stub = stubProfile();
    render(
      <MemoryRouter initialEntries={["/profile?line=error&reason=conflict"]}>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    const msg = await screen.findByText(/ถูกเชื่อมกับบัญชีอื่น/);
    expect(msg.textContent).not.toMatch(/code|token|secret/i);
    stub.restoreOpen();
  });

  it("ลบบัญชีต้องยืนยันสองขั้นก่อนเรียก DELETE", async () => {
    const user = userEvent.setup();
    const stub = stubProfile();
    render(
      <MemoryRouter>
        <CustomerProfilePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "โปรไฟล์ของฉัน" });
    await user.click(screen.getByRole("button", { name: "ขอลบบัญชีของฉัน" }));
    expect(await screen.findByText(/ยืนยันลบบัญชีถาวร/)).toBeInTheDocument();
    expect(stub.calls.some((c) => c.includes("DELETE"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "ยืนยันลบบัญชี" }));
    await waitFor(() => {
      expect(stub.calls.some((c) => c.includes("DELETE") && c.includes("/api/customers/me"))).toBe(true);
    });
    stub.restoreOpen();
  });
});
