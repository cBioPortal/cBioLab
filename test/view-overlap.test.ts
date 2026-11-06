// The overlap view (lib/views/overlap/): its runner, which adds each study's per-combination counts
// into patients in exactly each combination of cohorts, and its figure — area-proportional diagrams
// of samples and patients for two or three cohorts, an UpSet plot beyond.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOverlap } from "../lib/views/overlap/run.ts";
import { overlapSvg, overlapVennSvg } from "../lib/views/overlap/figure.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { OverlapResult } from "../lib/views/overlap/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const cohort = (counts: Record<string, number>, total?: number): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: total ?? Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
/** a local participant whose overlap query answers `rows` (bits in the order of the cohorts reaching it) */
const site = (rows: Row[], seen?: { defs: number }) => ({
  instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
  viewAggregate: async () => [],
  viewMeta: async () => [],
  viewAggregateMany: async (_l: string, defs: unknown[], build: (c: string[], s: string, d: string) => unknown) => {
    build(defs.map(() => "SELECT 'p' AS patient_id"), "s", "db");
    if (seen) seen.defs = defs.length;
    return rows;
  },
});
const remote = () => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}

describe("overlap: the runner", () => {
  test("fewer than two cohorts, or more than six, is refused by name", async () => {
    const one = await runOverlap({ kind: "overlap" }, ctx({ A: cohort({ s1: 1 }) }, { s1: site([]) }));
    assert.match(one.error!, /at least two cohorts.*draws 1/);
    const seven = Object.fromEntries("ABCDEFG".split("").map((n) => [n, cohort({ s1: 1 })]));
    const many = await runOverlap({ kind: "overlap" }, ctx(seven, { s1: site([]) }));
    assert.match(many.error!, /at most 6 cohorts/);
  });

  test("no participant that can count: refused, naming the remote peer", async () => {
    const r = await runOverlap({ kind: "overlap" }, ctx({ A: cohort({ p: 1 }), B: cohort({ p: 1 }) }, { p: remote() }));
    assert.match(r.error!, /no participant can answer: p is a remote peer/);
  });

  test("each study's local bits map to the view's cohorts; combinations add across studies, largest first", async () => {
    // A, B, C reach s1 (bits A=1, B=2, C=4); only A and C reach s2 (bits A=1, C=2).
    // s1: A only 3 patients (4 samples), A∩B 2 (2), none 5 (not in any cohort: ignored)
    // s2: C only 1 (1), A∩C 4 (5)
    // → A∩C 4, A only 3, A∩B 2, C only 1; union 10; A 3+2+4 = 9, B 2, C 4+1 = 5
    const seen2 = { defs: 0 };
    const c = ctx({ A: cohort({ s1: 5, s2: 4 }), B: cohort({ s1: 2 }), C: cohort({ s1: 0, s2: 5 }, 6) }, {
      s1: site([{ mask: 1, n: 3, samples: 4 }, { mask: 3, n: 2, samples: 2 }, { mask: 0, n: 5, samples: 5 }]),
      s2: site([{ mask: 2, n: 1, samples: 1 }, { mask: 3, n: 4, samples: 5 }], seen2),
    });
    const r = await runOverlap({ kind: "overlap" }, c);
    const ov = (r as ViewResult & { overlap: OverlapResult }).overlap;
    assert.equal(seen2.defs, 2, "s2 is asked only for the cohorts that reach it");
    assert.deepEqual(ov.intersections, [
      { members: ["A", "C"], n: 4, samples: 5 }, { members: ["A"], n: 3, samples: 4 },
      { members: ["A", "B"], n: 2, samples: 2 }, { members: ["C"], n: 1, samples: 1 }]);
    assert.equal(ov.union, 10);
    assert.deepEqual(ov.sets, [{ name: "A", size: 9, samples: 11 }, { name: "B", size: 2, samples: 2 }, { name: "C", size: 5, samples: 6 }]);
    assert.deepEqual(r.studies, ["s1", "s2"]);
    assert.match(r.caveat!, /10 patients are in at least one of the 3 cohorts/);
    assert.match(r.caveat!, /A patient in two studies is two patients here/);
    assert.match(r.caveat!, /samples diagram/, "two or three cohorts are drawn as diagrams, and the caveat explains them");
    // C was counted as 6 patients when evaluated, but adds to 5 here: the definition gave two answers
    assert.match(r.caveat!, /WARNING: C counted differently here than as a cohort/);
    assert.doesNotMatch(r.caveat!, /WARNING: [^.]*\bA\b/);
  });

  test("a remote study is named as left out, and its cohorts are not warned about", async () => {
    const r = await runOverlap({ kind: "overlap" }, ctx({ A: cohort({ s1: 2, p: 3 }), B: cohort({ s1: 1 }), C: cohort({ s1: 1 }), D: cohort({ s1: 1 }) },
      { s1: site([{ mask: 1, n: 2 }, { mask: 2 | 4 | 8, n: 1 }]), p: remote() }));
    assert.deepEqual((r as ViewResult & { overlap: OverlapResult }).overlap.excluded, [{ study: "p", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.match(r.caveat!, /Left out: p \(a remote peer/);
    assert.doesNotMatch(r.caveat!, /WARNING/);
    assert.doesNotMatch(r.caveat!, /samples diagram/, "four cohorts draw an UpSet plot");
    assert.equal((r as ViewResult & { overlap: OverlapResult }).overlap.sets[0].samples, 0, "a site that sends no sample counts adds none");
  });
});

// ---- the figure -------------------------------------------------------------------------------

const circles = (svg: string) => [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }));
/** the area two circles share, written out independently of the figure's own */
function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const part = (a: number, b: number) => a * a * Math.acos((d * d + a * a - b * b) / (2 * d * a));
  return part(r1, r2) + part(r2, r1) - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
}
const ov = (sets: OverlapResult["sets"], intersections: OverlapResult["intersections"]): OverlapResult =>
  ({ sets, intersections, union: intersections.reduce((a, x) => a + x.n, 0) });
const view = (r: OverlapResult) => ({ kind: "overlap" as const, cohorts: r.sets.map((s) => s.name), overlap: r, caveat: "the caveat" });

describe("overlap: the two-or-three-cohort diagrams", () => {
  // A has 10 patients, B 6, sharing 4: A only 6, B only 2
  const two = ov([{ name: "A", size: 10, samples: 14 }, { name: "B", size: 6, samples: 6 }],
    [{ members: ["A"], n: 6, samples: 9 }, { members: ["A", "B"], n: 4, samples: 5 }, { members: ["B"], n: 2, samples: 1 }]);

  test("circles are area-proportional and placed so their lens is the pair's overlap", () => {
    const { body } = overlapVennSvg(two, "patients", { size: 300 });
    const [a, b] = circles(body);
    assert.ok(Math.abs((a.r * a.r) / (b.r * b.r) - 10 / 6) < 1e-3, "area ∝ size");
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(Math.abs(lensArea(a.r, b.r, d) / (Math.PI * a.r * a.r) - 4 / 10) < 1e-3, "lens / A = 4 / 10");
    for (const n of ["6", "4", "2"]) assert.match(body, new RegExp(">" + n + "</text>"), "region " + n + " is labelled");
    assert.match(body, /Patients overlap/);
  });

  test("the samples diagram counts samples, and its tooltips say so", () => {
    const { body } = overlapVennSvg(two, "samples");
    const [a, b] = circles(body);
    assert.ok(Math.abs((a.r * a.r) / (b.r * b.r) - 14 / 6) < 1e-3);
    assert.match(body, /Samples overlap/);
    assert.match(body, /<title>A: 14 samples<\/title>/);
    assert.match(body, /<title>A ∩ B: 5 samples<\/title>/);
  });

  test("disjoint cohorts are drawn apart; a cohort inside another is drawn inside it", () => {
    const apart = circles(overlapVennSvg(ov([{ name: "A", size: 5, samples: 5 }, { name: "B", size: 5, samples: 5 }],
      [{ members: ["A"], n: 5, samples: 5 }, { members: ["B"], n: 5, samples: 5 }]), "patients").body);
    assert.ok(Math.hypot(apart[0].x - apart[1].x, apart[0].y - apart[1].y) > apart[0].r + apart[1].r);
    const inside = circles(overlapVennSvg(ov([{ name: "A", size: 9, samples: 9 }, { name: "B", size: 4, samples: 4 }],
      [{ members: ["A"], n: 5, samples: 5 }, { members: ["A", "B"], n: 4, samples: 4 }]), "patients").body);
    assert.ok(Math.hypot(inside[0].x - inside[1].x, inside[0].y - inside[1].y) <= inside[0].r - inside[1].r + 1e-6);
  });

  test("a region too small to hold its number is listed under the diagram, never dropped", () => {
    const r = ov([{ name: "A", size: 5001, samples: 5001 }, { name: "B", size: 5001, samples: 5001 }],
      [{ members: ["A"], n: 5000, samples: 5000 }, { members: ["B"], n: 5000, samples: 5000 }, { members: ["A", "B"], n: 1, samples: 1 }]);
    const out = overlapVennSvg(r, "patients", { size: 300 });
    assert.match(out.body, /too small to label:/);
    assert.match(out.body, /A ∩ B: 1/);
    assert.ok(out.height > 24 + 300, "the list adds height");
  });

  test("three cohorts: a third circle placed from both pairs; a combination with no one is not labelled", () => {
    const r = ov([{ name: "A", size: 30, samples: 30 }, { name: "B", size: 30, samples: 30 }, { name: "C", size: 30, samples: 30 }], [
      { members: ["A"], n: 15, samples: 15 }, { members: ["B"], n: 15, samples: 15 }, { members: ["C"], n: 15, samples: 15 },
      { members: ["A", "B"], n: 5, samples: 5 }, { members: ["A", "C"], n: 5, samples: 5 }, { members: ["B", "C"], n: 5, samples: 5 },
      { members: ["A", "B", "C"], n: 5, samples: 0 }]);
    const s = overlapVennSvg(r, "samples");
    assert.equal(circles(s.body).length, 3);
    assert.doesNotMatch(s.body, /A ∩ B ∩ C: 0/);
    const svg = overlapSvg(view(r), { theme: "auto" });
    assert.match(svg, /Samples overlap.*Patients overlap/s);
    assert.match(svg, /30 patients · 30 samples/, "the key gives each cohort's size in both units");
    assert.match(svg, /the caveat/);
  });

  test("a narrow width keeps each diagram at least 200 wide and grows the figure", () => {
    const svg = overlapSvg(view(two), { width: 300 });
    assert.match(svg, /viewBox="0 0 448 /, "16 + 2×200 + 32");
  });

  test("without sample counts, even two cohorts are an UpSet plot", () => {
    const r = ov([{ name: "A", size: 10 }, { name: "B", size: 6 }], [{ members: ["A"], n: 6 }, { members: ["A", "B"], n: 4 }, { members: ["B"], n: 2 }]);
    const svg = overlapSvg(view(r), {});
    assert.doesNotMatch(svg, /Patients overlap/);
    assert.match(svg, /12 patients in at least one cohort · 3 non-empty combinations of 3/);
  });
});

describe("overlap: the UpSet plot", () => {
  const four = (n: (m: number) => number, names = ["A", "B", "C", "D"]) => {
    const inter: OverlapResult["intersections"] = [];
    for (let m = 1; m < 16; m++) inter.push({ members: names.filter((_, i) => m & (1 << i)), n: n(m), samples: n(m) });
    inter.sort((a, b) => b.n - a.n);
    const sets = names.map((name) => ({ name, size: inter.filter((x) => x.members.includes(name)).reduce((a, x) => a + x.n, 0), samples: 1 }));
    return ov(sets, inter);
  };

  test("a combination only samples share has no column, and the summary counts only patients' combinations", () => {
    const r = four((m) => (m === 15 ? 0 : m));
    const svg = overlapSvg(view(r), { width: 1200 });
    assert.match(svg, /14 non-empty combinations of 15/);
    assert.doesNotMatch(svg, /A ∩ B ∩ C ∩ D: 0 patients/);
    assert.match(svg, /<title>A ∩ B ∩ C: 7 patients<\/title>/);
    assert.match(svg, />patients in exactly these cohorts</, "the bars' axis is titled where the corner has room");
  });

  test("one combination is named in the singular", () => {
    const r = ov([{ name: "A", size: 3 }, { name: "B", size: 0 }, { name: "C", size: 0 }, { name: "D", size: 0 }], [{ members: ["A"], n: 3 }]);
    assert.match(overlapSvg(view(r), {}), /3 patients in at least one cohort · 1 non-empty combination of 15/);
  });

  test("counts too wide for their column are turned on their side", () => {
    const flat = overlapSvg(view(four((m) => m)), { width: 1600 });
    assert.doesNotMatch(flat, /rotate\(-90[^)]*\)">\d/);
    const big = overlapSvg(view(four((m) => 1_000_000 + m)), { width: 480 });
    assert.match(big, /rotate\(-90/);
    assert.match(big, />1,000,015</);
  });
});
