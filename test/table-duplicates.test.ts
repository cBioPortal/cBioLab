// Duplicate counts in the Mutations and Structural Variants tables (MUT-TB-1, MUT-STM-14, MUT-MD-5,
// SV-TB-1, SV-STM-1, SV-MD-7): the rows beyond the first of one event seen in several of a patient's
// samples, over every row of the table, said after the table's count. Legacy (cbioportal-frontend
// cd8c6df): MutationUtils.tsx 162-189 groups mutations by gene, patient and protein change;
// ResultsViewStructuralVariantMapperDataStore.ts 34-50 groups SVs by patient and both breakpoints;
// MutationMapper.tsx 236-248 writes the note only when there are some. Row ids are the spec table's
// (D1, D5, D6, D7). What the counts are on real rows (D2-D4) is SQL, run against the fixture study by
// scripts/check-table-duplicates.ts, never read here as text.
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
const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { countsSql } = await import("../lib/table-query.ts");
const { mutationRowSource } = await import("../lib/mutation-table.ts");
const { svRowSource } = await import("../lib/sv-table.ts");
const { PatientLevelResolver } = await import("../lib/federation.ts");
// read off the modules, so this file loads before portalDuplicatesNote and keyOnFirstRun exist and each test fails on its own
const rowsLib = await import("../lib/views/rows.ts") as Record<string, unknown> & typeof import("../lib/views/rows.ts");
const format = await import("../lib/chart/format.ts") as Record<string, unknown>;
const { runSv } = await import("../lib/views/sv/run.ts");
const { runMutations } = await import("../lib/views/mutations/run.ts");
const dataTable = await import("../app/_table/DataTable.tsx") as Record<string, unknown>;
type RowSource = import("../lib/table-query.ts").RowSource;
type TableQuery = import("../lib/table-query.ts").TableQuery;
type ViewRun = import("../lib/views/run.ts").ViewRun;
type EvaluatedCohort = import("../lib/views/run.ts").EvaluatedCohort;
type ViewResult = import("../lib/types.ts").ViewResult;
type ViewParticipation = import("../lib/types.ts").ViewParticipation;
type Counts = { cohort: string; study: string; n: number; all: number; dup?: number };

