# 01: เลือก hosting และ managed MySQL สำหรับ production

**What to build:** ข้อสรุปผู้ให้บริการและรูปแบบ deployment สำหรับ Web, API และ MySQL production/staging ที่เหมาะกับร้าน พร้อมหลักฐานเรื่อง HTTPS, secret management, backup, restore, logs, readiness, ราคา และ lock-in

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] เปรียบเทียบตัวเลือก hosting สำหรับ Web และ API ที่รองรับ staging/production, HTTPS, environment secrets, logs และ rollback
- [x] เปรียบเทียบ managed MySQL ที่รองรับ migration, automated backup, restore verification และการแยก staging/production
- [x] ตรวจข้อจำกัดด้านราคาและความเหมาะสมกับร้านขนาดเล็ก โดยไม่ใช้ free tier เป็นฐาน production
- [x] เลือกชุดบริการที่แนะนำหนึ่งชุด พร้อมตัวเลือกสำรองและเหตุผลด้านราคา ความเสถียร การกู้คืน และ lock-in
- [x] ระบุ environment variables, access boundaries และข้อมูลที่ต้องได้รับจาก Owner ก่อนเริ่ม setup
- [x] บันทึกคำตอบในหัวข้อ `## Answer` และสรุป decision ที่ map

## Answer

> วันที่ตรวจแหล่งข้อมูลผู้ให้บริการ: 2026-09-18 (ทุก URL ด้านล่างเปิดอ่านจริงวันเดียวกัน).
> วิธีทำ: อ่าน codebase/config แบบ read-only + เอกสารทางการของผู้ให้บริการเท่านั้น
> (primary sources) ไม่ใช้บทความรีวิวเป็นหลักฐานหลัก ยกเว้นระบุไว้ชัดว่าไม่ใช่ทางการ
> ราคาเป็น "ราคาที่เห็นบนหน้าทางการ ณ วันตรวจ" อาจเปลี่ยนได้ — ต้องยืนยันอีกครั้งตอนเปิดบิล

### 1. สิ่งที่โค้ดและ config ปัจจุบัน "สันนิษฐานจริง" (facts จาก repo, ไม่ได้อ้างสิ่งที่ไม่มี)

