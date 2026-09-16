import { useEffect, useRef } from "react";
import type { ZonePhoto } from "./venueModel";

type ZonePhotoViewerProps = {
  zoneLabel: string;
  photos: ZonePhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onOpen: () => void;
  onMatchView: () => void;
};

/** รูปจริงของโซนแบบใหญ่ พร้อมรูปย่อ — เลือกรูปแล้วโมเดลหมุนไปมุมเดียวกับรูป */
export function ZonePhotoViewer({ zoneLabel, photos, index, onIndexChange, onOpen, onMatchView }: ZonePhotoViewerProps) {
  const photo = photos[index] ?? photos[0]!;
  return (
    <figure className="zone-photo">
      <div className="zone-photo__head">
        <span className="zone-photo__tag">รูปจริง</span>
        <button type="button" className="zone-photo__match" onClick={onMatchView}>
          จัดมุมโมเดลให้ตรงรูปนี้
        </button>
      </div>
      <button
        type="button"
        className={`zone-photo__main is-${photo.fit ?? "cover"}`}
        onClick={onOpen}
        aria-label={`ขยายรูป ${photo.caption}`}
      >
        <img
          src={photo.src}
          alt={photo.alt}
          width={photo.orientation === "portrait" ? 960 : 1280}
          height={photo.orientation === "portrait" ? 1280 : 960}
          decoding="async"
        />
        <span className="zone-photo__zoom" aria-hidden="true">
          ⤢ ขยายรูป
        </span>
      </button>
      <figcaption>
        {photo.caption}
        {photos.length > 1 ? <span className="zone-photo__count"> · รูป {index + 1}/{photos.length}</span> : null}
      </figcaption>
      {photos.length > 1 ? (
        <div className="zone-photo__thumbs" role="group" aria-label={`รูปอื่นใน${zoneLabel}`}>
          {photos.map((p, i) => (
            <button
              key={p.src}
              type="button"
              className="zone-photo__thumb"
              aria-pressed={i === index}
              aria-label={`ดูรูป ${p.caption}`}
              onClick={() => onIndexChange(i)}
            >
              <img src={p.src} alt="" width={120} height={90} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

type PhotoLightboxProps = {
  photos: ZonePhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

/** ดูรูปจริงเต็มจอ: Esc ปิด, ลูกศรซ้าย/ขวาเปลี่ยนรูป, คืนโฟกัสเมื่อปิด */
export function PhotoLightbox({ photos, index, onIndexChange, onClose }: PhotoLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index] ?? photos[0]!;
  const many = photos.length > 1;
  const go = (delta: number) => onIndexChange((index + delta + photos.length) % photos.length);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (many && e.key === "ArrowRight") go(1);
      else if (many && e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`รูปจริง: ${photo.caption}`} onClick={onClose}>
      <figure className="photo-lightbox__figure" onClick={(e) => e.stopPropagation()}>
        <img src={photo.src} alt={photo.alt} />
        <figcaption>
          {photo.caption}
          {many ? ` · ${index + 1}/${photos.length}` : ""}
        </figcaption>
      </figure>
      <button ref={closeRef} type="button" className="photo-lightbox__close" aria-label="ปิดรูป" onClick={onClose}>
        ✕
      </button>
      {many ? (
        <>
          <button
            type="button"
            className="photo-lightbox__nav is-prev"
            aria-label="รูปก่อนหน้า"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="photo-lightbox__nav is-next"
            aria-label="รูปถัดไป"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}
