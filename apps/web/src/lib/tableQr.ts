import qrcode from "qrcode-generator";

/**
 * QR ที่ติดบนโต๊ะ: พาลูกค้าไปหน้าแรกพร้อมรหัสโต๊ะ (`/?table=<id>`)
 *
 * หน้าแรกจำรหัสโต๊ะไว้ (lib/tableContext.ts) และตะกร้าส่งไปกับคำสั่งซื้อ
 * server หารอบที่เช็กอินอยู่ของโต๊ะนั้นเอง (#19) — QR จึงใส่แค่ id โต๊ะพอ
 * id โต๊ะเป็น UUID สุ่ม เดาโต๊ะอื่นจาก QR ใบหนึ่งไม่ได้
 */

/**
 * เลือกโดเมนสำหรับลิงก์ใน QR: ค่าที่ตั้งไว้ถ้าเป็น http(s) ที่ใช้ได้ ไม่งั้น origin ของหน้า
 * แยกเป็นฟังก์ชันบริสุทธิ์ให้เทสต์ได้โดยไม่ต้องพึ่ง env ของ build
 */
export function resolveSiteBaseUrl(configured: unknown, origin: string): string {
  const value = String(configured ?? "").trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, "");
  return origin;
}

/**
 * โดเมนของเว็บที่ลูกค้าจะเปิด
 *
 * ตั้ง `VITE_PUBLIC_SITE_URL` ตอน build ให้เป็นโดเมนจริง — หน้าจัดการโต๊ะอาจถูกเปิดจาก
 * localhost หรือเครื่องในร้าน ถ้าใช้ origin ของหน้านั้น QR ที่พิมพ์ไปจะชี้ localhost ซึ่งสแกนแล้วเปิดไม่ได้
 *
 * ต้องเขียน `import.meta.env.VITE_PUBLIC_SITE_URL` ตรง ๆ แบบนี้: Vite แทนค่าให้ตอน build
 * แบบข้อความ ส่วน production ไม่มีออบเจ็กต์ import.meta.env ให้อ่านตอนรัน
 * (ถ้าเขียน `import.meta?.env` หรือแคสต์ครอบ Vite จะไม่แทนค่า และ build จริงจะอ่านได้ undefined)
 */
export function siteBaseUrl(): string {
  return resolveSiteBaseUrl(
    import.meta.env.VITE_PUBLIC_SITE_URL,
    typeof window !== "undefined" ? window.location.origin : "",
  );
}

/** base ที่ใช้พิมพ์ QR ชี้เครื่องตัวเอง — สแกนจากมือถือลูกค้าแล้วเปิดไม่ได้ */
export function isLocalBaseUrl(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return true;
  }
}

export function tableOrderUrl(tableId: string, base: string = siteBaseUrl()): string {
  return `${base.replace(/\/+$/, "")}/?table=${encodeURIComponent(tableId)}`;
}

/**
 * ตาราง module ของ QR (true = ช่องดำ)
 * ระดับแก้ผิด "M" ทนรอยเปื้อน/รอยพับได้ราว 15% — พอสำหรับกระดาษบนโต๊ะอาหาร
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
