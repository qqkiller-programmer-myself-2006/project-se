import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuItemImage } from "../src/components/MenuItemImage";

describe("รูปเมนูพร้อมภาพสำรอง", () => {
  it("มี URL ก็แสดงรูปพร้อม alt ภาษาไทย", () => {
    render(<MenuItemImage src="/food-menu/01-kai-ob-sauce.png" name="ไก่อบซอส" className="h-40 w-full" />);
    const img = screen.getByAltText("รูปไก่อบซอส");
    expect(img).toHaveAttribute("src", "/food-menu/01-kai-ob-sauce.png");
    // คลาสขนาดต้องไปอยู่บนรูปจริง ไม่งั้นการ์ดจะกระโดดตอนสลับเป็นภาพสำรอง
    expect(img).toHaveClass("h-40", "w-full");
  });

  it("ไม่มี URL เลยก็ยังเต็มกรอบ ไม่ใช่ที่ว่าง", () => {
    render(<MenuItemImage src={null} name="ข้าวผัดหมู" className="h-40 w-full" />);
    const fallback = screen.getByRole("img", { name: "ข้าวผัดหมู — ยังไม่มีรูปเมนู" });
    expect(fallback).toHaveClass("h-40", "w-full");
    expect(screen.queryByAltText("รูปข้าวผัดหมู")).not.toBeInTheDocument();
  });

  it("รูปโหลดไม่ได้ (เช่น URL ชี้โดเมนที่ไม่มีจริง) ตกไปเป็นภาพสำรอง ไม่ใช่หายไปเฉย ๆ", () => {
    render(<MenuItemImage src="https://example.com/venue/site/pa-or-menu-hero.png" name="กะเพราหมูสับ" />);
    fireEvent.error(screen.getByAltText("รูปกะเพราหมูสับ"));
    expect(screen.getByRole("img", { name: "กะเพราหมูสับ — ยังไม่มีรูปเมนู" })).toBeInTheDocument();
    expect(screen.queryByAltText("รูปกะเพราหมูสับ")).not.toBeInTheDocument();
  });
});
