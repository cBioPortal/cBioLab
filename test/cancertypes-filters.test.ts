// The Cancer Types Summary's group filters, filter alert and sort (lib/views/cancertypes/run.ts,
// figure.ts, kind.ts), driven with a hand-made participant. Each test is a row of the case table
// (T: which groups are shown, A: the filter alert, S: the order, E: nothing shown), from
// cbioportal-frontend cd8c6df CancerSummaryContent.tsx: groupKeysSorted / determineSorterAndDirection,
// chartData (the filter), totalCasesMin + initializeSliderValue (the default "Min. # Total"), and the
// category-filtering alert.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCancertypes } from "../lib/views/cancertypes/run.ts";
import { cancertypesSvg, cancertypesPanelSvg } from "../lib/views/cancertypes/figure.ts";
import { cancertypesKind } from "../lib/views/cancertypes/kind.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const ALL = "\x01all";
/** a group as the participant answers it: its key (the raw value, or the study id), profiled and altered units; `label` the name a by-study group carries */
type G = { key: string; profiled: number; altered: number; label?: string; samples?: number };
const g = (key: string, profiled: number, altered: number, extra: Partial<G> = {}): G => ({ key, profiled, altered, ...extra });

const rowsOf = (gene: string, gs: G[]): Row[] => gs.map((x) => ({ gene, grp: x.key, label: x.label ?? x.key, profiled: x.profiled, altered: x.altered,
  mutation: x.altered, amp: 0, homdel: 0, sv: 0, multiple: 0 }));
const sum = (gs: G[], k: "profiled" | "altered") => gs.reduce((a, x) => a + x[k], 0);

/**
 * One cohort of one study. `groups` are the genes together (gene "*"); `perGene` each gene's own
 * counts per group (a gene tab). Every group has units in the cohort (`samples`, default its
 * profiled, at least 1), so a group with profiled 0 is a group of units none of which was profiled.
 */
