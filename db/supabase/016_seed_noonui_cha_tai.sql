-- 016_seed_noonui_cha_tai.sql - PostgreSQL / Supabase edition (temporary Vercel path)
-- Mirror of db/migrations/016_seed_noonui_cha_tai.sql: same tables, constraints, seeds.
-- Rerunnable: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + ON CONFLICT DO NOTHING. updated_at has no auto-update trigger;
-- the app sets updated_at explicitly in its UPDATEs.
-- 016 seed เมนูหนูนุ้ย ชาใต้; fixed IDs make this safe to rerun.
INSERT INTO menu_items (id, category, name, description, image_url, price, kind, status, is_archived, sort_order) VALUES
('16000000-0000-4000-8000-000000000001','ชาและโกโก้','ชาใต้','ชาใต้เข้มข้น หอมใบชาและนมอย่างลงตัว','/menu/items/cha-tai.png',29.00,'drink','available',0,2),
('16000000-0000-4000-8000-000000000002','ชาและโกโก้','ชาดำเย็น','ชาดำเย็นหอมเข้ม สดชื่น ดื่มง่าย','/menu/items/black-tea.png',19.00,'drink','available',0,6),
('16000000-0000-4000-8000-000000000003','ชาและโกโก้','ชาเขียว','ชาเขียวหอมละมุน หวานมันกำลังดี','/menu/items/green-tea.png',29.00,'drink','available',0,3),
('16000000-0000-4000-8000-000000000004','ชาและโกโก้','ชาเขียวมะนาว','ชาเขียวผสมน้ำมะนาว เปรี้ยวหอมสดชื่น','/menu/items/green-lemon-tea.png',29.00,'drink','available',0,5),
('16000000-0000-4000-8000-000000000005','ชาและโกโก้','ชามะนาว','ชาดำหอมละมุนผสมน้ำมะนาวแท้','/menu/items/lemon-tea.png',29.00,'drink','available',0,4),
('16000000-0000-4000-8000-000000000006','ชาและโกโก้','โกโก้','โกโก้เข้มข้นผสมนมสด หอมหวานมัน','/menu/items/cocoa.png',29.00,'drink','available',0,1),
('16000000-0000-4000-8000-000000000007','กาแฟและมัทฉะ','เอสเปรสโซ่','กาแฟช็อตเข้มหอม เสิร์ฟเย็นสดชื่น','/menu/items/espresso.png',39.00,'drink','available',0,2),
('16000000-0000-4000-8000-000000000008','กาแฟและมัทฉะ','ลาเต้','กาแฟนุ่มผสมนมสด หอมละมุน','/menu/items/latte.png',39.00,'drink','available',0,5),
('16000000-0000-4000-8000-000000000009','กาแฟและมัทฉะ','คาปูชิโน่','กาแฟเข้มกลมกล่อม ท็อปด้วยฟองนมนุ่ม','/menu/items/cappuccino.png',39.00,'drink','available',0,3),
('16000000-0000-4000-8000-000000000010','กาแฟและมัทฉะ','มอคค่า','กาแฟผสมโกโก้ หอมเข้มและหวานมัน','/menu/items/mocha.png',39.00,'drink','available',0,4),
('16000000-0000-4000-8000-000000000011','นม','นมสด','นมสดเย็นหอมมัน ดื่มได้ทุกวัย','/menu/items/fresh-milk.png',29.00,'drink','available',0,4),
('16000000-0000-4000-8000-000000000012','นม','นมสดคาราเมล','นมสดหอมมันผสมคาราเมลหวานหอม','/menu/items/caramel-milk.png',29.00,'drink','available',0,2),
('16000000-0000-4000-8000-000000000013','นม','นมสดน้ำผึ้ง','นมสดเติมความหอมหวานจากน้ำผึ้ง','/menu/items/honey-milk.png',29.00,'drink','available',0,3),
('16000000-0000-4000-8000-000000000014','นม','นมชมพู','นมสดกลิ่นสละ สีชมพูหวานหอม','/menu/items/pink-milk.png',29.00,'drink','available',0,1),
('16000000-0000-4000-8000-000000000015','โซดา','แดงโซดา','น้ำหวานแดงซ่าผสมโซดา เย็นสดชื่น','/menu/items/red-soda.png',19.00,'drink','available',0,1),
('16000000-0000-4000-8000-000000000016','โซดา','แดงมะนาวโซดา','น้ำแดงหอมหวานตัดด้วยมะนาวและโซดา','/menu/items/red-lemon-soda.png',29.00,'drink','available',0,2),
('16000000-0000-4000-8000-000000000017','โซดา','น้ำผึ้งมะนาวโซดา','น้ำผึ้งหอมหวาน มะนาวสด และโซดาซ่า','/menu/items/honey-lemon-soda.png',29.00,'drink','available',0,3),
('16000000-0000-4000-8000-000000000018','กาแฟและมัทฉะ','มัจฉะลาเต้','มัจฉะเข้มข้นผสมนมสด เนื้อเนียนหอม','/menu/items/matcha-latte.png',49.00,'drink','available',0,1)
ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, name = EXCLUDED.name, description = EXCLUDED.description, image_url = EXCLUDED.image_url, price = EXCLUDED.price, kind = EXCLUDED.kind, status = EXCLUDED.status, is_archived = EXCLUDED.is_archived, sort_order = EXCLUDED.sort_order;

