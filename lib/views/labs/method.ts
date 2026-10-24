// The labs view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface LabsTrace {
  test: string;
  anchoredTo: string;
  occurrence: "FIRST" | "LAST";
  baselineDays: number; fromWeeks: number; toWeeks: number; binWeeks: number; responseDrop: number;
  pctMin: number; pctMax: number; pctBin: number;
  minPointN: number;
  waterfallCap: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  panels: { cohort: string; anchored: number; baseline: number; positiveBaseline: number; evaluable: number; responders: number;
    waterfallWithheld: number; waterfallCapped: number }[];
  /** per cohort, summed over its studies: patients per (week bin, % change bin midpoint) */
  course: { cohort: string; week: number; v: number; n: number }[];
  /** what the view reported — for the script check */
  results: { course: { cohort: string; week: number; q1: number | null; median: number | null; q3: number | null }[]; responseP?: number };
}

export function labsMethod(t: LabsTrace): MethodRecord {
  const two = t.panels.length === 2;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients' % change from baseline",
    detail: "The labs:course and labs:best queries above (and labs:waterfall, one bar per patient, from a patient-level participant). Counts per bin and per rule, no individual value except the waterfall's bars.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: "Anchor, baseline and change",
    detail: "Day 0 is each patient's " + t.occurrence.toLowerCase() + " " + t.anchoredTo + " (event type, key and value matched ignoring case); a patient without one is not anchored. " +
      t.test + " readings are those whose result parses as a number. The baseline is the mean of a patient's readings on the last day with any in the " + t.baselineDays +
      " days up to and including day 0; a patient without one has no baseline, and one whose baseline is 0 or below is left out, since a % change from it means nothing. Every later reading becomes 100·(value − baseline)/baseline; readings on the baseline day itself are not used.",
    params: t.panels.map((pn) => [pn.cohort, pn.anchored.toLocaleString() + " anchored → " + pn.baseline.toLocaleString() + " with a baseline → " +
      pn.positiveBaseline.toLocaleString() + " with a positive one → " + pn.evaluable.toLocaleString() + " with a reading after day 0"] as [string, string]) });
  steps.push({ kind: "transform", title: "Bin the course",
    detail: "Weeks " + t.fromWeeks + " to " + t.toWeeks + " around day 0 in " + t.binWeeks + "-week bins; a patient tested several times in a bin counts once, at their mean. % change in " + t.pctBin + "-point bins from " +
      t.pctMin + " to " + t.pctMax + ", values beyond either end in the end bin. The figure draws a bin only from " + t.minPointN + " patients." });
  steps.push({ kind: "statistic", title: "Median and interquartile range per week",
    detail: "From each bin's histogram, with the bin midpoints as values and linear interpolation between ranks — exact to within a " + t.pctBin + "-point bin." });
  steps.push({ kind: "statistic", title: "Best response",
    detail: "Each patient's lowest % change after day 0 within the window; a responder fell by at least " + t.responseDrop + "%, counted from the unbinned values." +
      (two ? " The two cohorts' response rates are compared with a two-sided Fisher's exact test." : ""),
    params: t.panels.map((pn) => [pn.cohort, pn.responders.toLocaleString() + " responders of " + pn.evaluable.toLocaleString() +
      (pn.waterfallWithheld ? " · " + pn.waterfallWithheld + " bars withheld (aggregate-only participant)" : "") +
      (pn.waterfallCapped ? " · " + pn.waterfallCapped + " bars past the " + t.waterfallCap.toLocaleString() + "-bar limit" : "")] as [string, string]) });
  const python = [
    "# Recompute the course's quartiles from the binned counts" + (two ? ", and the response test with scipy " + VERIFIED.fisher.version : "") + ".",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact"] : []),
    "",
    RESULT_INIT,
    ...pyTable("course", "Per cohort and week bin: patients whose mean % change fell in each " + t.pctBin + "-point bin (v is the bin's midpoint)",
      ["cohort", "week", "v", "n"], t.course.map((r) => [r.cohort, r.week, r.v, r.n]), "labs_course.csv"),
    "for (cohort, week), g in course.groupby([\"cohort\", \"week\"], sort=False):",
    "    values = np.repeat(g[\"v\"].to_numpy(), g[\"n\"].to_numpy())",
    "    q1, median, q3 = np.percentile(values, [25, 50, 75])",
    "    print(f\"{cohort} week {week}: n={len(values)}, median {median:.1f}%, IQR {q1:.1f} to {q3:.1f}\")",
    "    for name, x in ((\"q1\", q1), (\"median\", median), (\"q3\", q3)):",
    "        RESULT[f\"labs:{cohort}:{week}:{name}\"] = x",
    "responders = " + JSON.stringify(Object.fromEntries(t.panels.map((pn) => [pn.cohort, [pn.responders, pn.evaluable]]))) + "  # cohort: [responders, evaluable], as the query counted them",
    ...(two ? [
      "(ra, ea), (rb, eb) = responders.values()",
      "RESULT[\"labs:response:p\"] = fisher_exact([[ra, ea - ra], [rb, eb - rb]]).pvalue",
      "print(\"response rates\", {c: f\"{r}/{e}\" for c, (r, e) in responders.items()}, \"Fisher p =\", RESULT[\"labs:response:p\"])",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["quantilesFromHistogram", ...(two ? ["fisherExact"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Quantiles from histograms match numpy percentile on the expanded values" + (two ? ", and Fisher's exact test scipy " + VERIFIED.fisher.version + " fisher_exact" : "") +
      ", to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts).",
    python: withResult(python),
    check: {
      // quartiles are reported to 3 decimals
      ...checks("labs:", t.results.course, (c) => c.cohort + ":" + c.week,
        [["q1", "q1", { abs: 5e-4 + 1e-9 }], ["median", "median", { abs: 5e-4 + 1e-9 }], ["q3", "q3", { abs: 5e-4 + 1e-9 }]]),
      ...(t.results.responseP != null ? { "labs:response:p": { v: t.results.responseP } } : {}),
    },
  };
}
