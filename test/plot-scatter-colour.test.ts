// A single-study scatter drawn as its points takes colorBy and ringBy as a box's points do, and
// wherever a plot's points are coloured, colorLabel / ringLabel name the colouring axes. Written
// from the case table for PLT-CL-8 / PLT-SC-6 (docs/legacy-spec/04-plots.md; cbioportal-frontend
// cd8c6df PlotsTabUtils.tsx:1877-2397): rows R1–R5 run the runner over a fake single-study
// resolver, rows G1–G4 render the figure.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { pointTip } from "../lib/views/plot/point-tip.ts";
import { legendFor } from "../lib/federation.ts";
import { POINTS_CAP, type PlotData } from "../lib/plot.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { LAYER_BASE } from "../lib/plot-layers.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { DrawnResultOf, ViewResultOf } from "../lib/types.ts";

const EXTENT = { x0: 0, x1: 100, y0: 0, y1: 50 };
const scatter = (n: number, bins = [{ bx: 0, by: 0, n }]): PlotData => ({
  shape: "scatter", n, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { ...EXTENT }, grid: [240, 160], bins,
  stats: { pearson: 0.1, spearman: 0.1, slope: 1, intercept: 0, pPearson: 0.5, pSpearman: 0.5 } });
const box = (n: number): PlotData => ({ shape: "box", n, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
  groups: [{ g: "A", n, lo: 0, hi: 100, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 12 }], overlay: "violin", violin: [] });

const COLOURS = ["BRCA", "BRCA", "LUAD"];
const RINGS = ["Male", "Female", "Male"];
type Spec = { colorBy?: unknown; ringBy?: unknown };

/** a single patient-level study: `plotScatterPoints` / `plotPoints` answer 3 cases, with `c` / `r` when the spec colours or rings them */
function fake(data: () => PlotData) {
  const tag = (spec: Spec, i: number) => ({ ...(spec.colorBy ? { c: COLOURS[i] } : {}), ...(spec.ringBy ? { r: RINGS[i] } : {}) });
  return {
    instance: { mode: "patient-level", conn: { db: "db" }, label: "s" },
    plot: async () => data(),
    plotScatterPoints: async (_d: unknown, spec: Spec, _cap?: number, sparse?: unknown) =>
      sparse ? [] : [0, 1, 2].map((i) => ({ id: "p" + i, x: i * 10, y: i * 5, ...tag(spec, i) })),
    plotPoints: async (_d: unknown, spec: Spec) => [0, 1, 2].map((i) => ({ id: "p" + i, g: "A", v: i + 3, ...tag(spec, i) })),
    plotOutlierPoints: async () => ({ points: [], total: 0 }),
    plotRankedPoints: async () => [],
  };
}

const evaluated = (count: number): EvaluatedCohort =>
  ({ studies: ["s"], perStudy: { s: { sql: "", count, samples: count, mode: "patient-level" } }, count, samples: count, text: "" } as unknown as EvaluatedCohort);

async function run(resolver: Record<string, unknown>, view: Record<string, unknown> = {}): Promise<ViewResultOf<"plot">> {
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(1000) }, resolvers: { s: resolver }, vNames: ["All"], vStudies: ["s"],
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" }, ...view };
  const r = await runPlot(v as never, c);
  const out = "result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r as ViewResultOf<"plot">;
  assert.equal((out as { error?: string }).error, undefined, "the plot runs");
  return out;
}

const CANCER_TYPE = { source: "clinical", attribute: "CANCER_TYPE" };
const SEX = { source: "clinical", attribute: "SEX" };

describe("runPlot: a scatter's points coloured and ringed", () => {
  test("R1 scatter with colorBy CANCER_TYPE: the points carry c, the legend is theirs, colorLabel names the axis", async () => {
    const p = (await run(fake(() => scatter(3)), { colorBy: CANCER_TYPE })).plot!;
    assert.deepEqual(p.pointSet, { rule: "all", drawn: 3 });
    assert.deepEqual(p.xyPoints?.map((x) => (x as { c?: string }).c), COLOURS, "each point carries its category");
    assert.deepEqual(p.legend, legendFor(COLOURS));
    assert.ok(p.legend!.every((l) => !l.ring), "no ring entry without ringBy");
    assert.equal(p.colorLabel, "CANCER_TYPE");
  });

  test("R2 R1 plus ringBy SEX: ring entries from the points' r, ringLabel names the axis", async () => {
    const p = (await run(fake(() => scatter(3)), { colorBy: CANCER_TYPE, ringBy: SEX })).plot!;
    assert.deepEqual(p.xyPoints?.map((x) => (x as { r?: string }).r), RINGS);
    assert.deepEqual(p.legend, [...legendFor(COLOURS), ...legendFor(RINGS, true)]);
    assert.deepEqual(p.legend!.filter((l) => l.ring).map((l) => l.label), ["Male", "Female"]);
    assert.equal(p.colorLabel, "CANCER_TYPE");
    assert.equal(p.ringLabel, "SEX");
  });

  test("R3 scatter without colorBy: plain points, no legend, no colorLabel", async () => {
    const p = (await run(fake(() => scatter(3)))).plot!;
    assert.equal(p.xyPoints?.length, 3);
    assert.ok(p.xyPoints!.every((x) => !("c" in x)), "no point carries a category");
    assert.equal(p.legend, undefined);
    assert.equal(p.colorLabel, undefined);
  });

  test("R4 a box drawn as points with colorBy: colorLabel names the colouring axis", async () => {
    const p = (await run(fake(() => box(3)), { x: CANCER_TYPE, colorBy: SEX })).plot!;
    assert.equal(p.overlay, "points");
    assert.deepEqual(p.legend, legendFor(COLOURS), "the legend is the points' c");
    assert.equal(p.colorLabel, "SEX");
  });

  test("R5 a scatter past POINTS_CAP (density) with colorBy: no points, no legend", async () => {
    const n = POINTS_CAP + 1000;
    const p = (await run(fake(() => scatter(n, [{ bx: 0, by: 0, n: n - 1 }, { bx: 5, by: 5, n: 1 }])), { colorBy: CANCER_TYPE })).plot!;
    assert.equal(p.pointSet!.rule, "none");
    assert.equal(p.xyPoints, undefined);
    assert.equal(p.legend, undefined);
  });
});

