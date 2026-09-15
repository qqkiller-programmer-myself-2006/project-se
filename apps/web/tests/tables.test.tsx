import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TablesPage from "../src/pages/admin/Tables";

const tables = [
  { id: "1", name: "A1", capacity: 4, isEnabled: true, createdAt: "", updatedAt: "" },
  { id: "2", name: "B2", capacity: 2, isEnabled: false, createdAt: "", updatedAt: "" },
];

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

describe("หน้าจัดการโต๊ะ (Owner/Admin)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงรายการโต๊ะพร้อม badge สถานะภาษาไทย", async () => {
    stubFetch((url) => {
      if (url.includes("/api/tables")) return { ok: true, json: async () => ({ tables }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/โต๊ะ A1/)).toBeInTheDocument();
    expect(screen.getAllByText("พร้อมใช้งาน").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("งดใช้งาน").length).toBeGreaterThanOrEqual(1);
  });

  it("empty state เมื่อยังไม่มีโต๊ะ", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ tables: [] }) }));
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีโต๊ะ")).toBeInTheDocument();
  });

  it("error state เมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "โหลดข้อมูลโต๊ะไม่สำเร็จ" }) }));
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    // error อาจมาตอน refresh ครั้งแรก
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดข้อมูลโต๊ะไม่สำเร็จ");
  });

  it("เพิ่มโต๊ะสำเร็จแสดงข้อความสำเร็จ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/tables") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => ({ table: tables[0] }) };
      return { ok: true, json: async () => ({ tables }) };
    });
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/โต๊ะ A1/);
    await user.type(screen.getByLabelText(/ชื่อโต๊ะ/), "C3");
    await user.clear(screen.getByLabelText(/ความจุ/));
    await user.type(screen.getByLabelText(/ความจุ/), "6");
    await user.click(screen.getByRole("button", { name: "เพิ่มโต๊ะ" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/เพิ่มโต๊ะ/);
  });

  it("กรอกความจุผิดแสดง validation ภาษาไทยโดยไม่เรียก API", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return { ok: true, json: async () => ({ tables }) };
    });
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/โต๊ะ A1/);
    await user.type(screen.getByLabelText(/ชื่อโต๊ะ/), "C3");
    await user.clear(screen.getByLabelText(/ความจุ/));
    await user.type(screen.getByLabelText(/ความจุ/), "0");
    await user.click(screen.getByRole("button", { name: "เพิ่มโต๊ะ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("1–50");
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(0);
  });

  it("งดใช้งาน/เปิดใช้งานสำเร็จแสดงข้อความ และไม่มีปุ่มลบ", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/tables/") && init?.method === "PATCH")
        return { ok: true, json: async () => ({ table: { ...tables[0], isEnabled: false } }) };
      return { ok: true, json: async () => ({ tables }) };
    });
    render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/โต๊ะ A1/);
    expect(screen.queryByRole("button", { name: "ลบ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลบโต๊ะ" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "งดใช้งาน" })[0]!);
    expect(await screen.findByRole("status")).toHaveTextContent(/งดใช้งานโต๊ะ/);
  });
});
