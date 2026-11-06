// The lollipop's rules, each checked against the cBioPortal function it reproduces
// (react-mutation-mapper / cbioportal-frontend-commons).
import test from "node:test";
import assert from "node:assert/strict";
import { buildLollipopGene, canonicalType, impactType, labelledPosition, lollipopColor, lollipopLabelText, IMPACT_COLORS,
  impactSql, filterHotspotGene, checkHide, ALTERATION_CELLS, cellLabel, clickCodon, checkCodons, pruneCodons } from "../lib/lollipop.ts";
import { lollipopPanelsSvg, lollipopSummaryText } from "../lib/lollipop-svg.ts";

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

test("the badge tally counts every mutation row by impact type and driver status, drawn or not", () => {
  const g = buildLollipopGene("G", [{
    changes: [{ gene: "G", pos: 12, change: "G12D", n: 5, rows: 6, driver: true }, { gene: "G", pos: null, change: "X10_splice", n: 2, rows: 2, driver: false }],
    types: [{ gene: "G", pos: 12, mtype: "Missense_Mutation", driver: true, rows: 6 }, { gene: "G", pos: 30, mtype: "Nonsense_Mutation", driver: false, rows: 1 },
            { gene: "G", pos: null, mtype: "Splice_Site", driver: false, rows: 2 }, { gene: "G", pos: 40, mtype: "Silent", driver: false, rows: 3 }],
    totals: [{ gene: "G", patients: 7, pairs: 7, somaticSamples: 7 }], cohortSamples: 20, minCount: 1, annotated: true }],
    { proteinLength: 189, transcriptId: "T", domains: [] });
  assert.deepEqual(g.tally.missense, { driver: 6, vus: 0 });
  assert.deepEqual(g.tally.truncating, { driver: 0, vus: 1 });
  assert.deepEqual(g.tally.splice, { driver: 0, vus: 2 }, "the unpositioned splice rows still count");
  assert.deepEqual(g.tally.other, { driver: 0, vus: 3 });
  assert.deepEqual(g.tally.fusion, { driver: 0, vus: 0 });
});

// ---- the alteration grid's selection ---------------------------------------------------------

test("the alteration grid's selection", async (t) => {
  const rep = (changes: { pos: number; change: string; n: number; impact: string; driver: boolean; mtype: string }[]) => ({
    changes: changes.map((c) => ({ gene: "G", pos: c.pos, change: c.change, n: c.n, rows: c.n, driver: c.driver, impact: c.impact })),
    types: changes.map((c) => ({ gene: "G", pos: c.pos, mtype: c.mtype, driver: c.driver, rows: c.n })),
    totals: [{ gene: "G", patients: 20, pairs: 20, somaticSamples: 5 }], cohortSamples: 50, minCount: 1, annotated: true,
  });
  const g = () => buildLollipopGene("G", [rep([
    { pos: 12, change: "G12D", n: 6, impact: "missense", driver: true, mtype: "Missense_Mutation" },
    { pos: 12, change: "G12fs", n: 2, impact: "truncating", driver: false, mtype: "Frame_Shift_Del" },
    { pos: 61, change: "Q61H", n: 3, impact: "missense", driver: false, mtype: "Missense_Mutation" },
  ])], { proteinLength: 189, transcriptId: "T", domains: [] });

  await t.test("nothing hidden is the plot as built", () => {
    const f = filterHotspotGene(g(), []);
    assert.equal(f.shown, 11); assert.equal(f.total, 11); assert.equal(f.gene.positions.length, 2);
  });
  await t.test("a hidden cell takes its changes out; a codon left empty goes, a codon left with others shrinks and recolours", () => {
    const f = filterHotspotGene(g(), ["missense.driver"]);
    assert.deepEqual(f.gene.positions.map((p) => [p.pos, p.n]), [[12, 2], [61, 3]]);
    const p12 = f.gene.positions.find((p) => p.pos === 12)!;
    assert.equal(p12.impact, "truncating"); assert.equal(p12.driver, false, "the frameshift is a VUS, so its VUS colour");
    assert.equal(f.shown, 5); assert.equal(f.total, 11);
    assert.deepEqual(filterHotspotGene(g(), ["missense.vus", "missense.driver"]).gene.positions.map((p) => p.pos), [12]);
  });
  await t.test("the label moves to the tallest stem left", () => {
    assert.equal(filterHotspotGene(g(), ["missense.driver"]).gene.label?.pos, 61);
  });
  await t.test("the tally stays whole — it is the grid's own counts", () => {
    assert.deepEqual(filterHotspotGene(g(), ["missense.driver"]).gene.tally, g().tally);
  });
  await t.test("a change with no class (a peer on older code) cannot be judged: it stays drawn and is counted", () => {
    const old = buildLollipopGene("G", [{ ...rep([{ pos: 5, change: "A5T", n: 4, impact: "missense", driver: true, mtype: "Missense_Mutation" }]),
      changes: [{ gene: "G", pos: 5, change: "A5T", n: 4, rows: 4, driver: true }] }], { proteinLength: 100, transcriptId: "T", domains: [] });
    const f = filterHotspotGene(old, ["missense.driver"]);
    assert.equal(f.shown, 4); assert.equal(f.unclassed, 4);
  });
  await t.test("checkHide names a bad cell and the cells accepted", () => {
    assert.equal(checkHide(undefined), null);
    assert.equal(checkHide(["missense.vus", "other.driver"]), null);
    assert.match(checkHide(["missense.maybe"])!, /unknown cell missense\.maybe/);
    assert.match(checkHide("missense.vus")!, /hide is a list/);
    assert.equal(ALTERATION_CELLS.length, 12);
    assert.equal(cellLabel("truncating.vus"), "Truncating · VUS");
  });
  await t.test("the SQL classifies every mutation type exactly as the browser does", () => {
    const sql = impactSql("t");
    // each listed raw type sits in the multiIf branch of the class the browser gives it
    for (const m of sql.matchAll(/IN \(([^)]*)\), '(\w+)'/g)) {
      for (const raw of m[1].split(", ").map((x) => x.slice(1, -1))) assert.equal(impactType(canonicalType(raw)), m[2], raw);
    }
    assert.match(sql, /'other'\)$/, "anything else is other");
    assert.ok(sql.includes("'splice_region_variant'") && sql.includes("'nonsense_mutation'"));
  });
});

