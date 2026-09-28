// Renderers for the view kinds in lib/views-more.ts: pure functions of a ViewResult, so every
// check here runs without a database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle } from "../lib/view-svg.ts";
import { wrap } from "../lib/view-svg-more.ts";
import { niceCeil, defaultLog2 } from "../lib/views-more.ts";
import type { ViewResult, GenomeResult } from "../lib/types.ts";

describe("wrap", () => {
  test("breaks on words within the width and keeps an over-long word whole", () => {
    assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"]);
    assert.deepEqual(wrap("supercalifragilistic x", 5), ["supercalifragilistic", "x"]);
    assert.deepEqual(wrap("", 10), [""]);
  });
});

describe("attrition", () => {
  const v: ViewResult = { kind: "attrition", cohorts: ["<b>A</b>"], caveat: "order matters",
    attrition: [{ cohort: "<b>A</b>", base: 1000, studies: ["s"], steps: [
      { label: "CANCER_TYPE in [x]", n: 400, excluded: 600, pctOfBase: 40 },
      { label: "OQL[KRAS]", n: 100, excluded: 300, pctOfBase: 10 }] }] };
  test("draws the base and every step with what it removed", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("1,000") && svg.includes("400") && svg.includes("100"));
    assert.ok(svg.includes("−600 excluded") && svg.includes("−300 excluded"));
    assert.ok(svg.includes("order matters"), "the caveat travels with the figure");
  });
  test("cohort names are escaped", () => {
    const svg = viewToSvg(v)!;
    assert.ok(!svg.includes("<b>A</b>") && svg.includes("&lt;b&gt;A&lt;/b&gt;"));
  });
  test("six cohorts widen the figure rather than crush it, and say so with a min-width", () => {
    const six: ViewResult = { ...v, attrition: Array.from({ length: 6 }, (_, i) => ({ ...v.attrition![0], cohort: "c" + i })) };
    assert.match(viewToSvg(six)!, /min-width:\d+px/);
  });
  test("titled for chat captions", () => assert.match(viewTitle(v), /^Cohort attrition/));
});

describe("genome", () => {
  const bins = [{ chrom: "1", start: 0 }, { chrom: "1", start: 2e6 }, { chrom: "2", start: 0 }];
  const series = (cohort: string) => ({ cohort, samples: 10, segmented: 9,
    profiled: [9, 0, 9], gain: [3, 0, 0], loss: [0, 0, 6] });
  const one: GenomeResult = { build: "hg19", binMb: 2, threshold: 0.2, includeX: false, bins, series: [series("A")] };
  test("an unmeasured bin is drawn as unmeasured, never as copy-neutral", () => {
    const svg = viewToSvg({ kind: "genome", genome: one, caveat: "c" })!;
    assert.ok(svg.includes("no segment covers this bin"));
  });
  test("gains and losses take the oncoprint's amplification and deletion colours", () => {
    const svg = viewToSvg({ kind: "genome", genome: one, caveat: "c" })!;
    assert.ok(svg.includes("#e41a1c") && svg.includes("#2166ac"));
  });
  test("the q-value strip appears only when two cohorts were tested", () => {
    assert.ok(!viewToSvg({ kind: "genome", genome: one })!.includes("gain differs"));
    const two: GenomeResult = { ...one, series: [series("A"), series("B")],
      test: { gainQ: [0.01, null, 1], lossQ: [1, null, 0.02], significantGain: 1, significantLoss: 1 } };
    assert.ok(viewToSvg({ kind: "genome", genome: two })!.includes("gain differs"));
  });
  test("no series, no figure", () => {
    assert.equal(viewToSvg({ kind: "genome", genome: { ...one, series: [] } }), null);
  });
});

describe("pathways", () => {
  const cell = (cohort: string, profiled: number, altered: number) =>
    ({ cohort, profiled, altered, pct: profiled ? Math.round(1000 * altered / profiled) / 10 : null });
  const v: ViewResult = { kind: "pathways", cohorts: ["A", "B"], caveat: "union of panels",
    pathways: { measure: "driver", rows: [{ name: "RTK-RAS", source: "Sanchez-Vega 2018", genes: 3, profiledGenes: 2,
      cells: [cell("A", 100, 60), cell("B", 50, 45)], p: 1e-5, q: 0,
      top: [{ gene: "KRAS", role: "OG", cells: [cell("A", 100, 40), cell("B", 50, 40)], q: 0.001 }],
      otherAltered: 4, notProfiled: ["<X>"] }] } };
  test("pooled and unprofiled members are counted, never silently dropped", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("+4 more altered"));
    assert.ok(svg.includes("1 never profiled"));
  });
  test("an underflowed q never prints as zero", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("q&lt;1e-300") && !/q=0(e\+0)?</.test(svg));
  });
  test("a significant member is starred, and the caveat travels with the figure", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("KRAS ★") && svg.includes("union of panels"));
  });
});