// a stand-in warehouse: a table's counts answer with a `dup`, everything else with no rows
const asked: string[] = [];
setChTransport(async ({ query }) => {
  asked.push(query);
  const data = /AS n, count\(\) AS all/.test(query) ? [{ cohort: "A", study: "s1", n: "2", all: "5", dup: "3" }] : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
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
const keyed = { ...src, duplicateKey: "(study, patient, x)" } as RowSource;
const PARTS = [{ cohort: "A", study: "s1", cohortSql: "SELECT 1" }];
const PINS = { hg19: "gn-hg19", hg38: "gn-hg38" };

// ---------------------------------------------------------------- D1: the SQL a duplicate key adds
describe("D1 countsSql over a source with a duplicate key", () => {
  test("D1 with duplicateKey: selects count() - uniqExact(<key>) AS dup, per cohort and study", () => {
    assert.match(countsSql(keyed, {}, ["name"]),
      /^WITH rows AS \(SELECT 1\)\nSELECT cohort, study, countIf\(1\) AS n, count\(\) AS all, count\(\) - uniqExact\(\(study, patient, x\)\) AS dup FROM rows GROUP BY cohort, study$/);
  });
  test("D1 the dup is over every row: a search narrows n alone", () => {
    const sql = countsSql(keyed, { search: "G12C" }, ["name"]);
    assert.match(sql, /countIf\(\(positionCaseInsensitiveUTF8.*\)\) AS n, count\(\) AS all, count\(\) - uniqExact\(\(study, patient, x\)\) AS dup FROM rows GROUP BY/);
  });
  test("D1 without a key: no dup, the SQL text unchanged", () => {
    assert.equal(countsSql(src, {}, ["name"]), "WITH rows AS (SELECT 1)\nSELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study");
  });
  test("D1 the mutations table's counts select dup keyed on study, patient and protein change (one gene per table)", () => {
    const s = mutationRowSource(PARTS, "db", "KRAS", null, PINS);
    const sql = countsSql(s, {}, ["sample"]);
    const m = /count\(\) - uniqExact\((.*?)\) AS dup\b[\s\S]* FROM rows GROUP BY cohort, study$/.exec(sql);
    assert.ok(m, "the mutations counts select a dup");
    for (const c of ["study", "patient", "proteinChange"]) assert.match(m[1], new RegExp("\\b" + c + "\\b"), "the key names " + c);
  });
  test("D1 the sv table's counts select dup keyed on study, patient and both breakpoints", () => {
    const s = svRowSource(PARTS, "db", ["ALK"], null);
    const sql = countsSql(s, {}, ["sample"]);
    const m = /count\(\) - uniqExact\((.*?)\) AS dup\b[\s\S]* FROM rows GROUP BY cohort, study$/.exec(sql);
    assert.ok(m, "the sv counts select a dup");
    for (const c of ["study", "patient", "site1Chr", "site1Pos", "site2Chr", "site2Pos"]) assert.match(m[1], new RegExp("\\b" + c + "\\b"), "the key names " + c);
  });
});

// ---------------------------------------------------------------- D5: the note's words
const note = (n: number | undefined, one: string, many: string): string | undefined => {
  const f = format.portalDuplicatesNote;
  assert.equal(typeof f, "function", "lib/chart/format.ts exports portalDuplicatesNote");
  return (f as (n: number | undefined, one: string, many: string) => string | undefined)(n, one, many);
};
describe("D5 portalDuplicatesNote", () => {
  test("D5 none (0 or undefined): no note", () => {
    assert.equal(note(0, "mutation", "mutations"), undefined);
    assert.equal(note(undefined, "mutation", "mutations"), undefined);
  });
  test("D5 one: singular", () => {
    assert.equal(note(1, "mutation", "mutations"), "includes 1 duplicate mutation in patients with multiple samples");
    assert.equal(note(1, "structural variant", "structural variants"), "includes 1 duplicate structural variant in patients with multiple samples");
  });
  test("D5 38: plural", () => {
    assert.equal(note(38, "mutation", "mutations"), "includes 38 duplicate mutations in patients with multiple samples");
    assert.equal(note(38, "structural variant", "structural variants"), "includes 38 duplicate structural variants in patients with multiple samples");
  });
  test("D5 1234: the bare number, as the portal writes it (String(n), no thousands separator)", () => {
    assert.equal(note(1234, "mutation", "mutations"), "includes 1234 duplicate mutations in patients with multiple samples");
  });
});

// ---------------------------------------------------------------- D6: the table's title
const COLS = [{ id: "sample", name: "Sample ID", numeric: false }];
const table = (total: number, all: number, search?: string, lists = [{ cohort: "A", study: "s1", total, all }]) => ({
  columns: COLS, shown: ["sample"], defaults: ["sample"], query: search ? { search } : {},
  rows: [{ cohort: "A", study: "s1", patient: "P1", sample: "S1", values: ["S1"] }], offset: 0, pageSize: 25,
  lists, total, all,
});
/** the title's text: the dt-title span up to the bar's spacer, with React's text separators and any markup dropped */
const titleOf = (props: Record<string, unknown>): string => {
  const html = renderToStaticMarkup(createElement(dataTable.DataTable as never, { vi: 0, onQuery: () => {}, ...props } as never));
  const m = /<span class="dt-title[^"]*">([\s\S]*?)<span class="spacer"/.exec(html);
  assert.ok(m, "the table has a title");
  return m[1].replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "");
};
describe("D6 DataTable with countNote", () => {
  const NOTE = "includes 4 duplicate mutations in patients with multiple samples";
  test("D6 the title reads \"<total> <unit>: <note>\"", () => {
    assert.equal(titleOf({ t: table(24, 24), unit: "KRAS mutations", countNote: NOTE }), "24 KRAS mutations: " + NOTE);
  });
  test("D6 searched: \"<total> of <all> <unit>: <note>\"", () => {
    const t = table(1, 24, "FX-P01-T1");
    assert.equal(titleOf({ t, query: t.query, unit: "KRAS mutations", countNote: NOTE }), "1 of 24 KRAS mutations: " + NOTE);
  });
  test("D6 several cohorts and studies: \"<total> <unit> across N cohorts and studies: <note>\"", () => {
    const t = table(24, 24, undefined, [{ cohort: "A", study: "s1", total: 20, all: 20 }, { cohort: "B", study: "s2", total: 4, all: 4 }]);
    assert.equal(titleOf({ t, unit: "KRAS mutations", countNote: NOTE }), "24 KRAS mutations across 2 cohorts and studies: " + NOTE);
  });
  test("D6 no countNote: the title is the count alone", () => {
    assert.equal(titleOf({ t: table(24, 24), unit: "KRAS mutations" }), "24 KRAS mutations");
  });
});

