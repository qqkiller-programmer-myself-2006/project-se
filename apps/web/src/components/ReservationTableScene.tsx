import { Component, Suspense, lazy, useEffect, type ReactNode, useMemo, useRef, useState } from "react";
import { TABLE_ZONE_LABELS, type TableAvailability, type TableZone } from "../lib/api";
import { VenueFloorPlan } from "./VenueFloorPlan";
import {
  getZoneOverview,
  getZoneView,
  landmarks,
  placeTables,
  summarizeZones,
  venueZones,
  type PlacedTable,
  type VenueZone,
  type ZoneSummary,
} from "./venueModel";
import { PhotoLightbox, ZonePhotoViewer } from "./ZonePhotos";
import "./ReservationTableScene.css";

// three.js มีขนาดใหญ่ — โหลดโมเดลสามมิติเฉพาะเมื่อหน้านี้แสดงผล
const VenueScene3D = lazy(() => import("./VenueScene3D").then((m) => ({ default: m.VenueScene3D })));

type ReservationTableSceneProps = {
  tables: TableAvailability[];
  recommendedTableId: string | null;
  partySize: number;
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  loading?: boolean;
};

const STATUS_TEXT: Record<TableAvailability["status"], string> = {
  available: "ว่าง",
  booked: "จองแล้ว",
  too_small: "ที่นั่งไม่พอ",
};

function zoneLabel(zone: TableZone | null): string {
  return zone ? TABLE_ZONE_LABELS[zone] : "โซนอื่น ๆ";
}

function zoneSectionId(zone: TableZone | "other"): string {
  return `zone-section-${zone}`;
}

function statusText(summary: ZoneSummary | undefined, loading: boolean): string {
  if (loading) return "กำลังตรวจ…";
  if (!summary || summary.total === 0) return "ไม่มีโต๊ะ";
  if (summary.available === 0) return "เต็ม";
  return `ว่าง ${summary.available}/${summary.total} โต๊ะ`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function scrollToZone(zone: TableZone | "other") {
  const el = document.getElementById(zoneSectionId(zone));
  if (!el) return;
  el.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  el.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
}

/**
 * โมเดลสามมิติมีอยู่เฉพาะตอนส่วนนั้นใกล้จอ — เลื่อนออกไปไกลแล้วถอดทิ้ง
 * (มือถือรับ WebGL context ได้จำกัด ถ้าค้างไว้ครบ 4 โซน context อาจหลุดจนโมเดลหายถาวร)
 */
function useNearViewport<T extends Element>(): [boolean, React.RefObject<T>] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (typeof IntersectionObserver === "undefined" || !el) return;
    // มี hysteresis: เมานต์เมื่อเข้าใกล้ (600px) แต่ถอดเมื่อไกลมากเท่านั้น (1800px)
    // กันโมเดลถูกถอด/ใส่ซ้ำตอนเลื่อนไปมาใกล้ขอบ หรือตอนเลย์เอาต์ขยับเพราะข้อมูลโต๊ะโหลดเสร็จ
    const last = (entries: IntersectionObserverEntry[]) => entries[entries.length - 1]!.isIntersecting;
    const enter = new IntersectionObserver((entries) => {
      if (last(entries)) setNear(true);
    }, { rootMargin: "600px 0px" });
    const leave = new IntersectionObserver((entries) => {
      if (!last(entries)) setNear(false);
    }, { rootMargin: "1800px 0px" });
    enter.observe(el);
    leave.observe(el);
    return () => {
      enter.disconnect();
      leave.disconnect();
    };
  }, []);
  return [near, ref];
}

/** โหลดชิ้นส่วนสามมิติไม่สำเร็จ (เครือข่ายหลุด) ต้องไม่ทำให้ทั้งหน้าจองล้ม — แสดงข้อความแทน */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="venue-scene-3d venue-scene-3d--fallback venue-scene-3d--placeholder" role="note">
          <p>อุปกรณ์นี้แสดงโมเดลสามมิติไม่ได้ เลือกโต๊ะจากรายการด้านล่างได้เลย</p>
        </div>
      );
    }
    return this.props.children;
  }
}

