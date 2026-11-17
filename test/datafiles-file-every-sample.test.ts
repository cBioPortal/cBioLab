// The Download tab's gene-by-sample files (docs/legacy-spec/10-results-download.md). The portal's
// selected files — mutations, sv and cna — hold every queried sample, with "NP" in every gene column
// for a study without that kind of profile (RDL-STM-4). Every other profile:<id> file lists only the
// samples of the studies that hold it and never writes NP (RDL-STM-5). cna.txt reads each study's own
// first discrete copy-number profile.
//
// | case | input                                                                    | expected                                                                                  |
// |------|--------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
// | E1   | matrixRowSource, parts s1 + s2, holds(part) true only for s1; mutations, sv, cna | source tables read for s1's part only (same count as s1 alone)                      |
// | E2   | same, the s2 part                                                        | s2's cohort SQL is still read; its gene columns are 'NP'                                  |
// | E3   | holds true for every part (all kinds)                                    | SQL identical to calling without holds                                                    |
// | E4   | without holds (all kinds)                                                | every part reads the source tables                                                        |
// | E5   | runDatafiles: s1 (2 samples) holds mutations, s2 (5) does not             | mutations: rows 7; studies ["s1"]; description ends "; NP throughout for a study without it" |
// | E6   | same run, sv (only s1 holds)                                             | sv: rows 7; studies ["s1"]; same suffix                                                   |
// | E7   | same studies, ctx.table "mutations" (its page)                           | rows from s1 and s2; s2's page SQL is NP-only ('NP' AS g0, no mutation_derived)           |
// | E8   | everySample                                                              | true for mutations / sv / cna, false for profile                                          |
// | E9   | same run, a continuous mRNA profile only s1 holds                        | rows 2 (s1's); studies ["s1"]; no "NP throughout" suffix                                  |
// | E10  | same studies, ctx.table "profile:<that mRNA>" (its page)                 | only s1's resolver is asked; no NP anywhere in its SQL                                    |
// | E11  | s1's first discrete CNA is "gistic", s2's is "cna"                       | file "cna", profiles { s1: "gistic", s2: "cna" }, no studies; no profile:gistic / profile:cna |
// | E12  | matrixRowSource on that cna file, parts s1 + s2                          | s1's part reads profile_type 'gistic', s2's reads 'cna'                                   |
//
// The SQL is ClickHouse SQL and the repo's tests have no in-process engine, so it is checked as text,
// not run.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matrixRowSource, everySample, type MatrixFile } from "../lib/views/datafiles/tables.ts";
import { fileList, runDatafiles } from "../lib/views/datafiles/run.ts";
import type { TablePart } from "../lib/mutation-table.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { DatafilesView, DatafilesResult } from "../lib/views/datafiles/types.ts";

const CNA: MatrixFile = { kind: "cna", profiles: { s1: "gistic", s2: "cna" } };
const NP_KINDS: [string, MatrixFile, RegExp][] = [
  ["mutations", { kind: "mutations" }, /mutation_derived/g],
  ["sv", { kind: "sv" }, /genomic_event_derived|mutation_derived/g],
  ["cna", CNA, /genetic_alteration_derived/g],
];
const ALL_KINDS: [string, MatrixFile, RegExp][] = [...NP_KINDS,
  ["profile continuous", { kind: "profile", profile: "rna_seq_v2_mrna", discrete: false }, /genetic_alteration_derived/g],
  ["profile discrete", { kind: "profile", profile: "rae", discrete: true }, /genetic_alteration_derived/g],
];
const P1: TablePart = { cohort: "C", study: "s1", cohortSql: "SELECT pid, sid FROM cohort_one" };
const P2: TablePart = { cohort: "C", study: "s2", cohortSql: "SELECT pid, sid FROM cohort_two" };
const GENES = ["TP53", "KRAS"];
const count = (s: string, re: RegExp) => (s.match(re) || []).length;
const only1 = (part: TablePart) => part.study === "s1";

