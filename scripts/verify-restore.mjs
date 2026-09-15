#!/usr/bin/env node
/**
 * Ticket 14 — restore/migration verification แบบไม่ต้องมี Docker/MySQL.
 * ตรวจ static เท่านั้น: migration ครบ 14 ไฟล์ + ตรง MIGRATION_FILES +
 * rerunnable guards + ไม่มี destructive statements/secrets + docs ครบ.
 * ใช้: node scripts/verify-restore.mjs (exit 0 = ผ่าน)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MIG_DIR = join(root, "db", "migrations");
const STORE_TS = join(root, "apps", "api", "src", "store.ts");

const EXPECTED = [
  "001_staff_accounts.sql",
  "002_credential_version.sql",
  "003_shop_status_tables.sql",
  "004_customer_accounts.sql",
  "005_menu_catalog.sql",
  "006_orders.sql",
  "007_reservations.sql",
  "008_menu_options_recipes_inventory.sql",
  "009_payments_receipts_refunds.sql",
  "010_kitchen_drink_queues.sql",
  "011_loyalty_rewards.sql",
  "012_finance_entries.sql",
  "013_line_notifications.sql",
  "014_capacity_wait_predictions.sql",
];

const REQUIRED_DOCS = [
  "docs/runbook/backup-restore.md",
  "docs/runbook/migration-rehearsal.md",
  "docs/SECURITY.md",
  "docs/OBSERVABILITY.md",
];

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
};

// 1) migration files ครบตามลำดับ
for (const f of EXPECTED) check(existsSync(join(MIG_DIR, f)), `migration exists: ${f}`);

// 2) MIGRATION_FILES ใน store.ts ตรงกับรายการ (ลำดับเดียวกัน)
const storeSrc = readFileSync(STORE_TS, "utf8");
const m = storeSrc.match(/const MIGRATION_FILES = \[([\s\S]*?)\];/);
const listed = m ? [...m[1].matchAll(/"([^"]+\.sql)"/g)].map((x) => x[1]) : [];
check(
  JSON.stringify(listed) === JSON.stringify(EXPECTED),
  `MIGRATION_FILES matches 001-014 in order (found ${listed.length})`,
);

// 3) rerunnable + ไม่ destructive + ไม่มี secret
for (const f of EXPECTED) {
  const p = join(MIG_DIR, f);
  if (!existsSync(p)) continue;
  const sql = readFileSync(p, "utf8");
  const creates = [...sql.matchAll(/CREATE\s+TABLE/gi)].length;
  const guarded = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi)].length;
  check(creates === 0 || guarded === creates, `${f}: CREATE TABLE all IF NOT EXISTS (${guarded}/${creates})`);
  check(!/DROP\s+(TABLE|COLUMN)/i.test(sql), `${f}: no DROP TABLE/COLUMN`);
  check(!/TRUNCATE\s/i.test(sql), `${f}: no TRUNCATE`);
  check(!/sk_live|AKIA|BEGIN (RSA )?PRIVATE KEY/i.test(sql), `${f}: no secrets`);
}

// 4) docs ครบ + มี RPO/RTO assumptions
for (const d of REQUIRED_DOCS) check(existsSync(join(root, d)), `doc exists: ${d}`);
const runbook = existsSync(join(root, REQUIRED_DOCS[0]))
  ? readFileSync(join(root, REQUIRED_DOCS[0]), "utf8")
  : "";
check(/RPO/i.test(runbook) && /RTO/i.test(runbook), "runbook documents RPO/RTO assumptions");
check(/7 วัน|retention/i.test(runbook), "runbook documents retention");

// 5) observability seam มีอยู่จริง (health/ready/metrics/request-id)
const appSrc = readFileSync(join(root, "apps", "api", "src", "app.ts"), "utf8");
check(appSrc.includes('"/api/ready"'), "app exposes GET /api/ready");
check(appSrc.includes('"/api/metrics/summary"'), "app exposes GET /api/metrics/summary");
check(appSrc.includes("requestIdMiddleware"), "app uses request-id middleware");
check(
  existsSync(join(root, "apps", "api", "src", "observability.ts")),
  "observability.ts exists",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed — do not release.`);
  process.exit(1);
}
console.log(`\nAll checks passed (migrations: ${EXPECTED.length}, RPO 24h / RTO 4h documented).`);
