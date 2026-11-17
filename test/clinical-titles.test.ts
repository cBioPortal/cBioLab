// A clinical attribute's display name, resolved onto its axis once (PLT-DT-19, PLT-SC-6), and the
// alteration axis titles cBioPortal's Plots tab writes (PlotsTabUtils.tsx getAxisLabel, cd8c6df).
// The resolvers are hand-made fakes whose `viewMeta` answers the rows a study's clinical metadata
// holds, `{ a: <attribute id>, name: <display name> }`, whatever SQL it is handed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { titledAxes } from "../lib/clinical-titles.ts";
import { axisLabel, validateAxis, type PlotAxis, type PlotData } from "../lib/plot.ts";
import { runPlot } from "../lib/views/plot/run.ts";
import { runForest } from "../lib/views/forest/run.ts";
import { runCox } from "../lib/views/cox/run.ts";
import { runLogistic } from "../lib/views/logistic/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewResultOf, ViewParticipation } from "../lib/types.ts";
import type { ForestResult } from "../lib/views/forest/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type NameRow = { a: string; name: string };
type Calls = string[];

/** a study's metadata as viewMeta answers it; the builder is run, so a broken one fails here */
const meta = (study: string, rows: NameRow[] | Error, calls: Calls = []) => ({
  viewMeta: async (label: string, build: (study: string, db: string) => unknown) => {
    calls.push(study + " " + label);
    build(study, "db");
    if (rows instanceof Error) throw rows;
    return rows;
  },
});

const AGE: PlotAxis = { source: "clinical", attribute: "AGE" };
const SEX: PlotAxis = { source: "clinical", attribute: "SEX" };

describe("titledAxes: a clinical axis takes the first display name its studies declare", () => {
  test("N1", async () => {
    const calls: Calls = [];
    const out = await titledAxes({ x: AGE, y: SEX },
      { a: meta("a", [{ a: "AGE", name: "Diagnosis Age" }], calls), b: meta("b", [{ a: "SEX", name: "Sex" }], calls) }, ["a", "b"]);
    assert.equal((out.x as { label?: string }).label, "Diagnosis Age");
    assert.equal(axisLabel(out.x!), "Diagnosis Age");
    for (const s of ["a", "b"]) assert.ok(calls.filter((c) => c.startsWith(s + " ")).length <= 1, "one query per study");
  });

  test("N2", async () => {
    const out = await titledAxes({ x: AGE, colorBy: SEX },
      { a: meta("a", [{ a: "AGE", name: "Diagnosis Age" }]), b: meta("b", [{ a: "SEX", name: "Sex" }]) }, ["a", "b"]);
    assert.equal((out.colorBy as { label?: string }).label, "Sex", "the second study's name, the first not declaring it");
    assert.equal(axisLabel(out.colorBy!), "Sex");
  });

  test("N3", async () => {
    const out = await titledAxes({ colorBy: SEX },
      { a: meta("a", [{ a: "SEX", name: "" }]), b: meta("b", [{ a: "SEX", name: "Sex" }]) }, ["a", "b"]);
    assert.equal((out.colorBy as { label?: string }).label, "Sex");
  });

  test("N4", async () => {
    const res = { a: meta("a", [{ a: "SEX", name: "Sex" }]), b: meta("b", [{ a: "SEX", name: "Gender" }]) };
    assert.equal(((await titledAxes({ x: SEX }, res, ["a", "b"])).x as { label?: string }).label, "Sex");
    assert.equal(((await titledAxes({ x: SEX }, res, ["b", "a"])).x as { label?: string }).label, "Gender", "studies order, not the resolvers'");
  });

  test("N5", async () => {
    const X: PlotAxis = { source: "clinical", attribute: "X" };
    const out = await titledAxes({ x: X }, { a: meta("a", [{ a: "AGE", name: "Diagnosis Age" }]), b: meta("b", []) }, ["a", "b"]);
    assert.equal((out.x as { label?: string }).label, undefined);
    assert.equal(axisLabel(out.x!), "X");
  });

  test("N6", async () => {
    const mine: PlotAxis = { source: "clinical", attribute: "AGE", label: "Mine" } as PlotAxis;
    const out = await titledAxes({ x: mine }, { a: meta("a", [{ a: "AGE", name: "Diagnosis Age" }]) }, ["a"]);
    assert.deepEqual(out.x, mine);
    assert.equal(axisLabel(out.x!), "Mine");
  });

  test("N7", async () => {
    const alt: PlotAxis = { source: "alteration", gene: "KRAS", by: "mutated" };
    const out = await titledAxes({ x: alt, y: AGE, ringBy: undefined },
      { a: meta("a", [{ a: "AGE", name: "Diagnosis Age" }, { a: "KRAS", name: "Not an attribute" }]) }, ["a"]);
    assert.deepEqual(out.x, alt);
    assert.equal(out.ringBy, undefined);
    assert.equal((out.y as { label?: string }).label, "Diagnosis Age");
  });

  test("N8", async () => {
    const out = await titledAxes({ colorBy: SEX },
      { a: meta("a", new Error("metadata unavailable")), b: meta("b", [{ a: "SEX", name: "Sex" }]) }, ["a", "b"]);
    assert.equal((out.colorBy as { label?: string }).label, "Sex");
  });

  test("N9", () => {
    const a = { source: "clinical", attribute: "AGE", log: true, label: "Diagnosis Age" } as PlotAxis;
    assert.equal(axisLabel(a), "Diagnosis Age (log2(value + 1))");
  });
});

