// The stores on Postgres: an in-process Postgres (test/support/postgres.ts) migrated by the
// deployment's runner, reached through the same SQL the deployment runs. Covers the migrations
// and their runner, the store contracts, and the database-level guarantees: a locked campaign and a stored dataset version cannot be
// changed, whatever the application does.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { PGlite as PGliteDb } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { startPostgres, reapplyMigrations, migrationFiles, target, APP_ROLE } from "./support/postgres.ts";
import { migrate, migrationSql } from "../lib/migrate.ts";
import { customStoreContract, artifactContract, userContract, sharingContract, idSetContract } from "./support/store-contracts.ts";
import { saveDataset } from "../lib/custom-store.ts";
import { userForEmail } from "../lib/users.ts";

const db: PGlite = await startPostgres();

describe("migrations", () => {
  test("apply in order to an empty database, and again without harm", async () => {
    assert.deepEqual(migrationFiles(), ["0001_saved_artifacts.sql", "0002_campaigns.sql", "0003_custom_datasets.sql", "0004_users.sql", "0005_sharing.sql", "0006_id_sets.sql", "0007_id_set_parts.sql", "0008_custom_dataset_note.sql", "0009_app_role.sql"]);
    const tables = async () => (await db.query<{ t: string }>(
      "select table_name as t from information_schema.tables where table_schema = 'public' order by 1")).rows.map((r) => r.t);
    const before = await tables();
    await reapplyMigrations(db);
    assert.deepEqual(await tables(), before);
    for (const t of ["app_user", "user_identity", "saved_artifacts", "campaigns", "campaign_hypotheses", "custom_dataset", "custom_dataset_version", "custom_data_access_log", "user_group", "group_member", "id_set", "id_set_access_log"])
      assert.ok(before.includes(t), t + " exists");
  });

  test("the runner records what it applied and applies nothing twice", async () => {
    const recorded = (await db.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((r) => r.name);
    assert.deepEqual(recorded, migrationFiles());
    assert.deepEqual(await migrate(target(db)), []);
  });

  test("a database migrated by hand before the runner existed is adopted without harm", async () => {
    // as deployed before accounts: 0001-0003 run by hand, rows owned by the one shared principal
    const old = await PGliteDb.create({ extensions: { pgcrypto } });
    for (const f of ["0001_saved_artifacts.sql", "0002_campaigns.sql", "0003_custom_datasets.sql"]) await old.exec(migrationSql(f));
    await old.query("insert into saved_artifacts (kind, name, definition, owner) values ('cohort', 'kept', '{}'::jsonb, 'shared')");
    await old.query("insert into custom_dataset (slug, name, owner, level) values ('kept-data', 'kept', 'shared', 'patient')");
    assert.deepEqual(await migrate(target(old)), migrationFiles());
    assert.deepEqual((await old.query("select name, owner_id from saved_artifacts")).rows, [{ name: "kept", owner_id: null }],
      "kept, and nobody's until claimed");
    assert.deepEqual((await old.query("select slug, owner_id from custom_dataset")).rows, [{ slug: "kept-data", owner_id: null }]);
    assert.deepEqual(await migrate(target(old)), []);
    await old.close();
  });

  test("a migration that fails leaves nothing behind and is not recorded", async () => {
    const fresh = await PGliteDb.create({ extensions: { pgcrypto } });
    await fresh.exec("create table schema_migrations (name text primary key, applied_at timestamptz not null default now()); create table custom_dataset (id int)");
    await assert.rejects(migrate(target(fresh)));
    const tables = (await fresh.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' order by 1")).rows.map((r) => r.t);
    assert.ok(!tables.includes("custom_dataset_version"), "the failed migration's tables were rolled back");
    assert.deepEqual((await fresh.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((r) => r.name),
      ["0001_saved_artifacts.sql", "0002_campaigns.sql"]);
    await fresh.close();
  });
});

customStoreContract("Postgres");
artifactContract("Postgres");
userContract("Postgres");
sharingContract("Postgres");
idSetContract("Postgres");

describe("a stored dataset version is immutable in the database", () => {
  test("an update or delete of a version row is refused by its trigger", async () => {
    const d = await saveDataset((await userForEmail("frozen@db.test")).id, {
      id: "frozen-rows", name: "frozen", level: "patient", columns: [{ name: "X", datatype: "STRING" }],
      rows: [{ study: "s1", patient: "P-1", values: ["a"] }]
    }, {});
    await assert.rejects(db.query("update custom_dataset_version set row_count = 99 where dataset_id = $1", [d.id]), /rows are immutable/);
    await assert.rejects(db.query("delete from custom_dataset_version where dataset_id = $1", [d.id]), /rows are immutable/);
  });
});

// ---- a locked campaign is immutable in the database ----------------------------------------
// The campaign and its hypotheses are written with plain SQL: what is under test is the
// migrations' triggers, which must hold whatever the application does.

describe("a locked campaign is immutable in the database", () => {
  let id = "", hid = "";
  before(async () => {
    id = (await db.query<{ id: string }>(
      "insert into campaigns (question, study, plan) values ('q', 's1', '{}'::jsonb) returning id")).rows[0].id;
    hid = (await db.query<{ id: string }>(
      "insert into campaign_hypotheses (campaign_id, position, statement, spec, hash) values ($1, 1, 'h', '{}'::jsonb, 'x') returning id", [id])).rows[0].id;
    await db.query("insert into campaign_hypotheses (campaign_id, position, statement, spec, hash) values ($1, 2, 'dropped', '{}'::jsonb, 'y')", [id]);
    await db.query("delete from campaign_hypotheses where campaign_id = $1 and position = 2", [id]);   // a draft can change
    await db.query("update campaigns set status = 'locked', locked_at = now(), ledger_hash = 'receipt' where id = $1", [id]);
  });

  test("its hypothesis list cannot be added to, edited or shortened", async () => {
    await assert.rejects(db.query(
      "insert into campaign_hypotheses (campaign_id, position, statement, spec, hash) values ($1, 9, 'smuggled', '{}'::jsonb, 'z')", [id]),
      /hypothesis list is frozen/);
    await assert.rejects(db.query("update campaign_hypotheses set statement = 'reworded' where id = $1", [hid]), /cannot be edited/);
    await assert.rejects(db.query("update campaign_hypotheses set spec = '{\"a\":1}'::jsonb where id = $1", [hid]), /cannot be edited/);
    await assert.rejects(db.query("delete from campaign_hypotheses where id = $1", [hid]), /hypothesis list is frozen/);
    // results are what a run writes, so those columns stay writable
    await db.query("update campaign_hypotheses set q = 0.01, verdict = 'replicated' where id = $1", [hid]);
  });

  test("its question, plan, lock and receipt are permanent, and it cannot be deleted", async () => {
    await assert.rejects(db.query("update campaigns set question = 'a better question' where id = $1", [id]), /permanent/);
    await assert.rejects(db.query("update campaigns set plan = '{\"fdr\":1}'::jsonb where id = $1", [id]), /permanent/);
    await assert.rejects(db.query("update campaigns set ledger_hash = 'forged' where id = $1", [id]), /permanent/);
    await assert.rejects(db.query("update campaigns set locked_at = null where id = $1", [id]), /permanent/);
    // refused; its trigger reports a delete with the permanent-lock message, as it checks that first
    await assert.rejects(db.query("delete from campaigns where id = $1", [id]), /campaign is locked/);
    await db.query("update campaigns set status = 'complete', completed_at = now() where id = $1", [id]);
  });

  test("the triggers survive the migrations being applied again", async () => {
    await reapplyMigrations(db);
    await assert.rejects(db.query("delete from campaign_hypotheses where id = $1", [hid]), /hypothesis list is frozen/);
    await assert.rejects(db.query("delete from campaigns where id = $1", [id]), /campaign is locked/);
  });
});

describe("the app's role holds only what the app does", () => {
  const asApp = (sql: string) => db.transaction(async (tx) => { await tx.exec("set local role " + APP_ROLE); return tx.query(sql); });

  test("every table but the migrations' record is granted to it", async () => {
    const ungranted = (await db.query<{ t: string }>(
      `select table_name as t from information_schema.tables where table_schema = 'public' and table_name <> 'schema_migrations'
       except select table_name from information_schema.role_table_grants where grantee = $1 order by 1`, [APP_ROLE])).rows.map((r) => r.t);
    assert.deepEqual(ungranted, [], "grant the app's role what it needs on these in their migration");
  });

  test("it cannot change a table, its triggers, a stored version or an access log", async () => {
    await assert.rejects(asApp("truncate custom_dataset_version"), /permission denied|must be owner/);
    await assert.rejects(asApp("alter table custom_dataset_version disable trigger all"), /must be owner/);
    await assert.rejects(asApp("drop table saved_artifacts"), /must be owner/);
    await assert.rejects(asApp("create table planted (x int)"), /permission denied/);
    await assert.rejects(asApp("delete from custom_dataset_version"), /permission denied/);
    await assert.rejects(asApp("delete from custom_dataset"), /permission denied/);
    await assert.rejects(asApp("select * from custom_data_access_log"), /permission denied/);
    await assert.rejects(asApp("update id_set_access_log set at = now()"), /permission denied/);
    await assert.rejects(asApp("select * from schema_migrations"), /permission denied/);
  });

  test("Supabase's API roles lose every table, and the ones made after", async () => {
    const supa = await PGliteDb.create({ extensions: { pgcrypto } });
    await supa.exec(`create role anon nologin; create role authenticated nologin;
      alter default privileges in schema public grant all on tables to anon, authenticated;`);
    for (const f of migrationFiles().filter((f) => f < "0009")) await supa.exec(migrationSql(f));
    const held = async () => (await supa.query<{ n: number }>(
      "select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon', 'authenticated')")).rows[0].n;
    assert.ok(await held() > 0, "as Supabase gives them");
    assert.ok((await migrate(target(supa))).includes("0009_app_role.sql"));
    assert.equal(await held(), 0);
    await supa.exec("create table later (x int)");
    assert.equal(await held(), 0, "nor a table a later migration makes");
    await supa.close();
  });
});
