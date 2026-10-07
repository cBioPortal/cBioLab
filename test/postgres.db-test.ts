// The stores on Postgres, not on the in-memory fallback the e2e gate uses: an in-process
// Postgres (test/support/postgres.ts) with db/migrations applied, reached through the same SQL
// the deployment runs. Covers the migrations themselves, the store contracts both backends must
// meet, and the database-level guarantees: a locked campaign and a stored dataset version cannot be
// changed, whatever the application does.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { startPostgres, reapplyMigrations, migrationFiles } from "./support/postgres.ts";
import { customStoreContract, artifactContract } from "./support/store-contracts.ts";
import { saveDataset } from "../lib/custom-store.ts";

const db: PGlite = await startPostgres();

describe("migrations", () => {
  test("apply in order to an empty database, and again without harm", async () => {
    assert.deepEqual(migrationFiles(), ["0001_saved_artifacts.sql", "0002_campaigns.sql", "0003_custom_datasets.sql"]);
    const tables = async () => (await db.query<{ t: string }>(
      "select table_name as t from information_schema.tables where table_schema = 'public' order by 1")).rows.map((r) => r.t);
    const before = await tables();
    await reapplyMigrations(db);
    assert.deepEqual(await tables(), before);
    for (const t of ["saved_artifacts", "campaigns", "campaign_hypotheses", "custom_dataset", "custom_dataset_version", "custom_dataset_grant", "custom_data_access_log"])
      assert.ok(before.includes(t), t + " exists");
  });
});

customStoreContract("Postgres");
artifactContract("Postgres");

describe("a stored dataset version is immutable in the database", () => {
  test("an update or delete of a version row is refused by its trigger", async () => {
    const d = await saveDataset("shared", {
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
