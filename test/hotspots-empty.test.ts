// A queried gene with no mutations in the cohort (lib/views/hotspots/run.ts), as the portal's Mutations
// tab treats one (docs/legacy-spec/05-mutations.md MUT-MD-1: an empty plot, no rate summary, the badges
// at 0; the audit's Q2 ERG). Before, the gene was dropped from the result and its card showed nothing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { hotspotsKind } from "../lib/views/hotspots/kind.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import type { ViewRun } from "../lib/views/run.ts";

const report = { changes: [{ gene: "TMPRSS2", pos: 41, change: "R41Q", n: 2, rows: 2, driver: false }],
  types: [{ gene: "TMPRSS2", pos: 41, mtype: "Missense_Mutation", driver: false, rows: 2 }],
  totals: [{ gene: "TMPRSS2", patients: 2, pairs: 2, somaticSamples: 2 }], cohortSamples: 494, minCount: 1, annotated: true };
async function run(genes: string[]) {
  const c = { doc: { cohorts: { All: { all: [] } } }, cohorts: { All: { studies: ["s1"] } }, resolvers: { s1: { lollipopCounts: async () => report } },
    vNames: ["All"], vStudies: ["s1"], participationFor: () => ({ studies: [], requiresPatientLevel: false, aggregateOnly: [] }) } as unknown as ViewRun;
  const r = await runHotspots({ kind: "hotspots", cohorts: ["All"], genes } as never, c);
  return ("result" in (r as object) ? (r as { result: unknown }).result : r) as any;
}

describe("hotspots: a gene with no mutations", () => {
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });

  test("stays in the result, 0 mutated, every badge 0", async () => {
    const v = await run(["TMPRSS2", "ERG"]);
    assert.deepEqual(v.hotspots.map((g: any) => [g.gene, g.mutated]), [["TMPRSS2", 2], ["ERG", 0]]);
    const erg = v.hotspots[1];
    assert.ok(Object.values(erg.tally).every((t: any) => t.driver === 0 && t.vus === 0));
    assert.equal(erg.positions.length, 0);
  });

  test("its figure is an empty plot, and the results text says it has none", async () => {
    const v = await run(["ERG"]);
    const svg = viewToSvg(v)!;
    assert.match(svg, />0 mutations · 0 mutated patients\b/);
    assert.doesNotMatch(svg, /<circle/, "no stem heads");
    const out: string[] = [];
    hotspotsKind.text!(v, { out, caveatOf: () => "", noteOf: () => "" } as never);
    const text = out.join("\n");
    assert.match(text, /ERG: no mutations in this cohort/);
    assert.doesNotMatch(text, /above the floor/);
  });
});
