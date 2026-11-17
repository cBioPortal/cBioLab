// The samples and patients of a filtered mutation table (MUT-FM-5, MUT-STM-16): when the table keeps
// fewer rows than it has, the distinct samples and patients among the kept rows, said after the
// table's count. Legacy (cbioportal-frontend cd8c6df): ResultsViewMutationMapper.tsx 75-112 writes
// "Showing N mutations (<summary>)"; PatientSamplesSummary in querySummary/PatientSampleSummary.tsx
// 10-32 words the summary. Row ids are the spec table's (U1, U2, U4, U6, U7). What the counts are on
// real rows (U3-U5) is SQL, run against the fixture study by scripts/check-table-kept-units.ts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "ONCOKB_PIN"]) delete process.env[k];
// fixed Genome Nexus pins, so variantPins answers from the environment and asks no database
process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { setChTransport } = await import("../lib/ch.ts");
const { countsSql } = await import("../lib/table-query.ts");
const { mutationRowSource } = await import("../lib/mutation-table.ts");
// read off the modules, so this file loads before portalKeptUnits and `kept` exist and each test fails on its own
const rowsLib = await import("../lib/views/rows.ts");
const format = await import("../lib/chart/format.ts") as Record<string, unknown>;
const { runMutations } = await import("../lib/views/mutations/run.ts");
const dataTable = await import("../app/_table/DataTable.tsx") as Record<string, unknown>;
type RowSource = import("../lib/table-query.ts").RowSource;
type TableQuery = import("../lib/table-query.ts").TableQuery;
type ViewRun = import("../lib/views/run.ts").ViewRun;
type EvaluatedCohort = import("../lib/views/run.ts").EvaluatedCohort;
type ViewResult = import("../lib/types.ts").ViewResult;
type ViewParticipation = import("../lib/types.ts").ViewParticipation;
type Counts = { cohort: string; study: string; n: number; all: number; ns?: number; np?: number };
type Kept = { samples: number; patients: number };

// a stand-in warehouse that answers every statement with no rows
setChTransport(async () => JSON.stringify({ meta: [], data: [], rows: 0 }));
after(() => setChTransport(null));
const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

const src: RowSource = {
  with: "WITH rows AS (SELECT 1)\n",
  columns: [{ id: "name", name: "Name", numeric: false, text: "name" }],
  select: "*",
  defaultOrder: "name",
  tiebreak: "name, ord",
};
const withUnits = { ...src, units: { sample: "sid", patient: "patient" } } as RowSource;
const PARTS = [{ cohort: "A", study: "s1", cohortSql: "SELECT 1" }];
const PINS = { hg19: "gn-hg19", hg38: "gn-hg38" };

// ---------------------------------------------------------------- U1: the SQL units add
/** the WHERE inside countIf, and the expressions inside each uniqExactIf */
const parts = (sql: string) => {
  const m = /SELECT cohort, study, countIf\(([\s\S]*)\) AS n, count\(\) AS all,\s*uniqExactIf\(\s*([\s\S]*?)\s*,\s*([\s\S]*)\) AS ns,\s*uniqExactIf\(\s*([\s\S]*?)\s*,\s*([\s\S]*)\) AS np\s+FROM rows GROUP BY cohort, study$/.exec(sql);
  assert.ok(m, "the counts select ns and np as uniqExactIf after n and all: " + sql);
  return { where: m[1], sample: m[2], sampleWhere: m[3], patient: m[4], patientWhere: m[5] };
};
describe("U1 countsSql over a source with units", () => {
  test("U1 with units, no query: ns = uniqExactIf(<sample>, 1), np = uniqExactIf(<patient>, 1)", () => {
    const p = parts(countsSql(withUnits, {}, ["name"]));
    assert.equal(p.sample, "sid");
    assert.equal(p.patient, "patient");
    assert.equal(p.where, "1");
    assert.equal(p.sampleWhere.trim(), "1");
    assert.equal(p.patientWhere.trim(), "1");
  });
  test("U1 with units and a search and a filter: both uniqExactIf conditions are the WHERE countIf counts by", () => {
    const q: TableQuery = { search: "G12C", filters: { name: { values: ["x", "y"] } } };
    const p = parts(countsSql(withUnits, q, ["name"]));
    assert.match(p.where, /positionCaseInsensitiveUTF8/);
    assert.equal(p.sampleWhere.trim(), p.where.trim());
    assert.equal(p.patientWhere.trim(), p.where.trim());
  });
  test("U1 without units: the SQL text unchanged", () => {
    assert.equal(countsSql(src, {}, ["name"]), "WITH rows AS (SELECT 1)\nSELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study");
    assert.doesNotMatch(countsSql(src, { search: "G12C" }, ["name"]), /uniqExactIf|AS ns|AS np/);
  });
  test("U1 the mutations table's counts select ns and np (its row source names its sample and patient)", () => {
    const sql = countsSql(mutationRowSource(PARTS, "db", "KRAS", null, PINS), { search: "G12C" }, ["sample"]);
    assert.match(sql, /uniqExactIf\([\s\S]*\) AS ns,\s*uniqExactIf\([\s\S]*\) AS np\s+FROM rows GROUP BY cohort, study$/);
  });
});

