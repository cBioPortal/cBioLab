// Server-side Postgres client for the writable artifact store (saved cohorts
// and workspaces). Credentials never leave the server.
//
// Deliberately separate from lib/ch.ts: ClickHouse is the read-only analytics
// warehouse and must never gain a write path (see docs/DATA-BOUNDARY.md); this
// is the "small writable artifact store, never the read-only analytics
// database" RATIONALE.md calls for. Nothing here ever stores a patient or
// sample identifier — only DSL definitions.
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not set — the artifact store is not configured");
  pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}

export async function dbQuery<T = Record<string, unknown>>(
  sql: string, params: unknown[] = []
): Promise<T[]> {
  const r = await getPool().query(sql, params);
  return r.rows as T[];
}
