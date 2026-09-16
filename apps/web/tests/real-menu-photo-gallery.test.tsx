import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RealMenuPhotoGallery } from "../src/components/RealMenuPhotoGallery";

describe("แกลเลอรีเมนูจากร้านจริง", () => {
  it("แสดงหัวข้อ ภาพแรก และตัวเลือกภาพเมนูจริงสองภาพ", () => {
    render(<RealMenuPhotoGallery />);

    expect(screen.getByRole("heading", { name: "เมนูจากร้านจริง" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ป้ายรายการอาหารตามสั่งและราคาเพิ่มของร้านป้าอ้อ" })).toHaveAttribute(
      "src",
      "/venue/latest/real-menu-board.jpg",
    );
    expect(screen.getByRole("img", { name: "ป้ายรายการอาหารตามสั่งและราคาเพิ่มของร้านป้าอ้อ" })).toHaveAttribute(
      "loading",
      "eager",
    );
    expect(screen.getAllByRole("button", { name: /^ดู/ })).toHaveLength(2);
    expect(screen.getByText(/ราคาและสถานะพร้อมขายให้ยึดข้อมูลในระบบเป็นหลัก/)).toBeInTheDocument();
  });

  it("เลือกภาพที่สองด้วยคีย์บอร์ดและโหลดแบบ lazy", async () => {
    const user = userEvent.setup();
    render(<RealMenuPhotoGallery />);

    const second = screen.getByRole("button", { name: "ดูเมนูหน้าเคาน์เตอร์" });
    second.focus();
    await user.keyboard("{Enter}");

    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "ป้ายภาพเมนูอาหารเหนือเคาน์เตอร์ครัวร้านป้าอ้อ" })).toHaveAttribute(
      "src",
      "/venue/latest/real-menu-counter.jpg",
    );
    expect(screen.getByRole("img", { name: "ป้ายภาพเมนูอาหารเหนือเคาน์เตอร์ครัวร้านป้าอ้อ" })).toHaveAttribute(
      "loading",
      "lazy",
    );
  });
});
