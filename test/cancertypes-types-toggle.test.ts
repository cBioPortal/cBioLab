// The Cancer Types Summary's "Show Genomic Alteration Types" checkbox (CTS-OC-3 in
// docs/legacy-spec/02-cancer-types-summary.md; cbioportal-frontend CancerSummaryChart
// mergeAlterationDataAcrossAlterationTypes). The view's `alterationTypes?: false`: absent or true
// shows the per-type stack (the default); false draws one grey bar per group and no legend.
//
// Case table:
//   T1  hidden, frequency: each group is one rect filled #666, its top where the stacked bar's top is
//       (same baseline, height = sum of the stacked segments, within 0.2)
//   T2  hidden, show "count": the same, against the stacked count bars
//   T3  hidden: no per-type segment rects (no mutation/amp colours, no "<group> — <type>:" titles)
//   T4  hidden: no legend labels (Mutation, Amplification, Deep Deletion, Structural Variant,
//       Multiple Alterations); group names and the y-axis title still drawn
//   T5  hidden: the filter alert and the profiled-data rows are unchanged
//   T6  shown (alterationTypes: true): the SVG body is identical to the result without the key
//   T7  downloads: cancertypesTsv gives the same text hidden or shown (CTS-DL-3)
//   T8  validation: runCancertypes refuses alterationTypes "no", naming alterationTypes; true and
//       false are not refused; false is echoed in the result, true/absent leave no key
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cancertypesPanelSvg } from "../lib/views/cancertypes/figure.ts";
import { cancertypesTsv } from "../lib/views/cancertypes/tsv.ts";
import { runCancertypes } from "../lib/views/cancertypes/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { CancertypesGroup } from "../lib/views/cancertypes/types.ts";
import { PRIMARY } from "../lib/ch.ts";

const grp = (key: string, label: string, profiled: number, mutation: number, amp = 0, samples = profiled): CancertypesGroup =>
  ({ key, label, samples, profiled, altered: mutation + amp, mutation, amp, homdel: 0, sv: 0, multiple: 0 });
const withFor = (g: CancertypesGroup, sv: number) => ({ ...g, profiledFor: { mutation: g.profiled, cna: g.profiled, sv } });

type Ct = NonNullable<ViewResult["cancertypes"]>;
const base: Ct = { groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS"], minSamples: 10, minAltered: 0, show: "frequency", unit: "sample",
  panels: [{ cohort: "all", samples: 300, profiled: 290, altered: 120,
    groups: [withFor(grp("a", "GroupA", 100, 40, 20), 100), withFor(grp("b", "GroupB", 150, 30, 0, 160), 0)],
    categories: 5, minSamples: 10, filtered: true }] } as Ct;
const hide = (c: Ct): Ct => ({ ...c, alterationTypes: false } as Ct);
const asCount = (c: Ct): Ct => ({ ...c, show: "count" } as Ct);

type Rect = { y: number; height: number; fill: string; title: string };
const rects = (body: string): Rect[] => [...body.matchAll(/<rect\b([^>]*)>(?:<title>([^<]*)<\/title>)?/g)].map((m) => {
  const a = (n: string) => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1] ?? "";
  return { y: Number(a("y")), height: Number(a("height")), fill: a("fill"), title: m[2] ?? "" };
});
/** the stacked segments of a group: rects whose title is "<label> — <type>: …" */
const segments = (body: string, label: string) => rects(body).filter((r) => r.title.startsWith(label + " — "));
const grey = (body: string) => rects(body).filter((r) => r.fill.toLowerCase() === "#666");

function sameTop(c: Ct) {
  const stacked = cancertypesPanelSvg(c, 0).body;
  const flat = cancertypesPanelSvg(hide(c), 0).body;
  const bars = grey(flat);
  assert.equal(bars.length, 2, "one #666 bar per group; got " + bars.length);
  const segs = segments(stacked, "GroupA").filter((r) => r.height > 0);
  assert.ok(segs.length >= 2, "the stacked case draws A's segments");
  const baseline = Math.max(...segs.map((r) => r.y + r.height));
  const total = segs.reduce((s, r) => s + r.height, 0);
  const a = bars[0];
  assert.ok(Math.abs(a.y + a.height - baseline) <= 0.2, `A's bar sits on the baseline ${baseline}; got ${a.y + a.height}`);
  assert.ok(Math.abs(a.height - total) <= 0.2, `A's bar is as tall as its stack ${total}; got ${a.height}`);
}

const LEGEND = ["Mutation", "Amplification", "Deep Deletion", "Structural Variant", "Multiple Alterations"];

