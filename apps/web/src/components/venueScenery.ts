import * as THREE from "three";
import { buildPhotoBackdrop, STOREFRONT_PHOTO, type PhotoBackdrop } from "./venuePhotoLayers";
import { FRONT_FLOOR_Y, KITCHEN_FLOOR_Y, SALA_FLOOR_Y, SHOP_FLOOR_Y, type Rect, type TableStyle } from "./venueModel";

/**
 * ฉากร้านป้าอ้อแบบ low-poly วางตามผังร้านและอ้างอิงรูปจริง: พื้นผิวสร้างด้วย canvas และบางส่วนตัดจากรูปถ่ายจริง
 * (ภาพติดผนังร้านกาแฟอิฐ โลโก้ชาใต้ ป้ายร้าน ป้ายเมนูเหนือซุ้มครัว) เพื่อให้จำได้ว่าเป็นมุมไหนของร้าน
 */

export type Track = <T extends { dispose: () => void }>(obj: T) => T;

/** ส่วนของรูป (สัดส่วน 0–1 นับจากมุมซ้ายบน) */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

function canvasTexture(track: Track, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, size);
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function tiles(track: Track, base: string, grout: string, repeatX: number, repeatY: number) {
  const tex = canvasTexture(track, 128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "rgba(255,255,255,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = grout;
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, s, s);
  });
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function planks(track: Track, base: string, line: string, count: number, vertical: boolean, repeatX = 1, repeatY = 1) {
  const tex = canvasTexture(track, 256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const step = s / count;
    for (let i = 0; i < count; i++) {
      // ลายไม้ + รอยต่อแผ่น
      ctx.fillStyle = `rgba(${i % 2 ? "255,240,210" : "90,50,20"},${0.06 + ((i * 37) % 7) / 100})`;
      if (vertical) ctx.fillRect(i * step, 0, step, s);
      else ctx.fillRect(0, i * step, s, step);
      ctx.strokeStyle = "rgba(60,30,10,0.18)";
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const o = i * step + ((k * 13 + i * 7) % step);
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(o, 0);
          ctx.bezierCurveTo(o + 3, s * 0.3, o - 3, s * 0.7, o + 1, s);
        } else {
          ctx.moveTo(0, o);
          ctx.bezierCurveTo(s * 0.3, o + 3, s * 0.7, o - 3, s, o + 1);
        }
        ctx.stroke();
      }
      ctx.fillStyle = line;
      if (vertical) ctx.fillRect(i * step, 0, 2, s);
      else ctx.fillRect(0, i * step, s, 2);
    }
  });
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function stripes(track: Track, base: string, line: string, count: number, repeatX = 1) {
  const tex = canvasTexture(track, 128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const step = s / count;
    for (let i = 0; i < count; i++) {
      const g = ctx.createLinearGradient(i * step, 0, (i + 1) * step, 0);
      g.addColorStop(0, "rgba(255,255,255,0.25)");
      g.addColorStop(0.5, "rgba(0,0,0,0)");
      g.addColorStop(1, line);
      ctx.fillStyle = g;
      ctx.fillRect(i * step, 0, step, s);
    }
  });
  tex.repeat.set(repeatX, 1);
  return tex;
}

function thatch(track: Track) {
  return canvasTexture(track, 256, (ctx, s) => {
    ctx.fillStyle = "#8a6a3c";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = (i * 97) % s;
      const y = (i * 61) % s;
      ctx.strokeStyle = i % 3 ? "rgba(214,178,112,0.55)" : "rgba(70,48,22,0.5)";
      ctx.lineWidth = 1 + (i % 2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3, y + 22);
      ctx.stroke();
    }
  });
}

function photoCrop(track: Track, loader: THREE.TextureLoader, src: string, crop: Crop, onLoad: () => void) {
  const tex = track(loader.load(src, onLoad));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(crop.w, crop.h);
  tex.offset.set(crop.x, 1 - crop.y - crop.h);
  tex.anisotropy = 4;
  return tex;
}

function gravel(track: Track, repeat: number) {
  const tex = canvasTexture(track, 256, (ctx, s) => {
    ctx.fillStyle = "#9d9a93";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = (i * 131) % s;
      const y = (i * 197 + (i % 7) * 11) % s;
      const shade = 110 + ((i * 53) % 110);
      ctx.fillStyle = `rgba(${shade},${shade - 4},${shade - 10},0.7)`;
      ctx.fillRect(x, y, 1 + (i % 3), 1 + ((i >> 2) % 2));
    }
  });
  tex.repeat.set(repeat, repeat);
  return tex;
}

function textTexture(track: Track, text: string, bg: string, fg: string, width = 1024, height = 160, font = 84) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    // ลอนหลังคาเมทัลชีท
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 10, height);
    ctx.fillStyle = fg;
    ctx.font = `bold ${font}px Tahoma, 'Noto Sans Thai', sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 60, height / 2 + 4);
  }
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(track: Track, text: string, bg: string, fg: string, icon = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 144);
    ctx.fillStyle = fg;
    ctx.font = "bold 72px Tahoma, 'Noto Sans Thai', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${icon}${text}`, 256, 84);
  }
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * ส่วนของฉากที่จางลงเมื่อบังมุมมอง (ผนังสูง/หลังคา) — แบบบ้านตุ๊กตา
 * - wall: จางเมื่อกล้องกับจุดที่มองอยู่คนละฝั่งของผนัง
 * - roof: จางเมื่อมองลงมาจากเหนือหลังคา หรือเส้นสายตาทะลุหลังคา
 */
export type Fadeable =
  | { kind: "wall"; materials: THREE.Material[]; point: THREE.Vector3; normal: THREE.Vector3 }
  | { kind: "roof"; materials: THREE.Material[]; y: number; rect: Rect; minOpacity?: number };

export interface SceneryOptions {
  scene: THREE.Scene;
  track: Track;
  onTextureLoad: () => void;
}

const SITE = "/venue/site/";
const RES = "/venue/reservations/";