| เรื่อง | สิ่งที่พบจริง | หลักฐานใน repo |
|---|---|---|
| Runtime API | Node 22 (Alpine), Express, stateless, ฟังพอร์ตจาก `API_PORT` (default 4000) | `apps/api/Dockerfile`, `apps/api/src/index.ts:22` |
| Database | **MySQL จริงเท่านั้น** ไม่มี memory fallback — ไม่มี `DATABASE_URL` คือบูตไม่ขึ้น | `apps/api/src/store.ts:13451-13454`, `.env.example:16`, `docker-compose.yml` (image `mysql:8.4`) |
| Migrations | additive + rerunnable เท่านั้น (ไม่มี `DROP/TRUNCATE`), runner ทน error 1060, **ไม่มี down-migration** → rollback ของ schema = restore dump ก่อน deploy | `docs/runbook/migration-rehearsal.md` ข้อ 2 และ 4, `apps/api/src/store.ts:6775-6776` (`MIGRATIONS_DIR`) |
| Backup/restore ในโค้ด | **ยังไม่มี** job อัตโนมัติหรือปุ่ม Owner ดาวน์โหลด backup — เป็น operator-executed ผ่าน shell จนกว่าจะมี ticket backup automation | `docs/runbook/backup-restore.md` (หัวข้อ "หมายเหตุซื่อสัตย์") |
| Health/readiness | `GET /api/health` (public liveness), `GET /api/ready` (public, 503 เมื่อ DB ไม่พร้อม), `GET /api/metrics/summary` (**Owner เท่านั้น**) | `docs/OBSERVABILITY.md` ข้อ 2 |
| Observability | request ID ผ่าน `x-request-id` ทุก response, error `code` คงที่ 8 ค่า, ห้าม log PII/token/secret (mask เบอร์ `08******78`), **ไม่มี APM ภายนอก** — ต้องพึ่ง log forwarding ของ platform | `apps/api/src/observability.ts`, `docs/OBSERVABILITY.md`, `docs/SECURITY.md` ข้อ 3–4 |
| Secrets | ทุก secret มาจาก env เท่านั้น (`DB_PASSWORD`/`DB_ROOT_PASSWORD` ไม่มีค่าเริ่มต้น — compose fail ถ้าไม่ตั้ง), ไม่ hardcode secret ใน `src`, ไม่พิมพ์ secret ลง log | `.env.example`, `docker-compose.yml:7-10`, `docs/SECURITY.md` ข้อ 3 |
| Reverse proxy | `TRUST_PROXY` default `false`; ตั้ง `TRUSTED_PROXY` เฉพาะเมื่ออยู่หลัง proxy ที่ไว้ใจได้, `COOKIE_SECURE=true` เมื่อเป็น HTTPS | `apps/api/src/index.ts:12-20`, `apps/api/src/app.ts:154-166`, `.env.example:23-28` |
| LINE | callback ต้องตรง `LINE_REDIRECT_URI` ทุกตัวอักษร (production ต้อง HTTPS + allowlist), ไม่ตั้งค่า = 503 fail-fast | `.env.example:31-48`, `apps/api/src/line/real.ts:40-46` |
| Web | Vite static build; dev proxy `/api` ไป `:4000`; production ต้องเสิร์ฟ static + เรียก API ผ่าน origin เดียวกันหรือ `CUSTOMER_UI_URL` | `apps/web/package.json`, `.env.example:42-43` |
| Env vars ที่ต้องมีต่อ environment | `NODE_ENV, API_PORT, DATABASE_URL (+ DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_ROOT_PASSWORD), COOKIE_SECURE, TRUSTED_PROXY, LOGIN_RATE_MAX, CUSTOMER_RATE_MAX, LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_REDIRECT_URI, LINE_CHANNEL_ACCESS_TOKEN, CUSTOMER_UI_URL, TEST_DATABASE_URL (แยก, ห้ามใช้ของ production)` (+ `PAOR_PAYMENT_FAKE`, `MENU_SEED_ALLOW_PRODUCTION`, `BOOTSTRAP_*` ใช้เฉพาะตอน setup) | `.env.example`, `apps/api/src/payments/provider.ts:11`, `apps/api/src/seedMenu.ts:369` |

**Caveat (พบระหว่างตรวจ, ไม่บล็อกการเลือก hosting):** จำนวน migration ไม่ตรงกันระหว่างเอกสาร —
`docs/OBSERVABILITY.md` เขียน `migrationCount: 14`, `apps/api/src/observability.ts:20`
เขียน `RELEASE_MIGRATION_COUNT = 16`, `docs/runbook/migration-rehearsal.md` ลิสต์ไฟล์
001–015 (15 ไฟล์) และใน working tree มีไฟล์ `db/migrations/016_*` ที่ยังไม่ถูก track —
ต้อง reconcile ใน Ticket 05 (mysql-migration-rehearsal) / Ticket 08 (backup-restore-rollback)
ก่อน rehearsal จริง ไม่กระทบการตัดสินใจข้อนี้

### 2. ตัวเลือกที่มีหลักฐาน (evidence only — ไม่เติมสิ่งที่หาไม่เจอ)

#### 2.1 Hosting สำหรับ Web + API

