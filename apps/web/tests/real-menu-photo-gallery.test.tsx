import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("เลื่อนภาพอัตโนมัติ", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function activeSrc() {
      return screen.getByRole("figure").querySelector("img")!.getAttribute("src");
    }

    it("เลื่อนไปภาพถัดไปเองตามเวลา และวนกลับภาพแรก", () => {
      vi.useFakeTimers();
      render(<RealMenuPhotoGallery autoPlayMs={5000} />);
      expect(activeSrc()).toBe("/venue/latest/real-menu-board.jpg");
      act(() => void vi.advanceTimersByTime(5000));
      expect(activeSrc()).toBe("/venue/reservations/food-menu.jpg");
      // ตัวจับเวลาตั้งใหม่หลังเปลี่ยนภาพแต่ละครั้ง จึงเดินทีละรอบ
      for (let i = 0; i < 3; i++) act(() => void vi.advanceTimersByTime(5000));
      expect(activeSrc()).toBe("/venue/latest/real-menu-board.jpg");
    });

    it("หยุดเลื่อนเมื่อเมาส์ชี้อยู่ในแกลเลอรี", () => {
      vi.useFakeTimers();
      render(<RealMenuPhotoGallery autoPlayMs={5000} />);
      fireEvent.mouseEnter(screen.getByRole("region", { name: "เมนูจากร้านจริง" }));
      act(() => void vi.advanceTimersByTime(20000));
      expect(activeSrc()).toBe("/venue/latest/real-menu-board.jpg");
    });

    it("ไม่ส่ง autoPlayMs = ไม่เลื่อนเอง", () => {
      vi.useFakeTimers();
      render(<RealMenuPhotoGallery />);
      act(() => void vi.advanceTimersByTime(20000));
      expect(activeSrc()).toBe("/venue/latest/real-menu-board.jpg");
    });
  });
});
