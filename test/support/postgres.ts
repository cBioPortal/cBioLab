// An in-process Postgres for the tests (PGlite: Postgres compiled to WebAssembly), with
// db/migrations applied in order, standing in for SUPABASE_DB_URL's database. The stores pick
// their Postgres backend because SUPABASE_DB_URL is set, and reach this one through
// setDatabaseForTests — so the SQL, the migrations and their triggers are what is exercised,
// not the in-memory fallback the e2e gate uses.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { setDatabaseForTests } from "../../lib/db.ts";

const MIGRATIONS = new URL("../../db/migrations/", import.meta.url);

/** The migrations' file names, in the order they are applied. */
export const migrationFiles = (): string[] => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

export async function startPostgres(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of migrationFiles()) await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  process.env.SUPABASE_DB_URL = "postgres://in-process-test-database";
  setDatabaseForTests((sql, params) => db.query(sql, params));
  return db;
}

/** Apply every migration again, as a person re-running them by hand would. */
export async function reapplyMigrations(db: PGlite): Promise<void> {
  for (const f of migrationFiles()) await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
}
