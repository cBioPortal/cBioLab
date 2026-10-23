import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { DrawnResultOf } from "../lib/types.ts";

describe("acquired figure", () => {
  const gene = (g: string, pairs: number, shared: number, lost: number, acquired: number, q: number) =>
    ({ gene: g, pairs, shared, lost, acquired, neither: pairs - shared - lost - acquired, p: q, q });
  const v: DrawnResultOf<"acquired"> = { kind: "acquired", cohorts: ["all"], caveat: "seen after, not caused by",
    acquired: { anchoredTo: "Treatment [SUBTYPE=Hormone]", preWindowDays: null, minGapDays: 30, sampleEvents: ["Sequencing"], sampleKey: "SAMPLE_ID", measure: "any",
      panels: [{ cohort: "all", anchored: 200, dated: 180, withPre: 90, withPost: 70, patients: 40, preDays: 20, postDays: 300, gapDays: { q1: 150, median: 320, q3: 600 },
        genes: [gene("ESR1", 40, 2, 1, 12, 0.01), gene("TP53", 40, 20, 3, 3, 1), gene("NOPE", 0, 0, 0, 0, 1)] }] } };
  test("draws lost and acquired bars, the pairs' spacing and the caveat, and lints clean", () => {
    for (const width of [560, 936]) {
      const svg = viewToSvg(v, { width })!;
      assert.ok(svg.includes("ESR1 — 12 patients acquired"));
      assert.ok(svg.includes("ESR1 — 1 patient lost"));
      assert.ok(svg.includes("never covered on both samples"));
      assert.ok(svg.includes("a median 320 days apart"));
      assert.ok(svg.includes("seen after, not caused by"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
  test("no patient with both samples, no figure", () => {
    assert.equal(viewToSvg({ ...v, acquired: { ...v.acquired, panels: [{ ...v.acquired.panels[0], patients: 0 }] } }), null);
  });
});
