import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../src/pages/shared/Login";

describe("หน้าเข้าสู่ระบบ (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดง label ภาษาไทยและแจ้งเตือนเมื่อกดโดยไม่กรอก", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toBeInTheDocument();
    expect(screen.getByLabelText("รหัสผ่าน")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
  });

  it("แสดงข้อความผิดพลาดภาษาไทยเมื่อรหัสผ่านผิด (login แนบ CSRF token)", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/api/auth/csrf"))
          return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
        if (String(url).endsWith("/api/auth/login")) {
          // login ต้องขอ CSRF ก่อนและแนบ header มาด้วย
          expect(seen.some((s) => s.includes("/api/auth/csrf"))).toBe(true);
          expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("t");
          return { ok: false, status: 401, json: async () => ({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "kitchen1");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "WrongPass1");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  });

  it("แจ้งเตือนรายช่องเมื่อกรอกไม่ครบ (inline validation)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByText("กรุณากรอกชื่อผู้ใช้")).toBeInTheDocument();
    expect(screen.getByText("กรุณากรอกรหัสผ่าน")).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toHaveAttribute("aria-invalid", "true");
  });

  it("ระหว่างรอผลปุ่มแสดงสถานะ loading และกดซ้ำไม่ได้", async () => {
    const user = userEvent.setup();
    let resolveLogin!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/api/auth/csrf"))
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ csrfToken: "t" }) });
        if (String(url).endsWith("/api/auth/login"))
          return new Promise((resolve) => {
            resolveLogin = resolve;
          });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }),
    );
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "kitchen1");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "SomePass99");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByRole("button", { name: "กำลังเข้าสู่ระบบ…" })).toBeDisabled();
    resolveLogin({ ok: false, status: 401, json: async () => ({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  });
});
