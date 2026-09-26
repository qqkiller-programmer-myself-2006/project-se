import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * ตู้โชว์เมนูหมุนได้ (หน้า Landing)
 *
 * บานกระจกกรอบทองเหลืองเรียงเป็นวงกลม หมุนช้า ๆ เหมือนประตูกระจกหมุน
 * แต่ละบานมีรูปเมนู ชื่อ และราคา
 *
 * ข้อตกลงสำคัญ: canvas เป็นของประดับ (aria-hidden) — ข้อมูลและปุ่มกดจริง
 * อยู่ใน DOM ที่หน้า Landing วางไว้ข้างนอก คนใช้คีย์บอร์ด/สกรีนรีดเดอร์
 * และเครื่องที่ไม่มี WebGL จึงใช้งานได้ครบเหมือนกัน
 */

export type ShowcaseItem = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
};

export type MenuShowcase3DProps = {
  items: ShowcaseItem[];
  /** บานที่อยู่ด้านหน้า (หน้า Landing เป็นเจ้าของ state นี้) */
  activeIndex: number;
  /** ผู้ใช้ลากบานอื่นมาไว้ด้านหน้า */
  onActiveIndexChange: (index: number) => void;
};

const PANEL_WIDTH = 1.62;
const PANEL_HEIGHT = 2.24;
/** เว้นช่องระหว่างบานให้เห็นความลึกของตู้ */
const PANEL_GAP = 1.22;
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 708;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function fmtPrice(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** วาดหน้าบานหนึ่งใบลง canvas: รูป (ถ้ามี) + ชื่อ + ราคา บนพื้นงาช้าง */
function paintPanel(
  ctx: CanvasRenderingContext2D,
  item: ShowcaseItem,
  image: HTMLImageElement | null,
): void {
  const w = TEXTURE_WIDTH;
  const h = TEXTURE_HEIGHT;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#fbf9f6";
  roundedRect(ctx, 0, 0, w, h, 26);
  ctx.fill();

  const photo = { x: 22, y: 22, w: w - 44, h: Math.round(h * 0.66) };
  ctx.save();
  roundedRect(ctx, photo.x, photo.y, photo.w, photo.h, 16);
  ctx.clip();
  if (image) {
    // ครอบรูปแบบ cover — ไม่ยืดรูปอาหาร
    const scale = Math.max(photo.w / image.width, photo.h / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, photo.x + (photo.w - dw) / 2, photo.y + (photo.h - dh) / 2, dw, dh);
  } else {
    const grad = ctx.createLinearGradient(photo.x, photo.y, photo.x + photo.w, photo.y + photo.h);
    grad.addColorStop(0, "#2a1614");
    grad.addColorStop(1, "#3e1a18");
    ctx.fillStyle = grad;
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
    ctx.fillStyle = "rgba(233, 220, 185, 0.85)";
    ctx.font = '600 120px "Cormorant Garamond", Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ปอ", photo.x + photo.w / 2, photo.y + photo.h / 2);
  }
  ctx.restore();

  // เส้นทองเหลืองบางคาดใต้รูป
  ctx.strokeStyle = "rgba(168, 133, 63, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(photo.x, photo.y + photo.h + 26);
  ctx.lineTo(photo.x + photo.w, photo.y + photo.h + 26);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#14110f";
  ctx.font = '600 44px "Noto Serif Thai", "Cormorant Garamond", Georgia, serif';
  const name = item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name;
  ctx.fillText(name, w / 2, photo.y + photo.h + 94);

  ctx.fillStyle = "#6f5527";
  ctx.font = '600 38px Karla, "IBM Plex Sans Thai", sans-serif';
  ctx.fillText(fmtPrice(item.price), w / 2, photo.y + photo.h + 152);
}

/** คราบแสงบาง ๆ พาดหน้าบาน ทำให้บานอ่านเป็นกระจกไม่ใช่กระดาษ */
function makeGlassTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(255,255,255,0.32)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.04)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