// ---------------------------------------------------------------- U2: the summary's words
const units = (samples: number, patients: number): string => {
  const f = format.portalKeptUnits;
  assert.equal(typeof f, "function", "lib/chart/format.ts exports portalKeptUnits");
  return (f as (s: number, p: number) => string)(samples, patients);
};
describe("U2 portalKeptUnits", () => {
  test("U2 (3, 2): \"3 samples / 2 patients\"", () => assert.equal(units(3, 2), "3 samples / 2 patients"));
  test("U2 (1, 2): \"1 sample / 2 patients\"", () => assert.equal(units(1, 2), "1 sample / 2 patients"));
  test("U2 (2, 1): \"2 samples / 1 patient\"", () => assert.equal(units(2, 1), "2 samples / 1 patient"));
  test("U2 (5, 5): \"5 samples/patients\"", () => assert.equal(units(5, 5), "5 samples/patients"));
  test("U2 (1, 1): \"1 sample/patient\"", () => assert.equal(units(1, 1), "1 sample/patient"));
  test("U2 (0, 0): \"0 samples/patients\"", () => assert.equal(units(0, 0), "0 samples/patients"));
});

// ---------------------------------------------------------------- U6 / U4: kept through runRows and the mutations view
const cohort = (studies: string[]): EvaluatedCohort => ({
  studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count: 10, samples: 10, mode: "" }])), count: 10 * studies.length, samples: 0, text: "",
});
function ctx(resolvers: Record<string, unknown>, studies: string[]): ViewRun {
  return {
    doc: { study: studies[0], cohorts: { A: { study: studies[0] } }, views: [] } as never,
    cohorts: { A: cohort(studies) }, resolvers: resolvers as never, vNames: ["A"], vStudies: studies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
  };
}
/** a patient-level participant on its own database, whose table counts answer `counts` */
function local(db: string, counts: Counts[]) {
  return {
    instance: { id: db, mode: "patient-level", label: "Local " + db, conn: { id: db, db } },
    cohortSql: () => "SELECT 1",
    rowsPage: async () => ({ rows: [], total: 0 }),
    rowsCounts: async () => counts,
    rowsValues: async () => [],
    rowsRank: async () => null,
    viewAggregate: async () => [],
  };
}
const viaRows = async (resolvers: Record<string, unknown>, studies: string[]) =>
  await rowsLib.runRows(ctx(resolvers, studies), "t", studies, {} as TableQuery, ["name"], ["name"], 25, () => () => withUnits) as Awaited<ReturnType<typeof rowsLib.runRows>> & { kept?: Kept };

