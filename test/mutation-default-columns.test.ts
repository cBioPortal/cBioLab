// MUT-COL-38 (docs/legacy-spec/05-mutations.md): the Mutations table shows the portal's eight columns by default
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MUTATION_DEFAULT_COLUMNS } from "../lib/mutation-table.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

const EIGHT = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "copyNumber", "vaf", "mutCount"];

test("MUT-COL-38 MUTATION_DEFAULT_COLUMNS is the portal's eight, in order", () => {
  assert.deepEqual([...MUTATION_DEFAULT_COLUMNS], EIGHT);
});

/** a participant with no rows */
const local = {
  instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
  cohortSql: () => "SELECT 1",
  lollipopCounts: async () => ({ changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }),
  rowsPage: async () => ({ rows: [], total: 0 }),
  rowsCounts: async () => [],
  rowsValues: async () => [],
  rowsRank: async () => null,
};
const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" };
const ctx: ViewRun = {
  doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
  cohorts: { Q: cohort }, resolvers: { s1: local } as never, vNames: ["Q"], vStudies: ["s1"],
  participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
  pin: "v7", studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
};

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

test("MUT-COL-38 a mutations view naming no columns shows the eight and reports them as the defaults", async () => {
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"] } as MutationsView, ctx);
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: { shown?: string[]; defaults?: string[] }; error?: string };
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.deepEqual(res.mutations?.shown, EIGHT);
  assert.deepEqual(res.mutations?.defaults, EIGHT);
});
