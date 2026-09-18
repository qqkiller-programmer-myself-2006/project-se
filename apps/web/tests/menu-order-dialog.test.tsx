import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuOrderDialog } from "../src/components/MenuOrderDialog";
import { CART_QTY_MAX, CART_STORAGE_KEY, addLineToCart, clampQuantity, loadCart } from "../src/lib/cart";
import type { PublicMenuItemWithOptions } from "../src/lib/api";

const ITEM: PublicMenuItemWithOptions = {
  id: "m1",
  category: "ข้าวผัด",
  name: "ข้าวผัดหมู",
  description: "ผัดสดทีละจาน",
  imageUrl: null,
  price: 55,
  kind: "food",
  sortOrder: 2,
  inStock: true,
  optionGroups: [
    // ลำดับใน array สลับกับ sortOrder โดยตั้งใจ — ป๊อปอัปต้องเรียงตาม sortOrder
    {
      id: "og-egg",
      name: "เพิ่มไข่",
      sortOrder: 2,
      options: [
        { id: "egg-fried", name: "เพิ่มไข่ดาว", priceDelta: 10, sortOrder: 2 },
        { id: "egg-none", name: "ไม่เพิ่มไข่", priceDelta: 0, sortOrder: 1 },
        { id: "egg-omelet", name: "เพิ่มไข่เจียว", priceDelta: 10, sortOrder: 3 },
      ],
    },
    {
      id: "og-size",
      name: "ขนาด",
      sortOrder: 1,
      options: [
        { id: "size-regular", name: "ธรรมดา", priceDelta: 0, sortOrder: 1 },
        { id: "size-special", name: "พิเศษ", priceDelta: 15, sortOrder: 2 },
      ],
    },
  ],
};

type SavedLine = { menuId: string; quantity: number; note: string; options: string[] };
const savedCart = (): SavedLine[] => JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]") as SavedLine[];

describe("จำนวนสั่ง: ห้ามติดลบ ห้ามเป็นศูนย์ ห้ามเกินเพดาน (ชั้นตะกร้า)", () => {
  it.each([
    [-5, 1],
    [-1, 1],
    [0, 1],
    [1, 1],
    [3, 3],
    [2.9, 2],
    [0.4, 1],
    [CART_QTY_MAX, CART_QTY_MAX],
    [CART_QTY_MAX + 1, CART_QTY_MAX],
    [999, CART_QTY_MAX],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 1],
    ["7", 7],
    [" 4 ", 4],
    ["-3", 1],
    ["abc", 1],
    ["", 1],
    [null, 1],
    [undefined, 1],
  ])("clampQuantity(%s) → %s", (input, expected) => {
    expect(clampQuantity(input)).toBe(expected);
  });

  it("เรียก addLineToCart ด้วยจำนวนติดลบตรง ๆ ก็ไม่ลดของในตะกร้า", () => {
    const start = addLineToCart([], { menuId: "m1", quantity: 5, options: ["size-regular"] });
    const after = addLineToCart(start, { menuId: "m1", quantity: -10, options: ["size-regular"] });
    // ติดลบถูกดึงเป็น 1 → บวกเพิ่ม 1 ไม่ใช่ลบ 10
    expect(after).toEqual([{ menuId: "m1", quantity: 6, note: "", options: ["size-regular"], specialRequest: "" }]);
    for (const line of after) expect(line.quantity).toBeGreaterThan(0);
  });

  it("บรรทัดเดียวกันรวมจำนวนแต่ไม่เกินเพดาน และหมายเหตุใหม่แทนของเดิม", () => {
    const a = addLineToCart([], { menuId: "m1", quantity: 15, options: ["x"], note: "ไม่ใส่ผัก" });
    const b = addLineToCart(a, { menuId: "m1", quantity: 15, options: ["x"], note: "เผ็ดน้อย" });
    expect(b).toHaveLength(1);
    expect(b[0]!.quantity).toBe(CART_QTY_MAX);
    expect(b[0]!.note).toBe("เผ็ดน้อย");
    // หมายเหตุว่างไม่ลบของเดิม
    const c = addLineToCart(b, { menuId: "m1", quantity: 1, options: ["x"], note: "   " });
    expect(c[0]!.note).toBe("เผ็ดน้อย");
  });

  it("ตัวเลือกต่างกันแยกเป็นคนละบรรทัด", () => {
    const a = addLineToCart([], { menuId: "m1", quantity: 1, options: ["size-regular"] });
    const b = addLineToCart(a, { menuId: "m1", quantity: 2, options: ["size-special"] });
    expect(b).toHaveLength(2);
  });

  it("ค่าที่เก็บไว้เสียหาย (ติดลบ) ถูกทิ้งตอนโหลดตะกร้า", () => {
    const storage = {
      getItem: () => JSON.stringify([{ menuId: "m1", quantity: -2, note: "", options: [], specialRequest: "" }]),
    };
    expect(loadCart(storage)).toEqual([]);
  });
});