/**
 * สร้างอาคาร โซน จุดสำคัญ และของตกแต่งทั้งหมด (ไม่รวมโต๊ะที่จองได้) ตามผังและรูปถ่ายจริง
 * - ถนนลาดยางอยู่ด้านซ้ายของร้าน (บาร์ริมหน้าต่างและจุดน้ำแข็งหันออกถนน)
 * - ด้านหน้าเป็นลานจอดรถลูกรังมีต้นไม้กลางลาน ฝั่งตรงข้ามเป็นอาคารพาณิชย์สองชั้นหลังคาแดง
 * - ห้องอาหารอยู่ใน "อาคาร 3 ขวัญใจ" ป้ายไวนิลอาหาร/เครื่องดื่มเหนือหน้าร้าน
 */
export function buildScenery({ scene, track, onTextureLoad }: SceneryOptions): { fadeables: Fadeable[]; backdrop: PhotoBackdrop } {
  const loader = new THREE.TextureLoader();
  const fadeables: Fadeable[] = [];
  let backdrop: PhotoBackdrop;
  const std = (params: THREE.MeshStandardMaterialParameters) =>
    track(new THREE.MeshStandardMaterial({ roughness: 0.85, ...params }));

  function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, shadow = true) {
    const m = new THREE.Mesh(track(geo), material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) =>
    mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry);
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 10) =>
    mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
  /** ป้าย/ภาพแบบแผ่นบาง หันหน้าไปทาง ry (0 = หัน +z) */
  function panel(w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) {
    const p = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), m);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    scene.add(p);
    return p;
  }
  const photo = (src: string, crop: Crop) =>
    track(new THREE.MeshBasicMaterial({ map: photoCrop(track, loader, src, crop, onTextureLoad), side: THREE.DoubleSide }));

  /** ผนังตามแนวแกน · ช่องประตูส่งหลายช่วงผ่าน segments · extras = ป้ายบนผนังที่จางไปพร้อมกัน */
  function wall(
    axis: "x" | "z",
    at: number,
    segments: [number, number][],
    height: number,
    params: THREE.MeshStandardMaterialParameters,
    extras: THREE.Material[] = [],
  ) {
    const material = std({ ...params });
    for (const [a, b] of segments) {
      const len = b - a;
      const mid = (a + b) / 2;
      // ผนังไม่ทิ้งเงา — ไม่ให้ห้องมืดเมื่อผนังจางลง
      const m = axis === "x" ? box(len, height, 0.15, material, mid, height / 2, at) : box(0.15, height, len, material, at, height / 2, mid);
      m.castShadow = false;
    }
    fadeables.push({
      kind: "wall",
      materials: [material, ...extras],
      point: axis === "x" ? new THREE.Vector3(0, 0, at) : new THREE.Vector3(at, 0, 0),
      normal: axis === "x" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0),
    });
    return material;
  }

  const black = std({ color: 0x1f1b18, roughness: 0.6 });
  const concrete = std({ color: 0xbdb8ae, roughness: 1 });
  const white = std({ color: 0xf4f1ea });
  const steel = std({ color: 0xc3c7cb, metalness: 0.65, roughness: 0.3 });
  const lamp = track(new THREE.MeshBasicMaterial({ color: 0xfffbef }));
  const weathered = std({ color: 0x6e5238, roughness: 0.95 });
  const pole = std({ color: 0xa3a8ad, metalness: 0.5, roughness: 0.4 });
  const leaf = std({ color: 0x4f8a3a, roughness: 1 });
  const trunk = std({ color: 0x5b4330 });

  // ---------- พื้นดิน ถนนด้านซ้าย ลานจอดรถลูกรังด้านหน้า ----------
  box(80, 0.1, 70, std({ color: 0x9c998f, roughness: 1 }), 2, -0.06, 4);
  box(26, 0.02, 20, std({ map: gravel(track, 10), roughness: 1 }), 3.5, 0.0, 13.2);
  box(3.8, 0.03, 60, std({ color: 0x55585c, roughness: 0.9 }), -11.0, 0.01, 2);
  box(0.12, 0.031, 60, std({ color: 0xe8b93a, roughness: 0.8 }), -11.0, 0.02, 2);
  box(0.9, 0.05, 30, concrete, -8.75, 0.02, -2);
  // ต้นไม้กลางลานจอด + อาคารพาณิชย์สองชั้นฝั่งตรงข้าม
  cyl(0.18, 0.24, 2.4, trunk, 4.5, 1.2, 13.5, 8);
  mesh(new THREE.SphereGeometry(2.4, 14, 10), leaf, 4.5, 3.6, 13.5).scale.set(1.2, 0.8, 1.2);
  const shopWall = std({ color: 0xead7b0 });
  const redRoof = std({ color: 0xa8402f, roughness: 0.6 });
  box(26, 6, 5, shopWall, 3.5, 3, 26.5);
  box(26.4, 0.9, 0.3, redRoof, 3.5, 6.3, 23.9);
  box(26.4, 0.25, 2.2, std({ color: 0xd9dcdf, metalness: 0.3 }), 3.5, 3.0, 23.0);
  // หน้าตึกฝั่งตรงข้าม: ตัดจากรูปจริง storefront-seating.jpg (ประตูม้วนและป้ายร้าน) ปูสลับกระจกให้ขอบต่อกัน
  const facadePhoto = photo(STOREFRONT_PHOTO, { x: 0.585, y: 0.26, w: 0.345, h: 0.215 });
  for (const [fx, mirror] of [[-3.0, false], [10.0, true]] as const) {
    const facade = panel(13, 6.2, facadePhoto, fx, 3.1, 23.97, Math.PI);
    if (mirror) facade.scale.x = -1;
  }
  backdrop = buildPhotoBackdrop({ scene, track, onTextureLoad });
  const car = std({ color: 0xf1f1f1, roughness: 0.4, metalness: 0.3 });
  const glass = std({ color: 0x3b4450, roughness: 0.2, metalness: 0.2 });
  box(1.8, 0.8, 4.2, car, 8.5, 0.55, 21.3, Math.PI / 2 - 0.1);
  box(1.6, 0.6, 2.2, glass, 8.5, 1.2, 21.3, Math.PI / 2 - 0.1);
  box(1.8, 0.75, 4.3, std({ color: 0x2b2d30, roughness: 0.4, metalness: 0.3 }), 13.5, 0.55, 21.0, Math.PI / 2);
  // มอเตอร์ไซค์จอดหน้าร้าน
  motorbike(6.4, 3.9, 0.25, 0xd3263a);
  motorbike(8.0, 3.8, -0.15, 0x3fb6d8);
  motorbike(1.1, 4.2, 0.4, 0x1f1f22);

  // ---------- โซน 2: ห้องอาหาร (x 0.1–9.2, z −7.5–0.6) ----------
  box(9.2, SHOP_FLOOR_Y, 8.1, std({ map: tiles(track, "#f1efea", "#cfcac0", 9.2 / 0.6, 8.1 / 0.6), roughness: 0.3 }), 4.65, SHOP_FLOOR_Y / 2, -3.45);
  const yellowWall = { color: 0xefdfb1 };
  // ผนังหลังไม้อัดลายไม้ + ป้ายร้านป้าอ้อ + ประตูม่าน Coffee in love ไปห้องน้ำ
  const signMat = photo("/venue/reservations/dining-room.jpg", { x: 0.526, y: 0.167, w: 0.205, h: 0.12 });
  const restroomSign = track(new THREE.MeshBasicMaterial({ map: signTexture(track, "ห้องน้ำ", "#2f8f4e", "#ffffff", "🚻 ") }));
  const coffeeDoor = photo(SITE + "front-dining-view.jpg", { x: 0.631, y: 0.252, w: 0.0765, h: 0.245 });
  const backWood = wall(
    "x",
    -7.575,
    [[0, 7.35], [8.55, 9.3]],
    3.0,
    { map: planks(track, "#c28d58", "rgba(80,40,15,0.45)", 12, true, 3, 1), roughness: 0.55 },
    [signMat, restroomSign, coffeeDoor],
  );
  box(1.2, 0.6, 0.15, backWood, 7.95, 2.7, -7.575);
  panel(3.0, 1.32, signMat, 3.6, 2.15, -7.49);
  panel(1.0, 0.32, restroomSign, 7.95, 2.6, -7.49);
  panel(1.1, 2.3, coffeeDoor, 7.95, SHOP_FLOOR_Y + 1.15, -7.52);
  for (const lx of [1.8, 5.2]) box(1.3, 0.05, 0.1, lamp, lx, 2.9, -7.45);

  // ผนังกั้นครัว/ห้องอาหาร — ฝั่งห้องอาหาร: โปสเตอร์เมนูดำ ภาพคะน้าหมูกรอบ พัดลม · ฝั่งครัว: ภาพอาหาร ชั้นต้นไม้
  const posterA = photo("/venue/reservations/dining-room.jpg", { x: 0.245, y: 0.118, w: 0.064, h: 0.186 });
  const posterB = photo("/venue/reservations/dining-room.jpg", { x: 0, y: 0.159, w: 0.105, h: 0.119 });
  const kPosterRice = photo(SITE + "kitchen-stall-tables.jpg", { x: 0.815, y: 0.257, w: 0.18, h: 0.213 });
  const kPosterCrab = photo(SITE + "kitchen-stall-tables.jpg", { x: 0.77, y: 0.05, w: 0.135, h: 0.18 });
  // ป้ายไวนิลเมนูอาหารตัวจริง (food-menu.jpg) ติดฝั่งครัวของผนังกั้น
  const kPosterMenu = photo(RES + "food-menu.jpg", { x: 0, y: 0, w: 1, h: 1 });
  wall("z", 0, [[-7.5, -0.95], [-0.1, 0.6]], 3.0, yellowWall, [posterA, posterB, kPosterRice, kPosterCrab, kPosterMenu]);
  panel(0.6, 1.6, posterA, 0.09, 1.95, -4.4, Math.PI / 2);
  panel(0.95, 1.1, posterB, 0.09, 1.95, -2.2, Math.PI / 2);
  cyl(0.3, 0.3, 0.06, white, 0.2, 2.55, -3.2, 20).rotation.set(0, 0, Math.PI / 2);
  box(0.12, 0.2, 0.12, white, 0.14, 2.3, -3.2);
  panel(1.3, 1.05, kPosterRice, -0.09, 1.6, -2.3, -Math.PI / 2);
  panel(1.1, 0.8, kPosterCrab, -0.09, 2.35, -3.8, -Math.PI / 2);
  panel(0.9, 1.2, kPosterMenu, -0.09, 1.95, -5.4, -Math.PI / 2);
  box(0.2, 0.04, 2.6, weathered, -0.2, 2.0, -3.3);
  for (const pz of [-4.3, -3.4, -2.5]) plant(-0.2, 2.02, pz, 0.45);
  box(0.05, 0.05, 1.3, lamp, 0.12, 2.9, -5.4);
  box(0.05, 0.05, 1.3, lamp, 0.12, 2.9, -1.6);

  // ผนังขวา (ต่อไปถึงห้องน้ำ) + ภาพร้านกาแฟอิฐเหนือบาร์น้ำ
  const mural = photo("/venue/reservations/counter.jpg", { x: 0.227, y: 0.13, w: 0.5, h: 0.432 });
  const muralB = photo(SITE + "front-dining-view.jpg", { x: 0.89, y: 0.11, w: 0.11, h: 0.263 });
  const drinkStrip = photo(RES + "counter.jpg", { x: 0.783, y: 0.103, w: 0.06, h: 0.73 });
  wall("z", 9.3, [[-9.5, 0.6]], 3.0, yellowWall, [mural, muralB, drinkStrip]);
  panel(3.2, 2.1, mural, 9.21, 2.0, -2.4, -Math.PI / 2);
  panel(1.2, 2.1, muralB, 9.21, 2.0, -0.2, -Math.PI / 2);

  // บาร์น้ำชาใต้ (ผังสีเหลือง) ติดทางเข้าด้านขวา: ไม้พาเลท + โลโก้ (จากรูปจริง) + เครื่องชงบนเคาน์เตอร์
  const pallet = std({ map: planks(track, "#d39a5c", "rgba(90,50,20,0.55)", 9, true), roughness: 0.75 });
  box(0.7, 1.05, 3.4, pallet, 8.6, SHOP_FLOOR_Y + 0.525, -1.8);
  box(0.9, 0.06, 3.6, std({ color: 0xa8703f, roughness: 0.5 }), 8.6, SHOP_FLOOR_Y + 1.08, -1.8);
  for (let pz = -3.4; pz <= -0.2; pz += 0.2) box(0.05, 0.25 + ((pz * 7) % 3) * 0.06, 0.18, pallet, 8.26, SHOP_FLOOR_Y + 1.2, pz);
  panel(0.66, 0.74, photo("/venue/reservations/counter.jpg", { x: 0.492, y: 0.667, w: 0.133, h: 0.198 }), 8.23, SHOP_FLOOR_Y + 0.55, -1.2, -Math.PI / 2);
  // เมนูชาใต้ตัวจริง (drink-menu.jpg) ติดหน้าบาร์ + แถบภาพเครื่องดื่มบนผนังขวา (counter.jpg)
  const drinkMenu = photo(RES + "drink-menu.jpg", { x: 0, y: 0, w: 1, h: 1 });
  panel(0.6, 0.8, drinkMenu, 8.23, SHOP_FLOOR_Y + 0.55, -2.55, -Math.PI / 2);
  panel(0.5, 1.75, drinkStrip, 9.21, 1.95, -4.9, -Math.PI / 2);
  box(0.3, 0.4, 0.3, black, 8.85, SHOP_FLOOR_Y + 1.31, -2.9);
  box(0.28, 0.34, 0.28, std({ color: 0x3a3a3a, metalness: 0.4 }), 8.85, SHOP_FLOOR_Y + 1.28, -2.4);
  for (let i = 0; i < 4; i++) {
    cyl(0.07, 0.07, 0.24, std({ color: [0xe8b04b, 0x7a4a2a, 0xf1ece0, 0x3f7f3f][i]!, roughness: 0.3 }), 8.9, SHOP_FLOOR_Y + 1.23, -1.9 + i * 0.22);
  }
  plant(8.8, SHOP_FLOOR_Y + 1.11, -0.6, 0.5);
  plant(8.4, SHOP_FLOOR_Y, 0.25, 0.9);
  box(0.5, 1.2, 0.8, weathered, 8.9, SHOP_FLOOR_Y + 0.6, -4.2);

  // ห้องน้ำ (ผังสีเขียว) มุมในขวา
  box(2.4, 0.12, 2.0, std({ color: 0xdfe8e4, roughness: 0.3 }), 8.1, 0.06, -8.5);
  wall("x", -9.5, [[6.9, 9.3]], 2.6, { color: 0xcfe6d6 });
  wall("z", 6.9, [[-9.5, -7.5]], 2.6, { color: 0xcfe6d6 });
  const restroomRoof = std({ color: 0x9aa39e, roughness: 0.6 });
  box(2.6, 0.1, 2.2, restroomRoof, 8.1, 2.65, -8.5);
  fadeables.push({ kind: "roof", materials: [restroomRoof], y: 2.65, rect: { x0: 6.8, x1: 9.4, z0: -9.6, z1: -7.4 }, minOpacity: 0.05 });
  box(0.45, 0.4, 0.6, white, 8.6, 0.32, -9.1);
  cyl(0.2, 0.18, 0.1, white, 8.6, 0.55, -8.85, 14);
  box(0.5, 0.15, 0.35, white, 7.3, 0.85, -9.3);

  // หน้าอาคาร: ป้ายหลังคาแดง "อาคาร 3 ขวัญใจ" + ป้ายไวนิลอาหาร/เครื่องดื่ม + ประตูกระจกบานเลื่อน (จางเมื่อมองเข้าไปในร้าน)
  const fascia = track(new THREE.MeshStandardMaterial({ map: textTexture(track, "อาคาร 3 ขวัญใจ", "#9c3a2c", "#f7efe6"), roughness: 0.6 }));
  const bannerFood = photo(SITE + "exterior-from-parking.jpg", { x: 0.4325, y: 0.243, w: 0.2275, h: 0.098 });
  const bannerDrink = photo(SITE + "exterior-from-parking.jpg", { x: 0.66, y: 0.243, w: 0.19, h: 0.098 });
  const pillar = std({ ...yellowWall });
  const frame = std({ color: 0xcfd3d6, metalness: 0.6, roughness: 0.35 });
  const fasciaEdge = std({ color: 0x8a3226, roughness: 0.6 });
  box(0.35, 3.0, 0.35, pillar, 0.1, 1.5, 0.6);
  box(0.35, 3.0, 0.35, pillar, 9.3, 1.5, 0.6);
  for (const fx of [0.4, 3.4, 6.2, 9.0]) box(0.06, 2.75, 0.08, frame, fx, SHOP_FLOOR_Y + 1.37, 0.66);
  box(9.4, 0.08, 0.08, frame, 4.7, 2.95, 0.66);
  box(9.6, 0.4, 0.3, pillar, 4.7, 3.2, 0.6);
  const fasciaBoard = box(15.5, 0.9, 0.12, fascia, 7.4, 3.95, 0.95);
  fasciaBoard.castShadow = false;
  box(15.5, 0.12, 1.4, fasciaEdge, 7.4, 4.45, 0.35);
  fadeables.push({
    kind: "wall",
    materials: [pillar, frame, fascia, fasciaEdge],
    point: new THREE.Vector3(0, 0, 0.6),
    normal: new THREE.Vector3(0, 0, 1),
  });

  // ---------- โซน 1: หน้าร้าน ลานปูนใต้ป้ายไวนิล (x 0–9.4, z 0.6–3.1) ----------
  box(9.6, FRONT_FLOOR_Y, 2.6, concrete, 4.7, FRONT_FLOOR_Y / 2, 1.9);
  // ป้ายไวนิลยื่นเป็นกันสาด (อาหารด้านซ้าย เครื่องดื่มด้านขวา)
  const canopyL = panel(5.2, 1.5, bannerFood, 2.5, 3.05, 1.35);
  const canopyR = panel(4.4, 1.5, bannerDrink, 7.3, 3.05, 1.35);
  for (const c of [canopyL, canopyR]) c.rotation.x = -1.15;
  fadeables.push({ kind: "roof", materials: [bannerFood, bannerDrink], y: 2.9, rect: { x0: -0.2, x1: 9.6, z0: 0.6, z1: 2.1 }, minOpacity: 0.12 });
  cyl(0.035, 0.035, 2.9, pole, 4.95, 1.45, 2.05, 8);
  // เครื่องกรองน้ำหยอดเหรียญ + ร้านข้างเคียง (ประตูม้วนปิด ขอบเขียว)
  box(0.7, 1.7, 0.6, white, 9.9, 0.85, 1.6);
  box(0.72, 0.4, 0.62, std({ color: 0x3fa35c }), 9.9, 1.9, 1.6);
  box(4.6, 3.0, 0.2, std({ map: stripes(track, "#cfccc4", "rgba(0,0,0,0.22)", 20, 2), metalness: 0.3 }), 12.0, 1.5, 0.6);
  box(4.8, 0.3, 0.25, std({ color: 0x7cc35a }), 12.0, 3.1, 0.62);
  box(4.8, 3.2, 8, std({ color: 0xe7dcc4 }), 12.0, 1.6, -3.5);
  for (const px of [10.4, 11.2, 13.6]) plant(px, 0, 1.2, 0.9);

  // ---------- โซน 3: บาร์หน้าครัว (x −8.2–−0.1, z −7.2–−0.1) ----------
  box(8.2, KITCHEN_FLOOR_Y, 7.2, std({ map: tiles(track, "#8e5234", "#d2b49c", 8.2 / 0.3, 7.2 / 0.3), roughness: 0.45 }), -4.1, KITCHEN_FLOOR_Y / 2, -3.65);
  wall("x", -7.275, [[-8.2, 0]], 3.0, { color: 0xe3cfa7 });
  // ริมหน้าต่างติดถนน: รั้วไม้ระแนงหัวมนสูงกว่าบาร์ + ผ้าใบดำด้านบน (ตามรูปจริง)
  const picket = std({ color: 0x7a5234, roughness: 0.9 });
  const capGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.04, 10, 1, false, 0, Math.PI);
  for (let pz = -7.05; pz <= -0.25; pz += 0.16) {
    box(0.04, 1.3, 0.13, picket, -8.18, KITCHEN_FLOOR_Y + 0.65, pz);
    const cap = mesh(capGeo.clone(), picket, -8.18, KITCHEN_FLOOR_Y + 1.3, pz);
    cap.rotation.set(0, 0, Math.PI / 2);
  }
  box(0.08, 0.1, 6.9, weathered, -8.14, KITCHEN_FLOOR_Y + 0.9, -3.65);
  const tarp = new THREE.Mesh(
    track(new THREE.PlaneGeometry(7.2, 1.3)),
    track(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, side: THREE.DoubleSide })),
  );
  tarp.position.set(-8.22, KITCHEN_FLOOR_Y + 2.35, -3.65);
  tarp.rotation.y = Math.PI / 2;
  scene.add(tarp);
  for (const pz of [-7.15, -3.65, -0.15]) box(0.12, 3.0, 0.12, std({ color: 0x8795a3, metalness: 0.4 }), -8.2, KITCHEN_FLOOR_Y + 1.5, pz);
  // ถังน้ำสีฟ้านอกหน้าต่าง + ป้าย "หรอยจังฮู้" ริมถนน
  const blue = std({ color: 0x2f7fd8, roughness: 0.5 });
  cyl(0.3, 0.3, 0.85, blue, -8.8, 0.45, -6.3, 16);
  cyl(0.3, 0.3, 0.85, blue, -8.8, 0.45, -5.6, 16);
  cyl(0.3, 0.3, 0.85, blue, -9.4, 0.45, -5.95, 16);
  const roadSign = photo(SITE + "kitchen-roadside.jpg", { x: 0.77, y: 0.213, w: 0.125, h: 0.7 });
  panel(0.6, 2.1, roadSign, -8.95, 1.15, -0.4, -Math.PI / 2);
  box(0.04, 2.3, 0.04, pole, -8.93, 1.15, -0.72);
  // ระแนงเตี้ยด้านหน้าห้อง (ติดศาลา) เว้นทางเดินด้านขวา
  for (let px = -8.0; px <= -1.7; px += 0.16) box(0.13, 0.9, 0.04, picket, px, KITCHEN_FLOOR_Y + 0.45, -0.05);

  // ซุ้มครัว (ผังสีแดง): เคาน์เตอร์ไม้อัดติดโปสเตอร์เมนู + ป้ายภาพอาหารด้านบน + เตา ฮูด ตู้เย็น
  const plywood = std({ color: 0xc8995e, roughness: 0.7 });
  box(4.7, 1.05, 0.12, plywood, -4.55, KITCHEN_FLOOR_Y + 0.52, -4.1);
  box(4.8, 0.05, 0.6, plywood, -4.55, KITCHEN_FLOOR_Y + 1.07, -4.3);
  const counterPoster = photo(SITE + "kitchen-stall-tables.jpg", { x: 0.1, y: 0.35, w: 0.205, h: 0.25 });
  panel(1.7, 1.02, counterPoster, -4.9, KITCHEN_FLOOR_Y + 0.55, -4.03);
  panel(0.9, 0.95, photo("/venue/latest/real-menu-counter.jpg", { x: 0.285, y: 0.64, w: 0.387, h: 0.36 }), -3.2, KITCHEN_FLOOR_Y + 0.55, -4.03);
  for (const [px, pz] of [[-6.9, -4.1], [-2.2, -4.1]] as const) box(0.08, 2.9, 0.08, black, px, KITCHEN_FLOOR_Y + 1.45, pz);
  const topBanner = photo(SITE + "kitchen-stall-tables.jpg", { x: 0.0, y: 0.02, w: 0.36, h: 0.165 });
  box(4.8, 0.95, 0.05, plywood, -4.55, KITCHEN_FLOOR_Y + 2.55, -4.14);
  panel(4.7, 0.9, topBanner, -4.55, KITCHEN_FLOOR_Y + 2.55, -4.11);
  // พื้นที่ครัวด้านในโทนมืด
  box(4.7, 0.05, 2.7, std({ color: 0x4a3a30, roughness: 0.8 }), -4.55, KITCHEN_FLOOR_Y + 0.03, -5.5);
  box(3.2, 0.85, 0.7, steel, -4.9, KITCHEN_FLOOR_Y + 0.43, -6.5);
  for (const bx of [-5.9, -4.9]) cyl(0.2, 0.2, 0.05, black, bx, KITCHEN_FLOOR_Y + 0.88, -6.5, 16);
  const wok = mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), black, -5.9, KITCHEN_FLOOR_Y + 1.18, -6.5);
  wok.scale.y = 0.45;
  cyl(0.3, 0.3, 0.45, steel, -3.9, KITCHEN_FLOOR_Y + 1.1, -6.5, 16);
  box(3.2, 0.45, 0.8, steel, -4.9, KITCHEN_FLOOR_Y + 2.2, -6.6);
  box(0.8, 1.8, 0.7, steel, -2.65, KITCHEN_FLOOR_Y + 0.9, -6.5);
  box(1.4, 0.8, 0.5, std({ color: 0x8a8f94, metalness: 0.4 }), -6.3, KITCHEN_FLOOR_Y + 1.5, -7.0);
  for (let i = 0; i < 5; i++) cyl(0.12, 0.08, 0.08, white, -2.9, KITCHEN_FLOOR_Y + 1.12 + i * 0.08, -4.3, 12);
  cyl(0.12, 0.12, 0.35, std({ color: 0xeaf4f7, transparent: true, opacity: 0.85 }), -5.6, KITCHEN_FLOOR_Y + 1.27, -4.3, 12);

  // ---------- โซน 4: ศาลาหลังคามุงจากคลุมผ้าใบดำ (x −8.2–−0.5, z 0.3–6.8) ----------
  box(7.7, SALA_FLOOR_Y, 6.5, std({ color: 0xb3afa6, roughness: 0.55 }), -4.35, SALA_FLOOR_Y / 2, 3.55);
  const grate = std({ map: stripes(track, "#6b2e22", "rgba(0,0,0,0.8)", 10, 8), roughness: 0.7 });
  box(0.35, 0.04, 6.5, grate, -0.3, 0.02, 3.55);
  // เสาไม้ดิบและขื่อไขว้
  const rough = std({ color: 0x8c7a62, roughness: 1 });
  for (const px of [-8.0, -4.35, -0.7]) {
    for (const pz of [0.5, 6.6]) cyl(0.08, 0.11, 2.8, rough, px, SALA_FLOOR_Y + 1.4, pz, 7);
    box(0.12, 0.12, 6.3, rough, px, SALA_FLOOR_Y + 2.72, 3.55);
  }
  box(7.5, 0.12, 0.12, rough, -4.35, SALA_FLOOR_Y + 2.7, 0.5);
  box(7.5, 0.12, 0.12, rough, -4.35, SALA_FLOOR_Y + 2.7, 6.6);
  for (const px of [-8.0, -0.7]) {
    const brace = box(0.07, 0.07, 2.2, rough, px, SALA_FLOOR_Y + 2.25, 5.9);
    brace.rotation.x = 0.7;
  }
  const thatchMat = std({ map: thatch(track), side: THREE.DoubleSide, roughness: 1 });
  const tarpMat = std({ color: 0x1b1d20, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide });
  const thatchRoof = mesh(new THREE.ConeGeometry(5.6, 1.7, 4, 1, true), thatchMat, -4.35, SALA_FLOOR_Y + 3.6, 3.55, Math.PI / 4);
  thatchRoof.scale.set(1.0, 1, 0.86);
  const tarpRoof = mesh(new THREE.ConeGeometry(5.9, 1.8, 4, 1, true), tarpMat, -4.35, SALA_FLOOR_Y + 3.62, 3.55, Math.PI / 4);
  tarpRoof.scale.set(1.0, 1, 0.86);
  fadeables.push({ kind: "roof", materials: [thatchMat, tarpMat], y: SALA_FLOOR_Y + 2.8, rect: { x0: -8.6, x1: -0.1, z0: -0.1, z1: 7.2 }, minOpacity: 0.3 });
  // พัดลมเพดาน
  cyl(0.28, 0.28, 0.1, white, -4.35, SALA_FLOOR_Y + 2.55, 3.55, 16);
  // รั้วไม้ไผ่รอบศาลา (ด้านถนนและด้านลานจอด) + ไม้กระถาง
  const bamboo = std({ color: 0xcdb27a, roughness: 0.7 });
  for (const [x0, z0, x1, z1] of [[-8.35, 0.4, -8.35, 6.9], [-8.35, 6.95, -5.2, 6.95], [-3.4, 6.95, -0.6, 6.95]] as const) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (const h of [0.35, 0.8]) {
      const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), bamboo, (x0 + x1) / 2, h, (z0 + z1) / 2);
      // แกนทรงกระบอก (y) → นอนตามแนวรั้ว
      rail.rotation.order = "YXZ";
      rail.rotation.set(Math.PI / 2, ry, 0);
    }
    const n = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i <= n; i++) cyl(0.04, 0.04, 1.0, bamboo, x0 + ((x1 - x0) * i) / n, 0.5, z0 + ((z1 - z0) * i) / n, 6);
  }
  for (const [px, pz] of [[-7.8, 6.3], [-6.6, 7.3], [-2.6, 7.3], [-1.2, 7.3]] as const) plant(px, 0, pz, 1.0);

  // จุดน้ำแข็ง/แก้วน้ำ (ผังสีฟ้า): ชั้นแก้วสีฟ้า + ถังน้ำแข็งสีแดงในคอกไม้ระแนง + ต้นลีลาวดี
  box(0.95, 1.7, 0.45, white, -6.6, SALA_FLOOR_Y + 0.85, 0.55);
  const cup = std({ color: 0x5bb6e8, roughness: 0.4 });
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 5; i++) cyl(0.055, 0.045, 0.13, cup, -6.95 + i * 0.17, SALA_FLOOR_Y + 0.42 + row * 0.38, 0.8, 8);
  }
  cyl(0.11, 0.11, 0.35, std({ color: 0x5ed06a, roughness: 0.4 }), -6.35, SALA_FLOOR_Y + 1.88, 0.62, 12);
  const iceFront = photo(SITE + "sala-ice-station.jpg", { x: 0.48, y: 0.46, w: 0.17, h: 0.197 });
  box(0.9, 0.75, 0.65, std({ color: 0xd52b2b, roughness: 0.35 }), -7.75, SALA_FLOOR_Y + 0.85, 1.2);
  box(0.94, 0.1, 0.69, std({ color: 0xc02222, roughness: 0.35 }), -7.75, SALA_FLOOR_Y + 1.27, 1.2);
  panel(0.86, 0.72, iceFront, -7.75, SALA_FLOOR_Y + 0.85, 1.531);
  box(0.9, 0.05, 0.7, weathered, -7.75, SALA_FLOOR_Y + 0.45, 1.2);
  for (let pz = 0.85; pz <= 1.6; pz += 0.15) box(0.04, 1.3, 0.13, picket, -8.25, SALA_FLOOR_Y + 0.65, pz);
  for (let px = -8.2; px <= -7.3; px += 0.15) box(0.13, 1.3, 0.04, picket, px, SALA_FLOOR_Y + 0.65, 0.78);
  frangipani(-7.2, SALA_FLOOR_Y, 0.2);

  function plant(x: number, y: number, z: number, size: number) {
    cyl(0.16 * size, 0.12 * size, 0.3 * size, std({ color: 0x3c3c3c }), x, y + 0.15 * size, z);
    const green = std({ color: 0x5a9e3c, roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leafMesh = mesh(new THREE.ConeGeometry(0.09 * size, 0.9 * size, 5), green, x + Math.cos(a) * 0.12 * size, y + 0.62 * size, z + Math.sin(a) * 0.12 * size, 0, false);
      leafMesh.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  }

  function frangipani(x: number, y: number, z: number) {
    const bark = std({ color: 0x6f6456, roughness: 1 });
    cyl(0.12, 0.18, 3.2, bark, x, y + 1.6, z, 8);
    for (const [dx, dz, h] of [[-0.9, 0.3, 3.4], [0.6, -0.5, 3.7], [0.2, 0.8, 3.3]] as const) {
      const branch = cyl(0.06, 0.09, 1.4, bark, x + dx / 2, y + h - 0.4, z + dz / 2, 6);
      branch.rotation.set(dz * 0.8, 0, -dx * 0.8);
      const crown = mesh(new THREE.SphereGeometry(0.9, 10, 8), leaf, x + dx, y + h + 0.3, z + dz);
      crown.scale.y = 0.55;
    }
  }

  function motorbike(x: number, z: number, ry: number, color: number) {
    const g = new THREE.Group();
    const body = std({ color, roughness: 0.35, metalness: 0.2 });
    const tyre = std({ color: 0x151515, roughness: 0.9 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
      const part = new THREE.Mesh(track(geo), m);
      part.position.set(px, py, pz);
      part.castShadow = true;
      g.add(part);
      return part;
    };
    for (const pz of [-0.62, 0.62]) add(new THREE.TorusGeometry(0.24, 0.07, 8, 16), tyre, 0, 0.3, pz).rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.34, 0.35, 1.0), body, 0, 0.55, 0.05);
    add(new THREE.BoxGeometry(0.3, 0.1, 0.62), black, 0, 0.78, -0.18);
    add(new THREE.BoxGeometry(0.3, 0.7, 0.22), body, 0, 0.72, 0.55);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), steel, 0, 1.08, 0.62).rotation.z = Math.PI / 2;
    g.position.set(x, 0.02, z);
    g.rotation.y = ry;
    scene.add(g);
  }

  // วัสดุที่จางได้ต้องรองรับความโปร่งใส
  for (const f of fadeables) for (const m of f.materials) m.userData["baseOpacity"] = m.opacity;
  return { fadeables, backdrop };
}

