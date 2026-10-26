// Apply db/migrations to the deployment's Postgres, recording each in schema_migrations so it runs
// once. It connects as the tables' owner: MIGRATION_DATABASE_URL, else DATABASE_URL (or
// SUPABASE_DB_URL) for a database whose app still connects as the owner. The app never migrates a
// configured database itself; run this before deploying code that needs a new migration:
//   node --env-file=.env.local scripts/db-migrate.ts            (npm run db:migrate)
//   node --env-file=.env.local scripts/db-migrate.ts --status   lists applied and pending, changes nothing
import pg from "pg";
import { migrationDatabaseUrl } from "../lib/db.ts";
import { migrate, migrationFiles } from "../lib/migrate.ts";

const url = migrationDatabaseUrl();
if (!url) {
  console.error("MIGRATION_DATABASE_URL and DATABASE_URL are not set (without either, the app uses its own in-process database, which migrates itself)");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  if (process.argv.includes("--status")) {
    const has = (await client.query("select to_regclass('schema_migrations') as t")).rows[0].t;
    const done = new Set(has ? (await client.query("select name from schema_migrations")).rows.map((r) => r.name) : []);
    for (const f of migrationFiles()) console.log((done.has(f) ? "applied  " : "pending  ") + f);
  } else {
    // one runner at a time against this database
    await client.query("select pg_advisory_lock(hashtext('cohort-lab migrations'))");
    const applied = await migrate({ exec: (sql) => client.query(sql), query: async (sql, p) => (await client.query(sql, p)).rows });
    console.log(applied.length ? "applied " + applied.join(", ") : "up to date: nothing to apply");
  }
} finally {
  await client.end();
}
