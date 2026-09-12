/**
 * Occupancy snapshot seam (Ticket 02)
 * - Ticket 02 ยังไม่มี module รอบการใช้โต๊ะ จึงนิยาม provider แคบ ๆ สำหรับ
 *   จำนวนโต๊ะที่ถูกใช้ + จำนวนผู้ใช้บริการปัจจุบัน
 * - ค่าเริ่มต้นคือ zero (โต๊ะพร้อมใช้งานทั้งหมดถือว่าว่าง, ผู้ใช้บริการเป็น 0)
 * - Ticket ถัดไป (รอบการใช้โต๊ะ) มา implements provider นี้โดยไม่ต้องแตะ public DTO
 */

export interface OccupancySnapshot {
  occupiedTables: number;
  customerCount: number;
}

export type OccupancyProvider = () => Promise<OccupancySnapshot> | OccupancySnapshot;

export const zeroOccupancyProvider: OccupancyProvider = () => ({
  occupiedTables: 0,
  customerCount: 0,
});

export function sanitizeOccupancy(raw: unknown): OccupancySnapshot {
  const o = (raw ?? {}) as { occupiedTables?: unknown; customerCount?: unknown };
  const occupied = Number(o.occupiedTables);
  const customers = Number(o.customerCount);
  return {
    occupiedTables: Number.isFinite(occupied) && occupied > 0 ? Math.floor(occupied) : 0,
    customerCount: Number.isFinite(customers) && customers > 0 ? Math.floor(customers) : 0,
  };
}
