-- 003_shop_status_tables.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/003_shop_status_tables.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 003 shop status and tables (Ticket 02, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + INSERT IGNORE + ALTER แบบ tolerate 1060 ใน runner
CREATE TABLE IF NOT EXISTS shop_settings (
  id INT NOT NULL PRIMARY KEY,
  shop_name VARCHAR(120) NOT NULL DEFAULT 'ร้านป้าอ้ออาหารตามสั่ง',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_shop_settings_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS shop_schedule (
  weekday SMALLINT NOT NULL PRIMARY KEY,
  closed SMALLINT NOT NULL DEFAULT 0,
  intervals JSONB NOT NULL,
  CONSTRAINT chk_shop_schedule_weekday CHECK (weekday >= 0 AND weekday <= 6)
);

CREATE TABLE IF NOT EXISTS shop_override (
  id INT NOT NULL PRIMARY KEY,
  mode VARCHAR(16) NOT NULL,
  reason VARCHAR(300) NULL,
  expected_reopen_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  CONSTRAINT chk_shop_override_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS shop_tables (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  capacity INT NOT NULL,
  is_enabled SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_shop_tables_capacity CHECK (capacity >= 1 AND capacity <= 50)
);

INSERT INTO shop_settings (id, shop_name) VALUES (1, 'ร้านป้าอ้ออาหารตามสั่ง') ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (0, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (1, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (2, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (3, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (4, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (5, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
INSERT INTO shop_schedule (weekday, closed, intervals) VALUES (6, 0, CAST('[{"open":"09:00","close":"21:00"}]' AS JSONB)) ON CONFLICT DO NOTHING;
