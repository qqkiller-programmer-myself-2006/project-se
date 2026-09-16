import { TABLE_ZONES, TABLE_ZONE_LABELS, type TableAvailability, type TableZone } from "../lib/api";

/**
 * ผังร้านสำหรับโมเดลสามมิติ — จำลองจากรูปถ่ายจริงของร้าน (สัดส่วนโดยประมาณ ไม่ใช่มาตราส่วนจริง)
 * พิกัดเป็นเมตร: x ไปทางขวาเมื่อยืนหน้าร้านมองเข้าไป, z ออกไปทางถนน, y ขึ้นบน
 * - ร้านหลัก x −3.5..3.5, z −6..5 (หน้าร้านเปิดโล่งที่ z = 5) · เคาน์เตอร์ชาใต้ชิดผนังขวาใกล้ทางเข้า
 * - บาร์หน้าครัวเป็นอาคารแยกด้านขวา · ศาลามุงจากอยู่ลานด้านซ้าย
 * โต๊ะจริงจาก API ถูกวางลง "ช่องวางโต๊ะ" ของโซนตามลำดับ; โต๊ะที่เกินจำนวนช่อง
 * หรือยังไม่กำหนดโซนจะแสดงเฉพาะในรายการ (ยังเลือกจองได้ตามปกติ)
 */
export type TableKind = "square" | "long" | "bar";
/** หน้าตาโต๊ะ/เก้าอี้ตามรูปจริงของแต่ละโซน */
export type TableStyle = "wood" | "folding" | "bar" | "sala";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TableSlot {
  /** y = ระดับพื้นตรงนั้น (พื้นในร้านยกสูงกว่าทางเท้า) */
  position: Vec3;
  rotation: number;
  kind: TableKind;
  style: TableStyle;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;
}

export interface ZonePhoto {
  src: string;
  alt: string;
  caption: string;
  orientation: "landscape" | "portrait";
  /** contain = แสดงครบทั้งรูป (ป้ายเมนูที่ต้องอ่านตัวหนังสือ) · ค่าเริ่มต้นเต็มกรอบ */
  fit?: "cover" | "contain";
  /** มุมกล้องในโมเดลที่ใกล้เคียงกับมุมถ่ายรูปนี้ */
  view: CameraView;
}

export interface VenueZone {
  id: TableZone;
  label: string;
  shortLabel: string;
  caption: string;
  photos: ZonePhoto[];
  /** ตำแหน่งป้ายชื่อโซนในภาพรวม */
  labelAnchor: Vec3;
  slots: TableSlot[];
}

export interface PlacedTable extends TableAvailability {
  zone: TableZone;
  slot: TableSlot;
}

export const SHOP_FLOOR_Y = 0.15;
export const KITCHEN_FLOOR_Y = 0.1;
export const SALA_FLOOR_Y = 0.2;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const OVERVIEW_VIEW: CameraView = { position: v(3.5, 17, 15.5), target: v(0.3, 0, 0.2) };