| เกณฑ์ (spec) | A. DigitalOcean App Platform | B. Railway | C. Render |
|---|---|---|---|
| Staging/production แยก | มี — staging/production/preview environments ในตัว | มี — persistent environments แยก config/variables (staging แยก production ชัดเจน) + PR environments | มี — preview environments (Hobby จำกัด 2 environments/project; Pro ไม่จำกัด) |
| HTTPS | อัตโนมัติ (automatic HTTPS + custom domain + CDN) | อัตโนมัติ (TLS อัตโนมัติทั้ง domain ที่ Railway ให้และ custom domain ผ่าน Let's Encrypt) | ฟรี managed TLS ทุก web service + custom domain |
| Secrets | env vars ต่อ component/environment (สอดคล้อง `.env.example` ของเรา) | service variables ต่อ service/environment + sealed variables (ไม่ถูก copy ข้าม environment) | env vars + secret files ต่อ service |
| Logs/metrics | application metrics + log forwarding ไป Datadog/Papertrail/OpenSearch; alerts/monitoring ในตัว | metrics ต่อ service (CPU/mem/net), log history ตามแผน (Hobby 7 วัน / Pro 30 วัน) | logs + metrics ตามแผน workspace |
| Deploy history/rollback | rollback ไป deployment ก่อนหน้าได้สูงสุด ~10 revisions (ปุ่ม + API) | เก็บ image หลัง deploy ถูกลบไว้ระยะหนึ่งเพื่อ rollback (redeploy) | instant rollbacks + zero-downtime deploys + pre-deploy command |
| Health check | ตั้ง health check path ได้ (map กับ `/api/health`, `/api/ready` ของเรา) | ตั้ง healthcheck endpoints ได้ | ตั้ง health check path ได้ |
| ราคาฐาน production (ไม่ใช้ free tier) | web service เริ่มต้น ~$5/ด./container, static site มี tier ฟรี (ไม่นับเป็นฐาน production) | Hobby $5/ด. / Pro $20/ด. (ขั้นต่ำ, รวมเครดิตใช้ทรัพยากร) + คิดตามใช้จริง (RAM ~$10/GB/ด., CPU ~$20/vCPU/ด., volume ~$0.15/GB/ด., egress $0.05/GB) | Hobby $0 + compute / Pro $25 + compute; web Starter ~$7/ด. |
| Reliability | HA/autoscaling ในแผนจ่ายเงิน, dedicated egress IP, OS patching อัตโนมัติ | เป้า availability Hobby 99.9% / Pro 99.99% (ตามหน้าทางการ) | uptime SLA ตามแผน (Scale/Enterprise) |

#### 2.2 Managed MySQL

| เกณฑ์ (spec) | D. DigitalOcean Managed MySQL | E. PlanetScale (Vitess, MySQL-compatible) | F. Railway database + volume backups |
|---|---|---|---|
| Backup อัตโนมัติ | **รายวันรวมในแผน ฟรี** (daily backups) | อัตโนมัติทุก 12 ชม. ใน Base plan | ตั้ง schedule ได้ (Daily เก็บ 6 วัน / Weekly เก็บ 1 เดือน / Monthly เก็บ 3 เดือน) + manual backup |
| PITR / restore | PITR มีในแผน tier สูง (7-day window); restore ผ่าน dashboard/API; daily backup ครอบคลุม RPO 24 ชม. ในทุกระดับ | restore backup ไป branch ใหม่; backup schedule เพิ่มเติม $0.023/GB/ด. | restore ได้**เฉพาะใน project + environment เดียวกัน**; **wipe volume = ลบ backups ทั้งหมด** |
| แยก staging/production | ได้ — สร้าง cluster แยก (หรือ fork) ต่อ environment | ได้ — production/development branches แยก cluster กัน (คิดเงินแยก) | ได้ — environment แยก แต่ต้องผูก database แยกเอง (preview อาจชี้ DB เดียวกันถ้าไม่ตั้ง) |
| Encryption/HA | SSL end-to-end, standby node + failover อัตโนมัติ (HA เริ่ม ~$30/ด. + standby) | HA 3 AZ (1 primary + 2 replicas), audit log 6 เดือน, private connections | TLS ภายในแพลตฟอร์ม; ไม่มี managed-DB SLA แบบข้อ D/E — ต้องรับผิดชอบ backup/verify เอง |
| ราคาเริ่ม | single node ~$15/ด. (1 GiB RAM), storage เพิ่ม ~$0.21/GB/ด. | Base plan: storage 10 GB แรกต่อ instance แล้ว $0.50/GB/instance; production HA = 3 instances | ตามเรต volume/compute ของ Railway (ไม่มีค่า DB แยก) |
| ข้อควรระวัง | MySQL 8.0 จะถูกบังคับ upgrade เป็น 8.4 เริ่ม 30 ต.ค. 2026 (ต้องวางแผนช่วง maintenance) | เป็น Vitess (MySQL-compatible) ไม่ใช่ MySQL ตรง ๆ — ต้องเทสต์ migration/SQL ของเรากับ Vitess ก่อน (เช่น `GET_LOCK`, named lock ใน Ticket 06) | **ไม่เทียบเท่า managed DB** เต็มรูป — ทีมต้องทำ mysqldump ออกนอกระบบ + ซ้อม restore เอง |

**ตัดออกพร้อมเหตุผล:** Render เป็น hosting-only สำหรับงานนี้ — Render มี managed **Postgres** เท่านั้น
(MySQL ต้องรันเองบน persistent disk) จึงไม่เป็น "bundle เดียวจบ" สำหรับ MySQL runtime ที่ spec บังคับ

### 3. คำแนะนำ (recommendation — แยกจาก facts ข้างบน)

**ชุดที่แนะนำ: A + D — DigitalOcean App Platform (Web static + API service) + DigitalOcean
Managed MySQL (vendor เดียว)**

- ราคา (ประมาณ, paid เท่านั้น): API service ~$5/ด. + Web ~$5/ด. (หรือ static hosting) +
  MySQL prod ~$15/ด. + MySQL staging ~$15/ด. + staging compute รวม ~$10/ด. → **ราว $45–60/ด.
  สำหรับ prod + staging** (ไม่รวม bandwidth/egress ส่วนเกิน) — เหมาะกับร้านเดียว
- ความเสถียร: vendor เดียว, private networking ระหว่าง app กับ DB, failover อัตโนมัติ,
  OS patching + alerts/monitoring ในตัว; ทีมเล็กไม่ต้องดูแล OS/MySQL เอง
- การกู้คืน (ตรง RPO 24 ชม. / RTO 4 ชม.): daily backup ในตัว (RPO ≤ 24 ชม.) + ทำ manual dump
  ก่อนทุก deploy/migration ตาม runbook (RPO แน่นขึ้นช่วง release) + restore ซ้อมลง staging
  ก่อน (ใช้เวลาน้อยกว่า 30 นาทีตาม runbook → อยู่ใน RTO 4 ชม. สบาย); อยากได้ PITR ค่อยขยับ
  tier ภายหลังโดยไม่ย้าย vendor
- Lock-in: ต่ำ–ปานกลาง — App spec + Dockerfile ปกติย้ายออกได้, MySQL มาตรฐานย้ายด้วย
  mysqldump ได้ (ผูกเฉพาะความสะดวกของ managed backup/monitoring ไม่ใช่ format)
- ครบ spec: staging แยก ✓ HTTPS อัตโนมัติ ✓ secrets ต่อ environment ✓ logs/metrics +
  forwarding ✓ `/api/ready` ใช้เป็น health probe ได้ ✓ rollback ≤10 revisions ✓ backup ก่อน
  deploy (manual dump ตาม runbook) ✓ restore rehearsal บน staging ✓

**ชุดสำรอง: B + E — Railway (Web + API) + PlanetScale MySQL**

- ราคา (ประมาณ): Railway Pro $20/ด. ขั้นต่ำ + usage (ร้านเดียว-containers เล็กน่าจะจบ
  ~$20–35/ด.) + PlanetScale ตาม storage/compute (เริ่มต้นหลักสิบ $/ด.) → รวมใกล้เคียงหรือ
 สูงกว่าชุดหลักเล็กน้อย
- จุดแข็ง: environments/PR previews ดีที่สุดในสามตัว (staging อัตโนมัติต่อ branch),
  sealed variables กัน secret รั่วข้าม env, deploy เร็ว เหมาะกับช่วงที่ต้อง rehearsal บ่อย
- จุดอ่อนที่ต้องยอมรับ: (1) PlanetScale เป็น Vitess — **ต้องผ่าน Ticket 05 ก่อน** ว่าพิสูจน์
  `GET_LOCK`/named lock/transactions ของระบบผ่านบน Vitess จริง (ถ้าไม่ผ่าน ชุดสำรองนี้ตกไป
  เหลือ Railway + DO Managed MySQL แทน); (2) แยก vendor app/DB = ดูแล 2 บิล + network ข้าม
  provider; (3) backup restore ข้าม project ไม่ได้ฝั่ง Railway (จึงเลือก PlanetScale เป็น DB
  แทน DB ของ Railway เอง)
- ไม่เลือก Railway database (F) เป็น DB หลักของร้าน: ข้อจำกัด "restore ได้เฉพาะ
  project+environment เดียวกัน" และ "wipe ลบ backups ทั้งหมด" เสี่ยงเกินสำหรับ RTO/RPO
  ของเงินจริง — ใช้ได้เฉพาะ staging ชั่วคราว

### 4. สิ่งที่ต้องได้จาก Owner / ต้องตัดสินใจก่อน setup (ห้ามใส่ secret จริงใน ticket/repo)

1. Domain + DNS: ชื่อ domain ร้าน (prod + staging เช่น `shop.example.com`, `staging.example.com`),
   สิทธิ์แก้ DNS (CNAME/TXT), ผู้ถือ registrar
2. บัญชี provider + billing: เปิดบัญชี DigitalOcean (ชุดหลัก) + วิธีจ่ายเงิน, วงเงิน/งบต่อเดือนที่รับได้
3. Region: ยืนยัน region ตอน setup (เช่น Singapore — ใกล้ไทยสุด, ต้องเช็กว่า App Platform +
   Managed MySQL มีของครบ ณ วัน setup)
4. DB sizing: เริ่ม single node 1 GiB (~$15/ด.) ต่อ environment; เกณฑ์ขยับเป็น HA
   (เมื่อ pilot ผ่าน/เปิดเต็ม) Owner อนุมัติ
5. Roles/credentials: รายชื่อผู้มีสิทธิ์ Owner/Admin ของระบบ + แยกกับสิทธิ์ provider
   (ใครเข้าหน้า billing/dashboard ได้บ้าง); bootstrap Owner ทำแยก ไม่ผ่าน provider
6. Env vars ต่อ environment: `DATABASE_URL`/DB secrets แยก prod/staging (provider สร้างให้),
   `COOKIE_SECURE=true` + `TRUSTED_PROXY` ตาม proxy ของ platform, `CUSTOMER_UI_URL` ตรง
   domain จริง, callback LINE ตรง `LINE_REDIRECT_URI` (HTTPS)
7. LINE inputs (Ticket 03): channel/dev tester แยก prod/staging, Official Account ที่ผูกกัน
8. Omise/SlipOK inputs (Ticket 02/06): API keys แยก prod/sandbox, webhook secret, โควตา SlipOK,
   บัญชีรับเงิน — เข้า provider เป็น secret ห้ามผ่าน chat/repo
9. Alert contact: ช่องทางนอกระบบถึง Owner (โทร/LINE ส่วนตัว) สำหรับ backup ล้มเหลว + incident
10. Retention/privacy: ยืนยัน retention backup 7 วัน + รายสัปดาห์ 4 ชุด (ตาม runbook) และ
    anonymization/retention policy ของ PII (Ticket 10)
11. Approval boundaries: Owner อนุมัติ (ก) เปิด provider + ค่าใช้จ่ายรายเดือน (ข) เปิด production
    (ค) จบ soft launch; ห้าม deploy prod ถ้าไม่มี dump ผ่าน R1 (ตาม runbook)

### 5. แหล่งข้อมูล (เปิดอ่าน 2026-09-18)

- App Platform (features/HTTPS/rollback/logs/pricing): https://www.digitalocean.com/products/app-platform ,
  https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments ,
  http://www.digitalocean.com/pricing
- Managed Databases/MySQL (daily backup+PITR/SSL/HA/pricing/8.0→8.4 forced upgrade):
  https://docs.digitalocean.com/products/databases ,
  https://docs.digitalocean.com/products/databases/mysql/details/pricing ,
  https://www.digitalocean.com/pricing/managed-databases
- Railway (plans/pricing, volume backups, environments, domains/TLS, variables/secrets):
  https://docs.railway.com/pricing , https://docs.railway.com/pricing/plans ,
  https://docs.railway.com/reference/backups , https://docs.railway.com/environments ,
  https://docs.railway.com/networking/domains/working-with-domains , https://docs.railway.com/variables
- Render (workspace plans/compute pricing, web services/TLS/rollback, no managed MySQL):
  https://render.com/pricing , https://render.com/docs/web-services , https://render.com/docs/faq
- PlanetScale (plans, Vitess backups, storage billing): https://planetscale.com/pricing ,
  https://planetscale.com/docs/planetscale-plans , https://planetscale.com/docs/vitess/backups
- MySQL hosting price comparison (ใช้ประกอบ, ไม่ใช่แหล่งหลัก):
  https://www.bytebase.com/blog/mysql-hosting-options-pricing-comparison (2026-07-12)

### 6. Acceptance checklist (ติ๊ก passed เฉพาะข้อที่มีหลักฐานข้างบนรองรับ)

- [x] (passed) เปรียบเทียบ hosting Web/API ครบ staging/prod, HTTPS, secrets, logs, rollback — ตาราง 2.1
- [x] (passed) เปรียบเทียบ managed MySQL ครบ migration/backup/restore/แยก env — ตาราง 2.2
      (migration ใช้ของ repo เอง — additive rerunnable — รันบน MySQL มาตรฐานได้ทั้ง A/D/B
      ส่วน E/Vitess ติดเงื่อนไขต้องเทสต์ใน Ticket 05)
- [x] (passed) ราคาฐาน production ไม่ใช้ free tier — ทุกชุดคิดจากแผนจ่ายเงิน
- [x] (passed) ชุดแนะนำ 1 + สำรอง 1 พร้อมเหตุผลราคา/เสถียรภาพ/กู้คืน/lock-in เทียบ
      RPO 24 ชม./RTO 4 ชม./staging/backup-ก่อน-deploy/restore rehearsal/HTTPS/secrets/logs/readiness/rollback — ข้อ 3
- [x] (passed) env vars/access boundaries/inputs จาก Owner ครบ ไม่มี secret จริง — ข้อ 1 และ 4
- [x] (passed) แหล่งข้อมูลพร้อมวันที่ตรวจทุกข้อ — ข้อ 5

### 7. หมายเหตุเรื่อง map

- ตรวจแล้ว **ไม่มีไฟล์ map** (`.scratch/production-readiness/map.md` ไม่มี — ในโฟลเดอร์มีแค่
  `spec.md` กับ `issues/`) จึง**ไม่ได้แตะ/สร้าง map หรือไฟล์อื่นใด** ตามกฎ issue-tracker
  (เพิ่ม pointer ได้เฉพาะเมื่อ map มีอยู่จริง) — เมื่อมี map ค่อยมาเพิ่ม pointer
  `01-hosting-managed-mysql.md` ที่ Decisions

### 8. Blockers ที่เหลือ (ของงานถัดไป ไม่ใช่ของ ticket นี้)

1. Owner อนุมัติงบ (~$45–60/ด.) + เปิดบัญชี/region (ดูข้อ 4)
2. Vitess compatibility (ถ้าจะใช้ชุดสำรอง) — ยกให้ Ticket 05
3. Reconcile จำนวน migration (14/15/16) — ยกให้ Ticket 05/08
4. Backup automation + restore rehearsal จริง — Ticket 08; release E2E — Ticket 09
