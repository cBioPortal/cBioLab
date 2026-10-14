// An in-process Postgres for the tests (PGlite: Postgres compiled to WebAssembly), migrated by
// the same runner a deployment uses (lib/migrate.ts), and handed to every store through
// setDatabaseForTests — so the SQL, the migrations and their triggers are what is exercised.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { setDatabaseForTests } from "../../lib/db.ts";
import { migrate, migrationFiles, migrationSql, type MigrationTarget } from "../../lib/migrate.ts";

export { migrationFiles };

export const target = (db: PGlite): MigrationTarget =>
  ({ exec: (sql) => db.exec(sql), query: async (sql, p) => (await db.query(sql, p)).rows as never });

export async function startPostgres(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await migrate(target(db));
  setDatabaseForTests((sql, params) => db.query(sql, params));
  return db;
}

/** Apply every migration again, bypassing the runner's record, as a person re-running them by hand would. */
export async function reapplyMigrations(db: PGlite): Promise<void> {
  for (const f of migrationFiles()) await db.exec(migrationSql(f));
}