// ---------------------------------------------------------------- D7: dup reaches the view's result
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
/** a peer that pages the table itself (federation-api `patient-rows`), answering mode "counts" with `counts` */
function peer(counts: Counts[]) {
  const modes: string[] = [];
  return {
    modes, peerUrl: "https://peer.invalid",
    instance: { id: "peer", mode: "patient-level", label: "Peer", conn: { id: "peer", db: "" } },
    patientRows: async (req: { mode: string }) => { modes.push(req.mode); return req.mode === "counts" ? { counts } : { rows: [] }; },
  };
}
const result = (r: unknown) => ((r as { result?: ViewResult }).result ?? r) as ViewResult & { error?: string };
const sv = async (resolvers: Record<string, unknown>, studies: string[]) => {
  const r = result(await runSv({ kind: "sv", genes: ["ALK"], cohorts: ["A"] } as never, ctx(resolvers, studies)));
  assert.equal(r.error, undefined, String(r.error));
  return (r as unknown as { sv: { duplicates?: number; total: number; all: number } }).sv;
};
const mutations = async (resolvers: Record<string, unknown>, studies: string[]) => {
  const r = result(await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["A"] } as never, ctx(resolvers, studies)));
  assert.equal(r.error, undefined, String(r.error));
  return (r as unknown as { mutations: { duplicates?: number; total: number; all: number } }).mutations;
};
const viaRows = (resolvers: Record<string, unknown>, studies: string[], remote?: Record<string, unknown>) =>
  rowsLib.runRows(ctx(resolvers, studies), "t", studies, {} as TableQuery, ["name"], ["name"], 25, () => () => keyed, undefined, remote as never);

