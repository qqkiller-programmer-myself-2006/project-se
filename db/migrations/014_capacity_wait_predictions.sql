-- 014 capacity and wait-time predictions (Ticket 13, MySQL 8)
-- นโยบายเดียวกับ 008-013: CREATE TABLE IF NOT EXISTS + runner tolerate 1060
-- หมายเหตุ:
-- - prediction_models เก็บ singleton แถวเดียว (id='default') — registry รุ่นโมเดล
--   (โมเดลจริงยังไม่เลือกผู้ให้บริการตาม D09; ตอนนี้ baseline-v1 + fake เท่านั้น)
-- - prediction_features เก็บ features ณ จุดพยากรณ์เท่านั้น (no leakage):
--   ไม่มีข้อมูลอนาคต (actual มาตอนส่งมอบครบ) และไม่มี PII ลูกค้า
--   (ไม่มีชื่อ/เบอร์โทร/อีเมล/LINE user ID)
-- - actual/error คำนวณตอน complete (ส่งมอบครบ) — ใช้เทียบ MAE baseline vs model (AT18)

CREATE TABLE IF NOT EXISTS prediction_models (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  version VARCHAR(64) NOT NULL DEFAULT 'baseline-v1',
  kind VARCHAR(16) NOT NULL DEFAULT 'baseline',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  threshold_minutes DECIMAL(6,2) NOT NULL DEFAULT 0,
  timeout_ms INT NOT NULL DEFAULT 500,
  updated_by VARCHAR(64) NULL,
  trained_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_prediction_model_kind CHECK (kind IN ('baseline', 'external')),
  CONSTRAINT chk_prediction_model_timeout CHECK (timeout_ms >= 50 AND timeout_ms <= 5000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO prediction_models (id, version, kind, enabled, threshold_minutes, timeout_ms)
VALUES ('default', 'baseline-v1', 'baseline', 1, 0, 500);

CREATE TABLE IF NOT EXISTS prediction_features (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id VARCHAR(64) NULL,
  station VARCHAR(16) NULL,
  party_size INT NOT NULL,
  queue_ahead INT NOT NULL,
  units_ahead INT NOT NULL,
  hour_of_day INT NOT NULL,
  day_of_week INT NOT NULL,
  is_remake TINYINT(1) NOT NULL DEFAULT 0,
  is_priority TINYINT(1) NOT NULL DEFAULT 0,
  slot_key VARCHAR(128) NULL,
  baseline_min INT NOT NULL,
  predicted_min INT NULL,
  model_version VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'baseline',
  actual_min DECIMAL(6,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT chk_prediction_feature_station CHECK (station IS NULL OR station IN ('kitchen', 'drink')),
  CONSTRAINT chk_prediction_feature_source CHECK (source IN ('baseline', 'model')),
  INDEX idx_prediction_features_order (order_id),
  INDEX idx_prediction_features_created (created_at),
  INDEX idx_prediction_features_actual (actual_min)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
