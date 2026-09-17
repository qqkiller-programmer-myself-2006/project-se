import * as THREE from "three";
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
 * - roof: จางเมื่อเส้นสายตาทะลุหลังคา
 */
export type Fadeable =
  | { kind: "wall"; materials: THREE.Material[]; point: THREE.Vector3; normal: THREE.Vector3 }
  | { kind: "roof"; materials: THREE.Material[]; y: number; rect: Rect; minOpacity?: number };

export interface SceneryOptions {
  scene: THREE.Scene;
  track: Track;
  onTextureLoad: () => void;
}

/** สร้างอาคาร โซน จุดสำคัญ และของตกแต่งทั้งหมด (ไม่รวมโต๊ะที่จองได้) ตามผังของร้าน */
export function buildScenery({ scene, track, onTextureLoad }: SceneryOptions): { fadeables: Fadeable[] } {
  const loader = new THREE.TextureLoader();
  const fadeables: Fadeable[] = [];
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
  /** ป้าย/ภาพแบบแผ่นบาง หันหน้าไปทาง ry (0 = หัน +z) */
  function panel(w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) {
    const p = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), m);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    scene.add(p);
    return p;
  }
  const photo = (src: string, crop: Crop) =>
    track(new THREE.MeshBasicMaterial({ map: photoCrop(track, loader, src, crop, onTextureLoad) }));

  /**
   * ผนังตามแนวแกน (แนวใดแนวหนึ่งต้องคงที่) · คืนวัสดุไว้ให้ป้ายบนผนังจางไปพร้อมกัน
   * ช่องประตู: ส่งหลายช่วงผ่าน segments
   */
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
  const creamParams = { color: 0xf3e8d2 };
  const concrete = std({ color: 0xc9c4ba, roughness: 1 });
  const white = std({ color: 0xf4f1ea });
  const steel = std({ color: 0xc3c7cb, metalness: 0.65, roughness: 0.3 });
  const lamp = track(new THREE.MeshBasicMaterial({ color: 0xfffbef }));

  // ---------- พื้นดิน ลานจอดรถ ต้นไม้ ----------
  box(70, 0.1, 60, std({ color: 0xa9a49a, roughness: 1 }), 0.5, -0.05, 0);
  box(20, 0.02, 6.6, std({ color: 0x77746f, roughness: 1 }), 0.5, 0.01, 10.8);
  const paint = std({ color: 0xf2f0e8, roughness: 1 });
  for (let px = -8; px <= 9; px += 2.8) box(0.08, 0.021, 2.4, paint, px, 0.012, 9.2);
  const trunk = std({ color: 0x5b4330 });
  const leaf = std({ color: 0x4f8a3a, roughness: 1 });
  for (const tx of [-10, -5, 0, 5, 10]) {
    mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), trunk, tx, 1.1, 15.4);
    mesh(new THREE.SphereGeometry(1.4, 12, 10), leaf, tx, 2.9, 15.4);
  }
  for (const [tz, tx] of [[-3, -11.5], [3, -11.5], [-6, 11.8]] as const) {
    mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), trunk, tx, 1.1, tz);
    mesh(new THREE.SphereGeometry(1.5, 12, 10), leaf, tx, 3.0, tz);
  }
  const car = std({ color: 0xf1f1f1, roughness: 0.4, metalness: 0.3 });
  const glass = std({ color: 0x3b4450, roughness: 0.2, metalness: 0.2 });
  box(1.8, 0.8, 4.2, car, -4.2, 0.55, 10.9);
  box(1.6, 0.6, 2.2, glass, -4.2, 1.2, 10.7);
  box(1.8, 0.75, 4.3, std({ color: 0x5f6368, roughness: 0.4, metalness: 0.3 }), 5.2, 0.55, 11.1);
  box(1.6, 0.55, 2.1, glass, 5.2, 1.15, 11.3);

  // ---------- โซน 2: ห้องอาหาร (x 0.1–9.2, z −7.5–0.6) ----------
  box(9.2, SHOP_FLOOR_Y, 8.1, std({ map: tiles(track, "#f1efea", "#cfcac0", 9.2 / 0.6, 8.1 / 0.6), roughness: 0.35 }), 4.65, SHOP_FLOOR_Y / 2, -3.45);
  // ผนังหลังลายไม้ + ป้ายร้านป้าอ้อ (ตัดจากรูปห้องอาหาร) · ช่องประตูห้องน้ำด้านขวา
  const signMat = photo("/venue/reservations/dining-room.jpg", { x: 0.526, y: 0.167, w: 0.205, h: 0.12 });
  const restroomSign = track(new THREE.MeshBasicMaterial({ map: signTexture(track, "ห้องน้ำ", "#2f8f4e", "#ffffff", "🚻 ") }));
  const backWood = wall(
    "x",
    -7.575,
    [[0, 7.25], [8.65, 9.3]],
    3.0,
    { map: planks(track, "#b77a45", "rgba(80,40,15,0.5)", 10, true, 3, 1), roughness: 0.6 },
    [signMat, restroomSign],
  );
  box(1.4, 0.8, 0.15, backWood, 7.95, 2.6, -7.575);
  panel(3.0, 1.32, signMat, 3.6, 2.15, -7.49);
  panel(1.2, 0.38, restroomSign, 7.95, 2.42, -7.49);
  // ประตูห้องน้ำสีเขียวแง้มไว้
  box(0.05, 2.05, 1.2, std({ color: 0x3f9d5a, roughness: 0.5 }), 7.5, SHOP_FLOOR_Y + 1.03, -7.0, 0.65);
  box(1.4, 0.05, 0.12, lamp, 1.6, 2.85, -7.47);
  box(1.4, 0.05, 0.12, lamp, 5.6, 2.85, -7.47);

  // ผนังกั้นห้องครัว/ห้องอาหาร: ฝั่งห้องอาหารมีโปสเตอร์เมนู ภาพอาหาร พัดลม · ช่องประตูใกล้หน้าร้าน
  const posterA = photo("/venue/reservations/dining-room.jpg", { x: 0.245, y: 0.118, w: 0.064, h: 0.186 });
  const posterB = photo("/venue/reservations/dining-room.jpg", { x: 0, y: 0.159, w: 0.105, h: 0.119 });
  const posterC = photo("/venue/latest/real-menu-board.jpg", { x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  wall("z", 0, [[-7.5, -1.1], [-0.1, 0.6]], 3.0, creamParams, [posterA, posterB, posterC]);
  panel(0.72, 1.6, posterA, 0.09, 1.95, -3.6, Math.PI / 2);
  panel(0.95, 1.3, posterC, 0.09, 1.9, -5.6, Math.PI / 2);
  panel(1.1, 0.93, posterB, 0.09, 1.95, -1.9, Math.PI / 2);
  mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 20), white, 0.2, 2.6, -4.6).rotation.set(0, 0, Math.PI / 2);
  box(0.12, 0.2, 0.12, white, 0.14, 2.35, -4.6);
  box(0.05, 0.05, 1.4, lamp, 0.1, 2.85, -2.8);

  // ผนังขวา (ต่อไปถึงห้องน้ำ) + ภาพติดผนังร้านกาแฟอิฐเหนือบาร์น้ำ
  const mural = photo("/venue/reservations/counter.jpg", { x: 0.227, y: 0.13, w: 0.5, h: 0.432 });
  wall("z", 9.3, [[-9.5, 0.6]], 3.0, creamParams, [mural]);
  panel(3.4, 2.2, mural, 9.21, 2.05, -3.4, -Math.PI / 2);

  // เสาหน้าร้าน + คานประตูม้วน + ป้ายร้านด้านหน้า
  // (จางเมื่อมองจากหน้าร้านเข้าไปในห้อง — ป้ายด้านหน้าใช้วัสดุแยกจากป้ายผนังหลัง)
  const cream = std({ ...creamParams });
  const beam = std({ color: 0x8f8a82, metalness: 0.4, roughness: 0.5 });
  const signBack = std({ color: 0x1f1b18, roughness: 0.6 });
  const frontSign = photo("/venue/reservations/dining-room.jpg", { x: 0.526, y: 0.167, w: 0.205, h: 0.12 });
  box(0.4, 3.0, 0.4, cream, 0.1, 1.5, 0.6);
  box(0.4, 3.0, 0.4, cream, 9.25, 1.5, 0.6);
  box(9.6, 0.5, 0.35, beam, 4.7, 3.05, 0.6);
  panel(3.0, 1.32, frontSign, 4.7, 3.95, 0.62);
  box(3.2, 1.45, 0.08, signBack, 4.7, 3.95, 0.56);
  fadeables.push({
    kind: "wall",
    materials: [cream, beam, signBack, frontSign],
    point: new THREE.Vector3(0, 0, 0.6),
    normal: new THREE.Vector3(0, 0, 1),
  });

  // บาร์น้ำชาใต้ (ผังสีเหลือง): ไม้พาเลท + โลโก้ (จากรูปจริง) + ของบนเคาน์เตอร์ + ตู้แช่ + ชั้น Coffee in love
  const pallet = std({ map: planks(track, "#c98f55", "rgba(90,50,20,0.55)", 9, true), roughness: 0.75 });
  box(0.7, 1.05, 3.2, pallet, 8.6, SHOP_FLOOR_Y + 0.525, -3.4);
  box(0.9, 0.06, 3.4, std({ color: 0xa8703f, roughness: 0.5 }), 8.6, SHOP_FLOOR_Y + 1.08, -3.4);
  box(0.05, 0.06, 3.4, std({ color: 0xf2c230, roughness: 0.5 }), 8.14, SHOP_FLOOR_Y + 1.08, -3.4);
  panel(0.66, 0.74, photo("/venue/reservations/counter.jpg", { x: 0.492, y: 0.667, w: 0.133, h: 0.198 }), 8.24, SHOP_FLOOR_Y + 0.55, -3.0, -Math.PI / 2);
  box(0.3, 0.4, 0.06, black, 8.75, SHOP_FLOOR_Y + 1.31, -2.4);
  box(0.3, 0.4, 0.06, std({ color: 0xe0955a }), 8.75, SHOP_FLOOR_Y + 1.31, -2.0);
  box(0.28, 0.34, 0.28, std({ color: 0x3a3a3a, metalness: 0.4 }), 8.7, SHOP_FLOOR_Y + 1.28, -4.3);
  for (let i = 0; i < 4; i++) {
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10), std({ color: [0xe8b04b, 0x7a4a2a, 0xf1ece0, 0x3f7f3f][i]!, roughness: 0.3 }), 8.8, SHOP_FLOOR_Y + 1.23, -3.7 + i * 0.22);
  }
  plant(8.7, SHOP_FLOOR_Y + 1.11, -4.85, 0.45);
  box(0.7, 1.8, 0.7, steel, 8.85, SHOP_FLOOR_Y + 0.9, -0.3);
  panel(0.5, 1.4, track(new THREE.MeshBasicMaterial({ color: 0xbfe6f5 })), 8.49, SHOP_FLOOR_Y + 1.0, -0.3, -Math.PI / 2);
  box(0.5, 2.0, 1.1, white, 9.0, SHOP_FLOOR_Y + 1.0, -6.1);
  for (let row = 0; row < 3; row++) box(0.3, 0.2, 0.9, std({ color: [0x8a5a33, 0x3b2a1f, 0xd9a066][row]! }), 8.9, SHOP_FLOOR_Y + 0.5 + row * 0.6, -6.1);

  // ห้องน้ำ (ผังสีเขียว) มุมในขวา
  box(2.4, 0.12, 2.0, std({ color: 0xdfe8e4, roughness: 0.3 }), 8.1, 0.06, -8.5);
  wall("x", -9.5, [[6.9, 9.3]], 2.6, { color: 0xcfe6d6 });
  wall("z", 6.9, [[-9.5, -7.5]], 2.6, { color: 0xcfe6d6 });
  const restroomRoof = std({ color: 0x9aa39e, roughness: 0.6 });
  box(2.6, 0.1, 2.2, restroomRoof, 8.1, 2.65, -8.5);
  fadeables.push({ kind: "roof", materials: [restroomRoof], y: 2.65, rect: { x0: 6.8, x1: 9.4, z0: -9.6, z1: -7.4 }, minOpacity: 0.05 });
  box(0.45, 0.4, 0.6, white, 8.6, 0.32, -9.1);
  mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.1, 14), white, 8.6, 0.55, -8.85);
  box(0.5, 0.15, 0.35, white, 7.3, 0.85, -9.3);

  // ---------- โซน 1: หน้าร้านใต้กันสาด (x 0–9.4, z 0.6–3.1) ----------
  box(9.6, FRONT_FLOOR_Y, 2.6, concrete, 4.7, FRONT_FLOOR_Y / 2, 1.9);
  const awning = std({
    map: stripes(track, "#b9bdc1", "rgba(60,64,70,0.45)", 8, 12),
    metalness: 0.4,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const roof = new THREE.Mesh(track(new THREE.PlaneGeometry(9.8, 3.0)), awning);
  roof.rotation.x = -Math.PI / 2 + 0.07;
  roof.position.set(4.7, 2.85, 1.9);
  roof.receiveShadow = true;
  scene.add(roof);
  fadeables.push({ kind: "roof", materials: [awning], y: 2.85, rect: { x0: -0.2, x1: 9.6, z0: 0.4, z1: 3.4 } });
  for (const px of [0.1, 4.7, 9.25]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 8), std({ color: 0x9aa0a6, metalness: 0.5 }), px, 1.35, 3.15);
  plant(0.5, FRONT_FLOOR_Y, 2.8, 0.8);
  plant(9.0, FRONT_FLOOR_Y, 2.8, 0.8);

  // ---------- โซน 3: บาร์หน้าครัว (x −8.2–−0.1, z −7.2–−0.1) ----------
  box(8.2, KITCHEN_FLOOR_Y, 7.2, std({ map: tiles(track, "#9a5a3c", "#d8c2b0", 8.2 / 0.35, 7.2 / 0.35), roughness: 0.5 }), -4.1, KITCHEN_FLOOR_Y / 2, -3.65);
  wall("x", -7.275, [[-8.2, 0]], 3.0, creamParams);
  box(1.4, 0.05, 0.12, lamp, -1.4, 2.85, -7.2);
  // ริมหน้าต่างด้านซ้าย: รั้วไม้ระแนงใต้บาร์ + ผ้าใบดำกันแดดด้านบน (ตามรูปจริง)
  const picket = std({ color: 0x8a5a33 });
  for (let pz = -7.0; pz <= -0.3; pz += 0.28) box(0.05, 0.95, 0.12, picket, -8.15, KITCHEN_FLOOR_Y + 0.48, pz);
  box(0.1, 0.08, 7.0, picket, -8.15, KITCHEN_FLOOR_Y + 0.92, -3.65);
  const tarp = new THREE.Mesh(
    track(new THREE.PlaneGeometry(7.0, 1.2)),
    track(new THREE.MeshBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })),
  );
  tarp.position.set(-8.2, KITCHEN_FLOOR_Y + 2.2, -3.65);
  tarp.rotation.y = Math.PI / 2;
  scene.add(tarp);
  for (const pz of [-7.1, -3.65, -0.2]) box(0.1, 3.0, 0.1, std({ color: 0x5e6268, metalness: 0.4 }), -8.2, KITCHEN_FLOOR_Y + 1.5, pz);
  // ระแนงเตี้ยด้านหน้าห้องครัว (ติดศาลา) เว้นทางเดินด้านขวา
  for (let px = -8.0; px <= -1.6; px += 0.28) box(0.12, 0.8, 0.05, picket, px, KITCHEN_FLOOR_Y + 0.4, -0.05);
  box(6.6, 0.08, 0.1, picket, -4.8, KITCHEN_FLOOR_Y + 0.78, -0.05);

  // ซุ้มครัว (ผังสีแดง): เคาน์เตอร์สั่งอาหาร + ป้ายเมนูภาพอาหาร (จากรูปจริง) + เตา กระทะ ฮูด ตู้เย็น
  const counterWood = std({ color: 0x8b5e3c, roughness: 0.6 });
  box(4.7, 1.0, 0.6, counterWood, -4.55, KITCHEN_FLOOR_Y + 0.5, -4.3);
  box(4.8, 0.05, 0.7, std({ color: 0xb03a2e, roughness: 0.5 }), -4.55, KITCHEN_FLOOR_Y + 1.02, -4.3);
  panel(1.4, 0.9, photo("/venue/latest/real-menu-counter.jpg", { x: 0.285, y: 0.64, w: 0.387, h: 0.36 }), -5.1, KITCHEN_FLOOR_Y + 0.5, -3.99);
  for (const [px, pz] of [[-6.9, -4.0], [-2.2, -4.0], [-6.9, -6.8], [-2.2, -6.8]] as const) {
    box(0.08, 2.7, 0.08, black, px, KITCHEN_FLOOR_Y + 1.35, pz);
  }
  box(3.3, 1.0, 0.05, std({ color: 0x3b2a1f }), -4.55, KITCHEN_FLOOR_Y + 2.35, -4.03);
  panel(3.2, 0.95, photo("/venue/latest/real-menu-counter.jpg", { x: 0.086, y: 0.021, w: 0.742, h: 0.292 }), -4.55, KITCHEN_FLOOR_Y + 2.35, -3.99);
  const stallRoof = std({ color: 0xa3372c, roughness: 0.7, side: THREE.DoubleSide });
  box(4.9, 0.08, 3.0, stallRoof, -4.55, KITCHEN_FLOOR_Y + 2.75, -5.4);
  fadeables.push({ kind: "roof", materials: [stallRoof], y: KITCHEN_FLOOR_Y + 2.75, rect: { x0: -7.0, x1: -2.1, z0: -6.9, z1: -3.9 }, minOpacity: 0.12 });
  box(3.2, 0.85, 0.7, steel, -4.9, KITCHEN_FLOOR_Y + 0.43, -6.4);
  for (const bx of [-5.9, -4.9, -3.9]) {
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), black, bx, KITCHEN_FLOOR_Y + 0.88, -6.4);
  }
  const wok = mesh(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), black, -5.9, KITCHEN_FLOOR_Y + 1.18, -6.4);
  wok.scale.y = 0.45;
  mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 14), steel, -3.9, KITCHEN_FLOOR_Y + 1.05, -6.4);
  box(3.2, 0.45, 0.8, steel, -4.9, KITCHEN_FLOOR_Y + 2.2, -6.45);
  box(0.8, 1.8, 0.7, steel, -2.65, KITCHEN_FLOOR_Y + 0.9, -6.35);
  box(0.8, 0.05, 2.2, std({ color: 0xcfcfcf }), -2.65, KITCHEN_FLOOR_Y + 0.95, -5.05);
  for (let i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.08, 12), white, -2.7, KITCHEN_FLOOR_Y + 1.02 + i * 0.08, -4.7);
  mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12), std({ color: 0xc81e1e, metalness: 0.2 }), -7.2, KITCHEN_FLOOR_Y + 0.35, -6.8);
  const blue = std({ color: 0x2f7fd8, roughness: 0.5 });
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16), blue, -7.6, KITCHEN_FLOOR_Y + 0.4, -6.0);
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16), blue, -7.6, KITCHEN_FLOOR_Y + 0.4, -5.3);

  // ---------- โซน 4: ศาลามุงจาก (x −8.2–−0.5, z 0.3–6.8) ----------
  box(7.7, SALA_FLOOR_Y, 6.5, std({ color: 0xb9b7b0, roughness: 0.4, metalness: 0.05 }), -4.35, SALA_FLOOR_Y / 2, 3.55);
  const grate = std({ map: stripes(track, "#6b2e22", "rgba(0,0,0,0.8)", 10, 8), roughness: 0.7 });
  box(7.7, 0.04, 0.35, grate, -4.35, 0.02, 7.0);
  const rough = std({ color: 0x6b5238, roughness: 1 });
  for (const px of [-8.0, -4.35, -0.7]) {
    for (const pz of [0.5, 6.6]) mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.7, 7), rough, px, SALA_FLOOR_Y + 1.35, pz);
    box(0.12, 0.12, 6.3, rough, px, SALA_FLOOR_Y + 2.72, 3.55);
  }
  box(7.5, 0.12, 0.12, rough, -4.35, SALA_FLOOR_Y + 2.7, 0.5);
  box(7.5, 0.12, 0.12, rough, -4.35, SALA_FLOOR_Y + 2.7, 6.6);
  const thatchMat = std({ map: thatch(track), side: THREE.DoubleSide, roughness: 1 });
  const thatchRoof = mesh(new THREE.ConeGeometry(5.7, 1.6, 4, 1, true), thatchMat, -4.35, SALA_FLOOR_Y + 3.55, 3.55, Math.PI / 4);
  thatchRoof.scale.set(1.0, 1, 0.86);
  fadeables.push({ kind: "roof", materials: [thatchMat], y: SALA_FLOOR_Y + 3.0, rect: { x0: -8.4, x1: -0.3, z0: 0.1, z1: 7.0 }, minOpacity: 0.35 });

  // จุดน้ำแข็ง/แก้วน้ำ (ผังสีฟ้า): ชั้นแก้วสีฟ้า + ถังน้ำแข็ง + ป้ายแดง
  box(0.5, 1.6, 1.2, white, -7.85, SALA_FLOOR_Y + 0.8, 1.05);
  const cup = std({ color: 0x5bb6e8, roughness: 0.4 });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 8), cup, -7.52, SALA_FLOOR_Y + 0.45 + row * 0.45, 0.62 + i * 0.28);
  }
  box(0.8, 0.6, 0.6, std({ color: 0x1f6fd1, roughness: 0.4 }), -7.15, SALA_FLOOR_Y + 0.3, 1.45);
  box(0.84, 0.08, 0.64, white, -7.15, SALA_FLOOR_Y + 0.64, 1.45);
  box(0.9, 0.6, 0.06, std({ color: 0xc81e1e }), -7.6, SALA_FLOOR_Y + 1.95, 0.48);
  plant(-0.9, SALA_FLOOR_Y, 6.3, 0.9);
  plant(-7.8, SALA_FLOOR_Y, 6.3, 0.9);

  function plant(x: number, y: number, z: number, size: number) {
    mesh(new THREE.CylinderGeometry(0.16 * size, 0.12 * size, 0.3 * size, 10), std({ color: 0x3c3c3c }), x, y + 0.15 * size, z);
    const green = std({ color: 0x5a9e3c, roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leafMesh = mesh(new THREE.ConeGeometry(0.09 * size, 0.9 * size, 5), green, x + Math.cos(a) * 0.12 * size, y + 0.62 * size, z + Math.sin(a) * 0.12 * size, 0, false);
      leafMesh.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  }

  // วัสดุที่จางได้ต้องรองรับความโปร่งใส
  for (const f of fadeables) for (const m of f.materials) m.userData["baseOpacity"] = m.opacity;
  return { fadeables };
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
  const metal = getMat("metal", () => new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.7, roughness: 0.3 }));

  // จำนวนเก้าอี้ที่วาดมีเพดานตามขนาดช่องวางโต๊ะ (ความจุจริงแสดงที่ป้าย)
  const maxPerSide = kind === "bar" ? 6 : kind === "long" ? 5 : 3;
  const perSide = Math.min(maxPerSide, Math.max(1, Math.ceil(capacity / (kind === "bar" ? 1 : 2))));
  const seats = Math.min(capacity, kind === "bar" ? perSide : perSide * 2);
  const length = kind === "long" ? Math.max(2.2, perSide * 0.5) : kind === "bar" ? Math.max(1.6, perSide * 0.5) : Math.max(0.9, perSide * 0.55);
  const depth = kind === "long" ? 0.8 : kind === "bar" ? 0.55 : 0.75;
  const height = kind === "bar" ? 1.05 : 0.75;

  const topColor = style === "folding" ? 0xd8d4cb : style === "sala" ? 0x9b7650 : style === "bar" ? 0x8a5a33 : 0xa0612f;
  const topMaterial = own(
    new THREE.MeshStandardMaterial({ color: topColor, roughness: style === "wood" ? 0.3 : 0.6, emissive: 0x000000 }),
  );
  const top = add(own(new THREE.BoxGeometry(length, 0.06, depth)), topMaterial, 0, height, 0, true);

  // ขาโต๊ะ
  const legMat = style === "sala" ? getMat("sala-wood", () => new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 })) : legBlack;
  const legGeo = getGeo(`leg-${height}`, () => new THREE.BoxGeometry(style === "folding" ? 0.04 : 0.07, height, style === "folding" ? 0.04 : 0.07));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) add(legGeo, legMat, sx * (length / 2 - 0.08), height / 2, sz * (depth / 2 - 0.08));
  }
  if (style === "wood") add(own(new THREE.BoxGeometry(length - 0.08, 0.1, depth - 0.08)), legBlack, 0, height - 0.08, 0);

  // เก้าอี้
  const seatY = kind === "bar" ? 0.7 : 0.45;
  const woodSeat = getMat("wood-seat", () => new THREE.MeshStandardMaterial({ color: 0xa8683a, roughness: 0.4 }));
  const greySeat = getMat("grey-seat", () => new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.7 }));
  const whiteSeat = getMat("white-seat", () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }));
  const salaSeat = getMat("sala-seat", () => new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.6 }));
  const stool = (x: number, z: number) => {
    if (style === "wood") {
      add(getGeo("wood-seat", () => new THREE.BoxGeometry(0.36, 0.05, 0.3)), woodSeat, x, seatY, z, true);
      add(getGeo("wood-stool-legs", () => new THREE.BoxGeometry(0.3, seatY - 0.03, 0.24)), legBlack, x, (seatY - 0.03) / 2, z);
    } else if (style === "folding") {
      add(getGeo("plastic-stool", () => new THREE.CylinderGeometry(0.16, 0.21, seatY, 4, 1)), greySeat, x, seatY / 2, z, true).rotation.y = Math.PI / 4;
    } else if (style === "bar") {
      add(getGeo("bar-seat", () => new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16)), whiteSeat, x, seatY, z, true);
      add(getGeo("bar-leg", () => new THREE.CylinderGeometry(0.03, 0.12, seatY, 8)), metal, x, seatY / 2, z);
    } else {
      add(getGeo("sala-seat", () => new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14)), salaSeat, x, seatY, z, true);
      add(getGeo("sala-leg", () => new THREE.CylinderGeometry(0.1, 0.15, seatY, 6, 1, true)), metal, x, seatY / 2, z);
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
  if (style === "wood" || style === "folding") {
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
