import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { TableZone } from "../lib/api";
import {
  getZoneFocus,
  teaCounterLandmark,
  venueZones,
  type PlacedTable,
  type ZoneSummary,
} from "./venueModel";

export type VenueScene3DProps = {
  tables: PlacedTable[];
  zoneSummaries: ZoneSummary[];
  focusZoneId: TableZone | null;
  selectedTableId: string | null;
  recommendedTableId: string | null;
  onTableClick: (tableId: string) => void;
  onZoneClick: (zoneId: TableZone) => void;
};

type TableVisual = {
  table: PlacedTable;
  topMat: THREE.MeshStandardMaterial;
  seatMat: THREE.MeshStandardMaterial;
  selectRing: THREE.Mesh;
  recommendRing: THREE.Mesh;
  anchor: THREE.Object3D;
};

type SceneState = {
  tables: PlacedTable[];
  selected: string | null;
  recommended: string | null;
  focus: TableZone | null;
};

type SceneApi = {
  setTables: (tables: PlacedTable[]) => void;
  applyStates: (state: SceneState) => void;
  setFocus: (zoneId: TableZone | null) => void;
  zoomBy: (factor: number) => void;
  invalidate: () => void;
};

const MIN_RADIUS = 5;
const MAX_RADIUS = 45;
// ระยะกล้องของแต่ละโซนตั้งไว้สำหรับ canvas กว้าง ~1.45 เท่าของความสูง จอแคบ (มือถือ) ต้องถอยกล้องออก
const DESIGN_ASPECT = 1.45;
const OVERVIEW_PHI = 0.95;
// จอแคบมองจากด้านบนมากขึ้น ป้ายโซนจะได้ไม่ซ้อนกัน
const OVERVIEW_PHI_NARROW = 0.62;
const ZONE_PHI = 0.72;

const COLOR_AVAILABLE = 0x2f9e5b;
const COLOR_BOOKED = 0xa8a29e;
const COLOR_TOO_SMALL = 0xd6b98c;
const COLOR_SELECTED = 0xdc2626;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tableLayoutKey(tables: PlacedTable[]): string {
  return tables
    .map((t) => `${t.id}:${t.capacity}:${t.slot.position.x},${t.slot.position.z}:${t.slot.kind}`)
    .join("|");
}

