-- 010 kitchen and drink queues with delivery (Ticket 09, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + ALTER แบบ tolerate 1060 ใน runner
-- หมายเหตุ:
-- - queue_jobs หนึ่ง OrderItem → หนึ่ง job (ทำใหม่สร้างแถวใหม่ผูก order_item เดิม ไม่คิดเงินซ้ำ)
-- - idempotency ระดับชุดงาน: หนึ่ง payment สร้าง jobs ได้ชุดเดียว (กันชำระสำเร็จซ้ำสร้างงานซ้ำ)
--   ตรวจที่โค้ด (SELECT payment_id ก่อน INSERT ใน transaction เดียว)
-- - readyAt ทั่วไป = paid_at; preorder = scheduled_at − เวลาทำประมาณการของฝ่าย
-- - station_capacity หนึ่งแถวต่อฝ่าย (INSERT ... ON DUPLICATE KEY UPDATE ที่โค้ด)

CREATE TABLE IF NOT EXISTS queue_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  menu_id CHAR(36) NOT NULL,
  menu_name VARCHAR(120) NOT NULL,
  station VARCHAR(16) NOT NULL,
  quantity INT NOT NULL,
  ready_qty INT NOT NULL DEFAULT 0,
  delivered_qty INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  ready_at DATETIME NOT NULL,
  table_id CHAR(36) NULL,
  round_id CHAR(36) NULL,
  is_remake TINYINT(1) NOT NULL DEFAULT 0,
  is_priority TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL,
  claimed_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_queue_station CHECK (station IN ('kitchen', 'drink')),
  CONSTRAINT chk_queue_status CHECK (status IN ('queued', 'claimed', 'preparing', 'ready', 'delivered', 'cancelled')),
  CONSTRAINT chk_queue_qty CHECK (quantity > 0 AND ready_qty >= 0 AND delivered_qty >= 0 AND ready_qty <= quantity AND delivered_qty <= ready_qty),
  CONSTRAINT fk_queue_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_queue_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  INDEX idx_queue_station_status_ready (station, status, ready_at),
  INDEX idx_queue_payment (payment_id),
  INDEX idx_queue_order (order_id),
  INDEX idx_queue_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_capacity (
  station VARCHAR(16) NOT NULL PRIMARY KEY,
  per_slot INT NOT NULL DEFAULT 10,
  updated_by VARCHAR(64) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_station_capacity_station CHECK (station IN ('kitchen', 'drink')),
  CONSTRAINT chk_station_capacity_per_slot CHECK (per_slot >= 1 AND per_slot <= 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO station_capacity (station, per_slot) VALUES ('kitchen', 10), ('drink', 10);