describe("U6 runRows sums the parts' ns and np into kept", () => {
  test("U6 two databases both reporting ns/np: kept is the sum", async () => {
    const got = await viaRows({
      s1: local("db1", [{ cohort: "A", study: "s1", n: 4, all: 9, ns: 3, np: 2 }]),
      s2: local("db2", [{ cohort: "A", study: "s2", n: 5, all: 6, ns: 4, np: 4 }]),
    }, ["s1", "s2"]);
    assert.equal(got.groups, 2);
    assert.deepEqual(got.kept, { samples: 7, patients: 6 });
    assert.equal(got.total, 9);
    assert.equal(got.all, 15);
  });
  test("U6 one group reports ns/np, another's counts carry none: no kept (the sum is unknown, not smaller)", async () => {
    const got = await viaRows({
      s1: local("db1", [{ cohort: "A", study: "s1", n: 4, all: 9, ns: 3, np: 2 }]),
      s2: local("db2", [{ cohort: "A", study: "s2", n: 5, all: 6 }]),
    }, ["s1", "s2"]);
    assert.equal(got.groups, 2);
    assert.equal(got.kept, undefined);
  });
  test("U6 a part with no counts row (no rows at all) counts as 0: kept is the other part's", async () => {
    const got = await viaRows({
      s1: local("db1", []),
      s2: local("db2", [{ cohort: "A", study: "s2", n: 5, all: 6, ns: 4, np: 3 }]),
    }, ["s1", "s2"]);
    assert.deepEqual(got.kept, { samples: 4, patients: 3 });
    assert.equal(got.all, 6);
  });
  test("U6 counts with no ns/np at all: no kept", async () => {
    const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 4, all: 9 }]) }, ["s1"]);
    assert.equal(got.kept, undefined);
  });
});

const result = (r: unknown) => ((r as { result?: ViewResult }).result ?? r) as ViewResult & { error?: string };
const mutations = async (counts: Counts[], search?: string) => {
  const r = result(await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["A"], ...(search ? { search } : {}) } as never, ctx({ s1: local("db1", counts) }, ["s1"])));
  assert.equal(r.error, undefined, String(r.error));
  return (r as unknown as { mutations: { kept?: Kept; total: number; all: number } }).mutations;
};
describe("U4 the mutations view's result carries kept only when it keeps fewer rows than it has", () => {
  test("U4 (unit) total < all: the result carries kept", async () => {
    const m = await mutations([{ cohort: "A", study: "s1", n: 6, all: 24, ns: 6, np: 5 }], "G12C");
    assert.equal(m.total, 6);
    assert.deepEqual(m.kept, { samples: 6, patients: 5 });
  });
  test("U4 (unit) total = all: no kept, though the counts report ns/np", async () => {
    const m = await mutations([{ cohort: "A", study: "s1", n: 24, all: 24, ns: 22, np: 18 }]);
    assert.equal(m.total, 24);
    assert.ok(!("kept" in m), "no kept key");
  });
});

// ---------------------------------------------------------------- U7: the table's title
const COLS = [{ id: "sample", name: "Sample ID", numeric: false }];
const table = (total: number, all: number, search?: string) => ({
  columns: COLS, shown: ["sample"], defaults: ["sample"], query: search ? { search } : {},
  rows: [{ cohort: "A", study: "s1", patient: "P1", sample: "S1", values: ["S1"] }], offset: 0, pageSize: 25,
  lists: [{ cohort: "A", study: "s1", total, all }], total, all,
});
/** the title's text: the dt-title span up to the bar's spacer, with React's text separators and any markup dropped */
const titleOf = (props: Record<string, unknown>): string => {
  const html = renderToStaticMarkup(createElement(dataTable.DataTable as never, { vi: 0, onQuery: () => {}, ...props } as never));
  const m = /<span class="dt-title[^"]*">([\s\S]*?)<span class="spacer"/.exec(html);
  assert.ok(m, "the table has a title");
  return m[1].replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "");
};
describe("U7 DataTable with kept", () => {
  test("U7 \"6 of 24 KRAS mutations (6 samples / 5 patients)\"", () => {
    const t = table(6, 24, "G12C");
    assert.equal(titleOf({ t, query: t.query, unit: "KRAS mutations", kept: { samples: 6, patients: 5 } }), "6 of 24 KRAS mutations (6 samples / 5 patients)");
  });
  test("U7 n = m: \"16 of 24 KRAS mutations (16 samples/patients)\"", () => {
    const t = table(16, 24, "G12");
    assert.equal(titleOf({ t, query: t.query, unit: "KRAS mutations", kept: { samples: 16, patients: 16 } }), "16 of 24 KRAS mutations (16 samples/patients)");
  });
  test("U7 no kept: the title is the count alone", () => {
    const t = table(6, 24, "G12C");
    assert.equal(titleOf({ t, query: t.query, unit: "KRAS mutations" }), "6 of 24 KRAS mutations");
  });
});
