import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TablesPage from "../src/pages/admin/Tables";
import { isLocalBaseUrl, qrMatrix, resolveSiteBaseUrl, tableOrderUrl } from "../src/lib/tableQr";

/**
 * โดเมนที่หน้าจัดการโต๊ะเห็น — siteBaseUrl() อ่าน import.meta.env แบบที่ Vite แทนค่าตอน build
 * ซึ่งเทสต์เปลี่ยนตอนรันไม่ได้ จึง mock เฉพาะฟังก์ชันนี้ ส่วนอื่นของโมดูลเป็นของจริง
 */
let siteUrl = "https://paor.example";
vi.mock("../src/lib/tableQr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/tableQr")>();
  return { ...actual, siteBaseUrl: () => siteUrl };
});

const TABLES = [
  { id: "0f7c2a1e-7d5b-4c1a-9a3e-1b2c3d4e5f60", name: "A1", capacity: 4, isEnabled: true, zone: "dining", createdAt: "", updatedAt: "" },
  { id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "S4", capacity: 6, isEnabled: true, zone: "sala", createdAt: "", updatedAt: "" },
  { id: "11111111-2222-4333-8444-555555555555", name: "B2", capacity: 2, isEnabled: false, zone: null, createdAt: "", updatedAt: "" },
];

