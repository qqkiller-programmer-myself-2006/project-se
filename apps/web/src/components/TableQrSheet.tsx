import { useEffect } from "react";
import { createPortal } from "react-dom";
import { TABLE_ZONE_LABELS, type ShopTable } from "../lib/api";
import { tableOrderUrl } from "../lib/tableQr";
import { TableQrCode } from "./TableQrCode";

/**
 * แผ่นป้าย QR สำหรับพิมพ์ติดโต๊ะ — ใบละโต๊ะ ชื่อโต๊ะตัวใหญ่ + QR + วิธีใช้สั้น ๆ
 *
 * บนจอซ่อนอยู่ (ดูผ่านหน้าต่างพิมพ์ของเบราว์เซอร์) ตอนพิมพ์ CSS ซ่อนทุกอย่างใน body
 * ยกเว้นแผ่นนี้ จึง portal มาเป็นลูกตรงของ body ให้ selector `body > .table-qr-sheet` จับได้
 *
 * mount = สั่งพิมพ์ทันที · ปิดหน้าต่างพิมพ์แล้วเรียก onDone ให้หน้าเอาแผ่นออก
 */
export function TableQrSheet({ tables, base, onDone }: { tables: ShopTable[]; base: string; onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener("afterprint", done);
    // รอให้ SVG ลง DOM ก่อนเปิดหน้าต่างพิมพ์ ไม่งั้นบางเบราว์เซอร์พิมพ์หน้าว่าง
    const id = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        done();
      }
    }, 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", done);
    };
  }, [onDone]);

  return createPortal(
    <section className="table-qr-sheet" aria-label="แผ่นป้าย QR สำหรับพิมพ์">
      {tables.map((t) => (
        <article key={t.id} className="table-qr-sheet__card">
          <p className="table-qr-sheet__shop">ร้านป้าอ้ออาหารตามสั่ง</p>
          <p className="table-qr-sheet__table">โต๊ะ {t.name}</p>
          {t.zone ? <p className="table-qr-sheet__zone">{TABLE_ZONE_LABELS[t.zone]}</p> : null}
          <TableQrCode value={tableOrderUrl(t.id, base)} label={`QR สั่งอาหารโต๊ะ ${t.name}`} size={220} />
          <p className="table-qr-sheet__how">สแกนเพื่อดูเมนูและสั่งอาหารที่โต๊ะนี้</p>
          <p className="table-qr-sheet__note">เช็กอินที่หน้าร้านก่อน แล้วสั่งได้เลยไม่ต้องสมัครสมาชิก</p>
        </article>
      ))}
    </section>,
    document.body,
  );
}

export default TableQrSheet;
