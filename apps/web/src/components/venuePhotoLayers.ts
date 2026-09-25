import * as THREE from "three";
import type { Track } from "./venueScenery";

/**
 * ชั้นภาพถ่ายจริงเป็นฉากหลังลานจอดรถ: ตัดเฉพาะต้นไม้จาก storefront-seating.jpg (รูปมองออกไปนอกร้าน)
 * เป็นแผ่นซ้อนกันคนละระยะ หันหน้าหากล้องเสมอ และเคลื่อนตามกล้องไม่เท่ากัน (parallax) ให้ฉากมีมิติเมื่อหมุนโมเดล
 */

export const STOREFRONT_PHOTO = "/venue/reservations/storefront-seating.jpg";

/** เขตของรูป (สัดส่วน 0–1 นับจากมุมซ้ายบน) ที่เป็นแถวต้นไม้ลานจอดรถ */
const TREE_CROP = { x: 0.08, y: 0.27, w: 0.54, h: 0.26 };

/**
 * เจาะพื้นหลังที่ไม่ใช่ใบไม้ออก (ถนน รถ ท้องฟ้า) แล้วเก็บเฉพาะพิกเซลโทนเขียว — แก้ค่า alpha ในที่
 * @returns จำนวนพิกเซลที่เก็บไว้ (alpha > 0)
 */
export function greenKeyAlpha(rgba: Uint8ClampedArray): number {
  let kept = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const greenness = g - Math.max(r, b * 0.9);
    // ขอบนุ่ม 6–24 ระดับ · ตัดพิกเซลสว่างจัด (ท้องฟ้า/ป้ายขาว)
    const alpha = g > 235 ? 0 : Math.max(0, Math.min(1, (greenness - 6) / 18));
    rgba[i + 3] = Math.round(alpha * 255);
    if (alpha > 0) kept++;
  }
  return kept;
}

/**
 * ระยะที่ชั้นภาพเลื่อนตามกล้อง: depth 1 = ตรึงกับโลก (ไม่เลื่อน) · 0 = ติดตามกล้องเต็มที่
 * ชั้นที่ไกลจึงขยับบนหน้าจอน้อยกว่าชั้นใกล้ตอนกล้องหมุน
 */
export function parallaxShift(
  camera: { x: number; z: number },
  reference: { x: number; z: number },
  depth: number,
  limit = 4,
): { x: number; z: number } {
  const k = 1 - Math.max(0, Math.min(1, depth));
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
  return { x: clamp((camera.x - reference.x) * k), z: clamp((camera.z - reference.z) * k) };
}

export interface PhotoBackdrop {
  update: (camera: THREE.Camera) => void;
}

interface Layer {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  depth: number;
}

/** จุดอ้างอิงที่กล้องตั้งต้นมองร้านจากด้านหน้า (กลางร้าน) */
const REFERENCE = { x: 4.5, z: 8 };

export function buildPhotoBackdrop({
  scene,
  track,
  onTextureLoad,
}: {
  scene: THREE.Scene;
  track: Track;
  onTextureLoad: () => void;
}): PhotoBackdrop {
  const CANVAS_W = 768;
  const CANVAS_H = Math.round((CANVAS_W * TREE_CROP.h * 1086) / (TREE_CROP.w * 1448));
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  // สร้างเนื้อผ้าไว้ก่อนแล้วค่อยวาดเมื่อรูปโหลดเสร็จ — ทำให้ dispose ได้แม้รูปยังไม่มา
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const layers: Layer[] = [];
  const specs: { x: number; y: number; z: number; w: number; mirror: boolean; depth: number }[] = [
    { x: 2.0, y: 1.7, z: 22.3, w: 9.2, mirror: false, depth: 0.55 },
    { x: 11.5, y: 1.9, z: 23.1, w: 10.4, mirror: true, depth: 0.3 },
  ];
  const aspect = CANVAS_W / CANVAS_H;
  for (const s of specs) {
    const material = track(new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, fog: true }));
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(s.w * (s.mirror ? -1 : 1), s.w / aspect)), material);
    mesh.position.set(s.x, s.y, s.z);
    mesh.visible = false;
    scene.add(mesh);
    layers.push({ mesh, base: mesh.position.clone(), depth: s.depth });
  }

  let disposed = false;
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || disposed) return;
    const sx = TREE_CROP.x * image.naturalWidth;
    const sy = TREE_CROP.y * image.naturalHeight;
    ctx.drawImage(image, sx, sy, TREE_CROP.w * image.naturalWidth, TREE_CROP.h * image.naturalHeight, 0, 0, CANVAS_W, CANVAS_H);
    const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    greenKeyAlpha(data.data);
    ctx.putImageData(data, 0, 0);
    texture.needsUpdate = true;
    for (const l of layers) l.mesh.visible = true;
    onTextureLoad();
  };
  image.src = STOREFRONT_PHOTO;
  track({
    dispose() {
      disposed = true;
      image.onload = null;
    },
  });

  return {
    update(camera) {
      for (const { mesh, base, depth } of layers) {
        const shift = parallaxShift(camera.position, REFERENCE, depth);
        mesh.position.set(base.x + shift.x, base.y, base.z + shift.z);
        // หันหน้าเข้าหากล้องเฉพาะแกนตั้ง
        mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
      }
    },
  };
}
