-- 007_reservations.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/007_reservations.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 007 reservations and table rounds (Ticket 06, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + INSERT ไม่มี + ALTER แบบ tolerate 1060 ใน runner
-- หมายเหตุ:
-- - การจองหนึ่งรายการอ้างอิงลูกค้า (บัญชีลูกค้า — Guest จองไม่ได้) และโต๊ะหนึ่งโต๊ะ
-- - หน้าต่างถือครองโต๊ะ 120 นาที (RESERVATION_SLOT_MINUTES) ตรวจทับซ้อนในโค้ด
--   (isReservationOverlapping เดียวกันทั้ง Memory/MySQL) ไม่ใช่ constraint ระดับ DB
-- - กัน concurrent ชนกันด้วย named lock + transaction ใน store (ไม่พึ่ง unique index ช่วงเวลา)
-- - รอบการใช้โต๊ะหนึ่งรอบผูกกับการจองได้หนึ่งครั้ง (UNIQUE reservation_id;
--   NULL ได้หลายแถวสำหรับรอบ walk-in) และหนึ่งโต๊ะมีรอบเปิดได้หนึ่งรอบ (ตรวจในโค้ด)
-- - orders ผูกโต๊ะ/รอบผ่านคอลัมน์ table_id/round_id (nullable; รอบปิดรับคำสั่งซื้อใหม่ไม่ได้)

CREATE TABLE IF NOT EXISTS reservations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  table_id CHAR(36) NOT NULL,
  party_size INT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  note VARCHAR(200) NULL,
  idempotency_key CHAR(36) NULL,
  payload_hash CHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_reservations_code UNIQUE (code),
  CONSTRAINT uq_reservations_idempotency UNIQUE (idempotency_key),
  CONSTRAINT chk_reservations_party CHECK (party_size >= 1 AND party_size <= 50),
  CONSTRAINT chk_reservations_status CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'))
);
CREATE INDEX IF NOT EXISTS idx_reservations_table_time ON reservations (table_id, reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations (customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations (code);

CREATE TABLE IF NOT EXISTS table_rounds (
  id CHAR(36) NOT NULL PRIMARY KEY,
  reservation_id CHAR(36) NULL,
  table_id CHAR(36) NOT NULL,
  party_size INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  opened_by VARCHAR(64) NULL,
  closed_by VARCHAR(64) NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_rounds_reservation UNIQUE (reservation_id),
  CONSTRAINT chk_rounds_party CHECK (party_size >= 1 AND party_size <= 50),
  CONSTRAINT chk_rounds_status CHECK (status IN ('open', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_rounds_table_status ON table_rounds (table_id, status);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON table_rounds (status);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_id CHAR(36) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS round_id CHAR(36) NULL;
