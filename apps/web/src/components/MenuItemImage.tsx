import { useState } from "react";

/**
 * รูปเมนูพร้อมภาพสำรองที่ออกแบบไว้
 *
 * เดิมทุกหน้าทำแบบเดียวกันคือ `onError` แล้ว `style.display = "none"`
 * รูปที่โหลดไม่ได้จึงหายไปเงียบ ๆ เหลือการ์ดโหว่ ๆ โดยไม่บอกอะไรเลย
 * (เช่นตอนนี้ที่เมนูอาหารใน DB ชี้ไปโดเมนตัวอย่างที่ไม่มีอยู่จริง)
 *
 * แทนที่จะหาย ให้ตกไปเป็นแผ่นป้ายทองเหลืองที่ดูตั้งใจ — กรอบการ์ดยังเต็ม
 * สัดส่วนยังเท่าเดิม และคนที่ใช้สกรีนรีดเดอร์ได้ยินว่า "ยังไม่มีรูป" ไม่ใช่เงียบ
 */
export function MenuItemImage({
  src,
  name,
  className = "",
  loading = "lazy",
}: {
  src?: string | null;
  name: string;
  /** คลาสกำหนดขนาด/สัดส่วน — ใช้ชุดเดียวกันทั้งรูปจริงและภาพสำรอง */
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(src) && !broken;

  if (showPhoto) {
    return (
      <img
        src={src ?? undefined}
        alt={`รูป${name}`}
        loading={loading}
        decoding="async"
        onError={() => setBroken(true)}
        className={`object-cover ${className}`.trim()}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={`${name} — ยังไม่มีรูปเมนู`}
      className={`menu-item-image__fallback flex items-center justify-center ${className}`.trim()}
    >
      <span aria-hidden="true" className="pa-display text-3xl text-gold-200">
        ปอ
      </span>
    </div>
  );
}

export default MenuItemImage;
