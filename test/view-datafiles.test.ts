// The datafiles view (lib/views/datafiles/): cBioPortal's Results-page Download tab — its files, its
// frequencies and its case table. The runner is driven with hand-made participants whose answers live
// in memory; the SQL is checked for what each statement must hold (its numbers against the public
// warehouse are in the view snapshot and the PR's cross-check with cbioportal.org).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runDatafiles, checkLines, heldTypes, fileList, frequencies } from "../lib/views/datafiles/run.ts";
import { datafilesCountsSql, lineProfiled, lineCtes, type LinePlan } from "../lib/views/datafiles/sql.ts";
import { statusRowSource, matrixRowSource, statusColumns, lineColumns } from "../lib/views/datafiles/tables.ts";
import { datafilesKind } from "../lib/views/datafiles/kind.ts";
import { oqlCasesSql, oqlEventsSql } from "../lib/oql.ts";
import { pagedTable } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { DatafilesView, DatafilesResult } from "../lib/views/datafiles/types.ts";

const p = (profile: string, type: string, datatype: string, order = 0): ProfileInfo => ({ profile, type, datatype, name: profile + " name", order });
const BRCA: ProfileInfo[] = [p("mutations", "MUTATION_EXTENDED", "MAF"), p("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 1), p("log2CNA", "COPY_NUMBER_ALTERATION", "LOG2-VALUE", 2),
  p("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS", 3), p("rppa", "PROTEIN_LEVEL", "LOG2-VALUE", 4), p("structural_variants", "STRUCTURAL_VARIANT", "SV", 5),
  p("armlevel_cna", "GENERIC_ASSAY", "CATEGORICAL", 6)];
const lines: LinePlan[] = [{ line: "TP53", gene: "TP53", types: ["MUTATION", "CNA", "SV"] }, { line: "KRAS: MUT", gene: "KRAS", types: ["MUTATION"] }];

describe("checkLines: one gene's OQL entry per line", () => {
  test("reads each line's gene and data types", () => {
    assert.deepEqual(checkLines(["TP53", " KRAS: MUT AMP "]), [{ line: "TP53", gene: "TP53", specs: ["ANY"] }, { line: "KRAS: MUT AMP", gene: "KRAS", specs: ["MUT", "CNA"] }]);
  });
  test("refuses what is not a query, names the problem", () => {
    assert.match(String(checkLines([])), /one OQL entry per line/);
    assert.match(String(checkLines(["TP53", 3])), /one OQL entry per line/);
    assert.match(String(checkLines(["TP53; KRAS"])), /names 2 genes; give each gene its own line/);
    assert.match(String(checkLines(Array.from({ length: 33 }, (_, i) => "G" + i))), /at most 32 lines; this has 33 — remove 1/);
    assert.match(String(checkLines(["TP53: GAIN"])), /oql line "TP53: GAIN"/);
  });
});

describe("what a study holds and offers", () => {
  test("data types from its profiles: a log2 profile alone is not discrete copy number", () => {
    assert.deepEqual(heldTypes(BRCA), ["MUTATION", "CNA", "SV"]);
    assert.deepEqual(heldTypes([p("log2CNA", "COPY_NUMBER_ALTERATION", "LOG2-VALUE")]), []);
  });
  test("files in the portal's order, each naming the studies that hold it; generic assays are not offered", () => {
    const fs = fileList({ a: BRCA, b: [p("mutations", "MUTATION_EXTENDED", "MAF"), p("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS")] }, ["a", "b"]);
    assert.deepEqual(fs.map((f) => f.id), ["mutations", "sv", "profile:gistic", "profile:log2CNA", "profile:rna_seq_v2_mrna", "profile:rppa"]);
    assert.deepEqual(fs.find((f) => f.id === "sv")!.studies, ["a"]);
    assert.deepEqual(fs.find((f) => f.id === "profile:rna_seq_v2_mrna")!.studies, ["a", "b"]);
    assert.deepEqual(fs.find((f) => f.id === "profile:gistic")!.matrix, { kind: "profile", profile: "gistic", discrete: true });
    assert.match(fs.find((f) => f.id === "profile:gistic")!.description, /NP when its panel/);
    assert.doesNotMatch(fs.find((f) => f.id === "profile:log2CNA")!.description, /NP/);
  });
  test("frequencies add counts across studies, never percentages", () => {
    const f = frequencies([{ line: "TP53", gene: "TP53" }], [{ alt_0: 1, prof_0: 2, off_0: 0 }, { alt_0: 10, prof_0: 100, off_0: 1 }]);
    assert.deepEqual(f, [{ line: "TP53", gene: "TP53", altered: 11, profiled: 102, percent: 10.8, offPanel: 1 }]);
    assert.equal(frequencies([{ line: "X", gene: "X" }], [{}])[0].percent, null);
  });
});

describe("SQL", () => {
  test("oqlCasesSql is unchanged by the events variant; oqlEventsSql reads the same conditions row by row", () => {
    const o = { study: "s", db: "d" };
    const cases = oqlCasesSql("TP53: MUT AMP", { ...o, unit: "sample" });
    assert.match(cases, /^\(SELECT DISTINCT replaceOne\(g\.sample_unique_id, 's_', ''\) AS pid\n/);
    const ev = oqlEventsSql("TP53: MUT AMP", o);
    assert.match(ev, /AS sid, multiIf\(g\.variant_type = 'mutation', 1, .*\) AS o, multiIf\(.*'AMP', 'HOMDEL'\), g\.sv_event_info\) AS ev\n/);
    // same FROM and WHERE: only the selected columns differ
    const tail = (s: string) => s.split("\n").slice(1).join("\n");
    assert.equal(tail(ev), tail(cases));
    assert.match(oqlEventsSql("TP53: MUT_(100-200)", o), /AS sid, 1 AS o, g\.mutation_variant AS ev/);
    assert.match(oqlEventsSql("TP53: EXP>2", { ...o, profiles: ["rna_seq_v2_mrna_median_Zscores"] }), /AS sid, 4 AS o, 'EXP HIGH' AS ev/);
    assert.match(oqlEventsSql("TP53: EXP<-2", { ...o, profiles: ["rna_seq_v2_mrna_median_Zscores"] }), /'EXP LOW' AS ev/);
  });
  test("profiled: any type for the frequency, every type to be unaltered; no type read is every sample", () => {
    const pr = lineProfiled("d", lines[0], "s.sid");
    assert.match(pr.any, / OR /);
    assert.match(pr.every, / AND /);
    assert.deepEqual(lineProfiled("d", { line: "X: EXP>1", gene: "X", types: [] }, "s.sid"), { any: "1", every: "1" });
  });
  test("the counts are one row of counts per study", () => {
    const sql = datafilesCountsSql("SELECT pid, sid FROM x", lines, { study: "s", db: "d", pin: null, profiles: [] });
    assert.match(sql, /SELECT count\(\) AS n, countIf\(\(a0 OR a1\)\) AS altered, countIf\(NOT \(a0 OR a1\) AND \(f0 AND f1\)\) AS unaltered/);
    assert.match(sql, /countIf\(a1 AND p1\) AS alt_1, countIf\(p1\) AS prof_1, countIf\(a1 AND NOT p1\) AS off_1/);
    // one profiled CTE per gene and type, shared by the lines that read it
    assert.equal((sql.match(/d_prof_TP53_MUTATION AS/g) || []).length, 1);
  });
  test("status tables: columns, status order, and the lists keep their own samples", () => {
    const parts = [{ cohort: "C", study: "s", cohortSql: "SELECT pid, sid FROM x" }];
    const plan = () => ({ lines, opts: { study: "s", db: "d", pin: null, profiles: [] } });
    const cases = statusRowSource("cases", parts, lines, plan);
    assert.deepEqual(cases.columns.map((c) => c.id), ["sample", "patient", "altered", "TP53", "KRAS"]);
    assert.equal(cases.columns.find((c) => c.id === "altered")!.order, "rank");
    assert.match(cases.with, /multiIf\(ev0 != '' OR ev1 != '', 'altered', pf0 AND pf1, 'unaltered', 'not profiled'\) AS status/);
    assert.match(statusRowSource("unaltered", parts, lines, plan).with, /WHERE status = 'unaltered'\)\n$/);
    assert.match(statusRowSource("altered", parts, lines, plan).with, /WHERE status = 'altered'\)\n$/);
    assert.deepEqual(statusRowSource("matrix", parts, lines, plan).columns.map((c) => c.text), ["sid", "multiIf(status = 'altered', '1', status = 'unaltered', '0', 'NP')", "m0", "m1"]);
    assert.throws(() => statusRowSource("cases", [], lines, plan), /at least one part/);
    assert.deepEqual(lineColumns([{ line: "TP53", gene: "TP53" }, { line: "TP53: AMP", gene: "TP53" }]).map((c) => c.id), ["TP53_1", "TP53_2"]);
    assert.deepEqual(statusColumns("altered", lines).map((c) => c.id), ["sample", "patient"]);
  });
  test("matrices: WT / NA for none, NP only where panels decide, the profile named", () => {
    const parts = [{ cohort: "C", study: "s", cohortSql: "SELECT pid, sid FROM x" }];
    const mut = matrixRowSource({ kind: "mutations" }, parts, ["TP53"], "d");
    assert.match(mut.with, /'NP', if\(countIf\(v\.gene = 'TP53'\) > 0, anyIf\(v\.val, v\.gene = 'TP53'\), 'WT'\)\) AS g0/);
    assert.match(mut.with, /NOT LIKE '%uncalled%'/);
    assert.match(matrixRowSource({ kind: "sv" }, parts, ["TP53"], "d").with, /variant_type = 'structural_variant'[\s\S]*'NA'\)\) AS g0/);
    const mrna = matrixRowSource({ kind: "profile", profile: "rna_seq_v2_mrna", discrete: false }, parts, ["TP53"], "d");
    assert.match(mrna.with, /profile_type = 'rna_seq_v2_mrna'/);
    assert.doesNotMatch(mrna.with, /'NP'/);
    assert.match(matrixRowSource({ kind: "profile", profile: "gistic", discrete: true }, parts, ["TP53"], "d").with, /'NP'/);
    assert.deepEqual(mut.columns.map((c) => c.id), ["sample", "patient", "TP53"]);
    assert.throws(() => matrixRowSource({ kind: "sv" }, [], ["TP53"], "d"), /at least one part/);
  });
});

