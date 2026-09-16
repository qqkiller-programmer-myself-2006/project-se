import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReservationsPage from "../src/pages/customer/Reservations";

const reservation = {
  id: "r1",
  code: "RSV-20260914-AB12",
  customerId: "c1",
  tableId: "t1",
  tableName: "A1",
  partySize: 2,
  reservedAt: "2026-09-14T05:00:00.000Z",
  status: "pending",
  note: null,
  createdAt: "2026-09-14T03:00:00.000Z",
  updatedAt: "2026-09-14T03:00:00.000Z",
  qr: "PAOR-RSV:RSV-20260914-AB12",
};

const availability = {
  tables: [
    { id: "t1", name: "A1", capacity: 2, zone: "dining", status: "available" },
    { id: "t2", name: "A2", capacity: 4, zone: "dining", status: "booked" },
    { id: "t3", name: "F1", capacity: 4, zone: "front", status: "available" },
  ],
  recommendedTableId: "t1",
};

type Handler = (url: string, init?: RequestInit) => unknown;

function stubFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
    return handler(String(url), init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const loggedIn: Handler = (url) => {
  if (url.includes("/api/customers/me")) return ok({ customer: { id: "c1", name: "ลูกค้า เอ" } });
  if (url.includes("/api/reservations/mine")) return ok({ reservations: [] });
  if (url.includes("/api/reservations/availability")) return ok(availability);
  return ok({});
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ReservationsPage />
    </MemoryRouter>,
  );
}

