import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { TABLE_ZONE_LABELS, type TableAvailability, type TableZone } from "../lib/api";
import { getZone, placeTables, summarizeZones, venueZones } from "./venueModel";
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

/**
 * ขั้นเลือกโซนและโต๊ะ: การ์ดโซน (รูปจริง + จำนวนโต๊ะว่าง) → โมเดลสามมิติ → รายการโต๊ะ
 * รายการโต๊ะคือช่องทางหลักที่เข้าถึงได้ทุกอุปกรณ์ ส่วนโมเดลสามมิติช่วยให้เห็นตำแหน่งจริง
 */
export function ReservationTableScene({
  tables,
  recommendedTableId,
  partySize,
  selectedTableId,
  onSelectTable,
  loading = false,
}: ReservationTableSceneProps) {
  const [focusZoneId, setFocusZoneId] = useState<TableZone | null>(null);
  const { placed } = useMemo(() => placeTables(tables), [tables]);
  const summaries = useMemo(() => summarizeZones(tables), [tables]);
  const selected = tables.find((t) => t.id === selectedTableId) ?? null;
  const recommended = tables.find((t) => t.id === recommendedTableId && t.status === "available") ?? null;
  const availableCount = tables.filter((t) => t.status === "available").length;

  // เลือกโต๊ะจากที่อื่น (เช่น "ให้ระบบเลือกให้") → พากล้องไปที่โซนของโต๊ะนั้น
  const selectedZone = selected?.zone ?? null;
  useEffect(() => {
    if (selectedZone) setFocusZoneId(selectedZone);
  }, [selectedTableId, selectedZone]);

  function toggleTable(table: TableAvailability) {
    if (table.status !== "available") return;
    onSelectTable(table.id === selectedTableId ? null : table.id);
  }

  function selectById(id: string) {
    const table = tables.find((t) => t.id === id);
    if (table) toggleTable(table);
  }

  const visibleGroups = summaries
    .filter((s) => focusZoneId === null || s.zone === focusZoneId)
    .map((s) => ({ zone: s.zone, tables: tables.filter((t) => (t.zone ?? null) === s.zone) }))
    .filter((g) => g.tables.length > 0);
  const focused = getZone(focusZoneId);

  return (
    <div className="table-picker">
      <div className="table-picker__zones" role="group" aria-label="เลือกโซนที่นั่ง">
        <button
          type="button"
          className="table-picker__zone table-picker__zone--all"
          aria-pressed={focusZoneId === null}
          onClick={() => setFocusZoneId(null)}
        >
          <span className="table-picker__zone-icon" aria-hidden="true">
            ⌂
          </span>
          <span className="table-picker__zone-text">
            <strong>ดูทั้งร้าน</strong>
            <small>{loading ? "กำลังตรวจโต๊ะว่าง…" : `ว่าง ${availableCount} จาก ${tables.length} โต๊ะ`}</small>
          </span>
        </button>
        {venueZones.map((zone) => {
          const s = summaries.find((x) => x.zone === zone.id);
          const available = s?.available ?? 0;
          const total = s?.total ?? 0;
          const status = total === 0 ? "ไม่มีโต๊ะ" : available === 0 ? "เต็ม" : `ว่าง ${available}/${total} โต๊ะ`;
          return (
            <button
              key={zone.id}
              type="button"
              className={`table-picker__zone${!loading && available === 0 ? " is-full" : ""}`}
              aria-pressed={focusZoneId === zone.id}
              aria-label={`${zone.label} ${loading ? "กำลังตรวจโต๊ะว่าง" : status}`}
              onClick={() => setFocusZoneId(zone.id)}
            >
              <img src={zone.photo} alt="" width={96} height={72} loading="lazy" decoding="async" />
              <span className="table-picker__zone-text">
                <strong>{zone.shortLabel}</strong>
                <small>{loading ? "กำลังตรวจ…" : status}</small>
              </span>
            </button>
          );
        })}
      </div>

      <p className="table-picker__zone-caption">
        {focused ? (
          <>
            <strong>{focused.label}</strong> — {focused.caption}
          </>
        ) : (
          "แตะป้ายโซนบนโมเดลหรือการ์ดด้านบน เพื่อซูมเข้าไปเลือกโต๊ะ"
        )}
      </p>

      <Suspense
        fallback={
          <div className="venue-scene-3d venue-scene-3d--fallback" role="status">
            <p>กำลังโหลดโมเดลสามมิติของร้าน…</p>
          </div>
        }
      >
        <VenueScene3D
          tables={placed}
          zoneSummaries={summaries}
          focusZoneId={focusZoneId}
          selectedTableId={selectedTableId}
          recommendedTableId={recommendedTableId}
          onTableClick={selectById}
          onZoneClick={setFocusZoneId}
        />
      </Suspense>

      <ul className="table-picker__legend" aria-label="คำอธิบายสีโต๊ะ">
        <li><i className="is-available" aria-hidden="true" />ว่าง เลือกได้</li>
        <li><i className="is-selected" aria-hidden="true" />โต๊ะที่คุณเลือก</li>
        <li><i className="is-recommended" aria-hidden="true" />ระบบแนะนำ</li>
        <li><i className="is-booked" aria-hidden="true" />จองแล้ว</li>
        <li><i className="is-too_small" aria-hidden="true" />ที่นั่งไม่พอ</li>
      </ul>

      {recommended && recommended.id !== selectedTableId ? (
        <button type="button" className="table-picker__recommend" onClick={() => onSelectTable(recommended.id)}>
          <span aria-hidden="true">★</span> ให้ระบบเลือกให้: โต๊ะ {recommended.name} · {zoneLabel(recommended.zone)} ·{" "}
          {recommended.capacity} ที่นั่ง
        </button>
      ) : null}

      <div className="table-picker__list" role="group" aria-label={`เลือกโต๊ะสำหรับ ${partySize} คน`}>
        {loading && tables.length === 0 ? (
          <p className="table-picker__empty" role="status">
            กำลังตรวจสอบโต๊ะว่าง…
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="table-picker__empty">
            {focusZoneId ? "โซนนี้ยังไม่มีโต๊ะให้จอง ลองดูโซนอื่น" : "ยังไม่มีโต๊ะให้จองในขณะนี้"}
          </p>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.zone ?? "other"} className="table-picker__group" aria-label={zoneLabel(group.zone)}>
              <h3>{zoneLabel(group.zone)}</h3>
              <ul>
                {group.tables.map((table) => {
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
                        onClick={() => toggleTable(table)}
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
            </section>
          ))
        )}
      </div>
    </div>
  );
}
