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
 *   L*  lib/plot.ts axisSelect — a categorical axis's labels as the portal writes them, counted
 *       over every sample of coadread_tcga_pan_can_atlas_2018 (docs/legacy-spec/04-plots.md §3:
 *       PLT-DT-3 Mutation Type, DT-4 Mutated vs Wild-type, DT-9 Variant vs No Variant, DT-11
 *       discrete copy number; cbioportal-frontend cd8c6df PlotsTabUtils.tsx; counts from
 *       docs/legacy-spec/parity/04-plots.md §3 Q6). L5/L6 are the cox and logistic covariates'
 *       labels (`labels: "model"`), which keep cBioLab's own ("Not mutated", "Structural variant").
 *       L1 KRAS mutation type: ⊆ {Missense, Inframe, Truncating, Splice, Promoter, Other,
 *          Multiple, No mutation, Not profiled}, has "No mutation", no "Not mutated"
 *       L2 KRAS mutated: {Mutated, No mutation, Not profiled}
 *       L3 TCF7L2 SV: ⊆ {With Structural Variants, No Structural Variants, Not profiled for
 *          structural variants}; With Structural Variants = 4
 *       L4 KRAS gistic: Deep Deletion 1, Shallow Deletion 67, Diploid 390, Gain 128, Amplification 6
 *       L5 L2 with labels "model": {Mutated, Not mutated, Not profiled}
 *       L6 L3 with labels "model": ⊆ {Structural variant, No structural variant, Not profiled}
 *       L7 the resolver's coxRows reads a covariate with those labels: KRAS mutated has "Not mutated", not "No mutation"
 *   C*  lib/plot.ts plotScatterPointsSql — a scatter's points coloured and ringed (PLT-CL-8,
 *       PLT-SC-6; cbioportal-frontend cd8c6df PlotsTabUtils.tsx:1877-2397), rows C1–C3 of the case
 *       table for colouring a scatter's points: over coadread_tcga_pan_can_atlas_2018, every sample,
 *       x AGE, y FRACTION_GENOME_ALTERED, each row carries `c` / `r`, the case's category from the
 *       colorSel / ringSel given ("" where it has none), counted against a separate query joining the
 *       axis selects.
 *   T*  lib/federation.ts plotAxisKinds / plot (its clinicalMetaSql) and, T11, lib/clinical-titles.ts titledAxes — an axis's title as the portal writes it (PLT-DT-19;
 *       cbioportal-frontend cd8c6df PlotsTabUtils.tsx getAxisLabel): a clinical attribute by its
 *       display name, " (log2(value + 1))" after it on a log scale, and the colour axis likewise.
 *       Read against the warehouse's coadread_tcga_pan_can_atlas_2018, all samples; the names are
 *       cbioportal.org's for that study (REST clinical-attributes). Case table rows T7–T10.
 *
 * Run: node --env-file=.env.local scripts/check-plot-stats.ts
 */
import { chQuery } from "../lib/ch.ts";
import { axisSelect, plotBoxSql, plotScatterPointsSql, plotStatsSql, type AxisCtx, type PlotAxis } from "../lib/plot.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { OQL_NOT_PROFILED } from "../lib/plot-oql.ts";
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

/** [row id, axis, model labels, labels allowed, labels required, exact counts] */
type LabelCase = [string, PlotAxis, boolean, string[], string[], Record<string, number>];
const COADREAD = "coadread_tcga_pan_can_atlas_2018";
const KRAS_MUT: PlotAxis = { source: "alteration", gene: "KRAS", by: "mutated" };
const TCF7L2_SV: PlotAxis = { source: "alteration", gene: "TCF7L2", by: "sv" };
const SV_LABELS = ["With Structural Variants", "No Structural Variants", "Not profiled for structural variants"];
const LABELS: LabelCase[] = [
  ["L1 KRAS Mutation Type: the portal's classes and \"No mutation\" (PLT-DT-3)", { source: "alteration", gene: "KRAS", by: "mutationType" }, false,
    ["Missense", "Inframe", "Truncating", "Splice", "Promoter", "Other", "Multiple", "No mutation", "Not profiled"], ["No mutation"], {}],
  ["L2 KRAS Mutated vs Wild-type: Mutated / No mutation / Not profiled (PLT-DT-4)", KRAS_MUT, false,
    ["Mutated", "No mutation", "Not profiled"], ["Mutated", "No mutation", "Not profiled"], {}],
  ["L3 TCF7L2 Variant vs No Variant: the portal's SV labels, 4 with one (PLT-DT-9)", TCF7L2_SV, false,
    SV_LABELS, ["With Structural Variants"], { "With Structural Variants": 4 }],
  ["L4 KRAS gistic: the portal's copy-number levels and Q6's row totals (PLT-DT-11)", { source: "molecular", profileType: "gistic", gene: "KRAS", discrete: true }, false,
    ["Deep Deletion", "Shallow Deletion", "Diploid", "Gain", "Amplification"], ["Deep Deletion", "Shallow Deletion", "Diploid", "Gain", "Amplification"],
    { "Deep Deletion": 1, "Shallow Deletion": 67, "Diploid": 390, "Gain": 128, "Amplification": 6 }],
  ["L5 KRAS mutated as a model covariate keeps \"Not mutated\"", KRAS_MUT, true,
    ["Mutated", "Not mutated", "Not profiled"], ["Mutated", "Not mutated", "Not profiled"], {}],
  ["L6 TCF7L2 SV as a model covariate keeps cBioLab's labels", TCF7L2_SV, true,
    ["Structural variant", "No structural variant", "Not profiled"], [], {}],
];

