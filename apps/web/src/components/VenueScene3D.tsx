import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { TableZone } from "../lib/api";
import { getZone, landmarks, type CameraView, type LandmarkKind, type PlacedTable } from "./venueModel";
import type { PhotoBackdrop } from "./venuePhotoLayers";
import { buildFurniture, buildScenery, type Fadeable, type Track } from "./venueScenery";

export type VenueScene3DProps = {
  /** โต๊ะทั้งร้าน (โซนอื่นแสดงจาง ๆ เป็นบริบท) */
  tables: PlacedTable[];
  /** โซนที่ส่วนนี้ของหน้าเว็บแสดง — เลือกได้เฉพาะโต๊ะในโซนนี้ */
  focusZoneId: TableZone;
  /** มุมกล้องเป้าหมาย (เช่น มุมเดียวกับรูปจริงที่เลือก) */
  view: CameraView;
  /** เปลี่ยนค่านี้เพื่อสั่งให้กล้องไปที่ view อีกครั้ง */
  viewKey: string;
  selectedTableId: string | null;
  recommendedTableId: string | null;
  onTableClick: (tableId: string) => void;
};

type TableVisual = {
  table: PlacedTable;
  topMaterial: THREE.MeshStandardMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
  selectRing: THREE.Mesh;
  recommendRing: THREE.Mesh;
  anchor: THREE.Object3D;
};

type SceneState = {
  tables: PlacedTable[];
  selected: string | null;
  recommended: string | null;
  focus: TableZone;
};

type SceneApi = {
  setTables: (tables: PlacedTable[]) => void;
  applyStates: (state: SceneState) => void;
  setView: (view: CameraView) => void;
  zoomBy: (factor: number) => void;
  invalidate: () => void;
};

const MIN_RADIUS = 3;
const MAX_RADIUS = 30;
// มุมกล้องตั้งไว้สำหรับ canvas กว้าง ~4:3 — จอแคบต้องถอยกล้องออกเล็กน้อย
const DESIGN_ASPECT = 1.33;

