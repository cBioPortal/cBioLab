// The Mutations tab's lollipop (lib/views/hotspots/run.ts) says when every study is on GRCh38, so the
// transcript's Ensembl link goes to that build (lib/lollipop-links.ts, the portal's ensemblLink). The
// resolvers are fakes; Genome Nexus is not reached (fetch refused), so the protein is the observed one.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import type { ViewRun } from "../lib/views/run.ts";

const report = { changes: [{ gene: "KRAS", pos: 12, change: "G12D", n: 2, rows: 2, driver: true }],
  types: [{ gene: "KRAS", pos: 12, mtype: "Missense_Mutation", driver: true, rows: 2 }],
  totals: [{ gene: "KRAS", patients: 2, pairs: 2, somaticSamples: 2 }], cohortSamples: 10, minCount: 1, annotated: true };
const site = (build: string | null) => ({
  lollipopCounts: async () => report,
  ...(build === null ? {} : { viewAggregate: async () => [], viewMeta: async (label: string) => label === "hotspots:build" ? [{ build }] : [] }),
});
async function run(sites: Record<string, ReturnType<typeof site>>) {
  const studies = Object.keys(sites);
  const c = { doc: { cohorts: { All: { all: [] } } }, cohorts: { All: { studies } }, resolvers: sites, vNames: ["All"], vStudies: studies,
    participationFor: () => ({ studies: [], requiresPatientLevel: false, aggregateOnly: [] }) } as unknown as ViewRun;
  const r = await runHotspots({ kind: "hotspots", cohorts: ["All"], genes: ["KRAS"] } as never, c);
  return ("result" in (r as object) ? (r as { result: unknown }).result : r) as { grch38?: true; error?: string };
}

describe("hotspots: the reference genome of the studies", () => {
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });

  test("a GRCh38 study marks the result grch38", async () => {
    assert.equal((await run({ s1: site("hg38") })).grch38, true);
  });
  test("a GRCh37 study, a mix of builds, or a peer that cannot say leaves it unmarked (GRCh37, the portal's default)", async () => {
    assert.equal((await run({ s1: site("hg19") })).grch38, undefined);
    assert.equal((await run({ s1: site("hg38"), s2: site("hg19") })).grch38, undefined);
    assert.equal((await run({ s1: site("hg38"), s2: site(null) })).grch38, undefined);
  });
});
