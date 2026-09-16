import { useState } from "react";
import "./RealMenuPhotoGallery.css";

const menuPhotos = [
  {
    src: "/venue/latest/real-menu-board.jpg",
    alt: "ป้ายรายการอาหารตามสั่งและราคาเพิ่มของร้านป้าอ้อ",
    label: "ป้ายเมนูอาหารตามสั่ง",
    caption: "ภาพป้ายเมนูอาหารที่ติดอยู่ภายในร้าน",
  },
  {
    src: "/venue/latest/real-menu-counter.jpg",
    alt: "ป้ายภาพเมนูอาหารเหนือเคาน์เตอร์ครัวร้านป้าอ้อ",
    label: "เมนูหน้าเคาน์เตอร์",
    caption: "ภาพเมนูและบรรยากาศบริเวณหน้าเคาน์เตอร์ครัว",
  },
] as const;

export function RealMenuPhotoGallery() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = menuPhotos[activeIndex];

  return (
    <section className="real-menu-gallery" aria-labelledby="real-menu-gallery-title">
      <div className="real-menu-gallery__heading">
        <div>
          <p className="real-menu-gallery__eyebrow">ภาพจากหน้าร้าน</p>
          <h2 id="real-menu-gallery-title" className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            เมนูจากร้านจริง
          </h2>
        </div>
        <p>ดูป้ายเมนูที่ร้านควบคู่กับรายการพร้อมขายและราคาปัจจุบันด้านล่าง</p>
      </div>

      <figure className="real-menu-gallery__stage">
        <img
          key={active.src}
          src={active.src}
          alt={active.alt}
          width={1200}
          height={1600}
          loading={activeIndex === 0 ? "eager" : "lazy"}
          decoding="async"
        />
        <figcaption>
          <strong>{active.label}</strong>
          <span>{active.caption}</span>
        </figcaption>
      </figure>

      <div className="real-menu-gallery__controls" aria-label="เลือกภาพเมนูจากร้านจริง">
        {menuPhotos.map((photo, index) => (
          <button
            key={photo.src}
            type="button"
            className="real-menu-gallery__selector"
            aria-label={`ดู${photo.label}`}
            aria-pressed={index === activeIndex}
            onClick={() => setActiveIndex(index)}
          >
            <img
              src={photo.src}
              alt=""
              width={160}
              height={120}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
            <span>{photo.label}</span>
          </button>
        ))}
      </div>

      <p className="real-menu-gallery__notice">
        ภาพใช้แสดงบรรยากาศและเมนูหน้าร้าน ราคาและสถานะพร้อมขายให้ยึดข้อมูลในระบบเป็นหลัก
      </p>
    </section>
  );
}