describe("diffexpr", () => {
  test("axis ends are readable round numbers", () => {
    assert.equal(niceCeil(219.09), 250);
    assert.equal(niceCeil(4.25), 5);
    assert.equal(niceCeil(0.031), 0.05);
    assert.equal(niceCeil(10), 10);
  });
  test("log2 by default only for a stored RNA-seq profile, never for z-scores or protein", () => {
    assert.equal(defaultLog2("rna_seq_v2_mrna"), true);
    assert.equal(defaultLog2("rna_seq_v2_mrna_median_Zscores"), false);
    assert.equal(defaultLog2("rppa"), false);
    assert.equal(defaultLog2("methylation_hm450"), false);
  });
  const g = (gene: string, effect: number, p: number, q: number) => ({ gene, nA: 10, nB: 10, meanA: effect, meanB: 0, effect, t: effect * 10, p, q });
  const v: ViewResult = { kind: "diffexpr", cohorts: ["<A>", "B"], caveat: "moments only",
    diffexpr: { profileType: "z", log2: false, effectLabel: "difference in mean z-score", groups: ["<A>", "B"], tested: 3, skipped: 0, up: 1, down: 1,
      points: [g("UP1", 2, 1e-20, 1e-18), g("DN1", -2, 1e-10, 1e-9)], grid: { xMax: 5, yMax: 25, nx: 90, ny: 60, cells: [[45, 1, 1, 0]] },
      pooledSignificant: 0, labels: ["UP1", "DN1"],
      gsea: { ranking: "t", permutations: 1000, skipped: [], sets: [{ name: "HALLMARK_E2F_TARGETS", size: 20, setSize: 20, es: 0.7, nes: 2.5, p: 0.001, q: 0.01,
        leadingEdge: ["UP1"], curve: [0, 0.7, 0], curveAt: [0, 1, 2], hits: [0], }] } } };
  test("labels both directions, escapes cohort names, and draws the enrichment curve", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes(">UP1<") && svg.includes(">DN1<"));
    assert.ok(!svg.includes("<A>") && svg.includes("&lt;A&gt;"));
    assert.ok(svg.includes("e2f targets") && svg.includes("leading-edge"));
  });
  test("enrichment switched off draws the volcano alone", () => {
    const svg = viewToSvg({ ...v, diffexpr: { ...v.diffexpr!, gsea: undefined } })!;
    assert.ok(!svg.includes("gene-set enrichment"));
  });
});

describe("paired", () => {
  const gene = (g: string, pairs: number, both: number, aOnly: number, bOnly: number, q: number) =>
    ({ gene: g, pairs, both, aOnly, bOnly, neither: pairs - both - aOnly - bOnly, concordance: both / (both + aOnly + bOnly || 1), p: q, q });
  const v: ViewResult = { kind: "paired", cohorts: ["all"], caveat: "where, not when",
    paired: { pairBy: { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] }, measure: "driver",
      panels: [{ cohort: "all", patients: 100, aSamples: 110, bSamples: 120,
        genes: [gene("ESR1", 100, 4, 7, 49, 1e-8), gene("NOPE", 0, 0, 0, 0, 1)] }] } };
  test("names the side discordance favours, and a gene never profiled on both sides says so", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("more Metastasis-only"));
    assert.ok(svg.includes("never profiled on both sides"));
    assert.ok(svg.includes("where, not when"));
  });
  test("no patient with both sides, no figure", () => {
    assert.equal(viewToSvg({ ...v, paired: { ...v.paired!, panels: [{ ...v.paired!.panels[0], patients: 0 }] } }), null);
  });
});

describe("clonality", () => {
  const gene = (g: string, calls: number) => ({ gene: g, calls, samples: calls, clonal: Math.round(calls * 0.8), subclonal: Math.round(calls * 0.1),
    indeterminate: calls - Math.round(calls * 0.8) - Math.round(calls * 0.1), uncalled: 0, loh: Math.round(calls * 0.7), lohKnown: calls, ccf: new Array(10).fill(0) });
  const panel = (cohort: string) => ({ cohort, samples: 100, ascnSamples: 98, qcPass: 90, qcFail: 8, wgd: { yes: 30, no: 60 },
    purity: new Array(20).fill(1), ploidy: new Array(32).fill(1), genes: [gene("TP53", 50), gene("ESR1", 0)] });
  const v: ViewResult = { kind: "clonality", cohorts: ["A"], caveat: "purity-limited",
    clonality: { measure: "driver", qc: true, panels: [panel("A")] } };
  test("shows % clonal, LOH and WGD, and says when a gene has no call rather than drawing nothing", () => {
    const svg = viewToSvg(v)!;
    // clonal share is of the calls that were called either way: 40 / (40 + 5)
    assert.ok(svg.includes("89% clonal") && svg.includes("LOH 70%"));
    assert.ok(svg.includes("33.3%"), "30 of 90 doubled");
    assert.ok(svg.includes("no driver mutation call with a FACETS estimate"));
  });
  test("tspans that follow a number keep their space", () => {
    const svg = viewToSvg(v)!;
    assert.ok(!/%<tspan[^>]*>of /.test(svg) && !/clonal<tspan[^>]*>·/.test(svg));
  });
});
