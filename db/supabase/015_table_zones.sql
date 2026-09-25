-- 015_table_zones.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/015_table_zones.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 015 table zones (MySQL 8)
-- นโยบายเดียวกับ 007-014: รันซ้ำได้ — runner tolerate 1060 (duplicate column)
-- หมายเหตุ:
-- - zone คือโซนที่นั่งในร้านสำหรับผังให้ลูกค้าเลือกโต๊ะ: front | dining | kitchen | sala
-- - NULL = ยังไม่กำหนดโซน (ลูกค้ายังจองโต๊ะนั้นได้ แต่ไม่แสดงบนผังสามมิติ)
-- - ค่าที่อนุญาตตรวจในโค้ด (TABLE_ZONES) เพื่อเพิ่มโซนใหม่ได้โดยไม่ต้อง ALTER CHECK

ALTER TABLE shop_tables ADD COLUMN IF NOT EXISTS zone VARCHAR(32) NULL;
