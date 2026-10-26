// Logistic view: a multivariate logistic regression on the Cox view's covariate coding, fit
// from per-patient rows inside each local study (patient-level participants only).
import { logisticRegression, type LogisticRow } from "../../stats.ts";
import type { ViewResult, CoxCovariate } from "../../types.ts";
import { isPatientLevel } from "../../federation.ts";
import { axisLabel, validateAxis, type AxisKind } from "../../plot.ts";
import { type CoxTrace } from "../../method.ts";
import { buildCoxColumns, notProfiledNote } from "../covariates.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit, studyCatalogs, assayEntitiesKnown } from "../shared.ts";
import { resolveProfileAxis } from "../../plot-profile.ts";
import type { LogisticView, LogisticCoefficient } from "./types.ts";
import { logisticMethod } from "./method.ts";

export async function runLogistic(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor } = c;
  // Multivariate logistic regression: same covariate/dummy-coding machinery as Cox
  // (buildCoxColumns, the same reference-level rules), same patient-level-only boundary —
  // but a binary outcome rather than a time-to-event one, so there is no endpoint/months
  // convention here: the outcome is just another axis, exactly like a covariate.
  let lv = view as LogisticView;
  try {
    // profile axes are read as the studies describe the profile
    const catalogs = await studyCatalogs(c, vStudies);
    lv = { ...lv, outcome: resolveProfileAxis(lv.outcome, "outcome", catalogs),
      ...(Array.isArray(lv.covariates) ? { covariates: lv.covariates.map((cv, i) => ({ ...resolveProfileAxis(cv, "covariate " + (i + 1), catalogs),
        ...((cv as { reference?: string }).reference != null ? { reference: (cv as { reference?: string }).reference } : {}) })) } : {}) };
    validateAxis(lv.outcome, "outcome");
    const named = await assayEntitiesKnown(c, { outcome: lv.outcome, ...Object.fromEntries((lv.covariates || []).map((cv, i) => ["covariate " + (i + 1), cv])) }, vStudies);
    lv = { ...lv, outcome: named.outcome, ...(Array.isArray(lv.covariates) ? { covariates: lv.covariates.map((cv, i) => ({ ...named["covariate " + (i + 1)], ...(cv.reference != null ? { reference: cv.reference } : {}) }) as CoxCovariate) } : {}) };
  }
  catch (e) { return untimed({ kind: "logistic", error: (e as Error).message }); }
  const outcomeLabel = axisLabel(lv.outcome);
  // alteration/molecular axes are deterministically categorical/numeric without a DB round
  // trip; a clinical attribute's kind is only known once its study's metadata is fetched
  // below, so that half of the check waits until outcomeKindFinal is known.
  if (lv.outcome.source === "alteration" && !lv.outcomeEvent) {
    return untimed({ kind: "logistic", error: "a categorical outcome needs outcomeEvent, naming which observed value of " + outcomeLabel + " counts as the event" });
  }
  if ((lv.outcome.source === "molecular" || (lv.outcome.source === "assay" && !lv.outcome.categorical)) && lv.outcomeEvent) {
    return untimed({ kind: "logistic", error: outcomeLabel + " is numeric (a " + lv.outcome.source + " axis) — outcomeEvent only applies to a categorical outcome" });
  }
  const lCovariates = Array.isArray(lv.covariates) ? lv.covariates : [];
  if (!lCovariates.length) return untimed({ kind: "logistic", error: "a logistic view needs at least one covariate" });
  { const e = overLimit("a logistic view", 8, lCovariates.length); if (e) return untimed({ kind: "logistic", error: e.replace("at most 8", "at most 8 covariates") }); }
  try { lCovariates.forEach((c, i) => validateAxis(c, "covariate " + (i + 1))); }
  catch (e) { return untimed({ kind: "logistic", error: (e as Error).message }); }

  const lCohortTotal = vNames.reduce((n, cn) => n + cohorts[cn].count, 0);
  if (lCohortTotal === 0) {
    return untimed({ kind: "logistic", cohorts: vNames,
      error: "nothing to fit: " + (vNames.length === 1 ? "cohort “" + vNames[0] + "” is" : "all cohorts are") + " empty." });
  }

  const lExcludedRemote: { study: string; patients: number }[] = [];
  type RawLogisticRow = { y: number | string; values: (number | string)[]; study: string };
  const lRawRows: RawLogisticRow[] = [];
  let outcomeKind: AxisKind | null = null;
  let lKinds: AxisKind[] | null = null;
  let lPatientLevelTotal = 0, lNotProfiled = 0;
  const lPerStudy: CoxTrace["perStudy"] = [];
  for (const n of vNames) {
    for (const st of cohorts[n].studies) {
      const res = resolvers[st];
      if (!isPatientLevel(res)) {
        lExcludedRemote.push({ study: st, patients: cohorts[n].perStudy[st]?.count || 0 });
        continue;
      }
      lPatientLevelTotal += cohorts[n].perStudy[st]?.count || 0;
      const { rows, outcomeKind: ok, kinds: k, notProfiled: np } = await res.logisticRows(doc.cohorts[n], lv.outcome, lCovariates);
      if (!outcomeKind) outcomeKind = ok;
      if (!lKinds) lKinds = k;
      lNotProfiled += np;
      for (const r of rows) lRawRows.push({ ...r, study: st });
      lPerStudy.push({ study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0, rows: rows.length, ...(np ? { notProfiled: np } : {}) });
    }
  }
  if (!lRawRows.length) {
    return untimed({ kind: "logistic", cohorts: vNames,
      error: lExcludedRemote.length && lPatientLevelTotal === 0
        ? "no patient-level participant could answer this — " + lExcludedRemote.map((e) => e.study).join(", ") +
          (lExcludedRemote.length === 1 ? " is" : " are") + " aggregate-only, and multivariate logistic regression needs patient-level covariates"
        : "no patient had both a value for " + outcomeLabel + " and every requested covariate defined" });
  }
  const lKindsFinal = lKinds!, outcomeKindFinal = outcomeKind!;

  let outcomeOther: string[] = [];
  let yRows: { y: 0 | 1; values: (number | string)[] }[];
  if (outcomeKindFinal === "num") {
    if (lv.outcomeEvent) {
      return untimed({ kind: "logistic", cohorts: vNames,
        error: outcomeLabel + " is numeric here — outcomeEvent only applies to a categorical outcome" });
    }
    const bad = lRawRows.find((r) => Number(r.y) !== 0 && Number(r.y) !== 1);
    if (bad) {
      return untimed({ kind: "logistic", cohorts: vNames,
        error: "a numeric logistic outcome must already be coded 0/1 — " + outcomeLabel + " has an observed value of " + bad.y + ". Use outcomeEvent on a categorical outcome instead of a threshold on a continuous one." });
    }
    yRows = lRawRows.map((r) => ({ y: Number(r.y) as 0 | 1, values: r.values }));
  } else {
    const observed = [...new Set(lRawRows.map((r) => String(r.y)))];
    if (!lv.outcomeEvent) {
      return untimed({ kind: "logistic", cohorts: vNames,
        error: "a categorical outcome needs outcomeEvent, naming which observed value of " + outcomeLabel + " counts as the event — observed values: " + observed.sort().join(", ") });
    }
    const event = String(lv.outcomeEvent);
    if (!observed.includes(event)) {
      return untimed({ kind: "logistic", cohorts: vNames,
        error: "outcomeEvent “" + event + "” was never observed for " + outcomeLabel + " here — observed values: " + observed.sort().join(", ") });
    }
    outcomeOther = observed.filter((v) => v !== event).sort();
    yRows = lRawRows.map((r) => ({ y: (String(r.y) === event ? 1 : 0) as 0 | 1, values: r.values }));
  }

  const lColumns = buildCoxColumns(lCovariates, lKindsFinal, yRows);
  if (!lColumns.length) {
    return untimed({ kind: "logistic", cohorts: vNames,
      error: "every covariate had only one observed level across these patients — there is nothing to estimate an odds ratio against" });
  }
  if (lColumns.length > 20) {
    return untimed({ kind: "logistic", cohorts: vNames,
      error: "these covariates expand to " + lColumns.length + " terms (capped at 20) — narrow a high-cardinality categorical covariate first" });
  }
  const toLx = (r: { values: (number | string)[] }): number[] => lColumns.map((col) =>
    lKindsFinal[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : (String(r.values[col.axisIndex]) === col.level ? 1 : 0));
  const logisticInput: LogisticRow[] = yRows.map((r) => ({ y: r.y, x: toLx(r) }));

  let lFit;
  try { lFit = logisticRegression(logisticInput); }
  catch (e) { return untimed({ kind: "logistic", cohorts: vNames, error: (e as Error).message }); }

  const lMissing = lPatientLevelTotal - lFit.n - lNotProfiled;
  const lCoefficients: LogisticCoefficient[] = lColumns.map((col, i) => ({
    label: col.label, ...(col.reference ? { reference: col.reference } : {}), ...(col.level ? { level: col.level } : {}),
    axisIndex: col.axisIndex,
    beta: lFit.beta[i], se: lFit.se[i], or: lFit.or[i], ciLow: lFit.ciLow[i], ciHigh: lFit.ciHigh[i], p: lFit.p[i]
  }));
  const logisticResult: ViewResult = { kind: "logistic", cohorts: vNames,
    logistic: { coefficients: lCoefficients, n: lFit.n, events: lFit.events,
      ...(outcomeOther.length ? { outcomeOther } : {}), ...(lExcludedRemote.length ? { excludedRemote: lExcludedRemote } : {}) },
    participation: participationFor(vStudies, false),
    caveat: "Logistic regression on " + lFit.n + " patients, " + lFit.events + " with " + outcomeLabel +
      (outcomeKindFinal === "cat" ? " = " + lv.outcomeEvent : "") + " (" + lColumns.length + " term" + (lColumns.length === 1 ? "" : "s") + ")." +
      (outcomeOther.length ? " Every other observed value of " + outcomeLabel + " (" + outcomeOther.join(", ") + ") was treated as “not event.”" : "") +
      (lMissing > 0 ? " " + lMissing + " patient" + (lMissing === 1 ? "" : "s") + " from patient-level participants lacked the outcome or a covariate and were excluded." : "") +
      notProfiledNote(lNotProfiled).replace("the gene of a covariate", "the gene of the outcome or a covariate") +
      (vStudies.length > 1 ? " Clinical-attribute vocabularies and declared types are NOT harmonized across studies." : "") +
      (lExcludedRemote.length
        ? " " + lExcludedRemote.map((e) => e.study + " (" + e.patients + " patients)").join(", ") +
          " could not contribute: aggregate-only participants have no patient-level covariates to fit on."
        : "") +
      " Computed from real per-patient rows within each local study — not pooled aggregate counts across untrusted remote peers." };
  logisticResult.method = logisticMethod({
    perStudy: lPerStudy, covariates: lCovariates, kinds: lKindsFinal, columns: lColumns, x: logisticInput.map((r) => r.x),
    fit: { n: lFit.n, events: lFit.events, iterations: lFit.iterations, loglik: lFit.loglik },
    outcomeKind: outcomeKindFinal, ...(lv.outcomeEvent != null ? { outcomeEvent: String(lv.outcomeEvent) } : {}), outcomeOther,
    coefficients: lColumns.map((col, i) => ({ label: col.label, beta: lFit.beta[i], se: lFit.se[i], p: lFit.p[i] })),
  }, { outcomeLabel, queryLabel: "logisticRows" });
  return logisticResult;
}
