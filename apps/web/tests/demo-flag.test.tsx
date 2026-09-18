import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MenuPublicPage from "../src/pages/customer/MenuPublic";
import { PublicShell } from "../src/components/shell";
import {
  DEMO_MODE_LABEL,
  isDemoModeEnabled,
  shouldFallbackToDemo,
} from "../src/lib/demo";

const env = import.meta.env as unknown as Record<string, unknown>;
let saved: Record<string, unknown>;

function setFlag(value: string | undefined) {
  if (value === undefined) delete env["VITE_DEMO_MODE"];
  else env["VITE_DEMO_MODE"] = value;
}

function setDev(value: boolean) {
  env["DEV"] = value;
}

function stubMenuPublic(
  handler: (url: string) => { ok: boolean; status: number; body: unknown },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/menu/public")) {
        const r = handler(u);
        return { ok: r.ok, status: r.status, json: async () => r.body };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function stubMenuPublicThrow(err: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/menu/public")) throw err;
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("VITE_DEMO_MODE dev-only guard", () => {
  beforeEach(() => {
    saved = { ...env };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(env)) {
      if (!(k in saved)) delete env[k];
    }
    Object.assign(env, saved);
  });

  it("ปิดโดยปริยายเมื่อไม่ตั้ง flag", () => {
    setFlag(undefined);
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("เปิดเมื่อ flag=true ใน non-production (test)", () => {
    setFlag("true");
    expect(isDemoModeEnabled()).toBe(true);
  });

  it("flag=false ปิดเสมอ", () => {
    setFlag("false");
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("ไม่เปิดใน production แม้ flag=true (MODE/PROD guard)", () => {
    setFlag("true");
    env["MODE"] = "production";
    env["PROD"] = true;
    env["DEV"] = false;
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("shouldFallbackToDemo: ออฟไลน์จริงเสมอ, error อื่นเฉพาะตอน flag เปิด", () => {
    const offline = new TypeError("Failed to fetch");
    const serverError = new Error("เซิร์ฟเวอร์ขัดข้อง");
    setFlag(undefined);
    expect(shouldFallbackToDemo(offline)).toBe(true);
    expect(shouldFallbackToDemo(serverError)).toBe(false);
    setFlag("true");
    expect(shouldFallbackToDemo(offline)).toBe(true);
    expect(shouldFallbackToDemo(serverError)).toBe(true);
  });
});

describe("DEV-only fallback ของหน้าเมนู (ไม่ใช้ VITE_DEMO_MODE)", () => {
  beforeEach(() => {
    saved = { ...env };
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(env)) {
      if (!(k in saved)) delete env[k];
    }
    Object.assign(env, saved);
  });

  it("DEV=true + API ว่างเปล่า: แสดงข้อมูลตัวอย่างพร้อมป้าย (ไม่ต้องมี flag)", async () => {
    setFlag(undefined);
    setDev(true);
    stubMenuPublic(() => ({ ok: true, status: 200, body: { groups: [] } }));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("production (DEV=false) + API ว่างเปล่า: คง empty state จริง แม้ flag=true", async () => {
    setFlag("true");
    setDev(false);
    stubMenuPublic(() => ({ ok: true, status: 200, body: { groups: [] } }));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีเมนูพร้อมขาย")).toBeInTheDocument();
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });

  it("DEV=true + API 500: แสดง error จริง ไม่กลืนเป็นข้อมูลสาธิต", async () => {
    // 500 = เซิร์ฟเวอร์พัง ต้องเห็นของจริงแม้ใน dev — fallback เฉพาะตอนติดต่อ API ไม่ได้
    setFlag(undefined);
    setDev(true);
    stubMenuPublic(() => ({ ok: false, status: 500, body: { error: "เซิร์ฟเวอร์ขัดข้อง" } }));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });

  it("production (DEV=false) + API 500: แสดง error จริง แม้ flag=true", async () => {
    setFlag("true");
    setDev(false);
    stubMenuPublic(() => ({ ok: false, status: 500, body: { error: "เซิร์ฟเวอร์ขัดข้อง" } }));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });

  it("DEV=true + network failure: fallback สาธิตพร้อมป้าย", async () => {
    setFlag(undefined);
    setDev(true);
    stubMenuPublicThrow(new TypeError("Failed to fetch"));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("DEV=true + HTTP อื่น (400): คง error จริง ไม่ fallback", async () => {
    setFlag(undefined);
    setDev(true);
    stubMenuPublic(() => ({ ok: false, status: 400, body: { error: "คำขอไม่ถูกต้อง" } }));
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("คำขอไม่ถูกต้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });

  it("shell แสดงป้ายสาธิตทั่วทั้งร้านเมื่อ flag=true และซ่อนเมื่อ flag=false", async () => {
    setFlag("true");
    const { unmount } = render(
      <MemoryRouter initialEntries={["/menu"]}>
        <PublicShell>
          <p>เนื้อหา</p>
        </PublicShell>
      </MemoryRouter>,
    );
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
    unmount();
    setFlag(undefined);
    render(
      <MemoryRouter initialEntries={["/menu"]}>
        <PublicShell>
          <p>เนื้อหา</p>
        </PublicShell>
      </MemoryRouter>,
    );
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });
});
