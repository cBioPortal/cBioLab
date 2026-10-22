// Cox view: a multivariate proportional-hazards fit from per-patient rows inside each local
// study (patient-level participants only). Covariates are coded by ./covariates.ts.
import { coxRegression, type CoxRow } from "../stats.ts";
import type { ViewResult, CoxView, CoxCoefficient } from "../types.ts";
import { isPatientLevel, type EndpointColumns } from "../federation.ts";
import { validateAxis, type AxisKind } from "../plot.ts";
import { coxMethod, type CoxTrace } from "../method.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";
import { overLimit, studyCatalogs } from "./shared.ts";
import { buildCoxColumns, notProfiledNote } from "./covariates.ts";
import { resolveProfileAxis } from "../plot-profile.ts";

export async function runCox(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor } = c;
  // Multivariate Cox: unlike survival/compare, this is fit from real per-patient rows
  // within each LOCAL study rather than pooled aggregate counts, so an aggregate-only or
  // remote participant simply cannot contribute (isPatientLevel gates it) — see the PR
  // notes for why that tradeoff is fine here.
  const cx = view as CoxView;
  const endpoint = String(cx.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) {
    return untimed({ kind: "cox", error: "bad survival endpoint '" + endpoint.slice(0, 40) + "'" });
  }
  // Same escape hatch as SurvivalView, for the same reason — see lib/views/survival.ts.
  let endpointColumns: EndpointColumns | undefined;
  if (cx.monthsAttribute != null || cx.statusAttribute != null) {
    const monthsAttr = String(cx.monthsAttribute || "").trim(), statusAttr = String(cx.statusAttribute || "").trim();
    if (!/^[A-Za-z0-9_]{1,64}$/.test(monthsAttr) || !/^[A-Za-z0-9_]{1,64}$/.test(statusAttr)) {
      return untimed({ kind: "cox", endpoint,
        error: "monthsAttribute and statusAttribute must both be given as valid attribute names (letters, digits, underscore, ≤64 chars): got '" +
          monthsAttr.slice(0, 40) + "'/'" + statusAttr.slice(0, 40) + "'" });
    }
    endpointColumns = { months: monthsAttr, status: statusAttr };
  }
  const endpointLabel = endpointColumns ? endpointColumns.months + "/" + endpointColumns.status : endpoint;
  let covariates = Array.isArray(cx.covariates) ? cx.covariates : [];
  if (!covariates.length) return untimed({ kind: "cox", endpoint, error: "a cox view needs at least one covariate" });
  { const e = overLimit("a cox view", 8, covariates.length); if (e) return untimed({ kind: "cox", endpoint, error: e.replace("at most 8", "at most 8 covariates") }); }
  try {
    // a profile covariate is read as the studies describe the profile; its reference level stays
    const catalogs = await studyCatalogs(c, vStudies);
    covariates = covariates.map((cv, i) => ({ ...resolveProfileAxis(cv, "covariate " + (i + 1), catalogs), ...(cv.reference != null ? { reference: cv.reference } : {}) }));
    covariates.forEach((cv, i) => validateAxis(cv, "covariate " + (i + 1)));
  }
  catch (e) { return untimed({ kind: "cox", endpoint, error: (e as Error).message }); }
  const rawCutoff = cx.cutoffMonths;
  let cutoffMonths: number | undefined;
  if (rawCutoff != null) {
    const c = Number(rawCutoff);
    if (!Number.isFinite(c) || c <= 0 || c > 1200) {
      return untimed({ kind: "cox", endpoint, error: "bad cutoffMonths '" + String(rawCutoff).slice(0, 40) + "': must be a positive number of months (max 1200)" });
    }
    cutoffMonths = c;
  }
  // One fit, over exactly the named cohorts pooled together — shared by the default
  // (pool everything) path and by stratifyByCohort (called once per cohort, alone).
  type RawCoxRow = { t: number; event: number; values: (number | string)[]; study: string };
  type CoxFit = { error: string } | {
    coefficients: CoxCoefficient[]; n: number; events: number; termCount: number;
    excludedRemote: { study: string; patients: number }[]; patientLevelTotal: number; notProfiled: number; trace: CoxTrace;
  };
  const fitCoxFor = async (names: string[]): Promise<CoxFit> => {
    const cohortTotal = names.reduce((n, cn) => n + cohorts[cn].count, 0);
    if (cohortTotal === 0) {
      return { error: "nothing to fit: " + (names.length === 1 ? "cohort “" + names[0] + "” is" : "all cohorts are") + " empty." };
    }
    const excludedRemote: { study: string; patients: number }[] = [];
    const rawRows: RawCoxRow[] = [];
    let kinds: AxisKind[] | null = null;
    let patientLevelTotal = 0, notProfiled = 0;
    const perStudy: CoxTrace["perStudy"] = [];
    for (const n of names) {
      for (const st of cohorts[n].studies) {
        const res = resolvers[st];
        if (!isPatientLevel(res)) {
          excludedRemote.push({ study: st, patients: cohorts[n].perStudy[st]?.count || 0 });
          continue;
        }
        patientLevelTotal += cohorts[n].perStudy[st]?.count || 0;
        const { rows, kinds: k, notProfiled: np } = await res.coxRows(doc.cohorts[n], endpoint, covariates, endpointColumns);
        if (!kinds) kinds = k;
        notProfiled += np;
        for (const r of rows) rawRows.push({ ...r, study: st });
        perStudy.push({ study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0, rows: rows.length, ...(np ? { notProfiled: np } : {}) });
      }
    }
    if (!rawRows.length) {
      return { error: excludedRemote.length && patientLevelTotal === 0
        ? "no patient-level participant could answer this — " + excludedRemote.map((e) => e.study).join(", ") +
          (excludedRemote.length === 1 ? " is" : " are") + " aggregate-only, and multivariate Cox needs patient-level covariates"
        : "no patient had both a " + endpointLabel + " measurement and every requested covariate defined" };
    }
    const kindsFinal = kinds!;

    // administrative censoring, same semantics as the KM view
    const rowsCut = cutoffMonths != null
      ? rawRows.map((r) => r.t > cutoffMonths! ? { ...r, t: cutoffMonths!, event: 0 } : r)
      : rawRows;

    const columns = buildCoxColumns(covariates, kindsFinal, rowsCut);
    if (!columns.length) {
      return { error: "every covariate had only one observed level across these patients — there is nothing to estimate a hazard ratio against" };
    }
    if (columns.length > 20) {
      return { error: "these covariates expand to " + columns.length + " terms (capped at 20) — narrow a high-cardinality categorical covariate first" };
    }
    const toX = (r: RawCoxRow): number[] => columns.map((col) =>
      kindsFinal[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : (String(r.values[col.axisIndex]) === col.level ? 1 : 0));
    const coxInput: CoxRow[] = rowsCut
      .filter((r) => Number.isFinite(r.t) && r.t >= 0)
      .map((r) => ({ t: r.t, event: r.event, x: toX(r), ...(cx.stratifyByStudy ? { stratum: r.study } : {}) }));
    const censoredAtCutoff = cutoffMonths != null ? rawRows.filter((r) => r.t > cutoffMonths!).length : 0;

    let fit;
    try { fit = coxRegression(coxInput); }
    catch (e) { return { error: (e as Error).message }; }

    const coefficients: CoxCoefficient[] = columns.map((col, i) => ({
      label: col.label, ...(col.reference ? { reference: col.reference } : {}), ...(col.level ? { level: col.level } : {}),
      axisIndex: col.axisIndex,
      beta: fit.beta[i], se: fit.se[i], hr: fit.hr[i], ciLow: fit.ciLow[i], ciHigh: fit.ciHigh[i], p: fit.p[i]
    }));
    const trace: CoxTrace = {
      ...(names.length === 1 && cx.stratifyByCohort && vNames.length > 1 ? { scope: names[0] } : {}),
      perStudy, covariates, kinds: kindsFinal, columns, x: coxInput.map((r) => r.x),
      fit: { n: fit.n, events: fit.events, iterations: fit.iterations, loglik: fit.loglik },
      censoredAtCutoff, droppedBadTime: rowsCut.length - coxInput.length,
      coefficients: columns.map((col, i) => ({ label: col.label, beta: fit.beta[i], se: fit.se[i], p: fit.p[i] })),
    };
    return { coefficients, n: fit.n, events: fit.events, termCount: columns.length, excludedRemote, patientLevelTotal, notProfiled, trace };
  };

  const coxMethodOptions = {
    endpoint,
    monthsColumn: endpointColumns ? endpointColumns.months : endpoint + "_MONTHS",
    statusColumn: endpointColumns ? endpointColumns.status : endpoint + "_STATUS",
    ...(cutoffMonths != null ? { cutoffMonths } : {}),
    stratifyByStudy: !!cx.stratifyByStudy,
    queryLabel: "coxRows:" + endpoint,
  };

  // stratifyByCohort: N independent fits (own baseline hazard, own coefficients, own
  // choice of reference level per cohort) instead of one pooled fit — a no-op with only
  // one cohort named, since that's already exactly what the pooled path below would do.
  if (cx.stratifyByCohort && vNames.length > 1) {
    const perCohort: { cohort: string; fit: CoxFit }[] = [];
    for (const cohort of vNames) perCohort.push({ cohort, fit: await fitCoxFor([cohort]) });
    const okCount = perCohort.filter((c) => !("error" in c.fit)).length;
    if (!okCount) {
      return untimed({ kind: "cox", endpoint, cohorts: vNames,
        error: "no cohort could be fit: " + perCohort.map((c) => c.cohort + " (" + (c.fit as { error: string }).error + ")").join("; ") });
    }
    const byCohort = perCohort.map(({ cohort, fit }) => "error" in fit
      ? { cohort, coefficients: [] as CoxCoefficient[], n: 0, events: 0, error: fit.error }
      : { cohort, coefficients: fit.coefficients, n: fit.n, events: fit.events, ...(fit.excludedRemote.length ? { excludedRemote: fit.excludedRemote } : {}) });
    const failedNotes = perCohort.filter((c) => "error" in c.fit)
      .map((c) => "“" + c.cohort + "” could not be fit: " + (c.fit as { error: string }).error);
    const coxResult: ViewResult = { kind: "cox", cohorts: vNames, endpoint,
      ...(cutoffMonths != null ? { cutoffMonths } : {}),
      cox: { coefficients: [], n: byCohort.reduce((s, c) => s + c.n, 0), events: byCohort.reduce((s, c) => s + c.events, 0), byCohort },
      participation: participationFor(vStudies, false),
      caveat: "Stratified by cohort: " + okCount + " of " + vNames.length + " cohort" + (vNames.length === 1 ? "" : "s") +
        " fit as its OWN separate Cox model — own baseline hazard, own coefficients, even its own choice of reference level — rather than pooled into one fit. A covariate's effect, not just the cohorts' case mix, may genuinely differ between them; pooling would have averaged that difference away instead of showing it." +
        (failedNotes.length ? " " + failedNotes.join(" ") : "") +
        (cutoffMonths != null ? " Administratively censored at " + cutoffMonths + " months." : "") +
        " Computed from real per-patient rows within each local study — not pooled aggregate counts across untrusted remote peers, unlike KM/log-rank." };
    coxResult.method = coxMethod(perCohort.flatMap(({ fit }) => "error" in fit ? [] : [fit.trace]), coxMethodOptions);
    return coxResult;
  } else {
    const fit0 = await fitCoxFor(vNames);
    if ("error" in fit0) return untimed({ kind: "cox", endpoint, cohorts: vNames, error: fit0.error });
    const missing = fit0.patientLevelTotal - fit0.n - fit0.notProfiled;
    const coxResult: ViewResult = { kind: "cox", cohorts: vNames, endpoint,
      ...(cutoffMonths != null ? { cutoffMonths } : {}),
      cox: { coefficients: fit0.coefficients, n: fit0.n, events: fit0.events, ...(fit0.excludedRemote.length ? { excludedRemote: fit0.excludedRemote } : {}) },
      participation: participationFor(vStudies, false),
      caveat: "Cox proportional-hazards regression (Efron ties) on " + fit0.n + " patients, " + fit0.events + " events, " +
        fit0.termCount + " term" + (fit0.termCount === 1 ? "" : "s") + "." +
        (missing > 0 ? " " + missing + " patient" + (missing === 1 ? "" : "s") + " from patient-level participants lacked the endpoint or a covariate and were excluded." : "") +
        notProfiledNote(fit0.notProfiled) +
        (cutoffMonths != null ? " Administratively censored at " + cutoffMonths + " months." : "") +
        (cx.stratifyByStudy
          ? " Stratified by study: each study fits its own baseline hazard, so a case-mix difference between studies cannot masquerade as a covariate effect."
          : vStudies.length > 1 ? " Pooled across studies WITHOUT stratifying — a case-mix difference between studies could be absorbed into a covariate's estimated effect; consider stratifyByStudy." : "") +
        (vStudies.length > 1 ? " Clinical-attribute vocabularies and declared types are NOT harmonized across studies." : "") +
        (fit0.excludedRemote.length
          ? " " + fit0.excludedRemote.map((e) => e.study + " (" + e.patients + " patients)").join(", ") +
            " could not contribute: aggregate-only participants have no patient-level covariates to fit on."
          : "") +
        " Computed from real per-patient rows within each local study — not pooled aggregate counts across untrusted remote peers, unlike KM/log-rank." };
    coxResult.method = coxMethod([fit0.trace], coxMethodOptions);
    // Rendered here, by the SAME renderer MCP uses — the app draws the
    // forest plot as this SVG rather than a second, hand-rolled chart (the pattern
    // the clinical course and treatment-sequence views already follow).
    return coxResult;
  }
}
