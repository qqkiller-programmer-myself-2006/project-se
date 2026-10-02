import { useEffect, useRef, useState } from "react";
import { extractRewardQrCode } from "../lib/walkinQr";
import { Alert, secondaryButtonClass } from "./ui";

/** อ่านเฟรมจากกล้องหนึ่งครั้ง คืนข้อความใน QR หรือ null ถ้าไม่พบ */
export type QrDecode = (video: HTMLVideoElement) => Promise<string | null>;
export type OpenCamera = () => Promise<MediaStream>;

const SCAN_INTERVAL_MS = 250;
const MAX_FRAME_WIDTH = 640;

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

let nativeDetector: BarcodeDetectorLike | null | undefined;
let canvas: HTMLCanvasElement | null = null;

/** ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (Chrome/Android) ไม่งั้นถอดรหัสเองด้วย jsQR (โหลดเมื่อเริ่มสแกนเท่านั้น) */
export const defaultDecode: QrDecode = async (video) => {
  if (nativeDetector === undefined) {
    const BD = (globalThis as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    try {
      nativeDetector = BD ? new BD({ formats: ["qr_code"] }) : null;
    } catch {
      nativeDetector = null;
    }
  }
  if (nativeDetector) {
    try {
      const found = await nativeDetector.detect(video);
      return found[0]?.rawValue ?? null;
    } catch {
      // อ่านด้วย detector ไม่ได้ในเฟรมนี้ — ลองถอดรหัสเองต่อ
    }
  }
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  canvas ??= document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { default: jsQR } = await import("jsqr");
  const image = ctx.getImageData(0, 0, w, h);
  return jsQR(image.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
};

export const defaultOpenCamera: OpenCamera = async () => {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media || typeof media.getUserMedia !== "function") {
    throw new DOMException("camera unavailable", "NotSupportedError");
  }
  return media.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
};

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException || (err && typeof err === "object" && "name" in err) ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในเบราว์เซอร์ หรือกรอกรหัสเองด้านล่าง";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "ไม่พบกล้องในอุปกรณ์นี้ กรุณากรอกรหัสเองด้านล่าง";
  }
  return "เปิดกล้องไม่ได้ในเบราว์เซอร์นี้ (ต้องเปิดผ่าน HTTPS และอนุญาตกล้อง) กรุณากรอกรหัสเองด้านล่าง";
}

/**
 * สแกน QR รับแต้มด้วยกล้อง (Issue #44) — คืนเฉพาะรหัส `WALKIN-…` ที่ถูกต้องผ่าน onCode แล้วปิดกล้องเอง
 * QR อื่นถูกเมินพร้อมข้อความเตือน; เปิดกล้องไม่ได้ → แสดงเหตุผลเป็นภาษาไทยและให้กรอกรหัสเองแทน
 * decode/openCamera ฉีดเข้ามาได้เพื่อทดสอบโดยไม่ต้องมีกล้องจริง
 */
export function QrScanner({
  onCode,
  onClose,
  decode = defaultDecode,
  openCamera = defaultOpenCamera,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  decode?: QrDecode;
  openCamera?: OpenCamera;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [unrecognized, setUnrecognized] = useState(false);
  // เก็บ callback ล่าสุดไว้ใน ref เพื่อไม่ให้ effect เปิดกล้องใหม่ทุกครั้งที่ parent render
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | null = null;

    function stop() {
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    async function tick(video: HTMLVideoElement) {
      if (cancelled) return;
      try {
        const text = await decode(video);
        if (cancelled) return;
        if (text) {
          const code = extractRewardQrCode(text);
          if (code) {
            stop();
            onCodeRef.current(code);
            return;
          }
          setUnrecognized(true);
        }
      } catch {
        // เฟรมนี้อ่านไม่ได้ — ลองเฟรมถัดไป
      }
      timer = setTimeout(() => void tick(video), SCAN_INTERVAL_MS);
    }

    (async () => {
      try {
        stream = await openCamera();
        if (cancelled) {
          stop();
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play?.();
        if (cancelled) return;
        setStatus("scanning");
        void tick(video);
      } catch (err) {
        if (cancelled) return;
        stop();
        setError(cameraErrorMessage(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [decode, openCamera]);

  return (
    <div className="space-y-3" aria-label="สแกน QR รับแต้มด้วยกล้อง">
      {status === "error" ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="ภาพจากกล้องสำหรับสแกน QR"
            className="aspect-square w-full max-w-sm rounded-xl border border-ink-300 bg-ink-900 object-cover"
          />
          <p role="status" className="text-sm text-ink-700">
            {status === "starting" ? "กำลังเปิดกล้อง…" : "หันกล้องไปที่ QR ของร้าน ระบบจะอ่านให้อัตโนมัติ"}
          </p>
          {unrecognized ? (
            <p className="text-sm font-medium text-red-700">QR นี้ไม่ใช่รหัสรับแต้มของร้าน กรุณาสแกน QR ที่พนักงานให้</p>
          ) : null}
        </>
      )}
      <button type="button" onClick={onClose} className={secondaryButtonClass}>
        ปิดกล้อง
      </button>
    </div>
  );
}
