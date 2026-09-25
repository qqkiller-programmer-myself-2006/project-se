-- 001_staff_accounts.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/001_staff_accounts.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 001 staff accounts vertical slice (MySQL 8)
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  roles JSONB NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id CHAR(36) NULL,
  actor_username VARCHAR(64) NULL,
  action VARCHAR(48) NOT NULL,
  target_id CHAR(36) NULL,
  target_username VARCHAR(64) NULL,
  detail VARCHAR(500) NULL,
  ip VARCHAR(64) NULL,
  success SMALLINT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_audit_action_at ON audit_logs (action, at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs (target_id);