{
  const cohortSql = compileCohortDef(null, { study: COADREAD });
  for (const [id, axis, model, allowed, required, counts] of LABELS) {
    try {
      // `labels` is the covariates' switch on AxisCtx (lib/federation.ts coxRows / logisticRows)
      const ctx = { study: COADREAD, unit: "sample", cohortSql, ...(model ? { labels: "model" } : {}) } as AxisCtx;
      const sql = "WITH cohort AS (" + cohortSql + "),\n     xs AS (" + axisSelect(axis, ctx, "cat") + ")\nSELECT v, count() AS n FROM xs GROUP BY v ORDER BY v";
      const got = new Map((await chQuery<{ v: string; n: string }>(sql)).data.map((r) => [String(r.v), Number(r.n)]));
      const stray = [...got.keys()].filter((l) => !allowed.includes(l));
      const lacking = required.filter((l) => !got.has(l));
      const off = Object.entries(counts).filter(([l, n]) => got.get(l) !== n);
      ok(!stray.length && !lacking.length && !off.length, id,
        [...got].map(([l, n]) => l + " " + n).join(", ") +
        (stray.length ? " — unexpected " + stray.join(", ") : "") + (lacking.length ? " — missing " + lacking.join(", ") : "") +
        (off.length ? " — expected " + off.map(([l, n]) => l + " " + n).join(", ") : ""));
    } catch (e) { ok(false, id, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
  }
}

{
  const study = "coadread_tcga_pan_can_atlas_2018";
  const cohortSql = compileCohortDef(null, { study });
  const ctx = { study, unit: "sample" as const, cohortSql };
  const sel = (a: PlotAxis, kind: "num" | "cat") => axisSelect(a, ctx, kind);
  const xSel = sel({ source: "clinical", attribute: "AGE" }, "num");
  const ySel = sel({ source: "clinical", attribute: "FRACTION_GENOME_ALTERED" }, "num");
  const kras = sel({ source: "alteration", gene: "KRAS", by: "mutated" }, "cat");
  const sex = sel({ source: "clinical", attribute: "SEX" }, "cat");
  const rowsOf = async (colorSel?: string, ringSel?: string) =>
    (await chQuery<Record<string, unknown>>(plotScatterPointsSql(xSel, ySel, cohortSql, undefined, undefined, colorSel, ringSel))).data;
  /** per category of `catSel`, the plotted samples (a value on both axes), "" for one without a category */
  const countsBy = async (catSel: string) => new Map((await chQuery<Record<string, unknown>>(
    "WITH cohort AS (" + cohortSql + "),\n     xs AS (" + xSel + "),\n     ys AS (" + ySel + "),\n     cs AS (" + catSel + ")\n" +
    "SELECT ifNull(cs.v, '') AS k, count() AS n FROM xs INNER JOIN ys ON ys.id = xs.id LEFT JOIN cs ON cs.id = xs.id GROUP BY k")).data
    .map((r) => [String(r.k), Number(r.n)]));
  const tally = (rows: Record<string, unknown>[], col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r[col] == null ? "(missing)" : String(r[col]); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const show = (m: Map<string, number>) => [...m].sort().map(([k, n]) => (k || "\"\"") + "=" + n).join(" ");
  const caseRow = async (id: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { ok(false, id, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
  };

  // the plotted samples, counted by a separate join (581 on cbioportal.org when the scorecard read Q4)
  const plotted = [...(await countsBy(sex)).values()].reduce((a, n) => a + n, 0);
  await caseRow("C1 no colour or ring: every plotted sample", async () => {
    const rows = await rowsOf();
    ok(rows.length === plotted, "C1 no colour or ring: every plotted sample", "rows " + rows.length + " — expected " + plotted);
  });

  await caseRow("C2 colorSel KRAS mutated", async () => {
    const rows = await rowsOf(kras);
    const c = tally(rows, "c");
    const allowed = new Set(["Mutated", "Not mutated", "No mutation", OQL_NOT_PROFILED, "Not profiled"]);
    const want = (await countsBy(kras)).get("Mutated") || 0;
    ok(rows.length === plotted && [...c.keys()].every((k) => allowed.has(k)) && (c.get("Mutated") || 0) === want,
      "C2 colorSel KRAS mutated: every c a KRAS category, Mutated counted as a separate join counts it",
      "rows " + rows.length + ", c: " + show(c) + " — expected " + plotted + " rows, Mutated=" + want);
  });

  await caseRow("C3 colorSel KRAS mutated, ringSel SEX", async () => {
    const rows = await rowsOf(kras, sex);
    const r = tally(rows, "r");
    const want = await countsBy(sex);
    const keys = new Set([...r.keys(), ...want.keys()]);
    ok(rows.length === plotted && [...r.keys()].every((k) => k === "Male" || k === "Female" || k === "") &&
      [...keys].every((k) => (r.get(k) || 0) === (want.get(k) || 0)),
    "C3 colorSel KRAS mutated, ringSel SEX: every r Male, Female or \"\", counted as a separate join counts them",
    "rows " + rows.length + ", r: " + show(r) + " — expected " + plotted + " rows, " + show(want));
  });
}

{
  const STUDY = "coadread_tcga_pan_can_atlas_2018";
  const r = await resolverFor(STUDY, { oncokbPin: await oncokbPin(), ...(await studyProfiles(STUDY)) });
  const clin = (attribute: string, log?: boolean): PlotAxis => ({ source: "clinical", attribute, ...(log ? { log: true } : {}) });
  const FGA = clin("FRACTION_GENOME_ALTERED");
  const is = (id: string, what: string, got: unknown, want: string) => ok(got === want, id + " " + what, JSON.stringify(got) + " — expected " + JSON.stringify(want));

  // the resolver titles its own plot's axes (so a remote peer's plot is named); the other views
  // title theirs through lib/clinical-titles.ts, whose query runs here through viewMeta (T11)
  const titled = (axes: Record<string, PlotAxis | undefined>) => titledAxes(axes, { [STUDY]: r }, [STUDY]);
  if (!hasFederatedPlot(r)) ok(false, "T7 plotAxisKinds", STUDY + "'s resolver has no plotAxisKinds");
  else {
    const k = await r.plotAxisKinds({ x: clin("MUTATION_COUNT"), y: FGA });
    is("T7", "plotAxisKinds xLabel", k.xLabel, "Mutation Count");
    is("T7", "plotAxisKinds yLabel", k.yLabel, "Fraction Genome Altered");
  }

  const t8 = await r.plot(null, { x: clin("CANCER_TYPE_DETAILED"), y: FGA, unit: "sample" });
  is("T8", "plot x.label", t8.x.label, "Cancer Type Detailed");
  is("T8", "plot y.label", t8.y.label, "Fraction Genome Altered");

  const t9 = await r.plot(null, { x: clin("AGE"), y: clin("FRACTION_GENOME_ALTERED", true), unit: "sample" });
  is("T9", "plot x.label", t9.x.label, "Diagnosis Age");
  is("T9", "plot y.label (log)", t9.y.label, "Fraction Genome Altered (log2(value + 1))");

  const t10 = await r.plot(null, { x: clin("CANCER_TYPE_DETAILED"), y: FGA, unit: "sample", colorBy: clin("SEX") });
  is("T10", "plot colorLabel (" + t10.shape + ")", t10.colorLabel, "Sex");

  // L7 a cox covariate is read by the resolver with the model's labels: the reference level its
  // documents name ("Not mutated") is a value it returns, the plot's "No mutation" is not
  const cox = await (r as unknown as { coxRows(d: null, e: string, c: PlotAxis[]): Promise<{ rows: { values: (string | number)[] }[] }> })
    .coxRows(null, "OS", [{ source: "alteration", gene: "KRAS", by: "mutated" }]);
  const levels = new Set(cox.rows.map((x) => String(x.values[0])));
  ok(levels.has("Not mutated") && !levels.has("No mutation"), "L7 coxRows: KRAS mutated as a covariate keeps \"Not mutated\"", [...levels].join(", "));
  // T11 the other views' step: titledAxes, its clinicalMetaSql run through the resolver's viewMeta
  const t11 = await titled({ a: clin("MUTATION_COUNT"), b: clin("SEX"), c: clin("NOT_AN_ATTRIBUTE_HERE") });
  is("T11", "titledAxes MUTATION_COUNT", t11.a?.source === "clinical" ? t11.a.label : undefined, "Mutation Count");
  is("T11", "titledAxes SEX", t11.b?.source === "clinical" ? t11.b.label : undefined, "Sex");
  ok(t11.c?.source === "clinical" && t11.c.label === undefined, "T11 titledAxes: an attribute the study does not declare keeps no label", JSON.stringify(t11.c));
}

console.log(failures ? "\n" + failures + " of " + checks + " plot statistics checks FAILED" : "\nall " + checks + " plot statistics checks passed");
process.exit(failures ? 1 : 0);
