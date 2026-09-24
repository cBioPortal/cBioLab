// The lollipop's rules, each checked against the cBioPortal function it reproduces
// (react-mutation-mapper / cbioportal-frontend-commons).
import test from "node:test";
import assert from "node:assert/strict";
import { buildLollipopGene, canonicalType, impactType, labelledPosition, lollipopColor, lollipopLabelText, IMPACT_COLORS } from "../lib/lollipop.ts";

test("mutation types map the way getCanonicalMutationType / getProteinImpactType map them", () => {
  assert.equal(impactType(canonicalType("Missense_Mutation")), "missense");
  for (const t of ["Frame_Shift_Del", "Frame_Shift_Ins", "Nonsense_Mutation", "Nonstop_Mutation", "Translation_Start_Site"])
    assert.equal(impactType(canonicalType(t)), "truncating", t);
  assert.equal(impactType(canonicalType("Splice_Region")), "splice", "splice_region counts as a splice site");
  assert.equal(impactType(canonicalType("In_Frame_Del")), "inframe");
  assert.equal(impactType(canonicalType("Silent")), "other");
  assert.equal(impactType(canonicalType("something new")), "other");
});

test("the colour prefers drivers, then the larger count, then the type priority (getColorForProteinImpactType)", () => {
  // a VUS majority still loses to a driver minority
  assert.equal(lollipopColor([{ mtype: "Missense_Mutation", driver: false, rows: 9 }, { mtype: "Nonsense_Mutation", driver: true, rows: 1 }]).color,
    IMPACT_COLORS.truncating.driver);
  // among drivers, the larger count
  assert.equal(lollipopColor([{ mtype: "Missense_Mutation", driver: true, rows: 2 }, { mtype: "Frame_Shift_Del", driver: true, rows: 5 }]).color,
    IMPACT_COLORS.truncating.driver);
  // a tie goes to the lower priority: missense (1) before frame_shift_del (4)
  assert.equal(lollipopColor([{ mtype: "Frame_Shift_Del", driver: true, rows: 3 }, { mtype: "Missense_Mutation", driver: true, rows: 3 }]).color,
    IMPACT_COLORS.missense.driver);
  // all VUS: the VUS shade
  assert.equal(lollipopColor([{ mtype: "Missense_Mutation", driver: false, rows: 3 }]).color, IMPACT_COLORS.missense.vus);
});

test("the label factors the common prefix and counts the rest (lollipopLabelText)", () => {
  assert.equal(lollipopLabelText([{ change: "V600E", rows: 90 }, { change: "V600K", rows: 8 }]), "V600E/K");
  assert.equal(lollipopLabelText([{ change: "R175H", rows: 690 }, { change: "R175L", rows: 17 }, { change: "R175G", rows: 13 }, { change: "R175C", rows: 9 }]),
    "R175H/L/G and 1 more", "top 3 by count, prefix R175 factored out, ordered by count");
  assert.equal(lollipopLabelText([{ change: "G12D", rows: 1 }]), "G12D");
});

test("one stem is labelled: the tallest, and a >2-way tie prefers a stem in a mutated domain", () => {
  const pos = (p: number, n: number) => ({ pos: p, n, color: "", impact: "missense", driver: true, changes: [] });
  assert.equal(labelledPosition([pos(10, 5), pos(200, 9), pos(300, 9)], []), 200, "two tying stems: the first");
  assert.equal(labelledPosition([pos(10, 9), pos(200, 9), pos(390, 9)], [{ accession: "PF", name: "D", start: 380, end: 395, color: "" }]), 390,
    "three tie: the one inside a domain that carries mutations");
});

test("pooling sites sums counts, and nothing undrawable is lost silently", () => {
  const rep = (changes: any[], pairs: number) => ({
    changes: changes.map((c) => ({ gene: "G", rows: c.n, driver: true, ...c })),
    types: changes.map((c) => ({ gene: "G", pos: c.pos, mtype: "Missense_Mutation", driver: true, rows: c.n })),
    totals: [{ gene: "G", patients: pairs, pairs, somaticSamples: pairs }], cohortSamples: 100, minCount: 2, annotated: true });
  const g = buildLollipopGene("G", [
    rep([{ pos: 12, change: "G12D", n: 4 }, { pos: null, change: "X125_splice", n: 2 }, { pos: 999, change: "Z999*", n: 1 }], 10),
    rep([{ pos: 12, change: "G12D", n: 3 }], 3)
  ], { proteinLength: 189, transcriptId: "T", domains: [] });
  assert.equal(g.positions.length, 1);
  assert.equal(g.positions[0].n, 7, "G12D summed across the two sites");
  assert.equal(g.unpositioned, 3, "no codon (2) and past the protein (1) are counted, not dropped");
  assert.equal(g.withheld, 3, "13 pairs reported by the sites' totals, 10 returned: 3 were under the floor");
  assert.equal(g.cohortSamples, 200);
});
