-- 011_loyalty_rewards.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/011_loyalty_rewards.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 011 loyalty points and rewards (Ticket 10, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + ALTER แบบ tolerate 1060 ใน runner
-- หมายเหตุ:
-- - loyalty_transactions เป็น ledger แบบ append-only (ห้าม UPDATE/DELETE ที่โค้ด)
--   ยอดคงเหลือ = SUM(points) ต่อลูกค้า (derived — คำนวณที่โค้ดเสมอ)
-- - reward_redemptions แลกแบบ 2 ขั้น: reserved (กันคะแนน+quota) → consumed/released
--   กันแลกซ้ำด้วย UNIQUE (idempotency_key)
-- - walkin_qr_tokens ใช้ครั้งเดียว อายุ 10 นาที (ตรวจที่โค้ดด้วย fake clock seam)
-- - queue_jobs ของรางวัล: order_id/payment_id เป็น NULL ได้ (ไม่ผูกคำสั่งซื้อ/ชำระเงิน —
--   ไม่สร้างรายรับและไม่ได้คะแนน) อ้างอิง redemption ผ่าน reward_redemption_id
--   (FK แบบ nullable ตรวจเฉพาะค่าที่ไม่เป็น NULL)

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  points INT NOT NULL,
  source VARCHAR(32) NOT NULL,
  order_id CHAR(36) NULL,
  payment_id CHAR(36) NULL,
  order_item_id CHAR(36) NULL,
  redemption_id CHAR(36) NULL,
  walkin_token_id CHAR(36) NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  actor_id VARCHAR(64) NULL,
  actor_username VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_loyalty_source CHECK (source IN ('order', 'walkin', 'reward_reserve', 'reward_consume', 'reward_release', 'refund', 'merge', 'adjust')),
  CONSTRAINT chk_loyalty_points CHECK (points != 0)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer_created ON loyalty_transactions (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_order ON loyalty_transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemption ON loyalty_transactions (redemption_id);

CREATE TABLE IF NOT EXISTS rewards (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  image_url VARCHAR(2048) NULL,
  menu_id CHAR(36) NOT NULL,
  menu_name VARCHAR(120) NOT NULL,
  points_cost INT NOT NULL,
  quota_total INT NULL,
  quota_used INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_reward_points_cost CHECK (points_cost >= 1 AND points_cost <= 100000),
  CONSTRAINT chk_reward_quota CHECK ((quota_total IS NULL OR quota_total >= 0) AND quota_used >= 0),
  CONSTRAINT fk_reward_menu FOREIGN KEY (menu_id) REFERENCES menu_items (id)
);
CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards (is_active);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  reward_id CHAR(36) NOT NULL,
  reward_name VARCHAR(120) NOT NULL,
  menu_id CHAR(36) NOT NULL,
  menu_name VARCHAR(120) NOT NULL,
  points_cost INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'reserved',
  idempotency_key CHAR(36) NOT NULL,
  queue_job_id CHAR(36) NULL,
  reason VARCHAR(500) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_redemption_status CHECK (status IN ('reserved', 'consumed', 'released')),
  CONSTRAINT uq_redemption_idem UNIQUE (idempotency_key),
  CONSTRAINT uq_redemption_code UNIQUE (code),
  CONSTRAINT fk_redemption_reward FOREIGN KEY (reward_id) REFERENCES rewards (id)
);
CREATE INDEX IF NOT EXISTS idx_redemption_customer ON reward_redemptions (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_redemption_reward_status ON reward_redemptions (reward_id, status);

CREATE TABLE IF NOT EXISTS walkin_qr_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(48) NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ NULL,
  redeemed_by CHAR(36) NULL,
  CONSTRAINT uq_walkin_code UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_walkin_expires ON walkin_qr_tokens (expires_at);

CREATE TABLE IF NOT EXISTS guest_link_claims (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  guest_phone VARCHAR(16) NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_guest_claim_order UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_guest_claim_customer ON guest_link_claims (customer_id);

CREATE TABLE IF NOT EXISTS customer_merges (
  id CHAR(36) NOT NULL PRIMARY KEY,
  source_customer_id CHAR(36) NOT NULL,
  target_customer_id CHAR(36) NOT NULL,
  approved_by VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_customer_merge_pair UNIQUE (source_customer_id, target_customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_merge_target ON customer_merges (target_customer_id);

CREATE TABLE IF NOT EXISTS loyalty_reversals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  refund_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  points INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_loyalty_reversal_refund UNIQUE (refund_id)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_reversal_order ON loyalty_reversals (order_id);

-- งานรางวัลไม่ผูกคำสั่งซื้อ/ชำระเงิน: อนุญาต NULL (FK เดิมตรวจเฉพาะค่าที่ไม่เป็น NULL)
ALTER TABLE queue_jobs ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE queue_jobs ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS reward_redemption_id CHAR(36) NULL;
