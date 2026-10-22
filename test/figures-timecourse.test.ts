// The time-course figures (incidence, risk model, labs, clinical course, timeline): one time-axis
// rule, and nothing drawn past the frame however long the names or many the cohorts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { timeScale } from "../lib/chart/time.ts";
import { paragraph } from "../lib/chart/text.ts";
import { incidenceSvg } from "../lib/figures/incidence.ts";
import { riskmodelSvg } from "../lib/figures/riskmodel.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import { labsSvg } from "../lib/figures/labs.ts";
import { courseSvg } from "../lib/figures/course.ts";
import { timelineSvg } from "../lib/timeline-svg.ts";
import { textWidth } from "../lib/svg-kit.ts";
import type { DrawnResultOf } from "../lib/types.ts";

const unesc = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** every unrotated <text>'s measured extent, against the frame's width */
function overruns(svg: string): string[] {
  const W = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)![1]);
  const bad: string[] = [];
  // marks drawn about a translated origin (the timeline's events) are checked by their own geometry, not here
  svg = svg.replace(/<g clip-path="[^"]*">.*?<\/g>/g, "").replace(/<g[^>]*transform="translate[^>]*>.*?<\/g>/g, "");
  for (const m of svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/g)) {
    const a = m[1];
    if (/rotate\(/.test(a) || /translate\(/.test(a)) continue;
    const x = Number(/x="(-?[\d.]+)"/.exec(a)?.[1] ?? 0), size = Number(/font-size="([\d.]+)"/.exec(a)?.[1] ?? 10);
    const bold = /font-weight="[67]00"/.test(a);
    const text = unesc(m[2].replace(/<title>.*?<\/title>/g, ""));
    const w = textWidth(text, size, bold ? 600 : 400);
    const anchor = /text-anchor="(middle|end)"/.exec(a)?.[1];
    const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    if (left < -0.5 || left + w > W + 0.5) bad.push(text.slice(0, 50) + " @" + Math.round(left) + "–" + Math.round(left + w) + " of " + W);
  }
  return bad;
}

const LONG = (i: number) => "Cohort " + i + " — patients with a first diagnosis recorded in the study, followed two years";

describe("timeScale", () => {
  test("survival's rule for the step: a year, or two once a year makes more than seven ticks", () => {
    assert.deepEqual(timeScale(0, 60, 0, 600).ticks, [0, 12, 24, 36, 48, 60]);
    assert.deepEqual(timeScale(0, 100, 0, 600).ticks, [0, 24, 48, 72, 96]);
    assert.deepEqual(timeScale(-12, 60, 0, 600).ticks, [-12, 0, 12, 24, 36, 48, 60]);
    assert.deepEqual(timeScale(-12, 52, 0, 600, { unit: "weeks" }).ticks, [-12, 0, 12, 24, 36, 48]);
  });
  test("a short span gets a finer step, and a narrow one a coarser step rather than crowded labels", () => {
    assert.deepEqual(timeScale(0, 12, 0, 600).ticks, [0, 3, 6, 9, 12]);
    const narrow = timeScale(0, 60, 0, 100, { minGap: 40 });
    assert.ok(narrow.ticks.length <= 3, narrow.ticks.join(","));
    for (let i = 1; i < narrow.ticks.length; i++) assert.ok(narrow(narrow.ticks[i]) - narrow(narrow.ticks[i - 1]) >= 40);
  });
  test("labels are plain numbers with a true minus", () => {
    assert.equal(timeScale(-12, 60, 0, 600).fmt(-12), "−12");
  });
});

test("paragraph wraps to its width", () => {
  const pg = paragraph("word ".repeat(80), 8, 0, 200, "#000");
  for (const m of pg.svg.matchAll(/>([^<]+)<\/text>/g)) assert.ok(textWidth(m[1], 11) <= 200);
  assert.ok(pg.height > 11 * 5);
});

describe("incidence: many long-named cohorts and horizons stay inside the frame", () => {
  const curve = (i: number) => ({ cohort: LONG(i), n: 12345, events: 2345, competing: 3456, censored: 6544,
    points: [{ t: 3, f1: 0.1, f2: 0.05, se1: 0.02, atRisk: 9000 }, { t: 3.01, f1: 0.11, f2: 0.05, se1: 0.02, atRisk: 8990 }, { t: 30, f1: 0.2, f2: 0.3, se1: 0.03, atRisk: 5000 }],
    excluded: { prior: 1234, unobserved: 12, noFollowup: 3, noAnchor: 4 }, late: 0 });
  const curves = Array.from({ length: 8 }, (_, i) => curve(i));
  const v: DrawnResultOf<"incidence"> = { kind: "incidence", cohorts: curves.map((c) => c.cohort), caveat: "not 1-KM",
    incidence: { eventLabel: "brain metastasis", curves,
      horizons: [6, 12, 24, 36, 60].map((months) => ({ months, cells: curves.map((c) => ({ cohort: c.cohort, f1: 0.123, lo: 0.1, hi: 0.15, naive: 0.2, atRisk: 50 })) })),
      gray: { statistic: 3.2, p: 0.04, permutations: 2000, groups: 8 } } };
  for (const width of [560, 1000, 1400]) test("at " + width + "px", () => {
    const svg = incidenceSvg(v, { width });
    assert.deepEqual(overruns(svg), []);
    assert.ok(svg.includes("1−KM 20.0%"));
    assert.ok(svg.includes("stroke-dasharray=\"6 3\""), "the seventh cohort is dashed, not a repeat colour");
  });
  test("a narrow card takes the 1 − KM figures under the estimate, or widens and says so", () => {
    const svg = incidenceSvg(v, { width: 560 });
    assert.match(svg, /min-width:\d+px|viewBox="0 0 560 /);
  });
});

describe("risk model, labs, course and timeline stay inside the frame", () => {
  const km = (n: number) => ({ points: [{ t: 0.5, s: 0.99 }, { t: 0.6, s: 0.98 }, { t: 40, s: 0.6 }, { t: 108, s: 0.3 }], median: 70.123, n, events: Math.round(n / 3) });
  const rm: DrawnResultOf<"riskmodel"> = { kind: "riskmodel", cohorts: ["A"], caveat: "association, not cause",
    riskmodel: { study: "s", n: 12000, events: 4000, notProfiled: 3, noStratum: 0, neverHeldOut: 1030, noCovariate: 0, noAnchor: 0, anchorAfterStart: 0, noFollowUp: 0,
      anchoredTo: null, covariates: [{ name: "AGE_AT_DIAGNOSIS", meanCoef: 0.1, hr: 1.1 }], validation: null, reportedOn: "held-out scores",
      genesCovered: 341, candidates: 302, minMutated: 30, strata: "CANCER_TYPE", strataLevels: 12, alpha: 0.5, runs: 5, seed: 1, measure: "any",
      cIndex: { median: 0.611, q1: 0.607, q3: 0.612, values: [] },
      features: Array.from({ length: 20 }, (_, i) => ({ gene: "GENE" + i, selected: 1, meanCoef: 0.1, hr: i % 2 ? 1.46 : 0.86, mutated: 1234 })),
      groups: ["Low risk", "Intermediate-low risk", "Intermediate risk", "Intermediate-high risk", "High risk"].map((name, i) => ({ name, from: i ? i : null, to: null,
        curve: km(2319), at12: 0.85, at36: 0.65, hr: i ? 1.49 : null, ciLow: i ? 1.37 : null, ciHigh: i ? 1.63 : null, p: i ? 2.5e-19 : null })),
      logrank: { chi2: 333.41, df: 4, p: 4e-73, strata: 12, groups: 5 } as any, refit: { hr: 1.37, ciLow: 1.33, ciHigh: 1.42, p: 4.1e-86 },
      histogram: { edges: [0, 1, 2, 3, 4, 5], counts: [10, 300, 2000, 400, 12] }, scale: { min: 0, max: 5 }, labelAbove: 0.5, cutsChosen: null,
      percentiles: Array.from({ length: 101 }, (_, k) => k / 20) } } as any;
  // a crowded volcano: hundreds of genes kept, many past the label threshold, long names
  const crowded = { ...rm, riskmodel: { ...rm.riskmodel, labelAbove: 0.1, candidates: 400,
    features: Array.from({ length: 300 }, (_, i) => ({ gene: "LONGGENENAME" + i, selected: ((i * 37) % 100) / 100 || 0.01, meanCoef: 0, hr: Math.exp(((i * 53) % 61 - 30) / 40), mutated: 30 + (i * 17) % 3000 })) } } as any;
  const labPanel = (i: number, waterfall?: number[]) => ({ cohort: LONG(i), anchored: 12345, baseline: 9876, positiveBaseline: 9000, evaluable: 8765,
    course: [-12, -8, -4, 0, 4, 8, 12].map((week) => ({ week, n: 80, q1: -80, median: -40, q3: 250 })),
    best: new Array(201).fill(0).map((_, k) => k % 7), responders: 4321, ...(waterfall ? { waterfall } : { waterfallWithheld: 8 }) });
  const labs: DrawnResultOf<"labs"> = { kind: "labs", cohorts: [], caveat: "measured, not everyone",
    labs: { test: "PSA", anchoredTo: "Treatment [SUBTYPE=Hormone]", responseDrop: 50, fromWeeks: -12, toWeeks: 52, binWeeks: 4, baselineDays: 90,
      panels: [0, 1, 2, 3, 4, 5, 6].map((i) => labPanel(i, i % 2 ? undefined : [-99, -60, 10, 300])), responseP: 1.4e-6 } } as any;
  const course: DrawnResultOf<"course"> = { kind: "course", cohorts: [], caveat: "Aligned on first Treatment.", courseAxis: { binMonths: 3, from: -12, to: 60 },
    course: [0, 1, 2, 3, 4, 5, 6].flatMap((i) => ["A very long event type name that goes on", "Surgery"].map((eventType) => ({ cohort: LONG(i), eventType, variants: [eventType], isInterval: i % 2 === 0,
      points: Array.from({ length: 25 }, (_, k) => ({ t: -12 + 3 * k, atRisk: 12345 - k * 300, n: 100, pct: 40 })) }))) } as any;
  for (const width of [480, 760, 1400]) {
    test("risk model at " + width + "px", () => assert.deepEqual(overruns(riskmodelSvg(rm, { width })), []));
    test("risk model with a crowded volcano at " + width + "px", () => {
      const svg = riskmodelSvg(crowded, { width });
      assert.deepEqual(overruns(svg), []);
      assert.deepEqual(lintSvg(svg), []);
    });
    test("labs at " + width + "px", () => assert.deepEqual(overruns(labsSvg(labs, { width })), []));
    test("course at " + width + "px", () => assert.deepEqual(overruns(courseSvg(course, { width })), []));
  }
  // a sample's marker keeps the portal's sample-type colour (a primary is black); the chrome takes the theme's
  test("timeline: no literal greys or Arial, no text under 9px, long track names cut with their full name kept", () => {
    const ev = (type: string, start: number, attrs: Record<string, string> = {}) => ({ type, start, end: start, attrs: Object.entries(attrs) }) as any;
    const t = { study: "s", patient: "P-1", source: { label: "", remote: false }, samples: [{ id: "P-1-T01", type: "Primary" }],
      events: [ev("Treatment", 0, { SUBTYPE: "A very long treatment subtype name that will not fit the header", AGENT: "X" }), ev("Treatment", 0, { SUBTYPE: "B" }),
        ev("Treatment", 0, { SUBTYPE: "B" }), ev("Specimen", 3, { SAMPLE_ID: "P-1-T01" }), ev("Status", 4000, { STATUS: "Deceased" })] } as any;
    for (const width of [480, 1200]) {
      const { svg } = timelineSvg(t, { width, interactive: true });
      assert.doesNotMatch(svg, /#(333|ccc|eee|999|bbb|aaa|555|666|f1f1f1|fff)\b|"white"|Arial/);
      for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) assert.ok(Number(m[1]) >= 9, "font-size " + m[1]);
      assert.deepEqual(overruns(svg), []);
      assert.match(svg, /class="tl-h" data-uid=/);
    }
  });
});
