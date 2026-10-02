import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaymentPanel } from "../src/components/PaymentPanel";
import { ReceiptClaimQrCard } from "../src/components/ReceiptClaimQr";
import RewardsPage from "../src/pages/customer/Rewards";
import { extractRewardQrCode, isReceiptQrCode } from "../src/lib/walkinQr";
import type { OrderDetail, Payment } from "../src/lib/api";

const CODE = `RCPT-${"AB12CD34".repeat(4)}-${"0F1E2D3C4B5A".repeat(2)}`;

const receipt = {
  receiptNumber: "RCP-20260914-AB12",
  paymentId: "pay1",
  orderId: "o1",
  orderNumber: "ORD-20260914-AB12",
  shopName: "ร้านป้าอ้อ",
  method: "cash",
  amount: 60,
  receivedAmount: 100,
  changeAmount: 40,
  paidAt: "2026-09-14T10:05:00.000Z",
  items: [{ menuName: "ชาเย็น", quantity: 2, unitPrice: 30, lineTotal: 60 }],
  createdAt: "2026-09-14T10:05:00.000Z",
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("Issue #55 extractRewardQrCode / isReceiptQrCode", () => {
  it("รับทั้ง WALKIN-… และ RCPT-… (ตัวพิมพ์ใหญ่) ที่เป็นรหัสทั้งก้อนเท่านั้น", () => {
    expect(extractRewardQrCode("walkin-ab12cd")).toBe("WALKIN-AB12CD");
    expect(extractRewardQrCode(`  ${CODE.toLowerCase()}\n`)).toBe(CODE);
    expect(isReceiptQrCode(CODE)).toBe(true);
    expect(isReceiptQrCode("WALKIN-AB12CD")).toBe(false);
    for (const bad of [`https://evil.example/?c=${CODE}`, `${CODE}-X`, CODE.slice(0, -1), "RCPT-XYZ", ""]) {
      expect(extractRewardQrCode(bad), bad).toBeNull();
    }
  });
});

describe("Issue #55 ReceiptClaimQrCard", () => {
  it("แสดง QR + รหัส + วันหมดอายุ + ลิงก์รับแต้มบนเครื่องนี้", () => {
    render(
      <MemoryRouter>
        <ReceiptClaimQrCard claim={{ code: CODE, expiresAt: "2026-09-15T10:05:00.000Z" }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("img", { name: "QR รับแต้มจากใบเสร็จ" })).toBeInTheDocument();
    expect(screen.getByLabelText("รหัส QR ใบเสร็จ")).toHaveTextContent(CODE);
    expect(screen.getByText(/ใช้ได้ครั้งเดียว ภายใน/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "รับแต้มบนเครื่องนี้" })).toHaveAttribute("href", `/rewards?code=${encodeURIComponent(CODE)}`);
  });
});

describe("Issue #55 PaymentPanel แสดง QR ใต้ใบเสร็จ", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  const order = { id: "o1", orderNumber: "ORD-20260914-AB12", total: 60, items: [] } as unknown as OrderDetail;
  const payment = { id: "pay1", orderId: "o1", status: "paid", method: "cash", amount: 60 } as unknown as Payment;

  function stub(claimQr: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/receipts/by-payment/pay1")) return ok({ receipt, claimQr });
        return ok({});
      }),
    );
  }

  it("มี claimQr → แสดงการ์ดรับแต้ม", async () => {
    stub({ code: CODE, expiresAt: "2026-09-15T10:05:00.000Z" });
    render(
      <MemoryRouter>
        <PaymentPanel order={order} phone="0812345678" initialPayment={payment} initialState="paid" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("img", { name: "QR รับแต้มจากใบเสร็จ" })).toBeInTheDocument();
    expect(screen.getByLabelText("รหัส QR ใบเสร็จ")).toHaveTextContent(CODE);
  });

  it("claimQr เป็น null (สมาชิก/หมดอายุ/ปิดฟีเจอร์) → แสดงใบเสร็จตามปกติ ไม่มี QR", async () => {
    stub(null);
    render(
      <MemoryRouter>
        <PaymentPanel order={order} phone="0812345678" initialPayment={payment} initialState="paid" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("RCP-20260914-AB12")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "QR รับแต้มจากใบเสร็จ" })).not.toBeInTheDocument();
  });
});

