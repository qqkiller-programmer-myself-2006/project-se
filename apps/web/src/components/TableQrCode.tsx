import { useMemo } from "react";
import { qrMatrix } from "../lib/tableQr";

/** ขอบว่างรอบ QR (quiet zone) ตามมาตรฐานต้องมีอย่างน้อย 4 module ไม่งั้นกล้องบางรุ่นอ่านไม่ออก */
const QUIET_ZONE = 4;

/**
 * QR เป็น SVG — คมทุกขนาดทั้งบนจอและตอนพิมพ์
 * วาดทุกช่องดำเป็น path เดียว (เบากว่า <rect> หลายร้อยตัว)
 */
export function TableQrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const { path, dimension } = useMemo(() => {
    const matrix = qrMatrix(value);
    const n = matrix.length;
    let d = "";
    matrix.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
      }),
    );
    return { path: d, dimension: n + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block bg-white"
    >
      <rect width={dimension} height={dimension} fill="#ffffff" />
      <path d={path} fill="#14110f" />
    </svg>
  );
}

export default TableQrCode;
