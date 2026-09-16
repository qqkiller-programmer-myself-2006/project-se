import { useState } from "react";
import "./ReservationVenueGallery.css";

type VenueView = {
  src: string;
  alt: string;
  label: string;
  caption: string;
};

const venueViews: VenueView[] = [
  {
    src: "/venue/reservations/dining-room.jpg",
    alt: "พื้นที่นั่งรับประทานอาหารภายในร้านป้าอ้อ",
    label: "ห้องอาหาร",
    caption: "พื้นที่นั่งภายในร้าน โปร่ง เรียบง่าย และมองเห็นการจัดโต๊ะโดยรวม",
  },
  {
    src: "/venue/reservations/storefront-seating.jpg",
    alt: "มุมนั่งรับประทานอาหารใกล้หน้าร้านป้าอ้อ",
    label: "มุมหน้าร้าน",
    caption: "มุมด้านหน้าร้านรับแสงธรรมชาติ เห็นบรรยากาศทางเข้าและพื้นที่นั่งใกล้หน้าร้าน",
  },
  {
    src: "/venue/reservations/counter.jpg",
    alt: "เคาน์เตอร์ไม้และมุมเครื่องดื่มภายในร้านป้าอ้อ",
    label: "เคาน์เตอร์",
    caption: "เคาน์เตอร์ไม้โทนอุ่นและมุมเครื่องดื่มที่เป็นเอกลักษณ์ของร้าน",
  },
  {
    src: "/venue/reservations/drink-menu.jpg",
    alt: "เมนูเครื่องดื่มที่เคาน์เตอร์ร้านป้าอ้อ",
    label: "เมนูเครื่องดื่ม",
    caption: "เมนูเครื่องดื่มหลากหลายสำหรับสั่งเพิ่มระหว่างใช้บริการที่ร้าน",
  },
  {
    src: "/venue/reservations/food-menu.jpg",
    alt: "ป้ายรายการอาหารตามสั่งของร้านป้าอ้อ",
    label: "เมนูอาหาร",
    caption: "รายการอาหารตามสั่งของร้านสำหรับดูบรรยากาศและตัวเลือกก่อนเดินทางมา",
  },
];

function wrapIndex(index: number): number {
  return (index + venueViews.length) % venueViews.length;
}

export function ReservationVenueGallery() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = venueViews[activeIndex];
  const previous = venueViews[wrapIndex(activeIndex - 1)];
  const next = venueViews[wrapIndex(activeIndex + 1)];

  return (
    <section className="reservation-venue" aria-labelledby="reservation-venue-title">
      <div className="reservation-venue__heading">
        <div>
          <p className="reservation-venue__eyebrow">บรรยากาศจริงของร้านป้าอ้อ</p>
          <h2 id="reservation-venue-title" className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            ดูบรรยากาศก่อนเลือกโต๊ะ
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-ink-600">
          สำรวจพื้นที่จริงของร้านจากหลายมุม แล้วค่อยเลือกรูปแบบการจองที่เหมาะกับคุณ
        </p>
      </div>

      <div className="reservation-venue__stage">
        <div className="reservation-venue__card reservation-venue__card--back-left" aria-hidden="true">
          <img src={previous.src} alt="" loading="lazy" decoding="async" />
        </div>
        <div className="reservation-venue__card reservation-venue__card--back-right" aria-hidden="true">
          <img src={next.src} alt="" loading="lazy" decoding="async" />
        </div>

        <figure className="reservation-venue__card reservation-venue__card--active">
          <img
            key={active.src}
            src={active.src}
            alt={active.alt}
            width={1280}
            height={960}
            loading={activeIndex === 0 ? "eager" : "lazy"}
            decoding="async"
          />
          <figcaption className="reservation-venue__caption">
            <span className="reservation-venue__caption-label">{active.label}</span>
            <span>{active.caption}</span>
          </figcaption>
        </figure>

        <button
          type="button"
          className="reservation-venue__arrow reservation-venue__arrow--previous"
          onClick={() => setActiveIndex((index) => wrapIndex(index - 1))}
          aria-label="ดูภาพบรรยากาศก่อนหน้า"
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          type="button"
          className="reservation-venue__arrow reservation-venue__arrow--next"
          onClick={() => setActiveIndex((index) => wrapIndex(index + 1))}
          aria-label="ดูภาพบรรยากาศถัดไป"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <p className="reservation-venue__position" role="status" aria-live="polite" aria-atomic="true">
        ภาพที่ {activeIndex + 1} จาก {venueViews.length} · {active.label}
      </p>

      <div className="reservation-venue__selectors" aria-label="เลือกมุมบรรยากาศร้าน">
        {venueViews.map((view, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={view.src}
              type="button"
              className="reservation-venue__selector"
              aria-label={`ดู${view.label} ภาพที่ ${index + 1}`}
              aria-pressed={selected}
              onClick={() => setActiveIndex(index)}
            >
              <img src={view.src} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
              <span>{view.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
