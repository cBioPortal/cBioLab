// The column summaries of a table's counts statement (lib/table-query.ts countsSql `summarize`, read
// by summaryOf), run on the fixture study (test/fixtures/peer-study on connection b):
//   S1  per (cohort, study), a numeric column's min and max and a text column's distinct values ('' a
//       value) are over every row of the part, whatever the query's search and filters; the row's
//       `n` still follows the query
//   S2  they equal what valuesSql gives for that part with an empty query (Mutations: vaf's lo/hi,
//       cancerType's value set), for KRAS, TP53 and EGFR
//   S3  a numeric column with no non-null value in a part: min and max null
//   S4  a text column with more than VALUES_MAX distinct values: capped at VALUES_MAX, truncated; at
//       VALUES_MAX exactly, not truncated
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines) and is skipped otherwise.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";
import type { CohortDef } from "../lib/types.ts";
import type { RowSource, TableQuery } from "../lib/table-query.ts";

const FIXTURE = "cbiolab_peer_fixture";
delete process.env.CH_RUN_CACHE;
const { secondary, chQuery } = await import("../lib/ch.ts");
const { compileCohortDef } = await import("../lib/cohort2.ts");
const { cohortSubquery } = await import("../lib/sql-kinds.ts");
const { MUTATION_DEFAULT_COLUMNS, mutationRowSource } = await import("../lib/mutation-table.ts");
const tq = await import("../lib/table-query.ts");

type Summary =
  | { column: string; numeric: true; min: number | null; max: number | null }
  | { column: string; numeric: false; values: string[]; truncated: boolean };
type Ask = { column: string; numeric: boolean };
const T = tq as unknown as {
  countsSql: (src: RowSource, q: TableQuery, defaults: string[], summarize?: Ask[]) => unknown;
  valuesSql: (src: RowSource, q: TableQuery, defaults: string[], column: string) => unknown;
  summaryOf?: (summarize: Ask[], row: Record<string, unknown>) => Summary[];
  VALUES_MAX: number;
};
const summaryOf = (ask: Ask[], row: Record<string, unknown>) => {
  assert.equal(typeof T.summaryOf, "function", "lib/table-query.ts exports summaryOf");
  return T.summaryOf!(ask, row);
};

const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";
let conn: ChConn;
before(() => {
  if (noDb) return;
  conn = secondary()!;
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
});
const run = async (sql: unknown) => (await chQuery<Record<string, unknown>>(String(sql), conn)).data;

