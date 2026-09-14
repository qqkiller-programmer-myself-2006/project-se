-- 005 menu catalog (Ticket 04, MySQL 8)
-- รันซ้ำได้อย่างปลอดภัย: CREATE TABLE IF NOT EXISTS + runner เพิกเฉย error ที่เกี่ยวข้อง
-- หมายเหตุ:
-- - ชื่อเมนูซ้ำได้ข้ามหมวด แต่ห้ามซ้ำในหมวดเดียวกัน (UNIQUE KEY uq_menu_category_name)
-- - archive = ซ่อนจากหน้าขายแบบคงประวัติ (is_archived) ไม่ลบทำลาย
-- - สต๊อก/สูตร/คำสั่งซื้อ/รูปอัปโหลดยังไม่รวมใน Ticket นี้ (เตรียม field ต่อยอดเท่านั้น)

CREATE TABLE IF NOT EXISTS menu_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  category VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  image_url VARCHAR(2048) NULL,
  price DECIMAL(12,2) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'available',
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_menu_category_name UNIQUE (category, name),
  CONSTRAINT chk_menu_price CHECK (price >= 0 AND price <= 1000000),
  CONSTRAINT chk_menu_kind CHECK (kind IN ('food', 'drink')),
  CONSTRAINT chk_menu_status CHECK (status IN ('available', 'unavailable')),
  CONSTRAINT chk_menu_sort CHECK (sort_order >= 0 AND sort_order <= 10000),
  INDEX idx_menu_category_order (category, sort_order),
  INDEX idx_menu_kind (kind),
  INDEX idx_menu_status_archived (status, is_archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