type TableListProps = {
  label: string;
  tables: TableAvailability[];
  partySize: number;
  selectedTableId: string | null;
  recommendedTableId: string | null;
  onToggle: (table: TableAvailability) => void;
};

function TableList({ label, tables, partySize, selectedTableId, recommendedTableId, onToggle }: TableListProps) {
  if (tables.length === 0) {
    return <p className="table-picker__empty">โซนนี้ยังไม่มีโต๊ะให้จอง ลองดูโซนอื่น</p>;
  }
  return (
    <ul className="table-picker__tables" aria-label={label}>
      {tables.map((table) => {
        const isSelected = table.id === selectedTableId;
        const isRecommended = table.id === recommendedTableId && table.status === "available";
        return (
          <li key={table.id}>
            <button
              type="button"
              className={`table-picker__table is-${table.status}${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              aria-disabled={table.status !== "available"}
              aria-label={`โต๊ะ ${table.name} ${zoneLabel(table.zone)} ${table.capacity} ที่นั่ง สถานะ${STATUS_TEXT[table.status]}${isRecommended ? " ระบบแนะนำ" : ""}${table.status === "too_small" ? ` ไม่พอสำหรับ ${partySize} คน` : ""}`}
              onClick={() => onToggle(table)}
            >
              <span className="table-picker__table-name">
                {isSelected ? <span aria-hidden="true">✓ </span> : null}
                {table.name}
              </span>
              <span className="table-picker__table-seats">{table.capacity} ที่นั่ง</span>
              <span className="table-picker__table-status">{isSelected ? "เลือกแล้ว" : STATUS_TEXT[table.status]}</span>
              {isRecommended ? <span className="table-picker__badge">แนะนำ</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type ZoneSectionProps = {
  zone: VenueZone;
  zoneTables: TableAvailability[];
  placed: PlacedTable[];
  summary: ZoneSummary | undefined;
  loading: boolean;
  partySize: number;
  selectedTableId: string | null;
  recommendedTableId: string | null;
  onToggle: (table: TableAvailability) => void;
  onSelectId: (tableId: string) => void;
};

/** หนึ่งโซน = หนึ่งส่วนของหน้าเว็บ: หัวข้อ · รูปจริงคู่โมเดลสามมิติ · โต๊ะในโซน */
function ZoneSection({
  zone,
  zoneTables,
  placed,
  summary,
  loading,
  partySize,
  selectedTableId,
  recommendedTableId,
  onToggle,
  onSelectId,
}: ZoneSectionProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewNonce, setViewNonce] = useState(0);
  // เริ่มที่มุมภาพรวมของโซน (เห็นโต๊ะครบ) · เลือกรูปแล้วค่อยหมุนไปมุมเดียวกับรูป
  const [matched, setMatched] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [near, modelRef] = useNearViewport<HTMLDivElement>();
  const titleId = `${zoneSectionId(zone.id)}-title`;
  const full = !loading && (summary?.available ?? 0) === 0;
  const hasSelection = zoneTables.some((t) => t.id === selectedTableId);
  const zoneMarks = landmarks.filter((l) => l.zone === zone.id);

  return (
    <section
      id={zoneSectionId(zone.id)}
      className={`zone-section is-${zone.id}${hasSelection ? " has-selection" : ""}`}
      aria-labelledby={titleId}
    >
      <header className="zone-section__head">
        <span className="zone-section__num" aria-hidden="true">
          {zone.number}
        </span>
        <div className="zone-section__heading">
          <h3 id={titleId} tabIndex={-1}>
            {zone.label}
          </h3>
          <p>{zone.caption}</p>
          <ul className="zone-section__tags" aria-label="จุดเด่นของโซน">
            {zone.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
            {zoneMarks.map((l) => (
              <li key={l.id} className={`is-mark is-${l.id}`}>
                {l.label}
              </li>
            ))}
          </ul>
        </div>
        <span className={`zone-section__status${full ? " is-full" : ""}`}>{statusText(summary, loading)}</span>
      </header>

      <div className="zone-section__media">
        <ZonePhotoViewer
          zoneLabel={zone.label}
          photos={zone.photos}
          index={photoIndex}
          onIndexChange={(i) => {
            setPhotoIndex(i);
            setMatched(true);
          }}
          onOpen={() => setLightboxOpen(true)}
          onMatchView={() => {
            setMatched(true);
            setViewNonce((n) => n + 1);
          }}
        />
        <div className="zone-section__model" ref={modelRef}>
          <div className="zone-photo__head">
            <span className="zone-photo__tag is-model">แบบจำลอง 3 มิติ</span>
            <button
              type="button"
              className="zone-photo__match"
              aria-pressed={!matched}
              onClick={() => {
                setMatched(false);
                setViewNonce((n) => n + 1);
              }}
            >
              ภาพรวมโซน
            </button>
          </div>
          {near ? (
            <SceneBoundary>
            <Suspense
              fallback={
                <div className="venue-scene-3d venue-scene-3d--fallback venue-scene-3d--placeholder" role="status">
                  <p>กำลังโหลดโมเดลสามมิติ…</p>
                </div>
              }
            >
              <VenueScene3D
                tables={placed}
                focusZoneId={zone.id}
                view={matched ? getZoneView(zone.id, photoIndex) : getZoneOverview(zone.id)}
                viewKey={`${matched ? photoIndex : "overview"}:${viewNonce}`}
                selectedTableId={selectedTableId}
                recommendedTableId={recommendedTableId}
                onTableClick={onSelectId}
              />
            </Suspense>
            </SceneBoundary>
          ) : (
            <div className="venue-scene-3d venue-scene-3d--fallback venue-scene-3d--placeholder">
              <p>เลื่อนมาที่ส่วนนี้เพื่อโหลดโมเดลสามมิติ</p>
            </div>
          )}
        </div>
      </div>

      <TableList
        label={`โต๊ะใน${zone.label}`}
        tables={zoneTables}
        partySize={partySize}
        selectedTableId={selectedTableId}
        recommendedTableId={recommendedTableId}
        onToggle={onToggle}
      />

      {lightboxOpen ? (
        <PhotoLightbox
          photos={zone.photos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * ขั้นเลือกโซนและโต๊ะ: ผังร้าน (ภาพรวม) → ส่วนละหนึ่งโซน (รูปจริง + โมเดลสามมิติ + โต๊ะ)
 * รายการโต๊ะในแต่ละโซนคือช่องทางหลักที่เข้าถึงได้ทุกอุปกรณ์
 */
export function ReservationTableScene({
  tables,
  recommendedTableId,
  partySize,
  selectedTableId,
  onSelectTable,
  loading = false,
}: ReservationTableSceneProps) {
  const { placed } = useMemo(() => placeTables(tables), [tables]);
  const summaries = useMemo(() => summarizeZones(tables), [tables]);
  const recommended = tables.find((t) => t.id === recommendedTableId && t.status === "available") ?? null;
  const availableCount = tables.filter((t) => t.status === "available").length;
  const others = tables.filter((t) => !t.zone);

  function toggleTable(table: TableAvailability) {
    if (table.status !== "available") return;
    onSelectTable(table.id === selectedTableId ? null : table.id);
  }

  function selectById(id: string) {
    const table = tables.find((t) => t.id === id);
    if (table) toggleTable(table);
  }

  function pickRecommended() {
    if (!recommended) return;
    onSelectTable(recommended.id);
    scrollToZone(recommended.zone ?? "other");
  }

  return (
    <div className="table-picker">
      <div className="table-picker__overview">
        <div className="table-picker__overview-head">
          <h3>ผังร้าน</h3>
          <p role="status">
            {loading ? "กำลังตรวจโต๊ะว่าง…" : `ว่าง ${availableCount} จาก ${tables.length} โต๊ะ`}
          </p>
        </div>
        <div className="floor-plan-wrap">
          <VenueFloorPlan
            tables={placed}
            summaries={summaries}
            selectedTableId={selectedTableId}
            recommendedTableId={recommendedTableId}
            onTableClick={selectById}
            onZoneClick={scrollToZone}
          />
        </div>
        <p className="floor-plan-tip">แตะโต๊ะสีเขียวบนผังเพื่อเลือก หรือแตะโซนเพื่อเลื่อนไปดูรูปจริงและโมเดลสามมิติ</p>
        <ul className="table-picker__legend" aria-label="คำอธิบายสีบนผัง">
          <li><i className="is-available" aria-hidden="true" />ว่าง เลือกได้</li>
          <li><i className="is-selected" aria-hidden="true" />โต๊ะที่คุณเลือก</li>
          <li><i className="is-recommended" aria-hidden="true" />ระบบแนะนำ</li>
          <li><i className="is-booked" aria-hidden="true" />จองแล้ว</li>
          <li><i className="is-too_small" aria-hidden="true" />ที่นั่งไม่พอ</li>
          <li><i className="is-mark-kitchen" aria-hidden="true" />ครัว</li>
          <li><i className="is-mark-drinks" aria-hidden="true" />บาร์น้ำ</li>
          <li><i className="is-mark-ice" aria-hidden="true" />น้ำแข็ง/แก้ว</li>
          <li><i className="is-mark-restroom" aria-hidden="true" />ห้องน้ำ</li>
        </ul>
        <nav className="zone-jump" aria-label="ไปที่โซน">
          {venueZones.map((zone) => {
            const s = summaries.find((x) => x.zone === zone.id);
            return (
              <button
                key={zone.id}
                type="button"
                className={`zone-jump__btn${!loading && (s?.available ?? 0) === 0 ? " is-full" : ""}`}
                aria-label={`ไปที่${zone.label} ${statusText(s, loading)}`}
                onClick={() => scrollToZone(zone.id)}
              >
                <span className="zone-jump__num" aria-hidden="true">
                  {zone.number}
                </span>
                <span className="zone-jump__text">
                  <strong>{zone.shortLabel}</strong>
                  <small>{statusText(s, loading)}</small>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {recommended && recommended.id !== selectedTableId ? (
        <button type="button" className="table-picker__recommend" onClick={pickRecommended}>
          <span aria-hidden="true">★</span> ให้ระบบเลือกให้: โต๊ะ {recommended.name} · {zoneLabel(recommended.zone)} ·{" "}
          {recommended.capacity} ที่นั่ง
        </button>
      ) : null}

      {loading && tables.length === 0 ? (
        <p className="table-picker__empty" role="status">
          กำลังตรวจสอบโต๊ะว่าง…
        </p>
      ) : null}

      <div className="zone-sections" role="group" aria-label={`เลือกโต๊ะสำหรับ ${partySize} คน`}>
        {venueZones.map((zone) => (
          <ZoneSection
            key={zone.id}
            zone={zone}
            zoneTables={tables.filter((t) => t.zone === zone.id)}
            placed={placed}
            summary={summaries.find((s) => s.zone === zone.id)}
            loading={loading}
            partySize={partySize}
            selectedTableId={selectedTableId}
            recommendedTableId={recommendedTableId}
            onToggle={toggleTable}
            onSelectId={selectById}
          />
        ))}
        {others.length > 0 ? (
          <section id={zoneSectionId("other")} className="zone-section is-other" aria-labelledby="zone-section-other-title">
            <header className="zone-section__head">
              <div className="zone-section__heading">
                <h3 id="zone-section-other-title" tabIndex={-1}>
                  โซนอื่น ๆ
                </h3>
                <p>โต๊ะที่ยังไม่ได้วางบนผัง เลือกจองได้ตามปกติ พนักงานจะพาไปที่โต๊ะ</p>
              </div>
            </header>
            <TableList
              label="โต๊ะในโซนอื่น ๆ"
              tables={others}
              partySize={partySize}
              selectedTableId={selectedTableId}
              recommendedTableId={recommendedTableId}
              onToggle={toggleTable}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
