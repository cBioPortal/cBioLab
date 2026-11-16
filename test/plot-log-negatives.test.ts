// A log scale on an axis with values below 0, as cBioPortal's Plots tab rules it (PLT-AX-4,
// PLT-MD-11): turned off, the axis drawn linear and the caption saying why, except on an RNA-seq
// profile, whose values below 0 log2(max(v, 0) + 1) draws at 0, counted in the caption. The
// resolvers are fakes that record what the plot was asked for.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import type { PlotRequest } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { PlotData, ViewResultOf } from "../lib/types.ts";

type Negatives = Record<string, { min: number | null; negatives: number }>;

/** one study's resolver: its axes' lowest values keyed by attribute or gene, and the request the plot got */
function fake(neg: Negatives, seen: PlotRequest[], asked: string[]) {
  return {
    instance: { mode: "patient-level", conn: { db: "db" }, label: "s" },
    plotAxisKinds: async () => ({}),
    plotScatterPoints: async () => [],
    plotPoints: async () => [],
    plotAxisNegatives: async (_d: unknown, a: { attribute?: string; gene?: string; log?: boolean }) => {
      const k = a.attribute || a.gene || "";
      asked.push(k + (a.log ? " (log)" : ""));
      return neg[k] || { min: 0, negatives: 0 };
    },
    plot: async (_d: unknown, spec: PlotRequest): Promise<PlotData> => {
      seen.push(spec);
      const lab = (a: PlotRequest["x"]) => ({ label: a.source === "clinical" ? a.attribute : "KRAS", kind: "num" as const,
        ...("log" in a && a.log ? { log: "log2" as const } : {}) });
      return { shape: "scatter", n: 10, x: lab(spec.x), y: lab(spec.y), extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, grid: [10, 10], bins: [] };
    },
  };
}

function run(r: unknown, x: unknown, y: unknown): Promise<ViewResultOf<"plot">> {
  const all: EvaluatedCohort = { studies: ["s"], perStudy: { s: { sql: "", count: 10, samples: 10, mode: "patient-level" } }, count: 10, samples: 10, text: "" } as never;
  const c = {
    doc: { cohorts: { All: { all: [] } } }, cohorts: { All: all }, resolvers: { s: r }, vNames: ["All"], vStudies: ["s"],
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const view = { kind: "plot", cohorts: ["All"], x, y, points: [] };
  return runPlot(view as never, c).then((res) => ("result" in (res as object) ? (res as { result: ViewResultOf<"plot"> }).result : res as ViewResultOf<"plot">));
}

const RNA = { source: "molecular", profileType: "rna_seq_v2_mrna", gene: "KRAS", log: true };
const ZSCORE = { source: "molecular", profileType: "rna_seq_v2_mrna_median_all_sample_Zscores", gene: "KRAS", log: true };

describe("a log scale on an axis with values below 0", () => {
  test("a clinical axis with negatives is drawn linear, its control off, and the caption says why", async () => {
    const seen: PlotRequest[] = [], asked: string[] = [];
    const r = await run(fake({ DELTA: { min: -2.5, negatives: 4 } }, seen, asked),
      { source: "clinical", attribute: "DELTA", log: true }, { source: "clinical", attribute: "AGE" });
    assert.equal(r.error, undefined);
    assert.deepEqual(asked, ["DELTA"], "only the log axis is read, without its log");
    assert.equal("log" in seen[0].x, false, "the plot is asked for the axis on a linear scale");
    assert.deepEqual(r.plot!.logOff, { x: -2.5 });
    assert.match(r.note!, /^DELTA has values below 0 \(the lowest −2\.5\), so it is drawn on a linear scale: cBioPortal's Plots tab offers a log scale on such an axis only for an RNA-seq profile\./);
  });

  test("an RNA-seq profile keeps its log scale, its values below 0 drawn at 0 and counted", async () => {
    const seen: PlotRequest[] = [], asked: string[] = [];
    const r = await run(fake({ KRAS: { min: -0.3, negatives: 1 } }, seen, asked), RNA, { source: "clinical", attribute: "AGE" });
    assert.equal((seen[0].x as { log?: boolean }).log, true);
    assert.equal(r.plot!.logOff, undefined);
    assert.match(r.note!, /^1 KRAS value is below 0 and drawn at 0, as cBioPortal's log2\(max\(value, 0\) \+ 1\) draws them\./);
  });

  test("an RNA-seq z-score profile is not exempt", async () => {
    const seen: PlotRequest[] = [], asked: string[] = [];
    const r = await run(fake({ KRAS: { min: -1.2, negatives: 30 } }, seen, asked), ZSCORE, { source: "clinical", attribute: "AGE" });
    assert.equal("log" in seen[0].x, false);
    assert.deepEqual(r.plot!.logOff, { x: -1.2 });
  });

  test("no negatives: the log scale stays and nothing is said", async () => {
    const seen: PlotRequest[] = [], asked: string[] = [];
    const r = await run(fake({}, seen, asked), { source: "clinical", attribute: "AGE" }, { source: "clinical", attribute: "TMB", log: true });
    assert.deepEqual(asked, ["TMB"]);
    assert.equal((seen[0].y as { log?: boolean }).log, true);
    assert.equal(r.plot!.logOff, undefined);
    assert.doesNotMatch(r.note || "", /below 0/);
  });

  test("no log scale asked for: nothing is read first", async () => {
    const seen: PlotRequest[] = [], asked: string[] = [];
    await run(fake({}, seen, asked), { source: "clinical", attribute: "AGE" }, { source: "clinical", attribute: "TMB" });
    assert.deepEqual(asked, []);
  });
});
