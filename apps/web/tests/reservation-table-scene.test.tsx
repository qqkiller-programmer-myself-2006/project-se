import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReservationTableScene } from "../src/components/ReservationTableScene";
import type { TableAvailability } from "../src/lib/api";

const tables: TableAvailability[] = [
  { id: "t-f1", name: "F1", capacity: 4, zone: "front", status: "available" },
  { id: "t-d1", name: "D1", capacity: 2, zone: "dining", status: "too_small" },
  { id: "t-d3", name: "D3", capacity: 4, zone: "dining", status: "booked" },
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


function section(name: RegExp | string) {
  return screen.getByRole("region", { name });
}

describe("ขั้นเลือกโซนและโต๊ะ (หนึ่งโซนต่อหนึ่งส่วน)", () => {
  it("มีผังร้าน ปุ่มไปที่โซน และแยกส่วนละโซนพร้อมจำนวนโต๊ะว่าง", async () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "ผังร้าน" })).toBeInTheDocument();
    expect(screen.getByText("ว่าง 3 จาก 5 โต๊ะ")).toBeInTheDocument();

    const jump = screen.getByRole("navigation", { name: "ไปที่โซน" });
    expect(within(jump).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "ไปที่โซนหน้าร้าน (ใต้กันสาด) ว่าง 1/1 โต๊ะ",
      "ไปที่โซนห้องอาหาร ว่าง 1/3 โต๊ะ",
      "ไปที่โซนบาร์หน้าครัว ไม่มีโต๊ะ",
      "ไปที่โซนศาลากลางแจ้ง ไม่มีโต๊ะ",
    ]);
    expect(within(jump).getAllByRole("button")[0]).toHaveTextContent("1หน้าร้านว่าง 1/1 โต๊ะ");

    // ส่วนละหนึ่งโซน + โซนอื่น ๆ สำหรับโต๊ะที่ยังไม่กำหนดโซน
    const regions = within(screen.getByRole("group", { name: "เลือกโต๊ะสำหรับ 3 คน" })).getAllByRole("region");
    expect(regions.map((r) => r.id)).toEqual([
      "zone-section-front",
      "zone-section-dining",
      "zone-section-kitchen",
      "zone-section-sala",
      "zone-section-other",
    ]);

    const front = section("โซนหน้าร้าน (ใต้กันสาด)");
    expect(within(front).getByText("ติดทางเข้า")).toBeInTheDocument();
    expect(within(front).getByRole("img", { name: /โต๊ะไม้ท็อปส้มขาดำหน้าร้าน/ })).toHaveAttribute(
      "src",
      "/venue/site/front-dining-view.jpg",
    );
    expect(within(front).getByRole("button", { name: "ภาพรวมโซน" })).toHaveAttribute("aria-pressed", "true");
    const frontTables = within(front).getByRole("list", { name: "โต๊ะในโซนหน้าร้าน (ใต้กันสาด)" });
    expect(within(frontTables).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("F1")]);

    const dining = section("โซนห้องอาหาร");
    expect(within(dining).getByText("บาร์น้ำ ชาใต้")).toBeInTheDocument();
    expect(within(dining).getByText("ห้องน้ำ")).toBeInTheDocument();
    expect(within(dining).getByRole("button", { name: /โต๊ะ D1 .*ไม่พอสำหรับ 3 คน/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(dining).getByRole("button", { name: /โต๊ะ D3 .*สถานะจองแล้ว/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(dining).getByRole("button", { name: /โต๊ะ D2 .*ระบบแนะนำ/ })).toBeInTheDocument();

    expect(within(section("โซนบาร์หน้าครัว")).getByText("โซนนี้ยังไม่มีโต๊ะให้จอง ลองดูโซนอื่น")).toBeInTheDocument();
    expect(within(section("โซนศาลากลางแจ้ง")).getByText("น้ำแข็ง · แก้วน้ำ")).toBeInTheDocument();
    expect(within(section("โซนอื่น ๆ")).getByRole("button", { name: /โต๊ะ X1 / })).toBeInTheDocument();

    // jsdom ไม่มี WebGL → ทุกโซนแสดงข้อความสำรองแทนโมเดล
    expect(await screen.findAllByText(/อุปกรณ์นี้แสดงโมเดลสามมิติไม่ได้/)).toHaveLength(4);
  });

  it("ปุ่มไปที่โซนเลื่อนหน้าไปยังส่วนของโซนนั้น", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Harness />);
    await user.click(
      within(screen.getByRole("navigation", { name: "ไปที่โซน" })).getByRole("button", { name: /โซนศาลากลางแจ้ง/ }),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("zone-section-sala"));
    expect(screen.getByRole("heading", { name: "โซนศาลากลางแจ้ง" })).toHaveFocus();
  });

  it("เลือก/ยกเลิกโต๊ะว่างได้ทั้งคลิกและคีย์บอร์ด แต่โต๊ะไม่ว่างเลือกไม่ได้", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /โต๊ะ F1 / }));
    expect(onSelect).toHaveBeenLastCalledWith("t-f1");
    expect(screen.getByRole("button", { name: /โต๊ะ F1 / })).toHaveAttribute("aria-pressed", "true");
    // ส่วนของโซนที่มีโต๊ะที่เลือกถูกเน้น
    expect(document.getElementById("zone-section-front")).toHaveClass("has-selection");

    await user.click(screen.getByRole("button", { name: /โต๊ะ F1 / }));
    expect(onSelect).toHaveBeenLastCalledWith(null);

    const booked = screen.getByRole("button", { name: /โต๊ะ D3 / });
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
    expect(document.getElementById("zone-section-dining")).toHaveClass("has-selection");
  });

  it("ระหว่างโหลดบอกสถานะกำลังตรวจสอบ", () => {
    render(
      <ReservationTableScene tables={[]} recommendedTableId={null} partySize={2} selectedTableId={null} onSelectTable={() => {}} loading />,
    );
    expect(screen.getByText("กำลังตรวจสอบโต๊ะว่าง…")).toBeInTheDocument();
    expect(screen.getAllByText("กำลังตรวจ…")).not.toHaveLength(0);
  });

  it("แต่ละโซนมีรูปจริงขนาดใหญ่ เปลี่ยนรูปได้ และขยายเต็มจอได้", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const kitchen = section("โซนบาร์หน้าครัว");
    expect(within(kitchen).getByText("รูปจริง")).toBeInTheDocument();
    expect(within(kitchen).getByText("แบบจำลอง 3 มิติ")).toBeInTheDocument();

    const thumbs = within(kitchen).getByRole("group", { name: "รูปอื่นในโซนบาร์หน้าครัว" });
    await user.click(within(thumbs).getByRole("button", { name: /บาร์ริมหน้าต่าง นั่งมองถนน/ }));
    expect(within(thumbs).getByRole("button", { name: /บาร์ริมหน้าต่าง นั่งมองถนน/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(kitchen).getByText(/รูป 2\/3/)).toBeInTheDocument();
    // เลือกรูปแล้วโมเดลหมุนไปมุมของรูป (ไม่ใช่ภาพรวมแล้ว) · กดภาพรวมโซนเพื่อกลับ
    expect(within(kitchen).getByRole("button", { name: "ภาพรวมโซน" })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(kitchen).getByRole("button", { name: "ภาพรวมโซน" }));
    expect(within(kitchen).getByRole("button", { name: "ภาพรวมโซน" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(kitchen).getByRole("button", { name: /^ขยายรูป บาร์ริมหน้าต่าง นั่งมองถนน/ }));
    const dialog = screen.getByRole("dialog", { name: /รูปจริง: บาร์ริมหน้าต่าง นั่งมองถนน/ });
    expect(within(dialog).getByRole("button", { name: "ปิดรูป" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: /รูปจริง: บาร์ริมหน้าต่าง \(ซ้าย\)/ })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "รูปก่อนหน้า" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "รูปก่อนหน้า" }));
    expect(screen.getByRole("dialog", { name: /ซุ้มครัว \(ซ้าย\) และโต๊ะพับ/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: /^ขยายรูป ซุ้มครัว \(ซ้าย\)/ })).toHaveFocus();
    // รูปของโซนอื่นไม่เปลี่ยนตาม
    expect(within(section("โซนหน้าร้าน (ใต้กันสาด)")).getByRole("button", { name: /^ขยายรูป โต๊ะหน้าร้านติดประตู/ })).toBeInTheDocument();
  });
});
