import type { TableZone } from "../lib/api";
import {
  VENUE_BOUNDS,
  landmarks,
  tableFootprint,
  venueZones,
  type PlacedTable,
  type ZoneSummary,
} from "./venueModel";

type VenueFloorPlanProps = {
  tables: PlacedTable[];
  summaries: ZoneSummary[];
  selectedTableId: string | null;
  recommendedTableId: string | null;
  onTableClick: (tableId: string) => void;
  onZoneClick: (zone: TableZone) => void;
};

const { x0, x1, z0, z1 } = VENUE_BOUNDS;

/**
 * ผังร้านมองจากด้านบน (ตามแบบที่เจ้าของร้านวาด) — ภาพรวมก่อนเลื่อนลงไปดูทีละโซน
 * เป็นทางลัดสำหรับเมาส์/นิ้ว จึงซ่อนจากโปรแกรมอ่านจอ (มีปุ่ม "ไปที่โซน" และรายการโต๊ะแทน)
 */
export function VenueFloorPlan({
  tables,
  summaries,
  selectedTableId,
  recommendedTableId,
  onTableClick,
  onZoneClick,
}: VenueFloorPlanProps) {
  return (
    <svg
      className="floor-plan"
      viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect className="floor-plan__ground" x={x0} y={z0} width={x1 - x0} height={z1 - z0} rx={0.4} />
      <rect className="floor-plan__parking" x={x0 + 0.2} y={7.3} width={x1 - x0 - 0.4} height={z1 - 7.5} rx={0.3} />
      <text className="floor-plan__street" x={(x0 + x1) / 2} y={8.15}>
        ลานจอดรถ · ถนน — ทางเข้าร้านอยู่ด้านนี้ ↑
      </text>

      {venueZones.map((zone) => {
        const b = zone.bounds;
        const s = summaries.find((x) => x.zone === zone.id);
        const status = !s || s.total === 0 ? "ไม่มีโต๊ะ" : s.available === 0 ? "เต็ม" : `ว่าง ${s.available}/${s.total}`;
        // ป้ายชื่อโซนวางนอกกรอบ (บน/ล่าง) ไม่ให้โต๊ะบัง · ศาลาไม่มีที่ว่างด้านล่างจึงวางชิดขอบในกรอบ
        const labelY = zone.id === "front" ? b.z1 + 0.55 : zone.id === "sala" ? b.z1 - 0.55 : b.z0 - 0.55;
        return (
          <g key={zone.id} className={`floor-plan__zone is-${zone.id}`} onClick={() => onZoneClick(zone.id)}>
            <rect x={b.x0} y={b.z0} width={b.x1 - b.x0} height={b.z1 - b.z0} rx={0.15} />
            <g transform={`translate(${b.x0 + 0.1} ${labelY})`}>
              <circle className="floor-plan__num" cx={0.38} cy={0} r={0.38} />
              <text className="floor-plan__num-text" x={0.38} y={0.18}>
                {zone.number}
              </text>
              <text className="floor-plan__zone-label" x={0.95} y={0.18}>
                {zone.shortLabel}
                <tspan className={`floor-plan__zone-status${s && s.available > 0 ? " is-open" : ""}`}> · {status}</tspan>
              </text>
            </g>
          </g>
        );
      })}

      {landmarks.map((l) => {
        const b = l.bounds;
        const w = b.x1 - b.x0;
        const h = b.z1 - b.z0;
        const vertical = h > w * 1.5;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.z0 + b.z1) / 2;
        // ป้ายยาวแบ่งบรรทัดที่ " · " ให้อยู่ในกรอบเล็ก
        const lines = Math.max(w, h) < 2.5 ? l.label.split(" · ") : [l.label];
        return (
          <g key={l.id} className={`floor-plan__mark is-${l.id}`}>
            <rect x={b.x0} y={b.z0} width={w} height={h} rx={0.12} />
            <text x={cx} y={cy} transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
              {lines.map((line, i) => (
                <tspan key={line} x={cx} dy={i === 0 ? `${-(lines.length - 1) * 0.55}em` : "1.1em"}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}

      {tables.map((t) => {
        const { w, d } = tableFootprint(t.slot.kind);
        const { x, z } = t.slot.position;
        const deg = (-t.slot.rotation * 180) / Math.PI;
        const isSelected = t.id === selectedTableId;
        const isRecommended = t.id === recommendedTableId && t.status === "available" && !isSelected;
        const state = isSelected ? "selected" : t.status;
        return (
          <g
            key={t.id}
            className={`floor-plan__table is-${state}`}
            onClick={t.status === "available" ? () => onTableClick(t.id) : undefined}
          >
            <g transform={`translate(${x} ${z}) rotate(${deg})`}>
              {isRecommended ? <rect className="floor-plan__recommend" x={-w / 2 - 0.15} y={-d / 2 - 0.15} width={w + 0.3} height={d + 0.3} rx={0.3} /> : null}
              <rect className="floor-plan__chairs" x={-w / 2} y={-d / 2} width={w} height={d} rx={0.25} />
              <rect className="floor-plan__top" x={-w / 2 + 0.2} y={-d / 2 + 0.33} width={w - 0.4} height={d - 0.66} rx={0.08} />
            </g>
            <text className="floor-plan__table-name" x={x} y={z + 0.08}>
              {isSelected ? "✓" : ""}
              {t.name}
            </text>
            <text className="floor-plan__table-seats" x={x} y={z + (t.slot.kind === "bar" && t.slot.rotation ? 0.55 : 0.5)}>
              {t.status === "booked" ? "จองแล้ว" : `${t.capacity} ที่`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
