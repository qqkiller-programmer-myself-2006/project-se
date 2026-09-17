import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationVenueGallery } from "../src/components/ReservationVenueGallery";
import { venueZones } from "../src/components/venueModel";
import ReservationsPage from "../src/pages/customer/Reservations";

const allPhotos = venueZones.flatMap((zone) => zone.photos);

describe("แกลเลอรีรูปตำแหน่งโต๊ะในหน้าจอง", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("แสดงเฉพาะรูปตำแหน่งโต๊ะของทุกโซน ไม่มีรูปเมนูหรือลานจอดรถ", () => {
    const { container } = render(<ReservationVenueGallery />);

    expect(screen.getByRole("heading", { name: "ดูตำแหน่งโต๊ะก่อนจอง" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: allPhotos[0]!.alt })).toHaveAttribute("src", "/venue/site/front-dining-view.jpg");
    expect(screen.getByText(`ภาพที่ 1 จาก ${allPhotos.length} · โซน 1 หน้าร้าน`)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^ดูโซน .+ ภาพที่ \d+$/ })).toHaveLength(allPhotos.length);
    for (const photo of allPhotos) {
      expect(container.querySelector(`img[src="${photo.src}"]`)).toBeInTheDocument();
    }
    for (const src of [
      "/venue/reservations/drink-menu.jpg",
      "/venue/reservations/food-menu.jpg",
      "/venue/latest/real-menu-board.jpg",
      "/venue/latest/real-menu-counter.jpg",
      "/venue/site/parking-lot.jpg",
    ]) {
      expect(container.querySelector(`img[src="${src}"]`)).not.toBeInTheDocument();
    }
  });

  it("เลือกภาพจากปุ่มและเลื่อนก่อนหน้าหรือถัดไปได้", async () => {
    const user = userEvent.setup();
    render(<ReservationVenueGallery />);
    const total = allPhotos.length;

    const dining = screen.getByRole("button", { name: "ดูโซน 2 ห้องอาหาร ภาพที่ 5" });
    await user.click(dining);
    expect(dining).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /ห้องอาหารของร้านป้าอ้อ/ })).toHaveAttribute("src", "/venue/reservations/dining-room.jpg");
    expect(screen.getByText(`ภาพที่ 5 จาก ${total} · โซน 2 ห้องอาหาร`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ดูรูปตำแหน่งโต๊ะถัดไป" }));
    expect(screen.getByText(`ภาพที่ 6 จาก ${total} · โซน 3 บาร์หน้าครัว`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ดูรูปตำแหน่งโต๊ะก่อนหน้า" }));
    expect(screen.getByText(`ภาพที่ 5 จาก ${total} · โซน 2 ห้องอาหาร`)).toBeInTheDocument();
  });

  it("ใช้คีย์บอร์ดเลือกภาพและวนจากภาพสุดท้ายกลับภาพแรกได้", async () => {
    const user = userEvent.setup();
    render(<ReservationVenueGallery />);
    const total = allPhotos.length;

    const last = screen.getByRole("button", { name: `ดูโซน 4 ศาลา ภาพที่ ${total}` });
    last.focus();
    await user.keyboard("{Enter}");
    expect(last).toHaveAttribute("aria-pressed", "true");

    const next = screen.getByRole("button", { name: "ดูรูปตำแหน่งโต๊ะถัดไป" });
    next.focus();
    await user.keyboard("[Space]");
    expect(screen.getByText(`ภาพที่ 1 จาก ${total} · โซน 1 หน้าร้าน`)).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "ดูตำแหน่งโต๊ะก่อนจอง" })).toBeInTheDocument();
    expect(await screen.findByText(/เข้าสู่ระบบบัญชีลูกค้า/)).toBeInTheDocument();
  });
});
