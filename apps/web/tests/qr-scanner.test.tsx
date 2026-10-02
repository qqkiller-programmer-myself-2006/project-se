import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QrScanner, type OpenCamera, type QrDecode } from "../src/components/QrScanner";
import { extractWalkinCode } from "../src/lib/walkinQr";
import RewardsPage from "../src/pages/customer/Rewards";

function fakeStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

describe("Issue #44 extractWalkinCode", () => {
  it("รับเฉพาะรหัส WALKIN-… ทั้งก้อน (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) และคืนตัวพิมพ์ใหญ่", () => {
    expect(extractWalkinCode("WALKIN-AB12CD")).toBe("WALKIN-AB12CD");
    expect(extractWalkinCode("  walkin-ab12cd \n")).toBe("WALKIN-AB12CD");
  });

  it("เมินข้อความอื่นทั้งหมด: ลิงก์, ข้อความผสม, รหัสสั้น/ยาวเกิน, ว่าง", () => {
    for (const text of [
      "https://example.com/WALKIN-AB12CD",
      "javascript:alert(1)",
      "รับแต้ม WALKIN-AB12CD",
      "WALKIN-AB1",
      `WALKIN-${"A".repeat(33)}`,
      "WALKIN-AB 12",
      "WALKIN-AB12CD-EXTRA",
      "",
    ]) {
      expect(extractWalkinCode(text), text).toBeNull();
    }
  });
});

describe("Issue #44 QrScanner", () => {
  beforeEach(() => {
    // jsdom ไม่มี media playback จริง
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("อ่านรหัสถูกต้อง → เรียก onCode ครั้งเดียวด้วยรหัสตัวพิมพ์ใหญ่ แล้วปิดกล้อง", async () => {
    const { stream, stop } = fakeStream();
    const openCamera: OpenCamera = async () => stream;
    const decode: QrDecode = async () => "walkin-ab12cd";
    const onCode = vi.fn();
    render(<QrScanner onCode={onCode} onClose={() => undefined} decode={decode} openCamera={openCamera} />);
    await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
    expect(onCode).toHaveBeenCalledWith("WALKIN-AB12CD");
    expect(stop).toHaveBeenCalled();
  });

  it("QR อื่น (ลิงก์) ถูกเมินพร้อมคำเตือน และยังสแกนต่อจนเจอรหัสที่ถูกต้อง", async () => {
    const { stream } = fakeStream();
    const frames = ["https://evil.example/x", "WALKIN-ZZ99YY"];
    const decode: QrDecode = async () => frames.shift() ?? null;
    const onCode = vi.fn();
    render(<QrScanner onCode={onCode} onClose={() => undefined} decode={decode} openCamera={async () => stream} />);
    expect(await screen.findByText(/QR นี้ไม่ใช่รหัสรับแต้มของร้าน/)).toBeInTheDocument();
    await waitFor(() => expect(onCode).toHaveBeenCalledWith("WALKIN-ZZ99YY"), { timeout: 2000 });
    expect(onCode).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["NotAllowedError", /ไม่ได้รับอนุญาตให้ใช้กล้อง/],
    ["NotFoundError", /ไม่พบกล้อง/],
    ["NotSupportedError", /เปิดกล้องไม่ได้ในเบราว์เซอร์นี้/],
  ])("เปิดกล้องไม่ได้ (%s) → แสดงเหตุผลภาษาไทยและไม่เรียก onCode", async (name, message) => {
    const onCode = vi.fn();
    render(
      <QrScanner
        onCode={onCode}
        onClose={() => undefined}
        decode={async () => null}
        openCamera={async () => {
          throw new DOMException("x", name);
        }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onCode).not.toHaveBeenCalled();
  });

  it("ปุ่มปิดกล้องเรียก onClose และถอดหน้าจอแล้วต้องหยุด track ของกล้อง", async () => {
    const { stream, stop } = fakeStream();
    const onClose = vi.fn();
    const { unmount } = render(
      <QrScanner onCode={() => undefined} onClose={onClose} decode={async () => null} openCamera={async () => stream} />,
    );
    await screen.findByText(/หันกล้องไปที่ QR ของร้าน/);
    await userEvent.click(screen.getByRole("button", { name: "ปิดกล้อง" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});

describe("Issue #44 ปุ่มสแกนในหน้าคะแนนสะสม", () => {
  const scanBodies: unknown[] = [];

  function stubApi(scanResult: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
        if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
        if (u.includes("/api/loyalty/balance")) return ok({ balance: 5 });
        if (u.includes("/api/rewards/redeemable")) return ok({ rewards: [] });
        if (u.includes("/api/loyalty/redemptions/mine")) return ok({ redemptions: [] });
        if (u.includes("/api/loyalty/ledger")) return ok({ entries: [], balance: 5 });
        if (u.includes("/api/loyalty/walkin/scan")) {
          scanBodies.push(JSON.parse(String(init?.body)));
          return scanResult;
        }
        return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
      }),
    );
  }

  function withCamera() {
    const { stream } = fakeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    class FakeDetector {
      detect = async () => [{ rawValue: "walkin-ab12cd" }];
    }
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = FakeDetector;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    scanBodies.length = 0;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });

  it("กด 'สแกน QR ด้วยกล้อง' → อ่านรหัสได้แล้วรับแต้มทันทีด้วยรหัสนั้น", async () => {
    stubApi({ ok: true, status: 200, json: async () => ({ token: { code: "WALKIN-AB12CD" }, earned: true }) });
    withCamera();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.click(screen.getByRole("button", { name: "สแกน QR ด้วยกล้อง" }));
    expect(await screen.findByText(/รับคะแนน Walk-in 1 แต้มแล้ว/)).toBeInTheDocument();
    expect(scanBodies).toEqual([{ code: "WALKIN-AB12CD" }]);
    // กล้องปิดแล้วและกลับมาเป็นปุ่มสแกน
    expect(screen.getByRole("button", { name: "สแกน QR ด้วยกล้อง" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ภาพจากกล้องสำหรับสแกน QR")).not.toBeInTheDocument();
  });

  it("QR ใช้ไปแล้ว/หมดอายุ → แสดงข้อความจาก server ไม่ค้างกล้องไว้", async () => {
    stubApi({ ok: false, status: 409, json: async () => ({ error: "QR นี้ถูกใช้ไปแล้ว" }) });
    withCamera();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.click(screen.getByRole("button", { name: "สแกน QR ด้วยกล้อง" }));
    expect(await screen.findByText("QR นี้ถูกใช้ไปแล้ว")).toBeInTheDocument();
    expect(screen.queryByLabelText("ภาพจากกล้องสำหรับสแกน QR")).not.toBeInTheDocument();
  });

  it("อุปกรณ์ไม่มีกล้อง/ไม่รองรับ → บอกเหตุผลและยังกรอกรหัสเองได้", async () => {
    stubApi({ ok: true, status: 200, json: async () => ({ token: { code: "WALKIN-X" }, earned: true }) });
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await userEvent.click(screen.getByRole("button", { name: "สแกน QR ด้วยกล้อง" }));
    expect(await screen.findByText(/เปิดกล้องไม่ได้ในเบราว์เซอร์นี้/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("รหัส QR"), "WALKIN-X");
    await userEvent.click(screen.getByRole("button", { name: "รับคะแนน" }));
    await screen.findByText(/รับคะแนน Walk-in 1 แต้มแล้ว/);
    expect(scanBodies).toEqual([{ code: "WALKIN-X" }]);
  });
});
