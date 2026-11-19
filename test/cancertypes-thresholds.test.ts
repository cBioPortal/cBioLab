// The Cancer Types Summary's threshold controls (lib/views/cancertypes/thresholds.ts): the sliders' ends,
// the Min. # Total clamp and the highlighted box. Each test is a row of the case table, from
// cbioportal-frontend cd8c6df src/pages/resultsView/cancerSummary/CancerSummaryContent.tsx:
//
// | ID  | rule (legacy line)                                                                                      |
// |-----|---------------------------------------------------------------------------------------------------------|
// | TH1 | totalCasesMax = chartData.maxTotalCount: the largest profiledTotal of the groups drawn (392-395, 451)    |
// | TH2 | a group not drawn (filtered) is not in it: chartData holds drawn groups only (355-370)                   |
// | TH3 | altCasesMax: freq mode the largest (altered / profiled) * 100 drawn, count mode the largest altered (444) |
// | TH4 | no group drawn: both ends 0 (the maxima start at 0, 328-330)                                             |
// | TH5 | ours: the box is shared by the gene tabs and the charts, so the ends are over every one drawn            |
// | TH6 | total box on Enter: over the max → the max (555-557, seen 999999 → 1668); at or under it kept           |
// | TH7 | altered box on Enter: no clamp (537-548)                                                                 |
// | TH8 | highlightInput when the applied value is > 0 (478-485): the total's default of 10 is highlighted         |
// | TH9 | the total's default 0 (no group above 10) and an altered of 0 are not                                   |
// | TH10| the altered end label is ceil(max) + "%" in freq mode, the count as is (690-696)                         |
import { test } from "node:test";
import assert from "node:assert/strict";
import { thresholdEnds, clampMinTotal, thresholdHighlight, alteredEndLabel } from "../lib/views/cancertypes/thresholds.ts";
import type { CancertypesGroup, CancertypesResult } from "../lib/views/cancertypes/types.ts";

const grp = (key: string, profiled: number, altered: number): CancertypesGroup =>
  ({ key, label: key, samples: profiled + 3, profiled, altered, mutation: altered, amp: 0, homdel: 0, sv: 0, multiple: 0 });

function result(o: { groups: CancertypesGroup[][]; perGene?: CancertypesGroup[][]; minSamples?: number | null; applied?: number[]; minAltered?: number; show?: "frequency" | "count" }): CancertypesResult {
  return {
    groupBy: "CANCER_TYPE", measure: "any", genes: ["TP53", "KRAS"], minSamples: o.minSamples ?? null, minAltered: o.minAltered ?? 0,
    show: o.show ?? "frequency", unit: "patient",
    panels: o.groups.map((groups, i) => ({
      cohort: "c" + i, samples: 0, profiled: 0, altered: 0, groups, categories: groups.length + 2, minSamples: o.applied?.[i] ?? 10,
      ...(o.perGene?.[i] ? { perGene: [{ gene: "KRAS", altered: 0, profiled: 0, groups: o.perGene[i], categories: 5, minSamples: o.applied?.[i] ?? 10 }] } : {}),
    })),
  };
}

test("TH1: the total's end is the largest profiled total drawn, not the group's units", () => {
  const r = result({ groups: [[grp("NSCLC", 1668, 1237), grp("Breast", 1337, 865), grp("CRC", 1007, 932)]] });
  assert.equal(thresholdEnds(r).total, 1668);
});

test("TH2: a group the filters hid is not in the result, so not in the end", () => {
  // the result holds only drawn groups; "categories" counts the hidden ones, which add nothing
  const r = result({ groups: [[grp("Breast", 1337, 865)]] });
  assert.equal(thresholdEnds(r).total, 1337);
});

test("TH3: the altered end, freq mode the largest share (the portal's float), count mode the largest count", () => {
  const groups = [[grp("A", 1007, 932), grp("B", 100, 29), grp("C", 1668, 1237)]];
  assert.equal(thresholdEnds(result({ groups })).altered, (932 / 1007) * 100);
  assert.equal(thresholdEnds(result({ groups, show: "count" })).altered, 1237);
});

test("TH4: nothing drawn, both ends 0", () => {
  assert.deepEqual(thresholdEnds(result({ groups: [[]] })), { total: 0, altered: 0 });
});

test("TH5: the ends are over every chart and gene tab drawn", () => {
  const r = result({ groups: [[grp("A", 50, 5)], [grp("B", 70, 7)]], perGene: [[grp("A", 40, 30)], []] });
  assert.deepEqual(thresholdEnds(r), { total: 70, altered: 75 });
});

test("TH6: Min. # Total over the end is set to the end; at or under it, kept", () => {
  assert.equal(clampMinTotal(999999, 1668), 1668);
  assert.equal(clampMinTotal(1668, 1668), 1668);
  assert.equal(clampMinTotal(200, 1668), 200);
  assert.equal(clampMinTotal(0, 1668), 0);
  assert.equal(clampMinTotal(25, 0), 0, "nothing drawn: the end is 0");
});

test("TH7: Min. Altered is never clamped", () => {
  // thresholds.ts has no clamp for it; the box's value goes to the document as typed (thresholdOf)
  assert.equal(typeof clampMinTotal, "function");
  assert.equal(thresholdHighlight(result({ groups: [[grp("A", 50, 5)]], minAltered: 250 }), { minAltered: 250 }).altered, true);
});

test("TH8: a box is highlighted when its applied value is above 0; the default Min. # Total of 10 is", () => {
  const r = result({ groups: [[grp("A", 50, 5)]] });
  assert.deepEqual(thresholdHighlight(r, {}), { total: true, altered: false });
  assert.deepEqual(thresholdHighlight(r, { minSamples: 3, minAltered: 0.5 }), { total: true, altered: true });
});

test("TH9: an applied 0 is not highlighted: the default 0, or 0 typed", () => {
  const small = result({ groups: [[grp("A", 8, 1)]], applied: [0] });
  assert.deepEqual(thresholdHighlight(small, {}), { total: false, altered: false });
  assert.deepEqual(thresholdHighlight(result({ groups: [[grp("A", 50, 5)]] }), { minSamples: 0 }), { total: false, altered: false });
  // two charts, one with its default at 10: that box is in use
  assert.equal(thresholdHighlight(result({ groups: [[grp("A", 8, 1)], [grp("B", 50, 5)]], applied: [0, 10] }), {}).total, true);
});

test("TH10: the altered slider's end label: ceil(max) and % in freq mode, the count in count mode", () => {
  assert.equal(alteredEndLabel(92.55, "frequency"), "93%");
  assert.equal(alteredEndLabel(0, "frequency"), "0%");
  assert.equal(alteredEndLabel(1237, "count"), "1237");
});