const HALO: Record<PlacedTable["status"] | "selected", { color: number; opacity: number }> = {
  available: { color: 0x22c55e, opacity: 0.42 },
  booked: { color: 0x78716c, opacity: 0.35 },
  too_small: { color: 0xf59e0b, opacity: 0.32 },
  selected: { color: 0xdc2626, opacity: 0.6 },
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tableLayoutKey(tables: PlacedTable[]): string {
  return tables
    .map((t) => `${t.id}:${t.capacity}:${t.slot.position.x},${t.slot.position.z}:${t.slot.kind}:${t.slot.style}`)
    .join("|");
}

export function VenueScene3D({
  tables,
  focusZoneId,
  view,
  viewKey,
  selectedTableId,
  recommendedTableId,
  onTableClick,
}: VenueScene3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [wheelHint, setWheelHint] = useState(false);
  const apiRef = useRef<SceneApi | null>(null);
  // ref callback ของป้ายทำงานก่อน effect สร้างฉาก จึงเก็บป้ายไว้ที่ component
  const pinsRef = useRef(new Map<string, HTMLElement>());
  const onTableClickRef = useRef(onTableClick);
  onTableClickRef.current = onTableClick;
  const stateRef = useRef<SceneState>({ tables, selected: selectedTableId, recommended: recommendedTableId, focus: focusZoneId });
  stateRef.current = { tables, selected: selectedTableId, recommended: recommendedTableId, focus: focusZoneId };
  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutKey = tableLayoutKey(tables);
  const statusKey = tables.map((t) => t.status).join(",");

  // สร้างฉากคงที่ครั้งเดียว (ร้าน โซน รูปจริง แสง กล้อง การควบคุม)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
      if (!renderer.getContext()) throw new Error("no webgl");
    } catch {
      setFailed(true);
      return;
    }

    const disposables: { dispose: () => void }[] = [];
    const track: Track = (obj) => {
      disposables.push(obj);
      return obj;
    };
    const width = () => Math.max(1, mount.clientWidth || 300);
    const height = () => Math.max(1, mount.clientHeight || 300);
    const reducedMotion = prefersReducedMotion();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width(), height());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // ปัดขึ้นลงยังเลื่อนหน้าเว็บได้ตามปกติ ลากแนวนอนเพื่อหมุนโมเดล
    canvas.style.touchAction = "pan-y";
    mount.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe9ee);
    scene.fog = new THREE.Fog(0xdfe9ee, 30, 70);
    const camera = new THREE.PerspectiveCamera(50, width() / height(), 0.1, 200);

    // render เฉพาะเมื่อมีการเปลี่ยนแปลง (ไม่วนตลอดเวลา — ประหยัดแบตมือถือ)
    let raf = 0;
    let disposed = false;
    const invalidate = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(frame);
    };

    type Orbit = { target: THREE.Vector3; radius: number; theta: number; phi: number };
    const orbit: Orbit = { target: new THREE.Vector3(), radius: 20, theta: 0, phi: 1 };
    let tween: null | { from: Orbit; to: Orbit; start: number } = null;

    let fadeables: Fadeable[] = [];
    let backdrop: PhotoBackdrop | null = null;
    const side = new THREE.Vector3();
    /** ผนัง/หลังคาที่บังระหว่างกล้องกับจุดที่มองจะจางลง (แบบบ้านตุ๊กตา) */
    function updateFades() {
      const cam = camera.position;
      const target = orbit.target;
      for (const f of fadeables) {
        let hide = false;
        let faded = 0.1;
        if (f.kind === "wall") {
          const a = side.copy(cam).sub(f.point).dot(f.normal);
          const b = side.copy(target).sub(f.point).dot(f.normal);
          hide = a * b < 0 && Math.abs(a) > 0.1;
        } else {
          faded = f.minOpacity ?? 0.22;
          // กล้องอยู่เหนือชายคาและแนวสายตาผ่านเหนือหลังคา หรือเส้นสายตาทะลุหลังคา
          const { rect } = f;
          const inside = (x: number, z: number) => x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
          if (cam.y > f.y) {
            for (let i = 0; i <= 12 && !hide; i++) {
              const t = i / 12;
              hide = inside(cam.x + (target.x - cam.x) * t, cam.z + (target.z - cam.z) * t);
            }
          } else if (Math.abs(target.y - cam.y) > 1e-3) {
            const t = (f.y - cam.y) / (target.y - cam.y);
            if (t > 0 && t < 1) hide = inside(cam.x + (target.x - cam.x) * t, cam.z + (target.z - cam.z) * t);
          }
        }
        for (const m of f.materials) {
          const base = (m.userData["baseOpacity"] as number | undefined) ?? 1;
          const opacity = hide ? Math.min(base, faded) : base;
          if (m.opacity === opacity) continue;
          const transparent = hide || base < 1;
          if (m.transparent !== transparent) {
            m.transparent = transparent;
            m.needsUpdate = true;
          }
          m.opacity = opacity;
          m.depthWrite = !hide;
        }
      }
    }

    function placeCamera() {
      const { target, radius, theta, phi } = orbit;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(target);
      backdrop?.update(camera);
      updateFades();
    }
    function applyCamera() {
      placeCamera();
      invalidate();
    }

    function orbitFromView(v: CameraView): Orbit {
      const target = new THREE.Vector3(v.target.x, v.target.y, v.target.z);
      const offset = new THREE.Vector3(v.position.x, v.position.y, v.position.z).sub(target);
      const length = offset.length();
      const fit = Math.min(1.3, Math.max(1, DESIGN_ASPECT / camera.aspect));
      return {
        target,
        radius: Math.min(MAX_RADIUS, length * fit),
        theta: Math.atan2(offset.x, offset.z),
        phi: Math.acos(Math.max(-1, Math.min(1, offset.y / length))),
      };
    }

    function setView(v: CameraView, instant = false) {
      const to = orbitFromView(v);
      if (instant || reducedMotion) {
        tween = null;
        Object.assign(orbit, to);
        applyCamera();
        return;
      }
      // หมุนไปทางที่สั้นกว่า
      let theta = orbit.theta;
      while (to.theta - theta > Math.PI) theta += Math.PI * 2;
      while (to.theta - theta < -Math.PI) theta -= Math.PI * 2;
      tween = { from: { ...orbit, target: orbit.target.clone(), theta }, to, start: performance.now() };
      invalidate();
    }

    function zoomBy(factor: number) {
      tween = null;
      orbit.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, orbit.radius * factor));
      applyCamera();
    }

    // ---------- แสง (แดดบ่ายอ่อน ๆ + ไฟในร้าน) ----------
    scene.add(new THREE.HemisphereLight(0xfdf6ea, 0x7d6b58, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.set(9, 18, 12);
    sun.target.position.set(0.5, 0, -1);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    // ไฟในร้านแต่ละโซน (โทนอุ่น)
    for (const [lx, ly, lz] of [[4.6, 2.8, -3.6], [-4.4, 2.8, -2.4], [-4.35, 2.6, 3.6], [4.7, 2.5, 1.9]] as const) {
      const light = new THREE.PointLight(0xfff1dc, 4.5, 9, 1.6);
      light.position.set(lx, ly, lz);
      scene.add(light);
    }

    const built = buildScenery({ scene, track, onTextureLoad: invalidate });
    fadeables = built.fadeables;
    backdrop = built.backdrop;
    backdrop.update(camera);

    // ---------- โต๊ะ (สร้างใหม่เมื่อโครงสร้างชุดโต๊ะเปลี่ยน) ----------
    const tableRoot = new THREE.Group();
    scene.add(tableRoot);
    let visuals: TableVisual[] = [];
    let pickMeshes: THREE.Object3D[] = [];
    let tableDisposables: { dispose: () => void }[] = [];

    function clearTables() {
      for (const d of tableDisposables) d.dispose();
      tableDisposables = [];
      tableRoot.clear();
      visuals = [];
      pickMeshes = [];
    }

    function setTables(list: PlacedTable[]) {
      clearTables();
      const own: Track = (obj) => {
        tableDisposables.push(obj);
        return obj;
      };
      const shared = { stoolGeo: new Map<string, THREE.BufferGeometry>(), mat: new Map<string, THREE.Material>() };
      const circle = own(new THREE.CircleGeometry(1, 40));
      const ring = own(new THREE.RingGeometry(0.94, 1.06, 48));
      for (const table of list) {
        const { position, rotation, kind, style } = table.slot;
        const parts = buildFurniture(style, kind, table.capacity, own, shared);
        const group = parts.group;
        group.position.set(position.x, position.y, position.z);
        group.rotation.y = rotation;
        tableRoot.add(group);

        // วงสีบนพื้นบอกสถานะ — ตัวโต๊ะคงสีจริงตามรูป
        const haloMaterial = own(
          new THREE.MeshBasicMaterial({ color: HALO.available.color, transparent: true, opacity: 0.4, depthWrite: false }),
        );
        const halo = new THREE.Mesh(circle, haloMaterial);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.012;
        halo.scale.set(parts.footprint.x, parts.footprint.z, 1);
        group.add(halo);

        const makeRing = (color: number, grow: number) => {
          const r = new THREE.Mesh(ring, own(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
          r.rotation.x = -Math.PI / 2;
          r.position.y = 0.02;
          r.scale.set(parts.footprint.x + grow, parts.footprint.z + grow, 1);
          r.visible = false;
          group.add(r);
          return r;
        };
        const selectRing = makeRing(0xdc2626, 0.05);
        const recommendRing = makeRing(0xd97706, 0.2);

        const anchor = new THREE.Object3D();
        anchor.position.set(0, kind === "bar" ? 1.7 : 1.4, 0);
        group.add(anchor);

        for (const obj of [...parts.pickables, halo]) {
          obj.userData["tableId"] = table.id;
          pickMeshes.push(obj);
        }
        visuals.push({ table, topMaterial: parts.topMaterial, haloMaterial, selectRing, recommendRing, anchor });
      }
      invalidate();
    }

    function applyStates({ tables: list, selected, recommended, focus }: SceneState) {
      const latest = new Map(list.map((t) => [t.id, t]));
      for (const v of visuals) {
        v.table = latest.get(v.table.id) ?? v.table;
        const { status, zone, id } = v.table;
        const isSelected = id === selected;
        const dimmed = zone !== focus;
        const halo = isSelected ? HALO.selected : HALO[status];
        v.haloMaterial.color.setHex(halo.color);
        v.haloMaterial.opacity = dimmed ? 0 : halo.opacity;
        v.topMaterial.emissive.setHex(isSelected ? 0x991b1b : 0x000000);
        v.topMaterial.emissiveIntensity = isSelected ? 0.55 : 0;
        v.selectRing.visible = isSelected;
        v.recommendRing.visible = id === recommended && status === "available" && !dimmed && !isSelected;
      }
      invalidate();
    }

    // ---------- ป้ายลอย (HTML) ติดตามตำแหน่งโต๊ะ/โซน ----------
    const pins = pinsRef.current;
    const markAnchors = new Map(landmarks.map((l) => [l.id, new THREE.Vector3(l.anchor.x, l.anchor.y, l.anchor.z)]));
    const projected = new THREE.Vector3();
    function positionPins() {
      const w = width();
      const h = height();
      for (const [key, el] of pins) {
        if (key.startsWith("mark:")) {
          const anchor = markAnchors.get(key.slice(5) as LandmarkKind);
          if (!anchor) continue;
          projected.copy(anchor);
        } else {
          const v = visuals.find((x) => x.table.id === key.slice(6));
          if (!v) continue;
          v.anchor.getWorldPosition(projected);
        }
        projected.project(camera);
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        const hidden = projected.z > 1 || x < -40 || x > w + 40 || y < -20 || y > h + 60;
        el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.visibility = hidden ? "hidden" : "visible";
        // ป้ายโต๊ะที่ใกล้กล้องกว่าต้องทับป้ายที่อยู่ไกล (ลำดับใน DOM ไม่เกี่ยวกับระยะ) · โต๊ะที่เลือกอยู่บนสุดเสมอ
        const depth = Math.round((1 - projected.z) * 1000);
        el.style.zIndex = String(el.classList.contains("is-selected") ? 5000 + depth : depth);
      }
    }

    function frame(now: number) {
      raf = 0;
      if (disposed) return;
      if (tween) {
        const t = Math.min(1, (now - tween.start) / 750);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const { from, to } = tween;
        orbit.target.lerpVectors(from.target, to.target, e);
        orbit.radius = from.radius + (to.radius - from.radius) * e;
        orbit.theta = from.theta + (to.theta - from.theta) * e;
        orbit.phi = from.phi + (to.phi - from.phi) * e;
        if (t >= 1) tween = null;
        placeCamera();
      }
      renderer.render(scene, camera);
      positionPins();
      if (tween) invalidate();
    }

    // ---------- การควบคุม: ลากหมุน, สองนิ้วซูม, Ctrl+ล้อเมาส์ซูม, แตะโต๊ะเพื่อเลือก ----------
    const pointers = new Map<number, { x: number; y: number }>();
    let downX = 0;
    let downY = 0;
    let pinchDist = 0;
    let gestureWasMulti = false;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function pickTable(clientX: number, clientY: number): PlacedTable | null {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObjects(pickMeshes, false)) {
        const id = hit.object.userData["tableId"] as string | undefined;
        const v = id ? visuals.find((x) => x.table.id === id) : undefined;
        if (v && v.table.zone === stateRef.current.focus) return v.table;
      }
      return null;
    }

    function onPointerDown(e: PointerEvent) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        downX = e.clientX;
        downY = e.clientY;
        gestureWasMulti = false;
      } else if (pointers.size === 2) {
        gestureWasMulti = true;
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    }
    function onPointerMove(e: PointerEvent) {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === "mouse") {
          canvas.style.cursor = pickTable(e.clientX, e.clientY)?.status === "available" ? "pointer" : "grab";
        }
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5 && !canvas.hasPointerCapture(e.pointerId)) {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            // บางเบราว์เซอร์ไม่รองรับ — ลากต่อได้ภายใน canvas
          }
        }
        tween = null;
        orbit.theta -= dx * 0.006;
        if (e.pointerType === "mouse") orbit.phi = Math.max(0.2, Math.min(1.45, orbit.phi - dy * 0.004));
        applyCamera();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d);
        pinchDist = d;
      }
    }
    function onPointerUp(e: PointerEvent) {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size < 2) pinchDist = 0;
      if (e.type === "pointercancel" || gestureWasMulti || pointers.size > 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const hit = pickTable(e.clientX, e.clientY);
      if (hit && hit.status === "available") onTableClickRef.current(hit.id);
    }
    let hintTimer = 0;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) {
        // ไม่แย่งการเลื่อนหน้า — บอกวิธีซูมแทน
        setWheelHint(true);
        window.clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => setWheelHint(false), 1600);
        return;
      }
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    }
    // context หลุดชั่วคราว (มือถือ/แท็บพื้นหลัง) — รอให้เบราว์เซอร์คืนก่อน ค่อยยอมแพ้ถ้าไม่คืนใน 2.5 วินาที
    let lostTimer = 0;
    function onContextLost(e: Event) {
      e.preventDefault();
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => setFailed(true), 2500);
    }
    function onContextRestored() {
      window.clearTimeout(lostTimer);
      invalidate();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    function handleResize() {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
      invalidate();
    }
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(mount);
    window.addEventListener("resize", handleResize);

    apiRef.current = { setTables, applyStates, setView: (v) => setView(v), zoomBy, invalidate };
    setTables(stateRef.current.tables);
    applyStates(stateRef.current);
    setView(viewRef.current, true);

    return () => {
      disposed = true;
      apiRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(hintTimer);
      window.clearTimeout(lostTimer);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      clearTables();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // คืน WebGL context ทันที (ไม่รอ GC) — ส่วนโซนถูกถอด/ใส่ใหม่ตามการเลื่อนหน้า
      renderer.forceContextLoss();
      if (canvas.parentElement === mount) mount.removeChild(canvas);
    };
  }, []);

  // โครงสร้างชุดโต๊ะเปลี่ยน (ได้ผังใหม่จากเซิร์ฟเวอร์) → สร้างโต๊ะใหม่
  useEffect(() => {
    apiRef.current?.setTables(stateRef.current.tables);
    apiRef.current?.applyStates(stateRef.current);
  }, [layoutKey]);

  // สถานะ/การเลือก/โซนที่ดูเปลี่ยน → อัปเดตสีอย่างเดียว
  useEffect(() => {
    apiRef.current?.applyStates(stateRef.current);
  }, [statusKey, selectedTableId, recommendedTableId, focusZoneId]);

  useEffect(() => {
    apiRef.current?.setView(viewRef.current);
  }, [viewKey]);

  if (failed) {
    return (
      <div className="venue-scene-3d venue-scene-3d--fallback" role="note">
        <p>อุปกรณ์นี้แสดงโมเดลสามมิติไม่ได้ เลือกโต๊ะจากรายการด้านล่างได้เลย</p>
      </div>
    );
  }

  const pinRef = (key: string) => (el: HTMLElement | null) => {
    if (el) pinsRef.current.set(key, el);
    else pinsRef.current.delete(key);
    apiRef.current?.invalidate();
  };
  const focusedZone = getZone(focusZoneId);
  const zoneTables = tables.filter((t) => t.zone === focusZoneId);
  const zoneMarks = landmarks.filter((l) => l.zone === focusZoneId);

  return (
    <div className="venue-scene-3d">
      <div
        ref={mountRef}
        className="venue-scene-3d__mount"
        role="img"
        aria-label={`แบบจำลองสามมิติของ${focusedZone?.label ?? "ร้าน"} แสดงตำแหน่งโต๊ะ ${zoneTables.length} ตัว`}
      />
      {/* ป้ายบนโมเดลเป็นทางลัดสำหรับเมาส์/นิ้ว — ผู้ใช้คีย์บอร์ดและโปรแกรมอ่านจอใช้รายการโต๊ะของโซน */}
      <div className="venue-scene-3d__pins" aria-hidden="true">
        {zoneMarks.map((l) => (
          <span key={`mark:${l.id}`} ref={pinRef(`mark:${l.id}`)} className={`venue-pin venue-pin--mark is-${l.id}`}>
            {l.label}
          </span>
        ))}
        {zoneTables.map((t) => {
          const isSelected = t.id === selectedTableId;
          const isRecommended = t.id === recommendedTableId && t.status === "available";
          return (
            <button
              key={`table:${t.id}`}
              ref={pinRef(`table:${t.id}`)}
              type="button"
              tabIndex={-1}
              disabled={t.status !== "available"}
              className={`venue-pin venue-pin--table is-${t.status}${isSelected ? " is-selected" : ""}`}
              onClick={() => onTableClick(t.id)}
            >
              {isRecommended && !isSelected ? <em>แนะนำ</em> : null}
              <strong>
                {isSelected ? "✓ " : ""}
                {t.name}
              </strong>
              <span>
                {t.status === "booked"
                  ? "จองแล้ว"
                  : t.status === "too_small"
                    ? `${t.capacity} ที่ ไม่พอ`
                    : `${t.capacity} ที่นั่ง`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="venue-scene-3d__controls">
        <button type="button" aria-label="ซูมเข้า" onClick={() => apiRef.current?.zoomBy(0.8)}>
          +
        </button>
        <button type="button" aria-label="ซูมออก" onClick={() => apiRef.current?.zoomBy(1.25)}>
          −
        </button>
      </div>
      <p className={`venue-scene-3d__hint${wheelHint ? " is-strong" : ""}`} aria-hidden="true">
        {wheelHint ? "กด Ctrl ค้างแล้วเลื่อนล้อเมาส์เพื่อซูม" : "ลากเพื่อหมุน · แตะป้ายเพื่อเลือก"}
      </p>
    </div>
  );
}
