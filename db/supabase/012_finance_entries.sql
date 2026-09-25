-- 012_finance_entries.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/012_finance_entries.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
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
  occurred_at TIMESTAMPTZ NOT NULL,
  note VARCHAR(500) NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  actor_id VARCHAR(64) NULL,
  actor_username VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_finance_kind CHECK (kind IN ('income', 'expense')),
  CONSTRAINT chk_finance_amount CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_finance_occurred ON finance_entries (occurred_at);
CREATE INDEX IF NOT EXISTS idx_finance_kind_occurred ON finance_entries (kind, occurred_at);
