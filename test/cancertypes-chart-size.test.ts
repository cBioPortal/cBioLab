// The Cancer Types Summary chart's geometry (lib/views/cancertypes/figure.ts cancertypesPanelSvg), as the
// portal's CancerSummaryChart (cbioportal-frontend cd8c6df src/pages/resultsView/cancerSummary/CancerSummaryChart.tsx):
//
// | ID  | rule (legacy line)                                                                                         |
// |-----|------------------------------------------------------------------------------------------------------------|
// | CS1 | bars 20 px wide whatever the room (barWidth 481-483)                                                        |
// | CS2 | 8 px between bars: centres 28 apart (barSeparation 485-487, chartWidth n · (20 + 8))                         |
// | CS3 | the plot: a 400 px Victory chart less the theme's 50 px padding top and bottom, the largest value 20 px     |
// |     | under its top (barChartHeight 696, cBioPortalTheme padding 50, domainPadding 20 single-quadrant on y): the  |
// |     | tallest bar 280 px                                                                                          |
// | CS4 | group labels under the strip turned 50° from their start, hanging (VictoryLabel angle 50, start / start 870)|
// | CS5 | few groups: the bars keep their size; the figure takes the card's width for its title and legend, not grown |
// | CS6 | more groups than the card holds: the figure grows to hold every bar and scrolls (overflowStyle 646-654)     |
// | CS7 | the last label's run to the right stays inside the figure (rightPadding 461-463)                            |
import { test } from "node:test";
import assert from "node:assert/strict";
import { cancertypesPanelSvg } from "../lib/views/cancertypes/figure.ts";
import { textWidth, FS } from "../lib/svg-kit.ts";
import type { CancertypesGroup, CancertypesResult } from "../lib/views/cancertypes/types.ts";

const grp = (key: string, profiled: number, altered: number): CancertypesGroup =>
  ({ key, label: key, samples: profiled, profiled, altered, mutation: altered, amp: 0, homdel: 0, sv: 0, multiple: 0 });

function result(groups: CancertypesGroup[]): CancertypesResult {
  return { groupBy: "CANCER_TYPE", measure: "any", genes: ["TP53"], minSamples: null, minAltered: 0, show: "frequency", unit: "patient",
    panels: [{ cohort: "all", samples: 100, profiled: 100, altered: 1, groups, categories: groups.length, minSamples: 10 }] };
}
const bars = (svg: string) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
const many = (n: number, name = (i: number) => "Cancer type " + i) => Array.from({ length: n }, (_, i) => grp(name(i), 100, 100 - i));

test("CS1: bars are 20 px wide, with 3 groups or 50", () => {
  for (const n of [3, 50]) {
    const b = bars(cancertypesPanelSvg(result(many(n)), 0, { width: 860 }).body);
    assert.equal(b.length, n);
    assert.ok(b.every((x) => x.w === 20), n + " groups: " + JSON.stringify([...new Set(b.map((x) => x.w))]));
  }
});

test("CS2: bars 8 px apart: their left edges 28 apart", () => {
  const b = bars(cancertypesPanelSvg(result(many(5)), 0, { width: 860 }).body);
  for (let i = 1; i < b.length; i++) assert.equal(Math.round((b[i].x - b[i - 1].x) * 10) / 10, 28);
});

test("CS3: the tallest bar is 280 px, half the value half the height", () => {
  const b = bars(cancertypesPanelSvg(result([grp("A", 100, 80), grp("B", 100, 40)]), 0, { width: 860 }).body);
  assert.equal(b[0].h, 280);
  assert.equal(b[1].h, 140);
  assert.equal(b[0].y + b[0].h, b[1].y + b[1].h, "one base");
});

test("CS4: group labels turned 50°, hanging from their start", () => {
  const svg = cancertypesPanelSvg(result([grp("Non-Small Cell Lung Cancer", 100, 50), grp("Breast Cancer", 90, 40)]), 0, { width: 860 }).body;
  const t = [...svg.matchAll(/<text ([^>]*)>(?:<title>[^<]*<\/title>)?(Non-Small Cell Lung Cancer|Breast Cancer)<\/text>/g)];
  assert.equal(t.length, 2);
  for (const [, attrs] of t) {
    assert.match(attrs, /transform="rotate\(50 /);
    assert.match(attrs, /dominant-baseline="hanging"/);
    assert.doesNotMatch(attrs, /text-anchor=/, "anchored at its start");
  }
});

test("CS5: few groups keep their bars and take the card's width, not grown", () => {
  const c = cancertypesPanelSvg(result(many(3)), 0, { width: 900 });
  assert.equal(c.width, 900);
  assert.equal(c.grown, false);
});

test("CS6: more groups than the card holds grow the figure to hold every bar", () => {
  const c = cancertypesPanelSvg(result(many(60)), 0, { width: 900 });
  assert.equal(c.grown, true);
  const b = bars(c.body);
  assert.ok(c.width >= b[b.length - 1].x + 20, "the last bar inside");
  assert.ok(c.width > 60 * 28);
});

test("CS7: the last label's run to the right stays inside the figure", () => {
  const long = (i: number) => (i === 59 ? "A very long cancer type name that runs on and on" : "T" + i);
  const c = cancertypesPanelSvg(result(many(60, long)), 0, { width: 900 });
  const b = bars(c.body);
  const rad = (50 * Math.PI) / 180;
  const reach = b[b.length - 1].x + 10 + Math.min(260, textWidth(long(59), FS.small)) * Math.cos(rad) + FS.small * Math.sin(rad);
  assert.ok(c.width >= reach, "width " + c.width + ", the label reaches " + reach);
  const short = cancertypesPanelSvg(result(many(60)), 0, { width: 900 });
  assert.ok(c.width > short.width, "a longer last label widens the figure");
});