export function VenueScene3D({
  tables,
  zoneSummaries,
  focusZoneId,
  selectedTableId,
  recommendedTableId,
  onTableClick,
  onZoneClick,
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
  const layoutKey = tableLayoutKey(tables);
  const statusKey = tables.map((t) => t.status).join(",");

  // สร้างฉากคงที่ครั้งเดียว (ร้าน โซน รูปจริง แสง กล้อง การควบคุม)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      if (!renderer.getContext()) throw new Error("no webgl");
    } catch {
      setFailed(true);
      return;
    }

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(obj: T): T => {
      disposables.push(obj);
      return obj;
    };
    const width = () => Math.max(1, mount.clientWidth || 300);
    const height = () => Math.max(1, mount.clientHeight || 320);
    const reducedMotion = prefersReducedMotion();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width(), height());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // ปัดขึ้นลงยังเลื่อนหน้าเว็บได้ตามปกติ ลากแนวนอนเพื่อหมุนโมเดล
    canvas.style.touchAction = "pan-y";
    mount.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfbf3e6);
    const camera = new THREE.PerspectiveCamera(46, width() / height(), 0.1, 200);

    // render เฉพาะเมื่อมีการเปลี่ยนแปลง (ไม่วนตลอดเวลา — ประหยัดแบตมือถือ)
    let raf = 0;
    let disposed = false;
    const invalidate = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(frame);
    };

    const orbit = {
      target: new THREE.Vector3(),
      radius: 24,
      theta: 0.25,
      phi: OVERVIEW_PHI,
      tween: null as null | {
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
        fromRadius: number;
        toRadius: number;
        fromPhi: number;
        toPhi: number;
        fromTheta: number;
        start: number;
      },
    };

    function placeCamera() {
      const { target, radius, theta, phi } = orbit;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(target);
    }
    function applyCamera() {
      placeCamera();
      invalidate();
    }

    function setFocus(zoneId: TableZone | null, instant = false) {
      const focus = getZoneFocus(zoneId);
      // ภาพรวมต้องเห็นทุกโซนจึงถอยได้มาก ส่วนโซนเดียวแคบพอ ถอยนิดเดียวให้ป้ายโต๊ะไม่เบียดกัน
      const fit = Math.min(zoneId ? 1.15 : 1.8, Math.max(1, DESIGN_ASPECT / camera.aspect));
      const toRadius = Math.min(MAX_RADIUS, focus.distance * fit);
      const toTarget = new THREE.Vector3(focus.center.x, focus.center.y, focus.center.z);
      const toPhi = zoneId ? ZONE_PHI : camera.aspect < 1.2 ? OVERVIEW_PHI_NARROW : OVERVIEW_PHI;
      if (instant || reducedMotion) {
        orbit.target.copy(toTarget);
        orbit.radius = toRadius;
        orbit.phi = toPhi;
        orbit.theta = 0.25;
        orbit.tween = null;
        applyCamera();
        return;
      }
      orbit.tween = {
        fromTarget: orbit.target.clone(),
        toTarget,
        fromRadius: orbit.radius,
        toRadius,
        fromPhi: orbit.phi,
        toPhi,
        fromTheta: orbit.theta,
        start: performance.now(),
      };
      invalidate();
    }

    function zoomBy(factor: number) {
      orbit.tween = null;
      orbit.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, orbit.radius * factor));
      applyCamera();
    }

    // ---------- แสง ----------
    scene.add(new THREE.HemisphereLight(0xfff7ec, 0x8a6a4f, 1.0));
    const sun = new THREE.DirectionalLight(0xffe8c4, 1.5);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);

    // ---------- วัสดุ ----------
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      track(new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
    const woodMat = mat(0x9a6535, { roughness: 0.8 });
    const darkWoodMat = mat(0x4b2c1a, { roughness: 0.85 });
    const creamMat = mat(0xf5ead8);
    const backWallMat = mat(0x8a5a33);
    const tileMat = mat(0xeee9df);
    const brownFloorMat = mat(0x8a5e38);
    const grassMat = mat(0x8fb56a, { roughness: 1 });
    const groundMat = mat(0xe3d5bd, { roughness: 1 });
    const concreteMat = mat(0xcfc9be, { roughness: 1 });
    const awningMat = mat(0x9aa0a6, { roughness: 0.6, metalness: 0.35, transparent: true, opacity: 0.3, depthWrite: false });
    const poleMat = mat(0x3d332b, { roughness: 0.7, metalness: 0.2 });
    const counterMat = mat(0x6f4525, { roughness: 0.8 });
    const stallMat = mat(0xcbbfae);
    const roofMat = mat(0x7a5a2e, { roughness: 1 });
    const legMat = mat(0x2b211b, { roughness: 0.7 });

    function addMesh(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0) {
      const mesh = new THREE.Mesh(track(geo), material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }
    const addBox = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) =>
      addMesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry);
    function addFloor(w: number, d: number, m: THREE.Material, x: number, z: number, y = 0.02) {
      const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d)), m);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(x, y, z);
      floor.receiveShadow = true;
      scene.add(floor);
    }

    addFloor(48, 42, groundMat, 0, 0, 0);

    // ห้องอาหาร: ตัดหลังคาและผนังข้างให้เตี้ย (แบบบ้านตุ๊กตา) เพื่อให้มองเห็นโต๊ะด้านในเสมอ
    addFloor(9, 7.5, tileMat, 0, 0);
    addBox(9, 2.6, 0.25, backWallMat, 0, 1.3, -3.7);
    addBox(0.25, 1.1, 7.5, creamMat, -4.5, 0.55, 0);
    addBox(0.25, 1.1, 7.5, creamMat, 4.5, 0.55, 0);
    addBox(9, 0.5, 0.25, creamMat, 0, 0.25, 3.7);

    // หน้าร้าน: กันสาดเมทัลชีทโปร่งแสงบนเสา + เคาน์เตอร์ชาใต้
    addFloor(10, 5, concreteMat, 0, 8.2, 0.015);
    const awning = new THREE.Mesh(track(new THREE.BoxGeometry(10, 0.12, 5)), awningMat);
    awning.position.set(0, 3.1, 8.2);
    awning.rotation.x = 0.12;
    scene.add(awning);
    for (const [px, pz] of [[-4.6, 6.2], [4.6, 6.2], [-4.6, 10.2], [4.6, 10.2]] as const) {
      addMesh(new THREE.CylinderGeometry(0.07, 0.07, 3.1, 8), poleMat, px, 1.55, pz);
    }
    addBox(2.2, 1.05, 0.9, counterMat, teaCounterLandmark.position.x, 0.53, teaCounterLandmark.position.z, 0.15);

    // บาร์หน้าครัว: พื้นกระเบื้องน้ำตาล ผนังหน้าต่าง ซุ้มครัว
    addFloor(6, 11, brownFloorMat, 9, -1);
    addBox(0.3, 2.4, 11, creamMat, 12, 1.2, -1);
    addBox(2.4, 1.9, 1.6, stallMat, 9.4, 0.95, -5.6);
    addBox(2.6, 0.15, 1.8, darkWoodMat, 9.4, 1.98, -5.6);

    // ศาลามุงจากบนสนามหญ้า
    addFloor(8, 7, grassMat, -9, -1.7, 0.015);
    addBox(5.6, 0.25, 4.0, woodMat, -9, 0.13, -1.7);
    for (const [px, pz] of [[-11.6, -3.5], [-6.4, -3.5], [-11.6, 0.1], [-6.4, 0.1]] as const) {
      addMesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 8), darkWoodMat, px, 1.3, pz);
    }
    addMesh(new THREE.ConeGeometry(4.2, 1.7, 4), roofMat, -9, 3.3, -1.7, Math.PI / 4);

    // กรอบรูปจริงประจำโซน
    const textureLoader = new THREE.TextureLoader();
    function addPhotoBoard(photo: string, x: number, y: number, z: number, ry: number, w: number, h: number) {
      addBox(w + 0.12, h + 0.12, 0.06, darkWoodMat, x, y, z, ry);
      const tex = track(textureLoader.load(photo, invalidate));
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), track(new THREE.MeshBasicMaterial({ map: tex })));
      board.position.set(x, y, z);
      board.rotation.y = ry;
      board.translateZ(0.045);
      scene.add(board);
    }
    addPhotoBoard("/venue/reservations/storefront-seating.jpg", 3.4, 2.1, 6.0, 0, 1.8, 1.1);
    addPhotoBoard("/venue/reservations/dining-room.jpg", 0, 1.9, -3.55, 0, 2.2, 1.2);
    addPhotoBoard("/venue/latest/real-counter-seating.jpg", 11.8, 1.7, -2.4, -Math.PI / 2, 2.0, 1.2);
    addPhotoBoard("/venue/latest/real-menu-counter.jpg", 9.4, 1.4, -4.76, 0, 1.4, 0.8);
    addPhotoBoard("/venue/latest/real-outdoor-seating.jpg", -9, 1.5, -3.85, 0, 1.5, 0.9);
    addPhotoBoard(teaCounterLandmark.photo, teaCounterLandmark.position.x, 2.0, teaCounterLandmark.position.z + 0.4, 0, 1.4, 0.9);

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
      const own = <T extends { dispose: () => void }>(obj: T): T => {
        tableDisposables.push(obj);
        return obj;
      };
      const stoolGeo = own(new THREE.CylinderGeometry(0.18, 0.18, 0.45, 12));
      const legGeo = own(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8));
      for (const table of list) {
        const { kind, position, rotation } = table.slot;
        const group = new THREE.Group();
        group.position.set(position.x, 0, position.z);
        group.rotation.y = rotation;
        tableRoot.add(group);

        const isLong = kind === "long";
        const isBar = kind === "bar";
        const topW = isLong || isBar ? 2.4 : 1.15;
        const topD = isLong ? 1.0 : isBar ? 0.7 : 1.15;
        const topMat = own(new THREE.MeshStandardMaterial({ color: COLOR_AVAILABLE, roughness: 0.6, transparent: true }));
        const seatMat = own(new THREE.MeshStandardMaterial({ color: 0x8a613c, roughness: 0.85, transparent: true }));

        const top = new THREE.Mesh(own(new THREE.BoxGeometry(topW, 0.1, topD)), topMat);
        top.position.y = 0.75;
        top.castShadow = true;
        top.receiveShadow = true;
        top.userData["tableId"] = table.id;
        group.add(top);
        pickMeshes.push(top);

        const legs: [number, number][] = isLong || isBar
          ? [[-topW / 2 + 0.12, 0], [topW / 2 - 0.12, 0]]
          : [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]];
        for (const [lx, lz] of legs) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(lx, 0.36, lz);
          group.add(leg);
        }

        const seats = Math.min(table.capacity, isBar ? 6 : isLong ? 10 : 8);
        for (let i = 0; i < seats; i++) {
          let sx: number;
          let sz: number;
          if (isBar) {
            sx = -topW / 2 + 0.3 + i * ((topW - 0.6) / Math.max(1, seats - 1));
            sz = topD / 2 + 0.42;
          } else if (isLong) {
            const perSide = Math.ceil(seats / 2);
            const side = i < perSide ? 1 : -1;
            sx = -topW / 2 + 0.35 + (i % perSide) * ((topW - 0.7) / Math.max(1, perSide - 1));
            sz = side * (topD / 2 + 0.42);
          } else {
            const angle = (i / seats) * Math.PI * 2 + Math.PI / 4;
            sx = Math.cos(angle) * 0.95;
            sz = Math.sin(angle) * 0.95;
          }
          const stool = new THREE.Mesh(stoolGeo, seatMat);
          stool.position.set(sx, 0.225, sz);
          stool.castShadow = true;
          stool.userData["tableId"] = table.id;
          group.add(stool);
          pickMeshes.push(stool);
        }

        const ringSize = isLong || isBar ? 1.6 : 1.2;
        const makeRing = (color: number, inner: number) => {
          const ring = new THREE.Mesh(
            own(new THREE.RingGeometry(ringSize * inner, ringSize * inner + 0.16, 48)),
            own(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.04;
          if (isLong || isBar) ring.scale.set(1.25, 0.8, 1);
          ring.visible = false;
          group.add(ring);
          return ring;
        };
        const selectRing = makeRing(COLOR_SELECTED, 1);
        const recommendRing = makeRing(0xd97706, 1.18);

        const anchor = new THREE.Object3D();
        anchor.position.set(0, 1.35, 0);
        group.add(anchor);
        visuals.push({ table, topMat, seatMat, selectRing, recommendRing, anchor });
      }
      invalidate();
    }

    function applyStates({ tables: list, selected, recommended, focus }: SceneState) {
      const latest = new Map(list.map((t) => [t.id, t]));
      for (const v of visuals) {
        v.table = latest.get(v.table.id) ?? v.table;
        const { status, zone, id } = v.table;
        const isSelected = id === selected;
        const dimmed = focus !== null && zone !== focus;
        const color = isSelected
          ? COLOR_SELECTED
          : status === "available"
            ? COLOR_AVAILABLE
            : status === "booked"
              ? COLOR_BOOKED
              : COLOR_TOO_SMALL;
        v.topMat.color.setHex(color);
        v.topMat.emissive.setHex(isSelected ? 0x7f1d1d : 0x000000);
        v.topMat.opacity = dimmed ? 0.25 : 1;
        v.seatMat.color.setHex(status === "booked" ? 0x8f8a85 : 0x8a613c);
        v.seatMat.opacity = dimmed ? 0.2 : 1;
        v.selectRing.visible = isSelected;
        v.recommendRing.visible = id === recommended && status === "available" && !dimmed && !isSelected;
      }
      invalidate();
    }

    // ---------- ป้ายลอย (HTML) ติดตามตำแหน่งโต๊ะ/โซน ----------
    const pins = pinsRef.current;
    const zoneAnchors = new Map(
      venueZones.map((z) => [z.id, new THREE.Vector3(z.focusCenter.x, 2.6, z.focusCenter.z)] as const),
    );
    const projected = new THREE.Vector3();
    function positionPins() {
      const w = width();
      const h = height();
      for (const [key, el] of pins) {
        if (key.startsWith("zone:")) {
          const anchor = zoneAnchors.get(key.slice(5) as TableZone);
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
      }
    }

    function frame(now: number) {
      raf = 0;
      if (disposed) return;
      const tween = orbit.tween;
      if (tween) {
        const t = Math.min(1, (now - tween.start) / 650);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        orbit.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        orbit.radius = tween.fromRadius + (tween.toRadius - tween.fromRadius) * eased;
        orbit.phi = tween.fromPhi + (tween.toPhi - tween.fromPhi) * eased;
        orbit.theta = tween.fromTheta + (0.25 - tween.fromTheta) * eased;
        if (t >= 1) orbit.tween = null;
        placeCamera();
      }
      renderer.render(scene, camera);
      positionPins();
      if (orbit.tween) invalidate();
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
        if (v) return v.table;
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
        orbit.tween = null;
        orbit.theta -= dx * 0.006;
        if (e.pointerType === "mouse") orbit.phi = Math.max(0.3, Math.min(1.3, orbit.phi - dy * 0.004));
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
    function onContextLost(e: Event) {
      e.preventDefault();
      setFailed(true);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", onContextLost);

    function handleResize() {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
      invalidate();
    }
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(mount);
    window.addEventListener("resize", handleResize);

    apiRef.current = { setTables, applyStates, setFocus: (zoneId) => setFocus(zoneId), zoomBy, invalidate };
    setTables(stateRef.current.tables);
    applyStates(stateRef.current);
    setFocus(stateRef.current.focus, true);

    return () => {
      disposed = true;
      apiRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(hintTimer);
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
      if (canvas.parentElement === mount) mount.removeChild(canvas);
    };
  }, []);

  // โครงสร้างชุดโต๊ะเปลี่ยน (ได้ผังใหม่จากเซิร์ฟเวอร์) → สร้างโต๊ะใหม่
  useEffect(() => {
    apiRef.current?.setTables(stateRef.current.tables);
    apiRef.current?.applyStates(stateRef.current);
  }, [layoutKey]);

  // สถานะ/การเลือก/โซนที่ดูเปลี่ยน → อัปเดตสีวัสดุอย่างเดียว
  useEffect(() => {
    apiRef.current?.applyStates(stateRef.current);
  }, [statusKey, selectedTableId, recommendedTableId, focusZoneId]);

  useEffect(() => {
    apiRef.current?.setFocus(focusZoneId);
  }, [focusZoneId]);

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
  const focusedZone = venueZones.find((z) => z.id === focusZoneId);
  const zoneTables = focusZoneId ? tables.filter((t) => t.zone === focusZoneId) : [];

  return (
    <div className="venue-scene-3d">
      <div
        ref={mountRef}
        className="venue-scene-3d__mount"
        role="img"
        aria-label={focusedZone ? `โมเดลสามมิติของร้าน กำลังดู${focusedZone.label}` : "โมเดลสามมิติของร้าน แสดงทุกโซน"}
      />
      {/* ป้ายบนโมเดลเป็นทางลัดสำหรับเมาส์/นิ้ว — ผู้ใช้คีย์บอร์ดและโปรแกรมอ่านจอใช้รายการโต๊ะด้านล่าง */}
      <div className="venue-scene-3d__pins" aria-hidden="true">
        {focusZoneId === null
          ? zoneSummaries.map((s) => {
              const zone = s.zone ? venueZones.find((z) => z.id === s.zone) : undefined;
              if (!zone) return null;
              return (
                <button
                  key={`zone:${zone.id}`}
                  ref={pinRef(`zone:${zone.id}`)}
                  type="button"
                  tabIndex={-1}
                  className={`venue-pin venue-pin--zone${s.available === 0 ? " is-full" : ""}`}
                  onClick={() => onZoneClick(zone.id)}
                >
                  <strong>{zone.shortLabel}</strong>
                  <span>{s.total === 0 ? "ไม่มีโต๊ะ" : s.available === 0 ? "เต็ม" : `ว่าง ${s.available} โต๊ะ`}</span>
                </button>
              );
            })
          : zoneTables.map((t) => {
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
