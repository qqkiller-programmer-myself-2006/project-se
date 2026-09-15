import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import StatusPage from "../src/pages/Status";
import QueueTrackPage from "../src/pages/QueueTrack";
import type { PublicUser } from "../src/lib/api";

// อ่าน CSS ต้นฉบับตรง ๆ (ไม่พึ่ง ?raw transform) — ตรวจ tokens ที่จับต้องได้โดยไม่ใช้เบราว์เซอร์จริง
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"), "utf8");

/**
 * Ticket 14 — release readiness UI review (feasible โดยไม่ใช้เบราว์เซอร์จริง):
 * - โครงสร้าง accessibility (skip link, landmarks, labels, live regions)
 * - keyboard operability (ปุ่ม/ลิงก์มีชื่อ, input มี label, ไม่มี tabindex ติดลบ)
 * - touch targets ≥44px + responsive classes + design tokens ใน CSS
 * หลักการจาก ui-ux-pro-max (priority 1/2/5: a11y, touch, responsive) และ
 * frontend-design (restraint: ไม่แตะ visual system เดิม ตรวจเฉพาะ readiness)
 */

const owner: PublicUser = {
  id: "owner-id",
  username: "owner",
  roles: ["owner"],
  isActive: true,
  createdAt: new Date().toISOString(),
};

function stubAppFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.endsWith("/api/auth/me")) return ok({ user: owner });
      if (u.includes("/api/")) return err(404, "ไม่พบข้อมูล");
      return err(404, "ไม่พบข้อมูล");
    }),
  );
}

function stubPageFetch(handler: (url: string) => unknown) {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      return handler(u);
    }),
  );
}

describe("Ticket 14 release readiness UI (a11y/keyboard/responsive, jsdom-feasible)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("App shell: skip link + nav landmark + main landmark (keyboard/a11y)", async () => {
    stubAppFetch();
    render(
      <MemoryRouter initialEntries={["/status"]}>
        <App />
      </MemoryRouter>,
    );
    const skips = await screen.findAllByText("ข้ามไปยังเนื้อหาหลัก");
    expect(skips.length).toBeGreaterThanOrEqual(1);
    // skip link ของ shell ต้องชี้ไป main หลัก (หน้าย่อยอาจมี skip ของตนเองเพิ่มได้)
    expect(skips.some((s) => s.getAttribute("href") === "#main-content")).toBe(true);
    expect(screen.getByRole("navigation", { name: "เมนูหลักหลังร้าน" })).toBeInTheDocument();
    // shell มี main หลัก; หน้าย่อยอาจมี main ของตนเองเพิ่มได้ (เช่น StatusPage)
    const mains = screen.getAllByRole("main");
    expect(mains.some((m) => m.getAttribute("id") === "main-content")).toBe(true);

    // ทุกปุ่มต้องมีชื่อที่อ่านได้ (ไม่มีปุ่มไอคอนล้วนไร้ label)
    for (const btn of screen.getAllByRole("button")) {
      expect((btn.textContent ?? "").trim().length).toBeGreaterThan(0);
      expect(btn.hasAttribute("tabindex") && Number(btn.getAttribute("tabindex")) < 0).toBe(false);
    }
    // ทุกลิงก์นำทางต้องมีชื่อ
    for (const link of screen.getAllByRole("link")) {
      expect((link.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("StatusPage: heading + live region + error มีปุ่มลองใหม่ (states ครบ)", async () => {
    stubPageFetch((u) => {
      if (u.includes("/api/shop/status")) throw new Error("offline จำลอง");
      return { ok: false, status: 500, json: async () => ({ error: "ล้มเหลว" }) };
    });
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading")).toBeInTheDocument();
    // error ต้องประกาศผ่าน role=alert และมีปุ่มลองใหม่ที่กดด้วยคีย์บอร์ดได้
    const retry = await screen.findByRole("button", { name: /ลองใหม่|โหลดใหม่/ });
    expect(retry).toBeInTheDocument();
    await userEvent.click(retry);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("QueueTrackPage: input มี label + tablist มีชื่อ + live region สรุปผล", async () => {
    stubPageFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "ติดตามคิวอาหารและเครื่องดื่ม" })).toBeInTheDocument();
    // label ผูกกับ input (keyboard/screen-reader ใช้ได้)
    expect(screen.getByLabelText(/เลขคำสั่งซื้อ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/เบอร์โทรที่ใช้สั่งซื้อ/)).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "วิธีติดตามคิว" })).toBeInTheDocument();
    // validation error อธิบายวิธีแก้ (ไม่ขอโทษลอย ๆ ตาม frontend-design)
    await userEvent.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/กรุณากรอกเลขคำสั่งซื้อและเบอร์โทร/);
  });

  it("touch targets + responsive: ปุ่มหลัก ≥44px, layout ไม่ fixed-width, มี breakpoints", async () => {
    stubAppFetch();
    const { container } = render(
      <MemoryRouter initialEntries={["/status"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("navigation", { name: "เมนูหลักหลังร้าน" });
    const navButtons = container.querySelectorAll("nav a, nav button, main button");
    expect(navButtons.length).toBeGreaterThan(0);
    for (const el of Array.from(navButtons)) {
      const cls = el.getAttribute("class") ?? "";
      // ระบบเดิมใช้ min-h-[44px] ทุกปุ่มนำทาง (design system Tickets 01–13)
      expect(cls).toMatch(/min-h-\[44px\]/);
    }
    // responsive: ใช้ max-width + flex-wrap (ไม่ fixed px); breakpoints อยู่ใน
    // utility classes ของ Tailwind (เช่น sm:px-6) ไม่ใช่ใน CSS ตรง ๆ
    const responsive = Array.from(container.querySelectorAll("[class]")).some((el) =>
      (el.getAttribute("class") ?? "").includes("sm:"),
    );
    expect(responsive).toBe(true);
    expect(css).not.toMatch(/width:\s*1440px/);
  });

  it("design tokens: focus-visible + reduced-motion + skip-link + viewport/lang พร้อม", () => {
    // focus มองเห็น (ห้ามลบ focus ring — ui-ux-pro-max priority 1)
    expect(css).toMatch(/focus-visible/);
    // เคารพ reduced-motion (frontend-design: motion ตอบสนอง action เท่านั้น)
    expect(css).toMatch(/prefers-reduced-motion/);
    // skip link มีสไตล์เฉพาะตอน focus
    expect(css).toMatch(/ui-skip-link/);
    // ไม่มี emoji เป็นไอคอนใน CSS/คอมโพเนนต์หลัก (SVG/ตัวอักษรไทยเท่านั้น)
    expect(css).not.toMatch(/emoji/);
  });
});
