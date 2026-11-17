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
 *   C*  lib/plot.ts plotScatterPointsSql — a scatter's points coloured and ringed (PLT-CL-8,
 *       PLT-SC-6; cbioportal-frontend cd8c6df PlotsTabUtils.tsx:1877-2397), rows C1–C3 of the case
 *       table for colouring a scatter's points: over coadread_tcga_pan_can_atlas_2018, every sample,
 *       x AGE, y FRACTION_GENOME_ALTERED, each row carries `c` / `r`, the case's category from the
 *       colorSel / ringSel given ("" where it has none), counted against a separate query joining the
 *       axis selects.
 *
 * Run: node --env-file=.env.local scripts/check-plot-stats.ts
 */
import { chQuery } from "../lib/ch.ts";
import { axisSelect, plotBoxSql, plotScatterPointsSql, plotStatsSql, type PlotAxis } from "../lib/plot.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { OQL_NOT_PROFILED } from "../lib/plot-oql.ts";

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
  const study = "coadread_tcga_pan_can_atlas_2018";
  const cohortSql = compileCohortDef(null, { study });
  const ctx = { study, unit: "sample" as const, cohortSql };
  const sel = (a: PlotAxis, kind: "num" | "cat") => axisSelect(a, ctx, kind);
  const xSel = sel({ source: "clinical", attribute: "AGE" }, "num");
  const ySel = sel({ source: "clinical", attribute: "FRACTION_GENOME_ALTERED" }, "num");
  const kras = sel({ source: "alteration", gene: "KRAS", by: "mutated" }, "cat");
  const sex = sel({ source: "clinical", attribute: "SEX" }, "cat");
  // colorSel and ringSel are plotScatterPointsSql's optional trailing arguments
  const pointsSql = plotScatterPointsSql as unknown as (x: string, y: string, cohort: string, cap?: number, sparse?: undefined,
    colorSel?: string, ringSel?: string) => unknown;
  const rowsOf = async (colorSel?: string, ringSel?: string) =>
    (await chQuery<Record<string, unknown>>(String(pointsSql(xSel, ySel, cohortSql, undefined, undefined, colorSel, ringSel)))).data;
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

  await caseRow("C1 no colour or ring: 581 rows", async () => {
    const rows = await rowsOf();
    ok(rows.length === 581, "C1 no colour or ring: 581 rows", "rows " + rows.length + " — expected 581");
  });

  await caseRow("C2 colorSel KRAS mutated", async () => {
    const rows = await rowsOf(kras);
    const c = tally(rows, "c");
    const allowed = new Set(["Mutated", "Not mutated", "No mutation", OQL_NOT_PROFILED, "Not profiled"]);
    const want = (await countsBy(kras)).get("Mutated") || 0;
    ok(rows.length === 581 && [...c.keys()].every((k) => allowed.has(k)) && (c.get("Mutated") || 0) === want,
      "C2 colorSel KRAS mutated: every c a KRAS category, Mutated counted as a separate join counts it",
      "rows " + rows.length + ", c: " + show(c) + " — expected 581 rows, Mutated=" + want);
  });

  await caseRow("C3 colorSel KRAS mutated, ringSel SEX", async () => {
    const rows = await rowsOf(kras, sex);
    const r = tally(rows, "r");
    const want = await countsBy(sex);
    const keys = new Set([...r.keys(), ...want.keys()]);
    ok(rows.length === 581 && [...r.keys()].every((k) => k === "Male" || k === "Female" || k === "") &&
      [...keys].every((k) => (r.get(k) || 0) === (want.get(k) || 0)),
    "C3 colorSel KRAS mutated, ringSel SEX: every r Male, Female or \"\", counted as a separate join counts them",
    "rows " + rows.length + ", r: " + show(r) + " — expected 581 rows, " + show(want));
  });
}

console.log(failures ? "\n" + failures + " of " + checks + " plot statistics checks FAILED" : "\nall " + checks + " plot statistics checks passed");
process.exit(failures ? 1 : 0);
