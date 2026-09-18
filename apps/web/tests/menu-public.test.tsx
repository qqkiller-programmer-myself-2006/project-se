import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MenuPublicPage from "../src/pages/customer/MenuPublic";
import { DEMO_MENU_GROUPS, DEMO_MODE_LABEL } from "../src/lib/demo";

const groups = [
  {
    category: "อาหารจานเดียว",
    items: [
      {
        id: "1",
        category: "อาหารจานเดียว",
        name: "ข้าวผัดป้าอ้อ",
        description: "ข้าวผัดหอม ๆ",
        imageUrl: "https://example.com/khao-phad.jpg",
        price: 50,
        kind: "food",
        sortOrder: 0,
      },
    ],
  },
  {
    category: "เครื่องดื่ม",
    items: [
      {
        id: "2",
        category: "เครื่องดื่ม",
        name: "ชาเย็น",
        description: null,
        imageUrl: null,
        price: 25,
        kind: "drink",
        sortOrder: 0,
      },
    ],
  },
];

const EXPECTED_CATEGORIES = ["ชาและโกโก้", "นม", "โซดา", "กาแฟและมัทฉะ"] as const;

const EXPECTED_ITEMS: { category: string; name: string; price: number; stem: string }[] = [
  { category: "ชาและโกโก้", name: "ชาใต้", price: 29, stem: "cha-tai" },
  { category: "ชาและโกโก้", name: "ชาเขียว", price: 29, stem: "green-tea" },
  { category: "ชาและโกโก้", name: "ชามะนาว", price: 29, stem: "lemon-tea" },
  { category: "ชาและโกโก้", name: "ชาเขียวมะนาว", price: 29, stem: "green-lemon-tea" },
  { category: "ชาและโกโก้", name: "ชาดำเย็น", price: 19, stem: "black-tea" },
  { category: "ชาและโกโก้", name: "โกโก้", price: 29, stem: "cocoa" },
  { category: "นม", name: "นมสดน้ำผึ้ง", price: 29, stem: "honey-milk" },
  { category: "นม", name: "นมสดคาราเมล", price: 29, stem: "caramel-milk" },
  { category: "นม", name: "นมชมพู", price: 29, stem: "pink-milk" },
  { category: "นม", name: "นมสด", price: 29, stem: "fresh-milk" },
  { category: "โซดา", name: "น้ำผึ้งมะนาวโซดา", price: 29, stem: "honey-lemon-soda" },
  { category: "โซดา", name: "แดงมะนาวโซดา", price: 29, stem: "red-lemon-soda" },
  { category: "โซดา", name: "แดงโซดา", price: 19, stem: "red-soda" },
  { category: "กาแฟและมัทฉะ", name: "เอสเพรสโซ่", price: 39, stem: "espresso" },
  { category: "กาแฟและมัทฉะ", name: "ลาเต้", price: 39, stem: "latte" },
  { category: "กาแฟและมัทฉะ", name: "คาปูชิโน่", price: 39, stem: "cappuccino" },
  { category: "กาแฟและมัทฉะ", name: "มอคค่า", price: 39, stem: "mocha" },
  { category: "กาแฟและมัทฉะ", name: "มัจฉะลาเต้", price: 49, stem: "matcha-latte" },
];

const EXPECTED_STEMS = EXPECTED_ITEMS.map((e) => e.stem).sort();

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/csrf"))
        return { ok: true, json: async () => ({ csrfToken: "t" }) };
      return handler(String(url), init);
    }),
  );
}

function allDemoItems() {
  return DEMO_MENU_GROUPS.flatMap((g) => g.items.map((item) => ({ group: g.category, item })));
}

const testEnv = import.meta.env as unknown as Record<string, unknown>;
let savedEnv: Record<string, unknown>;

function setDev(value: boolean) {
  testEnv["DEV"] = value;
}