export function MenuShowcase3D({ items, activeIndex, onActiveIndexChange }: MenuShowcase3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  /** index ที่ scene ควรหันมาด้านหน้า — อ่านใน rAF โดยไม่ต้องสร้าง scene ใหม่ */
  const targetRef = useRef(activeIndex);
  /** index ที่ scene รายงานออกไปเอง — ใช้แยกว่าใครเป็นคนเปลี่ยน */
  const sceneIndexRef = useRef(activeIndex);
  /** หยุดหมุนอัตโนมัติจนถึงเวลานี้ (ผู้ใช้เพิ่งสั่งหมุน) */
  const idleUntilRef = useRef(0);
  const reportRef = useRef(onActiveIndexChange);
  reportRef.current = onActiveIndexChange;

  useEffect(() => {
    targetRef.current = activeIndex;
    // เปลี่ยนจากปุ่ม/คีย์บอร์ดข้างนอก (ไม่ใช่การไหลของ scene เอง) → หยุดหมุนอัตโนมัติชั่วคราว
    if (activeIndex !== sceneIndexRef.current) {
      sceneIndexRef.current = activeIndex;
      idleUntilRef.current =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) + 9000;
    }
  }, [activeIndex]);

  // ตัวตนของ scene ผูกกับรายการเมนู (id + รูป) — เปลี่ยนรายการจึงสร้างใหม่
  const signature = useMemo(
    () => items.map((i) => `${i.id}:${i.imageUrl ?? ""}:${i.price}:${i.name}`).join("|"),
    [items],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || items.length === 0) return;
    // ผูกกล่องไว้ในตัวแปรที่ประกาศชนิดไม่เป็น null — closure ข้างล่างอ่านได้โดยไม่ต้องเช็กซ้ำ
    const stage: HTMLDivElement = host;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }

    const count = items.length;
    const step = (Math.PI * 2) / count;
    const radius = Math.max(2.4, (count * PANEL_WIDTH * PANEL_GAP) / (Math.PI * 2));

    let disposed = false;
    const disposables: { dispose: () => void }[] = [];
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.25, radius + 3.1);
    camera.lookAt(0, 0, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearAlpha(0);
    stage.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "pan-y";
    renderer.domElement.style.cursor = "grab";

    const carousel = new THREE.Group();
    scene.add(carousel);

    // แสงนุ่มแบบพรีเมียม: ambient อุ่น + rim เย็นจากด้านหลัง + fill เบา ๆ ด้านหน้า
    // ตั้งใจไม่เปิด shadow map — คง low-power และใช้เงาวงรีจาก CSS แทน
    const ambient = new THREE.AmbientLight(0xfff6e5, 0.85);
    scene.add(ambient);
    const rim = new THREE.DirectionalLight(0xe9dcb9, 1.1);
    rim.position.set(-3.5, 4, -4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(3, 1.5, 5);
    scene.add(fill);

    const glassTexture = makeGlassTexture();
    if (glassTexture) disposables.push(glassTexture);

    const panelGeometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
    const frameGeometry = new THREE.PlaneGeometry(PANEL_WIDTH + 0.12, PANEL_HEIGHT + 0.12);
    disposables.push(panelGeometry, frameGeometry);

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xa8853f,
      metalness: 0.65,
      roughness: 0.32,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    disposables.push(frameMaterial);

    /** วาดบานใหม่เมื่อเว็บฟอนต์มาถึง — บานที่วาดก่อนฟอนต์โหลดจะเป็นฟอนต์สำรอง */
    const repaints: (() => void)[] = [];

    items.forEach((item, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = TEXTURE_WIDTH;
      canvas.height = TEXTURE_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (ctx) paintPanel(ctx, item, null);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      disposables.push(texture);

      if (ctx) {
        let loaded: HTMLImageElement | null = null;
        const repaint = () => {
          paintPanel(ctx, item, loaded);
          texture.needsUpdate = true;
        };
        repaints.push(repaint);

        if (item.imageUrl) {
          const image = new Image();
          // รูปเมนูจริงอยู่บน R2 (คนละ origin) — ต้องขอแบบ CORS ไม่งั้น canvas ติด taint
          // แล้ว WebGL อัปโหลดเป็น texture ไม่ได้ (SecurityError) บานจะค้างเป็น "ปอ" ตลอด
          // เซิร์ฟเวอร์ที่ไม่ตอบ CORS header → รูปโหลดไม่ขึ้น (onerror) บานคงเป็น "ปอ" แต่ไม่พัง
          image.crossOrigin = "anonymous";
          image.decoding = "async";
          image.onload = () => {
            if (disposed) return;
            loaded = image;
            repaint();
          };
          // รูปพังก็ปล่อยให้เป็นบานตัวอักษร "ปอ" ตามที่วาดไว้แล้ว
          image.src = item.imageUrl;
        }
      }

      // ด้านหน้าอย่างเดียว — บานฝั่งหลังตู้จะเห็นแผ่นทองเหลือง ไม่ใช่ตัวหนังสือกลับด้าน
      const panelMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.FrontSide,
      });
      disposables.push(panelMaterial);

      const angle = index * step;
      const anchor = new THREE.Object3D();
      anchor.rotation.y = angle;
      carousel.add(anchor);

      const frame = new THREE.Mesh(frameGeometry, frameMaterial);
      frame.position.set(0, 0, radius - 0.02);
      anchor.add(frame);

      const panel = new THREE.Mesh(panelGeometry, panelMaterial);
      panel.position.set(0, 0, radius);
      anchor.add(panel);

      if (glassTexture) {
        const glassMaterial = new THREE.MeshBasicMaterial({
          map: glassTexture,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.FrontSide,
        });
        disposables.push(glassMaterial);
        const glass = new THREE.Mesh(panelGeometry, glassMaterial);
        glass.position.set(0, 0, radius + 0.012);
        anchor.add(glass);
      }
    });

    let angle = -activeIndex * step;
    carousel.rotation.y = angle;

    const reduced = prefersReducedMotion();
    let dragging = false;
    let dragMoved = false;
    let lastX = 0;
    let raf: number | null = null;

    function targetAngle(): number {
      // เลือกรอบที่ใกล้มุมปัจจุบันที่สุด ไม่ให้หมุนย้อนข้ามทั้งวงเมื่อวนกลับ index 0
      const base = -targetRef.current * step;
      const turns = Math.round((angle - base) / (Math.PI * 2));
      return base + turns * Math.PI * 2;
    }

    function indexFromAngle(): number {
      const raw = Math.round(-angle / step) % count;
      return raw < 0 ? raw + count : raw;
    }

    /** บอกหน้า Landing ว่าบานหน้าเปลี่ยน โดยจำไว้ว่าเป็น scene เองที่เปลี่ยน */
    function report(index: number) {
      sceneIndexRef.current = index;
      targetRef.current = index;
      reportRef.current(index);
    }

    function resize() {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // จอแคบต้องถอยกล้องออก ไม่งั้นบานหน้าโดนตัดขอบ
      camera.position.z = radius + 3.1 + Math.max(0, 1.4 - camera.aspect) * 3.4;
      camera.updateProjectionMatrix();
    }

    /** ตู้อยู่นอกจอ → หยุด render (ไม่งั้นมือถือเผา GPU/แบตทั้งที่ไม่มีใครเห็น) */
    let onScreen = true;

    function frame() {
      raf = null;
      if (disposed || !onScreen) return;
      if (!dragging) {
        if (!reduced && performance.now() > idleUntilRef.current) {
          // ไหลไปบานถัดไปเองเมื่อผู้ใช้ไม่ได้แตะมาสักพัก
          angle -= step / 260;
          const settled = indexFromAngle();
          if (settled !== sceneIndexRef.current) report(settled);
        } else {
          angle += (targetAngle() - angle) * 0.09;
        }
      }
      carousel.rotation.y = angle;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      dragMoved = false;
      lastX = event.clientX;
      idleUntilRef.current = performance.now() + 9000;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      if (Math.abs(dx) > 0) dragMoved = true;
      angle += dx * 0.006;
    }

    function onPointerUp(event: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      renderer.domElement.style.cursor = "grab";
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      idleUntilRef.current = performance.now() + 9000;
      if (dragMoved) report(indexFromAngle());
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);

    // เว็บฟอนต์ (Cormorant/Noto Serif Thai) มาช้ากว่าเฟรมแรก — วาดบานใหม่เมื่อพร้อม
    let fontsSettled = false;
    document.fonts?.ready
      ?.then(() => {
        if (disposed || fontsSettled) return;
        fontsSettled = true;
        for (const repaint of repaints) repaint();
      })
      .catch(() => {
        // ฟอนต์โหลดไม่ได้ก็ใช้ฟอนต์สำรองที่วาดไว้แล้ว
      });

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(stage);
    const visibilityObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1]!.isIntersecting;
            if (onScreen && raf === null && !disposed) frame();
          })
        : null;
    visibilityObserver?.observe(stage);
    window.addEventListener("resize", resize);
    resize();
    frame();

    return () => {
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // scene สร้างใหม่เมื่อรายการเมนูเปลี่ยน — activeIndex ส่งผ่าน ref ไม่ให้ remount ทุกครั้งที่หมุน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (failed || items.length === 0) return null;

  return <div ref={hostRef} aria-hidden="true" className="menu-showcase__stage" />;
}

export default MenuShowcase3D;
