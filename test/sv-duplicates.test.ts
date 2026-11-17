// The Structural Variants tab's duplicate count (SV-TB-1, SV-MD-7, SV-STM-1): the title's note
// (svDuplicatesNote) and the runner summing each (cohort, study) part's count (runSv), against
// stand-in participants, no database. The SQL behind the count is checked against the fixture study
// in scripts/check-results-oql.ts (V*).
// Legacy: cbioportal-frontend cd8c6df ResultsViewStructuralVariantMapper.tsx 58-70 (itemsLabelPlural) and
// ResultsViewStructuralVariantMapperDataStore.ts 34-50 (duplicateStructuralVariantCountInMultipleSamples).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSv, svDuplicatesNote } from "../lib/views/sv/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { RowSource, TableQuery } from "../lib/table-query.ts";
import type { SvView, SvResult } from "../lib/views/sv/types.ts";

type Row = Record<string, unknown>;
const ROWS: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", sid: "S1", gene1: "EML4", gene2: "ALK", site1Chr: "2", site1Pos: 42522656, site2Chr: "2", site2Pos: 29446394 },
  { cohort: "A", study: "s1", patient: "P1", sid: "S2", gene1: "EML4", gene2: "ALK", site1Chr: "2", site1Pos: 42522656, site2Chr: "2", site2Pos: 29446394 },
];

/** a patient-level participant holding ROWS that answers "sv:duplicates:<cohort>" with `duplicates[cohort]`, and records what it was asked */
function local(duplicates: Record<string, number>) {
  const asked: string[] = [];
  return {
    asked,
    instance: { id: "db1", mode: "patient-level", label: "Local", conn: { id: "db1", db: "db1" } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, _s: (db: string) => RowSource, _q: TableQuery, _d: string[], limit: number, offset: number) => {
      asked.push(l);
      return { rows: ROWS.slice(offset, offset + limit), total: 0 };
    },
    rowsCounts: async (l: string) => {
      asked.push(l);
      return [{ cohort: "A", study: "s1", n: ROWS.length, all: ROWS.length }];
    },
    rowsValues: async (l: string) => (asked.push(l), []),
    viewAggregate: async (l: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(l); build("SELECT 1", "s1", "db1");
      const dup = /^sv:duplicates:(.*)$/.exec(l);
      if (dup) return [{ duplicates: duplicates[dup[1]] ?? 0 }];
      return [{ gene: "ALK", samples: 10, profiled: 10, altered: 2, altered_profiled: 2 }];
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
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), ...extra,
  };
}
const run = (c: ViewRun) => runSv({ kind: "sv", genes: ["ALK"] } as SvView, c);
const sv = (v: ViewResult) => (v as ViewResult & { sv: SvResult & { duplicates?: number } }).sv;

// N1-N3: legacy itemsLabelPlural — nothing when there are none; "structural variant" for one, "structural variants" otherwise
test("N1 svDuplicatesNote(0) is empty", () => {
  assert.equal(svDuplicatesNote(0), "");
});
test("N2 svDuplicatesNote(1): one duplicate structural variant", () => {
  assert.equal(svDuplicatesNote(1), ": includes 1 duplicate structural variant in patients with multiple samples");
});
test("N3 svDuplicatesNote(2): duplicate structural variants, plural", () => {
  assert.equal(svDuplicatesNote(2), ": includes 2 duplicate structural variants in patients with multiple samples");
});

// R1: two (cohort, study) parts — cohorts A and B on s1 — answering 1 and 2: the result's count is their sum
test("R1 the runner sums each (cohort, study) part's duplicates", async () => {
  const r = local({ A: 1, B: 2 });
  const v = await run(ctx({ s1: r }, {}, { A: cohort({ s1: 10 }), B: cohort({ s1: 4 }) }));
  assert.equal(v.error, undefined);
  assert.ok(r.asked.includes("sv:duplicates:A") && r.asked.includes("sv:duplicates:B"), "asked " + JSON.stringify(r.asked));
  assert.equal(sv(v).duplicates, 3);
});

// R2: a page (like a column's values) asks for no counts, as with `profiled`
test("R2 a page request asks no duplicates query and carries no duplicates", async () => {
  const r = local({ A: 1 });
  const v = await run(ctx({ s1: r }, { page: { offset: 0, limit: 1 } }));
  assert.equal(v.error, undefined);
  assert.equal(sv(v).rows.length, 1);
  assert.ok(!r.asked.some((l) => l.startsWith("sv:duplicates:")), "asked " + JSON.stringify(r.asked));
  assert.ok(!("duplicates" in sv(v)), "duplicates: " + JSON.stringify(sv(v).duplicates));
});
