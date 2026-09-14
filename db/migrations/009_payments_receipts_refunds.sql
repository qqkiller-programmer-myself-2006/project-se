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
  paid_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_payments_order UNIQUE (order_id),
  CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
  CONSTRAINT uq_payments_receipt UNIQUE (receipt_number),
  CONSTRAINT chk_payments_method CHECK (method IN ('cash', 'promptpay')),
  CONSTRAINT chk_payments_status CHECK (status IN ('pending', 'paid', 'manual_review', 'failed', 'expired', 'refunded', 'cancelled')),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0 AND change_amount >= 0),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders (id),
  INDEX idx_payments_status (status),
  INDEX idx_payments_order_number (order_number),
  INDEX idx_payments_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  provider_event_id VARCHAR(120) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  summary VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payment_events_provider UNIQUE (provider_event_id),
  CONSTRAINT chk_payment_events_kind CHECK (kind IN ('success', 'ambiguous', 'fail', 'expire')),
  CONSTRAINT fk_payment_events_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  INDEX idx_payment_events_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  paid_at DATETIME NOT NULL,
  items_snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_receipts_number UNIQUE (receipt_number),
  CONSTRAINT fk_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  INDEX idx_receipts_order_number (order_number),
  INDEX idx_receipts_paid (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refunds (
  id CHAR(36) NOT NULL PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  approved_by VARCHAR(64) NULL,
  approved_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_refunds_payment UNIQUE (payment_id),
  CONSTRAINT chk_refunds_amount CHECK (amount >= 0),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  INDEX idx_refunds_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