describe("ลิงก์และ QR ของโต๊ะ", () => {
  it("ลิงก์พาไปหน้าแรกพร้อมรหัสโต๊ะ และตัด / ซ้ำท้าย base", () => {
    expect(tableOrderUrl("abc-123", "https://paor.example/")).toBe("https://paor.example/?table=abc-123");
    expect(tableOrderUrl("a b&c", "https://paor.example")).toBe("https://paor.example/?table=a%20b%26c");
  });

  it("ใช้โดเมนที่ตั้งไว้เมื่อเป็น http(s) ไม่งั้นใช้ origin ของหน้า", () => {
    const origin = "http://localhost:5173";
    expect(resolveSiteBaseUrl("https://paor.example/", origin)).toBe("https://paor.example");
    expect(resolveSiteBaseUrl("  http://shop.test//  ", origin)).toBe("http://shop.test");
    expect(resolveSiteBaseUrl("not-a-url", origin)).toBe(origin);
    expect(resolveSiteBaseUrl("ftp://paor.example", origin)).toBe(origin);
    expect(resolveSiteBaseUrl("", origin)).toBe(origin);
    expect(resolveSiteBaseUrl(undefined, origin)).toBe(origin);
  });

  it("แยกได้ว่า base ชี้เครื่องตัวเอง (สแกนจากมือถือแล้วเปิดไม่ได้)", () => {
    expect(isLocalBaseUrl("http://localhost:5173")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:4000")).toBe(true);
    expect(isLocalBaseUrl("https://shop.localhost")).toBe(true);
    expect(isLocalBaseUrl("https://paor.example")).toBe(false);
    expect(isLocalBaseUrl("ไม่ใช่ URL")).toBe(true);
  });

  it("QR มีขนาดตามมาตรฐานและมี finder pattern ครบสามมุม", () => {
    const m = qrMatrix(tableOrderUrl(TABLES[0]!.id, "https://paor.example"));
    const n = m.length;
    // ขนาด QR = 4v + 17 เสมอ
    expect((n - 17) % 4).toBe(0);
    expect(m.every((row) => row.length === n)).toBe(true);
    // finder pattern 7×7: ขอบนอกดำ วงถัดไปขาว แกน 3×3 ดำ
    const finderAt = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          expect(m[r0 + r]![c0 + c], `finder (${r0},${c0}) ช่อง ${r},${c}`).toBe(ring !== 2);
        }
    };
    finderAt(0, 0);
    finderAt(0, n - 7);
    finderAt(n - 7, 0);
  });

  it("ลิงก์ต่างกัน → QR ต่างกัน (ไม่ได้วาดภาพเดิมซ้ำทุกโต๊ะ)", () => {
    const a = qrMatrix(tableOrderUrl(TABLES[0]!.id, "https://paor.example"));
    const b = qrMatrix(tableOrderUrl(TABLES[1]!.id, "https://paor.example"));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("หน้าจัดการโต๊ะ: QR สั่งอาหารที่โต๊ะ (#20)", () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/auth/csrf")) return { ok: true, json: async () => ({ csrfToken: "t" }) };
        if (String(url).includes("/api/tables")) return { ok: true, json: async () => ({ tables: TABLES }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    printSpy = vi.fn();
    window.print = printSpy as unknown as typeof window.print;
  });

  afterEach(() => {
    siteUrl = "https://paor.example";
    document.querySelectorAll(".table-qr-sheet").forEach((el) => el.remove());
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>,
    );
  }

  it("กางดู QR ของโต๊ะได้ทีละโต๊ะ พร้อมลิงก์ที่อยู่ใน QR", async () => {
        const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findAllByRole("button", { name: "QR สั่งอาหาร" });
    await user.click(toggle[0]!);
    expect(screen.getByRole("img", { name: "QR สั่งอาหารโต๊ะ A1" })).toBeInTheDocument();
    expect(screen.getByText(`https://paor.example/?table=${TABLES[0]!.id}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ซ่อน QR" })).toHaveAttribute("aria-expanded", "true");
    // เปิดโต๊ะอื่น → โต๊ะแรกหุบ
    await user.click(screen.getAllByRole("button", { name: "QR สั่งอาหาร" })[0]!);
    expect(screen.queryByRole("img", { name: "QR สั่งอาหารโต๊ะ A1" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR สั่งอาหารโต๊ะ S4" })).toBeInTheDocument();
  });

  it("โต๊ะงดใช้งาน: ดู QR ได้แต่บอกว่าสั่งที่โต๊ะนี้ไม่ได้", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/โต๊ะ B2/);
    const rows = screen.getAllByRole("listitem");
    const b2 = rows.find((r) => within(r).queryByText(/โต๊ะ B2/))!;
    await user.click(within(b2).getByRole("button", { name: "QR สั่งอาหาร" }));
    expect(within(b2).getByText(/งดใช้งานอยู่/)).toBeInTheDocument();
  });

  it("พิมพ์ป้ายเฉพาะโต๊ะที่พร้อมใช้งาน แล้วเอาแผ่นออกหลังปิดหน้าต่างพิมพ์", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      const print = await screen.findByRole("button", { name: "พิมพ์ป้าย QR (2 โต๊ะ)" });
      fireEvent.click(print);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(printSpy).toHaveBeenCalledTimes(1);

      const sheet = document.querySelector(".table-qr-sheet")!;
      // portal เป็นลูกตรงของ body — CSS ตอนพิมพ์ซ่อนทุกอย่างยกเว้นแผ่นนี้
      expect(sheet.parentElement).toBe(document.body);
      const cards = within(sheet as HTMLElement).getAllByRole("img");
      expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["QR สั่งอาหารโต๊ะ A1", "QR สั่งอาหารโต๊ะ S4"]);
      expect(sheet.textContent).not.toContain("B2");

      await act(async () => {
        window.dispatchEvent(new Event("afterprint"));
      });
      expect(document.querySelector(".table-qr-sheet")).toBeNull();
      expect(screen.getByRole("button", { name: "พิมพ์ป้าย QR (2 โต๊ะ)" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("เตือนก่อนพิมพ์ถ้าลิงก์ใน QR ชี้เครื่องตัวเอง", async () => {
    // ไม่ได้ตั้งโดเมน → siteBaseUrl ตกไปใช้ origin ของหน้า
    siteUrl = "http://localhost:5173";
    renderPage();
    expect(await screen.findByText(/ชี้ไปที่เครื่องนี้/)).toHaveTextContent("VITE_PUBLIC_SITE_URL");
    // เป็นคำแนะนำถาวร ไม่ใช่ alert ที่จะแย่งการประกาศ error จริง
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ตั้งโดเมนจริงแล้วไม่มีคำเตือน", async () => {
        renderPage();
    await screen.findByText(/โต๊ะ A1/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