// ---- the runner ----------------------------------------------------------------------------------
type Row = Record<string, unknown>;
const base = (label: string) => label.replace(/:(rows|counts|values|rank)$/, "");
/** a participant whose tables are `rows` (by label) and whose counts are `counts` */
function local(conn: string, rows: (label: string, src: RowSource) => Row[], counts: Row, catalog = BRCA) {
  const asked: string[] = [];
  return {
    asked, catalog,
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    viewAggregate: async (l: string) => { asked.push(l); return [counts]; },
    rowsPage: async (l: string, source: (db: string) => RowSource, _q: TableQuery, _d: string[], limit: number, offset: number) => {
      asked.push(l);
      return { rows: rows(base(l), source(conn)).slice(offset, offset + limit), total: 0 };
    },
    rowsCounts: async (l: string, source: (db: string) => RowSource) => {
      asked.push(l);
      const rs = rows(base(l), source(conn));
      return rs.length ? [{ cohort: String(rs[0].cohort), study: String(rs[0].study), n: rs.length, all: rs.length }] : [];
    },
    rowsValues: async (l: string) => { asked.push(l); return [{ v: "altered", n: 1 }]; },
    rowsRank: async () => null,
  };
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, ReturnType<typeof local> | object>, extra: Partial<ViewRun> = {}): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async (st: string) => ({ profiles: [], gaProfiles: [], catalog: (resolvers[st] as { catalog?: ProfileInfo[] }).catalog || [] }), ...extra,
  };
}
const run = (view: Partial<DatafilesView>, c: ViewRun) => runDatafiles({ kind: "datafiles", oql: ["TP53", "KRAS: MUT"], ...view } as DatafilesView, c);
const df = (v: ViewResult) => (v as ViewResult & { datafiles: DatafilesResult }).datafiles;
const caseRow = (study: string, sid: string, status: string, c0: string, c1: string): Row =>
  ({ cohort: "Q", study, patient: sid.slice(0, -3), sid, status, c0, c1, m0: c0 === "no alteration" ? "0" : c0 === "not profiled" ? "NP" : "1", m1: "0" });
