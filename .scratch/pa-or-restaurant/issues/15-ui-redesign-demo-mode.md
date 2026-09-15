# 15: UI redesign ร้านป้าอ้อ + demo mode เมื่อ API ใช้ไม่ได้

**What to build:** สานงาน redesign ค้างใน working tree ให้จบ end-to-end โดยไม่ทิ้ง/เริ่มใหม่:
shell สาธารณะ + หน้า menu, cart, orders, reservations, rewards, notifications
(และ track/capacity ที่ใช้ข้อมูลเดียวกัน) เป็น Thai restaurant UI โทนแดง vibrant
(#DC2626/#F87171/#A16207/#FEF2F2/#450A0A, Playfair Display SC + Karla,
inline SVG icons ไม่ใช้ emoji, touch target ≥44px, focus มองเห็น, keyboard labels,
mobile-first, reduced motion) พร้อม demo fallback แบบ deterministic ทุกหน้าเมื่อ
API ใช้ไม่ได้: ป้ายไทย "โหมดสาธิต · ข้อมูลตัวอย่าง" + แถบเตือนแบบ non-blocking +
เนื้อหา mock สมจริง (loading/error/empty/success ครบ, accessible labels)

**Blocked by:** 01–14 (resolved ทั้งหมด)

**Status:** resolved

**Assignee:** executor (Muse Spark)

## Scope

อ้างอิง `.agents/skills/ui-ux-pro-max/SKILL.md` (priority 1/2/5: contrast/keyboard,
touch ≥44px + loading feedback, mobile-first) + `references/pro-rules.md`
(pre-delivery checklist) และ `.agents/skills/frontend-design/SKILL.md`
(design plan → review → build, restraint: จุดเด่นชิ้นเดียวคือ hero cocoa slab)

- Design system (ของเดิมใน tree — ไม่เปลี่ยนทิศทาง): `apps/web/index.html`
  (ฟอนต์ Karla + Playfair Display SC, lang="th", theme-color #450A0A),
  `apps/web/src/index.css` (tokens brand/gold/ink, .pa-hero, .pa-ticket-edge,
  focus-visible 3px, reduced-motion, skip link), `components/icons.tsx`
  (stroke SVG + FoodMotif, decorative aria-hidden), `components/shell.tsx`
  (PublicShell: แถบ cocoa + nav ไอคอนลูกค้า 7 เส้นทาง + footer),
  `components/demo.tsx` (DemoBadge role=status + ConnectionBanner non-blocking),
  `lib/demo.ts` (DEMO_MODE_LABEL verbatim + isOfflineError เฉพาะ network failure +
  mock menu/orders/reservations/rewards/redemptions/ledger/notifications/queue/capacity)
- Demo fallback ต่อหน้า (real API ก่อนเสมอ; mock เฉพาะ TypeError/network):
  MenuPublic, Cart (รวมข้อความยืนยันออฟไลน์), MyOrders (รวม Guest lookup
  เทียบ ORD-DEMO-*), Reservations (create/recommend/cancel อธิบายว่าต้องต่อเน็ต),
  Rewards (redeem/release/walkin/guest-link อธิบายว่าทำไม่ได้ในโหมดสาธิต),
  MyNotifications (toggle consent ปิดในโหมดสาธิต), QueueTrack, CapacityDashboard
- ไม่เปลี่ยน API contract: แตะเฉพาะ web + docs; ไม่ติดตั้ง package ใหม่
- Tests: `tests/demo-mode.test.tsx` (isOfflineError/unit + menu/rewards/
  notifications/shell a11y) + `tests/ui-redesign-demo-mode.test.tsx`
  (offline ทุกหน้า + HTTP 500 ไม่ถือว่าออฟไลน์ + nav/skip-link/ปุ่มมีชื่อ)
  และซ่อม regression จาก redesign: `app.test.tsx` ("/" เป็นเมนูสาธารณะแล้ว
  login test เข้าทาง "/login"), `menu-public.test.tsx`
  (ปุ่มลองใหม่ชื่อ "ลองโหลดเมนูอีกครั้ง")

ไม่รวม (deferred): browser E2E จริง (Playwright/Taste — ไม่มี reference URL),
MySQL/Docker runtime จริง, LINE/payment provider จริง, code-split chunk 500kB
warning ของ vite (มีมาก่อน)

## Acceptance criteria

- [x] ทุกหน้าสาธารณะออฟไลน์แสดงข้อมูลตัวอย่าง + ป้าย "โหมดสาธิต · ข้อมูลตัวอย่าง"
      + แถบเชื่อมต่อ non-blocking พร้อมปุ่มลองใหม่มีชื่อเข้าถึงได้
- [x] HTTP error (เช่น 500) ไม่ตกเป็น demo — แสดง error จริง + ปุ่มลองใหม่
- [x] loading/error/empty/success + visible labels ครบทุกหน้า; touch ≥44px;
      focus-visible; reduced motion; ไม่มี emoji เป็นไอคอน
- [x] Web tests เต็ม 203/203 (36 files), typecheck ผ่าน, vite build ผ่าน
- [x] ไม่แตะ/ไม่ commit ไฟล์ต้องห้าม; commit ข้อความตรงตามสั่ง

## Comments

### 2026-09-15 — ตรวจรับและปิด Ticket 15 (resolved)

- ผลตรวจจริง (apps/web):
  - `npm.cmd run test` → Test Files 36 passed, Tests 203 passed
    (เดิม 190 + ใหม่ 13: demo-mode 5 + ui-redesign-demo-mode 8)
  - `npm.cmd run typecheck` (tsc --noEmit) → exit 0
  - `npm.cmd run build` (tsc + vite) → สำเร็จ, 75+ modules
    (chunk >500kB warning เดิม — ไม่เกี่ยวกับงานนี้)
- ซ่อม regression ที่ redesign ทำให้เกิด 2 จุด (ดู Scope); Tickets 01–14
  ไม่ regression (full web suite ข้างบน)
- ไฟล์ต้องห้ามไม่แตะ/ไม่ commit: `apps/api/package.json`,
  `package-lock.json`, `apps/api/.gitignore`, `apps/api/generated/`,
  `apps/api/prisma.config.ts`, `apps/api/prisma/`, `apps/api/src/db/`,
  `experiments/`, `__pycache__`