const FACTS: Ask[] = [{ column: "vaf", numeric: true }, { column: "cancerType", numeric: false }];
const COHORTS: [string, CohortDef | null][] = [
  ["all", null],
  ["female", { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as unknown as CohortDef],
];
const parts = () => COHORTS.map(([cohort, def]) => ({ cohort, study: FIXTURE, cohortSql: cohortSubquery(compileCohortDef(def, { study: FIXTURE, db: conn.db })) }));
const source = (gene: string, ps = parts()) => mutationRowSource(ps, conn.db, gene, "fixture", { hg19: "fixture", hg38: null });
const key = (r: Record<string, unknown>) => r.cohort + "|" + r.study;
const sorted = (xs: string[]) => [...xs].sort();
const textOf = (s: Summary | undefined) => { assert.ok(s && !s.numeric, JSON.stringify(s)); return s; };
const numOf = (s: Summary | undefined) => { assert.ok(s && s.numeric, JSON.stringify(s)); return s; };

/** per part: the summaries of its counts row */
async function summariesBy(src: RowSource, q: TableQuery, ask: Ask[]) {
  const rows = await run(T.countsSql(src, q, MUTATION_DEFAULT_COLUMNS, ask));
  return new Map(rows.map((r) => [key(r), { n: Number(r.n), all: Number(r.all), sums: summaryOf(ask, r) }]));
}

for (const gene of ["KRAS", "TP53", "EGFR"]) {
  describe(gene, () => {
    test("S1 the summaries ignore the query's search and filters; n follows the query", { skip: noDb }, async (t) => {
      const src = source(gene);
      // a query that keeps few rows: a search and a filter on the summarised text column itself
      const anyType = (await run(T.valuesSql(src, {}, MUTATION_DEFAULT_COLUMNS, "cancerType"))).map((r) => String(r.v)).find((v) => v !== "");
      assert.ok(anyType, "the fixture has a cancer type on " + gene + "'s rows");
      const q: TableQuery = { search: gene === "KRAS" ? "G12" : "R", filters: { cancerType: { values: [anyType] }, vaf: { min: 0.2 } } };
      const [plain, narrowed] = await Promise.all([summariesBy(src, {}, FACTS), summariesBy(src, q, FACTS)]);
      assert.ok(plain.size >= 1, "parts with rows: " + plain.size);
      assert.deepEqual(sorted([...narrowed.keys()]), sorted([...plain.keys()]), "one counts row per part either way");
      let narrower = false;
      for (const [k, p] of plain) {
        const n = narrowed.get(k)!;
        const norm = (s: Summary[]) => s.map((x) => x.numeric ? x : { ...x, values: sorted(x.values) });
        assert.deepEqual(norm(n.sums), norm(p.sums), k + ": the summaries are the same with or without the query");
        assert.equal(n.all, p.all, k + ": all is every row");
        assert.ok(n.n <= p.n, k + ": n follows the query");
        if (n.n < p.n) narrower = true;
      }
      assert.ok(narrower, "the query keeps fewer rows in some part, so the comparison says something");
      t.diagnostic(JSON.stringify([...plain].map(([k, v]) => [k, v.n, v.sums])));
    });

    test("S2 the summaries equal valuesSql's lo/hi and value set for the same part, empty query", { skip: noDb }, async () => {
      const ps = parts();
      const sums = await summariesBy(source(gene, ps), { search: "zzz-no-such-row" }, FACTS);
      let compared = 0;
      for (const p of ps) {
        const one = source(gene, [p]);
        const s = sums.get(p.cohort + "|" + p.study);
        const [vaf, types] = await Promise.all([run(T.valuesSql(one, {}, MUTATION_DEFAULT_COLUMNS, "vaf")), run(T.valuesSql(one, {}, MUTATION_DEFAULT_COLUMNS, "cancerType"))]);
        if (!s) { assert.ok(!types.length, p.cohort + ": no counts row, so no rows"); continue; }
        compared++;
        const v = numOf(s.sums[0]), c = textOf(s.sums[1]);
        const lo = vaf[0]?.lo == null || Number(vaf[0].n) === 0 ? null : Number(vaf[0].lo);
        const hi = vaf[0]?.hi == null || Number(vaf[0].n) === 0 ? null : Number(vaf[0].hi);
        assert.equal(v.min == null ? null : Number(v.min), lo, p.cohort + ": vaf min");
        assert.equal(v.max == null ? null : Number(v.max), hi, p.cohort + ": vaf max");
        assert.deepEqual(sorted(c.values), sorted(types.map((r) => String(r.v))), p.cohort + ": the cancer types");
        assert.equal(c.truncated, false);
      }
      assert.ok(compared >= 1, "some part has rows");
    });
  });
}

describe("S2 the fixture holds the shapes the comparison needs", () => {
  test("some gene's part has a vaf, and some part more than one cancer type", { skip: noDb }, async () => {
    const all = await Promise.all(["KRAS", "TP53", "EGFR"].map((g) => summariesBy(source(g), {}, FACTS)));
    const sums = all.flatMap((m) => [...m.values()].map((x) => x.sums));
    assert.ok(sums.some((s) => numOf(s[0]).max != null), "a part with a vaf");
    assert.ok(sums.some((s) => textOf(s[1]).values.filter((v) => v !== "").length >= 2), "a part with two cancer types");
  });
});

// ---- synthetic row sources on the same server: the edges -----------------------------------------

/** rows of two parts: `p1` with `k` distinct text values and numbers; `p2` with only NULL numbers and '' text */
function synthetic(k: number): RowSource {
  return {
    with: "WITH rows AS (\n" +
      "  SELECT 'c' AS cohort, 'p1' AS study, toNullable(toFloat64(number) / 10) AS x, 'v' || toString(number) AS t FROM numbers(" + k + ")\n" +
      "  UNION ALL SELECT 'c', 'p1', NULL, '' \n" +
      "  UNION ALL SELECT 'c', 'p2', CAST(NULL AS Nullable(Float64)), '' FROM numbers(3)\n)\n",
    columns: [
      { id: "x", name: "X", numeric: true, text: "ifNull(toString(x), '')", num: "x" },
      { id: "t", name: "T", numeric: false, text: "t" },
    ],
    select: "*", defaultOrder: "x", tiebreak: "t",
  };
}
const ASK: Ask[] = [{ column: "x", numeric: true }, { column: "t", numeric: false }];

describe("synthetic parts", () => {
  test("S3 a part whose numeric column is NULL in every row: min and max null; its text values hold ''", { skip: noDb }, async () => {
    const by = await summariesBy(synthetic(3), {}, ASK);
    const p2 = by.get("c|p2");
    assert.ok(p2, JSON.stringify([...by.keys()]));
    assert.deepEqual(numOf(p2.sums[0]), { column: "x", numeric: true, min: null, max: null });
    assert.deepEqual(textOf(p2.sums[1]).values, [""]);
    const p1 = by.get("c|p1")!;
    assert.deepEqual({ ...numOf(p1.sums[0]), min: Number(numOf(p1.sums[0]).min), max: Number(numOf(p1.sums[0]).max) },
      { column: "x", numeric: true, min: 0, max: 0.2 }, "a NULL beside values is not a value; 0 is");
    assert.deepEqual(sorted(textOf(p1.sums[1]).values), ["", "v0", "v1", "v2"], "'' is a value");
  });

  test("S1 a search and filter that keep no row of a part leave its summaries whole", { skip: noDb }, async () => {
    const [plain, none] = await Promise.all([summariesBy(synthetic(3), {}, ASK), summariesBy(synthetic(3), { search: "v1", filters: { x: { min: 0.05 } } }, ASK)]);
    assert.equal(none.get("c|p2")!.n, 0);
    assert.equal(none.get("c|p1")!.n, 1);
    for (const k of plain.keys()) {
      const norm = (s: Summary[]) => s.map((x) => x.numeric ? { ...x, min: x.min == null ? null : Number(x.min), max: x.max == null ? null : Number(x.max) } : { ...x, values: sorted(x.values) });
      assert.deepEqual(norm(none.get(k)!.sums), norm(plain.get(k)!.sums), k);
    }
  });

  test("S4 more than VALUES_MAX distinct text values: capped at VALUES_MAX and truncated", { skip: noDb }, async () => {
    const M = T.VALUES_MAX;
    const by = await summariesBy(synthetic(M + 10), {}, ASK); // M + 11 distinct with ''
    const t = textOf(by.get("c|p1")!.sums[1]);
    assert.equal(t.values.length, M);
    assert.equal(new Set(t.values).size, M);
    assert.equal(t.truncated, true);
  });

  test("S4 exactly VALUES_MAX distinct text values: all of them, not truncated", { skip: noDb }, async () => {
    const M = T.VALUES_MAX;
    const by = await summariesBy(synthetic(M - 1), {}, ASK); // M - 1 values plus ''
    const t = textOf(by.get("c|p1")!.sums[1]);
    assert.equal(t.values.length, M);
    assert.equal(t.truncated, false);
    const one = await summariesBy(synthetic(M), {}, ASK); // M + 1
    assert.equal(textOf(one.get("c|p1")!.sums[1]).truncated, true, "one past the limit is truncated");
  });
});
