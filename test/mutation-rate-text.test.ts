import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationRateText } from "../lib/lollipop.ts";
import { lollipopSummaryText } from "../lib/lollipop-svg.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

// legacy MutationStatusSelector: `${formatPercentValue(rate)}%`, one decimal, "< 0.1" for a nonzero rate that rounds to 0
test("R1: every sample mutated", () => assert.equal(mutationRateText(59, 59), "100.0%"));
test("R2: one decimal", () => assert.equal(mutationRateText(218, 594), "36.7%"));
test("R3: zero", () => assert.equal(mutationRateText(0, 594), "0.0%"));
test("R4: a nonzero rate that rounds to nothing", () => assert.equal(mutationRateText(1, 5000), "< 0.1%"));
test("R5: no samples", () => assert.equal(mutationRateText(3, 0), "–"));

test("R6: the summary text states the frequency the same way", () => {
  const none = { driver: 0, vus: 0 };
  const g: HotspotGene = {
    gene: "KRAS", mutated: 59, mutations: 59,
    positions: [{ pos: 12, n: 59, color: "#008000", impact: "missense", driver: true,
      changes: [{ change: "G12D", n: 59, rows: 59, impact: "missense", driver: true }],
      types: [{ mtype: "Missense_Mutation", driver: true, rows: 59 }] }],
    domains: [], proteinLength: 189, lengthSource: "genome-nexus", unpositioned: 0, withheld: 0,
    topChanges: [{ change: "G12D", pos: 12, n: 59, pct: 100 }],
    somaticSamples: 59, cohortSamples: 59,
    tally: { missense: { driver: 59, vus: 0 }, truncating: none, inframe: none, splice: none, fusion: none, other: none }
  };
  const text = lollipopSummaryText([g], []);
  assert.ok(text.includes("somatic mutation frequency 100.0%"), text);
});
