import { TABLE_ZONES, TABLE_ZONE_LABELS, type TableAvailability, type TableZone } from "../lib/api";

/**
 * ผังร้านสำหรับโมเดลสามมิติ — วาดจากรูปถ่ายจริงของร้าน (ไม่ใช่มาตราส่วนจริง)
 * โต๊ะจริงจาก API ถูกวางลง "ช่องวางโต๊ะ" ของโซนตามลำดับชื่อ; โต๊ะที่เกินจำนวนช่อง
 * หรือยังไม่กำหนดโซนจะแสดงเฉพาะในรายการ (ยังเลือกจองได้ตามปกติ)
 */
export type TableKind = "square" | "long" | "bar";

export interface TableSlot {
  position: { x: number; z: number };
  rotation: number;
  kind: TableKind;
}

export interface VenueZone {
  id: TableZone;
  label: string;
  shortLabel: string;
  photo: string;
  caption: string;
  /** จุดที่กล้องมองเมื่อเลือกโซนนี้ */
  focusCenter: { x: number; y: number; z: number };
  focusDistance: number;
  slots: TableSlot[];
}

export interface PlacedTable extends TableAvailability {
  zone: TableZone;
  slot: TableSlot;
}

export const venueZones: VenueZone[] = [
  {
    id: "front",
    label: TABLE_ZONE_LABELS.front,
    shortLabel: "หน้าร้าน",
    photo: "/venue/reservations/storefront-seating.jpg",
    caption: "โต๊ะหน้าร้านใต้กันสาด เปิดโล่ง รับลม มองเห็นลานจอดรถ",
    focusCenter: { x: 0, y: 0.4, z: 8.2 },
    focusDistance: 11,
    slots: [
      { position: { x: -1.8, z: 8 }, rotation: 0, kind: "square" },
      { position: { x: 1.8, z: 9.2 }, rotation: 0.2, kind: "square" },
      { position: { x: 1.4, z: 6.6 }, rotation: 0, kind: "square" },
    ],
  },
  {
    id: "dining",
    label: TABLE_ZONE_LABELS.dining,
    shortLabel: "ห้องอาหาร",
    photo: "/venue/reservations/dining-room.jpg",
    caption: "ห้องอาหารในร้าน ผนังไม้ โต๊ะไม้เก้าอี้ไม้ พื้นกระเบื้องสะอาดตา",
    focusCenter: { x: 0, y: 0.4, z: 0 },
    focusDistance: 12,
    slots: [
      { position: { x: -2.8, z: -1.5 }, rotation: 0, kind: "square" },
      { position: { x: 0, z: -1.5 }, rotation: 0, kind: "square" },
      { position: { x: 2.8, z: -1.5 }, rotation: 0, kind: "square" },
      { position: { x: -2.8, z: 1.6 }, rotation: 0, kind: "square" },
      { position: { x: 0, z: 1.6 }, rotation: 0, kind: "square" },
      { position: { x: 2.8, z: 1.6 }, rotation: 0, kind: "square" },
    ],
  },
  {
    id: "kitchen",
    label: TABLE_ZONE_LABELS.kitchen,
    shortLabel: "บาร์หน้าครัว",
    photo: "/venue/latest/real-counter-seating.jpg",
    caption: "บาร์ไม้ยาวริมหน้าต่างและโต๊ะยาวสำหรับกลุ่มใหญ่ ใกล้ครัว",
    focusCenter: { x: 9, y: 0.4, z: -1.2 },
    focusDistance: 11,
    slots: [
      { position: { x: 10.9, z: 1.0 }, rotation: -Math.PI / 2, kind: "bar" },
      { position: { x: 8.6, z: -0.6 }, rotation: 0, kind: "long" },
      { position: { x: 8.6, z: -3.4 }, rotation: 0, kind: "long" },
    ],
  },
  {
    id: "sala",
    label: TABLE_ZONE_LABELS.sala,
    shortLabel: "ศาลา",
    photo: "/venue/latest/real-outdoor-seating.jpg",
    caption: "ศาลาหลังคามุงจากกลางแจ้ง บรรยากาศสบาย ๆ แบบบ้านสวน",
    focusCenter: { x: -9, y: 0.4, z: -1.7 },
    focusDistance: 10,
    slots: [
      { position: { x: -10.3, z: -1.9 }, rotation: 0.3, kind: "square" },
      { position: { x: -7.7, z: -1.5 }, rotation: -0.2, kind: "square" },
    ],
  },
];

