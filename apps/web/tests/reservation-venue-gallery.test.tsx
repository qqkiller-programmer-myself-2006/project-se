import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationVenueGallery } from "../src/components/ReservationVenueGallery";
import ReservationsPage from "../src/pages/customer/Reservations";

describe("แกลเลอรีบรรยากาศร้านสำหรับจองโต๊ะ", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงภาพหลัก คำบรรยาย และตัวเลือกครบ 5 มุม", () => {
    render(<ReservationVenueGallery />);

    expect(screen.getByRole("heading", { name: "ดูบรรยากาศก่อนเลือกโต๊ะ" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "พื้นที่นั่งรับประทานอาหารภายในร้านป้าอ้อ" })).toHaveAttribute(
      "src",
      "/venue/reservations/dining-room.jpg",
    );
    expect(screen.getByText("ภาพที่ 1 จาก 5 · ห้องอาหาร")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^ดู.+ ภาพที่ \d$/ })).toHaveLength(5);
  });

  it("เลือกภาพจากปุ่มและเลื่อนก่อนหน้าหรือถัดไปได้", async () => {
    const user = userEvent.setup();
    render(<ReservationVenueGallery />);

    const drinkMenu = screen.getByRole("button", { name: "ดูเมนูเครื่องดื่ม ภาพที่ 4" });
    await user.click(drinkMenu);
    expect(drinkMenu).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "เมนูเครื่องดื่มที่เคาน์เตอร์ร้านป้าอ้อ" })).toBeInTheDocument();
    expect(screen.getByText("ภาพที่ 4 จาก 5 · เมนูเครื่องดื่ม")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ดูภาพบรรยากาศถัดไป" }));
    expect(screen.getByText("ภาพที่ 5 จาก 5 · เมนูอาหาร")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ดูภาพบรรยากาศก่อนหน้า" }));
    expect(screen.getByText("ภาพที่ 4 จาก 5 · เมนูเครื่องดื่ม")).toBeInTheDocument();
  });

  it("ใช้คีย์บอร์ดเลือกภาพและเลื่อนไปภาพถัดไปได้", async () => {
    const user = userEvent.setup();
    render(<ReservationVenueGallery />);

    const counter = screen.getByRole("button", { name: "ดูเคาน์เตอร์ ภาพที่ 3" });
    counter.focus();
    await user.keyboard("{Enter}");
    expect(counter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("ภาพที่ 3 จาก 5 · เคาน์เตอร์")).toBeInTheDocument();

    const next = screen.getByRole("button", { name: "ดูภาพบรรยากาศถัดไป" });
    next.focus();
    await user.keyboard("[Space]");
    expect(screen.getByText("ภาพที่ 4 จาก 5 · เมนูเครื่องดื่ม")).toBeInTheDocument();
  });

  it("แสดงแกลเลอรีในหน้าจองแม้ลูกค้ายังไม่เข้าสู่ระบบ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthenticated" }),
      })),
    );

    render(
      <MemoryRouter>
        <ReservationsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "ดูบรรยากาศก่อนเลือกโต๊ะ" })).toBeInTheDocument();
    expect(await screen.findByText(/เข้าสู่ระบบบัญชีลูกค้า/)).toBeInTheDocument();
  });
});
