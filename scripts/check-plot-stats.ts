/**
 * Live check: the plot's statistics as SQL, run in ClickHouse on values written here, against
 * answers written down by hand from the reference each follows.
 *
 *   B*  lib/plot.ts plotBoxSql — the box's quartiles and median by cbioportal.org's rule
 *       (cbioportal-frontend cd8c6df src/shared/lib/boxPlotUtils.ts calculateBoxPlotModel:
 *       jStat.quartiles, q1 = sorted[round(n/4) − 1], q3 = sorted[round(3n/4) − 1], Math.round
 *       halves up, no interpolation; jStat.median, the mean of the two middle values for even n;
 *       docs/legacy-spec/04-plots.md PLT-STM-8). A group of one has no quartiles there; here q1 =
 *       median = q3 = its value, and the figure draws no box.
 *   S*  lib/plot.ts plotStatsSql — Spearman's ρ with tied values sharing their average rank
 *       (PLT-STM-5), against scipy 1.18.1 spearmanr, and its independence of row order.
 *   T*  lib/clinical-titles.ts titledAxes (its clinicalNamesSql, run here) then lib/federation.ts plotAxisKinds / plot — an axis's title as the portal writes it (PLT-DT-19;
 *       cbioportal-frontend cd8c6df PlotsTabUtils.tsx getAxisLabel): a clinical attribute by its
 *       display name, " (log2(value + 1))" after it on a log scale, and the colour axis likewise.
 *       Read against the warehouse's coadread_tcga_pan_can_atlas_2018, all samples; the names are
 *       cbioportal.org's for that study (REST clinical-attributes). Case table rows T7–T10.
 *
 * Run: node --env-file=.env.local scripts/check-plot-stats.ts
 */
import { chQuery } from "../lib/ch.ts";
import { plotBoxSql, plotStatsSql, type PlotAxis } from "../lib/plot.ts";
import { resolverFor, hasFederatedPlot } from "../lib/federation.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { titledAxes } from "../lib/clinical-titles.ts";
import { oncokbPin } from "../lib/annotation.ts";

/** [row id, values, expected q1, median, q3, lo, hi] */
type BoxCase = [string, number[], number, number, number, number, number];
const BOXES: BoxCase[] = [
  ["B1 n = 1: no quartiles in the portal; the value itself here", [468.29], 468.29, 468.29, 468.29, 468.29, 468.29],
  ["B2 n = 2: round(0.5) = 1, round(1.5) = 2", [3, 1], 1, 2, 3, 1, 3],
  ["B3 n = 3: round(0.75) = 1, round(2.25) = 2 (q3 is the median)", [5, 1, 3], 1, 3, 3, 1, 5],
  ["B4 n = 4: round(1) = 1, round(3) = 3; median the mean of the middle two", [4, 1, 3, 2], 1, 2.5, 3, 1, 4],
  ["B5 n = 6: round(1.5) = 2, round(4.5) = 5 (halves up)", [60, 10, 50, 20, 40, 30], 20, 35, 50, 10, 60],
  ["B6 n = 7: round(1.75) = 2, round(5.25) = 5", [7, 6, 5, 4, 3, 2, 1], 2, 4, 5, 1, 7],
  ["B7 n = 10: round(2.5) = 3, round(7.5) = 8 (halves up)", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 3, 5.5, 8, 1, 10],
  ["B8 ties: 1 1 5 5 5 9 9 9", [5, 5, 5, 1, 1, 9, 9, 9], 1, 5, 9, 1, 9],
  ["B9 negative values", [-2.5, -1, 0, 4], -2.5, -0.5, 0, -2.5, 4],
];

/** [row id, x, y, expected ρ] — scipy.stats.spearmanr */
type RankCase = [string, number[], number[], number];
const RANKS: RankCase[] = [
  ["S1 ties on both axes", [1, 2, 2, 3, 4, 4, 4, 7], [2, 1, 3, 3, 5, 0, 5, 9], 0.5777400584843706],
  ["S2 the same pairs in the reverse order", [7, 4, 4, 4, 3, 2, 2, 1], [9, 5, 0, 5, 3, 3, 1, 2], 0.5777400584843706],
];

let failures = 0, checks = 0;
const ok = (pass: boolean, what: string, detail: string) => {
  checks++; if (!pass) failures++;
  console.log((pass ? "PASS " : "FAIL ") + what + "  [" + detail + "]");
};
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
const lit = (v: number) => (Number.isFinite(v) ? String(v) : "NULL");

