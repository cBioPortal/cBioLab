// Give the app's database role (db/migrations/0009_app_role.sql) a login with a new random password,
// and write the app's DATABASE_URL to a file only its owner can read: the migration URL with the
// role's name and password in place of the owner's. Run it after `npm run db:migrate`, then set the
// deployment's DATABASE_URL to the file's contents. Running it again replaces the password, so the
// deployment needs the new value too. The password is never printed.
//   node --env-file=.env.local scripts/db-app-role.ts <file>     (npm run db:app-role -- <file>)
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { migrationDatabaseUrl } from "../lib/db.ts";

const ROLE = "cohort_lab_app";
const out = process.argv[2];
const url = migrationDatabaseUrl();
if (!out || !url) {
  console.error(!out ? "usage: db-app-role.ts <file to write the app's DATABASE_URL to>" : "MIGRATION_DATABASE_URL and DATABASE_URL are not set");
  process.exit(1);
}
const ssl = (u: string) => /localhost|127\.0\.0\.1/.test(u) ? false : { rejectUnauthorized: false };

const owner = new pg.Client({ connectionString: url, ssl: ssl(url) });
await owner.connect();
const password = randomBytes(24).toString("base64url");
try {
  if (!(await owner.query("select 1 from pg_roles where rolname = $1", [ROLE])).rowCount) {
    console.error("there is no " + ROLE + " role: run `npm run db:migrate` first");
    process.exit(1);
  }
  // base64url text needs no quoting beyond the literal's
  await owner.query("alter role " + ROLE + " with login password '" + password + "'");
} finally {
  await owner.end();
}

// Supabase's pooler names a role with the project after a dot (postgres.<project>)
const app = new URL(url);
const project = decodeURIComponent(app.username).split(".")[1];
app.username = project ? ROLE + "." + project : ROLE;
app.password = password;

const check = new pg.Client({ connectionString: app.toString(), ssl: ssl(url) });
await check.connect();
try {
  const who = (await check.query<{ u: string }>("select current_user as u")).rows[0].u;
  await check.query("select count(*) from custom_dataset");
  const truncate = await check.query("truncate custom_dataset_version").then(() => "allowed", (e: Error) => e.message);
  if (who !== ROLE || truncate === "allowed") throw new Error("connected as " + who + "; truncate " + truncate);
} finally {
  await check.end();
}
writeFileSync(out, app.toString(), { mode: 0o600 });
console.log("gave " + ROLE + " a login; it reads custom_dataset and is refused a truncate. Its DATABASE_URL is in " + out);
