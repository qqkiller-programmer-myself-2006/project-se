import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import RewardsPage from "../src/pages/customer/Rewards";

const reward = {
  id: "rw1",
  name: "ชาเย็นฟรี 1 แก้ว",
  imageUrl: null,
  menuId: "m-tea",
  menuName: "ชาเย็น",
  pointsCost: 5,
  quotaTotal: 10,
  quotaUsed: 2,
  startsAt: null,
  endsAt: null,
  isActive: true,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const redemption = {
  id: "rdm1",
  code: "RDM-ABC123",
  customerId: "c1",
  rewardId: "rw1",
  rewardName: "ชาเย็นฟรี 1 แก้ว",
  menuId: "m-tea",
  menuName: "ชาเย็น",
  pointsCost: 5,
  status: "reserved",
  idempotencyKey: "k1",
  queueJobId: null,
  reason: null,
  createdAt: "2026-09-15T01:00:00.000Z",
  updatedAt: "2026-09-15T01:00:00.000Z",
};

const entry = {
  id: "lt1",
  customerId: "c1",
  points: 1,
  source: "order",
  orderId: "o1",
  paymentId: "p1",
  orderItemId: "oi1",
  redemptionId: null,
  walkinTokenId: null,
  reason: "สะสมจากคำสั่งซื้อ",
  actorId: null,
  actorUsername: null,
  createdAt: "2026-09-15T02:00:00.000Z",
};

function stubRewards(overrides?: {
  balance?: number;
  rewards?: typeof reward[];
  redemptions?: typeof redemption[];
  entries?: typeof entry[];
  failFirst?: boolean;
}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/loyalty/balance")) {
        if (overrides?.failFirst) return err(401, "กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน");
        return ok({ balance: overrides?.balance ?? 5 });
      }
      if (u.includes("/api/rewards/redeemable")) return ok({ rewards: overrides?.rewards ?? [reward] });
      if (u.includes("/api/loyalty/redemptions/mine")) return ok({ redemptions: overrides?.redemptions ?? [redemption] });
      if (u.includes("/api/loyalty/ledger")) return ok({ entries: overrides?.entries ?? [entry], balance: overrides?.balance ?? 5 });
      if (u.includes("/api/loyalty/walkin/scan")) return ok({ token: { code: "WALKIN-X" }, earned: true });
      if (u.includes("/api/loyalty/guest/link")) return ok({ order: { id: "o9" }, earned: true });
      if (/\/api\/rewards\/.+\/redeem$/.test(u)) {
        return ok({ redemption: { ...redemption, id: "rdm-new", code: "RDM-NEW001" }, deduplicated: false });
      }
      if (/\/api\/redemptions\/.+\/release$/.test(u)) return ok({ redemption: { ...redemption, status: "released" }, deduplicated: false });
      return err(404, "ไม่พบ");
    }),
  );
  return { calls };
}

describe("หน้าคะแนนสะสมและรางวัลของลูกค้า (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading แล้วแสดงยอด รางวัล รายการแลก และประวัติ", async () => {
    stubRewards();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("กำลังโหลดคะแนนสะสม…")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByText("ชาเย็นฟรี 1 แก้ว")).toHaveLength(2);
    expect(screen.getByText(/RDM-ABC123/)).toBeInTheDocument();
    expect(screen.getByText("คำสั่งซื้อ")).toBeInTheDocument();
  });

  it("ไม่มี session แสดง error พร้อมปุ่มลองใหม่", async () => {
    stubRewards({ failFirst: true });
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาเข้าสู่ระบบบัญชีลูกค้าก่อน");
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });

  it("ว่างเปล่าแสดง empty state ครบทุกส่วน", async () => {
    stubRewards({ rewards: [], redemptions: [], entries: [], balance: 0 });
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    expect(screen.getByText(/ยังไม่มีรางวัลพร้อมแลก/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่เคยแลกรางวัล/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีประวัติคะแนน/)).toBeInTheDocument();
  });

  it("แลกสำเร็จแสดงรหัสอ้างอิง", async () => {
    const user = userEvent.setup();
    const stub = stubRewards();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await user.click(screen.getByRole("button", { name: /แลก ชาเย็นฟรี 1 แก้ว/ }));
    await screen.findByText(/RDM-NEW001/);
    expect(stub.calls.some((c) => c.includes("POST") && c.includes("/api/rewards/rw1/redeem"))).toBe(true);
  });

  it("แต้มไม่พอปุ่มแลกถูกปิดพร้อมคำอธิบาย", async () => {
    stubRewards({ balance: 2 });
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    const btn = screen.getByRole("button", { name: /แต้มไม่พอ/ });
    expect(btn).toBeDisabled();
  });

  it("ยกเลิกรายการต้องกรอกเหตุผลก่อนยืนยัน", async () => {
    const user = userEvent.setup();
    const stub = stubRewards();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await user.click(screen.getByRole("button", { name: "ยกเลิกรายการนี้" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(await screen.findByText("กรุณาระบุเหตุผลยกเลิก")).toBeInTheDocument();
    expect(stub.calls.some((c) => c.includes("release"))).toBe(false);
    await user.type(screen.getByLabelText("เหตุผลยกเลิก"), "เปลี่ยนใจ");
    await user.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    await screen.findByText("ยกเลิกรายการและคืนคะแนนแล้ว");
    await waitFor(() => {
      expect(stub.calls.some((c) => c.includes("POST") && c.includes("/api/redemptions/rdm1/release"))).toBe(true);
    });
  });

  it("สแกน QR Walk-in สำเร็จแสดง success", async () => {
    const user = userEvent.setup();
    stubRewards();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await user.type(screen.getByLabelText("รหัส QR"), "WALKIN-X");
    await user.click(screen.getByRole("button", { name: "รับคะแนน" }));
    await screen.findByText(/รับคะแนน Walk-in 1 แต้มแล้ว/);
  });

  it("ผูกคำสั่งซื้อ Guest สำเร็จแสดง success", async () => {
    const user = userEvent.setup();
    stubRewards();
    render(
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "คะแนนสะสมและรางวัล" });
    await user.type(screen.getByLabelText("รหัสคำสั่งซื้อ"), "order-9");
    await user.click(screen.getByRole("button", { name: "ผูกคำสั่งซื้อ" }));
    await screen.findByText(/ผูกคำสั่งซื้อและรับคะแนนเข้าแล้ว/);
  });
});
