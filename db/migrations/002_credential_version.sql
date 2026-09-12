-- 002 credential/session version ป้องกัน reset/login race
-- รันซ้ำได้อย่างปลอดภัย (migration runner เพิกเฉย error 1060 = มีคอลัมน์แล้ว)
ALTER TABLE users ADD COLUMN password_version INT NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN password_version INT NOT NULL DEFAULT 1;
