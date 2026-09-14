-- 006 orders and cart (Ticket 05, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS
-- หมายเหตุ:
-- - ตะกร้าเป็นข้อมูลชั่วคราวฝั่งเว็บ (localStorage) ไม่มีตารางตะกร้าฝั่ง server
-- - orders เก็บ snapshot การยืนยัน: ราคา/ชื่อเมนูตรึงใน order_items แล้ว
--   ราคาเมนูภายหลังไม่กระทบคำสั่งซื้อเดิม
-- - idempotency_key กันยืนยันซ้ำจาก request เดิม (UNIQUE + เทียบ payload hash)
-- - สถานะรุ่นแรก: pending_payment → completed/cancelled (ยังไม่รวมคิว/ชำระเงินจริง)
-- - ไม่รวมสต๊อก/สูตร/คิวครัว/การชำระเงิน (งาน ticket ถัดไป)

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_number VARCHAR(32) NOT NULL,
  customer_id CHAR(36) NULL,
  guest_name VARCHAR(120) NULL,
  guest_phone VARCHAR(20) NULL,
  channel VARCHAR(16) NOT NULL DEFAULT 'web',
  service_type VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_payment',
  subtotal DECIMAL(12,2) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  scheduled_at DATETIME NULL,
  idempotency_key CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_orders_number UNIQUE (order_number),
  CONSTRAINT uq_orders_idempotency UNIQUE (idempotency_key),
  CONSTRAINT chk_orders_service CHECK (service_type IN ('dine_in', 'takeaway', 'preorder')),
  CONSTRAINT chk_orders_status CHECK (status IN ('pending_payment', 'completed', 'cancelled')),
  CONSTRAINT chk_orders_channel CHECK (channel = 'web'),
  CONSTRAINT chk_orders_total CHECK (subtotal >= 0 AND total >= 0),
  INDEX idx_orders_customer (customer_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_guest_phone (guest_phone),
  INDEX idx_orders_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  menu_id CHAR(36) NOT NULL,
  menu_name VARCHAR(120) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  note VARCHAR(200) NULL,
  CONSTRAINT chk_order_items_qty CHECK (quantity >= 1 AND quantity <= 20),
  CONSTRAINT chk_order_items_price CHECK (unit_price >= 0 AND line_total >= 0),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id),
  INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