describe("หน้าจองโต๊ะของลูกค้า (3 ขั้นตอน)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 17, 10, 5));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByText("กำลังโหลดการจอง…")).toBeInTheDocument();
  });

  it("แสดง 3 ขั้นตอน พร้อมวันเวลาเริ่มต้นที่จองได้ และถามผังโต๊ะตามเวลาที่เลือก", async () => {
    const fetchFn = stubFetch(loggedIn);
    renderPage();
    expect(screen.getByRole("heading", { name: /ขั้นที่ 1: เลือกวัน เวลา และจำนวนคน/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ขั้นที่ 2: เลือกโซนและโต๊ะ/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ขั้นที่ 3: ตรวจสอบและยืนยันการจอง/ })).toBeInTheDocument();

    const days = screen.getByRole("group", { name: "วันที่" });
    expect(within(days).getByRole("button", { name: /วันนี้/ })).toHaveAttribute("aria-pressed", "true");
    const times = screen.getByRole("group", { name: "เวลานัด" });
    expect(within(times).getByRole("button", { name: "12:30" })).toHaveAttribute("aria-pressed", "true");
    expect(within(times).queryByRole("button", { name: "10:30" })).not.toBeInTheDocument();

    await screen.findByRole("button", { name: /^โต๊ะ A1 / });
    const url = fetchFn.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/availability"))!;
    expect(url).toContain("partySize=2");
    expect(decodeURIComponent(url)).toContain(new Date(2026, 8, 17, 12, 30).toISOString());
  });

  it("เปลี่ยนจำนวนคนและเวลาแล้วถามผังใหม่", async () => {
    const user = userEvent.setup();
    const fetchFn = stubFetch(loggedIn);
    renderPage();
    await screen.findByRole("button", { name: /^โต๊ะ A1 / });
    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวนคน" }));
    await user.click(within(screen.getByRole("group", { name: "วันที่" })).getByRole("button", { name: /พรุ่งนี้/ }));
    await user.click(within(screen.getByRole("group", { name: "เวลานัด" })).getByRole("button", { name: "18:00" }));
    await waitFor(() => {
      const last = fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/availability")).at(-1)!;
      expect(last).toContain("partySize=3");
      expect(decodeURIComponent(last)).toContain(new Date(2026, 8, 18, 18, 0).toISOString());
    });
    expect(screen.getByText(/สถานะโต๊ะสำหรับ 3 คน/)).toBeInTheDocument();
  });

  it("เลือกโต๊ะแล้วสรุปและยืนยัน — ส่ง tableId ที่เลือกไปจองจริง", async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    stubFetch((url, init) => {
      if (url.endsWith("/api/reservations") && init?.method === "POST") {
        body = JSON.parse(String(init.body));
        return ok({ reservation: { ...reservation, tableId: "t3", tableName: "F1" }, deduplicated: false });
      }
      return loggedIn(url, init);
    });
    renderPage();
    const confirm = await screen.findByRole("button", { name: "เลือกโต๊ะก่อนยืนยัน" });
    expect(confirm).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: /^โต๊ะ F1 / }));
    expect(screen.getByText("โต๊ะ F1 (4 ที่นั่ง)")).toBeInTheDocument();
    expect(screen.getAllByText("โซนหน้าร้าน (ใต้กันสาด)").length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("หมายเหตุถึงร้าน (ถ้ามี)"), "มีเด็กเล็ก");
    await user.click(screen.getByRole("button", { name: "ยืนยันจองโต๊ะ F1" }));

    expect(await screen.findByText("จองสำเร็จ รหัส RSV-20260914-AB12")).toBeInTheDocument();
    expect(body).toMatchObject({ tableId: "t3", partySize: 2, note: "มีเด็กเล็ก" });
    expect(String(body!["idempotencyKey"])).toMatch(/^[0-9a-f-]{36}$/);
    expect(body!["reservedAt"]).toBe(new Date(2026, 8, 17, 12, 30).toISOString());
  });

  it("ปุ่มไปยืนยันบนแถบล่างแสดงเมื่อเลือกโต๊ะ", async () => {
    const user = userEvent.setup();
    stubFetch(loggedIn);
    renderPage();
    expect(screen.queryByRole("button", { name: "ไปยืนยัน" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^โต๊ะ A1 / }));
    expect(screen.getByRole("button", { name: "ไปยืนยัน" })).toBeInTheDocument();
  });

  it("จองไม่สำเร็จ (โต๊ะถูกจองตัดหน้า) แสดง error และดึงผังล่าสุด", async () => {
    const user = userEvent.setup();
    let availabilityCalls = 0;
    stubFetch((url, init) => {
      if (url.includes("/api/reservations/availability")) {
        availabilityCalls += 1;
        return ok(availability);
      }
      if (url.endsWith("/api/reservations") && init?.method === "POST")
        return { ok: false, status: 409, json: async () => ({ error: "โต๊ะ A1 ไม่ว่างในช่วงเวลานี้แล้ว" }) };
      return loggedIn(url, init);
    });
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^โต๊ะ A1 / }));
    const before = availabilityCalls;
    await user.click(screen.getByRole("button", { name: "ยืนยันจองโต๊ะ A1" }));
    expect(await screen.findByText("โต๊ะ A1 ไม่ว่างในช่วงเวลานี้แล้ว")).toBeInTheDocument();
    await waitFor(() => expect(availabilityCalls).toBeGreaterThan(before));
  });

  it("ผังใหม่ทำให้โต๊ะที่เลือกไม่ว่าง → ยกเลิกการเลือกพร้อมแจ้ง", async () => {
    const user = userEvent.setup();
    let bookedNow = false;
    stubFetch((url, init) => {
      if (url.includes("/api/reservations/availability")) {
        return ok({
          ...availability,
          tables: availability.tables.map((t) => (t.id === "t3" && bookedNow ? { ...t, status: "booked" } : t)),
        });
      }
      return loggedIn(url, init);
    });
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^โต๊ะ F1 / }));
    bookedNow = true;
    await user.click(within(screen.getByRole("group", { name: "เวลานัด" })).getByRole("button", { name: "13:00" }));
    expect(await screen.findByText("โต๊ะ F1 ถูกจองในช่วงเวลานี้แล้ว กรุณาเลือกโต๊ะใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกโต๊ะก่อนยืนยัน" })).toBeDisabled();
  });

  it("Guest ดูผังโต๊ะได้ แต่ต้องเข้าสู่ระบบก่อนยืนยัน", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/customers/me")) return { ok: false, status: 401, json: async () => ({ error: "x" }) };
      if (url.includes("/api/reservations/availability")) return ok(availability);
      return ok({});
    });
    renderPage();
    expect(await screen.findByText(/เข้าสู่ระบบบัญชีลูกค้า/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^โต๊ะ A1 / }));
    expect(screen.getByText("โต๊ะ A1 (2 ที่นั่ง)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยันจองโต๊ะ/ })).not.toBeInTheDocument();
  });

  it("เชื่อมต่อไม่ได้ → แสดงผังตัวอย่างและจองจริงไม่ได้", async () => {
    stubFetch((url) => {
      if (url.includes("/api/customers/me")) return ok({ customer: { id: "c1", name: "ลูกค้า เอ" } });
      if (url.includes("/api/reservations/mine")) return ok({ reservations: [] });
      if (url.includes("/api/reservations/availability")) throw new TypeError("Failed to fetch");
      return ok({});
    });
    renderPage();
    expect(await screen.findByText(/กำลังแสดงผังตัวอย่าง/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^โต๊ะ [A-Z]\d / })).toHaveLength(13);
  });

  it("สมาชิกเห็นการจองของตนเองพร้อมรหัสและโต๊ะ", async () => {
    stubFetch((url, init) => {
      if (url.includes("/api/reservations/mine")) return ok({ reservations: [reservation] });
      return loggedIn(url, init);
    });
    renderPage();
    expect(await screen.findByText("RSV-20260914-AB12")).toBeInTheDocument();
    expect(screen.getByText("รอการยืนยัน")).toBeInTheDocument();
  });

  it("empty state เมื่อยังไม่มีการจอง", async () => {
    stubFetch(loggedIn);
    renderPage();
    expect(await screen.findByText("ยังไม่มีการจอง")).toBeInTheDocument();
  });

  it("error state ของรายการจองพร้อมปุ่มลองใหม่", async () => {
    const user = userEvent.setup();
    let mineCalls = 0;
    stubFetch((url, init) => {
      if (url.includes("/api/reservations/mine")) {
        mineCalls += 1;
        if (mineCalls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
        return ok({ reservations: [] });
      }
      return loggedIn(url, init);
    });
    renderPage();
    expect(await screen.findByText("เซิร์ฟเวอร์ขัดข้อง")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("ยังไม่มีการจอง")).toBeInTheDocument();
  });
});