{
  const rows = BOXES.flatMap(([, vs], i) => vs.map((v, j) => "('B" + i + "-" + j + "', 'g" + i + "', " + lit(v) + ")"));
  const vals = "SELECT * FROM values('id String, g String, v Float64', " + rows.join(", ") + ")";
  const sql = plotBoxSql("SELECT id, v FROM (" + vals + ")", "SELECT id, g AS v FROM (" + vals + ")", "SELECT 1");
  const got = new Map((await chQuery<Record<string, unknown>>(sql)).data.map((r) => [String(r.g), r]));
  BOXES.forEach(([id, vs, q1, med, q3, lo, hi], i) => {
    const r = got.get("g" + i);
    const q = r ? (r.q as unknown[]).map(Number) : [];
    const have = r ? [Number(r.n), q[0], q[1], q[2], Number(r.lo), Number(r.hi)] : [];
    const want = [vs.length, q1, med, q3, lo, hi];
    ok(!!r && want.every((w, k) => close(have[k], w)), id, "n q1 median q3 lo hi: " + have.join(" ") + (r ? "" : "(no row)") + " — expected " + want.join(" "));
  });
}

for (const [id, x, y, rho] of RANKS) {
  const vals = (a: number[]) => "SELECT * FROM values('id String, v Float64', " + a.map((v, i) => "('c" + i + "', " + lit(v) + ")").join(", ") + ")";
  const sql = plotStatsSql(vals(x), vals(y), "SELECT 1");
  const r = (await chQuery<Record<string, unknown>>(sql)).data[0] || {};
  ok(close(Number(r.spearman), rho), id, "ρ " + r.spearman + " — expected " + rho);
}

{
  const STUDY = "coadread_tcga_pan_can_atlas_2018";
  const r = await resolverFor(STUDY, { oncokbPin: await oncokbPin(), ...(await studyProfiles(STUDY)) });
  const clin = (attribute: string, log?: boolean): PlotAxis => ({ source: "clinical", attribute, ...(log ? { log: true } : {}) });
  const FGA = clin("FRACTION_GENOME_ALTERED");
  const is = (id: string, what: string, got: unknown, want: string) => ok(got === want, id + " " + what, JSON.stringify(got) + " — expected " + JSON.stringify(want));

  // the titles go onto the axes as every view puts them there (lib/clinical-titles.ts), its
  // clinicalNamesSql run against this study through the resolver's viewMeta
  const titled = (axes: Record<string, PlotAxis | undefined>) => titledAxes(axes, { [STUDY]: r }, [STUDY]);
  if (!hasFederatedPlot(r)) ok(false, "T7 plotAxisKinds", STUDY + "'s resolver has no plotAxisKinds");
  else {
    const k = await r.plotAxisKinds(await titled({ x: clin("MUTATION_COUNT"), y: FGA }) as { x: PlotAxis; y: PlotAxis });
    is("T7", "plotAxisKinds xLabel", k.xLabel, "Mutation Count");
    is("T7", "plotAxisKinds yLabel", k.yLabel, "Fraction Genome Altered");
  }

  const t8 = await r.plot(null, { ...await titled({ x: clin("CANCER_TYPE_DETAILED"), y: FGA }) as { x: PlotAxis; y: PlotAxis }, unit: "sample" });
  is("T8", "plot x.label", t8.x.label, "Cancer Type Detailed");
  is("T8", "plot y.label", t8.y.label, "Fraction Genome Altered");

  const t9 = await r.plot(null, { ...await titled({ x: clin("AGE"), y: clin("FRACTION_GENOME_ALTERED", true) }) as { x: PlotAxis; y: PlotAxis }, unit: "sample" });
  is("T9", "plot x.label", t9.x.label, "Diagnosis Age");
  is("T9", "plot y.label (log)", t9.y.label, "Fraction Genome Altered (log2(value + 1))");

  const t10 = await r.plot(null, { ...await titled({ x: clin("CANCER_TYPE_DETAILED"), y: FGA, colorBy: clin("SEX") }) as { x: PlotAxis; y: PlotAxis; colorBy: PlotAxis }, unit: "sample" });
  is("T10", "plot colorLabel (" + t10.shape + ")", t10.colorLabel, "Sex");
}

console.log(failures ? "\n" + failures + " of " + checks + " plot statistics checks FAILED" : "\nall " + checks + " plot statistics checks passed");
process.exit(failures ? 1 : 0);
