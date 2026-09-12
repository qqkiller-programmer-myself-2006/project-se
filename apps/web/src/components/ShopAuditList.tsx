import type { AuditItem } from "../lib/api";
import { fmtBangkok } from "../lib/shop-week";
import { Alert, Badge } from "./ui";

const OVERRIDE_LABELS: Record<string, string> = {
  shop_schedule_updated: "ปรับเวลาทำการ",
  shop_name_updated: "เปลี่ยนชื่อร้าน",
  shop_override_set: "สั่งเปิด–ปิดชั่วคราว",
  shop_override_cleared: "ล้างคำสั่งชั่วคราว",
  shop_table_created: "เพิ่มโต๊ะ",
  shop_table_updated: "แก้ไขโต๊ะ",
};

export interface ShopAuditListProps {
  items: AuditItem[];
  error: string | null;
}

/** รายการประวัติร้าน (สกัดจาก ShopPage — markup เดิม) */
export function ShopAuditList({ items, error }: ShopAuditListProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink-900">ประวัติร้าน</h2>
        <Badge tone="neutral">{items.length} รายการ</Badge>
      </div>
      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink-600">ยังไม่มีประวัติการเปลี่ยนสถานะร้าน</p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
              <Badge tone="brand">{OVERRIDE_LABELS[i.action] ?? i.action}</Badge>
              <span className="font-semibold text-ink-900">{i.actorUsername ?? "-"}</span>
              <span className="text-sm text-ink-500">{fmtBangkok(i.at)}</span>
              {i.detail && <span className="text-sm text-ink-600">{i.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
