-- 008 menu options, recipes and inventory (Ticket 07, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + ALTER แบบ tolerate 1060 ใน runner
-- หมายเหตุ:
-- - กลุ่มตัวเลือกผูกกับเมนูหนึ่งรายการ (ชื่อซ้ำไม่ได้ในเมนูเดียวกัน);
--   ตัวเลือกผูกกับกลุ่ม (ชื่อซ้ำไม่ได้ในกลุ่มเดียวกัน, เลือกได้กลุ่มละ 1 ตัวเลือกต่อรายการ)
-- - วัตถุดิบหนึ่งรายการมีหนึ่งหน่วยเท่านั้น (คอลัมน์ unit กำหนดตอนสร้าง ห้ามแก้ผ่าน API)
--   พร้อมขาย = on_hand − reserved (บังคับไม่ติดลบในโค้ดก่อน mutate เสมอ)
-- - สูตรแบบ versioned: แก้ไข = สร้างเวอร์ชันใหม่อย่างเดียว (UNIQUE target+version)
--   คำสั่งซื้อยืนยันอ้างสูตรล่าสุดเสมอ; ยอดที่จองไว้ตรึงใน order_stock_usage
--   (ไม่เปลี่ยนตามสูตรภายหลัง) ใช้คืนยอดจอง/ตัดจริง
-- - stock_ledger เป็น append-only (ไม่มี UPDATE/DELETE ผ่าน API)
-- - orders เพิ่ม stock_reserved/stock_consumed/estimated_cost;
--   order_items เพิ่ม special_request/options_snapshot (JSON)/estimated_cost

CREATE TABLE IF NOT EXISTS menu_option_groups (
  id CHAR(36) NOT NULL PRIMARY KEY,
  menu_id CHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_option_groups_menu_name UNIQUE (menu_id, name),
  CONSTRAINT chk_option_groups_sort CHECK (sort_order >= 0 AND sort_order <= 10000),
  INDEX idx_option_groups_menu (menu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_options (
  id CHAR(36) NOT NULL PRIMARY KEY,
  group_id CHAR(36) NOT NULL,
  menu_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  price_delta DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_options_group_name UNIQUE (group_id, name),
  CONSTRAINT chk_options_sort CHECK (sort_order >= 0 AND sort_order <= 10000),
  INDEX idx_options_group (group_id),
  INDEX idx_options_menu (menu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingredients (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  on_hand DECIMAL(12,3) NOT NULL DEFAULT 0,
  reserved DECIMAL(12,3) NOT NULL DEFAULT 0,
  reorder_threshold DECIMAL(12,3) NOT NULL DEFAULT 0,
  latest_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_ingredients_name UNIQUE (name),
  CONSTRAINT chk_ingredients_stock CHECK (on_hand >= 0 AND reserved >= 0),
  INDEX idx_ingredients_enabled (is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  target_type VARCHAR(16) NOT NULL,
  target_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_recipes_target_version UNIQUE (target_type, target_id, version),
  CONSTRAINT chk_recipes_target CHECK (target_type IN ('menu', 'option')),
  CONSTRAINT chk_recipes_version CHECK (version >= 1),
  INDEX idx_recipes_target (target_type, target_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipe_lines (
  id CHAR(36) NOT NULL PRIMARY KEY,
  recipe_id CHAR(36) NOT NULL,
  ingredient_id CHAR(36) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  CONSTRAINT chk_recipe_lines_qty CHECK (qty > 0),
  CONSTRAINT fk_recipe_lines_recipe FOREIGN KEY (recipe_id) REFERENCES recipes (id),
  INDEX idx_recipe_lines_recipe (recipe_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_ledger (
  id CHAR(36) NOT NULL PRIMARY KEY,
  ingredient_id CHAR(36) NOT NULL,
  op VARCHAR(32) NOT NULL,
  delta_on_hand DECIMAL(12,3) NOT NULL DEFAULT 0,
  delta_reserved DECIMAL(12,3) NOT NULL DEFAULT 0,
  before_on_hand DECIMAL(12,3) NOT NULL,
  after_on_hand DECIMAL(12,3) NOT NULL,
  before_reserved DECIMAL(12,3) NOT NULL,
  after_reserved DECIMAL(12,3) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_id VARCHAR(64) NULL,
  actor_username VARCHAR(64) NULL,
  order_id CHAR(36) NULL,
  reference VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_stock_ledger_op CHECK (op IN ('receive', 'reserve', 'release', 'consume', 'return', 'waste', 'expire', 'personal_use', 'adjust')),
  INDEX idx_stock_ledger_ingredient (ingredient_id, created_at),
  INDEX idx_stock_ledger_order (order_id),
  INDEX idx_stock_ledger_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_stock_usage (
  order_id CHAR(36) NOT NULL,
  ingredient_id CHAR(36) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  CONSTRAINT pk_order_stock_usage PRIMARY KEY (order_id, ingredient_id),
  CONSTRAINT chk_order_stock_usage_qty CHECK (qty > 0),
  CONSTRAINT fk_order_stock_usage_order FOREIGN KEY (order_id) REFERENCES orders (id),
  INDEX idx_order_stock_usage_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders ADD COLUMN stock_reserved TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN stock_consumed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN special_request VARCHAR(200) NULL;
ALTER TABLE order_items ADD COLUMN options_snapshot JSON NULL;
ALTER TABLE order_items ADD COLUMN estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0;
