// The plot view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
//
// The coefficients, the regression line and the box quartiles are computed in the database
// (lib/plot.ts plotStatsSql, plotBoxSql), so the queries above are what fetched them; the script
// recomputes what was then done with them here — the p-values, the whiskers and, for a plot pooled
// across studies, Pearson's r and the line from each study's six sums. The SQL itself is checked
// against scipy and the portal's jStat rule by scripts/check-plot-stats.ts.
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, withResult, checks, py } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { Moments } from "../../stats.ts";
import type { PlotData } from "../../plot.ts";

export interface PlotTrace {
  cohort: string;
  studies: string[];
  unit: "patient" | "sample";
  data: PlotData;
  /** each study's six sums, when a scatter was pooled across studies */
  moments?: (Moments & { study: string })[];
}

const pyNum = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "None" : JSON.stringify(v);

export function plotMethod(t: PlotTrace): MethodRecord {
  const d = t.data, pooled = t.studies.length > 1, u = t.unit;
  const steps: MethodStep[] = [];
  const scope = t.cohort + " · " + t.studies.join(", ");
  const python = [
    "# Recompute with scipy " + VERIFIED.pearson.version + ", the version our code is tested against.",
    "from scipy.stats import t as t_dist",
    "",
    RESULT_INIT,
  ];
  let check: MethodRecord["check"];
  const functions: string[] = [];

  if (d.shape === "scatter" && d.stats) {
    const st = d.stats;
    if (pooled) {
      steps.push({ kind: "fetch", title: "Sum each study's pairs", scope, rowsOut: t.moments?.length,
        detail: "The plot:moments queries above: per study, over the " + u + "s with a value on both axes, n, Σx, Σy, Σxy, Σx² and Σy². Six sums, no individual value; added across studies, exactly." });
      steps.push({ kind: "statistic", title: "Pearson's r and the least-squares line from the pooled sums",
        detail: "r = (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)); slope = (nΣxy − ΣxΣy) / (nΣx² − (Σx)²), intercept = (Σy − slope·Σx) / n." });
      steps.push({ kind: "statistic", title: "No Spearman",
        detail: "A rank correlation needs one ranking of every " + u + " of every study, which per-study sums cannot give, so none is reported." });
      functions.push("pearsonFromMoments", "regressionFromMoments");
    } else {
      steps.push({ kind: "fetch", title: "Correlate the pairs in the database", scope, rowsOut: d.n,
        detail: "The plot:stats query above, over the " + fmtN(d.n) + " " + u + "s with a value on both axes (log-transformed first where an axis is on a log scale): " +
          "Pearson's r (ClickHouse corr), Spearman's ρ as Pearson's r of the ranks, and the least-squares line (simpleLinearRegression).",
        params: [["Spearman ties", "average rank: tied values share the mean of the ranks they span, as scipy's spearmanr and cbioportal.org rank them (PLT-STM-5)"]] });
    }
    steps.push({ kind: "statistic", title: "p-values",
      detail: "For each coefficient r over n points: t = |r|·√((n − 2)/(1 − r²)), two-sided Student's t on n − 2 degrees of freedom; p = 0 when |r| = 1, none for n ≤ 2 (the portal's PLT-STM-6)." });
    functions.push("corrPValue");
    python.push(
      "def p_of(r, n):",
      "    # two-sided p for a correlation coefficient: Student's t on n - 2 df",
      "    if r is None or n <= 2:",
      "        return None",
      "    if abs(r) >= 1:",
      "        return 0.0",
      "    t = abs(r) * ((n - 2) / (1 - r * r)) ** 0.5",
      "    return 2 * t_dist.sf(t, n - 2)",
      "");
    if (pooled) {
      python.push(
        "# what the plot:moments query returned for each study",
        "sums = [",
        ...(t.moments || []).map((m) => "    dict(study=" + py(m.study) + ", n=" + m.n + ", sx=" + pyNum(m.sx) + ", sy=" + pyNum(m.sy) +
          ", sxy=" + pyNum(m.sxy) + ", sxx=" + pyNum(m.sxx) + ", syy=" + pyNum(m.syy) + "),"),
        "]",
        "S = {k: sum(s[k] for s in sums) for k in (\"n\", \"sx\", \"sy\", \"sxy\", \"sxx\", \"syy\")}",
        "n = S[\"n\"]",
        "vx, vy = n * S[\"sxx\"] - S[\"sx\"] ** 2, n * S[\"syy\"] - S[\"sy\"] ** 2",
        "pearson = (n * S[\"sxy\"] - S[\"sx\"] * S[\"sy\"]) / (vx * vy) ** 0.5 if n >= 3 and vx > 0 and vy > 0 else None",
        "slope = (n * S[\"sxy\"] - S[\"sx\"] * S[\"sy\"]) / vx if n >= 2 and vx > 0 else None",
        "intercept = (S[\"sy\"] - slope * S[\"sx\"]) / n if slope is not None else None",
        "RESULT.update({\"plot:pearson\": pearson, \"plot:slope\": slope, \"plot:intercept\": intercept, \"plot:pPearson\": p_of(pearson, n)})",
        "print(f\"n = {n}, Pearson r = {pearson}, p = {p_of(pearson, n)}, line y = {slope} x + {intercept}\")");
      // r is reported to 4 decimals (pearsonFromMoments)
      check = { "plot:pearson": { v: st.pearson, abs: 5e-5 + 1e-12 }, "plot:slope": { v: st.slope }, "plot:intercept": { v: st.intercept, abs: 1e-9 }, "plot:pPearson": { v: st.pPearson } };
    } else {
      python.push(
        "# what the plot:stats query returned",
        "n = " + d.n,
        "pearson, spearman = " + pyNum(st.pearson) + ", " + pyNum(st.spearman),
        "RESULT.update({\"plot:pPearson\": p_of(pearson, n), \"plot:pSpearman\": p_of(spearman, n)})",
        "print(f\"n = {n}, Pearson r = {pearson} (p = {p_of(pearson, n)}), Spearman rho = {spearman} (p = {p_of(spearman, n)})\")");
      check = { "plot:pPearson": { v: st.pPearson }, "plot:pSpearman": { v: st.pSpearman } };
    }
  } else if (d.shape === "box" && d.groups) {
    steps.push({ kind: "fetch", title: "Each group's quartiles, in the database", scope, rowsOut: d.groups.length,
      detail: "The plot:box " + (pooled ? "queries" : "query") + " above: per category, the count, the extremes and the quartiles of the numeric axis's values (log-transformed first where it is on a log scale).",
      params: [["quartiles", "the portal's rule (jStat.quartiles, PLT-STM-8): of the n sorted values, q1 is the round(n/4)-th and q3 the round(3n/4)-th, halves rounded up, no interpolation"],
        ["median", "the middle value; for an even n the mean of the two middle values"],
        ["a group of one", "no quartiles, drawn as its value with no box"]] });
    if (pooled) steps.push({ kind: "transform", title: "Pool each group across studies",
      detail: "Counts and extremes add exactly; the quartiles are each study's weighted by its count, an approximation (the portal pools the values themselves)." });
    steps.push({ kind: "statistic", title: "Whiskers",
      detail: "The portal's rule (PLT-STM-8): each whisker ends at its fence, q1 − 1.5 × IQR or q3 + 1.5 × IQR, when some value lies beyond it, else at the extreme value. Not Tukey's furthest value inside the fence, so a whisker may end where no case lies." });
    functions.push("tukey");
    python.push(
      "# what the plot:box " + (pooled ? "queries returned, pooled per group" : "query returned") + ": group, n, extremes, quartiles",
      "groups = [",
      ...d.groups.map((g) => "    dict(g=" + py(g.g) + ", n=" + g.n + ", lo=" + pyNum(g.lo) + ", hi=" + pyNum(g.hi) +
        ", q1=" + pyNum(g.q1) + ", median=" + pyNum(g.median) + ", q3=" + pyNum(g.q3) + "),"),
      "]",
      "for g in groups:",
      "    iqr = g[\"q3\"] - g[\"q1\"]",
      "    lo_w, hi_w = max(g[\"lo\"], g[\"q1\"] - 1.5 * iqr), min(g[\"hi\"], g[\"q3\"] + 1.5 * iqr)",
      "    RESULT[f\"plot:{g['g']}:loWhisker\"], RESULT[f\"plot:{g['g']}:hiWhisker\"] = lo_w, hi_w",
      "    print(f\"{g['g']}: n = {g['n']}, q1 {g['q1']}, median {g['median']}, q3 {g['q3']}, whiskers {lo_w} to {hi_w}\")");
    check = checks("plot:", d.groups as unknown as Record<string, unknown>[], (g) => g.g, [["loWhisker", "loWhisker"], ["hiWhisker", "hiWhisker"]]);
  } else {
    steps.push({ kind: "fetch", title: "Count each pair of categories", scope,
      detail: "The plot:cells " + (pooled ? "queries" : "query") + " above: " + u + "s per (horizontal, vertical) category pair" + (pooled ? ", added across studies" : "") + ". Counts only." });
    return { steps, implementation: { functions: [], file: "lib/views/plot/run.ts", commit: BUILD_COMMIT } };
  }
  return {
    steps,
    implementation: { functions, file: pooled && d.shape === "scatter" ? "lib/stats.ts" : "lib/plot.ts", commit: BUILD_COMMIT },
    verification: "In the database, the coefficients and quartiles are checked against scipy " + VERIFIED.pearson.version +
      " (pearsonr, spearmanr) and the portal's jStat rule on known values by scripts/check-plot-stats.ts.",
    python: withResult(python.join("\n") + "\n"),
    check,
  };
}

const fmtN = (n: number) => n.toLocaleString("en-US");