test("selecting stems by clicking them (updatePositionSelectionFilters)", async (t) => {
  await t.test("a click selects that codon alone; clicking it again clears the selection", () => {
    assert.deepEqual(clickCodon([], 12, false), [12]);
    assert.deepEqual(clickCodon([12, 61], 13, false), [13], "a plain click replaces what was selected");
    assert.deepEqual(clickCodon([12], 12, false), []);
    assert.deepEqual(clickCodon([12, 61], 12, false), [], "a selected codon clicked without shift clears all, as the portal does");
  });
  await t.test("shift adds a codon, or takes a selected one out, keeping the rest", () => {
    assert.deepEqual(clickCodon([61], 12, true), [12, 61], "sorted, so one selection has one spelling");
    assert.deepEqual(clickCodon([12, 13, 61], 13, true), [12, 61]);
    assert.deepEqual(clickCodon([], 12, true), [12]);
  });
  await t.test("checkCodons rejects a shape or gene it cannot honour, naming what is accepted", () => {
    assert.equal(checkCodons(undefined, ["KRAS"]), null);
    assert.equal(checkCodons({ KRAS: [12, 13] }, ["KRAS"]), null);
    assert.match(checkCodons({ TP53: [175] }, ["KRAS"])!, /codons\.TP53: not a gene of this view — its genes are KRAS/);
    assert.match(checkCodons({ KRAS: [12.5] }, ["KRAS"])!, /protein positions/);
    assert.match(checkCodons({ KRAS: ["12"] }, ["KRAS"])!, /protein positions/);
    assert.match(checkCodons([12], ["KRAS"])!, /object from gene/);
  });
  await t.test("pruneCodons keeps the view's genes and drops empty lists", () => {
    assert.deepEqual(pruneCodons({ KRAS: [12], TP53: [175] }, ["KRAS"]), { KRAS: [12] });
    assert.equal(pruneCodons({ KRAS: [] }, ["KRAS"]), undefined);
    assert.equal(pruneCodons(undefined, ["KRAS"]), undefined);
  });
  const rep = {
    changes: [{ gene: "G", pos: 12, change: "G12D", n: 6, rows: 6, driver: true, impact: "missense" }, { gene: "G", pos: 61, change: "Q61H", n: 3, rows: 3, driver: true, impact: "missense" }],
    types: [{ gene: "G", pos: 12, mtype: "Missense_Mutation", driver: true, rows: 6 }, { gene: "G", pos: 61, mtype: "Missense_Mutation", driver: true, rows: 3 }],
    totals: [{ gene: "G", patients: 9, pairs: 9, somaticSamples: 9 }], cohortSamples: 50, minCount: 1, annotated: true,
  };
  const g = buildLollipopGene("G", [rep], { proteinLength: 189, transcriptId: "T", domains: [] });
  await t.test("the figure tags every stem with its gene and codon, and draws a selected head larger", () => {
    const svg = lollipopPanelsSvg([g], { width: 720 }, "", { G: [61] });
    assert.match(svg, /<g data-gene="G" data-codon="12"><title>[^<]*<\/title><line[^>]*\/><circle class="lollipop-head"[^>]* r="2\.8"/);
    assert.match(svg, /<g data-gene="G" data-codon="61" data-selected="1"><title>[^<]*<\/title><line[^>]*\/><circle class="lollipop-head"[^>]* r="5"/);
    assert.ok(svg.indexOf('data-codon="61"') > svg.indexOf('data-codon="12"'), "a selected stem is drawn last, over its neighbours");
    assert.doesNotMatch(lollipopPanelsSvg([g], { width: 720 }, ""), /data-selected/);
  });
  await t.test("a figure standing alone says in its caption what is selected", () => {
    assert.match(lollipopSummaryText([g], [], { G: [12, 61] }), /Selected codons, drawn with a larger head: G 12, 61 \(9 mutations drawn there\)\./);
    assert.match(lollipopSummaryText([g], ["missense.driver"], { G: [12] }), /G 12 \(0 mutations drawn there\)/, "counts what is drawn, after the grid's selection");
    assert.doesNotMatch(lollipopSummaryText([g], []), /Selected/);
  });
});
