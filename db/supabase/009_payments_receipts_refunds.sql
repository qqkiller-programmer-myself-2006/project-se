-- 009_payments_receipts_refunds.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/009_payments_receipts_refunds.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 009 payments, receipts and refunds (Ticket 08, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + ALTER แบบ tolerate 1060 ใน runner
-- หมายเหตุ:
-- - payments ผูก 1:1 กับคำสั่งซื้อที่ pending_payment (UNIQUE order_id กัน intent ซ้อน
--   ระดับ DB; terminal failed/expired/cancelled สร้างใหม่ได้โดยลบ/แทนที่แถวเดิมผ่านโค้ดเท่านั้น)
-- - payment_events เป็น append-only (UNIQUE provider_event_id กัน webhook replay ซ้ำ)
-- - receipts เก็บ snapshot ใบเสร็จอย่างง่าย (UNIQUE receipt_number + payment_id)
-- - refunds เก็บหลักฐานคืนเงินที่ Owner อนุมัติ (หนึ่ง payment คืนได้ครั้งเดียว)

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  method VARCHAR(16) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  received_amount DECIMAL(12,2) NULL,
  change_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  provider_ref VARCHAR(120) NULL,
  slip_ref VARCHAR(120) NULL,
  receipt_number VARCHAR(32) NULL,
  idempotency_key CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payments_order UNIQUE (order_id),
  CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
  CONSTRAINT uq_payments_receipt UNIQUE (receipt_number),
  CONSTRAINT chk_payments_method CHECK (method IN ('cash', 'promptpay')),
  CONSTRAINT chk_payments_status CHECK (status IN ('pending', 'paid', 'manual_review', 'failed', 'expired', 'refunded', 'cancelled')),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0 AND change_amount >= 0),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders (id)
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_order_number ON payments (order_number);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments (created_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  provider_event_id VARCHAR(120) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  summary VARCHAR(500) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payment_events_provider UNIQUE (provider_event_id),
  CONSTRAINT chk_payment_events_kind CHECK (kind IN ('success', 'ambiguous', 'fail', 'expire')),
  CONSTRAINT fk_payment_events_payment FOREIGN KEY (payment_id) REFERENCES payments (id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events (payment_id);

CREATE TABLE IF NOT EXISTS receipts (
  payment_id CHAR(36) NOT NULL PRIMARY KEY,
  receipt_number VARCHAR(32) NOT NULL,
  order_id CHAR(36) NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  shop_name VARCHAR(128) NOT NULL,
  method VARCHAR(16) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  received_amount DECIMAL(12,2) NULL,
  change_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ NOT NULL,
  items_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_receipts_number UNIQUE (receipt_number),
  CONSTRAINT fk_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments (id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_order_number ON receipts (order_number);
CREATE INDEX IF NOT EXISTS idx_receipts_paid ON receipts (paid_at);

CREATE TABLE IF NOT EXISTS refunds (
  id CHAR(36) NOT NULL PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  approved_by VARCHAR(64) NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_refunds_payment UNIQUE (payment_id),
  CONSTRAINT chk_refunds_amount CHECK (amount >= 0),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments (id)
);
CREATE INDEX IF NOT EXISTS idx_refunds_created ON refunds (created_at);
