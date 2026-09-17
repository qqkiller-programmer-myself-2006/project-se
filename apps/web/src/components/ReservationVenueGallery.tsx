import { useState } from "react";
import { venueZones } from "./venueModel";
import "./ReservationVenueGallery.css";

type VenueView = {
  src: string;
  alt: string;
  label: string;
  caption: string;
};

/** เฉพาะรูปที่เห็นตำแหน่งโต๊ะของแต่ละโซน — ชุดเดียวกับรูปในผังโซนด้านบน */
const venueViews: VenueView[] = venueZones.flatMap((zone) =>
  zone.photos.map((photo) => ({
    src: photo.src,
    alt: photo.alt,
    label: `โซน ${zone.number} ${zone.shortLabel}`,
    caption: photo.caption,
  })),
);

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
          <p className="reservation-venue__eyebrow">รูปจริงของโต๊ะแต่ละโซน</p>
          <h2 id="reservation-venue-title" className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            ดูตำแหน่งโต๊ะก่อนจอง
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-ink-600">
          ดูว่าโต๊ะแต่ละโซนตั้งอยู่ตรงไหนของร้าน แล้วเลือกโต๊ะที่อยากนั่ง
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
          aria-label="ดูรูปตำแหน่งโต๊ะก่อนหน้า"
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          type="button"
          className="reservation-venue__arrow reservation-venue__arrow--next"
          onClick={() => setActiveIndex((index) => wrapIndex(index + 1))}
          aria-label="ดูรูปตำแหน่งโต๊ะถัดไป"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <p className="reservation-venue__position" role="status" aria-live="polite" aria-atomic="true">
        ภาพที่ {activeIndex + 1} จาก {venueViews.length} · {active.label}
      </p>

      <div className="reservation-venue__selectors" aria-label="เลือกรูปตำแหน่งโต๊ะ">
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