describe("ป๊อปอัปสั่งซื้อจากการ์ดเมนู", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderDialog(overrides: Partial<PublicMenuItemWithOptions> = {}) {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<MenuOrderDialog item={{ ...ITEM, ...overrides }} onClose={onClose} onAdded={onAdded} />);
    return { onClose, onAdded };
  }

  it("เปิดมาเป็นป๊อปอัปมีชื่อ โฟกัสที่หัวข้อ และเลือกค่าแรกของทุกกลุ่มไว้ให้", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "ข้าวผัดหมู" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "ข้าวผัดหมู" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: /ธรรมดา/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /ไม่เพิ่มไข่/ })).toBeChecked();
    // เรียงกลุ่มตาม sortOrder: ขนาด มาก่อน เพิ่มไข่
    const legends = screen.getAllByRole("group").map((g) => g.querySelector("legend")?.textContent).filter(Boolean);
    expect(legends).toEqual(["ขนาด", "เพิ่มไข่"]);
    expect(screen.getByLabelText("จำนวนที่สั่ง")).toHaveValue("1");
  });

  it("เลือกพิเศษ + ไข่ดาว × 2 → ยอดรวม (55+15+10)×2 = 160 และลงตะกร้าครบ", async () => {
    const user = userEvent.setup();
    const { onAdded, onClose } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /พิเศษ/ }));
    await user.click(screen.getByRole("radio", { name: /เพิ่มไข่ดาว/ }));
    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวน" }));
    await user.type(screen.getByLabelText("หมายเหตุถึงร้าน (ถ้ามี)"), "ไม่ใส่ผัก");
    expect(screen.getByText("160 บาท")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เพิ่ม 2 ชิ้นลงตะกร้า" }));
    expect(savedCart()).toEqual([
      { menuId: "m1", quantity: 2, note: "ไม่ใส่ผัก", options: ["size-special", "egg-fried"], specialRequest: "" },
    ]);
    expect(onAdded).toHaveBeenCalledWith({ name: "ข้าวผัดหมู", quantity: 2 });
    expect(onClose).toHaveBeenCalled();
  });

  it("ปุ่มลดปิดอยู่ที่ 1 — กดยังไงจำนวนก็ไม่ต่ำกว่า 1", async () => {
    const user = userEvent.setup();
    renderDialog();
    const minus = screen.getByRole("button", { name: "ลดจำนวน" });
    expect(minus).toBeDisabled();
    await user.click(minus);
    expect(screen.getByLabelText("จำนวนที่สั่ง")).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวน" }));
    expect(minus).toBeEnabled();
    await user.click(minus);
    expect(screen.getByLabelText("จำนวนที่สั่ง")).toHaveValue("1");
    expect(minus).toBeDisabled();
  });

  it("ปุ่มเพิ่มปิดที่เพดาน", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("จำนวนที่สั่ง");
    await user.clear(input);
    await user.type(input, "20");
    expect(screen.getByRole("button", { name: "เพิ่มจำนวน" })).toBeDisabled();
  });

  it("พิมพ์เครื่องหมายลบไม่ติด: '-5' กลายเป็น 5 ไม่ใช่ติดลบ", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("จำนวนที่สั่ง");
    await user.clear(input);
    await user.type(input, "-5");
    expect(input).toHaveValue("5");
    await user.click(screen.getByRole("button", { name: "เพิ่ม 5 ชิ้นลงตะกร้า" }));
    expect(savedCart()[0]!.quantity).toBe(5);
  });

  it("พิมพ์ 0 หรือเกินเพดาน ถูกดึงกลับเข้าช่วงเมื่อออกจากช่อง", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("จำนวนที่สั่ง");
    await user.clear(input);
    await user.type(input, "0");
    fireEvent.blur(input);
    expect(input).toHaveValue("1");

    await user.clear(input);
    await user.type(input, "99");
    fireEvent.blur(input);
    expect(input).toHaveValue(String(CART_QTY_MAX));
  });

  it("ลบช่องจำนวนจนว่างแล้วออก → คืนค่าเดิม ไม่ใช่ 0", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("จำนวนที่สั่ง");
    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวน" }));
    await user.clear(input);
    fireEvent.blur(input);
    expect(input).toHaveValue("2");
  });

  it("พิมพ์ตัวอักษร/ทศนิยมไม่ติด", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("จำนวนที่สั่ง");
    await user.clear(input);
    await user.type(input, "3.7abc");
    expect(input).toHaveValue("37".slice(0, 2));
    fireEvent.blur(input);
    expect(input).toHaveValue(String(CART_QTY_MAX));
  });

  it("เมนูวัตถุดิบหมด: ดูได้แต่เพิ่มไม่ได้ ตะกร้าไม่เปลี่ยน", async () => {
    const user = userEvent.setup();
    const { onAdded } = renderDialog({ inStock: false });
    expect(screen.getByText(/วัตถุดิบหมดชั่วคราว/)).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: /ลงตะกร้า/ });
    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(savedCart()).toEqual([]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("Esc / ปุ่มปิด / แตะนอกกรอบ ปิดโดยไม่เพิ่มอะไร", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "ปิดหน้าต่างสั่งซื้อ" }));
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(savedCart()).toEqual([]);
  });

  it("แตะในกรอบไม่ทำให้ปิด", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole("heading", { name: "ข้าวผัดหมู" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("วางใต้กล่องที่มี transform/perspective ก็ยังไปอยู่ที่ body (ไม่ถูกขังตามหน้า)", () => {
    // เลเยอร์ 3D ของหน้าเคยทำให้ position: fixed ยึดกล่องแทนหน้าจอ — ป๊อปอัปไปโผล่ท้ายหน้ายาว ๆ
    render(
      <div style={{ transform: "translateZ(0)", perspective: "1400px", transformStyle: "preserve-3d" }} data-testid="trap">
        <MenuOrderDialog item={ITEM} onClose={() => {}} />
      </div>,
    );
    const overlay = screen.getByRole("dialog").parentElement!;
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByTestId("trap")).not.toContainElement(overlay);
  });

  it("เมนูไม่มีตัวเลือก (เครื่องดื่มบางอย่าง) ยังสั่งได้ด้วยจำนวนอย่างเดียว", async () => {
    const user = userEvent.setup();
    renderDialog({ optionGroups: [] });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "เพิ่ม 1 ชิ้นลงตะกร้า" }));
    expect(savedCart()).toEqual([{ menuId: "m1", quantity: 1, note: "", options: [], specialRequest: "" }]);
  });
});
