import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CustomerRegisterPage from "../src/pages/customer/CustomerRegister";
import CustomerLoginPage from "../src/pages/customer/CustomerLogin";

describe("หน้าสมัครสมาชิก (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดง label ครบและแจ้งเตือนเมื่อกดโดยไม่กรอก", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("ชื่อ")).toBeInTheDocument();
    expect(screen.getByLabelText("เบอร์โทรศัพท์")).toBeInTheDocument();
    expect(screen.getByLabelText(/อีเมล/)).toBeInTheDocument();
    expect(screen.getByLabelText("รหัสผ่าน")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "สมัครสมาชิก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณากรอกชื่อ");
  });

  it("เบอร์ผิดรูปแบบแจ้ง inline เป็นภาษาไทย", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("ชื่อ"), "สมชาย");
    await user.type(screen.getByLabelText("เบอร์โทรศัพท์"), "123");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "Password11");
    await user.click(screen.getByRole("button", { name: "สมัครสมาชิก" }));
    expect(await screen.findByText("เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0")).toBeInTheDocument();
  });

  it("เบอร์ซ้ำแสดงข้อความผิดพลาดภาษาไทยจาก server (แนบ CSRF)", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push(String(url));
        if (String(url).endsWith("/api/auth/csrf")) return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
        expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("t");
        return { ok: false, status: 409, json: async () => ({ error: "เบอร์โทรศัพท์นี้ถูกใช้สมัครแล้ว" }) };
      }),
    );
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("ชื่อ"), "สมชาย");
    await user.type(screen.getByLabelText("เบอร์โทรศัพท์"), "0812345678");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "Password11");
    await user.click(screen.getByRole("button", { name: "สมัครสมาชิก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("เบอร์โทรศัพท์นี้ถูกใช้สมัครแล้ว");
    expect(seen.some((s) => s.includes("/api/auth/csrf"))).toBe(true);
  });

  it("ระหว่างรอผลปุ่ม loading กดซ้ำไม่ได้", async () => {
    const user = userEvent.setup();
    let resolveReg!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/api/auth/csrf"))
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ csrfToken: "t" }) });
        return new Promise((resolve) => {
          resolveReg = resolve;
        });
      }),
    );
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("ชื่อ"), "สมชาย");
    await user.type(screen.getByLabelText("เบอร์โทรศัพท์"), "0812345678");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "Password11");
    await user.click(screen.getByRole("button", { name: "สมัครสมาชิก" }));
    expect(await screen.findByRole("button", { name: "กำลังสมัครสมาชิก…" })).toBeDisabled();
    resolveReg({ ok: false, status: 400, json: async () => ({ error: "ข้อมูลไม่ถูกต้อง" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูลไม่ถูกต้อง");
  });
});

describe("หน้าเข้าสู่ระบบสมาชิก (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดง label และลิงก์สมัครสมาชิก", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CustomerLoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("เบอร์โทรศัพท์")).toBeInTheDocument();
    expect(screen.getByLabelText("รหัสผ่าน")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "สมัครสมาชิก" })).toHaveAttribute("href", "/register");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน");
  });

  it("รหัสผิดแสดงข้อความ server และแนบ CSRF", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/api/auth/csrf")) return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) };
        if (String(url).endsWith("/api/customers/login")) {
          expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("t");
          return { ok: false, status: 401, json: async () => ({ error: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง" }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    render(
      <MemoryRouter>
        <CustomerLoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("เบอร์โทรศัพท์"), "0812345678");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "WrongPass1");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง");
  });
});
