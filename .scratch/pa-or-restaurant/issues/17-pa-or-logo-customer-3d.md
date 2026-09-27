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
- 2026-09-26/27: Browser QA (Playwright + code-review skill, ไม่ได้ claim ticket ใหม่ — ทำใน branch
  `claude/ui-ux-3d-model-bugs-txer1d`, merged PR #29) พบและแก้บัค UI/UX และ 3D เพิ่มอีก 12 จุด
  ที่ไม่ปรากฏใน typecheck/build/unit test ของรอบก่อน ๆ:
  - 3D: `MenuShowcase3D` ตู้โชว์เมนูค้างที่ placeholder "ปอ" บน production จริง เพราะรูปจาก R2
    โหลดเป็น canvas texture แบบไม่ตั้ง `crossOrigin` → WebGL โยน `SecurityError: Tainted
    canvases...`; แก้ด้วย `image.crossOrigin = "anonymous"` และเปลี่ยน `side: THREE.DoubleSide`
    → `FrontSide` ให้ไม่เห็นด้านหลัง panel สลับกัน; เพิ่ม `IntersectionObserver` หยุด
    `requestAnimationFrame` ตอนตู้โชว์เลื่อนออกจอ
  - 3D: `VenueScene3D` pin ของโต๊ะใช้ NDC z (`projected.z`) จัดลำดับความลึก ทำให้โต๊ะไกลยุบ
    ค่าเดียวกัน และ z-index หลุดไปทับ reservation bar/dialog ที่ fixed อยู่บนหน้า — แก้เป็น
    `camera.position.distanceTo()` จัดลำดับจริง และเพิ่ม `isolation: isolate` กัน stacking
    หลุด layer
  - 3D: `venueScenery.ts` cache ของขาโต๊ะ/ฝาเหยือกใช้ key ที่ไม่รวม thickness/color ทำให้โต๊ะ
    บางแบบขโมย geometry/material ของอีกแบบ — แก้ cache key ให้รวมพารามิเตอร์ที่แปรผัน
  - UI: bug ซ้ำ 3 ไฟล์ — เขียน `import.meta` แบบ `(import.meta as ...)?.env` ทำให้ Vite ไม่แทนค่า
    ตอน build จึงอ่านได้ `undefined` เสมอ (demo-mode fallback ไม่ทำงานจริงตอน API ล่ม)
  - UI: ปุ่มเลื่อนตู้โชว์ (arrow) ล้นจอมือถือแคบ (320–375px); demo badge อ่านไม่ออก (ขาวบนเหลืองอ่อน)
  - เพิ่ม `apps/web/tests/venue-furniture.test.ts` และ `load-error-message.test.ts` ยืนยัน
    regression ด้วย `git stash` เทียบ pre-fix/post-fix; verification: typecheck ผ่าน,
    vitest 350 ผ่าน/1 ข้าม, build ผ่าน; ตรวจซ้ำด้วย browser screenshot จริงสำหรับบัคที่เห็นผลทาง
    ภาพเท่านั้น (tainted canvas, pin z-index, nav overflow)
  - บทเรียนสำหรับ ticket นี้: unit/typecheck เขียวไม่ครอบคลุมบัคกลุ่มนี้เลย — ทั้งหมดต้องเจอผ่าน
    browser QA จริงหรือจำลอง environment จริง (เช่น local HTTP server ไม่มี CORS header)
