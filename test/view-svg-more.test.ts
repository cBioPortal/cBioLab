// Renderers for the view kinds in lib/views-more.ts: pure functions of a ViewResult, so every
// check here runs without a database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle } from "../lib/view-svg.ts";
import { wrap } from "../lib/view-svg-more.ts";
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