INSERT INTO menu_option_groups (id, menu_id, name, sort_order)
SELECT CONCAT('16000000-0000-4000-9000-',LPAD(n::TEXT,12,'0')),m.id,'ขนาด',1
FROM menu_items m JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18) ids ON ids.n=CAST(RIGHT(m.id,2) AS INTEGER)
WHERE m.id BETWEEN '16000000-0000-4000-8000-000000000001' AND '16000000-0000-4000-8000-000000000018' ON CONFLICT DO NOTHING;

INSERT INTO menu_option_groups (id, menu_id, name, sort_order)
SELECT CONCAT('16000000-0000-4000-9100-',LPAD(n::TEXT,12,'0')),m.id,'ระดับความหวาน',2
FROM menu_items m JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18) ids ON ids.n=CAST(RIGHT(m.id,2) AS INTEGER)
WHERE m.id BETWEEN '16000000-0000-4000-8000-000000000001' AND '16000000-0000-4000-8000-000000000018' ON CONFLICT DO NOTHING;

INSERT INTO menu_options (id, group_id, menu_id, name, price_delta, is_enabled, sort_order)
SELECT CONCAT('16000000-0000-4000-9200-',LPAD(n::TEXT,12,'0')),g.id,g.menu_id,'22 oz',0.00,1,1
FROM menu_option_groups g JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18) ids ON ids.n=CAST(RIGHT(g.id,2) AS INTEGER)
WHERE g.id BETWEEN '16000000-0000-4000-9000-000000000001' AND '16000000-0000-4000-9000-000000000018' ON CONFLICT DO NOTHING;

INSERT INTO menu_options (id, group_id, menu_id, name, price_delta, is_enabled, sort_order)
SELECT CONCAT('16000000-0000-4000-9300-',LPAD(n::TEXT,12,'0')),g.id,g.menu_id,'32 oz',10.00,1,2
FROM menu_option_groups g JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18) ids ON ids.n=CAST(RIGHT(g.id,2) AS INTEGER)
WHERE g.id BETWEEN '16000000-0000-4000-9000-000000000001' AND '16000000-0000-4000-9000-000000000018' ON CONFLICT DO NOTHING;

INSERT INTO menu_options (id, group_id, menu_id, name, price_delta, is_enabled, sort_order)
SELECT CONCAT('16000000-0000-4000-9400-',LPAD(n::TEXT,12,'0')),g.id,g.menu_id,o.name,0.00,1,o.sort_order
FROM menu_option_groups g JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18) ids ON ids.n=CAST(RIGHT(g.id,2) AS INTEGER)
CROSS JOIN (SELECT 'หวานปกติ' name,1 sort_order UNION ALL SELECT 'หวานน้อย',2 UNION ALL SELECT 'ไม่หวาน',3) o
WHERE g.id BETWEEN '16000000-0000-4000-9100-000000000001' AND '16000000-0000-4000-9100-000000000018' ON CONFLICT DO NOTHING;
