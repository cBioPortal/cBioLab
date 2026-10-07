// Server-side Postgres client for the writable artifact store (saved cohorts
// and workspaces). Credentials never leave the server.
//
// Deliberately separate from lib/ch.ts: ClickHouse is the read-only analytics
// warehouse and must never gain a write path (see docs/DATA-BOUNDARY.md); this
// is the "small writable artifact store, never the read-only analytics
// database" RATIONALE.md calls for. The artifact tables never store a patient or
// sample identifier — only DSL definitions. The one exception is server-stored
// custom data (db/migrations/0003_custom_datasets.sql), which holds uploaded
// patient-level values and is reached only through lib/custom-store.ts.
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not set — the artifact store is not configured");
  pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}

type Query = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
let testDatabase: Query | null = null;
/**
 * Point every store at another Postgres — the tests' in-process one (test/support/postgres.ts),
 * with the migrations applied — instead of SUPABASE_DB_URL's. Nothing in the app calls this.
 */
export function setDatabaseForTests(q: Query | null): void { testDatabase = q; }

export async function dbQuery<T = Record<string, unknown>>(
  sql: string, params: unknown[] = []
): Promise<T[]> {
  const r = await (testDatabase ? testDatabase(sql, params) : getPool().query(sql, params));
  return r.rows as T[];
}
