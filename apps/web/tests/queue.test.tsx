import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StationQueuePage from "../src/pages/kitchen/StationQueue";
import QueueTrackPage from "../src/pages/customer/QueueTrack";

const kitchenJob = {
  id: "job1",
  orderId: "order1",
  orderNumber: "ORD-20260914-AB12",
  paymentId: "pay1",
  orderItemId: "item1",
  menuId: "menu1",
  menuName: "ข้าวผัดป้าอ้อ",
  station: "kitchen",
  quantity: 2,
  readyQty: 0,
  deliveredQty: 0,
  status: "queued",
  readyAt: "2026-09-14T03:00:00.000Z",
  tableId: "t1",
  roundId: "r1",
  isRemake: false,
  isPriority: false,
  reason: null,
  claimedBy: null,
  createdAt: "2026-09-14T03:00:00.000Z",
  updatedAt: "2026-09-14T03:00:00.000Z",
  tableName: "A1",
};

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

const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe("หน้าคิวฝ่ายครัว (Ticket 09)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading state ตอนเริ่มโหลด", async () => {
    stubFetch(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("กำลังโหลดคิวงาน…")).toBeInTheDocument();
  });

  it("เห็นงานคิวพร้อมปุ่มรับงานและสถานะภาษาไทย", async () => {
    stubFetch((url) => {
      if (url.includes("/api/queue?")) return ok({ jobs: [kitchenJob] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ข้าวผัดป้าอ้อ ×2")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("รอรับงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
  });

  it("empty state เมื่อไม่มีงานคิว", async () => {
    stubFetch((url) => {
      if (url.includes("/api/queue?")) return ok({ jobs: [] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/ยังไม่มีงานคิว/)).toBeInTheDocument();
  });

  it("error state เมื่อโหลดไม่สำเร็จ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/queue?")) return { ok: false, status: 403, json: async () => ({ error: "สิทธิ์ไม่เพียงพอ" }) };
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("สิทธิ์ไม่เพียงพอ");
  });

  it("กดรับงานแล้วมีข้อความยืนยันภาษาไทย", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/queue?")) return ok({ jobs: [kitchenJob] });
      if (url.includes("/claim")) return ok({ job: { ...kitchenJob, status: "claimed" } });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "รับงาน" }));
    expect(await screen.findByText(/รับงาน ข้าวผัดป้าอ้อ แล้ว/)).toBeInTheDocument();
  });

  it("ปุ่มเร่งด่วน/ทำใหม่ถูกปิดจนกว่าจะกรอกเหตุผล", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/queue?")) return ok({ jobs: [kitchenJob] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "เร่งด่วน/ทำใหม่" }));
    const panel = await screen.findByLabelText("เหตุผล (บังคับสำหรับเร่งด่วน/ทำใหม่/ยกเลิก)");
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เร่งงานนี้" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ทำใหม่" })).toBeDisabled();
  });

  it("งานพร้อมส่งมอบมีปุ่มบันทึกส่งมอบและแยกจากทำเสร็จ", async () => {
    stubFetch((url) => {
      if (url.includes("/api/queue?"))
        return ok({ jobs: [{ ...kitchenJob, status: "ready", readyQty: 2 }] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("พร้อมส่งมอบ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกส่งมอบ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกทำเสร็จ" })).not.toBeInTheDocument();
  });

  it("ผู้ดูแลเห็นแผงกำลังผลิตและบันทึกได้", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url.includes("/api/queue?")) return ok({ jobs: [] });
      if (url.includes("/api/queue/capacity") && init?.method === "PUT")
        return ok({ capacity: { station: "kitchen", perSlot: 12, updatedBy: "owner", updatedAt: "2026-09-14T03:00:00.000Z" } });
      if (url.includes("/api/queue/capacity"))
        return ok({ capacities: [{ station: "kitchen", perSlot: 10, updatedBy: null, updatedAt: "2026-09-14T03:00:00.000Z" }] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <StationQueuePage station="kitchen" canManageCapacity />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/กำลังผลิตฝ่ายครัว/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("กำลังผลิตใหม่ (งานต่อ 15 นาที)"), "12");
    await user.click(screen.getByRole("button", { name: "บันทึกกำลังผลิต" }));
    expect(await screen.findByText(/ตั้งกำลังผลิตฝ่ายครัว 12 งานต่อ 15 นาทีแล้ว/)).toBeInTheDocument();
  });
});

describe("หน้าติดตามคิวของลูกค้า (Ticket 09)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("Guest กรอกเลข+เบอร์แล้วเห็นสถานะภาษาไทยพร้อมเวลารอ", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/orders/lookup"))
        return ok({ order: { id: "order1", orderNumber: "ORD-20260914-AB12", total: 100, items: [] } });
      if (url.includes("/api/queue/order/"))
        return ok({ jobs: [{ ...kitchenJob, status: "preparing" }], orderNumber: "ORD-20260914-AB12" });
      return ok({});
    });
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/เลขคำสั่งซื้อ/), "ORD-20260914-AB12");
    await user.type(screen.getByLabelText(/เบอร์โทรที่ใช้สั่งซื้อ/), "0812345678");
    await user.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByText("กำลังทำ")).toBeInTheDocument();
    const item = (await screen.findByText("ข้าวผัดป้าอ้อ ×2")).closest("li");
    expect(item).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText(/กำลังทำโดยประมาณอีก 15 นาที/)).toBeInTheDocument();
  });

  it("งานพร้อมส่งมอบแสดงข้อความรอเสิร์ฟ", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/orders/lookup"))
        return ok({ order: { id: "order1", orderNumber: "ORD-20260914-AB12", total: 100, items: [] } });
      if (url.includes("/api/queue/order/"))
        return ok({ jobs: [{ ...kitchenJob, status: "ready", readyQty: 2 }], orderNumber: "ORD-20260914-AB12" });
      return ok({});
    });
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/เลขคำสั่งซื้อ/), "ORD-20260914-AB12");
    await user.type(screen.getByLabelText(/เบอร์โทรที่ใช้สั่งซื้อ/), "0812345678");
    await user.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByText("พร้อมส่งมอบ")).toBeInTheDocument();
    expect(await screen.findByText(/พนักงานกำลังนำไปเสิร์ฟ/)).toBeInTheDocument();
  });

  it("ยังไม่กรอกเลขและเบอร์แจ้งเตือนก่อนเรียก API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ok({}));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณากรอกเลขคำสั่งซื้อและเบอร์โทรที่ใช้สั่งซื้อ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("คิวยังไม่เข้าแสดงข้อความรอชำระ", async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.includes("/api/orders/lookup"))
        return ok({ order: { id: "order1", orderNumber: "ORD-20260914-AB12", total: 100, items: [] } });
      if (url.includes("/api/queue/order/")) return ok({ jobs: [], orderNumber: "ORD-20260914-AB12" });
      return ok({});
    });
    render(
      <MemoryRouter>
        <QueueTrackPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/เลขคำสั่งซื้อ/), "ORD-20260914-AB12");
    await user.type(screen.getByLabelText(/เบอร์โทรที่ใช้สั่งซื้อ/), "0812345678");
    await user.click(screen.getByRole("button", { name: "ติดตามคิว" }));
    expect(await screen.findByText(/ยังไม่เข้าคิว/)).toBeInTheDocument();
  });
});
