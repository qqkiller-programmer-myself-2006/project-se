import { TABLE_ZONES, TABLE_ZONE_LABELS, type TableAvailability, type TableZone } from "../lib/api";

/**
 * ผังร้านสำหรับผังสองมิติและโมเดลสามมิติ — วางตามแบบผังที่เจ้าของร้านวาดและรูปถ่ายจริง (สัดส่วนโดยประมาณ)
 * ถนนลาดยางอยู่ด้านซ้าย (x < −9) · ลานจอดรถลูกรังอยู่ด้านหน้า (z > 3)
 * พิกัดเป็นเมตร: x ไปทางขวาเมื่อยืนที่ลานจอดรถมองเข้าร้าน, z ออกไปทางถนน (ล่างของผัง), y ขึ้นบน
 *
 *   ┌──────── ครัว/บาร์หน้าครัว ────────┬────────── ห้องอาหาร ─────[ห้องน้ำ]┐
 *   │ [ซุ้มครัว]                        │  โต๊ะ 2 แถว × 3               [บาร์น้ำ]│
 *   │ บาร์ริมหน้าต่าง · โต๊ะยาว · โต๊ะเล็ก │                                     │
 *   ├──────────── ศาลา ─────────────┐  ├────────── หน้าร้าน (ใต้กันสาด) ───────┤
 *   │ [น้ำแข็ง/แก้ว] โต๊ะ 4 ชุด           │  │  โต๊ะ 2 ตัว                           │
 *   └───────────────────────────┘  └─────────────── ลานจอดรถ / ถนน ─────────┘
 *
 * โต๊ะจริงจาก API ถูกวางลง "ช่องวางโต๊ะ" ของโซนตามลำดับ; โต๊ะที่เกินจำนวนช่อง
 * หรือยังไม่กำหนดโซนจะแสดงเฉพาะในรายการ (ยังเลือกจองได้ตามปกติ)
 */
export type TableKind = "square" | "long" | "bar";
/** หน้าตาโต๊ะ/เก้าอี้ตามรูปจริงของแต่ละโซน */
export type TableStyle = "wood" | "dark" | "folding" | "bar" | "sala";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** สี่เหลี่ยมบนพื้น (เมตร) */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TableSlot {
  /** y = ระดับพื้นตรงนั้น */
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
  /** ลำดับบนผัง (1–4) */
  number: number;
  label: string;
  shortLabel: string;
  caption: string;
  /** สิ่งที่ลูกค้าควรรู้ในโซน (แสดงเป็นป้ายสั้น ๆ) */
  highlights: string[];
  bounds: Rect;
  /** มุมกล้องเริ่มต้น เห็นโต๊ะทั้งโซนชัด ๆ */
  overview: CameraView;
  photos: ZonePhoto[];
  slots: TableSlot[];
}

export type LandmarkKind = "kitchen" | "drinks" | "ice" | "restroom";

/** จุดสำคัญในร้าน สีตรงกับผังที่เจ้าของร้านวาด */
export interface Landmark {
  id: LandmarkKind;
  label: string;
  zone: TableZone;
  bounds: Rect;
  /** ตำแหน่งป้ายลอยในโมเดลสามมิติ */
  anchor: Vec3;
}

export interface PlacedTable extends TableAvailability {
  zone: TableZone;
  slot: TableSlot;
}

export const SHOP_FLOOR_Y = 0.15;
export const FRONT_FLOOR_Y = 0.08;
export const KITCHEN_FLOOR_Y = 0.1;
export const SALA_FLOOR_Y = 0.2;

/** ขอบเขตทั้งร้านรวมลานจอดรถ (ใช้กับผังสองมิติ) */
export const VENUE_BOUNDS: Rect = { x0: -8.8, x1: 9.8, z0: -10, z1: 8.6 };

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const landmarks: Landmark[] = [
  {
    id: "kitchen",
    label: "ครัว · สั่งอาหาร",
    zone: "kitchen",
    bounds: { x0: -6.9, x1: -2.2, z0: -6.8, z1: -4.0 },
    anchor: v(-4.55, 3.3, -5.4),
  },
  {
    id: "drinks",
    label: "บาร์น้ำ ชาใต้",
    zone: "dining",
    bounds: { x0: 8.15, x1: 9.1, z0: -3.5, z1: -0.1 },
    anchor: v(8.6, 2.3, -1.8),
  },
  {
    id: "ice",
    label: "น้ำแข็ง · แก้วน้ำ",
    zone: "sala",
    bounds: { x0: -8.2, x1: -6.1, z0: 0.3, z1: 1.6 },
    anchor: v(-7.2, 2.5, 0.9),
  },
  {
    id: "restroom",
    label: "ห้องน้ำ",
    zone: "dining",
    bounds: { x0: 6.9, x1: 9.2, z0: -9.5, z1: -7.5 },
    anchor: v(8.05, 3.1, -8.5),
  },
];

