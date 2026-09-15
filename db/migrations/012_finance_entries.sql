-- 012 finance manual entries (Ticket 11, MySQL 8)
-- นโยบายเดียวกับ 008-011: CREATE TABLE IF NOT EXISTS + ALTER tolerate 1060 ผ่าน runner
-- หมายเหตุ:
-- - รายรับจากคำสั่งซื้อ (paid payments หัก refunds) คำนวณ derived จากตาราง
--   payments/refunds เสมอ — ไม่ได้เก็บในตารางนี้ กันนับรายรับซ้ำ (exactly-once
--   ตาม paidAt/approvedAt)
-- - ต้นทุนวัตถุดิบประมาณการ (orders.estimated_cost) แสดงแยกเพื่อวิเคราะห์
--   ไม่หักในกำไรเพื่อกันหักต้นทุนซ้ำกับรายจ่ายจริง

CREATE TABLE IF NOT EXISTS finance_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  category VARCHAR(32) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  occurred_at DATETIME NOT NULL,
  note VARCHAR(500) NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  actor_id VARCHAR(64) NULL,
  actor_username VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_finance_kind CHECK (kind IN ('income', 'expense')),
  CONSTRAINT chk_finance_amount CHECK (amount > 0),
  INDEX idx_finance_occurred (occurred_at),
  INDEX idx_finance_kind_occurred (kind, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
