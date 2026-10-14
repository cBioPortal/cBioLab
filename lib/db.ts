// Server-side Postgres client for the writable store (saved cohorts and analyses, campaigns,
// custom data). Credentials never leave the server.
//
// Deliberately separate from lib/ch.ts: ClickHouse is the read-only analytics
// warehouse and must never gain a write path (see docs/DATA-BOUNDARY.md); this
// is the "small writable artifact store, never the read-only analytics
// database" RATIONALE.md calls for. The artifact tables never store a patient or
// sample identifier — only DSL definitions. The one exception is server-stored
// custom data (db/migrations/0003_custom_datasets.sql), which holds uploaded
// patient-level values and is reached only through lib/custom-store.ts.
//
// Which database:
//   - DATABASE_URL (or its older name SUPABASE_DB_URL): that Postgres. Its migrations are applied
//     by `npm run db:migrate`, never by the app.
//   - neither, outside Vercel production: an in-process Postgres (PGlite) with the migrations
//     applied on first use, so a session, the e2e gate or a fresh checkout runs the same SQL with
//     nothing to set up. `next dev` keeps it in .data/pglite (or PGLITE_DIR) across restarts;
//     anything else keeps it in memory, so every gate run starts empty.
//   - neither, in Vercel production: refused, since data that vanished on every cold start would
//     be worse than the error.
import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import { migrate } from "./migrate.ts";

type Query = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

/** The configured Postgres, if any. An empty value counts as unset (scripts/gate.sh relies on it). */
export const databaseUrl = (): string | undefined => process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || undefined;

let pool: Pool | null = null;
function getPool(url: string): Pool {
  return pool ??= new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
}

let local: Promise<Query> | null = null;
function localDatabase(): Promise<Query> {
  return local ??= (async (): Promise<Query> => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    const dir = process.env.PGLITE_DIR || (process.env.NODE_ENV === "development" ? ".data/pglite" : undefined);
    if (dir) mkdirSync(dir, { recursive: true });
    const db = await PGlite.create(dir, { extensions: { pgcrypto } });
    const applied = await migrate({ exec: (sql) => db.exec(sql), query: async (sql, p) => (await db.query(sql, p)).rows as never });
    console.warn("[db] DATABASE_URL is not set: using an in-process Postgres " + (dir ? "in " + dir : "in memory (lost on restart)") +
      (applied.length ? "; applied " + applied.join(", ") : ""));
    return (sql, params) => db.query(sql, params);
  })().catch((e) => { local = null; throw e; });   // the next request tries again
}

let testDatabase: Query | null = null;
/**
 * Point every store at another Postgres — the tests' in-process one (test/support/postgres.ts),
 * with the migrations applied. Nothing in the app calls this.
 */
export function setDatabaseForTests(q: Query | null): void { testDatabase = q; }

export async function dbQuery<T = Record<string, unknown>>(
  sql: string, params: unknown[] = []
): Promise<T[]> {
  const url = databaseUrl();
  if (testDatabase) return (await testDatabase(sql, params)).rows as T[];
  if (url) return (await getPool(url).query(sql, params)).rows as T[];
  if (process.env.VERCEL_ENV === "production")
    throw new Error("DATABASE_URL is not set — saved cohorts, analyses and custom data are not configured for production");
  return (await (await localDatabase())(sql, params)).rows as T[];
}