export const venueZones: VenueZone[] = [
  {
    id: "front",
    number: 1,
    label: TABLE_ZONE_LABELS.front,
    shortLabel: "หน้าร้าน",
    caption: "แถวหน้าสุดใต้กันสาด ติดทางเข้าและลานจอดรถ เปิดโล่ง รับลม เข้า-ออกสะดวก",
    highlights: ["โต๊ะเดียว 4 ที่นั่ง", "ติดทางเข้า", "ใกล้ที่จอดรถ"],
    bounds: { x0: 0.1, x1: 9.2, z0: 0.6, z1: 3.1 },
    overview: { position: v(4.7, 7.2, 11.0), target: v(4.7, 0.3, 1.2) },
    photos: [
      {
        src: "/venue/site/front-dining-view.jpg",
        alt: "โต๊ะไม้ท็อปส้มขาดำหน้าร้าน มองผ่านประตูกระจกเข้าไปเห็นห้องอาหาร เคาน์เตอร์ชาใต้ด้านขวา",
        caption: "โต๊ะหน้าร้านติดประตู มองเข้าไปเห็นห้องอาหารและบาร์น้ำ",
        orientation: "landscape",
        view: { position: v(4.6, 1.9, 6.2), target: v(4.6, 1.0, -4.0) },
      },
      {
        src: "/venue/site/front-banner.jpg",
        alt: "หน้าร้านใต้ป้ายไวนิลอาหารและเครื่องดื่ม มีโต๊ะหน้าร้านและมอเตอร์ไซค์จอดอยู่ด้านหน้า",
        caption: "ใต้ป้ายไวนิลหน้าร้าน — จอดมอเตอร์ไซค์ได้ติดโต๊ะ",
        orientation: "landscape",
        view: { position: v(3.2, 2.2, 8.2), target: v(4.4, 1.3, -1.5) },
      },
      {
        src: "/venue/reservations/storefront-seating.jpg",
        alt: "มองจากในร้านออกไปหน้าร้าน เห็นโต๊ะไม้ขาดำติดทางเข้า",
        caption: "มองจากในร้านออกไปหน้าร้าน",
        orientation: "landscape",
        view: { position: v(4.4, 4.4, -4.6), target: v(4.7, 0, 2.0) },
      },
      {
        src: "/venue/site/exterior-from-parking.jpg",
        alt: "ภาพรวมร้านจากลานจอดรถ ศาลามุงจากคลุมผ้าใบด้านซ้าย ห้องอาหารในอาคาร 3 ขวัญใจด้านขวา",
        caption: "มองจากลานจอดรถ: ศาลา (ซ้าย) และหน้าร้านอาคาร 3 ขวัญใจ",
        orientation: "landscape",
        view: { position: v(1.5, 2.4, 17.0), target: v(0.8, 1.4, 0.5) },
      },
      {
        src: "/venue/site/parking-lot.jpg",
        alt: "ลานจอดรถลูกรังกว้างหน้าร้าน มีต้นไม้กลางลาน ฝั่งตรงข้ามเป็นอาคารพาณิชย์สองชั้น",
        caption: "ลานจอดรถกว้างหน้าร้าน จอดได้ทั้งรถยนต์และมอเตอร์ไซค์",
        orientation: "landscape",
        view: { position: v(4.0, 1.9, 3.4), target: v(4.5, 1.4, 14.0) },
      },
    ],
    slots: [
      // หน้าร้านมีโต๊ะเดียว (4 ที่นั่ง) หน้าประตูกระจก
      { position: v(4.0, FRONT_FLOOR_Y, 1.85), rotation: 0, kind: "square", style: "wood" },
    ],
  },
  {
    id: "dining",
    number: 2,
    label: TABLE_ZONE_LABELS.dining,
    shortLabel: "ห้องอาหาร",
    caption: "ห้องอาหารในอาคาร 3 ขวัญใจ ผนังไม้มีป้ายร้านป้าอ้อ โต๊ะไม้ 6 ตัว พื้นกระเบื้องขาว มีพัดลม บาร์น้ำชาใต้อยู่ขวามือติดทางเข้า ห้องน้ำอยู่หลังประตูม่าน Coffee in love",
    highlights: ["มีบาร์น้ำในห้อง", "ใกล้ห้องน้ำ", "มีพัดลม"],
    bounds: { x0: 0.1, x1: 9.2, z0: -7.5, z1: 0.6 },
    overview: { position: v(4.6, 8.2, 5.2), target: v(4.6, 0.2, -3.6) },
    photos: [
      {
        src: "/venue/reservations/dining-room.jpg",
        alt: "ห้องอาหารของร้านป้าอ้อ ผนังไม้ด้านหลังมีป้ายร้าน โต๊ะไม้ขาดำหลายตัว",
        caption: "มองจากทางเข้าเข้าไปในห้องอาหาร",
        orientation: "landscape",
        view: { position: v(4.6, 3.6, 3.2), target: v(4.4, 0.8, -6.0) },
      },
      {
        src: "/venue/reservations/counter.jpg",
        alt: "เคาน์เตอร์ไม้พาเลทของชาใต้ ผนังภาพร้านกาแฟอิฐ ชิดผนังขวาของห้องอาหาร",
        caption: "บาร์น้ำชาใต้ชิดผนังขวา — สั่งชา กาแฟ นมสดได้ที่นี่",
        orientation: "landscape",
        view: { position: v(3.8, 2.6, 0.4), target: v(8.7, 1.1, -1.8) },
      },
      {
        src: "/venue/reservations/drink-menu.jpg",
        alt: "ป้ายเมนูชา กาแฟ และเครื่องดื่มบนบาร์น้ำชาใต้",
        caption: "เมนูเครื่องดื่มที่บาร์น้ำชาใต้",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(6.4, 2.3, -1.8), target: v(8.7, 1.3, -1.8) },
      },
      {
        src: "/venue/reservations/food-menu.jpg",
        alt: "ป้ายรายการอาหารตามสั่งที่ติดบนผนังห้องอาหาร",
        caption: "ป้ายเมนูอาหารตามสั่งบนผนังซ้ายของห้องอาหาร",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(4.2, 2.6, -4.4), target: v(0.2, 1.8, -4.4) },
      },
      {
        src: "/venue/latest/real-menu-board.jpg",
        alt: "ป้ายเมนูและราคาปรับใหม่ของร้านป้าอ้อ",
        caption: "ราคาอาหาร: ธรรมดา 45 · หมูกรอบ/ทะเล 50 · พิเศษ 60",
        orientation: "portrait",
        fit: "contain",
        view: { position: v(4.2, 2.6, -2.4), target: v(0.2, 1.8, -2.2) },
      },
    ],
    slots: [
      // แถวซ้ายโต๊ะไม้สีเข้ม · แถวกลางโต๊ะท็อปส้มขาดำ (ตามรูปจริง)
      { position: v(2.5, SHOP_FLOOR_Y, -6.3), rotation: 0, kind: "square", style: "dark" },
      { position: v(6.0, SHOP_FLOOR_Y, -6.3), rotation: 0, kind: "square", style: "wood" },
      { position: v(2.5, SHOP_FLOOR_Y, -3.9), rotation: 0, kind: "square", style: "dark" },
      { position: v(6.0, SHOP_FLOOR_Y, -3.9), rotation: 0, kind: "square", style: "wood" },
      { position: v(2.5, SHOP_FLOOR_Y, -1.5), rotation: 0, kind: "square", style: "dark" },
      { position: v(6.0, SHOP_FLOOR_Y, -1.5), rotation: 0, kind: "square", style: "wood" },
    ],
  },
  {
    id: "kitchen",
    number: 3,
    label: TABLE_ZONE_LABELS.kitchen,
    shortLabel: "บาร์หน้าครัว",
    caption: "ห้องติดซุ้มครัว พื้นกระเบื้องน้ำตาล บาร์ไม้ริมหน้าต่างมองถนน โต๊ะพับกับเก้าอี้พลาสติก และผนังภาพเมนูอาหาร อาหารร้อนถึงโต๊ะไว",
    highlights: ["ติดซุ้มครัว", "บาร์ริมหน้าต่าง", "โต๊ะพับ"],
    bounds: { x0: -8.2, x1: -0.1, z0: -7.2, z1: -0.1 },
    overview: { position: v(-2.4, 6.4, 3.6), target: v(-4.4, 0.3, -3.4) },
    photos: [
      {
        src: "/venue/site/kitchen-stall-tables.jpg",
        alt: "ซุ้มครัวไม้อัดติดโปสเตอร์เมนู ป้ายภาพอาหารด้านบน โต๊ะพับลายไม้กับเก้าอี้พลาสติกสีเทาชิดผนังที่มีภาพอาหาร",
        caption: "ซุ้มครัว (ซ้าย) และโต๊ะพับชิดผนังภาพอาหาร",
        orientation: "landscape",
        view: { position: v(-2.2, 2.2, 0.6), target: v(-3.4, 0.9, -5.0) },
      },
      {
        src: "/venue/site/kitchen-window-bar.jpg",
        alt: "บาร์ไม้ยาวริมหน้าต่างติดถนน รั้วระแนงหัวมน เก้าอี้ขาเหล็กสีขาว ผ้าใบดำด้านบน ถังน้ำสีฟ้านอกหน้าต่าง",
        caption: "บาร์ริมหน้าต่าง นั่งมองถนน — ซุ้มครัวอยู่ขวามือ",
        orientation: "landscape",
        view: { position: v(-5.6, 1.9, -0.4), target: v(-8.2, 0.9, -3.4) },
      },
      {
        src: "/venue/latest/real-counter-seating.jpg",
        alt: "โซนหน้าครัว บาร์ไม้ริมรั้ว โต๊ะพับยาว เก้าอี้พลาสติกสีเทา และซุ้มครัวด้านหลัง",
        caption: "บาร์ริมหน้าต่าง (ซ้าย) และโต๊ะพับยาว มองไปทางซุ้มครัว",
        orientation: "landscape",
        view: { position: v(-3.0, 4.2, 2.4), target: v(-5.0, 0.4, -4.4) },
      },
      {
        src: "/venue/latest/real-menu-counter.jpg",
        alt: "ซุ้มครัวร้านป้าอ้อ มีป้ายเมนูภาพอาหารด้านบนและรายการอาหารด้านหน้า",
        caption: "ซุ้มครัว — สั่งอาหารตามสั่งได้ที่นี่",
        orientation: "landscape",
        view: { position: v(-4.4, 2.6, -0.8), target: v(-4.5, 1.4, -4.6) },
      },
      {
        src: "/venue/site/kitchen-roadside.jpg",
        alt: "ด้านข้างร้านติดถนน รั้วไม้ระแนงของบาร์หน้าครัว ต้นลีลาวดี และป้ายหรอยจังฮู้",
        caption: "ด้านติดถนน: รั้วไม้ของบาร์หน้าครัวและป้ายหรอยจังฮู้",
        orientation: "landscape",
        view: { position: v(-11.8, 2.1, 4.5), target: v(-8.4, 1.2, -3.0) },
      },
    ],
    slots: [
      // บาร์ไม้ชิดหน้าต่างซ้าย (เก้าอี้หันออกหน้าต่าง) · โต๊ะพับยาวกลางห้อง · โต๊ะเล็กชิดผนังห้องอาหาร
      { position: v(-7.55, KITCHEN_FLOOR_Y, -2.0), rotation: Math.PI / 2, kind: "bar", style: "bar" },
      { position: v(-2.9, KITCHEN_FLOOR_Y, -1.3), rotation: 0, kind: "long", style: "folding" },
      { position: v(-1.05, KITCHEN_FLOOR_Y, -3.2), rotation: Math.PI / 2, kind: "square", style: "folding" },
    ],
  },
  {
    id: "sala",
    number: 4,
    label: TABLE_ZONE_LABELS.sala,
    shortLabel: "ศาลา",
    caption: "ศาลาหลังคามุงจากคลุมผ้าใบ โครงไม้ดิบ รั้วไม้ไผ่ โต๊ะไม้ 4 ชุด มีจุดน้ำแข็งและแก้วน้ำที่มุมติดถนน ลมโกรก สบาย ๆ",
    highlights: ["หลังคามุงจาก", "มีจุดน้ำแข็ง/แก้ว", "โต๊ะ 6 ที่นั่ง (S4)"],
    bounds: { x0: -8.2, x1: -0.5, z0: 0.3, z1: 6.8 },
    overview: { position: v(-0.6, 7.6, 10.4), target: v(-4.4, 0.3, 3.3) },
    photos: [
      {
        src: "/venue/site/sala-inside.jpg",
        alt: "ใต้ศาลามุงจากโครงไม้ดิบ มองจากฝั่งครัวออกไปทางลานจอดรถ โต๊ะไม้กับเก้าอี้ขาเหล็กสีขาว ชั้นแก้วสีฟ้าและถังน้ำแข็งสีแดงด้านขวา",
        caption: "ใต้ศาลา — ชั้นแก้วสีฟ้าและถังน้ำแข็งสีแดงอยู่ขวามือ",
        orientation: "landscape",
        view: { position: v(-4.2, 1.9, -0.9), target: v(-4.6, 0.9, 7.2) },
      },
      {
        src: "/venue/site/sala-ice-station.jpg",
        alt: "จุดบริการน้ำแข็ง ถังน้ำแข็งสีแดงในคอกไม้ระแนง ชั้นแก้วสีฟ้า ติดถนน",
        caption: "จุดน้ำแข็งและแก้วน้ำ ตักเองได้ มุมศาลาติดถนน",
        orientation: "landscape",
        view: { position: v(-5.0, 2.1, 2.6), target: v(-7.7, 0.9, 0.9) },
      },
      {
        src: "/venue/site/sala-side.jpg",
        alt: "ศาลาหลังคามุงจากคลุมผ้าใบดำ รั้วไม้ไผ่และไม้กระถางรอบศาลา ด้านขวาเห็นบาร์หน้าครัว",
        caption: "ศาลาจากลานจอดรถ มีรั้วไม้ไผ่ ข้างศาลาคือบาร์หน้าครัว",
        orientation: "landscape",
        view: { position: v(1.2, 2.3, 6.8), target: v(-4.6, 1.0, 2.6) },
      },
      {
        src: "/venue/latest/real-outdoor-seating.jpg",
        alt: "ศาลาหลังคามุงจาก โต๊ะไม้และเก้าอี้ขาเหล็ก มีชั้นวางแก้วสีฟ้า",
        caption: "ศาลากับลูกค้ากลุ่มใหญ่",
        orientation: "portrait",
        view: { position: v(-4.4, 2.4, 9.6), target: v(-5.2, 0.9, 1.6) },
      },
    ],
    slots: [
      { position: v(-5.3, SALA_FLOOR_Y, 2.4), rotation: 0, kind: "square", style: "sala" },
      { position: v(-2.6, SALA_FLOOR_Y, 1.9), rotation: 0, kind: "square", style: "sala" },
      { position: v(-6.6, SALA_FLOOR_Y, 5.0), rotation: 0, kind: "square", style: "sala" },
      // S4 โต๊ะยาวตัวเดียวของร้านที่นั่งได้ 6 คน
      { position: v(-2.9, SALA_FLOOR_Y, 4.8), rotation: 0, kind: "long", style: "sala" },
    ],
  },
];

