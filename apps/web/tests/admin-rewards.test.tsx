import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminRewardsPage from "../src/pages/admin/AdminRewards";

const pendingItem = {
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

const rewardItem = {
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

function stubAdmin(overrides?: { pending?: typeof pendingItem[]; rewards?: typeof rewardItem[]; failFirst?: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u} ${String(init?.body ?? "")}`);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      const err = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: message }) });
      if (u.endsWith("/api/auth/csrf")) return ok({ csrfToken: "t" });
      if (u.includes("/api/redemptions/pending")) {
        if (overrides?.failFirst) return err(403, "สิทธิ์ไม่เพียงพอ");
        return ok({ redemptions: overrides?.pending ?? [pendingItem] });
      }
      if (u.includes("/api/rewards") && method === "GET") return ok({ rewards: overrides?.rewards ?? [rewardItem] });
      if (u.endsWith("/api/rewards") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { name: string };
        return ok({ reward: { ...rewardItem, id: "rw-new", name: body.name } });
      }
      if (/\/api\/rewards\/.+$/.test(u) && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { isActive?: boolean };
        return ok({ reward: { ...rewardItem, ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) } });
      }
      if (/\/api\/redemptions\/.+\/consume$/.test(u)) {
        return ok({ redemption: { ...pendingItem, status: "consumed", queueJobId: "q1" }, job: { id: "q1" } });
      }
      if (/\/api\/redemptions\/.+\/release$/.test(u)) return ok({ redemption: { ...pendingItem, status: "released" }, deduplicated: false });
      if (u.includes("/api/loyalty/walkin/issue")) {
        return ok({ token: { id: "w1", code: "WALKIN-NEW1", createdBy: "u1", createdAt: "2026-09-15T03:00:00.000Z", expiresAt: "2026-09-15T03:10:00.000Z", redeemedAt: null, redeemedBy: null } });
      }
      if (u.includes("/api/audit/loyalty")) {
        return ok({ items: [{ id: 1, at: "2026-09-15T03:00:00.000Z", actorUsername: "owner", action: "reward_created", targetUsername: null, detail: "ชาเย็นฟรี", ip: null, success: true }] });
      }
      return err(404, "ไม่พบ");
    }),
  );
  return { calls };
}

function renderPage(isManager: boolean) {
  return render(
    <MemoryRouter>
      <AdminRewardsPage isManager={isManager} />
    </MemoryRouter>,
  );
}

describe("หน้าหลังร้านรางวัลและการแลกแต้ม (ภาษาไทย)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading แล้วแสดงรายการรอรับ ปุ่มรับ/ปฏิเสธ", async () => {
    stubAdmin();
    renderPage(true);
    expect(screen.getByText("กำลังโหลดข้อมูลรางวัล…")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    expect(screen.getByText(/RDM-ABC123/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับรายการ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();
  });

  it("โหลดล้มเหลวแสดง error พร้อมปุ่มลองใหม่", async () => {
    stubAdmin({ failFirst: true });
    renderPage(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("สิทธิ์ไม่เพียงพอ");
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });

  it("กดรับรายการสำเร็จแสดง success", async () => {
    const user = userEvent.setup();
    const stub = stubAdmin();
    renderPage(true);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    await user.click(screen.getByRole("button", { name: "รับรายการ" }));
    await screen.findByText(/รับรายการ RDM-ABC123 แล้ว/);
    expect(stub.calls.some((c) => c.includes("POST") && c.includes("/api/redemptions/rdm1/consume"))).toBe(true);
  });

  it("ปฏิเสธต้องกรอกเหตุผลก่อนยืนยัน", async () => {
    const user = userEvent.setup();
    const stub = stubAdmin();
    renderPage(true);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    await user.click(screen.getByRole("button", { name: "ปฏิเสธ" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันปฏิเสธ" }));
    expect(await screen.findByText("กรุณาระบุเหตุผลปฏิเสธ/ยกเลิก")).toBeInTheDocument();
    expect(stub.calls.some((c) => c.includes("release"))).toBe(false);
    await user.type(screen.getByLabelText("เหตุผลปฏิเสธ"), "วัตถุดิบหมด");
    await user.click(screen.getByRole("button", { name: "ยืนยันปฏิเสธ" }));
    await screen.findByText("ปฏิเสธรายการและคืนคะแนนให้ลูกค้าแล้ว");
  });

  it("ออกรหัส QR สำเร็จแสดงรหัสให้ลูกค้าสแกน", async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderPage(true);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    await user.click(screen.getByRole("button", { name: "ออกรหัส QR ใหม่" }));
    await screen.findByText("WALKIN-NEW1");
    expect(screen.getByText(/ใช้ได้ครั้งเดียวภายใน 10 นาที/)).toBeInTheDocument();
  });

  it("manager เห็นฟอร์มสร้างรางวัล สร้างสำเร็จ และปิดขายได้", async () => {
    const user = userEvent.setup();
    const stub = stubAdmin();
    renderPage(true);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    expect(screen.getByRole("heading", { name: "สร้างรางวัลใหม่" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("ชื่อรางวัล"), "กาแฟฟรี 1 แก้ว");
    await user.type(screen.getByLabelText("รหัสเมนูเครื่องดื่ม"), "m-coffee");
    await user.type(screen.getByLabelText("คะแนนที่ใช้ (แต้ม)"), "8");
    await user.click(screen.getByRole("button", { name: "สร้างรางวัล" }));
    await screen.findByText(/สร้างรางวัล “กาแฟฟรี 1 แก้ว” แล้ว/);
    expect(stub.calls.some((c) => c.includes("POST /api/rewards "))).toBe(true);
    await user.click(screen.getByRole("button", { name: "ปิดขาย" }));
    await screen.findByText(/ปิดขาย “ชาเย็นฟรี 1 แก้ว” แล้ว/);
    expect(screen.getByRole("heading", { name: "ประวัติคะแนนและรางวัล" })).toBeInTheDocument();
  });

  it("drink (ไม่ใช่ manager) ไม่เห็นฟอร์มสร้างรางวัล แต่จัดการรายการรอรับและ QR ได้", async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderPage(false);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    expect(screen.queryByRole("heading", { name: "สร้างรางวัลใหม่" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "รางวัลทั้งหมด" })).not.toBeInTheDocument();
    expect(screen.getByText(/เป็นของ Owner\/Admin เท่านั้น/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับรายการ" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ออกรหัส QR ใหม่" }));
    await screen.findByText("WALKIN-NEW1");
  });

  it("role-aware: หน้าหลังร้านไม่เรียก endpoint ฝั่งลูกค้า", async () => {
    const stub = stubAdmin();
    renderPage(true);
    await screen.findByRole("heading", { name: "รางวัลและการแลกแต้ม" });
    await waitFor(() => {
      expect(stub.calls.some((c) => c.includes("/api/redemptions/pending"))).toBe(true);
    });
    const customerPaths = ["/api/loyalty/balance", "/api/loyalty/ledger", "/api/rewards/redeemable", "/api/loyalty/redemptions/mine"];
    for (const p of customerPaths) {
      expect(stub.calls.some((c) => c.includes(p))).toBe(false);
    }
  });
});
