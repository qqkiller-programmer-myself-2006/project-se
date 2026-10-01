import type { QueueJob } from "../types.js";

/** สถานะของคำสั่งซื้อในคิวรวมที่แสดงสาธารณะ (Issue #43) */
export type PublicQueueStatus = "waiting" | "preparing" | "ready";

export interface PublicQueueEntry {
  /** รหัสย่อท้ายเลขคำสั่งซื้อ (เช่น "AB12") — ไม่พอใช้ค้นหาคำสั่งซื้อ (ต้องมีเบอร์โทรด้วย) */
  ref: string;
  status: PublicQueueStatus;
  /** จำนวนคำสั่งซื้อที่อยู่ก่อนหน้าในคิว (พร้อมรับ = 0) */
  ahead: number;
}

export interface PublicQueueSnapshot {
  entries: PublicQueueEntry[];
  counts: Record<PublicQueueStatus, number>;
}

/** สถานะที่ยังอยู่ในคิว (ยังไม่ส่งมอบ/ยกเลิก) */
export const PUBLIC_QUEUE_ACTIVE_STATUSES = ["queued", "claimed", "preparing", "ready"] as const;

/** รหัสย่อ: ส่วนท้ายหลังขีดสุดท้ายของเลขคำสั่งซื้อ (ไม่เปิดเผยเลขเต็ม) */
export function publicOrderRef(orderNumber: string): string {
  const tail = orderNumber.split("-").pop() ?? "";
  return (tail || orderNumber).slice(-6).toUpperCase();
}

/**
 * รวมงานคิวทุกฝ่าย (ครัว+เครื่องดื่ม) เป็นหนึ่งแถวต่อคำสั่งซื้อ โดยคืนเฉพาะข้อมูลที่ไม่ระบุตัวตน:
 * ห้ามมีชื่อ เบอร์โทร รายการอาหาร หรือ id ภายใน — whitelist ฟิลด์ที่คืนอย่างชัดเจน
 * - งาน preorder ที่ readyAt ยังไม่ถึงไม่นับว่าอยู่ในคิว (ยังไม่เริ่มทำ)
 * - ready = ทุกงานของออเดอร์ ready; waiting = ทุกงาน queued; อย่างอื่น = preparing
 * - ahead = จำนวนออเดอร์ที่ยังไม่ ready และเริ่มก่อน (เรียงตาม readyAt/createdAt)
 */
export function buildPublicQueue(jobs: readonly QueueJob[], now: Date, maxEntries = 100): PublicQueueSnapshot {
  const nowMs = now.getTime();
  const groups = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    if (job.status === "delivered" || job.status === "cancelled") continue;
    if (new Date(job.readyAt).getTime() > nowMs) continue;
    const list = groups.get(job.orderNumber);
    if (list) list.push(job);
    else groups.set(job.orderNumber, [job]);
  }

  const orders = [...groups.entries()].map(([orderNumber, list]) => {
    const status: PublicQueueStatus = list.every((j) => j.status === "ready")
      ? "ready"
      : list.every((j) => j.status === "queued")
        ? "waiting"
        : "preparing";
    const startedAt = Math.min(...list.map((j) => new Date(j.readyAt).getTime()));
    const createdAt = Math.min(...list.map((j) => new Date(j.createdAt).getTime()));
    return { orderNumber, status, startedAt, createdAt };
  });
  orders.sort((a, b) => a.startedAt - b.startedAt || a.createdAt - b.createdAt || a.orderNumber.localeCompare(b.orderNumber));

  const counts: Record<PublicQueueStatus, number> = { waiting: 0, preparing: 0, ready: 0 };
  let ahead = 0;
  const entries: PublicQueueEntry[] = [];
  for (const o of orders) {
    counts[o.status] += 1;
    if (o.status === "ready") {
      entries.push({ ref: publicOrderRef(o.orderNumber), status: o.status, ahead: 0 });
    } else {
      entries.push({ ref: publicOrderRef(o.orderNumber), status: o.status, ahead });
      ahead += 1;
    }
  }
  return { entries: entries.slice(0, maxEntries), counts };
}
