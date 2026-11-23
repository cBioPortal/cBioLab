// Materialized WITH subqueries in the views' statements, run on the fixture study
// (test/fixtures/peer-study on connection b); the text is test/view-materialized-cte.test.ts:
//   F1  each case of test/support/view-mcte-cases.ts (acquired counts and funnel, cancertypes,
//       txendpoint for every endpoint, instability scores), whole study and a sub-cohort: the
//       materialized statement gives the plain one's rows, as a multiset; the cases the fixture
//       populates return rows
//   F2  a resolver's viewAggregate with { materialize: true } on connection b sends the statement
//       materialized, and its rows are the plain statement's
//   F3  the mutations table's copy-number lookup reads only the gene and its fusions' site 1 genes:
//       every row's Copy # is the one it has with the lookup over every gene, and some row has one
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines; scripts/gate.sh
// sets them) and is skipped otherwise; skipped naming the version where the database does not run
// `SETTINGS enable_materialized_cte = 1`.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";
import type { CohortDef } from "../lib/types.ts";
import { materializedCases, SETTING } from "./support/view-mcte-cases.ts";

const FIXTURE = "cbiolab_peer_fixture";
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
delete process.env.CH_RUN_CACHE;
delete process.env[FLAG];
const { secondary, chQuery } = await import("../lib/ch.ts");
const { compileCohortDef } = await import("../lib/cohort2.ts");
const { cohortSubquery } = await import("../lib/sql-kinds.ts");
const { PatientLevelResolver } = await import("../lib/federation.ts");
const { acquiredCountsSql } = await import("../lib/views/acquired/sql.ts");
const { MUTATION_DEFAULT_COLUMNS, mutationRowSource } = await import("../lib/mutation-table.ts");
const { pageSql } = await import("../lib/table-query.ts");

const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

let conn: ChConn;
let unsupported: string | false = noDb;
before(async () => {
  if (noDb) return;
  conn = secondary()!;
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  const v = String((await chQuery<{ v: string }>("SELECT version() AS v", conn)).data[0].v);
  try {
    const r = await chQuery<{ total: number }>("WITH a AS MATERIALIZED (SELECT number AS n FROM numbers(3)) SELECT sum(n) AS total FROM a WHERE n IN (SELECT n FROM a)" + SETTING, conn);
    assert.equal(Number(r.data[0].total), 3);
  } catch (e) {
    unsupported = "ClickHouse " + v + " on connection b does not run `AS MATERIALIZED` with enable_materialized_cte = 1: " + String((e as Error).message).slice(0, 200);
  }
});

const run = async (sql: string) => (await chQuery<Record<string, unknown>>(sql, conn)).data;
const asSet = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).sort();