describe("matrixRowSource with holds", () => {
  for (const [name, f, src] of NP_KINDS) {
    test(`E1/E2 ${name}: a part that does not hold the profile reads none of its tables and is NP`, () => {
      const alone = matrixRowSource(f, [P1], GENES, "d").with;
      const both = matrixRowSource(f, [P1, P2], GENES, "d", only1);
      assert.ok(count(alone, src) > 0, "the holding study reads its source table");
      assert.equal(count(both.with, src), count(alone, src), "no source-table read for s2");
      assert.match(both.with, /cohort_two/);
      assert.match(both.with, /'NP' AS g0/);
      assert.match(both.with, /'NP' AS g1/);
      assert.deepEqual(both.columns.map((c) => c.id), ["sample", "patient", "TP53", "KRAS"]);
    });
  }
  for (const [name, f, src] of ALL_KINDS) {
    test(`E3/E4 ${name}: holds true everywhere, or left out, changes nothing`, () => {
      const plain = matrixRowSource(f, [P1, P2], GENES, "d");
      assert.equal(matrixRowSource(f, [P1, P2], GENES, "d", () => true).with, plain.with);
      assert.equal(count(plain.with, src), 2 * count(matrixRowSource(f, [P1], GENES, "d").with, src));
    });
  }
  test("E8 everySample: the portal's selected files only", () => {
    assert.equal(everySample({ kind: "mutations" }), true);
    assert.equal(everySample({ kind: "sv" }), true);
    assert.equal(everySample(CNA), true);
    assert.equal(everySample({ kind: "profile", profile: "rna_seq_v2_mrna", discrete: false }), false);
    assert.equal(everySample({ kind: "profile", profile: "rae", discrete: true }), false);
  });
  test("E12 cna: each part reads its own study's selected profile", () => {
    const sql = matrixRowSource(CNA, [P1, P2], GENES, "d").with;
    assert.match(sql, /profile_type = 'gistic'/);
    assert.match(sql, /profile_type = 'cna'/);
    // s1's 'gistic' read comes with s1's cohort, s2's 'cna' with s2's
    const one = matrixRowSource(CNA, [P1], GENES, "d").with;
    assert.match(one, /profile_type = 'gistic'/);
    assert.doesNotMatch(one, /profile_type = 'cna'/);
    const two = matrixRowSource(CNA, [P2], GENES, "d").with;
    assert.match(two, /profile_type = 'cna'/);
    assert.doesNotMatch(two, /profile_type = 'gistic'/);
  });
});

// ---- the runner (stubs as in test/view-datafiles.test.ts) ----
type Row = Record<string, unknown>;
const p = (profile: string, type: string, datatype: string, order = 0, name = profile + " name"): ProfileInfo => ({ profile, type, datatype, name, order });
const S1_CAT: ProfileInfo[] = [p("mutations", "MUTATION_EXTENDED", "MAF"), p("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 1),
  p("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS", 2), p("sv", "STRUCTURAL_VARIANT", "SV", 3)];
const S2_CAT: ProfileInfo[] = [p("cna", "COPY_NUMBER_ALTERATION", "DISCRETE", 1)];
function local(conn: string, counts: Row, catalog: ProfileInfo[]) {
  return {
    catalog,
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    viewAggregate: async () => [counts],
    rowsPage: async (_l: string, _s: (db: string) => RowSource, _q: TableQuery, _d: string[], _limit: number, _offset: number) => ({ rows: [], total: 0 }),
    rowsCounts: async () => [],
    rowsValues: async () => [],
    rowsRank: async () => null,
  };
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, ReturnType<typeof local>>): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async (st: string) => ({ profiles: [], gaProfiles: [], catalog: resolvers[st].catalog }),
  };
}
const df = (v: ViewResult) => (v as ViewResult & { datafiles: DatafilesResult }).datafiles;
const VIEW = { kind: "datafiles", oql: ["TP53", "KRAS: MUT"] } as DatafilesView;
const NP_SUFFIX = /; NP throughout for a study without it$/;