export const venueZones: VenueZone[] = [
  {
    id: "front",
    label: TABLE_ZONE_LABELS.front,
    shortLabel: "หน้าร้าน",
    caption: "โต๊ะติดทางเข้าและใต้กันสาดหน้าร้าน อยู่ข้างเคาน์เตอร์ชาใต้ เปิดโล่ง รับลม มองเห็นลานจอดรถ",
    photos: [
      {
        src: "/venue/reservations/storefront-seating.jpg",
        alt: "มองจากในร้านออกไปหน้าร้าน เห็นโต๊ะไม้ขาดำติดทางเข้าและกันสาดเมทัลชีท",
        caption: "มองจากในร้านออกไปหน้าร้าน — โต๊ะติดทางเข้าและใต้กันสาด",
        orientation: "landscape",
        view: { position: v(0.6, 4.6, -3.2), target: v(-0.6, 0, 5.4) },
      },
      {
        src: "/venue/reservations/counter.jpg",
        alt: "เคาน์เตอร์ไม้พาเลทของชาใต้ ผนังภาพร้านกาแฟอิฐ ข้างทางเข้าร้าน",
        caption: "เคาน์เตอร์ชาใต้ข้างทางเข้า — สั่งชา กาแฟ นมสดได้ที่นี่",
        orientation: "landscape",
        view: { position: v(-1.8, 3.2, 3.4), target: v(3, 1.1, 2.8) },
      },
      {
        src: "/venue/reservations/drink-menu.jpg",
        alt: "ป้ายเมนูชา กาแฟ และเครื่องดื่มบนเคาน์เตอร์ชาใต้",
        caption: "เมนูเครื่องดื่มที่เคาน์เตอร์ชาใต้",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(-0.4, 2.4, 2.9), target: v(2.4, 1.0, 2.9) },
      },
    ],
    labelAnchor: v(-0.6, 2.4, 5.4),
    slots: [
      { position: v(-1.4, SHOP_FLOOR_Y, 1.4), rotation: 0, kind: "square", style: "wood" },
      { position: v(-0.8, SHOP_FLOOR_Y, 3.8), rotation: 0, kind: "square", style: "wood" },
      { position: v(1.2, 0, 6.8), rotation: 0.08, kind: "square", style: "wood" },
      { position: v(-2.0, 0, 7.0), rotation: 0, kind: "square", style: "wood" },
    ],
  },
  {
    id: "dining",
    label: TABLE_ZONE_LABELS.dining,
    shortLabel: "ห้องอาหาร",
    caption: "ห้องอาหารในร้าน ผนังไม้มีป้ายร้านป้าอ้อ โต๊ะไม้ขาดำกับเก้าอี้ไม้ พื้นกระเบื้องขาว มีพัดลม",
    photos: [
      {
        src: "/venue/reservations/dining-room.jpg",
        alt: "ห้องอาหารของร้านป้าอ้อ ผนังไม้ด้านหลังมีป้ายร้าน โต๊ะไม้ขาดำหลายตัว",
        caption: "มองจากทางเข้าเข้าไปในห้องอาหาร",
        orientation: "landscape",
        view: { position: v(-0.6, 5.2, 6.2), target: v(-0.2, 0, -2.6) },
      },
      {
        src: "/venue/reservations/food-menu.jpg",
        alt: "ป้ายรายการอาหารตามสั่งที่ติดบนผนังห้องอาหาร",
        caption: "ป้ายเมนูอาหารตามสั่งบนผนังซ้ายของห้องอาหาร",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(0.8, 2.6, -0.6), target: v(-3.4, 1.7, -1.0) },
      },
      {
        src: "/venue/latest/real-menu-board.jpg",
        alt: "ป้ายเมนูและราคาปรับใหม่ของร้านป้าอ้อ",
        caption: "ราคาอาหาร: ธรรมดา 45 · หมูกรอบ/ทะเล 50 · พิเศษ 60",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(0.8, 2.6, -0.6), target: v(-3.4, 1.7, -1.0) },
      },
    ],
    labelAnchor: v(0, 3.4, -2.2),
    slots: [
      { position: v(-2.3, SHOP_FLOOR_Y, -4.4), rotation: 0, kind: "square", style: "wood" },
      { position: v(0.2, SHOP_FLOOR_Y, -4.4), rotation: 0, kind: "square", style: "wood" },
      { position: v(2.6, SHOP_FLOOR_Y, -4.4), rotation: 0, kind: "square", style: "wood" },
      { position: v(-2.3, SHOP_FLOOR_Y, -1.8), rotation: 0, kind: "square", style: "wood" },
      { position: v(0.2, SHOP_FLOOR_Y, -1.8), rotation: 0, kind: "square", style: "wood" },
      { position: v(2.6, SHOP_FLOOR_Y, -1.8), rotation: 0, kind: "square", style: "wood" },
    ],
  },
  {
    id: "kitchen",
    label: TABLE_ZONE_LABELS.kitchen,
    shortLabel: "บาร์หน้าครัว",
    caption: "อาคารครัวข้างร้าน พื้นกระเบื้องน้ำตาล บาร์ไม้ริมหน้าต่างพร้อมเก้าอี้สูง โต๊ะพับยาวกับเก้าอี้พลาสติก หันหน้าเข้าซุ้มครัว",
    photos: [
      {
        src: "/venue/latest/real-counter-seating.jpg",
        alt: "โซนหน้าครัว บาร์ไม้ริมรั้ว โต๊ะพับยาว เก้าอี้พลาสติกสีเทา และซุ้มครัวด้านหลัง",
        caption: "บาร์ริมหน้าต่าง (ซ้าย) และโต๊ะพับยาว มองไปทางซุ้มครัว",
        orientation: "landscape",
        view: { position: v(7.3, 3.8, 4.4), target: v(9.3, 0.4, -4) },
      },
      {
        src: "/venue/latest/real-menu-counter.jpg",
        alt: "ซุ้มครัวร้านป้าอ้อ มีป้ายเมนูภาพอาหารด้านบนและรายการอาหารด้านหน้า",
        caption: "ซุ้มครัว — สั่งอาหารตามสั่งได้ที่นี่",
        orientation: "landscape",
        view: { position: v(9, 2.8, -0.6), target: v(9, 1.3, -5.2) },
      },
    ],
    labelAnchor: v(9, 3.8, -1.4),
    slots: [
      // บาร์ไม้ริมหน้าต่างด้านซ้าย (เก้าอี้หันออกหน้าต่าง) + โต๊ะพับยาววางตามแนวลึกไปทางซุ้มครัว
      { position: v(6.6, KITCHEN_FLOOR_Y, -1.2), rotation: Math.PI / 2, kind: "bar", style: "bar" },
      { position: v(9.2, KITCHEN_FLOOR_Y, 0.7), rotation: Math.PI / 2, kind: "long", style: "folding" },
      { position: v(9.2, KITCHEN_FLOOR_Y, -2.3), rotation: Math.PI / 2, kind: "long", style: "folding" },
    ],
  },
  {
    id: "sala",
    label: TABLE_ZONE_LABELS.sala,
    shortLabel: "ศาลา",
    caption: "ศาลาหลังคามุงจากโครงไม้ ลานปูนกลางแจ้ง โต๊ะไม้กับเก้าอี้ขาเหล็ก บรรยากาศสบาย ๆ",
    photos: [
      {
        src: "/venue/latest/real-outdoor-seating.jpg",
        alt: "ศาลาหลังคามุงจาก โต๊ะไม้และเก้าอี้ขาเหล็ก มีชั้นวางแก้วสีฟ้า",
        caption: "มองจากลานด้านหน้าเข้าไปใต้ศาลา",
        orientation: "portrait",
        view: { position: v(-8.3, 4.2, 5.4), target: v(-8.3, 0.4, -2.4) },
      },
    ],
    labelAnchor: v(-8.25, 4.6, -2),
    slots: [
      { position: v(-9.6, SALA_FLOOR_Y, -2.8), rotation: 0, kind: "square", style: "sala" },
      { position: v(-7.1, SALA_FLOOR_Y, -2.2), rotation: 0.1, kind: "square", style: "sala" },
      { position: v(-8.8, SALA_FLOOR_Y, -0.2), rotation: 0, kind: "square", style: "sala" },
    ],
  },
];

export function getZone(id: string | null | undefined): VenueZone | undefined {
  return venueZones.find((zone) => zone.id === id);
}

/** มุมกล้องของโซน (ตามรูปที่เลือก) หรือภาพรวมทั้งร้าน */
export function getZoneView(id: string | null, photoIndex = 0): CameraView {
  const zone = getZone(id);
  if (!zone) return OVERVIEW_VIEW;
  return (zone.photos[photoIndex] ?? zone.photos[0]!).view;
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
  { name: "F3", capacity: 4, zone: "front" },
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