describe("cancertypes: Show Genomic Alteration Types", () => {
  test("T1 hidden, frequency: one #666 bar per group, its top where the stack's top is", () => sameTop(base));
  test("T2 hidden, show count: the same against the count stack", () => sameTop(asCount(base)));

  test("T3 hidden: no per-type segment rects", () => {
    const body = cancertypesPanelSvg(hide(base), 0).body;
    assert.equal(segments(body, "GroupA").length + segments(body, "GroupB").length, 0, "no '<group> — <type>' segments");
    assert.ok(!/fill="#008000"/i.test(body) && !/fill="#ff0000"/i.test(body), "no mutation / amplification fills");
  });

  test("T4 hidden: no legend; group names and the y-axis title stay", () => {
    const body = cancertypesPanelSvg(hide(base), 0).body;
    for (const l of LEGEND) assert.ok(!body.includes(">" + l + "<"), "no legend label " + l);
    assert.ok(body.includes("GroupA") && body.includes("GroupB"), "group labels drawn");
    assert.ok(body.includes("Alteration Frequency"), "y-axis title drawn");
    const shown = cancertypesPanelSvg(base, 0).body;
    assert.ok(LEGEND.slice(0, 2).every((l) => shown.includes(">" + l + "<")), "sanity: the shown case has the legend");
  });

  test("T5 hidden: the filter alert and the profiled-data rows are unchanged", () => {
    const body = cancertypesPanelSvg(hide(base), 0).body;
    assert.ok(body.includes("2 of 5 categories (Cancer Type) are shown based on filtering."));
    assert.ok(body.includes("Structural variant data"), "the SV profiled row");
    assert.equal((body.match(/>\+</g) || []).length, 1, "one '+', for A's SV");
  });

  test("T6 shown (true) is identical to the key absent", () => {
    const withTrue = { ...base, alterationTypes: true } as unknown as Ct;
    assert.equal(cancertypesPanelSvg(withTrue, 0).body, cancertypesPanelSvg(base, 0).body);
    assert.equal(cancertypesPanelSvg(asCount(withTrue), 0).body, cancertypesPanelSvg(asCount(base), 0).body);
  });

  test("T7 the Data file ignores the checkbox (CTS-DL-3)", () => {
    assert.equal(cancertypesTsv(hide(base) as never, 0, null), cancertypesTsv(base as never, 0, null));
  });
});

// ---- T8: validation, through runCancertypes with a hand-made participant (as cancertypes-filters.test.ts) ----

const ALL = "\x01all";
function ctx(): ViewRun {
  const gs = [{ key: "Big", profiled: 300, altered: 30 }];
  const rows = [...gs.map((x) => ({ gene: "*", grp: x.key, label: x.key, profiled: x.profiled, altered: x.altered, mutation: x.altered, amp: 0, homdel: 0, sv: 0, multiple: 0 })),
    { gene: "*", grp: ALL, profiled: 300, altered: 30 }];
  const tot = [{ grp: "Big", samples: 300, mut: 300, cna: 0, sv: 0 }, { grp: ALL, samples: 300, mut: 300, cna: 0, sv: 0 }];
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "SELECT 1", count: 300, samples: 300, mode: "patient-level" } },
    count: 300, samples: 300, text: "" } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string) => (label.startsWith("cancertypes:samples:") ? tot : rows),
  };
  return {
    doc: { study: "s1", cohorts: { A: { study: "s1" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: site } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Record<string, unknown>) =>
  runCancertypes({ kind: "cancertypes", genes: ["KRAS"], groupBy: "CANCER_TYPE", ...view } as never, ctx());
const err = (r: ViewResult) => (r as { error?: string }).error;
const ctOf = (r: ViewResult) => (r as unknown as { cancertypes?: Record<string, unknown> }).cancertypes;

describe("cancertypes: alterationTypes validation", () => {
  test("T8 \"no\" is refused naming alterationTypes; true/false accepted; only false is echoed", async () => {
    const bad = await run({ alterationTypes: "no" });
    assert.ok(err(bad), "refused; got " + JSON.stringify(bad).slice(0, 160));
    assert.match(err(bad)!, /alterationTypes/);
    assert.equal(ctOf(bad), undefined);
    const off = await run({ alterationTypes: false });
    assert.equal(err(off), undefined, "false not refused: " + err(off));
    assert.equal(ctOf(off)!.alterationTypes, false, "false echoed");
    for (const view of [{ alterationTypes: true }, {}]) {
      const on = await run(view);
      assert.equal(err(on), undefined, "not refused: " + err(on));
      assert.ok(!("alterationTypes" in ctOf(on)!), "no key when shown: " + JSON.stringify(view));
    }
  });
});
