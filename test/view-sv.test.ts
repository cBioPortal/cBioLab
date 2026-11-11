// The structural-variants view (lib/views/sv/run.ts): its spec checks, its rows, the panel-aware
// counts behind its caveat, and who answers — against stand-in participants, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSv, svGenes } from "../lib/views/sv/run.ts";
import { SV_COLUMNS, svRowSource } from "../lib/sv-table.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { RowSource, TableQuery } from "../lib/table-query.ts";
import type { SvView, SvResult } from "../lib/views/sv/types.ts";

type Row = Record<string, unknown>;
const ROWS: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", sid: "S1", cancerType: "Lung Adenocarcinoma", gene1: "ALK", gene2: "EML4", oncogenicity: "Oncogenic", level: "LEVEL_1", drv: 1,
    connectionType: "3to3", eventInfo: "EML4-ALK", class: "INVERSION", site1Pos: 29446394, tumorVariantCount: "12" },
  { cohort: "A", study: "s1", patient: "P2", sid: "S2", cancerType: "", gene1: "RET", gene2: "", oncogenicity: "", level: "", drv: 0,
    connectionType: "NA", eventInfo: "RET intragenic", class: "DELETION", site1Pos: null, tumorVariantCount: null },
];

/** a patient-level participant holding ROWS, which records what it was asked and the SQL it was handed */
function local(opts: { fail?: string; profiled?: Row[] } = {}) {
  const asked: string[] = [], sql: string[] = [];
  const rows = (src: RowSource, q: TableQuery) => (sql.push(src.with), q.search ? ROWS.filter((r) => JSON.stringify(r).includes(q.search!)) : ROWS);
  return {
    asked, sql,
    instance: { id: "db1", mode: "patient-level", label: "Local", conn: { id: "db1", db: "db1" } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], limit: number, offset: number) => {
      asked.push(l);
      if (opts.fail) throw new Error(opts.fail);
      return { rows: rows(source("db1"), q).slice(offset, offset + limit), total: 0 };
    },
    rowsCounts: async (l: string, source: (db: string) => RowSource, q: TableQuery) => {
      asked.push(l);
      return [{ cohort: "A", study: "s1", n: rows(source("db1"), q).length, all: ROWS.length }];
    },
    rowsValues: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], column: string) => {
      asked.push(l);
      return rows(source("db1"), q).map((r) => ({ v: String(r[column]), n: 1, lo: String(r[column]), hi: String(r[column]) }));
    },
    viewAggregate: async (l: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(l); sql.push(build("SELECT 1", "s1", "db1"));
      return opts.profiled ?? [{ gene: "ALK", samples: 10, profiled: 8, altered: 2, altered_profiled: 1 }];
    },
  };
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(resolvers: Record<string, unknown>, extra: Partial<ViewRun> = {}, cohorts: Record<string, EvaluatedCohort> = { A: cohort({ s1: 10 }) }): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7.5", studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), ...extra,
  };
}
const run = (view: Partial<SvView>, c: ViewRun) => runSv({ kind: "sv", genes: ["ALK", "RET"], ...view } as SvView, c);
const sv = (v: ViewResult) => (v as ViewResult & { sv: SvResult }).sv;
const col = (id: string) => SV_COLUMNS.findIndex((c) => c.id === id);

test("genes: symbols, upper-cased and de-duplicated in order; anything else is refused by name", () => {
  assert.deepEqual(svGenes(["alk", " RET", "ALK"]), ["ALK", "RET"]);
  assert.match(String(svGenes([])), /needs genes/);
  assert.match(String(svGenes("ALK")), /needs genes/);
  assert.match(String(svGenes(["ALK", 7])), /7 is not one/);
  assert.match(String(svGenes(Array.from({ length: 33 }, (_, i) => "G" + i))), /at most 32 genes; this names 33/);
});

test("refusals: too many cohorts, a bad page size, a bad column, no participant that may list patients", async () => {
  const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => ["C" + i, cohort({ s1: 1 })]));
  assert.match(String((await run({}, ctx({ s1: local() }, {}, many))).error), /at most 6 cohorts/);
  assert.match(String((await run({ genes: [] }, ctx({ s1: local() }))).error), /needs genes/);
  assert.match(String((await run({ rows: 0 }, ctx({ s1: local() }))).error), /rows \(the page size\) is 1 to 1000/);
  assert.match(String((await run({ sort: { column: "nope" } }, ctx({ s1: local() }))).error), /nope/);
  const agg = { instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } };
  assert.match(String((await run({}, ctx({ s1: agg }))).error), /no study here may disclose patients' structural variants \(s1: aggregate-only/);
  assert.match(String((await run({}, ctx({ s1: local({ fail: "boom" }) }))).error), /boom/);
});

