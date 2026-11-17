// The Download tab's gene-by-sample files (mutations, sv, profile:<id>) hold every queried sample, as
// the legacy portal's do (docs/legacy-spec/10-results-download.md RDL-STM-4): a sample whose study
// has no profile of the file's kind gets "NP" in every gene column.
//
// | case | input                                                        | expected                                                      |
// |------|--------------------------------------------------------------|---------------------------------------------------------------|
// | E1   | matrixRowSource, 2 parts, holds = only s1, each file kind    | source tables read for s1's part only (same count as s1 alone) |
// | E2   | same, the s2 part                                            | s2's cohort SQL is still read; its gene columns are 'NP'       |
// | E3   | holds true for every study                                   | SQL identical to calling without holds                        |
// | E4   | without holds                                                | unchanged: every part reads the source tables                 |
// | E5   | runDatafiles, s1 holds mutations, s2 does not (2 + 5 samples) | mutations: rows 7; studies ["s1"]; description ends "; NP throughout for a study without it" |
// | E6   | same run, the sv file (s1 holds, s2 does not)                | sv: rows 7; studies ["s1"]; same description suffix (RDL-STM-4 covers every matrix file) |
//
// The SQL is ClickHouse SQL and the repo's tests have no in-process engine, so it is checked as text,
// not run.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matrixRowSource, type MatrixFile } from "../lib/views/datafiles/tables.ts";
import { runDatafiles } from "../lib/views/datafiles/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { DatafilesView, DatafilesResult } from "../lib/views/datafiles/types.ts";

const KINDS: [string, MatrixFile, RegExp][] = [
  ["mutations", { kind: "mutations" }, /mutation_derived/g],
  ["sv", { kind: "sv" }, /genomic_event_derived|mutation_derived/g],
  ["profile continuous", { kind: "profile", profile: "rna_seq_v2_mrna", discrete: false }, /genetic_alteration_derived/g],
  ["profile discrete", { kind: "profile", profile: "gistic", discrete: true }, /genetic_alteration_derived/g],
];
const P1 = { cohort: "C", study: "s1", cohortSql: "SELECT pid, sid FROM cohort_one" };
const P2 = { cohort: "C", study: "s2", cohortSql: "SELECT pid, sid FROM cohort_two" };
const GENES = ["TP53", "KRAS"];
const count = (s: string, re: RegExp) => (s.match(re) || []).length;
const only1 = (st: string) => st === "s1";

describe("matrixRowSource with holds", () => {
  for (const [name, f, src] of KINDS) {
    test(`E1/E2 ${name}: a part whose study lacks the profile reads none of its tables and is NP`, () => {
      const alone = matrixRowSource(f, [P1], GENES, "d").with;
      const both = matrixRowSource(f, [P1, P2], GENES, "d", only1);
      assert.ok(count(alone, src) > 0, "the holding study reads its source table");
      assert.equal(count(both.with, src), count(alone, src), "no source-table read for s2");
      assert.match(both.with, /cohort_two/);
      assert.match(both.with, /'NP' AS g0/);
      assert.match(both.with, /'NP' AS g1/);
      assert.deepEqual(both.columns.map((c) => c.id), ["sample", "patient", "TP53", "KRAS"]);
    });
    test(`E3/E4 ${name}: holds true everywhere, or left out, changes nothing`, () => {
      const plain = matrixRowSource(f, [P1, P2], GENES, "d");
      assert.equal(matrixRowSource(f, [P1, P2], GENES, "d", () => true).with, plain.with);
      assert.equal(count(plain.with, src), 2 * count(matrixRowSource(f, [P1], GENES, "d").with, src));
    });
  }
});

// ---- the runner (stubs as in test/view-datafiles.test.ts) ----
type Row = Record<string, unknown>;
const p = (profile: string, type: string, datatype: string, order = 0): ProfileInfo => ({ profile, type, datatype, name: profile + " name", order });
const BRCA: ProfileInfo[] = [p("mutations", "MUTATION_EXTENDED", "MAF"), p("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 1),
  p("sv", "STRUCTURAL_VARIANT", "SV", 2)];
const NO_MUT: ProfileInfo[] = [p("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 1)];
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

describe("runDatafiles: a gene-by-sample file covers every study", () => {
  const go = () => runDatafiles({ kind: "datafiles", oql: ["TP53", "KRAS: MUT"] } as DatafilesView, ctx({ Q: cohort({ s1: 2, s2: 5 }) }, {
    s1: local("c1", { n: 2, altered: 1, unaltered: 1, alt_0: 1, prof_0: 2, alt_1: 0, prof_1: 2 }, BRCA),
    s2: local("c2", { n: 5, altered: 0, unaltered: 0, alt_0: 0, prof_0: 0, alt_1: 0, prof_1: 0 }, NO_MUT),
  }));
  test("E5 mutations: rows are both studies' samples; studies names the holder; description says NP", async () => {
    const v = await go();
    assert.equal(v.error, undefined);
    const m = df(v).files.find((f) => f.id === "mutations");
    assert.ok(m, "a mutations file is offered");
    assert.equal(m.rows, 7);
    assert.deepEqual(m.studies, ["s1"]);
    assert.match(m.description, /; NP throughout for a study without it$/);
  });
  test("E6 sv: rows are both studies' samples; studies names the holder; description says NP", async () => {
    const s = df(await go()).files.find((f) => f.id === "sv");
    assert.ok(s, "an sv file is offered");
    assert.equal(s.rows, 7);
    assert.deepEqual(s.studies, ["s1"]);
    assert.match(s.description, /; NP throughout for a study without it$/);
  });
});
