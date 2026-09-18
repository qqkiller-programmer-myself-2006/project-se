/**
 * Provider-switching Prisma client singleton — STAGE 2 SKELETON, NOT WIRED IN.
 *
 * Nothing in the app imports this file yet (not app.ts, index.ts,
 * bootstrap.ts, store.ts, or any route). Stage 3 will import { prisma } from
 * here once the seams migrate off store.ts.
 *
 * Provider decision (in order):
 *   1. DATABASE_PROVIDER env var: "mysql" or "sqlite" (case-insensitive).
 *      Any other value is ignored and falls through to inference.
 *   2. Inference from DATABASE_URL's scheme: a value starting with "file:"
 *      means sqlite, a value starting with "mysql://" means mysql.
 *   3. Default: "mysql" (matches current prod-only behavior).
 *
 * Prisma 7 note: `new PrismaClient()` without arguments and the
 * `{ datasourceUrl }` option were both removed — every client MUST be built
 * with a driver adapter. Hence sqlite mode uses @prisma/adapter-better-sqlite3
 * and mysql mode uses @prisma/adapter-mariadb (both are real dependencies in
 * apps/api/package.json, not dev-only). The connection URL is passed to the
 * adapter explicitly (CLI commands keep reading DATABASE_URL from
 * prisma.config.ts; this file is the runtime path).
 *
 * Typing note: the mysql and sqlite generated clients are technically
 * distinct TS types (different output dirs), but both are generated from
 * mirrored schemas so they expose the same model API surface. They are
 * exported under one union type (AnyPrismaClient) — method calls resolve
 * because the surfaces are structurally identical. If the schemas ever
 * diverge, this union will surface the difference at typecheck time, which
 * is exactly what we want.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient as MysqlPrismaClient } from "../../generated/prisma-mysql/client.js";
import { PrismaClient as SqlitePrismaClient } from "../../generated/prisma-sqlite/client.js";

export type DatabaseProvider = "mysql" | "sqlite";

/** Nominal union over both generated clients (see typing note above). */
export type AnyPrismaClient = MysqlPrismaClient | SqlitePrismaClient;

export function resolveProvider(): DatabaseProvider {
  const explicit = (process.env.DATABASE_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "mysql" || explicit === "sqlite") return explicit;
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("mysql://")) return "mysql";
  return "mysql";
}

export const databaseProvider: DatabaseProvider = resolveProvider();

function createClient(): AnyPrismaClient {
  if (databaseProvider === "sqlite") {
    // Dev default: throwaway file DB next to the schemas, relative to the
    // apps/api cwd (same value Task D verifies with). An explicit
    // DATABASE_URL always wins.
    const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
    return new SqlitePrismaClient({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[db] DATABASE_URL is not set (mysql mode). Set DATABASE_URL " +
        "or switch dev to sqlite via DATABASE_PROVIDER=sqlite.",
    );
  }
  return new MysqlPrismaClient({ adapter: new PrismaMariaDb(url) });
}

/** Singleton for Stage 3 to import. Constructed once at module load. */
export const prisma: AnyPrismaClient = createClient();
