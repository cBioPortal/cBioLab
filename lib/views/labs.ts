// Labs view: a lab value's course and response from a treatment start
import type { ViewResult, LabsView, LabsPanel } from "../types.ts";
import { isPatientLevel } from "../federation.ts";
import { labCourseSql, labBestSql, labWaterfallSql, labTestsSql, LAB_PCT_BIN, LAB_PCT_MIN, LAB_PCT_MAX, LAB_PCT_BINS } from "../federation-views.ts";
import { fisherExact, quantilesFromHistogram } from "../stats.ts";
import { LAB_MIN_POINT_N } from "../figures/labs.ts";
import { labsMethod, type LabsTrace } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse } from "./shared.ts";

const WATERFALL_CAP = 5000;
const LAB_KEY = /^[A-Za-z0-9_ .\/-]{1,80}$/;

export async function runLabs(view: LabsView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("a labs view", 4, vNames.length); if (e) return refuse("labs", ctx, e.replace("at most 4", "at most 4 cohorts")); }
  const test = String(view.test || "").trim();
  if (!test) return refuse("labs", ctx, "a labs view needs test, the lab test to follow (e.g. \"PSA\")");
  const lab = { eventType: String(view.eventType || "Lab_Test").trim(), testKey: String(view.testKey || "TEST").trim(), test,
    resultKey: String(view.resultKey || "RESULT").trim() };
  for (const [k, v] of Object.entries(lab)) if (!LAB_KEY.test(v)) return refuse("labs", ctx, k + " has characters a timeline attribute cannot: " + JSON.stringify(v).slice(0, 40));
  const a = view.anchor;
  if (!a || !a.eventType) return refuse("labs", ctx, "a labs view needs anchor, the treatment start the course is read from (e.g. {eventType: \"Treatment\", key: \"SUBTYPE\", value: \"Hormone\"})");
  const anchor = { eventType: String(a.eventType).slice(0, 120), ...(a.key ? { key: String(a.key).slice(0, 120), value: String(a.value ?? "") } : {}),
    occurrence: a.occurrence === "LAST" ? "LAST" as const : "FIRST" as const };
  const num = (x: unknown, d: number) => x == null ? d : Number(x);
  const baselineDays = num(view.baselineDays, 90), fromWeeks = num(view.fromWeeks, -12), toWeeks = num(view.toWeeks, 52), binWeeks = num(view.binWeeks, 4);
  const responseDrop = num(view.responseDrop, 50);
  if (!(baselineDays >= 0 && baselineDays <= 730)) return refuse("labs", ctx, "baselineDays is 0 to 730");
  if (!(fromWeeks <= 0 && fromWeeks >= -104 && toWeeks > 0 && toWeeks <= 520)) return refuse("labs", ctx, "fromWeeks is −104 to 0 and toWeeks 1 to 520");
  if (!(binWeeks >= 1 && binWeeks <= 26)) return refuse("labs", ctx, "binWeeks is 1 to 26");
  if (!(responseDrop > 0 && responseDrop <= 100)) return refuse("labs", ctx, "responseDrop is a fall in percent, above 0 and at most 100");
  const o = { baselineDays, fromDays: fromWeeks * 7, toDays: toWeeks * 7, binDays: binWeeks * 7 };

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("labs", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const nBins = LAB_PCT_BINS;
  const panels: LabsPanel[] = [];
  const courseRows: LabsTrace["course"] = [];
  for (const n of vNames) {
    const panel: LabsPanel = { cohort: n, anchored: 0, baseline: 0, positiveBaseline: 0, evaluable: 0, course: [], best: new Array(nBins).fill(0), responders: 0 };
    const courseHist = new Map<number, Map<number, number>>();
    const bars: number[] = [];
    let withheld = 0, capped = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n], r = ok[st];
      const [course, best] = await Promise.all([
        r.viewAggregate("labs:course:" + n, def, (c, s, d) => labCourseSql(c, s, d, lab, anchor, o)),
        r.viewAggregate("labs:best:" + n, def, (c, s, d) => labBestSql(c, s, d, lab, anchor, o, responseDrop))
      ]);
      for (const x of course) {
        const tb = Number(x.tbin), pb = Number(x.pbin);
        const m = courseHist.get(tb) || new Map<number, number>();
        m.set(pb, (m.get(pb) || 0) + Number(x.n)); courseHist.set(tb, m);
      }
      let evaluable = 0;
      for (const x of best) {
        const w = String(x.what), cnt = Number(x.n);
        if (w === "best") { const b = Number(x.pbin); if (b >= 0 && b < nBins) panel.best[b] += cnt; }
        else if (w === "responders") panel.responders += cnt;
        else if (w === "anchored") panel.anchored += cnt;
        else if (w === "baseline") panel.baseline += cnt;
        else if (w === "positive_baseline") panel.positiveBaseline += cnt;
        else if (w === "after") { panel.evaluable += cnt; evaluable = cnt; }
      }
      // the bars themselves are one patient's value each: only a patient-level participant is asked
      if (isPatientLevel(r) && evaluable) {
        const rows = await r.viewRows("labs:waterfall:" + n, def, (c, s, d) => labWaterfallSql(c, s, d, lab, anchor, o, WATERFALL_CAP));
        for (const x of rows) bars.push(Number(x.best));
        // the only reason a patient-level participant returns fewer bars than evaluable patients is the bar limit
        capped += Math.max(0, evaluable - rows.length);
      } else withheld += evaluable;
    }));
    const mid = (pb: number) => LAB_PCT_MIN + pb * LAB_PCT_BIN;
    panel.course = [...courseHist.keys()].sort((x, y) => x - y).map((tb) => {
      const hist = [...courseHist.get(tb)!].map(([pb, c]) => ({ v: mid(pb), n: c }));
      for (const h of [...hist].sort((a, b) => a.v - b.v)) courseRows.push({ cohort: n, week: tb * binWeeks, v: h.v, n: h.n });
      const [q1, median, q3] = quantilesFromHistogram(hist, [0.25, 0.5, 0.75]);
      return { week: tb * binWeeks, n: hist.reduce((s2, h) => s2 + h.n, 0), q1, median, q3 };
    });
    if (bars.length) panel.waterfall = bars.sort((x, y) => x - y);
    if (withheld) panel.waterfallWithheld = withheld;
    if (capped) panel.waterfallCapped = capped;
    panels.push(panel);
  }
  if (!panels.some((pn) => pn.anchored)) {
    return refuse("labs", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has a " + anchor.eventType +
      (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") + " event to start the clock from");
  }
  if (!panels.some((pn) => pn.evaluable)) {
    const st = Object.keys(ok)[0];
    const tests = await ok[st].viewAggregate("labs:tests", doc.cohorts[vNames[0]], (c, s, d) => labTestsSql(c, s, d, lab.eventType, lab.testKey));
    return refuse("labs", ctx, "no anchored patient has a " + test + " baseline within " + baselineDays + " days before the anchor and a value after it" +
      (tests.length ? " — " + lab.eventType + " " + lab.testKey + " here takes: " + tests.map((x) => String(x.test) + " (" + Number(x.patients).toLocaleString("en-US") + " patients)").join(", ")
        : " — " + st + " records no " + lab.eventType + " events with a " + lab.testKey + " attribute"));
  }
  let responseP: number | undefined;
  if (panels.length === 2 && panels.every((pn) => pn.evaluable))
    responseP = fisherExact(panels[0].responders, panels[0].evaluable - panels[0].responders, panels[1].responders, panels[1].evaluable - panels[1].responders);
  const anchoredTo = anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "");
  const withheld = panels.reduce((s2, pn) => s2 + (pn.waterfallWithheld || 0), 0);
  const capped = panels.reduce((s2, pn) => s2 + (pn.waterfallCapped || 0), 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "labs", cohorts: vNames,
    method: labsMethod({ test, anchoredTo, occurrence: anchor.occurrence === "LAST" ? "LAST" : "FIRST",
      baselineDays, fromWeeks, toWeeks, binWeeks, responseDrop, pctMin: LAB_PCT_MIN, pctMax: LAB_PCT_MAX, pctBin: LAB_PCT_BIN,
      minPointN: LAB_MIN_POINT_N, waterfallCap: WATERFALL_CAP,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      panels: panels.map((pn) => ({ cohort: pn.cohort, anchored: pn.anchored, baseline: pn.baseline, positiveBaseline: pn.positiveBaseline,
        evaluable: pn.evaluable, responders: pn.responders, waterfallWithheld: pn.waterfallWithheld || 0, waterfallCapped: pn.waterfallCapped || 0 })),
      course: courseRows,
      results: { course: panels.flatMap((pn) => pn.course.map((c) => ({ cohort: pn.cohort, week: c.week, q1: c.q1, median: c.median, q3: c.q3 }))),
        ...(responseP != null ? { responseP } : {}) } }),
    labs: { test, anchoredTo, responseDrop, fromWeeks, toWeeks, binWeeks, baselineDays, panels, ...(responseP != null ? { responseP } : {}), ...(excluded.length ? { excluded } : {}) },
    // the course and the rate are aggregates; a drawn waterfall is one patient's value per bar
    participation: ctx.participationFor(ctx.vStudies, panels.some((pn) => pn.waterfall && pn.waterfall.length)),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: test + " as % change from each patient's baseline — the mean of their readings on the last day with any, in the " + baselineDays + " days up to and including the " +
      (anchor.occurrence === "LAST" ? "last " : "first ") + anchoredTo + " — over " + fromWeeks + " to " + toWeeks + " weeks around it, in " + binWeeks + "-week bins; " +
      "a patient tested several times in a bin counts once, at their mean, and no reading from the baseline day is drawn. Median and interquartile band are read from 2-point histograms, so they are exact to within a point, and the figure draws only bins with at least " + LAB_MIN_POINT_N + " patients; " +
      "values above +300% share the top bin. Best response is each patient's lowest value after the anchor within the window; a responder fell by at least " + responseDrop + "%" +
      (responseDrop === 50 && /psa/i.test(test) ? " (PCWG3's PSA50)" : "") + ", counted exactly. " +
      "Denominators: " + panels.map((pn) => pn.cohort + " — " + pn.anchored.toLocaleString("en-US") + " anchored, " + pn.baseline.toLocaleString("en-US") + " with a baseline" +
        (pn.baseline > pn.positiveBaseline ? " (" + (pn.baseline - pn.positiveBaseline).toLocaleString("en-US") + " of them left out: a baseline of 0 or below has no % change)" : "") + ", " +
        pn.evaluable.toLocaleString("en-US") + " with a value after").join("; ") + ". " +
      "Patients tested more often are over-represented in any bin they appear in, and testing itself is more frequent when a value is moving; the course is of those measured, not of everyone. " +
      (withheld ? withheld.toLocaleString("en-US") + " patients' bars are not drawn in the waterfall: an aggregate-only participant cannot disclose one patient's value (they are in the histogram and the rate). " : "") +
      (capped ? capped.toLocaleString("en-US") + " patients' bars are past the waterfall's " + WATERFALL_CAP.toLocaleString("en-US") + "-bar limit and not drawn — the drawn bars are each study's lowest (they are all in the histogram and the rate). " : "") +
      (responseP != null ? "Response rates compared with a two-sided Fisher test. " : "") +
      (multi ? "Pooled across " + ctx.vStudies.length + " studies; units and assays are not harmonised. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
