# 05: ซ้อม MySQL migration และ integration จริง

**What to build:** หลักฐานว่า migration และ transaction behavior ของระบบทำงานบน MySQL จริงใน staging-like environment และพร้อมใช้เป็นฐานข้อมูล production

**Blocked by:** 01: เลือก hosting และ managed MySQL สำหรับ production; 04: เตรียม production และ staging runtime

**Status:** ready-for-agent

- [ ] รัน migration ทั้งหมดบน MySQL จริงและตรวจการ rerun ที่ควรปลอดภัย
- [ ] รัน MySQL integration tests โดยไม่ถือ skipped tests เป็น passed
- [ ] ตรวจ transaction rollback, constraints, uniqueness และ concurrent behavior ของ reservation/order/payment
- [ ] ตรวจ schema/data ที่จำเป็นต่อ queue, finance, notification และ audit
- [ ] บันทึกหลักฐานผลทดสอบและข้อจำกัดที่ยังต้องแก้ก่อน production

## Comments

- 2026-09-25: Local API connected successfully to MySQL database `paor` through the Tailscale database host. Read-only checks for health, public menu, shop status, and reservation availability returned 200.
- 2026-09-25: API suite passed 280 tests; 30 real-MySQL integration tests remain skipped because `TEST_DATABASE_URL` is not configured with an isolated test database. Production `DATABASE_URL` must not be reused for this ticket.
- 2026-09-25: `shop_tables` currently contains 0 rows on the connected database. Table fixtures/data must be provided before marking schema/data readiness complete.
