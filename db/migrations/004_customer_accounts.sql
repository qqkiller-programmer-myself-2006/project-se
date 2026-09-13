-- 004 customer accounts and LINE link (Ticket 03, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + runner เพิกเฉย error 1060/1050 ที่เกี่ยวข้อง
-- หมายเหตุ: phone/email เป็น NULL-able UNIQUE — บัญชีที่ลบแล้วตั้งเป็น NULL เพื่อให้เบอร์/อีเมลเดิม
-- นำกลับมาใช้ใหม่ได้ (MySQL อนุญาต NULL ซ้ำกันได้) ส่วน id ภายในคงอยู่เพื่อความถูกต้องของประวัติ

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(254) NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  password_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  CONSTRAINT uq_customers_phone UNIQUE (phone),
  CONSTRAINT uq_customers_email UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  password_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_customer_sessions_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_customer_sessions_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- การเชื่อม LINE หนึ่งต่อหนึ่ง: ลูกค้าหนึ่งบัญชีมีได้หนึ่งแถว, LINE subject หนึ่งค่าผูกได้หนึ่งบัญชี
CREATE TABLE IF NOT EXISTS customer_line_links (
  customer_id CHAR(36) NOT NULL PRIMARY KEY,
  provider VARCHAR(16) NOT NULL DEFAULT 'line',
  provider_subject VARCHAR(128) NOT NULL,
  display_name VARCHAR(120) NULL,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_line_links_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT uq_line_subject UNIQUE (provider, provider_subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- login transaction สำหรับ LINE authorization: state ใช้ครั้งเดียว อายุสั้น (10 นาที)
CREATE TABLE IF NOT EXISTS customer_line_tx (
  state CHAR(64) NOT NULL PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  nonce CHAR(64) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL,
  redirect_after VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  CONSTRAINT fk_line_tx_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_line_tx_customer (customer_id),
  INDEX idx_line_tx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