describe("Issue #55 หน้าคะแนนสะสม รับแต้มจาก QR ใบเสร็จ", () => {
  const claimBodies: unknown[] = [];
  const walkinBodies: unknown[] = [];

  function stubApi(claimResult: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
        if (u.includes("/api/loyalty/balance")) return ok({ balance: 0 });
        if (u.includes("/api/rewards/redeemable")) return ok({ rewards: [] });
        if (u.includes("/api/loyalty/redemptions/mine")) return ok({ redemptions: [] });
        if (u.includes("/api/loyalty/ledger")) return ok({ entries: [], balance: 0 });
        if (u.includes("/api/loyalty/receipt/claim")) {
          claimBodies.push(JSON.parse(String(init?.body)));
          return claimResult;
        }
        if (u.includes("/api/loyalty/walkin/scan")) {
          walkinBodies.push(JSON.parse(String(init?.body)));
          return ok({ token: { code: "WALKIN-X" }, earned: true });
        }
        return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
      }),
    );
  }

  function renderRewards(path = "/rewards") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <RewardsPage />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    claimBodies.length = 0;
    walkinBodies.length = 0;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });

  it("ลิงก์ ?code=RCPT-… เติมช่องรหัสให้ แล้วกดรับแต้ม → เรียก receipt/claim (ไม่เรียก walkin) และแจ้งแต้ม", async () => {
    stubApi(ok({ order: { id: "o1" }, earned: 2 }));
    renderRewards(`/rewards?code=${encodeURIComponent(CODE)}`);
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    expect(screen.getByLabelText("รหัส QR")).toHaveValue(CODE);
    await userEvent.click(screen.getByRole("button", { name: "รับคะแนน" }));
    expect(await screen.findByText("ผูกใบเสร็จเข้าบัญชีแล้ว รับ 2 แต้ม")).toBeInTheDocument();
    expect(claimBodies).toEqual([{ code: CODE }]);
    expect(walkinBodies).toEqual([]);
  });

  it("ยังไม่ส่งมอบ (earned 0) → บอกว่าแต้มจะเข้าภายหลัง", async () => {
    stubApi(ok({ order: { id: "o1" }, earned: 0 }));
    renderRewards();
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.type(screen.getByLabelText("รหัส QR"), CODE.toLowerCase());
    await userEvent.click(screen.getByRole("button", { name: "รับคะแนน" }));
    expect(await screen.findByText(/แต้มจะเข้าเมื่อเครื่องดื่มถูกส่งมอบ/)).toBeInTheDocument();
    expect(claimBodies).toEqual([{ code: CODE }]);
  });

  it("server ปฏิเสธ (ใช้ไปแล้ว/หมดอายุ) → แสดงข้อความจาก server", async () => {
    stubApi({ ok: false, status: 409, json: async () => ({ error: "QR ใบเสร็จนี้ถูกใช้ไปแล้ว หรือคำสั่งซื้อนี้ถูกผูกบัญชีไปแล้ว" }) });
    renderRewards(`/rewards?code=${encodeURIComponent(CODE)}`);
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.click(screen.getByRole("button", { name: "รับคะแนน" }));
    expect(await screen.findByText(/ถูกใช้ไปแล้ว/)).toBeInTheDocument();
  });

  it("?code= ที่ไม่ใช่รหัสรับแต้ม (เช่นลิงก์/ข้อความ) ถูกเมิน ช่องว่าง", async () => {
    stubApi(ok({ order: { id: "o1" }, earned: 1 }));
    renderRewards(`/rewards?code=${encodeURIComponent("https://evil.example")}`);
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    expect(screen.getByLabelText("รหัส QR")).toHaveValue("");
  });

  it("สแกนกล้องได้ QR ใบเสร็จ → เรียก receipt/claim ทันที", async () => {
    stubApi(ok({ order: { id: "o1" }, earned: 2 }));
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream) },
    });
    class FakeDetector {
      detect = async () => [{ rawValue: CODE.toLowerCase() }];
    }
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = FakeDetector;
    renderRewards();
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.click(screen.getByRole("button", { name: "สแกน QR ด้วยกล้อง" }));
    expect(await screen.findByText("ผูกใบเสร็จเข้าบัญชีแล้ว รับ 2 แต้ม")).toBeInTheDocument();
    expect(claimBodies).toEqual([{ code: CODE }]);
    expect(walkinBodies).toEqual([]);
  });

  it("QR พนักงาน WALKIN-… ยังทำงานเหมือนเดิม (เรียก walkin/scan)", async () => {
    stubApi(ok({ order: { id: "o1" }, earned: 1 }));
    renderRewards();
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.type(screen.getByLabelText("รหัส QR"), "WALKIN-X1Y2");
    await userEvent.click(screen.getByRole("button", { name: "รับคะแนน" }));
    expect(await screen.findByText(/รับคะแนน Walk-in 1 แต้มแล้ว/)).toBeInTheDocument();
    expect(walkinBodies).toEqual([{ code: "WALKIN-X1Y2" }]);
    expect(claimBodies).toEqual([]);
  });
});
