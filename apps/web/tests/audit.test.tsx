import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuditPage from "../src/pages/Audit";
import ChangePasswordPage from "../src/pages/ChangePassword";

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init)),
  );
}

describe("หน้าประวัติ (Owner)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดง action code เป็น label ภาษาไทย", async () => {
    stubFetch((url) => {
      if (url.includes("/api/audit/logins"))
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 1, at: new Date().toISOString(), actorUsername: null, action: "login_success", targetUsername: "k1", detail: null, ip: null, success: true },
              { id: 2, at: new Date().toISOString(), actorUsername: null, action: "login_failed", targetUsername: "k1", detail: null, ip: null, success: false },
            ],
          }),
        };
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 3, at: new Date().toISOString(), actorUsername: "owner", action: "user_created", targetUsername: "k1", detail: null, ip: null, success: true },
            { id: 4, at: new Date().toISOString(), actorUsername: "owner", action: "password_reset", targetUsername: "k1", detail: null, ip: null, success: true },
          ],
        }),
      };
    });
    render(<AuditPage />);
    expect(await screen.findByText("เข้าสู่ระบบสำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("เข้าสู่ระบบไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("สร้างบัญชี")).toBeInTheDocument();
    expect(screen.getByText("รีเซ็ตรหัสผ่าน")).toBeInTheDocument();
  });

  it("กรองตามหมวดซ่อน section ที่ไม่เกี่ยว", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/audit/logins"))
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 1, at: new Date().toISOString(), actorUsername: null, action: "login_success", targetUsername: "k1", detail: null, ip: null, success: true }],
          }),
        };
      return {
        ok: true,
        json: async () => ({
          items: [{ id: 2, at: new Date().toISOString(), actorUsername: "owner", action: "user_created", targetUsername: "k1", detail: null, ip: null, success: true }],
        }),
      };
    });
    render(<AuditPage />);
    await screen.findByText("เข้าสู่ระบบสำเร็จ");
    await user.selectOptions(screen.getByLabelText("กรองตามหมวด"), "account");
    expect(screen.queryByLabelText("ประวัติการเข้าสู่ระบบ")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ประวัติบัญชีและบทบาท")).toBeInTheDocument();
  });

  it("แสดง empty state ภาษาไทยเมื่อไม่มีประวัติ", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ items: [] }) }));
    render(<AuditPage />);
    expect(await screen.findByText("ยังไม่มีประวัติการเข้าสู่ระบบตามเงื่อนไขนี้")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีประวัติบัญชี/บทบาทตามเงื่อนไขนี้")).toBeInTheDocument();
  });

  it("แสดงสถานะ error ภาษาไทยเมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "โหลดประวัติไม่สำเร็จ" }) }));
    render(<AuditPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดประวัติไม่สำเร็จ");
  });

  it("กรองตามผลสำเร็จ/ล้มเหลวซ่อนรายการที่ไม่เกี่ยว", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/audit/logins"))
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 1, at: new Date().toISOString(), actorUsername: null, action: "login_success", targetUsername: "k1", detail: null, ip: null, success: true },
              { id: 2, at: new Date().toISOString(), actorUsername: null, action: "login_failed", targetUsername: "k1", detail: null, ip: null, success: false },
            ],
          }),
        };
      return { ok: true, json: async () => ({ items: [] }) };
    });
    render(<AuditPage />);
    await screen.findByText("เข้าสู่ระบบสำเร็จ");
    await user.selectOptions(screen.getByLabelText("กรองตามผล"), "failed");
    expect(screen.queryByText("เข้าสู่ระบบสำเร็จ")).not.toBeInTheDocument();
    expect(screen.getByText("เข้าสู่ระบบไม่สำเร็จ")).toBeInTheDocument();
  });
});

describe("ฟอร์มเปลี่ยนรหัสผ่าน", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("สำเร็จแล้วล้างรหัสผ่านออกจากช่องกรอกและปุ่มกลับมาใช้งานได้", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    stubFetch((url) => {
      if (String(url).endsWith("/api/auth/csrf"))
        return { ok: true, json: async () => ({ csrfToken: "t" }) };
      return { ok: true, json: async () => ({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่" }) };
    });
    render(<ChangePasswordPage onChanged={onChanged} />);
    const current = screen.getByLabelText("รหัสผ่านปัจจุบัน") as HTMLInputElement;
    const next = screen.getByLabelText(/รหัสผ่านใหม่/) as HTMLInputElement;
    await user.type(current, "OldPass123");
    await user.type(next, "NewPass999");
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    expect(await screen.findByRole("status")).toHaveTextContent("กรุณาเข้าสู่ระบบใหม่");
    expect(current.value).toBe("");
    expect(next.value).toBe("");
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" })).toBeEnabled();
  });
});
