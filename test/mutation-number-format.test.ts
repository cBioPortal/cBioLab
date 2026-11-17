// MUT-STM-5 / MUT-STM-6 (docs/legacy-spec/05-mutations.md): Allele Freq (T) and the read counts as the portal writes them
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { portalVaf } from "../lib/chart/format.ts";
import { MUTATION_COLUMNS } from "../lib/mutation-table.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

test("N6 portalVaf: 2 decimals from 0.01, 4 below", () => {
  assert.equal(portalVaf(0.31), "0.31");
  assert.equal(portalVaf(0.0098), "0.0098");
  assert.equal(portalVaf(0.5), "0.50");
});

/** rows as the row source's SQL returns them: vaf the ratio, vafText the portal's text ('' for none), a count of 0 or less NULL */
const CRAFTED: Record<string, unknown>[] = [
  { sid: "S-ratio", vaf: 79 / 601, vafText: "0.13", altCount: 79, refCount: 522 },
  { sid: "S-trailing", vaf: 0.30172, vafText: "0.30", altCount: 175, refCount: 405 },
  { sid: "S-small", vaf: 3 / 997, vafText: "0.0030", altCount: 3, refCount: 994 },
  { sid: "S-zero-alt", vaf: null, vafText: "", altCount: null, refCount: 300 },
  { sid: "S-zero-ref", vaf: 1, vafText: "1.00", altCount: 40, refCount: null },
  { sid: "S-neg", vaf: null, vafText: "", altCount: null, refCount: 200 },
];

const local = {
  instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
  cohortSql: () => "SELECT 1",
  lollipopCounts: async () => ({ changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }),
  rowsPage: async () => ({ rows: CRAFTED.map((r) => ({ cohort: "Q", study: "s1", patient: String(r.sid), ...r })), total: CRAFTED.length }),
  rowsCounts: async () => [{ cohort: "Q", study: "s1", n: CRAFTED.length, all: CRAFTED.length }],
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

type Row = { sample: string; values: (string | number | null)[] };
async function table(): Promise<Map<string, Record<string, unknown>>> {
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100 } as MutationsView, ctx);
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: { rows: Row[] }; error?: string };
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  const at = (id: string) => MUTATION_COLUMNS.findIndex((c) => c.id === id);
  return new Map(res.mutations!.rows.map((x) => [x.sample, { vaf: x.values[at("vaf")], altCount: x.values[at("altCount")], refCount: x.values[at("refCount")] }]));
}

test("N2 the vaf value is the portal's text, the same string as on screen and in the CSV", async () => {
  const t = await table();
  assert.equal(t.get("S-ratio")?.vaf, "0.13");
  assert.equal(t.get("S-trailing")?.vaf, "0.30");
  assert.equal(t.get("S-small")?.vaf, "0.0030");
  assert.equal(t.get("S-zero-ref")?.vaf, "1.00");
});

test("N3 N4 no frequency (alt 0, a negative or missing count): vaf null", async () => {
  const t = await table();
  for (const s of ["S-zero-alt", "S-neg"]) assert.equal(t.get(s)?.vaf, null, s);
});

test("N5 a count the SQL leaves NULL (0 or less) is null; positive counts kept", async () => {
  const t = await table();
  assert.deepEqual(t.get("S-zero-alt"), { vaf: null, altCount: null, refCount: 300 });
  assert.deepEqual(t.get("S-zero-ref"), { vaf: "1.00", altCount: 40, refCount: null });
  assert.deepEqual(t.get("S-ratio"), { vaf: "0.13", altCount: 79, refCount: 522 });
});
