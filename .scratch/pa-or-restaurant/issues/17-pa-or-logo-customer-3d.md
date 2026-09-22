# Ticket 17 — โลโก้ร้านป้าอ้อและ 3D สำหรับลูกค้า

Status: resolved
Blocked by: None
Assignee: Codex implementation fallback

## Scope

- นำโลโก้ร้านป้าอ้อที่สร้างจากภาพอ้างอิงมาใช้ใน public customer shell
- เพิ่ม fallback เป็นตัวอักษรเมื่อโหลดรูปไม่ได้ พร้อม alt text ที่เข้าถึงได้
- เพิ่ม depth/3D cue เฉพาะ customer-facing shell โดยไม่เพิ่มเอฟเฟกต์ให้ staff/admin
- เคารพ `prefers-reduced-motion` และไม่พึ่งพา hover เพื่อใช้งานฟังก์ชันหลัก

## Acceptance criteria

- โลโก้อยู่ที่ `apps/web/public/brand/pa-or-logo.png`
- header ลูกค้าแสดงโลโก้จริงและ fallback ได้
- customer shell มี depth cue ที่ responsive และ touch-safe
- typecheck/build/tests ผ่าน หรือบันทึกเหตุผลหาก environment block

## Verification

- ตรวจด้วย `npm run typecheck`, `npm run build`, `npm test` หลัง implementation

## Comments

- งานบริการภายนอกและ provider login ไม่อยู่ใน scope ตามนโยบายโปรเจกต์
- 2026-09-22: ปรับ customer storefront ต่อจาก Ticket 17 ให้เป็น luxury minimal: ลด visual clutter ของ hero และ feature section, ลดความแน่นของ mobile navigation/footer, เพิ่ม ambient/rim/fill lighting ให้ 3D showcase โดยไม่เปิด shadow map, แก้ formatter ราคาเป็น “บาท” และคง DOM fallback/accessibility/reduced-motion เดิม
- 2026-09-22 Verification: `npm run typecheck -w apps/web` ผ่าน, `npm run build -w apps/web` ผ่าน, `npm test -w apps/web` ผ่าน และ `git diff --check` ผ่าน; independent review โดย agy ไม่พบ Critical/High/Medium finding
