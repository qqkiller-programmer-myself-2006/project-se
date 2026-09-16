import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReservationTableScene } from "../src/components/ReservationTableScene";

describe("แบบจำลองโต๊ะสามมิติสำหรับการจอง", () => {
  it("แสดงหัวข้อ คำชี้แจง สถานะ และโต๊ะครบ 7 โต๊ะ", () => {
    render(<ReservationTableScene partySize={4} recommendedTableId="table-b2" />);

    expect(screen.getByRole("heading", { name: "แบบจำลองโต๊ะภายในร้าน" })).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช่ผังที่วัดตามขนาดจริง/)).toBeInTheDocument();
    expect(screen.getByText("กำลังดูโต๊ะสำหรับ 4 คน")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /รองรับ \d+ คน/ })).toHaveLength(7);
    expect(screen.getByRole("button", { name: /B2.+โต๊ะที่ระบบแนะนำ/ })).toBeInTheDocument();
    expect(screen.getByLabelText("คำอธิบายสถานะโต๊ะ")).toHaveTextContent("ว่าง");
    expect(screen.getByLabelText("คำอธิบายสถานะโต๊ะ")).toHaveTextContent("ไม่ว่าง");
    expect(screen.getByLabelText("คำอธิบายสถานะโต๊ะ")).toHaveTextContent("เลือกอยู่");
  });

  it("คลิกเลือกโต๊ะแล้วแสดงสรุปและ aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ReservationTableScene partySize="4" />);

    const table = screen.getByRole("button", { name: /B1 โซนกลางร้าน/ });
    expect(table).toHaveAttribute("aria-pressed", "false");
    await user.click(table);

    expect(table).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("ความต้องการโต๊ะ: B1")).toBeInTheDocument();
    expect(screen.getByText(/ระบบยังเป็นผู้จัดโต๊ะจริงตามข้อมูลว่าง/)).toBeInTheDocument();
  });

  it("ใช้ Enter และ Space เลือกโต๊ะผ่านคีย์บอร์ดได้", async () => {
    const user = userEvent.setup();
    render(<ReservationTableScene partySize={2} />);

    const first = screen.getByRole("button", { name: /A1 โซนหน้าร้าน/ });
    first.focus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-pressed", "true");

    const second = screen.getByRole("button", { name: /B2 โซนกลางร้าน/ });
    second.focus();
    await user.keyboard("[Space]");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });

  it("โต๊ะไม่ว่างยังโฟกัสเพื่ออ่านสถานะได้แต่เลือกไม่ได้", async () => {
    const user = userEvent.setup();
    render(<ReservationTableScene partySize={2} />);

    const occupied = screen.getByRole("button", { name: /A2.+สถานะไม่ว่าง/ });
    expect(occupied).toHaveAttribute("aria-disabled", "true");
    occupied.focus();
    await user.keyboard("{Enter}");
    expect(occupied).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("เลือกโต๊ะในแบบจำลองเพื่อดูโซนและจำนวนที่นั่ง")).toBeInTheDocument();
  });

  it("ส่ง table id ผ่าน callback เมื่อเลือกและส่ง null เมื่อกดยกเลิกการเลือก", async () => {
    const user = userEvent.setup();
    const onSelectTable = vi.fn();
    render(<ReservationTableScene partySize={4} onSelectTable={onSelectTable} />);

    const table = screen.getByRole("button", { name: /B1 โซนกลางร้าน/ });
    await user.click(table);
    expect(onSelectTable).toHaveBeenLastCalledWith("table-b1");

    await user.click(table);
    expect(onSelectTable).toHaveBeenLastCalledWith(null);
  });
});