describe("หน้าเมนูสาธารณะ (Ticket 04)", () => {
  beforeEach(() => {
    savedEnv = { ...testEnv };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(testEnv)) {
      if (!(k in savedEnv)) delete testEnv[k];
    }
    Object.assign(testEnv, savedEnv);
  });

  it("แสดงเมนูแยกหมวด พร้อมชื่อ รายละเอียด รูป ราคา ประเภท (ค่าเริ่มต้นเห็นทั้งหมด)", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    // ร้านอาหารตามสั่ง: เปิดหน้ามาต้องเห็นทั้งอาหารและเครื่องดื่ม
    expect(screen.getByLabelText("ประเภท")).toHaveValue("");
    expect(await screen.findByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    // เลือกเครื่องดื่ม: อาหารหายไป
    await user.selectOptions(screen.getByLabelText("ประเภท"), "drink");
    expect(screen.queryByText("ข้าวผัดป้าอ้อ")).not.toBeInTheDocument();
    // กลับเป็นทั้งหมด
    await user.selectOptions(screen.getByLabelText("ประเภท"), "");
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดหอม ๆ")).toBeInTheDocument();
    expect(screen.getByText(/50 บาท/)).toBeInTheDocument();
    expect(screen.getAllByText("อาหาร").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("เครื่องดื่ม").length).toBeGreaterThanOrEqual(1);
    const img = screen.getByAltText("รูปข้าวผัดป้าอ้อ") as HTMLImageElement;
    expect(img.src).toContain("khao-phad.jpg");
    // เลือกอาหาร: เห็นเฉพาะอาหาร
    await user.selectOptions(screen.getByLabelText("ประเภท"), "food");
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    expect(screen.queryByText("ชาเย็น")).not.toBeInTheDocument();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดเมนู…")).toBeInTheDocument();
  });

  it("production: empty state เมื่อยังไม่มีเมนูพร้อมขาย (DEV=false ไม่ fallback)", async () => {
    setDev(false);
    stubFetch(() => ({ ok: true, json: async () => ({ groups: [] }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ยังไม่มีเมนูพร้อมขาย")).toBeInTheDocument();
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
  });

  it("production: error state พร้อมปุ่มลองใหม่ (DEV=false ไม่ fallback แม้ 500)", async () => {
    setDev(false);
    const user = userEvent.setup();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) };
      return { ok: true, json: async () => ({ groups }) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองโหลดเมนูอีกครั้ง" }));
    // ค่าเริ่มต้นเห็นทั้งหมด: ได้ทั้งอาหารและเครื่องดื่มทันที
    expect(await screen.findByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
  });

  it("DEV: API ว่างเปล่า fallback เป็น DEMO พร้อม DemoBadge", async () => {
    setDev(true);
    stubFetch(() => ({ ok: true, json: async () => ({ groups: [] }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("DEV: network failure fallback เป็น DEMO พร้อม DemoBadge", async () => {
    setDev(true);
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
  });

  it("DEV: HTTP 500 คง error จริง ไม่ fallback (เซิร์ฟเวอร์พังต้องเห็น)", async () => {
    setDev(true);
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "เซิร์ฟเวอร์ขัดข้อง" }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    // กลืน 500 เป็นข้อมูลตัวอย่างทำให้หน้าเว็บดู "ปกติ" ทั้งที่หลังบ้านล่ม
    // และคนแก้ไม่รู้เลยว่าพังตั้งแต่เมื่อไร — fallback จึงจำกัดที่ offline เท่านั้น
    expect(await screen.findByRole("alert")).toHaveTextContent("เซิร์ฟเวอร์ขัดข้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText("ชาใต้")).not.toBeInTheDocument();
  });

  it("DEV: HTTP อื่น (400) คง error จริง ไม่ fallback", async () => {
    setDev(true);
    stubFetch(() => ({ ok: false, status: 400, json: async () => ({ error: "คำขอไม่ถูกต้อง" }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("คำขอไม่ถูกต้อง");
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText("ชาใต้")).not.toBeInTheDocument();
  });

  it("production: network failure คง error จริง ไม่ fallback", async () => {
    setDev(false);
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(DEMO_MODE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText("ชาใต้")).not.toBeInTheDocument();
  });

  it("DEV fallback: retry กลับมาแสดงข้อมูลจริงได้", async () => {
    setDev(true);
    const user = userEvent.setup();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { ok: true, json: async () => ({ groups }) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_MODE_LABEL).length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "ลองเชื่อมต่อเซิร์ฟเวอร์อีกครั้ง" }));
    expect(await screen.findByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
  });

  it("กรองตามประเภทและคำค้นได้ (ค่าเริ่มต้นเห็นทั้งหมด)", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: true, json: async () => ({ groups }) }));
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    // ค่าเริ่มต้น: เห็นทั้งอาหารและเครื่องดื่ม
    expect(screen.getByLabelText("ประเภท")).toHaveValue("");
    expect(await screen.findByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    // เลือกอาหาร: เห็นเฉพาะอาหาร
    await user.selectOptions(screen.getByLabelText("ประเภท"), "food");
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    expect(screen.queryByText("ชาเย็น")).not.toBeInTheDocument();
    // กลับเป็นเครื่องดื่ม: เห็นเฉพาะเครื่องดื่ม
    await user.selectOptions(screen.getByLabelText("ประเภท"), "drink");
    expect(screen.queryByText("ข้าวผัดป้าอ้อ")).not.toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
    // ค้นหาด้วยคำค้น: กลับเป็นทั้งหมดก่อนแล้วพิมพ์คำค้น
    await user.selectOptions(screen.getByLabelText("ประเภท"), "");
    await user.type(screen.getByLabelText("ค้นหาชื่อหรือรายละเอียด"), "ชาเย็น");
    expect(screen.queryByText("ข้าวผัดป้าอ้อ")).not.toBeInTheDocument();
    expect(screen.getByText("ชาเย็น")).toBeInTheDocument();
  });

  it("fixture โหมดสาธิตมี 18 รายการ 4 หมวด exact", () => {
    expect(DEMO_MENU_GROUPS.map((g) => g.category)).toEqual([...EXPECTED_CATEGORIES]);
    const counts = new Map(DEMO_MENU_GROUPS.map((g) => [g.category, g.items.length]));
    expect(counts.get("ชาและโกโก้")).toBe(6);
    expect(counts.get("นม")).toBe(4);
    expect(counts.get("โซดา")).toBe(3);
    expect(counts.get("กาแฟและมัทฉะ")).toBe(5);
    expect(allDemoItems()).toHaveLength(18);
  });

  it("exact mapping ชื่อ/ราคา/หมวด ตรงข้อกำหนด", () => {
    const actual = allDemoItems().map(({ group, item }) => ({
      category: group,
      name: item.name,
      price: item.price,
    }));
    expect(actual).toEqual(EXPECTED_ITEMS.map(({ category, name, price }) => ({ category, name, price })));
    // item.category ต้องตรงกับ group.category เสมอ
    for (const { group, item } of allDemoItems()) {
      expect(item.category).toBe(group);
    }
  });

  it("ทุก item ฟิลด์ครบ kind/description/optionGroups/inStock/imageUrl", () => {
    for (const { item } of allDemoItems()) {
      expect(item.kind).toBe("drink");
      expect(typeof item.description).toBe("string");
      expect((item.description ?? "").trim().length).toBeGreaterThan(0);
      expect(Array.isArray(item.optionGroups)).toBe(true);
      expect(item.optionGroups.length).toBeGreaterThan(0);
      for (const og of item.optionGroups) {
        expect(og.id).toBeTruthy();
        expect(og.name).toBeTruthy();
        expect(og.options.length).toBeGreaterThan(0);
        for (const o of og.options) {
          expect(o.id).toBeTruthy();
          expect(o.name).toBeTruthy();
          expect(typeof o.priceDelta).toBe("number");
        }
      }
      expect(typeof item.inStock).toBe("boolean");
      expect(typeof item.imageUrl).toBe("string");
      expect((item.imageUrl ?? "").length).toBeGreaterThan(0);
    }
  });

  it("imageUrl เป็น /menu/items/<ไฟล์> ของจริงและไม่ซ้ำ 18 ไฟล์", () => {
    const urls = allDemoItems().map(({ item }) => String(item.imageUrl));
    expect(new Set(urls).size).toBe(18);
    const stems = urls.map((u) => {
      expect(u.startsWith("/menu/items/")).toBe(true);
      const file = u.slice("/menu/items/".length);
      expect(file).toMatch(/\.png$/);
      return file.replace(/\.png$/, "");
    });
    expect([...stems].sort()).toEqual(EXPECTED_STEMS);
    for (const u of urls) {
      const file = u.slice("/menu/items/".length);
      expect(existsSync(join(process.cwd(), "public", "menu", "items", file))).toBe(true);
    }
  });

  it("UI แสดงข้อมูลสาธิตจริงพร้อมรูป ราคา ประเภท ตัวเลือก", async () => {
    stubFetch((url) => {
      if (url.includes("/api/menu/public"))
        return { ok: true, json: async () => ({ groups: DEMO_MENU_GROUPS }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ชาใต้")).toBeInTheDocument();
    expect(screen.getByText("มัจฉะลาเต้")).toBeInTheDocument();
    expect(screen.getByText("แดงโซดา")).toBeInTheDocument();
    expect(screen.getAllByText(/29 บาท/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/49 บาท/)).toBeInTheDocument();
    expect(screen.getAllByText(/19 บาท/).length).toBe(2);
    const img = screen.getByAltText("รูปชาใต้") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/menu/items/cha-tai.png");
    const matchaImg = screen.getByAltText("รูปมัจฉะลาเต้") as HTMLImageElement;
    expect(matchaImg.getAttribute("src")).toBe("/menu/items/matcha-latte.png");
    // หมวดครบ 4 หมวด
    for (const c of EXPECTED_CATEGORIES) {
      expect(screen.getByText(c)).toBeInTheDocument();
    }
    // badge ประเภทเครื่องดื่ม + กลุ่มตัวเลือก
    expect(screen.getAllByText("เครื่องดื่ม").length).toBeGreaterThanOrEqual(18);
    expect(screen.getAllByText(/ระดับความหวาน/).length).toBeGreaterThanOrEqual(1);
  });

  it("UI fallback ครบ: ไม่มีรูป/ไม่มีคำอธิบาย/หมดชั่วคราว/ไม่มีตัวเลือก", async () => {
    const edgeGroups = [
      {
        category: "โซดา",
        items: [
          {
            id: "edge-no-image",
            category: "โซดา",
            name: "เมนูไม่มีรูป",
            description: "มีคำอธิบาย",
            imageUrl: null,
            price: 10,
            kind: "drink",
            sortOrder: 0,
            inStock: true,
            optionGroups: [],
          },
          {
            id: "edge-no-desc",
            category: "โซดา",
            name: "เมนูไม่มีคำอธิบาย",
            description: null,
            imageUrl: "/menu/items/red-soda.png",
            price: 19,
            kind: "drink",
            sortOrder: 1,
            inStock: true,
            optionGroups: [],
          },
          {
            id: "edge-out-of-stock",
            category: "โซดา",
            name: "เมนูหมดชั่วคราว",
            description: "หมด",
            imageUrl: "/menu/items/red-soda.png",
            price: 19,
            kind: "drink",
            sortOrder: 2,
            inStock: false,
            optionGroups: [],
          },
        ],
      },
    ];
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups: edgeGroups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("เมนูไม่มีรูป")).toBeInTheDocument();
    expect(screen.queryByAltText("รูปเมนูไม่มีรูป")).not.toBeInTheDocument();
    expect(screen.getByText("เมนูไม่มีคำอธิบาย")).toBeInTheDocument();
    expect(screen.getByText("เมนูหมดชั่วคราว")).toBeInTheDocument();
    expect(screen.getByText("วัตถุดิบหมดชั่วคราว")).toBeInTheDocument();
    // รายการที่ optionGroups ว่างต้องไม่พัง
    const main = screen.getByRole("main");
    expect(within(main).getByText("เมนูไม่มีรูป")).toBeInTheDocument();
  });

  it("ค่าเริ่มต้นเห็นทั้งหมด: ตัวเลือกกรองครบและ label ชัดเจน", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ groups }) }));
    render(<MemoryRouter><MenuPublicPage /></MemoryRouter>);
    // ค่าเริ่มต้นต้องเป็นทั้งหมด และเห็นทั้งอาหารและเครื่องดื่ม
    const select = screen.getByLabelText("ประเภท") as HTMLSelectElement;
    expect(select).toHaveValue("");
    expect(await screen.findByText("ชาเย็น")).toBeInTheDocument();
    expect(screen.getByText("ข้าวผัดป้าอ้อ")).toBeInTheDocument();
    // ตัวเลือกทั้งหมด (value="") ยังคงอยู่ด้วย label ชัดเจน
    expect(select.options[0]?.value).toBe("");
    expect(select.options[0]?.textContent).toBe("ทั้งหมด");
    // ตัวเลือกเครื่องดื่มใช้ label เครื่องดื่มทั้งหมด
    const drinkOption = Array.from(select.options).find((o) => o.value === "drink");
    expect(drinkOption?.textContent).toBe("เครื่องดื่มทั้งหมด");
    // ตัวเลือกอาหารยังอยู่
    const foodOption = Array.from(select.options).find((o) => o.value === "food");
    expect(foodOption).toBeDefined();
  });

  it("API จริง 18 เครื่องดื่ม + 1 อาหาร: เริ่มต้นเห็นครบ 19 แล้วกรองเครื่องดื่มเหลือ 18", async () => {
    setDev(false);
    const foodName = "ข้าวผัดไก่ทดสอบอาหารเท่านั้น";
    const apiGroups = [
      ...DEMO_MENU_GROUPS,
      {
        category: "อาหารจานเดียว",
        items: [
          {
            id: "proof-food-1",
            category: "อาหารจานเดียว",
            name: foodName,
            description: "อาหารทดสอบ ไม่ควรเห็นตอนกรองเครื่องดื่ม",
            imageUrl: null,
            price: 55,
            kind: "food",
            sortOrder: 0,
            inStock: true,
            optionGroups: [],
          },
        ],
      },
    ];
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups: apiGroups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("ประเภท");
    expect(select).toHaveValue("");
    const drinkNames = DEMO_MENU_GROUPS.flatMap((g) => g.items.map((i) => i.name));
    expect(drinkNames).toHaveLength(18);
    expect(await screen.findByText(drinkNames[0]!)).toBeInTheDocument();
    for (const name of drinkNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // อาหารต้องเห็นด้วยตั้งแต่เปิดหน้า — นี่คือร้านอาหารตามสั่ง
    expect(screen.getByText(foodName)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("พบ 19 เมนู");
    // กรองเครื่องดื่มแล้วอาหารหายไป
    await userEvent.selectOptions(select, "drink");
    expect(screen.queryByText(foodName)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("พบ 18 เมนู");
  });

  it("กดการ์ดเมนูเปิดป๊อปอัปสั่งซื้อ แล้วเพิ่มลงตะกร้าได้ (#27)", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    // ปุ่มบนการ์ดคือทางเข้าหลักของคีย์บอร์ด/สกรีนรีดเดอร์
    await user.click(await screen.findByRole("button", { name: "สั่ง ข้าวผัดป้าอ้อ" }));
    const dialog = screen.getByRole("dialog", { name: "ข้าวผัดป้าอ้อ" });
    await user.click(within(dialog).getByRole("button", { name: "เพิ่มจำนวน" }));
    await user.click(within(dialog).getByRole("button", { name: "เพิ่ม 2 ชิ้นลงตะกร้า" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("เพิ่ม ข้าวผัดป้าอ้อ 2 ชิ้นลงตะกร้าแล้ว")).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem("paor-cart-v1") ?? "[]") as { menuId: string; quantity: number }[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.quantity).toBe(2);
  });

  it("แตะตรงไหนของการ์ดก็เปิดป๊อปอัปได้ ไม่ต้องเล็งปุ่ม", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/menu/public")) return { ok: true, json: async () => ({ groups }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MemoryRouter>
        <MenuPublicPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByText("ชาเย็น"));
    expect(screen.getByRole("dialog", { name: "ชาเย็น" })).toBeInTheDocument();
  });
});
