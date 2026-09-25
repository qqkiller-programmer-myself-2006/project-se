-- 004_customer_accounts.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/004_customer_accounts.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
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
  is_active SMALLINT NOT NULL DEFAULT 1,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  password_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_customers_phone UNIQUE (phone),
  CONSTRAINT uq_customers_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  password_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_customer_sessions_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions (customer_id);

-- การเชื่อม LINE หนึ่งต่อหนึ่ง: ลูกค้าหนึ่งบัญชีมีได้หนึ่งแถว, LINE subject หนึ่งค่าผูกได้หนึ่งบัญชี
CREATE TABLE IF NOT EXISTS customer_line_links (
  customer_id CHAR(36) NOT NULL PRIMARY KEY,
  provider VARCHAR(16) NOT NULL DEFAULT 'line',
  provider_subject VARCHAR(128) NOT NULL,
  display_name VARCHAR(120) NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_line_links_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT uq_line_subject UNIQUE (provider, provider_subject)
);

-- login transaction สำหรับ LINE authorization: state ใช้ครั้งเดียว อายุสั้น (10 นาที)
CREATE TABLE IF NOT EXISTS customer_line_tx (
  state CHAR(64) NOT NULL PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  nonce CHAR(64) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL,
  redirect_after VARCHAR(128) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  CONSTRAINT fk_line_tx_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_line_tx_customer ON customer_line_tx (customer_id);
CREATE INDEX IF NOT EXISTS idx_line_tx_expires ON customer_line_tx (expires_at);
