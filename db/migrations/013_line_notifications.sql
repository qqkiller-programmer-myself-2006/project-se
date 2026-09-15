-- 013 LINE notifications outbox (Ticket 12, MySQL 8)
-- นโยบายเดียวกับ 008-012: CREATE TABLE IF NOT EXISTS + runner tolerate 1060
-- หมายเหตุ:
-- - หนึ่ง event_key → หนึ่งแถว (exactly-once เชิงตรรกะ; producer เรียกซ้ำเป็น no-op)
-- - message เก็บเฉพาะข้อความภาษาไทยที่จะส่ง ห้ามมี token/secret
-- - last_error เก็บเฉพาะข้อความย่อที่ sanitize แล้ว (≤500 อักษร)
-- - consent default เปิด (ไม่มีแถว = เปิด); opt-out เขียนแถว enabled=0

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  event_key VARCHAR(191) NOT NULL,
  kind VARCHAR(48) NOT NULL,
  customer_id VARCHAR(64) NULL,
  order_id VARCHAR(64) NULL,
  reservation_id VARCHAR(64) NULL,
  payment_id VARCHAR(64) NULL,
  message VARCHAR(2000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_retry_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_notifications_event_key UNIQUE (event_key),
  CONSTRAINT chk_notification_kind CHECK (kind IN ('reservation_created', 'reservation_cancelled', 'reservation_reminder', 'payment_paid', 'payment_manual_review', 'order_ready', 'order_delivered', 'loyalty_earned', 'loyalty_redeemed')),
  CONSTRAINT chk_notification_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter', 'skipped')),
  INDEX idx_notifications_status_retry (status, next_retry_at),
  INDEX idx_notifications_customer (customer_id),
  INDEX idx_notifications_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_consents (
  customer_id VARCHAR(64) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
