import * as THREE from "three";
import { KITCHEN_FLOOR_Y, SALA_FLOOR_Y, SHOP_FLOOR_Y, type TableStyle } from "./venueModel";

/**
 * ฉากร้านป้าอ้อแบบ low-poly ที่อ้างอิงรูปจริง: พื้นผิวสร้างด้วย canvas และบางส่วนตัดจากรูปถ่ายจริง
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

export interface SceneryOptions {
  scene: THREE.Scene;
  track: Track;
  onTextureLoad: () => void;
}

/** สร้างอาคาร โซน และของตกแต่งทั้งหมด (ไม่รวมโต๊ะที่จองได้) */
export function buildScenery({ scene, track, onTextureLoad }: SceneryOptions): void {
  const loader = new THREE.TextureLoader();
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

  const black = std({ color: 0x1f1b18, roughness: 0.6 });
  const cream = std({ color: 0xf3e8d2 });
  const concrete = std({ color: 0xc9c4ba, roughness: 1 });
  const white = std({ color: 0xf4f1ea });

  // ---------- พื้นดิน ลานจอดรถ ต้นไม้ ----------
  box(60, 0.1, 50, std({ color: 0xa9a49a, roughness: 1 }), 0, -0.05, 0);
  box(34, 0.02, 10, std({ color: 0x8d8a84, roughness: 1 }), 0, 0.01, 14.5);
  const trunk = std({ color: 0x5b4330 });
  const leaf = std({ color: 0x4f8a3a, roughness: 1 });
  for (const tx of [-9, -4, 1, 6, 11]) {
    mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), trunk, tx, 1.1, 17.5);
    mesh(new THREE.SphereGeometry(1.4, 12, 10), leaf, tx, 2.9, 17.5);
  }
  const car = std({ color: 0xf1f1f1, roughness: 0.4, metalness: 0.3 });
  box(1.8, 0.8, 4.2, car, -5.5, 0.55, 14);
  box(1.6, 0.6, 2.2, std({ color: 0x3b4450, roughness: 0.3 }), -5.5, 1.2, 13.8);
  box(1.8, 0.75, 4.3, std({ color: 0x5f6368, roughness: 0.4, metalness: 0.3 }), 3.5, 0.55, 14.5);

  // ---------- ร้านหลัก ----------
  box(7, SHOP_FLOOR_Y, 11, std({ map: tiles(track, "#f1efea", "#cfcac0", 7 / 0.6, 11 / 0.6), roughness: 0.35 }), 0, SHOP_FLOOR_Y / 2, -0.5);
  // ผนังหลังลายไม้ + ป้ายร้านป้าอ้อ (ตัดจากรูปห้องอาหาร)
  box(7, 3.2, 0.2, std({ map: planks(track, "#b77a45", "rgba(80,40,15,0.5)", 10, true, 2, 1), roughness: 0.6 }), 0, 1.75, -6.1);
  panel(2.8, 1.23, photo("/venue/reservations/dining-room.jpg", { x: 0.526, y: 0.167, w: 0.205, h: 0.12 }), 0.4, 2.2, -5.99);
  // ผนังซ้าย ครีม + โปสเตอร์เมนูดำ + ภาพคะน้าหมูกรอบ + พัดลมติดผนัง
  box(0.2, 3.2, 11, cream, -3.6, 1.75, -0.5);
  panel(0.72, 1.6, photo("/venue/reservations/dining-room.jpg", { x: 0.245, y: 0.118, w: 0.064, h: 0.186 }), -3.49, 2.0, -1.2, Math.PI / 2);
  panel(1.1, 0.93, photo("/venue/reservations/dining-room.jpg", { x: 0, y: 0.159, w: 0.105, h: 0.119 }), -3.49, 1.95, 2.3, Math.PI / 2);
  mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 20), white, -3.42, 2.55, 0.6).rotation.set(0, 0, Math.PI / 2);
  box(0.12, 0.2, 0.12, white, -3.45, 2.3, 0.6);
  // ผนังขวา: ต่ำด้านใน (ให้มองเห็นโต๊ะ) · สูงหลังเคาน์เตอร์ชาใต้ พร้อมภาพติดผนังร้านกาแฟอิฐ
  box(0.2, 1.1, 6.9, cream, 3.6, 0.7, -2.55);
  box(0.2, 3.2, 4.1, cream, 3.6, 1.75, 2.95);
  panel(3.4, 2.2, photo("/venue/reservations/counter.jpg", { x: 0.227, y: 0.13, w: 0.5, h: 0.432 }), 3.49, 2.0, 2.9, -Math.PI / 2);
  // ชั้นวาง "Coffee in love" สีขาวหลังเคาน์เตอร์
  box(0.5, 2.0, 1.1, white, 3.2, 1.15, 0.9);
  // เสาหน้าร้าน + แถบรูปเครื่องดื่ม + คานประตูม้วน
  box(0.45, 3.2, 0.45, cream, 3.55, 1.75, 5.0);
  box(0.45, 3.2, 0.45, cream, -3.55, 1.75, 5.0);
  panel(0.26, 2.3, photo("/venue/reservations/counter.jpg", { x: 0.785, y: 0.104, w: 0.055, h: 0.73 }), 3.31, 1.75, 5.0, -Math.PI / 2);
  box(7.6, 0.55, 0.35, std({ color: 0x8f8a82, metalness: 0.4, roughness: 0.5 }), 0, 3.1, 5.0);

  // เคาน์เตอร์ชาใต้: ไม้พาเลทตั้ง + โลโก้วงกลม (ตัดจากรูปจริง) + ของบนเคาน์เตอร์
  const pallet = std({ map: planks(track, "#c98f55", "rgba(90,50,20,0.55)", 9, true), roughness: 0.75 });
  box(0.7, 1.05, 3.0, pallet, 2.45, SHOP_FLOOR_Y + 0.525, 2.9);
  box(0.9, 0.06, 3.2, std({ color: 0xa8703f, roughness: 0.5 }), 2.45, SHOP_FLOOR_Y + 1.08, 2.9);
  panel(0.66, 0.74, photo("/venue/reservations/counter.jpg", { x: 0.492, y: 0.667, w: 0.133, h: 0.198 }), 2.09, SHOP_FLOOR_Y + 0.55, 3.3, -Math.PI / 2);
  box(0.06, 0.4, 0.3, black, 2.3, SHOP_FLOOR_Y + 1.31, 3.4);
  box(0.06, 0.4, 0.3, std({ color: 0xe0955a }), 2.3, SHOP_FLOOR_Y + 1.31, 3.8);
  box(0.25, 0.3, 0.25, std({ color: 0x3a3a3a, metalness: 0.4 }), 2.6, SHOP_FLOOR_Y + 1.26, 4.2);
  plant(2.55, SHOP_FLOOR_Y + 1.11, 1.7, 0.45);

  // ต้นเฟิร์นกระถางหน้าร้าน
  plant(3.0, 0, 5.6, 0.8);
  plant(-3.0, SHOP_FLOOR_Y, 4.3, 0.6);

  // ---------- กันสาดหน้าร้าน ----------
  box(10, 0.02, 4.6, concrete, 0, 0.01, 7.3);
  const roof = new THREE.Mesh(
    track(new THREE.PlaneGeometry(9.4, 4.5)),
    track(
      new THREE.MeshStandardMaterial({
        map: stripes(track, "#b9bdc1", "rgba(60,64,70,0.45)", 8, 12),
        metalness: 0.4,
        roughness: 0.5,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  roof.rotation.x = -Math.PI / 2 + 0.07;
  roof.position.set(0, 2.85, 7.2);
  scene.add(roof);
  const net = new THREE.Mesh(
    track(new THREE.PlaneGeometry(8.8, 0.8)),
    track(new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })),
  );
  net.position.set(0, 2.25, 9.35);
  scene.add(net);
  for (const px of [-4.5, 0, 4.5]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 8), std({ color: 0x9aa0a6, metalness: 0.5 }), px, 1.35, 9.35);

  // ---------- บาร์หน้าครัว (อาคารแยก) ----------
  box(6, KITCHEN_FLOOR_Y, 9.6, std({ map: tiles(track, "#9a5a3c", "#d8c2b0", 6 / 0.35, 9.6 / 0.35), roughness: 0.5 }), 9, KITCHEN_FLOOR_Y / 2, -1.2);
  box(6, 2.8, 0.2, cream, 9, 1.5, -6.1);
  box(0.2, 1.1, 9.6, cream, 12.1, 0.65, -1.2);
  const kitchenRoof = new THREE.Mesh(
    track(new THREE.PlaneGeometry(6.4, 10)),
    track(
      new THREE.MeshStandardMaterial({
        map: stripes(track, "#c4c7cb", "rgba(60,64,70,0.4)", 8, 10),
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  kitchenRoof.rotation.x = -Math.PI / 2;
  kitchenRoof.position.set(9, 3.2, -1.2);
  scene.add(kitchenRoof);
  // ริมหน้าต่างด้านซ้าย: รั้วไม้ระแนงใต้บาร์ + ผ้าใบดำกันแดดด้านบน (ตามรูปจริง)
  const picket = std({ color: 0x8a5a33 });
  for (let pz = -5.6; pz <= 3.4; pz += 0.28) box(0.05, 0.95, 0.12, picket, 6.12, KITCHEN_FLOOR_Y + 0.48, pz);
  box(0.1, 0.08, 9.2, picket, 6.12, KITCHEN_FLOOR_Y + 0.92, -1.1);
  const tarp = new THREE.Mesh(
    track(new THREE.PlaneGeometry(9.2, 1.2)),
    track(new THREE.MeshBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })),
  );
  tarp.position.set(6.05, KITCHEN_FLOOR_Y + 2.1, -1.1);
  tarp.rotation.y = Math.PI / 2;
  scene.add(tarp);
  for (const pz of [-5.8, -1.1, 3.5]) box(0.1, 3.0, 0.1, std({ color: 0x5e6268, metalness: 0.4 }), 6.05, KITCHEN_FLOOR_Y + 1.5, pz);
  // ซุ้มครัว: เคาน์เตอร์ + ป้ายเมนูภาพอาหาร (ตัดจากรูปจริง) + ตู้เย็น + ถังน้ำสีฟ้า
  box(2.9, 1.0, 0.7, std({ color: 0x8b5e3c, roughness: 0.6 }), 9, KITCHEN_FLOOR_Y + 0.5, -5.0);
  panel(1.2, 0.84, photo("/venue/latest/real-menu-counter.jpg", { x: 0.285, y: 0.64, w: 0.387, h: 0.36 }), 8.6, KITCHEN_FLOOR_Y + 0.5, -4.64);
  for (const px of [7.55, 10.45]) box(0.08, 2.5, 0.08, black, px, KITCHEN_FLOOR_Y + 1.25, -4.7);
  panel(3.0, 0.89, photo("/venue/latest/real-menu-counter.jpg", { x: 0.086, y: 0.021, w: 0.742, h: 0.292 }), 9, KITCHEN_FLOOR_Y + 2.3, -4.64);
  box(3.0, 0.9, 0.05, std({ color: 0x3b2a1f }), 9, KITCHEN_FLOOR_Y + 2.3, -4.7);
  box(0.8, 1.8, 0.7, std({ color: 0xc8cbce, metalness: 0.6, roughness: 0.3 }), 11.3, KITCHEN_FLOOR_Y + 0.9, -5.4);
  const blue = std({ color: 0x2f7fd8, roughness: 0.5 });
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16), blue, 6.5, KITCHEN_FLOOR_Y + 0.4, -5.5);
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16), blue, 6.5, KITCHEN_FLOOR_Y + 0.4, -4.8);

  // ---------- ศาลามุงจาก ----------
  box(5.6, SALA_FLOOR_Y, 6.4, std({ color: 0xb9b7b0, roughness: 0.4, metalness: 0.05 }), -8.25, SALA_FLOOR_Y / 2, -2);
  const grate = std({ map: stripes(track, "#6b2e22", "rgba(0,0,0,0.8)", 10, 8), roughness: 0.7 });
  box(5.6, 0.04, 0.4, grate, -8.25, 0.02, 1.45);
  const rough = std({ color: 0x6b5238, roughness: 1 });
  for (const [px, pz] of [[-10.9, -5], [-5.6, -5], [-10.9, 0.9], [-5.6, 0.9], [-8.25, -5], [-8.25, 0.9]] as const) {
    mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.7, 7), rough, px, SALA_FLOOR_Y + 1.35, pz);
  }
  box(5.5, 0.12, 0.12, rough, -8.25, SALA_FLOOR_Y + 2.7, -5);
  box(5.5, 0.12, 0.12, rough, -8.25, SALA_FLOOR_Y + 2.7, 0.9);
  for (const px of [-10.9, -8.25, -5.6]) box(0.12, 0.12, 6.0, rough, px, SALA_FLOOR_Y + 2.72, -2.05);
  const thatchRoof = mesh(
    new THREE.ConeGeometry(4.5, 1.5, 4, 1, true),
    std({ map: thatch(track), side: THREE.DoubleSide, roughness: 1 }),
    -8.25,
    SALA_FLOOR_Y + 3.45,
    -2.05,
    Math.PI / 4,
  );
  thatchRoof.scale.set(1.0, 1, 1.15);
  // ชั้นวางแก้วสีฟ้า + ป้ายแดง
  box(0.5, 1.6, 0.9, white, -5.9, SALA_FLOOR_Y + 0.8, -3.6);
  const cup = std({ color: 0x5bb6e8, roughness: 0.4 });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 8), cup, -6.1, SALA_FLOOR_Y + 0.55 + row * 0.45, -3.9 + i * 0.3);
  }
  box(0.08, 0.7, 0.9, std({ color: 0xc81e1e }), -5.55, SALA_FLOOR_Y + 0.9, -2.3);

  function plant(x: number, y: number, z: number, size: number) {
    mesh(new THREE.CylinderGeometry(0.16 * size, 0.12 * size, 0.3 * size, 10), std({ color: 0x3c3c3c }), x, y + 0.15 * size, z);
    const green = std({ color: 0x5a9e3c, roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leafMesh = mesh(new THREE.ConeGeometry(0.09 * size, 0.9 * size, 5), green, x + Math.cos(a) * 0.12 * size, y + 0.62 * size, z + Math.sin(a) * 0.12 * size, 0, false);
      leafMesh.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  }
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
