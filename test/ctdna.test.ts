import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import { wilsonInterval } from "../lib/stats.ts";
import type { DrawnResultOf } from "../lib/types.ts";
import { CH_GENES } from "../lib/views/ctdna/run.ts";

describe("wilsonInterval", () => {
  test("matches statsmodels' proportion_confint(method='wilson')", () => {
    const w = wilsonInterval(8, 10)!;
    assert.ok(Math.abs(w.low - 0.4901625) < 1e-6 && Math.abs(w.high - 0.9433178) < 1e-6);
    const z = wilsonInterval(0, 5)!;
    assert.equal(z.low, 0);
    assert.ok(Math.abs(z.high - 0.4344825) < 1e-6);
    assert.equal(wilsonInterval(0, 0), null);
  });
});

describe("ctdna figure", () => {
  const curve = (label: string, n: number) => ({ label, n, events: n - 1, median: 10, points: [{ t: 5, s: 0.7 }, { t: 10, s: 0.5 }, { t: 20, s: 0.2 }] });
  const v: DrawnResultOf<"ctdna"> = { kind: "ctdna", cohorts: ["all"], caveat: "tissue is the reference",
    ctdna: { attribute: "SAMPLE_CLASS", plasma: ["cfDNA"], tissue: ["Tumor"], plasmaPanels: [], withinDays: null, measure: "any",
      panels: [{ cohort: "all", plasmaPatients: 100, tissuePatients: 80, patients: 60, plasmaSamples: 70, tissueSamples: 65, detected: 66, detectedLow: 0.56, detectedHigh: 0.75,
        genes: [{ gene: "EGFR", pairs: 60, both: 20, tissueOnly: 10, plasmaOnly: 2, neither: 28, ppa: 2 / 3, ppaLow: 0.49, ppaHigh: 0.81, concordance: 0.8 }],
        survival: { curves: [curve("ctDNA detected", 66), curve("not detected", 34)], logrank: { chi2: 4, p: 0.045, df: 1, observed: [1, 1], expected: [1, 1], variance: 1, strata: 1 }, missing: 0 } }] } };
  test("draws the bars, the agreement and the survival panel, and lints clean", () => {
    for (const width of [560, 936]) {
      const svg = viewToSvg(v, { width })!;
      assert.ok(svg.includes("EGFR — 10 patients in tissue only"));
      assert.ok(svg.includes("67% [49%–81%]"));
      assert.ok(svg.includes("Overall survival by ctDNA detected"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
  test("says why survival is not drawn", () => {
    const svg = viewToSvg({ ...v, ctdna: { ...v.ctdna, panels: [{ ...v.ctdna.panels[0], survival: null, survivalWhy: "no plasma patient has OS_MONTHS" }] } })!;
    assert.ok(svg.includes("no plasma patient has OS_MONTHS"));
  });
  test("with the CH filter, says what it removed and the unfiltered numbers, and lints clean", () => {
    const pn = v.ctdna.panels[0];
    const ch = { calls: 200, withNormal: 200, byGene: 12, byNormal: 5, removed: 16, patients: 9, genes: [{ gene: "DNMT3A", calls: 10, patients: 6, byGene: 10, byNormal: 1 }],
      before: { detected: 70, detectedLow: 0.6, detectedHigh: 0.79, genes: [{ gene: "EGFR", both: 20, plasmaOnly: 3, ppa: 2 / 3 }], survival: { curves: [], p: 0.01 } } };
    for (const width of [560, 936]) {
      const svg = viewToSvg({ ...v, ctdna: { ...v.ctdna, chFilter: { genes: CH_GENES, normalMinAlt: 2, normalMinRatio: 0.3 }, panels: [{ ...pn, ch }] } }, { width })!;
      assert.ok(svg.includes("Clonal-haematopoiesis filter removed 16 of 200"));
      assert.ok(svg.includes("plasma-only unfiltered"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
  test("TP53 is not on the default CH gene list (a tumour driver as often as a CH gene)", () => {
    assert.ok(CH_GENES.includes("DNMT3A") && !CH_GENES.includes("TP53"));
  });
});
