-- 002_credential_version.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/002_credential_version.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 002 credential/session version ป้องกัน reset/login race
-- รันซ้ำได้อย่างปลอดภัย (migration runner เพิกเฉย error 1060 = มีคอลัมน์แล้ว)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_version INT NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS password_version INT NOT NULL DEFAULT 1;