test("a page of rows in the portal's columns, the annotation spelled out, numbers as numbers, and the profiling counts in the caveat", async () => {
  const r = local();
  const v = await run({}, ctx({ s1: r }));
  assert.equal(v.error, undefined);
  const t = sv(v);
  assert.deepEqual(t.genes, ["ALK", "RET"]);
  assert.deepEqual(t.shown, ["sample", "cancerType", "gene1", "gene2", "annotation", "connectionType", "eventInfo", "class"]);
  assert.equal(t.total, 2);
  assert.deepEqual([t.rows[0].sample, t.rows[0].patient], ["S1", "P1"]);
  assert.equal(t.rows[0].values[col("annotation")], "Oncogenic · Level 1");
  assert.equal(t.rows[1].values[col("annotation")], "");
  assert.equal(t.rows[0].values[col("tumorVariantCount")], 12);
  assert.equal(t.rows[1].values[col("site1Pos")], null);
  assert.equal(t.rows[1].values[col("gene2")], "");
  // the profiling counts: the cohort's own sample count, and a gene the answer leaves out is zero, not missing
  assert.deepEqual(t.profiled, [
    { cohort: "A", study: "s1", gene: "ALK", samples: 10, profiled: 8, altered: 2, alteredProfiled: 1 },
    { cohort: "A", study: "s1", gene: "RET", samples: 10, profiled: 0, altered: 0, alteredProfiled: 0 },
  ]);
  assert.match(v.caveat!, /ALK: 2 samples with a call, 8 of 10 profiled \(1 of the samples with a call are on a panel that omits ALK: reported through the partner gene\); RET: 0 samples with a call, 0 of 10 profiled/);
  assert.match(v.caveat!, /OncoKB v7\.5's gene-level fusion call/);
  assert.ok(r.asked.includes("sv:profiled:A"), "the counts go through the view aggregates");
  assert.ok(v.method!.steps.some((s) => /profiled/.test(s.title)));
  // the row source reads both partners by Entrez id and the store's fusion calls at the pin
  const src = r.sql.find((s) => s.includes("structural_variant sv"))!;
  assert.match(src, /sv\.site1_entrez_gene_id IN \(SELECT entrez_gene_id FROM db1\.gene WHERE hugo_gene_symbol IN \('ALK', 'RET'\)\) OR sv\.site2_entrez_gene_id IN/);
  assert.match(src, /alteration_type = 'SV' AND alteration = 'Fusion'/);
});

test("several cohorts each get their own counts; a page or a column's values asks no counts", async () => {
  const two = await run({ genes: ["ALK"] }, ctx({ s1: local() }, {}, { A: cohort({ s1: 10 }), B: cohort({ s1: 4 }) }));
  assert.match(two.caveat!, /“A” — ALK: .*\. “B” — ALK: .* of 4 profiled/);
  const r = local();
  const page = await run({}, ctx({ s1: r }, { page: { offset: 1, limit: 1 } }));
  assert.equal(sv(page).rows.length, 1);
  assert.equal(sv(page).profiled, undefined);
  assert.equal(page.method, undefined);
  assert.ok(!r.asked.some((l) => l.startsWith("sv:profiled")));
  const values = await run({}, ctx({ s1: local() }, { values: "class" }));
  assert.deepEqual((sv(values).values as unknown as { values: { value: string }[] }).values.map((x) => x.value).sort(), ["DELETION", "INVERSION"]);
});

test("without a pin the annotation is empty and the caveat says so", async () => {
  const r = local();
  const v = await run({}, ctx({ s1: r }, { pin: null }));
  assert.match(v.caveat!, /No OncoKB version is pinned here/);
  assert.doesNotMatch(r.sql.find((s) => s.includes("structural_variant sv"))!, /annotation\.oncokb/);
  assert.throws(() => svRowSource([], "db", ["ALK"], null), /at least one part/);
  assert.throws(() => svRowSource([{ cohort: "c", study: "s", cohortSql: "SELECT 1" }], "db", [], null), /at least one gene/);
});
