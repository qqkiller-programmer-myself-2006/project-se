import { useMemo, useState, type CSSProperties } from "react";
import "./ReservationTableScene.css";

type TableFixture = {
  id: string;
  name: string;
  capacity: number;
  zone: string;
  status: "available" | "occupied";
  x: string;
  y: string;
  depth: number;
  turn: number;
};

type ReservationTableSceneProps = {
  partySize: number | string;
  recommendedTableId?: string | null;
  selectedTableId?: string | null;
  onSelectTable?: (tableId: string | null) => void;
};

const tables: TableFixture[] = [
  { id: "table-a1", name: "A1", capacity: 2, zone: "โซนหน้าร้าน", status: "available", x: "17%", y: "21%", depth: 4, turn: -5 },
  { id: "table-a2", name: "A2", capacity: 2, zone: "โซนหน้าร้าน", status: "occupied", x: "55%", y: "18%", depth: 2, turn: 4 },
  { id: "table-b1", name: "B1", capacity: 4, zone: "โซนกลางร้าน", status: "available", x: "8%", y: "48%", depth: 16, turn: 5 },
  { id: "table-b2", name: "B2", capacity: 4, zone: "โซนกลางร้าน", status: "available", x: "42%", y: "44%", depth: 18, turn: -3 },
  { id: "table-b3", name: "B3", capacity: 4, zone: "โซนกลางร้าน", status: "occupied", x: "72%", y: "48%", depth: 14, turn: 5 },
  { id: "table-c1", name: "C1", capacity: 6, zone: "โซนด้านใน", status: "available", x: "20%", y: "72%", depth: 34, turn: -4 },
  { id: "table-c2", name: "C2", capacity: 8, zone: "โซนด้านใน", status: "available", x: "62%", y: "70%", depth: 38, turn: 3 },
];

function statusText(table: TableFixture, selected: boolean): string {
  if (selected) return "เลือกอยู่";
  return table.status === "occupied" ? "ไม่ว่าง" : "ว่าง";
}

export function ReservationTableScene({
  partySize,
  recommendedTableId = null,
  selectedTableId,
  onSelectTable,
}: ReservationTableSceneProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = selectedTableId === undefined ? internalSelectedId : selectedTableId;
  const party = Number(partySize);
  const normalizedPartySize = Number.isFinite(party) && party > 0 ? Math.floor(party) : 1;
  const selected = useMemo(() => tables.find((table) => table.id === selectedId) ?? null, [selectedId]);

  function selectTable(table: TableFixture) {
    if (table.status === "occupied") return;
    const nextId = table.id === selectedId ? null : table.id;
    setInternalSelectedId(nextId);
    onSelectTable?.(nextId);
  }

  return (
    <section className="reservation-table-scene" aria-labelledby="reservation-table-scene-title">
      <div className="reservation-table-scene__heading">
        <div>
          <p className="reservation-table-scene__eyebrow">ลองเลือกมุมที่นั่ง</p>
          <h2 id="reservation-table-scene-title" className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            แบบจำลองโต๊ะภายในร้าน
          </h2>
        </div>
        <p className="reservation-table-scene__party" aria-live="polite">
          กำลังดูโต๊ะสำหรับ {normalizedPartySize} คน
        </p>
      </div>

      <p className="reservation-table-scene__disclaimer">
        แบบจำลองนี้ใช้ช่วยเลือกโซนที่ชอบเท่านั้น ไม่ใช่ผังที่วัดตามขนาดจริง ตำแหน่งโต๊ะอาจเปลี่ยนตามการจัดร้าน
        และระบบจะจัดโต๊ะจริงตามข้อมูลว่าง
      </p>

      <div className="reservation-table-scene__viewport">
        <div className="reservation-table-scene__backdrop" aria-hidden="true">
          <img
            className="reservation-table-scene__backdrop-primary"
            src="/venue/latest/real-counter-seating.jpg"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <img
            className="reservation-table-scene__backdrop-secondary"
            src="/venue/latest/real-outdoor-seating.jpg"
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="reservation-table-scene__floor" aria-hidden="true" />
        <div className="reservation-table-scene__tables" role="group" aria-label="เลือกโต๊ะจากแบบจำลอง">
          {tables.map((table) => {
            const isSelected = table.id === selectedId;
            const isOccupied = table.status === "occupied";
            const isRecommended = table.id === recommendedTableId;
            const isTooSmall = table.capacity < normalizedPartySize;
            const style = {
              "--table-x": table.x,
              "--table-y": table.y,
              "--table-depth": `${table.depth}px`,
              "--table-turn": `${table.turn}deg`,
            } as CSSProperties;

            return (
              <button
                key={table.id}
                type="button"
                className={`reservation-table-scene__table${isSelected ? " is-selected" : ""}${isOccupied ? " is-occupied" : ""}${isRecommended ? " is-recommended" : ""}${isTooSmall ? " is-too-small" : ""}`}
                style={style}
                aria-label={`${table.name} ${table.zone} รองรับ ${table.capacity} คน สถานะ${statusText(table, isSelected)}${isRecommended ? " โต๊ะที่ระบบแนะนำ" : ""}${isTooSmall ? ` รองรับไม่พอสำหรับ ${normalizedPartySize} คน` : ""}`}
                aria-pressed={isSelected}
                aria-disabled={isOccupied}
                onClick={() => selectTable(table)}
              >
                <span className="reservation-table-scene__tabletop" aria-hidden="true" />
                <span className="reservation-table-scene__table-name">{table.name}</span>
                <span className="reservation-table-scene__table-capacity">{table.capacity} คน</span>
                <span className="reservation-table-scene__table-status">{statusText(table, isSelected)}</span>
                {isRecommended ? <span className="reservation-table-scene__recommended">แนะนำ</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="reservation-table-scene__legend" aria-label="คำอธิบายสถานะโต๊ะ">
        <span><i className="is-available" aria-hidden="true" />ว่าง</span>
        <span><i className="is-occupied" aria-hidden="true" />ไม่ว่าง</span>
        <span><i className="is-selected" aria-hidden="true" />เลือกอยู่</span>
        <span><i className="is-recommended" aria-hidden="true" />ระบบแนะนำ</span>
      </div>

      <div className="reservation-table-scene__summary" role="status" aria-live="polite" aria-atomic="true">
        {selected ? (
          <>
            <strong>ความต้องการโต๊ะ: {selected.name}</strong>
            <span>{selected.zone} · รองรับ {selected.capacity} คน</span>
            {selected.capacity < normalizedPartySize ? (
              <span className="reservation-table-scene__warning">โต๊ะนี้อาจเล็กเกินไปสำหรับจำนวนผู้ใช้บริการที่ระบุ</span>
            ) : (
              <span>บันทึกเป็นความต้องการเบื้องต้นบนหน้านี้ โดยระบบยังเป็นผู้จัดโต๊ะจริงตามข้อมูลว่าง</span>
            )}
          </>
        ) : (
          <span>เลือกโต๊ะในแบบจำลองเพื่อดูโซนและจำนวนที่นั่ง</span>
        )}
      </div>
    </section>
  );
}
