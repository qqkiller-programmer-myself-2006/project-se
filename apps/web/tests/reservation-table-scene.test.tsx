import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReservationTableScene } from "../src/components/ReservationTableScene";
import type { TableAvailability } from "../src/lib/api";

const tables: TableAvailability[] = [
  { id: "t-f1", name: "F1", capacity: 4, zone: "front", status: "available" },
  { id: "t-f2", name: "F2", capacity: 4, zone: "front", status: "booked" },
  { id: "t-d1", name: "D1", capacity: 2, zone: "dining", status: "too_small" },
  { id: "t-d2", name: "D2", capacity: 4, zone: "dining", status: "available" },
  { id: "t-x1", name: "X1", capacity: 6, zone: null, status: "available" },
];

function Harness({ onSelect = () => {} }: { onSelect?: (id: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ReservationTableScene
      tables={tables}
      recommendedTableId="t-d2"
      partySize={3}
      selectedTableId={selected}
      onSelectTable={(id) => {
        setSelected(id);
        onSelect(id);
      }}
    />
  );
}

describe("ขั้นเลือกโซนและโต๊ะ", () => {
  it("การ์ดโซนบอกจำนวนโต๊ะว่าง และรายการโต๊ะบอกสถานะชัดเจน", async () => {
    render(<Harness />);
    const zones = screen.getByRole("group", { name: "เลือกโซนที่นั่ง" });
    expect(screen.getByRole("button", { name: /ดูทั้งร้าน · ว่าง 3 จาก 5 โต๊ะ/ })).toHaveAttribute("aria-pressed", "true");
    // การ์ดโซนแสดงรูปจริงของแต่ละโซน
    expect(zones.querySelectorAll("img")).toHaveLength(4);
    // ภาพรวมยังไม่แสดงรูปเทียบ
    expect(screen.queryByText("รูปจริง")).not.toBeInTheDocument();
    expect(within(zones).getByRole("button", { name: "โซนหน้าร้าน (ใต้กันสาด) ว่าง 1/2 โต๊ะ" })).toBeInTheDocument();
    expect(within(zones).getByRole("button", { name: "โซนห้องอาหาร ว่าง 1/2 โต๊ะ" })).toBeInTheDocument();
    expect(within(zones).getByRole("button", { name: "โซนศาลากลางแจ้ง ไม่มีโต๊ะ" })).toBeInTheDocument();

    const list = screen.getByRole("group", { name: "เลือกโต๊ะสำหรับ 3 คน" });
    expect(within(list).getAllByRole("button")).toHaveLength(5);
    expect(within(list).getByRole("button", { name: /โต๊ะ F2 .*สถานะจองแล้ว/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(list).getByRole("button", { name: /โต๊ะ D1 .*ไม่พอสำหรับ 3 คน/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(list).getByRole("button", { name: /โต๊ะ D2 .*ระบบแนะนำ/ })).toBeInTheDocument();
    expect(within(list).getByRole("region", { name: "โซนอื่น ๆ" })).toBeInTheDocument();

    // jsdom ไม่มี WebGL → แสดงข้อความสำรองแทนโมเดล
    expect(await screen.findByText(/อุปกรณ์นี้แสดงโมเดลสามมิติไม่ได้/)).toBeInTheDocument();
  });

  it("กดโซนแล้วเหลือเฉพาะโต๊ะในโซนนั้น", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^โซนห้องอาหาร/ }));
    expect(screen.getByRole("button", { name: /^โซนห้องอาหาร/ })).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("group", { name: "เลือกโต๊ะสำหรับ 3 คน" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("D1"),
      expect.stringContaining("D2"),
    ]);
    expect(screen.getByText(/ห้องอาหารในร้าน/)).toBeInTheDocument();
  });

  it("เลือก/ยกเลิกโต๊ะว่างได้ทั้งคลิกและคีย์บอร์ด แต่โต๊ะไม่ว่างเลือกไม่ได้", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const f1 = screen.getByRole("button", { name: /โต๊ะ F1 / });
    await user.click(f1);
    expect(onSelect).toHaveBeenLastCalledWith("t-f1");
    expect(screen.getByRole("button", { name: /โต๊ะ F1 / })).toHaveAttribute("aria-pressed", "true");
    // เลือกแล้วกล้องพาไปที่โซนของโต๊ะ
    expect(screen.getByRole("button", { name: /^โซนหน้าร้าน/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /โต๊ะ F1 / }));
    expect(onSelect).toHaveBeenLastCalledWith(null);

    const booked = screen.getByRole("button", { name: /โต๊ะ F2 / });
    booked.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);

    const f1Again = screen.getByRole("button", { name: /โต๊ะ F1 / });
    f1Again.focus();
    await user.keyboard("[Space]");
    expect(onSelect).toHaveBeenLastCalledWith("t-f1");
  });

  it("ปุ่มให้ระบบเลือกให้เลือกโต๊ะที่แนะนำ", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /ให้ระบบเลือกให้: โต๊ะ D2/ }));
    expect(onSelect).toHaveBeenLastCalledWith("t-d2");
    expect(screen.queryByRole("button", { name: /ให้ระบบเลือกให้/ })).not.toBeInTheDocument();
  });

  it("ระหว่างโหลดบอกสถานะกำลังตรวจสอบ", () => {
    render(
      <ReservationTableScene tables={[]} recommendedTableId={null} partySize={2} selectedTableId={null} onSelectTable={() => {}} loading />,
    );
    expect(screen.getByText("กำลังตรวจสอบโต๊ะว่าง…")).toBeInTheDocument();
  });
  it("เปิดโซนแล้วเห็นรูปจริงขนาดใหญ่คู่กับแบบจำลอง เปลี่ยนรูปได้ และขยายเต็มจอได้", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^โซนหน้าร้าน/ }));
    expect(screen.getByText("รูปจริง")).toBeInTheDocument();
    expect(screen.getByText("แบบจำลอง 3 มิติ")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /มองจากในร้านออกไปหน้าร้าน/ })).toHaveAttribute(
      "src",
      "/venue/reservations/storefront-seating.jpg",
    );

    const thumbs = screen.getByRole("group", { name: "รูปอื่นในโซนหน้าร้าน (ใต้กันสาด)" });
    await user.click(within(thumbs).getByRole("button", { name: /เคาน์เตอร์ชาใต้ข้างทางเข้า/ }));
    expect(within(thumbs).getByRole("button", { name: /เคาน์เตอร์ชาใต้ข้างทางเข้า/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/รูป 2\/3/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^ขยายรูป เคาน์เตอร์ชาใต้/ }));
    const dialog = screen.getByRole("dialog", { name: /รูปจริง: เคาน์เตอร์ชาใต้/ });
    expect(within(dialog).getByRole("button", { name: "ปิดรูป" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: /รูปจริง: เมนูเครื่องดื่ม/ })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "รูปถัดไป" }));
    expect(screen.getByRole("dialog", { name: /มองจากในร้านออกไปหน้าร้าน/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ขยายรูป มองจากในร้าน/ })).toHaveFocus();

    // กลับไปดูทั้งร้าน รูปเทียบหายไป
    await user.click(screen.getByRole("button", { name: /ดูทั้งร้าน/ }));
    expect(screen.queryByText("รูปจริง")).not.toBeInTheDocument();
  });
});
