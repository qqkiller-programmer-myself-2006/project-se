import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ShopPage from "../src/pages/Shop";

const config = {
  shopName: "ร้านป้าอ้ออาหารตามสั่ง",
  schedule: {
    "0": { closed: true, intervals: [] },
    "1": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
    "2": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
    "3": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
    "4": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
    "5": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
    "6": { closed: false, intervals: [{ open: "09:00", close: "21:00" }] },
  },
  override: null,
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/csrf"))
        return { ok: true, json: async () => ({ csrfToken: "t" }) };
      return handler(String(url), init);
    }),
  );
}

function okShop() {
  stubFetch((url) => {
    if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
    if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
    if (url.endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
    return { ok: true, json: async () => ({}) };
  });
}

describe("หน้าจัดการร้าน (Owner/Admin)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงชื่อร้าน ตาราง 7 วัน และ empty ประวัติ", async () => {
    okShop();
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง")).toBeInTheDocument();
    expect(screen.getByLabelText("ฟอร์มเวลาทำการ")).toBeInTheDocument();
    expect(screen.getByLabelText("ปิดทั้งวัน วันอาทิตย์")).toBeInTheDocument();
    expect(await screen.findByText("ยังไม่มีประวัติการเปลี่ยนสถานะร้าน")).toBeInTheDocument();
  });

  it("บันทึกสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule") && init?.method === "PUT")
        return { ok: true, json: async () => config };
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.click(screen.getByRole("button", { name: "บันทึกเวลาทำการ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกเวลาทำการแล้ว");
  });

  it("บันทึกไม่ผ่านแสดง error และปุ่มกลับมากดได้", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule") && init?.method === "PUT")
        return { ok: false, status: 400, json: async () => ({ error: "ช่วงเวลาซ้อนทับกัน" }) };
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.click(screen.getByRole("button", { name: "บันทึกเวลาทำการ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ช่วงเวลาซ้อนทับกัน");
    expect(screen.getByRole("button", { name: "บันทึกเวลาทำการ" })).toBeEnabled();
  });

  it("สั่งปิดชั่วคราวสำเร็จแสดงข้อความ และล้างคำสั่งได้", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/shop/override") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({ override: { mode: "closed", reason: "ไฟดับ", expectedReopenAt: null, expiresAt: null, createdAt: "", createdBy: "owner" } }),
        };
      if (url.includes("/api/shop/override") && init?.method === "DELETE")
        return { ok: true, json: async () => ({ ok: true, cleared: true }) };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.type(screen.getByLabelText(/เหตุผล/), "ไฟดับ");
    await user.click(screen.getByRole("button", { name: "สั่งปิดชั่วคราว" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ปิดร้านชั่วคราวแล้ว");
    await user.click(screen.getByRole("button", { name: /ล้างคำสั่ง/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("ล้างคำสั่งชั่วคราวแล้ว");
  });

  it("ระหว่างบันทึกปุ่มแสดง pending และกดซ้ำไม่ได้", async () => {
    const user = userEvent.setup();
    let resolvePut!: (v: unknown) => void;
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule") && init?.method === "PUT")
        return new Promise((resolve) => {
          resolvePut = resolve;
        });
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.click(screen.getByRole("button", { name: "บันทึกเวลาทำการ" }));
    expect(await screen.findByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
    resolvePut({ ok: true, json: async () => config });
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกเวลาทำการแล้ว");
  });

  it("สั่งปิดพร้อมวันหมดอายุส่ง expiresAt แยกจากคาดว่าจะเปิด", async () => {
    const user = userEvent.setup();
    const posted: Record<string, unknown>[] = [];
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/shop/override") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return {
          ok: true,
          status: 201,
          json: async () => ({ override: { mode: "closed", reason: "ไฟดับ", expectedReopenAt: null, expiresAt: null, createdAt: "", createdBy: "owner" } }),
        };
      }
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.type(screen.getByLabelText(/เหตุผล/), "ไฟดับ");
    // datetime-local ตั้งค่าตรง (user.type กับ input ชนิดนี้ใน jsdom ไม่เสถียร)
    fireEvent.change(screen.getByLabelText(/หมดอายุคำสั่งเมื่อ/), { target: { value: "2026-09-08T06:00" } });
    await user.click(screen.getByRole("button", { name: "สั่งปิดชั่วคราว" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ปิดร้านชั่วคราวแล้ว");
    expect(posted).toHaveLength(1);
    expect(posted[0]!["reason"]).toBe("ไฟดับ");
    // "2026-09-08T06:00" เวลากรุงเทพ (+07:00) => 23:00Z วันก่อนหน้า — ไม่พึ่ง TZ เครื่อง
    expect(posted[0]!["expiresAt"]).toBe("2026-09-07T23:00:00.000Z");
    expect(posted[0]!["expectedReopenAt"]).toBeUndefined();
  });

  it("ตัวอย่าง exact: 2026-09-12T18:30 กรุงเทพ => payload 11:30Z", async () => {
    const user = userEvent.setup();
    const posted: Record<string, unknown>[] = [];
    stubFetch((url, init) => {
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/shop/override") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return {
          ok: true,
          status: 201,
          json: async () => ({ override: { mode: "open", reason: null, expectedReopenAt: null, expiresAt: null, createdAt: "", createdBy: "owner" } }),
        };
      }
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    await user.selectOptions(screen.getByLabelText("คำสั่ง"), "open");
    fireEvent.change(screen.getByLabelText(/หมดอายุคำสั่งเมื่อ/), { target: { value: "2026-09-12T18:30" } });
    await user.click(screen.getByRole("button", { name: "สั่งเปิดชั่วคราว" }));
    expect(await screen.findByRole("status")).toHaveTextContent("เปิดร้านชั่วคราวแล้ว");
    expect(posted).toHaveLength(1);
    expect(posted[0]!["expiresAt"]).toBe("2026-09-12T11:30:00.000Z");
  });

  it("label วันเวลาระบุ Asia/Bangkok ชัดเจน", async () => {
    stubFetch((url) => {
      if (url.includes("/api/shop/schedule")) return { ok: true, json: async () => config };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    expect(screen.getByText(/คาดว่าจะเปิด เวลา Asia\/Bangkok/)).toBeInTheDocument();
    expect(screen.getByText(/หมดอายุคำสั่งเมื่อ เวลา Asia\/Bangkok/)).toBeInTheDocument();
  });

  it("buildOverrideBody: แปลง wall กรุงเทพเป็น ISO และปฏิเสธค่าผิด (pure)", async () => {
    const { buildOverrideBody } = await import("../src/components/OverridePanel");
    expect(
      buildOverrideBody({ mode: "closed", reason: "ไฟดับ", expected: "", expires: "2026-09-12T18:30" }),
    ).toEqual({
      ok: true,
      body: { mode: "closed", reason: "ไฟดับ", expiresAt: "2026-09-12T11:30:00.000Z" },
    });
    expect(
      buildOverrideBody({ mode: "open", reason: "", expected: "2026-09-12T18:30", expires: "" }),
    ).toEqual({
      ok: true,
      body: { mode: "open", expectedReopenAt: "2026-09-12T11:30:00.000Z" },
    });
    const bad = buildOverrideBody({ mode: "closed", reason: "ไฟดับ", expected: "", expires: "2026-02-30T10:00" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toMatch(/หมดอายุคำสั่ง/);
      expect(bad.error).toMatch(/เป็นไปไม่ได้/);
    }
    const badExpected = buildOverrideBody({ mode: "closed", reason: "x", expected: "xxx", expires: "" });
    expect(badExpected.ok).toBe(false);
  });

  it("override ที่หมดอายุไม่แสดงว่า active แต่แจ้งว่าหมดอายุแล้ว", async () => {
    stubFetch((url) => {
      if (url.includes("/api/shop/schedule"))
        return {
          ok: true,
          json: async () => ({
            ...config,
            override: null,
            expiredOverride: { mode: "closed", reason: "ไฟดับ", expectedReopenAt: null, expiresAt: "2026-09-07T00:00:00.000Z", createdAt: "", createdBy: "owner" },
          }),
        };
      if (url.includes("/api/audit/shop")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("ร้านป้าอ้ออาหารตามสั่ง");
    expect(screen.queryByText("ปิดชั่วคราว", { selector: "span" })).not.toBeInTheDocument();
    expect(await screen.findByText(/หมดอายุแล้ว/)).toBeInTheDocument();
    expect(screen.getByText("ขณะนี้ไม่มีคำสั่งชั่วคราว ร้านใช้ตารางประจำสัปดาห์")).toBeInTheDocument();
  });
});