export const teaCounterLandmark = {
  name: "เคาน์เตอร์ชาใต้",
  photo: "/venue/reservations/counter.jpg",
  caption: "เคาน์เตอร์ชาใต้หน้าร้าน สั่งเครื่องดื่มเพิ่มได้ระหว่างนั่ง",
  position: { x: -4.2, z: 6.4 },
};

export const OVERVIEW_FOCUS = { center: { x: 0.5, y: 0, z: 0.5 }, distance: 24 };

export function getZone(id: string | null | undefined): VenueZone | undefined {
  return venueZones.find((zone) => zone.id === id);
}

export function getZoneFocus(id: string | null): { center: { x: number; y: number; z: number }; distance: number } {
  const zone = getZone(id);
  return zone ? { center: zone.focusCenter, distance: zone.focusDistance } : OVERVIEW_FOCUS;
}

/** วางโต๊ะจริงลงช่องของแต่ละโซน (คงลำดับตามที่ API ส่งมา) */
export function placeTables(tables: TableAvailability[]): { placed: PlacedTable[]; unplaced: TableAvailability[] } {
  const used = new Map<TableZone, number>();
  const placed: PlacedTable[] = [];
  const unplaced: TableAvailability[] = [];
  for (const table of tables) {
    const zone = table.zone ? getZone(table.zone) : undefined;
    const index = zone ? (used.get(zone.id) ?? 0) : 0;
    const slot = zone?.slots[index];
    if (!zone || !slot) {
      unplaced.push(table);
      continue;
    }
    used.set(zone.id, index + 1);
    placed.push({ ...table, zone: zone.id, slot });
  }
  return { placed, unplaced };
}

export interface ZoneSummary {
  zone: TableZone | null;
  total: number;
  available: number;
}

/** จำนวนโต๊ะทั้งหมด/ที่เลือกได้ต่อโซน (ลำดับตาม TABLE_ZONES และ null ท้ายสุด) */
export function summarizeZones(tables: TableAvailability[]): ZoneSummary[] {
  const keys: (TableZone | null)[] = [...TABLE_ZONES, null];
  return keys
    .map((zone) => {
      const inZone = tables.filter((t) => (t.zone ?? null) === zone);
      return { zone, total: inZone.length, available: inZone.filter((t) => t.status === "available").length };
    })
    .filter((s) => s.zone !== null || s.total > 0);
}

const DEMO_LAYOUT: { name: string; capacity: number; zone: TableZone; booked?: boolean }[] = [
  { name: "F1", capacity: 4, zone: "front" },
  { name: "F2", capacity: 4, zone: "front", booked: true },
  { name: "D1", capacity: 2, zone: "dining" },
  { name: "D2", capacity: 4, zone: "dining" },
  { name: "D3", capacity: 4, zone: "dining", booked: true },
  { name: "D4", capacity: 6, zone: "dining" },
  { name: "D5", capacity: 4, zone: "dining" },
  { name: "K1", capacity: 4, zone: "kitchen" },
  { name: "K2", capacity: 6, zone: "kitchen" },
  { name: "K3", capacity: 8, zone: "kitchen" },
  { name: "S1", capacity: 4, zone: "sala" },
  { name: "S2", capacity: 6, zone: "sala" },
];

/** ผังตัวอย่างสำหรับโหมดสาธิต/ออฟไลน์ (id ขึ้นต้น demo- — จองจริงไม่ได้) */
export function demoAvailability(partySize: number): { tables: TableAvailability[]; recommendedTableId: string | null } {
  const tables = DEMO_LAYOUT.map<TableAvailability>((t) => ({
    id: `demo-${t.name.toLowerCase()}`,
    name: t.name,
    capacity: t.capacity,
    zone: t.zone,
    status: t.booked ? "booked" : t.capacity < partySize ? "too_small" : "available",
  }));
  const recommended = tables
    .filter((t) => t.status === "available")
    .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name, "th", { numeric: true }))[0];
  return { tables, recommendedTableId: recommended?.id ?? null };
}

export function isDemoTableId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("demo-");
}
