/**
 * gen-sqlite-schema.ts — mechanically derives `schema.sqlite.prisma`
 * (SQLite dev variant) from `schema.prisma` (MySQL production schema).
 *
 * WHY A GENERATOR (option (a) in the Stage 2 brief, not a hand-maintained file):
 * the transform is 100% mechanical — same 11 models, same fields, same
 * @map/@@map names, only (1) datasource provider, (2) generator output dir,
 * (3) @db.* native-type attributes change. A hand-maintained copy would drift
 * the first time someone edits schema.prisma and forgets the twin; a script
 * makes drift structurally impossible. Run `npm run prisma:gen-sqlite`
 * after every schema.prisma change. Re-runnable and idempotent: output is a
 * pure function of schema.prisma content, and the script never reads its own
 * output.
 *
 * Usage (from apps/api/):  npm run prisma:gen-sqlite
 * (script entry: `tsx prisma/gen-sqlite-schema.ts`; tsx is already a devDep,
 * so no new dependency is needed for this step.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "schema.prisma");
const DEST = join(here, "schema.sqlite.prisma");

const HEADER = `// Prisma schema — SQLite DEV variant. MECHANICALLY DERIVED, DO NOT EDIT BY HAND.
// Source of truth: prisma/schema.prisma (MySQL production schema, itself mirroring
// db/migrations/001-004). To sync: edit schema.prisma, then run
// \`npm run prisma:gen-sqlite\` (re-runnable, idempotent). Generator:
// prisma/gen-sqlite-schema.ts (option (a): generator script, chosen so the two
// schemas cannot drift — same 11 models/fields/@map/@@map names by construction).
//
// Mechanical transform applied by the generator:
// - datasource db provider "mysql" -> "sqlite".
// - generator client output -> ../generated/prisma-sqlite (a separate directory so
//   the MySQL client in ../generated/prisma-mysql is never clobbered; both
//   clients can coexist — verified in Task D via \`ls generated/\`).
// - EVERY @db.* native-type attribute stripped. Research (not a guess): the SQLite
//   connector supports NO native types — any @db.* fails validation with
//   "Native type X is not supported for sqlite connector" (Prisma docs: scalar
//   types already cover everything SQLite has; confirmed empirically — the first
//   generated draft kept the attributes and \`prisma validate\` rejected them).
//   Stripped: @db.Char/@db.VarChar lengths, @db.TinyInt, @db.Int, @db.BigInt,
//   @db.Timestamp(0) / @db.DateTime(0) precisions, plus the \`map:\` (named-FK)
//   argument on @relation — SQLite rejects named foreign keys (found
//   empirically, not in the brief's candidate list). @@unique/@@index \`map:\`
//   names ARE accepted on SQLite and are kept identical.
// Known trouble spots (verified empirically in Task D, see FOR_UPDATE_STRATEGY.md):
// - Json (User.roles, ShopSchedule.intervals): kept as the Json scalar (stored as
//   TEXT); round-trips to real JS objects/arrays.
// - Boolean: no native-type attribute needed or valid on SQLite.
// - AuditLog.id (BigInt @default(autoincrement())): DIVERGES from MySQL —
//   \`prisma validate\` accepts it, but \`db push\` emits
//   "id" BIGINT NOT NULL PRIMARY KEY (no AUTOINCREMENT, and the declared
//   type is BIGINT not INTEGER so SQLite's rowid-alias auto-assignment does
//   NOT kick in). Inserting without an explicit id fails with P2011
//   (NOT NULL constraint failed: audit_logs.id) — observed empirically in
//   Task D. The client DOES return native JS bigint for BigInt columns,
//   which JSON.stringify() rejects by default — Stage 3 routes touching
//   AuditLog.id need a replacer (String(id)), AND Stage 3 needs an
//   explicit id-assignment strategy for AuditLog on sqlite (e.g. assign
//   ids in code when provider is sqlite).

`;

function derive(src: string): string {
  // Drop the source file's own header comment block (leading `//` / blank lines)
  // so this file carries exactly one header: the one above.
  const lines = src.split("\n");
  let bodyStart = 0;
  while (
    bodyStart < lines.length &&
    (lines[bodyStart].trim() === "" || lines[bodyStart].trimStart().startsWith("//"))
  ) {
    bodyStart++;
  }
  let body = lines.slice(bodyStart).join("\n");

  // (1) provider mysql -> sqlite (only the datasource block uses "mysql";
  // the generator block uses "prisma-client", so this replace is safe).
  body = body.replace('provider = "mysql"', 'provider = "sqlite"');

  // (2) point the generator at the dedicated sqlite output dir, whatever the
  // mysql schema's output currently is (today ../generated/prisma-mysql).
  body = body.replace(
    /output\s*=\s*"[^"]*"/,
    'output   = "../generated/prisma-sqlite"',
  );

  // (3) strip every @db.* native-type attribute (spaces/tabs only — never
  // newlines — so one attribute per line stays one line).
  body = body.replace(/[ \t]*@db\.\w+(\([^)]*\))?/g, "");

  // (4) strip the `map:` (FK constraint name) argument from @relation.
  // SURPRISE found empirically: the SQLite connector rejects named foreign
  // keys — "Your provider does not support named foreign keys" (4 errors, one
  // per @relation with map:). @@unique/@@index `map:` names are accepted and
  // kept; only @relation's map: goes. Line-scoped so @@unique/@@index keeps
  // its names.
  body = body
    .split("\n")
    .map((line) =>
      line.includes("@relation") ? line.replace(/,\s*map:\s*"[^"]*"/, "") : line,
    )
    .join("\n");

  return HEADER + body;
}

const src = readFileSync(SRC, "utf8");
const out = derive(src);
writeFileSync(DEST, out);
console.log(`wrote ${DEST} (${out.split("\n").length} lines)`);
