# SELECT ... FOR UPDATE replacement strategy (Stage 3 input)

Stage 3 must migrate the concurrency seams currently implemented as raw
`SELECT ... FOR UPDATE` (or equivalent read-then-write races) onto Prisma.
Prisma's query builder has **no** `forUpdate()` method, so the locking read
must be raw SQL in both providers — but the *locking semantics* differ
completely between MySQL (prod) and SQLite (dev). This doc fixes the exact
pattern Stage 3 must use for each, plus the `updatedAt` rule.

> ⚠️ **READ THIS FIRST — DO NOT SKIP.**
> **Passing concurrency tests against SQLite dev is NEVER proof of
> MySQL-prod concurrency safety. SQLite serializes ALL writers globally
> (one write transaction at a time, whole-database granularity), while
> MySQL uses per-row locks (`SELECT ... FOR UPDATE` locks only the rows
> read). A race that is impossible on SQLite (because the second writer
> simply waits/fails at the whole-DB lock) can still be wide open on MySQL
> if the `FOR UPDATE` is missing or wrong — and conversely, lock-ordering
> deadlocks that bite on MySQL cannot reproduce on SQLite. Treat SQLite
> dev-mode concurrency tests as smoke tests for logic only, never as
> evidence that the locking is correct. The MySQL path must be reviewed
> (and ideally load-tested against real MySQL) on its own terms.**

## 1. MySQL approach (prod): raw locking read inside `$transaction`

Pattern for every seam (Stage 3 to apply per seam — `registerCustomerWithSession`,
`linkLineIdentityWithConsume`, `consumeLineTxWithAudit`, password/session
version race guards, etc. — none of which are implemented here):

```ts
await prisma.$transaction(async (tx) => {
  // 1. Locking read: RAW SQL, because the query builder cannot express FOR UPDATE.
  const rows = await tx.$queryRaw<UserRow[]>`
    SELECT * FROM users WHERE id = ${id} FOR UPDATE`;
  // 2. Subsequent writes use the normal model API on the SAME tx handle.
  await tx.user.update({ where: { id }, data: { ... } });
});
```

Rules:

- The `SELECT ... FOR UPDATE` string is a **literal** in code with bound
  parameters (`${...}` placeholders via the tagged template — never string
  interpolation of values, and table/column names only ever from code
  literals, see §3).