export interface FurnitureParts {
  group: THREE.Group;
  top: THREE.Mesh;
  topMaterial: THREE.MeshStandardMaterial;
  pickables: THREE.Object3D[];
  /** ขนาดรอยเท้าโต๊ะรวมเก้าอี้ (ครึ่งกว้าง x, ครึ่งลึก z) สำหรับวงสถานะบนพื้น */
  footprint: { x: number; z: number };
}

/** โต๊ะพร้อมเก้าอี้ตามสไตล์ของโซน */
export function buildFurniture(
  style: TableStyle,
  kind: "square" | "long" | "bar",
  capacity: number,
  own: Track,
  shared: { stoolGeo: Map<string, THREE.BufferGeometry>; mat: Map<string, THREE.Material> },
): FurnitureParts {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const getMat = (key: string, make: () => THREE.Material) => {
    let m = shared.mat.get(key);
    if (!m) {
      m = own(make());
      shared.mat.set(key, m);
    }
    return m;
  };
  const getGeo = (key: string, make: () => THREE.BufferGeometry) => {
    let g = shared.stoolGeo.get(key);
    if (!g) {
      g = own(make());
      shared.stoolGeo.set(key, g);
    }
    return g;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, pick = false) => {
    const part = new THREE.Mesh(geo, m);
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
    if (pick) pickables.push(part);
    return part;
  };

  const legBlack = getMat("leg-black", () => new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.5 }));

  // จำนวนเก้าอี้ที่วาดมีเพดานตามขนาดช่องวางโต๊ะ (ความจุจริงแสดงที่ป้าย)
  const maxPerSide = kind === "bar" ? 6 : kind === "long" ? 5 : 3;
  const perSide = Math.min(maxPerSide, Math.max(1, Math.ceil(capacity / (kind === "bar" ? 1 : 2))));
  const seats = Math.min(capacity, kind === "bar" ? perSide : perSide * 2);
  const length = kind === "long" ? Math.max(2.2, perSide * 0.5) : kind === "bar" ? Math.max(1.6, perSide * 0.5) : Math.max(0.9, perSide * 0.55);
  const depth = kind === "long" ? 0.8 : kind === "bar" ? 0.55 : 0.75;
  const height = kind === "bar" ? 1.05 : 0.75;

  // สีตามรูปจริง: โต๊ะไม้ท็อปส้มขาดำ · โต๊ะไม้เข้มแถวซ้าย · โต๊ะพับลายไม้เทา · บาร์ไม้ขัดเงา · โต๊ะไม้เก่าในศาลา
  const topColor = { wood: 0xc47a3c, dark: 0x5a3822, folding: 0xb7b0a4, bar: 0x6e3f22, sala: 0x8f7457 }[style];
  const topMaterial = own(
    new THREE.MeshStandardMaterial({ color: topColor, roughness: style === "wood" || style === "bar" ? 0.3 : 0.65, emissive: 0x000000 }),
  );
  const top = add(own(new THREE.BoxGeometry(length, 0.06, depth)), topMaterial, 0, height, 0, true);

  // ขาโต๊ะ
  const darkWood = getMat("dark-wood", () => new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.6 }));
  const legMat =
    style === "sala"
      ? getMat("sala-wood", () => new THREE.MeshStandardMaterial({ color: 0x7a6048, roughness: 0.95 }))
      : style === "dark"
        ? darkWood
        : legBlack;
  const legGeo = getGeo(`leg-${height}`, () => new THREE.BoxGeometry(style === "folding" ? 0.04 : 0.07, height, style === "folding" ? 0.04 : 0.07));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) add(legGeo, legMat, sx * (length / 2 - 0.08), height / 2, sz * (depth / 2 - 0.08));
  }
  if (style === "wood" || style === "dark") add(own(new THREE.BoxGeometry(length - 0.08, 0.1, depth - 0.08)), legMat, 0, height - 0.08, 0);

  // เก้าอี้
  const seatY = kind === "bar" ? 0.7 : 0.45;
  const woodSeat = getMat("wood-seat", () => new THREE.MeshStandardMaterial({ color: 0xc47a3c, roughness: 0.35 }));
  const darkSeat = getMat("dark-seat", () => new THREE.MeshStandardMaterial({ color: 0x5a3822, roughness: 0.5 }));
  const whiteLeg = getMat("white-leg", () => new THREE.MeshStandardMaterial({ color: 0xeeeeea, metalness: 0.3, roughness: 0.4 }));
  const greySeat = getMat("grey-seat", () => new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.7 }));
  const salaSeat = getMat("sala-seat", () => new THREE.MeshStandardMaterial({ color: 0xb8743e, roughness: 0.4 }));
  /** เก้าอี้ขาเหล็กสีขาว 4 ขา ที่นั่งไม้ (บาร์และศาลา) */
  const whiteLegStool = (x: number, z: number, seat: THREE.Material, key: string) => {
    add(getGeo(`${key}-seat`, () => new THREE.BoxGeometry(0.34, 0.04, 0.34)), seat, x, seatY, z, true);
    const leg = getGeo(`${key}-leg`, () => new THREE.CylinderGeometry(0.013, 0.013, seatY, 6));
    for (const dx of [-0.14, 0.14]) for (const dz of [-0.14, 0.14]) add(leg, whiteLeg, x + dx, seatY / 2, z + dz);
  };
  const stool = (x: number, z: number) => {
    if (style === "wood" || style === "dark") {
      add(getGeo("wood-seat", () => new THREE.BoxGeometry(0.36, 0.05, 0.3)), style === "wood" ? woodSeat : darkSeat, x, seatY, z, true);
      add(getGeo("wood-stool-legs", () => new THREE.BoxGeometry(0.3, seatY - 0.03, 0.24)), style === "wood" ? legBlack : darkWood, x, (seatY - 0.03) / 2, z);
    } else if (style === "folding") {
      add(getGeo("plastic-stool", () => new THREE.CylinderGeometry(0.16, 0.21, seatY, 4, 1)), greySeat, x, seatY / 2, z, true).rotation.y = Math.PI / 4;
    } else if (style === "bar") {
      whiteLegStool(x, z, woodSeat, "bar");
    } else {
      whiteLegStool(x, z, salaSeat, "sala");
    }
  };
  const offset = depth / 2 + (kind === "bar" ? 0.35 : 0.32);
  for (let i = 0; i < seats; i++) {
    const side = kind === "bar" ? 1 : i % 2 === 0 ? 1 : -1;
    const col = kind === "bar" ? i : Math.floor(i / 2);
    const x = perSide === 1 ? 0 : -length / 2 + 0.3 + col * ((length - 0.6) / (perSide - 1));
    stool(x, side * offset);
  }

  // ของบนโต๊ะ (เหยือกน้ำฝาชมพู กล่องทิชชู) ตามรูปห้องอาหาร
  if (style !== "bar") {
    add(getGeo("jug", () => new THREE.CylinderGeometry(0.07, 0.08, 0.22, 10)), getMat("jug", () => new THREE.MeshStandardMaterial({ color: 0xeaf4f7, roughness: 0.2, transparent: true, opacity: 0.8 })), -length / 2 + 0.2, height + 0.14, -0.1);
    add(getGeo("jug-lid", () => new THREE.CylinderGeometry(0.075, 0.075, 0.04, 10)), getMat("jug-lid", () => new THREE.MeshStandardMaterial({ color: style === "wood" ? 0xf08bb4 : 0x7fd3c4 })), -length / 2 + 0.2, height + 0.27, -0.1);
    add(getGeo("tissue", () => new THREE.BoxGeometry(0.16, 0.08, 0.1)), getMat("tissue", () => new THREE.MeshStandardMaterial({ color: 0x8a5a33 })), -length / 2 + 0.45, height + 0.07, 0.1);
  }

  return {
    group,
    top,
    topMaterial,
    pickables,
    footprint: { x: length / 2 + 0.25, z: kind === "bar" ? offset + 0.2 : offset + 0.2 },
  };
}
