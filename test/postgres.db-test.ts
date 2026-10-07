// The stores on Postgres, not on the in-memory fallback the e2e gate uses: an in-process
// Postgres (test/support/postgres.ts) with db/migrations applied, reached through the same SQL
// the deployment runs. Covers the migrations themselves, the store contracts both backends must
// meet, the database-level guarantees (a locked campaign and a stored dataset version cannot be
// changed, whatever the application does), and a hypothesis campaign from start to verdicts.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { startPostgres, reapplyMigrations, migrationFiles } from "./support/postgres.ts";
import { customStoreContract, artifactContract } from "./support/store-contracts.ts";
import {
  createCampaign, getCampaign, listCampaigns, addHypotheses, removeHypothesis, lockCampaign, runCampaign,
  priorTests, funnel, ledgerHash
} from "../lib/campaign.ts";
import { saveDataset } from "../lib/custom-store.ts";
import type { Hypothesis } from "../lib/hypothesis.ts";
import type { AnalysisResult, AnalysisDoc } from "../lib/types.ts";

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

// ---- a hypothesis campaign, with an engine that answers from the hypothesis itself ----------

const hyp = (statement: string, early: string): Hypothesis => ({
  statement,
  doc: {
    study: "s1",
    cohorts: { early: { all: [{ kind: "oql", q: early }] }, durable: { all: [{ kind: "oql", q: "EGFR: MUT" }] } },
    views: [{ kind: "compare", genes: ["STK11"] }]
  } as AnalysisDoc,
  primary: { view: 0, stat: "compare", gene: "STK11" },
  direction: "higher"
});
const STRONG = hyp("STK11 is more often altered in KRAS-mutant tumours", "KRAS: MUT");
const WEAK = hyp("STK11 is more often altered in TP53-mutant tumours", "TP53: MUT");
const SMALL = hyp("STK11 is more often altered in BRAF-mutant tumours", "BRAF: MUT");

/** Arm sizes and a compare result, chosen by which gene defines the "early" cohort. */
const engine = async (d: AnalysisDoc): Promise<AnalysisResult> => {
  const text = JSON.stringify(d.cohorts);
  const n = text.includes("BRAF") ? 5 : 400;
  const [a, p] = text.includes("TP53") ? [44, 0.6] : [120, 1e-8];
  return {
    study: "s1", involvedStudies: ["s1"], oncokbPin: null, stats: { ms: 0 },
    cohorts: { early: { count: n, text: "", studies: [], sql: "" }, durable: { count: 400, text: "", studies: [], sql: "" } },
    views: (d.views || []).length ? [{ kind: "compare", rows: [{ gene: "STK11", pAny: p, cells: [
      { cohort: "durable", profiled: 400, any: 40, driver: 0, anyPct: 10, driverPct: 0 },
      { cohort: "early", profiled: n, any: a, driver: 0, anyPct: 100 * a / n, driverPct: 0 }
    ] }] }] : []
  } as unknown as AnalysisResult;
};

describe("a hypothesis campaign on Postgres", () => {
  let id = "";
  before(async () => { id = (await createCampaign("What goes with STK11?", "s1")).id; });

  test("registers what it can test, refuses a duplicate, and marks small arms untestable", async () => {
    const r = await addHypotheses(id, [STRONG, WEAK, SMALL], "generator", engine);
    assert.equal(r.added.length, 3);
    assert.deepEqual(r.added.map((h) => h.feasibility?.ok), [true, true, false]);
    const again = await addHypotheses(id, [STRONG], "researcher", engine);
    assert.equal(again.added.length, 0);
    assert.match(again.rejected[0].reason, /already registered as #1/);
    const extra = await addHypotheses(id, [hyp("dropped before the lock", "NRAS: MUT")], "researcher", engine);
    await removeHypothesis(id, extra.added[0].id);
    assert.equal((await getCampaign(id)).hypotheses.length, 3);
    assert.ok((await listCampaigns()).some((c) => c.id === id && c.status === "draft"));
  });

  test("locking timestamps the list and records its receipt", async () => {
    const c = await lockCampaign(id);
    assert.equal(c.status, "locked");
    assert.match(c.lockedAt!, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(c.ledgerHash, ledgerHash(c.hypotheses.map((h) => h.hash)));
    await assert.rejects(addHypotheses(id, [hyp("too late", "NRAS: MUT")], "researcher", engine), /locked/);
    await assert.rejects(removeHypothesis(id, c.hypotheses[0].id), /locked/);
  });

  test("the database itself refuses to change a locked list, its plan or its receipt", async () => {
    const h = (await getCampaign(id)).hypotheses[0];
    await assert.rejects(db.query(
      "insert into campaign_hypotheses (campaign_id, position, statement, spec, hash) values ($1, 99, 'smuggled', '{}'::jsonb, 'x')", [id]),
      /hypothesis list is frozen/);
    await assert.rejects(db.query("update campaign_hypotheses set statement = 'reworded' where id = $1", [h.id]), /cannot be edited/);
    await assert.rejects(db.query("update campaign_hypotheses set spec = '{}'::jsonb where id = $1", [h.id]), /cannot be edited/);
    await assert.rejects(db.query("delete from campaign_hypotheses where id = $1", [h.id]), /hypothesis list is frozen/);
    await assert.rejects(db.query("update campaigns set question = 'a better question' where id = $1", [id]), /permanent/);
    await assert.rejects(db.query("update campaigns set ledger_hash = 'forged' where id = $1", [id]), /permanent/);
    // refused; its trigger reports a delete with the permanent-lock message, as it checks that first
    await assert.rejects(db.query("delete from campaigns where id = $1", [id]), /campaign is locked/);
    // results are what a run writes, so those columns stay writable
    await db.query("update campaign_hypotheses set q = null where id = $1", [h.id]);
  });

  test("the triggers survive the migrations being applied again", async () => {
    await reapplyMigrations(db);
    await assert.rejects(db.query("delete from campaigns where id = $1", [id]), /campaign is locked/);
    await assert.rejects(db.query("delete from campaign_hypotheses where campaign_id = $1", [id]), /hypothesis list is frozen/);
  });

  test("a run tests, corrects, replicates, and reports every hypothesis", async () => {
    const c = await runCampaign(id, engine);
    assert.equal(c.status, "complete");
    const verdict = (s: string) => c.hypotheses.find((h) => h.statement === s)!.verdict;
    assert.equal(verdict(STRONG.statement), "replicated");
    assert.equal(verdict(WEAK.statement), "not-supported");
    assert.equal(verdict(SMALL.statement), "untestable");
    const f = funnel(c);
    assert.deepEqual([f.registered, f.testable, f.tested, f.replicated], [3, 2, 2, 1]);
  });

  test("a later campaign sees the earlier result for the same test", async () => {
    const other = (await createCampaign("Again?", "s1")).id;
    const strong = (await getCampaign(id)).hypotheses.find((h) => h.statement === STRONG.statement)!;
    const prior = await priorTests(strong.hash, other);
    assert.deepEqual(prior.map((p) => [p.campaignId, p.verdict]), [[id, "replicated"]]);
  });
});