- Everything — the locking read AND all following writes — goes through the
  `tx` handle. Prisma docs guarantee interactive transactions run all
  queries of the callback on **one connection**
  ("One transaction means that all queries inside it have to be run on the
  same connection", Prisma docs: Transactions / interactive transactions).
  Queries issued on the outer `prisma` object instead of `tx` run outside
  the transaction and are NOT protected by the lock.
- Keep the callback short (no network calls inside) — long-held row locks
  hurt MySQL/`InnoDB` throughput and risk lock-wait timeouts/deadlocks.
- `FOR UPDATE` requires `InnoDB` (our migrations use InnoDB) and locks only
  rows actually read; a `SELECT ... FOR UPDATE` matching zero rows locks
  nothing (next-key/gap aspects aside) — seams doing insert-if-absent need
  their own guard design (e.g. unique-key insert + catch-duplicate), not
  just a locking read.

## 2. SQLite approach (dev): force the write lock early

### 2.1 How SQLite locking actually works (researched, not guessed)

Sources: sqlite.org `lang_transaction.html` ("DEFERRED, IMMEDIATE, and
EXCLUSIVE transactions"), `atomiccommit.html`, draft `isolation.html`.

- The default transaction mode is **DEFERRED**: `BEGIN` (which is what
  Prisma issues for a `$transaction` callback) merely sets a flag. No lock
  is taken until the first statement that actually accesses the database.
- If the first statement is a `SELECT`, a **read** transaction starts. A
  later write tries to *upgrade* to a write transaction — and that upgrade
  **fails with `SQLITE_BUSY` if another connection wrote in the meantime**.
  Worse, two connections that both `SELECT` first and then both try to
  write deadlock in a way no busy-timeout can resolve (each holds a read
  lock the other needs released). sqlite.org documents this explicitly and
  invented `BEGIN IMMEDIATE` largely to prevent it.
- `BEGIN IMMEDIATE` takes the write (RESERVED) lock **up front**: at most
  one connection can hold it, so a second writer fails fast at `BEGIN`
  instead of racing through a `SELECT` first. Prisma does not let us choose
  the `BEGIN` mode for a `$transaction` callback, so on SQLite we emulate
  `BEGIN IMMEDIATE` with the technique below.
- Lock granularity is the **whole database file** (RESERVED → PENDING →
  EXCLUSIVE on commit). There are no row locks. See the warning at the top.

### 2.2 The technique: a real no-op write as the first statement

As the **very first statement** inside the `$transaction` callback on
SQLite, issue a genuine (but semantically null) write through `tx` via
`tx.$executeRaw`, **before** the actual `SELECT`:

```ts
await prisma.$transaction(async (tx) => {
  // SQLite only: force the RESERVED write lock NOW (emulates BEGIN IMMEDIATE).
  await tx.$executeRaw`UPDATE users SET id = id WHERE id = ${id}`;
  // ...then the real read + writes on the same tx.
  const user = await tx.user.findUnique({ where: { id } });
  await tx.user.update({ where: { id }, data: { ... } });
});
```

Why this works, and the conditions that make it valid:

- Same-connection guarantee: per Prisma docs (cited in §1), **every**
  query issued on the `tx` handle — raw (`$queryRaw`/`$executeRaw`) or
  model API — rides the **same underlying transaction/connection**. So the
  early raw `UPDATE` and the later `SELECT`/writes share one SQLite
  transaction; the lock taken by the first statement protects all of them.
  (Verified from Prisma's documented interactive-transaction behavior,
  not assumed.)
- The statement must be a **real write**: SQLite takes the RESERVED lock
  when a write statement first needs the rollback journal. `UPDATE ... SET
  pk = pk` on an **existing** row qualifies; it changes nothing logically
  but forces the lock immediately instead of deferring it past the `SELECT`.
- ⚠️ Caveat (no-op writes on **missing** rows): an `UPDATE` that matches
  zero rows may never touch the journal and therefore may **not** take the
  lock. So the no-op write must target a row **guaranteed to exist** —
  normally the very row the seam is about to lock (it was just read-locked
  conceptually, but the point is it exists), or a singleton/parent row for
  insert-if-absent paths. If the seam's row might not exist yet, lock the
  parent (e.g. the `customers` row when creating a `customer_line_tx` row)
  instead of the possibly-absent child.
- Failure mode: a second concurrent writer gets `SQLITE_BUSY`
  ("database is locked") from Prisma as an error. Stage 3 callers that
  need robustness under concurrent dev/test load should **retry the whole
  `$transaction` callback** on busy errors (small bounded backoff); do not
  swallow it silently.

## 3. Reusable helper design (Stage 3 to implement)

Seams must NOT each hand-roll provider-conditional raw SQL. Stage 3 should
implement **one** helper, called as the **first statement** inside a
`$transaction` callback:

```ts
export type DbProvider = "mysql" | "sqlite";

/**
 * Locking read for one row by primary key. MUST be called as the first
 * statement inside a prisma.$transaction callback, using the tx handle.
 *
 * - provider "mysql": issues literal `SELECT ... FOR UPDATE` via tx.$queryRaw.
 * - provider "sqlite": FIRST forces the write lock with a real no-op
 *   `UPDATE <table> SET <pk> = <pk> WHERE <pk> = ?` via tx.$executeRaw
 *   (row must exist — see §2.2 caveat), THEN issues the plain SELECT.
 *
 * @param tx        the active transaction client (NOT the outer prisma object)
 * @param provider  active provider ("mysql" | "sqlite"), from DATABASE_PROVIDER
 * @param table     physical table name — CODE LITERAL ONLY, never user input
 * @param pkColumn  physical PK column name — CODE LITERAL ONLY, never user input
 * @param pkValue   PK value — always bound as a query parameter
 * @returns the selected row (typed T), or null if no row matched.
 *          (MySQL: zero matched rows lock nothing — callers needing
 *          insert-if-absent semantics need a unique-key guard on top.)
 */
export async function selectRowForUpdate<T>(args: {
  tx: TxClient;
  provider: DbProvider;
  table: string; // allow-listed literal at the call site
  pkColumn: string; // allow-listed literal at the call site
  pkValue: string | number | bigint;
}): Promise<T | null> {
  // ---- STUB — Stage 3 implements for real. Sketch only, NOT wired anywhere:
  const { tx, provider, table, pkColumn, pkValue } = args;
  if (provider === "sqlite") {
    // Force RESERVED lock first (emulated BEGIN IMMEDIATE); row must exist.
    await tx.$executeRawUnsafe(
      `UPDATE ${table} SET ${pkColumn} = ${pkColumn} WHERE ${pkColumn} = ?`,
      pkValue,
    );
    const rows = await tx.$queryRawUnsafe<T[]>(
      `SELECT * FROM ${table} WHERE ${pkColumn} = ?`,
      pkValue,
    );
    return rows[0] ?? null;
  }
  const rows = await tx.$queryRawUnsafe<T[]>(
    `SELECT * FROM ${table} WHERE ${pkColumn} = ? FOR UPDATE`,
    pkValue,
  );
  return rows[0] ?? null;
  // ---- end stub
}
```

Intended usage (per seam, Stage 3):

```ts
await prisma.$transaction(async (tx) => {
  const row = await selectRowForUpdate<UserRow>({
    tx, provider, table: "users", pkColumn: "id", pkValue: id,
  });
  // ...guard checks, then tx.<model>.update(...) writes on the same tx.
});
```

Notes for the Stage 3 implementer:

- `TxClient` is whatever transaction-client type the chosen client export
  exposes (the `tx` parameter type inside `$transaction`). Type it
  precisely then; `unknown`-ish loose typing here is deliberate for a stub.
- `table`/`pkColumn` are interpolated into SQL, so they must come from a
  **fixed allow-list of literals at call sites** (as above) — never from
  request data. `pkValue` is always a bound parameter (`?` + args, or the
  tagged-template form). Prefer the tagged-template `$queryRaw\`\``
  /`$executeRaw\`\`` over `*Unsafe` where the call shape allows it; the
  stub uses `*Unsafe` only because identifiers cannot be bound parameters.
- This helper covers **single-row-by-PK** locking reads, which is what the
  known seams need. Multi-row/range locking is out of scope — design it
  per seam if one ever needs it.
- The real seam migrations (`registerCustomerWithSession`,
  `linkLineIdentityWithConsume`, `consumeLineTxWithAudit`, password/session
  version race guards) are **Stage 3's job** and are NOT implemented here —
  this doc (plus the stub sketch above) is the whole Stage 2 deliverable
  for this track.

## 4. The `updatedAt` auto-update rule

Empirical fact (confirmed in Stage 1): **Prisma 7's `@updatedAt` does NOT
emit `ON UPDATE CURRENT_TIMESTAMP` in generated MySQL DDL**, and SQLite
has no trigger-free equivalent either. The `@updatedAt` attribute in our
schemas is therefore kept **only for Prisma Client's TypeScript typing
convenience** — it has **no automatic runtime behavior** on either
provider.

**Rule for Stage 3 (no exceptions): every `update()`/`upsert()` call
touching a model that has an `updatedAt` field must explicitly pass
`updatedAt: new Date()`.** Reviewers: grep for `\.update(` / `\.upsert(`
and check each call site against the checklist below.

Checklist — models **with** `updatedAt` (inspected directly in
`prisma/schema.prisma`, 4 of 11):

1. `User.updatedAt`
2. `ShopSetting.updatedAt`
3. `ShopTable.updatedAt`
4. `Customer.updatedAt`

Models **without** `updatedAt` (no action needed): `Session`, `AuditLog`,
`ShopSchedule`, `ShopOverride`, `CustomerSession`, `CustomerLineLink`,
`CustomerLineTx`.

## 5. Other SQLite-vs-MySQL divergences found (Task D, empirical)

- **`AuditLog.id` autoincrement does NOT work on SQLite.** `prisma validate`
  accepts `BigInt @default(autoincrement())`, but `db push` emits
  `"id" BIGINT NOT NULL PRIMARY KEY` — no `AUTOINCREMENT`, and the declared
  type is `BIGINT` rather than `INTEGER`, so SQLite's rowid-alias
  auto-assignment does not apply. Inserting an `AuditLog` without an
  explicit `id` fails with `P2011 (NOT NULL constraint failed:
  audit_logs.id)` on SQLite while working on MySQL (verified by
  `prisma/verify-sqlite.ts`, which demonstrates the failure and then
  inserts with an explicit `id: 1n`). Stage 3 needs an explicit
  id-assignment strategy for `AuditLog` when the provider is sqlite.
- **Native `bigint` in JSON responses.** The client returns BigInt columns
  as native JS `bigint`, and naive `JSON.stringify()` **throws**
  (`Do not know how to serialize a BigInt`). Any route/JSON response
  touching `AuditLog.id` needs a replacer (e.g. convert bigint to string).
  Demonstrated in the verify script output.
- **`@relation(map: ...)` (named foreign keys) is rejected by the SQLite
  connector** ("Your provider does not support named foreign keys").
  `schema.sqlite.prisma` strips it (generator step 4); `@@unique`/`@@index`
  `map:` names are accepted and kept. No runtime impact — FKs still exist —
  but constraint names differ between providers, so never assert on FK
  constraint names in dev tests.
