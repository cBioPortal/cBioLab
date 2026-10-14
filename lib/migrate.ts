// The migration runner: applies db/migrations/*.sql in name order, each once, recording what ran
// in schema_migrations. Used by the deployed Postgres (`npm run db:migrate`), by the local
// in-process database lib/db.ts falls back to, and by the tests, so all three run the same SQL.
//
// Every migration is written to be re-runnable (create ... if not exists, drop trigger if exists),
// so a database whose migrations were applied by hand before this table existed takes them again
// without harm and is recorded from then on.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MigrationTarget {
  /** Run a script of several statements (no parameters). */
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

const DIR = join(process.cwd(), "db", "migrations");

/** The migrations' file names, in the order they are applied. */
export const migrationFiles = (): string[] => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

export const migrationSql = (file: string): string => readFileSync(join(DIR, file), "utf8");

/** Apply every migration not yet recorded, each in its own transaction; returns the names applied. */
export async function migrate(db: MigrationTarget): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of migrationFiles()) {
    if (done.has(f)) continue;
    try {
      await db.exec("begin;\n" + migrationSql(f) + "\n;insert into schema_migrations (name) values ('" + f.replace(/'/g, "''") + "');\ncommit;");
    } catch (e) {
      // the failed statement leaves the connection inside the aborted transaction
      await db.exec("rollback").catch(() => {});
      throw new Error("migration " + f + " failed and was rolled back: " + ((e as Error)?.message || e));
    }
    applied.push(f);
  }
  return applied;
}
