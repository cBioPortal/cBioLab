// MUT-TB-5, MUT-STM-15 (docs/legacy-spec/05-mutations.md): the Mutations table's Columns menu, its
// Clinical tab and Freq. The portal (cbioportal-frontend cd8c6df, RVPS
// clinicalAttributeIdToAvailableFrequency) sums each attribute's sample count over the queried
// studies and divides by the queried samples; Study of Origin counts every sample.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { clinicalFreq } from "../lib/mutation-clinical-freq.ts";
import { MUTATION_COLUMNS } from "../lib/mutation-table.ts";
import { portalFreq } from "../lib/chart/format.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

const close = (got: number | undefined, want: number, what: string) =>
  assert.ok(typeof got === "number" && Math.abs(got - want) < 1e-9, `${what}: ${got} ≠ ${want}`);

// ---- F: clinicalFreq ------------------------------------------------------------------------------

test("F1 clinicalFreq over one study: samples with a value ÷ the cohort's samples ×100; an id with no row 0", () => {
  const got = clinicalFreq([[{ a: "", n: 61 }, { a: "SEX", n: 61 }, { a: "OS_STATUS", n: 59 }, { a: "NOTE", n: 2 }]], ["SEX", "OS_STATUS", "NOTE", "NOPE"]);
  close(got.SEX, 100, "SEX");
  close(got.OS_STATUS, 59 / 61 * 100, "OS_STATUS");
  close(got.NOTE, 2 / 61 * 100, "NOTE");
  assert.equal(got.NOPE, 0);
});

test("F2 clinicalFreq over two studies: counts summed, not percents averaged", () => {
  const got = clinicalFreq([[{ a: "", n: 10 }, { a: "SEX", n: 10 }], [{ a: "", n: 30 }, { a: "SEX", n: 20 }]], ["SEX"]);
  close(got.SEX, 75, "SEX (30 of 40)");
});

test("F3 clinicalFreq with no samples at all: every id 0", () => {
  for (const perStudy of [[], [[]], [[{ a: "", n: 0 }]]] as Record<string, unknown>[][][]) {
    const got = clinicalFreq(perStudy, ["SEX", "AGE"]);
    assert.deepEqual(got, { SEX: 0, AGE: 0 }, JSON.stringify(perStudy));
  }
});

// ---- F4/F5: runMutations over a stand-in resolver -------------------------------------------------

const attr = (id: string, datatype: "STRING" | "NUMBER", patient: 0 | 1, name: string) => ({ id, name, datatype, patient, priority: 1 });
const ATTRS = [attr("SEX", "STRING", 1, "Sex"), attr("AGE", "NUMBER", 1, "Diagnosis Age"), attr("SAMPLE_TYPE", "STRING", 0, "Sample Type"),
  attr("CANCER_TYPE", "STRING", 0, "Cancer Type"), attr("CANCER_TYPE_DETAILED", "STRING", 0, "Cancer Type Detailed"),
  attr("MUTATION_COUNT", "NUMBER", 0, "Mutation Count")];
/** the freq rows: 10 cohort samples */
const FREQ_ROWS = [{ a: "", n: 10 }, { a: "SEX", n: 10 }, { a: "AGE", n: 5 }, { a: "SAMPLE_TYPE", n: 0 },
  { a: "CANCER_TYPE", n: 9 }, { a: "CANCER_TYPE_DETAILED", n: 8 }, { a: "MUTATION_COUNT", n: 7 }];
const MUTATIONS: ProfileInfo = { profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", order: 4 };
const ROWS = [{ sid: "S1", patient: "P1", vaf: 0.3, vafText: "0.30", clinS: {}, clinP: { SEX: "Female" } }];

type Calls = { aggregate: string[]; meta: string[] };

function ctxFor(calls: Calls, page?: { offset: number; limit: number }): ViewRun {
  const r = {
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    viewMeta: async (label: string) => { calls.meta.push(label); return label === "table:attributes" ? ATTRS : []; },
    viewAggregate: async (label: string, _def: unknown, build: unknown) => {
      calls.aggregate.push(label);
      assert.equal(typeof build, "function");
      return label === "mutations:clinical-freq" ? FREQ_ROWS : [];
    },
    lollipopCounts: async () => ({ changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }),
    rowsPage: async () => ({ rows: ROWS.map((x) => ({ cohort: "Q", study: "s1", ...x })), total: ROWS.length }),
    rowsCounts: async () => [{ cohort: "Q", study: "s1", n: ROWS.length, all: ROWS.length }],
    rowsValues: async (_l: string, _s: unknown, _q: unknown, _d: unknown, column: string) => column === "vaf" ? [{ lo: 0.1, hi: 0.3, n: 1 }] : [],
    rowsRank: async () => null,
  };
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" };
  return {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
    cohorts: { Q: cohort },
    resolvers: { s1: r } as never,
    vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7",
    studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [], catalog: [MUTATIONS] }),
    ...(page ? { page } : {}),
  };
}

type Col = { id: string; group?: string; freq?: number };
async function mutations(page?: { offset: number; limit: number }) {
  const calls: Calls = { aggregate: [], meta: [] };
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100 } as MutationsView, ctxFor(calls, page));
  return { res: (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: { columns: Col[] }; error?: string }, calls };
}

test("F4 runMutations, first run: the Clinical-tab columns carry group clinical and their freq; the built-in mutation columns none", async () => {
  const { res, calls } = await mutations();
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.ok(calls.aggregate.includes("mutations:clinical-freq"), JSON.stringify(calls.aggregate));
  const cols = res.mutations!.columns;
  const want: Record<string, number> = { studyOfOrigin: 100, cancerTypeAll: 90, cancerType: 80, mutCount: 70, SEX: 100, AGE: 50, SAMPLE_TYPE: 0 };
  for (const [id, pct] of Object.entries(want)) {
    const c = cols.find((x) => x.id === id);
    assert.ok(c, id + " is a column");
    assert.equal(c.group, "clinical", id);
    close(c.freq, pct, id);
  }
  const clinical = cols.filter((c) => c.group === "clinical").map((c) => c.id).sort();
  assert.deepEqual(clinical, Object.keys(want).sort());
  for (const id of ["proteinChange", "sample", "mutationType", "vaf"]) {
    const c = cols.find((x) => x.id === id)!;
    assert.ok(MUTATION_COLUMNS.some((m) => m.id === id));
    assert.equal(c.group, undefined, id);
    assert.equal(c.freq, undefined, id);
  }
});

test("F5 runMutations with ctx.page set: no freq query asked, no column grouped", async () => {
  const { res, calls } = await mutations({ offset: 100, limit: 100 });
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.ok(!calls.aggregate.includes("mutations:clinical-freq"), JSON.stringify(calls.aggregate));
  assert.ok(res.mutations!.columns.every((c) => c.group === undefined && c.freq === undefined));
});

// ---- F6: the Freq text -----------------------------------------------------------------------------

test("F6 portalFreq writes a share as the Study View does", () => {
  assert.equal(portalFreq(100), "100.0%");
  assert.equal(portalFreq(59 / 61 * 100), "96.7%");
  assert.equal(portalFreq(2 / 61 * 100), "3.3%");
  assert.equal(portalFreq(0), "0%");
  assert.equal(portalFreq(0.05), "<0.1%");
});