export function getZone(id: string | null | undefined): VenueZone | undefined {
  return venueZones.find((zone) => zone.id === id);
}

/** มุมกล้องภาพรวมของโซน */
export function getZoneOverview(id: TableZone): CameraView {
  return getZone(id)!.overview;
}

/** มุมกล้องของโซนตามรูปที่เลือก */
export function getZoneView(id: TableZone, photoIndex = 0): CameraView {
  const zone = getZone(id)!;
  return (zone.photos[photoIndex] ?? zone.photos[0]!).view;
}

/** ขนาดโต๊ะรวมเก้าอี้เมื่อมองจากด้านบน (กว้างตามแกน x ของโต๊ะ, ลึกตามแกน z) */
export function tableFootprint(kind: TableKind): { w: number; d: number } {
  if (kind === "long") return { w: 2.6, d: 1.4 };
  if (kind === "bar") return { w: 3.0, d: 1.2 };
  return { w: 1.3, d: 1.4 };
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

// โต๊ะจริงของร้าน: หน้าร้าน 1 · ห้องอาหาร 6 · บาร์หน้าครัว 3 · ศาลา 4 — ทุกตัว 4 ที่นั่ง ยกเว้น S4 นั่งได้ 6
const DEMO_LAYOUT: { name: string; capacity: number; zone: TableZone; booked?: boolean }[] = [
  { name: "F1", capacity: 4, zone: "front" },
  { name: "D1", capacity: 4, zone: "dining" },
  { name: "D2", capacity: 4, zone: "dining" },
  { name: "D3", capacity: 4, zone: "dining", booked: true },
  { name: "D4", capacity: 4, zone: "dining" },
  { name: "D5", capacity: 4, zone: "dining" },
  { name: "D6", capacity: 4, zone: "dining" },
  { name: "K1", capacity: 4, zone: "kitchen" },
  { name: "K2", capacity: 4, zone: "kitchen" },
  { name: "K3", capacity: 4, zone: "kitchen" },
  { name: "S1", capacity: 4, zone: "sala" },
  { name: "S2", capacity: 4, zone: "sala" },
  { name: "S3", capacity: 4, zone: "sala", booked: true },
  { name: "S4", capacity: 6, zone: "sala" },
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
