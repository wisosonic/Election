import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

// Both drivers implement the same drizzle query-builder surface against the same
// `schema`; they differ only in their driver-specific QueryResult HKT, which TS
// can't unify cleanly across a union for generic code like withTenant() below.
// Since only PGlite is actually exercised in this environment (no Docker/real
// Postgres available), NodePgDatabase is structurally cast to this type at the
// one call site that constructs it (createDb) rather than widening every
// consumer's types for a path nothing here can test.
export type Db = PgliteDatabase<typeof schema>;

const SQL_DIR = join(__dirname, '..', 'sql');

function migrationFiles(): string[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Applies every packages/db/sql/*.sql migration, in filename order, via the
 * driver's *simple query* protocol (multi-statement SQL, no parameters) --
 * required because these files contain multiple ; -separated statements and a
 * DO $$ ... $$ block, which the parameterized/prepared-statement protocol
 * (what drizzle's own db.execute() uses) rejects with "cannot insert multiple
 * commands into a prepared statement". Idempotent (IF NOT EXISTS / a guarded
 * DO block), so safe to re-run against a fresh instance in every test file.
 */
async function applyMigrationsRaw(execRaw: (sqlText: string) => Promise<unknown>): Promise<void> {
  for (const file of migrationFiles()) {
    const contents = readFileSync(join(SQL_DIR, file), 'utf8');
    await execRaw(contents);
  }
}

/**
 * Creates a DB handle. No url (or 'pglite') -> in-process PGlite, real Postgres
 * compiled to WASM -- used for tests and this sandboxed dev session (no Docker
 * available). A postgres:// url -> a real pg connection (docker-compose/staging/prod).
 */
export async function createDb(url?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!url || url === 'pglite') {
    const client = new PGlite();
    await applyMigrationsRaw((s) => client.exec(s));
    // Migrations run as PGlite's default (superuser) role; switch this session's
    // ongoing role to the non-superuser app_user so RLS is actually enforced for
    // every query this `db` handle issues from here on -- see the comment in
    // sql/001_schema.sql for why a superuser session would silently bypass RLS.
    await client.exec('SET ROLE app_user;');
    const db = drizzlePglite(client, { schema });
    return { db, close: () => client.close() };
  }

  const pool = new Pool({ connectionString: url });
  await applyMigrationsRaw((s) => pool.query(s));
  const db = drizzleNodePg(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set for its duration --
 * this is the seam that makes the RLS policies in sql/001_schema.sql apply.
 * Every service must go through this rather than querying the raw db handle
 * directly for any tenant-scoped table.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  }) as Promise<T>;
}