describe("runPlot: a participant that answers without the categories (review of #300)", () => {
  test("R6 a scatter whose points come back without c or r though the view colours and rings them: no key, and the caption says why", async () => {
    const r = fake(() => scatter(3));
    r.plotScatterPoints = async () => [0, 1, 2].map((i) => ({ id: "p" + i, x: i * 10, y: i * 5 }));
    const out = await run(r, { colorBy: CANCER_TYPE, ringBy: SEX });
    assert.equal(out.plot!.legend, undefined);
    assert.match(out.note || "", /not coloured: the study's participant answered without their colour and ring categories/);
  });
});

describe("pointTip: a coloured scatter point names its categories (review of #300)", () => {
  test("R7 the tip of a scatter point lists its colour and ring after x and y", () => {
    const d: PlotData = { ...scatter(3), xyPoints: [{ id: "a", x: 1, y: 2, c: "X", r: "R" }], colorLabel: "Colour attr", ringLabel: "Ring attr" };
    const tip = pointTip(d, "a", "base")!;
    assert.deepEqual(tip.rows.slice(2), [["Colour attr", "X"], ["Ring attr", "R"]]);
  });
});

describe("the scatter figure: coloured and ringed points, and their legends", () => {
  const base = { shape: "scatter", n: 3, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
    extent: { x0: 0, x1: 10, y0: 0, y1: 10 }, grid: [10, 10], bins: [{ bx: 1, by: 1, n: 2 }, { bx: 5, by: 5, n: 1 }],
    stats: { pearson: 0.1, spearman: 0.1, slope: 0, intercept: 0, pPearson: 0.5, pSpearman: 0.5 }, pointSet: { rule: "all", drawn: 3 } };
  const coloured = viewToSvg({ kind: "plot", plot: { ...base,
    xyPoints: [{ id: "a", x: 1, y: 1, c: "X" }, { id: "b", x: 1.2, y: 1.1, c: "Y", r: "R" }, { id: "c", x: 5, y: 5, c: "X" }],
    legend: [{ label: "X", color: "#111111" }, { label: "Y", color: "#222222" }, { label: "R", color: "#333333", ring: true }],
    colorLabel: "Colour attr", ringLabel: "Ring attr" } } as unknown as DrawnResultOf<"plot">)!;
  /** the case's own circle, found by its data-id */
  const circle = (svg: string, id: string) => {
    const m = svg.match(new RegExp('<circle data-id="' + id + '"[^>]*>'));
    assert.ok(m, "a circle for case " + id);
    return m[0];
  };
  const attr = (tag: string, name: string) => tag.match(new RegExp("\\s" + name + '="([^"]*)"'))?.[1];
  const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  test("G1 each case's circle is filled with its category's colour", () => {
    assert.equal(attr(circle(coloured, "a"), "fill"), "#111111");
    assert.equal(attr(circle(coloured, "b"), "fill"), "#222222");
    assert.equal(attr(circle(coloured, "c"), "fill"), "#111111");
  });

  test("G2 a ringed case's circle is stroked in its ring colour; an unringed one is not", () => {
    assert.equal(attr(circle(coloured, "b"), "stroke"), "#333333");
    assert.notEqual(attr(circle(coloured, "a"), "stroke"), "#333333");
  });

  test("G3 a legend titled by colorLabel with X and Y, and one titled by ringLabel (ring) with R", () => {
    const t = texts(coloured);
    assert.ok(t.includes("Colour attr"), "colour legend title; texts: " + t.join(" | "));
    assert.ok(t.includes("X") && t.includes("Y"), "colour legend entries");
    assert.ok(t.includes("Ring attr (ring)"), "ring legend title");
    assert.ok(t.includes("R"), "ring legend entry");
  });

  test("G4 points without c draw in the base colour, with no colour legend", () => {
    const svg = viewToSvg({ kind: "plot", plot: { ...base,
      xyPoints: [{ id: "a", x: 1, y: 1 }, { id: "b", x: 1.2, y: 1.1 }, { id: "c", x: 5, y: 5 }] } } as unknown as DrawnResultOf<"plot">)!;
    for (const id of ["a", "b", "c"]) assert.equal(attr(circle(svg, id), "fill"), LAYER_BASE);
    const t = texts(svg);
    assert.ok(!t.includes("colour") && !t.some((s) => s.endsWith("(ring)")), "no colour or ring legend; texts: " + t.join(" | "));
  });
});
