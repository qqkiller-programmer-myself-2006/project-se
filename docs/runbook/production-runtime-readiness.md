# Runbook: staging/production runtime readiness (Ticket 04)

ขอบเขตคือ readiness ที่ตรวจได้จาก repo และ checklist สำหรับ DigitalOcean App Platform +
DigitalOcean Managed MySQL ตามคำแนะนำ Ticket 01. เอกสารนี้ไม่สร้าง deployment resource,
ไม่กำหนด domain จริง และไม่ใส่ secret.

## 1. Environment boundaries

| Environment | App/API | Database | Required separation |
|---|---|---|---|
| development | local process/compose | local MySQL | local credentials/callback only |
| staging | App Platform staging environment | Managed MySQL staging cluster/database | separate project access, secrets, DNS and LINE/payment channels |
| production | App Platform production environment | Managed MySQL production cluster/database | production-only access, secrets, DNS and LINE/payment channels |

Production must remain MySQL-only. `createStoreFromEnv` fails when `DATABASE_URL` is absent;
there is no memory fallback for real orders. Do not introduce a deployment file that cannot be
validated against the Owner's actual App Platform account, region, domains and secrets.

## 2. Required configuration gates

- `DATABASE_URL` must point to the environment's MySQL instance; never copy it between staging
  and production.
- `COOKIE_SECURE=true` and the platform's trusted proxy configuration are required behind HTTPS.
- `CUSTOMER_UI_URL`, `LINE_REDIRECT_URI`, payment keys and webhook secrets must match the same
  environment and be stored in the platform secret configuration.
- App Platform health probes should use `/api/health` for liveness and `/api/ready` for the
  database-backed readiness probe; a non-ready database must produce HTTP 503.
- `/api/metrics/summary` is Owner-only. It must not be exposed as a public probe.

## 3. Existing repo-side checks

The current API already provides:

- `GET /api/health`: public liveness with version and uptime;
- `GET /api/ready`: public readiness that checks the database and returns 503 on failure;
- `GET /api/metrics/summary`: Owner-only version, uptime, migration count and owner count;
- `x-request-id` on every response, stable error `code` taxonomy and redacted logging helpers.

Use `docs/OBSERVABILITY.md` and `docs/SECURITY.md` as the behavior contract. Health/readiness
responses and metrics must not contain PII, LINE subject, token, secret or session identifier.

## 4. Release verification sequence

Run this sequence on staging after the Owner supplies real access and before production:

1. Confirm App Platform staging service, Managed MySQL staging instance, region, DNS and access
   boundaries; record the operator and timestamp.
2. Confirm secrets are present without printing them. Confirm production secrets are inaccessible
   to staging operators and vice versa.
3. Run migration rehearsal and backup/restore rehearsal on staging only. Production schema rollback
   is restore-from-backup because migrations have no down-migration.
4. Check `/api/health` = 200, `/api/ready` = 200, Owner login, then Owner-only metrics.
5. Exercise failure behavior: unavailable DB => `/api/ready` 503; external dependency degraded
   => business fallback/error state without pretending the transaction succeeded.
6. Record App Platform deploy revision and prove application rollback. Do not call a schema restore
   a successful rollback until restore verification, readiness and Owner login pass.

## 5. Owner blockers (must remain explicit)

No production runtime acceptance can be claimed until the Owner provides/approves:

- DigitalOcean account ownership, billing method and monthly budget;
- App Platform and Managed MySQL availability in the selected region;
- production and staging domains, DNS control, TLS/certificate ownership and callback allowlists;
- environment-specific database credentials, LINE/payment/webhook secrets through secret storage;
- named Owner/Admin/operator accounts and separation of provider billing, deployment and application
  access;
- backup retention/restore approval, alert contact outside the system, and rollback authority.

These are external gates, not values to invent in this repository.