describe("axisLabel / validateAxis: an alteration axis titled as the portal titles it", () => {
  test("A1", () => assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "mutated" }), "KRAS: Mutated vs Wild Type"));
  test("A2", () => assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "driver" }), "KRAS: Driver vs VUS Mutations"));
  test("A3", () => assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "sv" }), "KRAS: Variant vs No Variant"));
  test("A4", () => assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "mutationType" }), "KRAS: Mutations"));
  test("A5", () => assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "cna" }), "KRAS copy number"));
  test("A6", () => assert.throws(() => validateAxis({ source: "alteration", genes: ["KRAS", "NRAS"], by: "mutated", label: "x" } as unknown as PlotAxis, "x"),
    /label/));
  test("A7", () => assert.throws(() => validateAxis({ source: "alteration", oql: "KRAS: MUT", label: "x" } as unknown as PlotAxis, "x"), /label/));
  test("A8", () => assert.throws(() => validateAxis({ source: "clinical", attribute: "AGE", label: 5 } as unknown as PlotAxis, "x"), /label/));
});

// ---- runners ---------------------------------------------------------------

type BoxRow = { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number };

const evaluated = (studies: string[], count = 100): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count, samples: count, mode: "patient-level" }])), count, samples: count, text: "" });

async function plotRun(resolvers: Record<string, unknown>, view: Record<string, unknown>): Promise<ViewResultOf<"plot">> {
  const studies = Object.keys(resolvers);
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(studies) }, resolvers, vNames: ["All"], vStudies: studies,
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "X" }, y: { source: "clinical", attribute: "Y" }, points: [], ...view };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r as ViewResultOf<"plot">;
}

/** a federated participant: canned aggregates, axis labels as the real resolver writes them from the spec, its names from `names` */
function fed(study: string, names: NameRow[], o: { kinds?: { xk: string; yk: string; shape: string }; boxRows?: BoxRow[] } = {}) {
  return {
    instance: { id: "local", mode: "patient-level", conn: { db: "db" }, label: study },
    ...meta(study, names),
    plotAxisKinds: async (spec: { x: PlotAxis; y: PlotAxis }) =>
      ({ ...(o.kinds ?? { xk: "num", yk: "num", shape: "scatter" }), xLabel: axisLabel(spec.x), yLabel: axisLabel(spec.y) }),
    plotExtent: async () => ({ n: 0, x0: 0, x1: 0, y0: 0, y1: 0 }),
    plotBinCounts: async () => [],
    plotMoments: async () => ({ n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 }),
    plotTableCells: async () => [],
    plotBoxRows: async () => o.boxRows ?? [],
    plotViolinCounts: async () => [{ g: "A", b: 0, n: 1, c: "Female" }],
    plotCoverage: async () => ({ total: 0, nx: 0, ny: 0 }),
    plotPoints: async () => [],
    plotScatterPoints: async () => [],
  };
}

