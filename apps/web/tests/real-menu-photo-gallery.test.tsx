import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RealMenuPhotoGallery } from "../src/components/RealMenuPhotoGallery";

describe("แกลเลอรีเมนูจากร้านจริง", () => {
  it("แสดงหัวข้อ ภาพแรก และตัวเลือกภาพเมนูจริงครบสี่ภาพ", () => {
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
    expect(screen.getAllByRole("button", { name: /^ดู/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "ดูรายการอาหารตามสั่ง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูเมนูหน้าเคาน์เตอร์" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูเมนูชาและกาแฟ" })).toBeInTheDocument();
    expect(screen.getByText(/ราคาและสถานะพร้อมขายให้ยึดข้อมูลในระบบเป็นหลัก/)).toBeInTheDocument();
  });

  it("เลือกภาพจากชุดเดิมและชุดล่าสุดด้วยคีย์บอร์ดพร้อมโหลดแบบ lazy", async () => {
    const user = userEvent.setup();
    render(<RealMenuPhotoGallery />);

    const second = screen.getByRole("button", { name: "ดูรายการอาหารตามสั่ง" });
    second.focus();
    await user.keyboard("{Enter}");

    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "ป้ายรายการอาหารตามสั่งแบบแนวตั้งของร้านป้าอ้อ" })).toHaveAttribute(
      "src",
      "/venue/reservations/food-menu.jpg",
    );
    expect(screen.getByRole("img", { name: "ป้ายรายการอาหารตามสั่งแบบแนวตั้งของร้านป้าอ้อ" })).toHaveAttribute(
      "loading",
      "lazy",
    );

    const drinks = screen.getByRole("button", { name: "ดูเมนูชาและกาแฟ" });
    drinks.focus();
    await user.keyboard("[Space]");
    expect(drinks).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "ป้ายเมนูชา กาแฟ และเครื่องดื่มของร้านป้าอ้อ" })).toHaveAttribute(
      "src",
      "/venue/reservations/drink-menu.jpg",
    );
  });
});