describe("runDatafiles: which files cover every study", () => {
  const go = () => runDatafiles(VIEW, ctx({ Q: cohort({ s1: 2, s2: 5 }) }, {
    s1: local("c1", { n: 2, altered: 1, unaltered: 1, alt_0: 1, prof_0: 2, alt_1: 0, prof_1: 2 }, S1_CAT),
    s2: local("c2", { n: 5, altered: 0, unaltered: 0, alt_0: 0, prof_0: 0, alt_1: 0, prof_1: 0 }, S2_CAT),
  }));
  const file = async (id: string) => {
    const v = await go();
    assert.equal(v.error, undefined);
    const f = df(v).files.find((x) => x.id === id);
    assert.ok(f, id + " is offered");
    return f;
  };
  test("E5 mutations: rows are both studies' samples; studies names the holder; description says NP", async () => {
    const m = await file("mutations");
    assert.equal(m.rows, 7);
    assert.deepEqual(m.studies, ["s1"]);
    assert.match(m.description, NP_SUFFIX);
  });
  test("E6 sv: rows are both studies' samples; studies names the holder; description says NP", async () => {
    const s = await file("sv");
    assert.equal(s.rows, 7);
    assert.deepEqual(s.studies, ["s1"]);
    assert.match(s.description, NP_SUFFIX);
  });
  test("E9 a profile only s1 holds: its samples alone, no NP", async () => {
    const r = await file("profile:rna_seq_v2_mrna");
    assert.equal(r.rows, 2);
    assert.deepEqual(r.studies, ["s1"]);
    assert.doesNotMatch(r.description, /NP throughout/);
  });
  test("E11 cna: each study's own first discrete CNA profile, one file", async () => {
    const v = await go();
    const files = df(v).files as { id: string; name: string; rows: number; studies?: string[]; portalFile?: string }[];
    const c = files.find((f) => f.id === "cna");
    assert.ok(c, "a cna file is offered");
    assert.equal(c.name, "Copy-number Alterations (OQL is not in effect)");
    assert.equal(c.studies, undefined);
    assert.equal(c.rows, 7);
    assert.deepEqual(fileList({ s1: S1_CAT, s2: S2_CAT }, ["s1", "s2"]).find((f) => f.id === "cna")!.matrix, { kind: "cna", profiles: { s1: "gistic", s2: "cna" } });
    assert.equal(c.portalFile, "cna.txt");
    assert.ok(!files.some((f) => f.id === "profile:gistic" || f.id === "profile:cna"), "the selected profiles are not offered again");
  });
});

/** two studies whose resolvers return one row per page and record the SQL they are asked */
function paged(table: string) {
  const asked: Record<string, string[]> = { s1: [], s2: [] };
  const paging = (st: string, conn: string, catalog: ProfileInfo[]) => ({
    ...local(conn, {}, catalog),
    rowsPage: async (_l: string, source: (db: string) => RowSource) => {
      asked[st].push(source(conn).with);
      const sid = st === "s1" ? "A-01" : "Z-01";
      return { rows: [{ cohort: "Q", study: st, patient: sid.slice(0, -3), sid, g0: st === "s1" ? "R175H" : "NP", g1: st === "s1" ? "WT" : "NP" }], total: 1 };
    },
    rowsCounts: async (_l: string, source: (db: string) => RowSource) => { asked[st].push(source(conn).with); return [{ cohort: "Q", study: st, n: 1, all: 1 }]; },
  });
  const c = { ...ctx({ Q: cohort({ s1: 2, s2: 5 }) }, { s1: paging("s1", "c1", S1_CAT), s2: paging("s2", "c2", S2_CAT) } as never), table } as ViewRun;
  return { asked, run: () => runDatafiles(VIEW, c) };
}

describe("runDatafiles: a file's page", () => {
  test("E7 mutations page: s2's samples come back, from NP-only SQL", async () => {
    const { asked, run } = paged("mutations");
    const v = await run();
    assert.equal(v.error, undefined);
    const t = df(v).tables.mutations!;
    assert.ok(t.rows.some((r) => r.values[0] === "Z-01"), "s2's sample is on the page");
    assert.ok(t.rows.some((r) => r.values[0] === "A-01"), "s1's sample is on the page");
    assert.ok(asked.s2.length > 0, "s2's resolver was asked for the page");
    for (const sql of asked.s2) {
      assert.match(sql, /'NP' AS g0/);
      assert.doesNotMatch(sql, /mutation_derived/);
    }
    assert.ok(asked.s1.some((sql) => /mutation_derived/.test(sql)), "s1's page reads its mutations");
  });
  test("E10 a profile's page reads only the studies that hold it, without NP", async () => {
    const { asked, run } = paged("profile:rna_seq_v2_mrna");
    const v = await run();
    assert.equal(v.error, undefined);
    assert.equal(asked.s2.length, 0, "s2 is not asked");
    assert.ok(asked.s1.length > 0, "s1 is asked");
    for (const sql of asked.s1) assert.doesNotMatch(sql, /'NP'/);
    assert.ok(!df(v).tables["profile:rna_seq_v2_mrna"]!.rows.some((r) => r.values[0] === "Z-01"));
  });
});