describe("runners: the display name reaches the result", () => {
  test("R1", async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const rows: BoxRow[] = [{ g: "A", n: 2, lo: 0, hi: 9, q1: 2, median: 4, q3: 6 }];
    const r = await plotRun({ s1: fed("s1", [], { kinds, boxRows: rows }), s2: fed("s2", [{ a: "SEX", name: "Sex" }], { kinds, boxRows: rows }) },
      { colorBy: { source: "clinical", attribute: "SEX" } });
    assert.equal(r.error, undefined);
    assert.equal(r.plot!.overlay, "violin", "the pooled density path, where the colour key is titled");
    assert.equal(r.plot!.colorLabel, "Sex");
  });

  test("R2", async () => {
    const r = await plotRun({ s1: fed("s1", []), s2: fed("s2", [{ a: "AGE", name: "Diagnosis Age" }]) },
      { x: { source: "clinical", attribute: "AGE" } });
    assert.equal(r.error, undefined);
    assert.equal((r.plot as PlotData).x.label, "Diagnosis Age");
  });

  type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
  const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
    studies: Object.keys(counts),
    perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
    count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
  });
  function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, Fake>): ViewRun {
    const vNames = Object.keys(cohorts);
    const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
    return {
      doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0], name: n }])), views: [] } as never,
      cohorts, resolvers: resolvers as never, vNames, vStudies,
      participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
        ({ studies: [], requiresPatientLevel, aggregateOnly: studies.filter((s) => resolvers[s].instance.mode !== "patient-level") }),
      pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
    };
  }
  const unwrap = (r: ViewResult | Untimed): ViewResult => (r instanceof Untimed ? r.result : r);
  const local = (names: NameRow[], extra: Record<string, unknown>): Fake =>
    ({ instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY }, ...meta("s1", names), ...extra });

  test("R3", async () => {
    // 40 patients of one stratum, every other one exposed (TMB 12 against 3), the exposed dying twice as soon
    const rows = Array.from({ length: 40 }, (_, i) => {
      const exposed = i % 2 === 1;
      return { t: 1 + ((i * 7) % 23) / (exposed ? 2 : 1), event: i % 3 === 0 ? 0 : 1, values: [exposed ? 12 : 3, "A"] };
    });
    const s1 = local([{ a: "TMB", name: "TMB (nonsynonymous)" }], { coxRows: async () => ({ rows, kinds: ["num", "cat"], notProfiled: 0 }) });
    const r = await runForest({ kind: "forest", exposure: { source: "clinical", attribute: "TMB" }, threshold: 10 } as never, ctx({ A: cohort({ s1: 40 }) }, { s1 }));
    assert.equal(r.error, undefined);
    const f = (r as unknown as { forest: ForestResult }).forest;
    assert.equal(f.exposure, "TMB (nonsynonymous)");
    assert.equal(f.exposedLabel, "TMB (nonsynonymous) ≥ 10");
  });

  test("R4", async () => {
    const names = [{ a: "AGE", name: "Diagnosis Age" }];
    // cox: four patients, the covariate a number
    const coxRows = [{ t: 1, event: 1, values: [1] }, { t: 2, event: 1, values: [0] }, { t: 3, event: 1, values: [1] }, { t: 4, event: 0, values: [0] }];
    const cox = unwrap(await runCox({ kind: "cox", covariates: [{ source: "clinical", attribute: "AGE" }] } as never,
      ctx({ A: cohort({ s1: 4 }) }, { s1: local(names, { coxRows: async () => ({ rows: coxRows, kinds: ["num"], notProfiled: 0 }) }) })));
    assert.equal(cox.error, undefined);
    assert.equal((cox as unknown as { cox: { coefficients: { label: string }[] } }).cox.coefficients[0].label, "Diagnosis Age");
    // logistic: an outcome coded 0/1 against the same covariate
    const table = [[1, 1], [1, 1], [1, 1], [0, 1], [1, 0], [0, 0], [0, 0], [0, 0]];
    const answer = { rows: table.map(([y, x]) => ({ y, values: [x] })), outcomeKind: "num", kinds: ["num"], notProfiled: 0 };
    const lg = unwrap(await runLogistic({ kind: "logistic", outcome: { source: "clinical", attribute: "RESPONSE" }, covariates: [{ source: "clinical", attribute: "AGE" }] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1: local(names, { logisticRows: async () => answer }) })));
    assert.equal(lg.error, undefined);
    assert.equal((lg as unknown as { logistic: { coefficients: { label: string }[] } }).logistic.coefficients[0].label, "Diagnosis Age");
  });
});