function ctx(o: { groups: G[]; perGene?: Record<string, G[]> }, asked: string[] = []): ViewRun {
  const rows: Row[] = [...rowsOf("*", o.groups), ...Object.entries(o.perGene || {}).flatMap(([gene, gs]) => rowsOf(gene, gs)),
    { gene: "*", grp: ALL, profiled: sum(o.groups, "profiled"), altered: sum(o.groups, "altered") }];
  const samplesOf = (x: G) => x.samples ?? Math.max(1, x.profiled);
  const tot: Row[] = [...o.groups.map((x) => ({ grp: x.key, samples: samplesOf(x), mut: x.profiled, cna: 0, sv: 0 })),
    { grp: ALL, samples: o.groups.reduce((a, x) => a + samplesOf(x), 0), mut: sum(o.groups, "profiled"), cna: 0, sv: 0 }];
  const n = o.groups.reduce((a, x) => a + samplesOf(x), 0);
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" } },
    count: n, samples: n, text: "" } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string) => { asked.push(label); return label.startsWith("cancertypes:samples:") ? tot : rows; },
  };
  return {
    doc: { study: "s1", cohorts: { A: { study: "s1" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: site } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}

type Grp = { key: string; label: string; profiled: number; altered: number };
type Shown = { groups: Grp[]; categories?: number; minSamples?: number; filtered?: boolean; pooled?: unknown };
type Panel = Shown & { cohort: string; profiled: number; altered: number; perGene?: (Shown & { gene: string })[] };
type Ct = { show: string; minSamples: unknown; panels: Panel[] };
const run = (o: Parameters<typeof ctx>[0], view: Record<string, unknown> = {}, asked: string[] = []) =>
  runCancertypes({ kind: "cancertypes", genes: ["KRAS"], groupBy: "CANCER_TYPE", ...view } as never, ctx(o, asked));
const err = (r: ViewResult) => (r as { error?: string }).error;
const ct = (r: ViewResult) => {
  const e = err(r);
  assert.equal(e, undefined, "not refused; got " + e);
  return (r as unknown as { cancertypes: Ct }).cancertypes;
};
const panel = (r: ViewResult) => ct(r).panels[0];
const tab = (r: ViewResult, gene: string) => {
  const t = panel(r).perGene?.find((x) => x.gene === gene);
  assert.ok(t, "a per-gene tab for " + gene);
  return t;
};
const keys = (s: Shown) => s.groups.map((x) => x.key);
const shownSet = (s: Shown) => keys(s).slice().sort();

/** the results text */
const text = (r: ViewResult) => {
  const out: string[] = [];
  cancertypesKind.text!(r as never, { out, caveatOf: () => "", noteOf: () => "" } as never);
  return out.join("\n");
};
/** an SVG's words, tags dropped and whitespace folded, so a sentence wrapped or shortened (its full text in a <title>) still reads whole */
const words = (svg: string) => svg.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const figure = (r: ViewResult) => words(cancertypesSvg(r as never, { width: 1600 }));
const tabFigure = (r: ViewResult, gene: string) => words(cancertypesPanelSvg(ct(r) as never, 0, { width: 1600, gene }).body);
const alert = (shown: number, of: number, label: string) => `${shown} of ${of} categories (${label}) are shown based on filtering.`;
const ALERT_RE = /are shown based on filtering/;

// ---- T: which groups are shown ----------------------------------------------------------------

describe("cancertypes filters — T: which groups are shown", () => {
  test("T1a minSamples unset, the largest profiled group > 10: threshold 10 (inclusive); no pooled bar", async () => {
    const r = await run({ groups: [g("Big", 300, 30), g("Ten", 10, 2), g("Nine", 9, 3), g("Five", 5, 1)] });
    const p = panel(r);
    assert.equal(p.minSamples, 10, "the threshold applied");
    assert.deepEqual(shownSet(p), ["Big", "Ten"]);
    assert.equal(p.categories, 4);
    assert.equal(p.pooled, undefined, "the pooled bar is gone");
    // the edge: largest 11 is over 10
    const r11 = await run({ groups: [g("Eleven", 11, 2), g("Four", 4, 1)] });
    assert.equal(panel(r11).minSamples, 10);
    assert.deepEqual(shownSet(panel(r11)), ["Eleven"]);
  });

  test("T1b minSamples unset, the largest profiled group ≤ 10 (10, or 7): threshold 0, every group with profiled > 0 shown", async () => {
    const r10 = await run({ groups: [g("Ten", 10, 2), g("Three", 3, 1), g("One", 1, 0), g("None", 0, 0, { samples: 4 })] });
    assert.equal(panel(r10).minSamples, 0);
    assert.deepEqual(shownSet(panel(r10)), ["One", "Ten", "Three"]);
    assert.equal(panel(r10).categories, 4);
    const r7 = await run({ groups: [g("Seven", 7, 2), g("Two", 2, 1)] });
    assert.equal(panel(r7).minSamples, 0);
    assert.deepEqual(shownSet(panel(r7)), ["Seven", "Two"]);
  });

  test("T1c minSamples unset, two gene tabs: each tab's threshold from its own counts (KRAS 300 → 10, a rare gene 8 → 0)", async () => {
    const r = await run({
      groups: [g("G1", 300, 40), g("G2", 8, 2), g("G3", 5, 1)],
      perGene: { KRAS: [g("G1", 300, 40), g("G2", 8, 2), g("G3", 5, 1)], RARE: [g("G1", 8, 1), g("G2", 5, 1), g("G3", 2, 0)] },
    }, { genes: ["KRAS", "RARE"] });
    assert.equal(panel(r).minSamples, 10, "the genes together: largest 300");
    assert.deepEqual(shownSet(panel(r)), ["G1"]);
    const kras = tab(r, "KRAS"), rare = tab(r, "RARE");
    assert.equal(kras.minSamples, 10);
    assert.deepEqual(shownSet(kras), ["G1"]);
    assert.equal(kras.categories, 3);
    assert.equal(rare.minSamples, 0, "the rare gene's largest group is 8");
    assert.deepEqual(shownSet(rare), ["G1", "G2", "G3"]);
    assert.equal(rare.categories, 3);
    assert.equal(kras.pooled, undefined);
    assert.equal(rare.pooled, undefined);
  });

  test("T2 minSamples n set (0, 1, 50, and past the old 1000 cap): profiled ≥ n, inclusive; n = 0 still hides profiled 0", async () => {
    const groups = [g("P50", 50, 5), g("P49", 49, 5), g("P1", 1, 1), g("P0", 0, 0, { samples: 3 })];
    const cases: [number, string[]][] = [[0, ["P1", "P49", "P50"]], [1, ["P1", "P49", "P50"]], [50, ["P50"]], [2000, []]];
    for (const [n, want] of cases) {
      const p = panel(await run({ groups }, { minSamples: n }));
      assert.equal(p.minSamples, n, "minSamples " + n);
      assert.deepEqual(shownSet(p), want, "minSamples " + n);
      assert.equal(p.categories, 4, "minSamples " + n);
    }
  });

  test("T3 a group with units but none profiled is never shown, whatever the thresholds, and still counted in categories", async () => {
    const zeroRow = [g("Seen", 20, 5), g("Unprofiled", 0, 0, { samples: 12 })];
    for (const view of [{ minSamples: 0 }, { minSamples: 0, minAltered: 0, show: "count" }, {}]) {
      const p = panel(await run({ groups: zeroRow }, view));
      assert.deepEqual(keys(p), ["Seen"], JSON.stringify(view));
      assert.equal(p.categories, 2, JSON.stringify(view));
    }
    // in a gene tab too: KRAS profiled nowhere in "Unprofiled"
    const r = await run({ groups: zeroRow, perGene: { KRAS: zeroRow, NRAS: [g("Seen", 20, 0), g("Unprofiled", 0, 0)] } }, { genes: ["KRAS", "NRAS"], minSamples: 0 });
    assert.deepEqual(keys(tab(r, "KRAS")), ["Seen"]);
    assert.equal(tab(r, "KRAS").categories, 2);
  });

  test("T4a show frequency, minAltered 40: 40.0 % and 50 % shown (inclusive), 39.9 % hidden", async () => {
    const r = await run({ groups: [g("At40", 1000, 400), g("At399", 1000, 399), g("At50", 1000, 500)] }, { minSamples: 1, minAltered: 40 });
    assert.deepEqual(shownSet(panel(r)), ["At40", "At50"]);
  });

  test("T4b show count, minAltered 20: altered 20 and 30 shown, 19 hidden", async () => {
    const r = await run({ groups: [g("A20", 100, 20), g("A19", 100, 19), g("A30", 100, 30)] }, { minSamples: 1, minAltered: 20, show: "count" });
    assert.deepEqual(shownSet(panel(r)), ["A20", "A30"]);
  });

  test("T5 every condition together: a group is shown only if it meets all of them", async () => {
    const groups = [g("Both", 100, 20), g("TooSmall", 40, 20), g("TooFew", 100, 5), g("Unprofiled", 0, 0, { samples: 9 })];
    const p = panel(await run({ groups }, { minSamples: 50, minAltered: 10 }));
    assert.deepEqual(keys(p), ["Both"]);
    assert.equal(p.categories, 4);
    const c = panel(await run({ groups }, { minSamples: 50, minAltered: 10, show: "count" }));
    assert.deepEqual(keys(c), ["Both"], "count: TooSmall (20 altered) still under minSamples, TooFew (5) under 10");
  });

  test("T6 minSamples −1, 1.5, \"x\" and minAltered −1, \"x\" are refused, naming the field and its range", async () => {
    const groups = [g("Big", 300, 30)];
    const cases: [string, unknown][] = [["minSamples", -1], ["minSamples", 1.5], ["minSamples", "x"], ["minAltered", -1], ["minAltered", "x"]];
    for (const [field, value] of cases) {
      const r = await run({ groups }, { [field]: value });
      const e = err(r);
      assert.ok(e, field + " " + JSON.stringify(value) + " refused; got " + JSON.stringify(r).slice(0, 160));
      assert.match(e!, new RegExp(field), "names the field: " + e);
      assert.match(e!, /\b0\b/, "states the range (from 0): " + e);
      assert.equal((r as unknown as { cancertypes?: unknown }).cancertypes, undefined);
    }
  });
});

// ---- A: the filter alert ----------------------------------------------------------------------

describe("cancertypes filters — A: the filter alert", () => {
  test("A1 fewer shown than categories with a threshold applied: filtered, and the figure and the results text say so", async () => {
    // the default threshold (10) hides Small; the unprofiled group counts among the categories
    const r = await run({ groups: [g("Big", 300, 30), g("Small", 5, 1), g("Unprofiled", 0, 0, { samples: 4 })] });
    const p = panel(r);
    assert.equal(p.filtered, true);
    const sentence = alert(1, 3, "Cancer Type");
    assert.ok(figure(r).includes(sentence), "the figure: " + sentence);
    assert.ok(text(r).includes(sentence), "the results text: " + sentence);
    // minAltered alone (threshold 0) hides one
    const r2 = await run({ groups: [g("Hi", 7, 5), g("Lo", 5, 1)] }, { minAltered: 50 });
    assert.equal(panel(r2).minSamples, 0);
    assert.equal(panel(r2).filtered, true);
    assert.ok(text(r2).includes(alert(1, 2, "Cancer Type")), text(r2));
    assert.ok(figure(r2).includes(alert(1, 2, "Cancer Type")));
  });

  test("A1 in a gene tab: the tab's own counts", async () => {
    const r = await run({
      groups: [g("G1", 300, 40), g("G2", 50, 2)],
      perGene: { KRAS: [g("G1", 300, 40), g("G2", 50, 2)], RARE: [g("G1", 40, 1), g("G2", 5, 1)] },
    }, { genes: ["KRAS", "RARE"] });
    assert.equal(panel(r).filtered, undefined, "the genes together: both groups shown");
    assert.equal(tab(r, "KRAS").filtered, undefined);
    assert.equal(tab(r, "RARE").filtered, true, "G2 has 5 profiled for RARE, under 10");
    assert.ok(tabFigure(r, "RARE").includes(alert(1, 2, "Cancer Type")));
    assert.doesNotMatch(tabFigure(r, "KRAS"), ALERT_RE);
  });

  test("A2 fewer shown only because some have profiled 0, both thresholds 0: no alert", async () => {
    const groups = [g("Seven", 7, 2), g("Five", 5, 1), g("Unprofiled", 0, 0, { samples: 6 })];
    for (const view of [{}, { minSamples: 0 }, { minSamples: 0, minAltered: 0 }]) {
      const r = await run({ groups }, view);
      const p = panel(r);
      assert.equal(p.groups.length, 2, JSON.stringify(view));
      assert.equal(p.categories, 3, JSON.stringify(view));
      assert.equal("filtered" in p, false, "filtered absent: " + JSON.stringify(view));
      assert.doesNotMatch(text(r), ALERT_RE);
      assert.doesNotMatch(figure(r), ALERT_RE);
    }
  });

  test("A3 every group shown though a threshold is set: no alert", async () => {
    for (const view of [{ minSamples: 10 }, {}, { minSamples: 10, minAltered: 5 }]) {
      const r = await run({ groups: [g("Big", 300, 30), g("Mid", 50, 10)] }, view);
      const p = panel(r);
      assert.equal(p.groups.length, 2, JSON.stringify(view));
      assert.equal(p.categories, 2, JSON.stringify(view));
      assert.equal("filtered" in p, false, JSON.stringify(view));
      assert.doesNotMatch(text(r), ALERT_RE);
      assert.doesNotMatch(figure(r), ALERT_RE);
    }
  });

  test("A4 the alert's label: study → Cancer Study, CANCER_TYPE → Cancer Type, CANCER_TYPE_DETAILED → Cancer Type Detailed, any other → its name", async () => {
    const groups = [g("Big", 300, 30), g("Small", 5, 1)];
    const cases: [string, string][] = [["study", "Cancer Study"], ["CANCER_TYPE", "Cancer Type"],
      ["CANCER_TYPE_DETAILED", "Cancer Type Detailed"], ["TUMOR_GRADE", "TUMOR_GRADE"]];
    for (const [groupBy, label] of cases) {
      const r = await run({ groups }, { groupBy });
      assert.equal(panel(r).filtered, true, groupBy);
      assert.ok(text(r).includes(alert(1, 2, label)), groupBy + ": " + text(r));
      assert.ok(figure(r).includes(alert(1, 2, label)), groupBy);
    }
  });
});

// ---- S: the order of the shown groups ---------------------------------------------------------

describe("cancertypes filters — S: order", () => {
  test("S1 frequency, no sort: altered ÷ profiled descending, ties by more profiled", async () => {
    const r = await run({ groups: [g("Ten", 100, 10), g("QuarterSmall", 20, 5), g("QuarterBig", 40, 10), g("Half", 30, 15)] }, { minSamples: 1 });
    assert.deepEqual(keys(panel(r)), ["Half", "QuarterBig", "QuarterSmall", "Ten"]);
  });

  test("S2 count, no sort: altered descending, ties by more profiled", async () => {
    const r = await run({ groups: [g("Five", 10, 5), g("TenSmall", 20, 10), g("TenBig", 200, 10), g("Thirty", 300, 30)] }, { minSamples: 1, show: "count" });
    assert.deepEqual(keys(panel(r)), ["Thirty", "TenBig", "TenSmall", "Five"]);
  });

  test("S3a sort alphabetical, grouped by an attribute: by the raw value, code-unit order (\"Zeta\" before \"alpha\")", async () => {
    const groups = [g("beta", 50, 40), g("Zeta", 50, 1), g("alpha", 50, 10), g("Alpha", 50, 20)];
    for (const show of ["frequency", "count"]) {
      const r = await run({ groups }, { minSamples: 1, sort: "alphabetical", show });
      assert.deepEqual(keys(panel(r)), ["Alpha", "Zeta", "alpha", "beta"], show);
    }
  });

  test("S3b sort alphabetical, grouped by study: by the study id, not the displayed name", async () => {
    const r = await run({ groups: [g("study_b", 50, 40, { label: "Alpha Study (MSK, 2020)" }), g("study_a", 50, 1, { label: "Zeta Study (TCGA)" })] },
      { groupBy: "study", minSamples: 1, sort: "alphabetical" });
    const p = panel(r);
    assert.deepEqual(keys(p), ["study_a", "study_b"]);
    assert.deepEqual(p.groups.map((x) => x.label), ["Zeta Study (TCGA)", "Alpha Study (MSK, 2020)"]);
  });
});

// ---- E: nothing shown ---------------------------------------------------------------------------

describe("cancertypes filters — E: nothing shown", () => {
  test("E1 the thresholds hide every group: not refused, groups [], the figure says so with the alert, the cohort's totals still in the head", async () => {
    const r = await run({ groups: [g("Big", 300, 30), g("Mid", 60, 6)] }, { minSamples: 1000 });
    const p = panel(r);
    assert.deepEqual(p.groups, []);
    assert.equal(p.categories, 2);
    assert.equal(p.filtered, true);
    const fig = figure(r);
    assert.ok(fig.includes("No category passes the filters."), "the empty-panel message");
    assert.ok(fig.includes(alert(0, 2, "Cancer Type")), "the alert line");
    assert.ok(fig.includes("36 of 360 profiled patients altered"), "the cohort's totals in the panel head");
    assert.ok(text(r).includes(alert(0, 2, "Cancer Type")));
    // minAltered can do it too
    const r2 = await run({ groups: [g("Big", 300, 30), g("Mid", 60, 6)] }, { minAltered: 90 });
    assert.equal(err(r2), undefined);
    assert.deepEqual(panel(r2).groups, []);
    assert.ok(figure(r2).includes("No category passes the filters."));
  });
});