const S1 = [caseRow("s1", "A-01", "altered", "R175H", "no alteration"), caseRow("s1", "B-01", "unaltered", "no alteration", "no alteration"), caseRow("s1", "C-01", "not profiled", "not profiled", "no alteration")];

describe("runDatafiles", () => {
  test("counts, frequencies, files and the case table's first page", async () => {
    const r1 = local("c1", (l) => l === "datafiles:cases" ? S1 : [], { n: 3, altered: 1, unaltered: 1, alt_0: 1, prof_0: 2, off_0: 0, alt_1: 0, prof_1: 3, off_1: 0 });
    const v = await run({}, ctx({ Q: cohort({ s1: 3 }) }, { s1: r1 }));
    assert.equal(v.error, undefined);
    const d = df(v);
    assert.deepEqual(d.counts, { samples: 3, altered: 1, unaltered: 1, unprofiled: 1 });
    assert.deepEqual(d.frequency.map((f) => [f.line, f.altered, f.profiled, f.percent]), [["TP53", 1, 2, 50], ["KRAS: MUT", 0, 3, 0]]);
    assert.deepEqual(d.files.map((f) => [f.id, f.rows]), [["mutations", 3], ["sv", 3], ["profile:gistic", 3], ["profile:log2CNA", 3], ["profile:rna_seq_v2_mrna", 3], ["profile:rppa", 3],
      ["altered", 1], ["unaltered", 1], ["matrix", 3]]);
    assert.deepEqual(d.lines, [{ line: "TP53", gene: "TP53", column: "TP53" }, { line: "KRAS: MUT", gene: "KRAS", column: "KRAS" }]);
    assert.deepEqual(d.rows.map((r) => r.values), [["A-01", "A", "altered", "R175H", "no alteration"], ["B-01", "B", "unaltered", "no alteration", "no alteration"],
      ["C-01", "C", "not profiled", "not profiled", "no alteration"]]);
    assert.match(String(v.caveat), /alters 1 sample \(33\.3%\) of the cohort's 3 samples; 1 sample are unaltered .* and 1 sample are neither/);
    assert.ok(v.method && v.method.steps.length === 4);
    assert.deepEqual(r1.asked.sort(), ["datafiles:cases:counts", "datafiles:cases:rows", "datafiles:counts"]);
    // the results text names every file and frequency
    const out: string[] = [];
    datafilesKind.text!(v as never, { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" });
    assert.match(out[0], /Mutations \(OQL is not in effect\) \(3 rows\)[\s\S]*TP53 1 of 2 profiled \(50%\)/);
    assert.equal(datafilesKind.title!(v as never), "Downloadable data files for TP53, KRAS: MUT");
    assert.equal(pagedTable(v), d);
  });
  test("a file's table alone, by name; its rows read as the file's columns", async () => {
    const r1 = local("c1", (l) => l === "datafiles:mutations" ? [{ cohort: "Q", study: "s1", patient: "A", sid: "A-01", g0: "R175H", g1: "WT" }]
      : l === "datafiles:matrix" ? S1 : [], {});
    const c = ctx({ Q: cohort({ s1: 3 }) }, { s1: r1 }, { table: "mutations" });
    const v = await run({}, c);
    const t = df(v).tables.mutations!;
    assert.deepEqual(t.columns.map((x) => x.id), ["sample", "patient", "TP53", "KRAS"]);
    assert.deepEqual(t.rows[0].values, ["A-01", "A", "R175H", "WT"]);
    assert.equal(pagedTable(v, "mutations"), t);
    const m = df(await run({}, { ...c, table: "matrix" })).tables.matrix!;
    assert.deepEqual(m.rows.map((r) => r.values), [["A-01", "1", "1", "0"], ["B-01", "0", "0", "0"], ["C-01", "NP", "NP", "0"]]);
    assert.ok(!r1.asked.includes("datafiles:counts"), "a file's table asks for no counts");
    // a page of the case table is that table alone
    const pg = await run({}, { ...c, table: undefined, page: { offset: 0, limit: 2 } });
    assert.equal(df(pg).frequency.length, 0);
  });
  test("loud refusals", async () => {
    const r1 = local("c1", () => [], {});
    const one = { Q: cohort({ s1: 3 }) };
    assert.match(String((await run({}, ctx({ Q: cohort({ s1: 1 }), R: cohort({ s1: 1 }) }, { s1: r1 }))).error), /one cohort's files; this one draws 2/);
    assert.match(String((await run({ oql: [] }, ctx(one, { s1: r1 }))).error), /one OQL entry per line/);
    assert.match(String((await run({ rows: 0 }, ctx(one, { s1: r1 }))).error), /rows \(the page size of the case table\) is 1 to 1000/);
    assert.match(String((await run({ columns: ["nope"] }, ctx(one, { s1: r1 }))).error), /unknown column nope/);
    assert.match(String((await run({}, ctx(one, { s1: r1 }, { table: "profile:methylation" }))).error), /table is one of cases, altered, unaltered, matrix, mutations, sv, profile:gistic/);
    const agg = { instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } };
    assert.match(String((await run({}, ctx(one, { s1: agg }))).error), /no study here may disclose patients' samples \(s1: aggregate-only/);
    const failing = { ...local("c1", () => [], {}), viewAggregate: async () => { throw new Error("warehouse down"); } };
    assert.match(String((await run({}, ctx(one, { s1: failing }))).error), /warehouse down/);
  });
  test("several studies: counts added, a file only some studies hold names them", async () => {
    const r1 = local("c1", () => [], { n: 2, altered: 1, unaltered: 1, alt_0: 1, prof_0: 2, alt_1: 0, prof_1: 2 });
    const r2 = local("c1", () => [], { n: 5, altered: 2, unaltered: 1, alt_0: 2, prof_0: 4, off_0: 1, alt_1: 0, prof_1: 5 }, [p("mutations", "MUTATION_EXTENDED", "MAF")]);
    const v = await run({}, ctx({ Q: cohort({ s1: 2, s2: 5 }) }, { s1: r1, s2: r2 }));
    const d = df(v);
    assert.deepEqual(d.counts, { samples: 7, altered: 3, unaltered: 2, unprofiled: 2 });
    assert.equal(d.frequency[0].percent, 50);
    assert.deepEqual(d.files.find((f) => f.id === "sv")!.studies, ["s1"]);
    assert.equal(d.files.find((f) => f.id === "sv")!.rows, 2);
    assert.equal(d.files.find((f) => f.id === "mutations")!.studies, undefined);
    assert.match(String(v.caveat), /counts added across studies[\s\S]*TP53: 1 altered sample outside its panel's coverage/);
  });
  test("exp / prot name the profile an expression line reads; a malformed one is refused", async () => {
    const sql = lineCtes("p", "cohort", [{ line: "TP53: EXP>2", gene: "TP53", types: [] }],
      { study: "s1", db: "c1", pin: null, profiles: ["mrna_median_Zscores", "rna_seq_v2_mrna_median_Zscores"], pins: { EXP: "rna_seq_v2_mrna_median_Zscores" } });
    assert.match(sql, /ga\.profile_type = 'rna_seq_v2_mrna_median_Zscores'/);
    const r1 = local("c1", () => [], { n: 1, altered: 0, unaltered: 1 });
    assert.match(String((await run({ oql: ["TP53: EXP>2"], exp: "not a profile" }, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 }))).error),
      /exp names the profile the lines' EXP alterations read/);
    const ok = await run({ oql: ["TP53: EXP>2"], exp: "rna_seq_v2_mrna_median_Zscores" }, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 },
      { studyProfiles: async () => ({ profiles: ["rna_seq_v2_mrna_median_Zscores"], gaProfiles: [], catalog: BRCA }) }));
    assert.equal(ok.error, undefined);
    // ifHeld: a study without the profile is let through (its lines' EXP matches nothing there)
    const lenient = lineCtes("p", "cohort", [{ line: "TP53: EXP>2", gene: "TP53", types: [] }],
      { study: "s1", db: "c1", pin: null, profiles: ["mrna_median_Zscores"], pins: { EXP: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true } });
    assert.match(lenient, /ga\.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores'/);
    const held = await run({ oql: ["TP53: EXP>2"], exp: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true }, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 },
      { studyProfiles: async () => ({ profiles: ["mrna_median_Zscores"], gaProfiles: [], catalog: BRCA }) }));
    assert.equal(held.error, undefined);
    assert.match(String((await run({ oql: ["TP53: EXP>2"], exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: 1 } as never, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 }))).error), /ifHeld is true or left out/);
    assert.match(String((await run({ oql: ["TP53: EXP>2"], ifHeld: true }, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 }))).error), /name exp or prot/);
  });
  test("an expression line is named as unchecked for profiling", async () => {
    const r1 = local("c1", () => [], { n: 1, altered: 0, unaltered: 1 });
    const v = await run({ oql: ["TP53: EXP>2"] }, ctx({ Q: cohort({ s1: 1 }) }, { s1: r1 },
      { studyProfiles: async () => ({ profiles: ["rna_seq_v2_mrna_median_Zscores"], gaProfiles: [], catalog: BRCA }) }));
    assert.equal(v.error, undefined);
    assert.deepEqual(df(v).unchecked, ["TP53: EXP>2"]);
    assert.match(String(v.caveat), /Expression or protein conditions \(TP53: EXP>2\) cannot be checked/);
  });
});
