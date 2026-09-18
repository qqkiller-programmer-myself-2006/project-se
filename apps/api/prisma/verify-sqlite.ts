/**
 * verify-sqlite.ts — Task D empirical exercise of the SQLite path.
 *
 * Standalone (imports the generated sqlite client DIRECTLY, not through
 * src/db/prismaClient.ts, to keep this check independent). Throwaway:
 * safe to delete at any time; the dev.db file itself is gitignored.
 *
 * Run from apps/api/ (DATABASE_URL inline only — never commit it anywhere):
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx prisma/verify-sqlite.ts
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma-sqlite/client.js";

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
console.log(`[verify] connecting to ${url}`);
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

// bigint-safe printer: naive JSON.stringify throws on native bigint.
const safe = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, val) => (typeof val === "bigint" ? `${val.toString()} (bigint)` : val),
    2,
  );

// Clean slate for re-runnability.
await prisma.shopSchedule.deleteMany();
await prisma.auditLog.deleteMany();

// 1. ShopSchedule: Json `intervals` + Boolean `closed`.
await prisma.shopSchedule.create({
  data: {
    weekday: 1,
    closed: false,
    intervals: [
      { open: "08:00", close: "14:00" },
      { open: "17:00", close: "21:00" },
    ],
  },
});
const sched = await prisma.shopSchedule.findUniqueOrThrow({ where: { weekday: 1 } });
console.log("[verify] shopSchedule read-back:", safe(sched));
console.log(
  `[verify] intervals typeof=${typeof sched.intervals} isArray=${Array.isArray(sched.intervals)} ` +
    `(expect object/true => real JS array, not a raw string); ` +
    `closed typeof=${typeof sched.closed} value=${sched.closed}`,
);

// 2. AuditLog: BigInt PK + Boolean `success`. (Chosen over User because it
// exercises the BigInt PK path.) KNOWN DIVERGENCE: `db push` renders this as
// "id" BIGINT NOT NULL PRIMARY KEY (no AUTOINCREMENT, declared type BIGINT
// rather than INTEGER so SQLite rowid-alias auto-assignment does NOT apply).
// Inserting WITHOUT an explicit id therefore fails on sqlite while it works
// on MySQL — demonstrate that first, then insert with an explicit id.
try {
  await prisma.auditLog.create({
    data: { action: "verify-sqlite-no-id", success: true },
  });
  console.log("[verify] create WITHOUT explicit id: unexpectedly OK");
} catch (err) {
  console.log(
    `[verify] create WITHOUT explicit id FAILS as documented: code=${(err as { code?: string }).code} ` +
      `msg=${(err as Error).message.split("\n")[0]}`,
  );
}
const created = await prisma.auditLog.create({
  data: { id: 1n, action: "verify-sqlite", actorUsername: "dev", success: true },
});
console.log(`[verify] auditLog created id typeof=${typeof created.id} value=${created.id}`);
const audit = await prisma.auditLog.findUniqueOrThrow({ where: { id: created.id } });
console.log("[verify] auditLog read-back:", safe(audit));
console.log(
  `[verify] id typeof=${typeof audit.id} (expect bigint); ` +
    `success typeof=${typeof audit.success} value=${audit.success}; ` +
    `at instanceof Date=${audit.at instanceof Date}`,
);

// 3. Demonstrate the Stage 3 gotcha explicitly: naive JSON.stringify on a row
// containing a native bigint throws.
try {
  JSON.stringify(audit);
  console.log("[verify] naive JSON.stringify(audit): unexpectedly OK");
} catch (err) {
  console.log(
    `[verify] naive JSON.stringify(audit) THROWS as expected: ${(err as Error).message} ` +
      `=> Stage 3 routes touching AuditLog.id need a bigint replacer (see FOR_UPDATE_STRATEGY.md / schema header).`,
  );
}

await prisma.$disconnect();
console.log("[verify] DONE");