describe("D7 a counts answer's dup carried through to runRows", () => {
  test("D7 PatientLevelResolver.rowsCounts (what federation-api answers for mode \"counts\") keeps the dup the database answers", async () => {
    const r = new PatientLevelResolver("s1", { oncokbPin: null }, { id: PRIMARY.id, mode: "patient-level", label: "fixture", conn: PRIMARY });
    asked.length = 0;
    const got = await r.rowsCounts("t", () => keyed, {}, ["name"]) as Counts[];
    assert.ok(asked.some((q) => /AS dup/.test(q)), "the counts statement selects dup");
    assert.deepEqual(got, [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 3 }]);
  });
  test("D7 two databases' counts: duplicates is the sum across groups", async () => {
    const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 1 }]), s2: local("db2", [{ cohort: "A", study: "s2", n: 3, all: 4, dup: 2 }]) }, ["s1", "s2"]);
    assert.equal(got.groups, 2);
    assert.equal((got as { duplicates?: number }).duplicates, 3);
    assert.equal(got.total, 5);
    assert.equal(got.all, 9);
  });
  test("D7 a peer's counts answer carries its dup, summed with a local database's", async () => {
    const p = peer([{ cohort: "A", study: "s2", n: 1, all: 6, dup: 4 }]);
    const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 1 }]), s2: p }, ["s1", "s2"],
      { of: (r: { peerUrl?: string }) => r.peerUrl ? r : null, table: "alterations:mutations" });
    assert.ok(p.modes.includes("counts"), "the peer was asked for counts");
    assert.equal((got as { duplicates?: number }).duplicates, 5);
  });
  test("D7 counts without a dup: no duplicates", async () => {
    const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5 }]) }, ["s1"]);
    assert.equal((got as { duplicates?: number }).duplicates, undefined);
  });
  test("D7 (a) one group reports dup 3, another's counts carry no dup: no duplicates (the sum is unknown, not smaller)", async () => {
    const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 3 }]), s2: local("db2", [{ cohort: "A", study: "s2", n: 3, all: 4 }]) }, ["s1", "s2"]);
    assert.equal(got.groups, 2);
    assert.equal((got as { duplicates?: number }).duplicates, undefined);
  });
  test("D7 (b) a part with no counts row (no rows at all) counts as 0: with a part's dup 2, duplicates 2", async () => {
    const got = await viaRows({ s1: local("db1", []), s2: local("db2", [{ cohort: "A", study: "s2", n: 3, all: 4, dup: 2 }]) }, ["s1", "s2"]);
    assert.equal((got as { duplicates?: number }).duplicates, 2);
    assert.equal(got.all, 4);
  });
  test("D7 (c) a dup given as the string \"3\": not a valid dup, so no duplicates", async () => {
    const asText = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: "3" as unknown as number }]) }, ["s1"]);
    assert.equal((asText as { duplicates?: number }).duplicates, undefined, "a string dup");
  });
  test("D7 (c) a dup that is not an integer from 0 to all (more than all, negative, fractional): no duplicates", async () => {
    const over = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 6 }]) }, ["s1"]);
    assert.equal((over as { duplicates?: number }).duplicates, undefined, "dup > all");
    for (const bad of [-1, 1.5]) {
      const got = await viaRows({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: bad }]) }, ["s1"]);
      assert.equal((got as { duplicates?: number }).duplicates, undefined, "dup " + bad);
    }
  });
  test("D7 keyOnFirstRun: a page or a column's values drop the duplicate key (no dup in the counts SQL); the first run keeps it", () => {
    const f = rowsLib.keyOnFirstRun as unknown;
    assert.equal(typeof f, "function", "lib/views/rows.ts exports keyOnFirstRun");
    const k = f as (ctx: Record<string, unknown>, s: RowSource) => RowSource;
    assert.equal(k({ page: { offset: 25, limit: 25 } }, keyed).duplicateKey, undefined);
    assert.equal(k({ values: "proteinChange" }, keyed).duplicateKey, undefined);
    assert.doesNotMatch(countsSql(k({ page: { offset: 25, limit: 25 } }, keyed), {}, ["name"]), /AS dup/);
    assert.deepEqual(k({}, keyed), keyed);
    assert.equal(k({}, keyed).duplicateKey, "(study, patient, x)");
  });
  test("D7 the sv view's result carries duplicates (summed across databases), with total and all as before", async () => {
    const r = await sv({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 1 }]), s2: local("db2", [{ cohort: "A", study: "s2", n: 3, all: 4, dup: 2 }]) }, ["s1", "s2"]);
    assert.equal(r.duplicates, 3);
    assert.equal(r.total, 5);
    assert.equal(r.all, 9);
  });
  test("D7 the mutations view's result carries duplicates", async () => {
    const r = await mutations({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 3 }]) }, ["s1"]);
    assert.equal(r.duplicates, 3);
  });
  test("D7 dup 0: the views' results have no duplicates", async () => {
    assert.equal((await sv({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 0 }]) }, ["s1"])).duplicates, undefined);
    assert.ok(!("duplicates" in await mutations({ s1: local("db1", [{ cohort: "A", study: "s1", n: 2, all: 5, dup: 0 }]) }, ["s1"])));
  });
});