const COHORTS: [string, CohortDef | null][] = [
  ["whole study", null],
  ["female patients", { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as unknown as CohortDef],
];
const fixtureCtx = (cohortSql: string) => ({ study: FIXTURE, db: conn.db, cohortSql, genes: ["EGFR", "KRAS", "TP53"], pin: "fixture-pin",
  subtype: "Targeted", sampleEvent: "Sample Acquisition", profiles: ["mutations", "cna", "structural_variants"] });

for (const [cohortName, def] of COHORTS) {
  describe("F1 the " + cohortName + ": each materialized statement gives the plain one's rows", () => {
    let cohortSql = "";
    before(() => { if (!unsupported) cohortSql = cohortSubquery(compileCohortDef(def, { study: FIXTURE, db: conn.db })); });
    const populated: string[] = [];
    // the cases are listed when the file loads (names only); their statements are built inside each test
    for (const c0 of materializedCases(fixtureCtx("")).map((c) => ({ name: c.name, populated: c.populated, positive: c.positive }))) {
      test(c0.name, { skip: unsupported }, async (t) => {
        if (unsupported) { t.skip(unsupported); return; }
        const c = materializedCases(fixtureCtx(cohortSql)).find((x) => x.name === c0.name)!;
        const off = c.build(), on = c.build(true);
        assert.ok(on.endsWith(SETTING) && / AS MATERIALIZED \(/.test(on), "the statement is materialized");
        const [rOff, rOn] = await Promise.all([run(off), run(on)]);
        t.diagnostic(rOff.length + " rows");
        assert.deepEqual(asSet(rOn), asSet(rOff));
        if (c0.populated) {
          assert.ok(rOff.length > 0, "the fixture populates this case, so the comparison says something");
          populated.push(c0.name);
        }
        if (c0.positive) assert.ok(rOff.some((r) => Number(r[c0.positive!]) > 0), c0.positive + " is positive in some row: " + JSON.stringify(rOff));
      });
    }
    test("the populated cases returned rows", { skip: unsupported }, (t) => {
      if (unsupported) { t.skip(unsupported); return; }
      assert.ok(populated.length >= 10, "populated: " + populated.join("; "));
    });
  });
}

describe("F2 a resolver's viewAggregate on connection b", () => {
  test("materialize: true sends the statement materialized, with the plain statement's rows", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const c: ChConn = { ...conn, id: "b-view-mcte" };
    const r = new PatientLevelResolver(FIXTURE, { oncokbPin: null }, { id: c.id, mode: "patient-level", label: "fixture", conn: c });
    const sides = { anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Targeted" }, sampleEvents: ["Sample Acquisition"], sampleKey: "SAMPLE_ID", preWindowDays: null, minGapDays: 30 };
    const handed: boolean[] = [];
    const rows = await r.viewAggregate("acquired:genes:all", null, (cs, s, d, m) => { handed.push(m); return acquiredCountsSql(cs, s, d, null, sides, null, "any", m); },
      { materialize: true });
    assert.deepEqual(handed, [true], "the fixture's server runs the setting");
    const sent = r.queries.at(-1)!.sql;
    assert.match(sent, / AS MATERIALIZED \(/);
    assert.ok(sent.endsWith(SETTING));
    const plain = await run(acquiredCountsSql(r.cohortSql(null), FIXTURE, conn.db, null, sides, null, "any"));
    assert.ok(plain.length > 0);
    assert.deepEqual(asSet(rows), asSet(plain));
  });
});

describe("F3 the mutations table's copy-number lookup, narrowed to the table's genes", () => {
  const GENE_CONDITION = /\n {4}AND hugo_gene_symbol IN \(SELECT gene1 FROM v0 UNION ALL SELECT '[A-Z0-9]+'\)/;
  for (const gene of ["EGFR", "KRAS", "TP53", "ALK"]) {
    test(gene + ": every row's Copy # is the one the lookup over every gene gives", { skip: unsupported }, async (t) => {
      if (unsupported) { t.skip(unsupported); return; }
      const cohortSql = cohortSubquery(compileCohortDef(null, { study: FIXTURE, db: conn.db }));
      const sql = String(pageSql(mutationRowSource([{ cohort: "c", study: FIXTURE, cohortSql }], conn.db, gene, null, { hg19: null, hg38: null }),
        {}, MUTATION_DEFAULT_COLUMNS, 1000, 0));
      assert.match(sql, GENE_CONDITION, "the lookup names the table's genes");
      const [narrowed, every] = await Promise.all([run(sql), run(sql.replace(GENE_CONDITION, ""))]);
      const cn = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify([r.sid, r.proteinChange, r.chr, r.start, r.copyNumber])).sort();
      t.diagnostic(narrowed.length + " rows, " + narrowed.filter((r) => r.copyNumber !== "").length + " with a Copy #");
      assert.ok(narrowed.length > 0, "the fixture has " + gene + " rows");
      assert.deepEqual(cn(narrowed), cn(every));
      assert.deepEqual(asSet(narrowed), asSet(every));
    });
  }
  test("some row has a Copy #", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const cohortSql = cohortSubquery(compileCohortDef(null, { study: FIXTURE, db: conn.db }));
    const rows = (await Promise.all(["EGFR", "KRAS", "TP53"].map((g) => run(String(pageSql(
      mutationRowSource([{ cohort: "c", study: FIXTURE, cohortSql }], conn.db, g, null, { hg19: null, hg38: null }), {}, MUTATION_DEFAULT_COLUMNS, 1000, 0)))))).flat();
    assert.ok(rows.some((r) => r.copyNumber !== ""), "the comparison covers a Copy # call");
  });
});
