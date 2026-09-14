import type { Store } from "../store.js";
import type { OccupancySnapshot } from "../shop/occupancy.js";
import { sanitizeOccupancy } from "../shop/occupancy.js";

/**
 * Occupancy provider ที่อ่านจากรอบการใช้โต๊ะจริง (Ticket 06)
 * - โต๊ะที่ถูกใช้ = จำนวนรอบสถานะ open (หนึ่งรอบต่อหนึ่งโต๊ะ)
 * - ผู้ใช้บริการ = ผลรวม partySize ของรอบที่เปิดอยู่
 * - ใช้ประกอบ public snapshot `/api/shop/status` โดยไม่เปิดเผยข้อมูลลูกค้า
 */
export function createStoreOccupancyProvider(store: Store): () => Promise<OccupancySnapshot> {
  return async () => {
    const rounds = await store.listTableRounds({ status: "open", limit: 200 });
    const occupiedTables = rounds.length;
    const customerCount = rounds.reduce((s, r) => s + r.partySize, 0);
    return sanitizeOccupancy({ occupiedTables, customerCount });
  };
}
