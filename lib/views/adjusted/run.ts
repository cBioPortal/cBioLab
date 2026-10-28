// Adjusted view: each gene's alteration compared between two cohorts by a logistic regression of
// altered ~ cohort + covariates on per-patient rows inside each local study, beside the raw odds
// ratio and Fisher test. Covariates are coded by ./covariates.ts, as the cox and logistic views code them.
import { logisticRegression, fisherExact, benjaminiHochberg, LOGISTIC_MAX_ITERATIONS, type LogisticRow } from "../../stats.ts";
import type { ViewResult, CoxCovariate } from "../../types.ts";
import { isPatientLevel, hasViewAggregates } from "../../federation.ts";
import { riskmodelPanelGenesSql } from "../../federation-views.ts";
import type { AxisKind } from "../../plot.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, refuse, plural, ATTR_NAME } from "../shared.ts";
import { buildCoxColumns } from "../covariates.ts";
import type { AdjustedView, AdjustedGene, AdjustedResult } from "./types.ts";
import { adjustedRowsSql } from "./sql.ts";

export const ADJUSTED_MAX_GENES = 200, ADJUSTED_MAX_COVARIATES = 6;
/** a gene's cohort term is reported only when its log-OR's standard error is below this (larger: separation) */
const ADJUSTED_MAX_SE = 5;

/** one patient as the fits read them: which cohort (1 = the first), the genes their panels cover (null: every gene), mutated genes, covariates */
export interface AdjustedPatient { group: 0 | 1; covers: Set<string> | null; genes: Set<string>; values: (number | string)[] }

/** numbers when every value parses as one, else categories */
export function covariateKinds(patients: { values: (number | string)[] }[], n: number): AxisKind[] {
  return Array.from({ length: n }, (_, k) => patients.every((r) => r.values[k] !== "" && Number.isFinite(Number(r.values[k]))) ? "num" : "cat");
}

/**
 * Per gene: the patients profiled for it, the raw 2×2 (Fisher), and the logistic fit of altered on
 * the cohort indicator and the covariates (coded within the gene's patients); genes whose fit does
 * not converge or separates are returned in `failed`, never dropped. q is BH over the genes fit.
 * Pure, so it is testable without a database.
 */
export function adjustedFit(patients: AdjustedPatient[], genes: string[], covariates: string[], kinds: AxisKind[]):
  { rows: AdjustedGene[]; failed: { gene: string; reason: string }[] } {
  const axes: CoxCovariate[] = covariates.map((a) => ({ source: "clinical", attribute: a }));
  const rows: AdjustedGene[] = [], failed: { gene: string; reason: string }[] = [];
  for (const gene of genes) {
    const pts = patients.filter((r) => !r.covers || r.covers.has(gene));
    const altered: [number, number] = [0, 0], profiled: [number, number] = [0, 0];
    for (const r of pts) { const i = r.group ? 0 : 1; profiled[i]++; if (r.genes.has(gene)) altered[i]++; }
    const [a, c] = altered, b = profiled[0] - a, d = profiled[1] - c;
    if (!profiled[0] || !profiled[1]) { failed.push({ gene, reason: "not profiled in one of the cohorts" }); continue; }
    const rawOr = b * c > 0 && a * d > 0 ? (a * d) / (b * c) : null;
    const fisherP = fisherExact(a, b, c, d);
    // a numeric covariate that does not vary has nothing to adjust; a category in which no patient (or
    // every patient) is mutated separates, so for this gene it joins the reference level
    let merged = false;
    const cols = buildCoxColumns(axes, kinds, pts).filter((col) => {
      if (kinds[col.axisIndex] === "num") return new Set(pts.map((r) => Number(r.values[col.axisIndex]))).size > 1;
      const at = pts.filter((r) => String(r.values[col.axisIndex]) === col.level), hit = at.filter((r) => r.genes.has(gene)).length;
      const keep = hit > 0 && hit < at.length;
      if (!keep) merged = true;
      return keep;
    });
    const input: LogisticRow[] = pts.map((r) => ({ y: r.genes.has(gene) ? 1 : 0,
      x: [r.group, ...cols.map((col) => kinds[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : String(r.values[col.axisIndex]) === col.level ? 1 : 0)] }));
    let fit;
    try { fit = logisticRegression(input); }
    catch { fit = null; }
    if (!fit || fit.iterations >= LOGISTIC_MAX_ITERATIONS || !(fit.se[0] > 0 && fit.se[0] < ADJUSTED_MAX_SE) || !Number.isFinite(fit.beta[0])) {
      failed.push({ gene, reason: rawOr == null ? "an empty cell in the 2×2" : "the fit did not converge: a covariate nearly decides the alteration" });
      continue;
    }
    rows.push({ gene, altered, profiled, rawOr, fisherP, or: fit.or[0], ciLow: fit.ciLow[0], ciHigh: fit.ciHigh[0], p: fit.p[0], q: 1, ...(merged ? { merged } : {}) });
  }
  benjaminiHochberg(rows.map((g) => g.p)).forEach((q, i) => { rows[i].q = q; });
  rows.sort((x, y) => x.p - y.p || x.gene.localeCompare(y.gene));
  return { rows, failed };
}

export async function runAdjusted(view: AdjustedView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies, pin } = ctx;
  const no = (e: string) => refuse("adjusted", ctx, e);
  if (vNames.length !== 2) return no("an adjusted view compares exactly two cohorts; this one draws " + vNames.length);
  const covariates = (Array.isArray(view.covariates) ? view.covariates : []).map((c) => String(c).trim());
  { const e = overLimit("an adjusted view", ADJUSTED_MAX_COVARIATES, covariates.length); if (e) return no(e.replace("at most " + ADJUSTED_MAX_COVARIATES, "at most " + ADJUSTED_MAX_COVARIATES + " covariates")); }
  const bad = covariates.find((c) => !ATTR_NAME.test(c));
  if (bad != null) return no("covariate '" + bad.slice(0, 40) + "' is not an attribute name");
  if (new Set(covariates).size !== covariates.length) return no("a covariate is listed twice");
  const measure: "any" | "driver" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return no("no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minShare = view.minShare == null ? 0.05 : Number(view.minShare);
  if (!(minShare > 0 && minShare <= 1)) return no("minShare is a share of patients, above 0 and at most 1");
  const minAltered = view.minAltered == null ? 10 : Math.floor(Number(view.minAltered));
  if (!(minAltered >= 1 && minAltered <= 100000)) return no("minAltered is 1 to 100000");
  const labelN = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(labelN >= 0 && labelN <= 40)) return no("label is 0 to 40 genes");
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return no("nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  const patients: AdjustedPatient[] = [];
  const excludedRemote: { study: string; patients: number }[] = [];
  const withPanel = [0, 0], used = [0, 0];
  for (const [gi, n] of vNames.entries()) for (const st of cohorts[n].studies) {
    const res = resolvers[st];
    if (!isPatientLevel(res) || !hasViewAggregates(res)) { excludedRemote.push({ study: st, patients: cohorts[n].perStudy[st]?.count || 0 }); continue; }
    const [rows, panelRows] = await Promise.all([
      res.viewRows("adjusted:rows:" + n, doc.cohorts[n], (c, s, d) => adjustedRowsSql(c, s, d, { covariates, driverPin: measure === "driver" ? pin : null })),
      res.viewMeta("adjusted:panels", (s, d) => riskmodelPanelGenesSql(s, d))]);
    const panelGenes = new Map(panelRows.map((x) => [String(x.panel), (x.genes as unknown as string[]) || []] as const));
    const coverCache = new Map<string, Set<string> | null>();
    const covers = (panels: string[]): Set<string> | null => {
      const key = [...panels].sort().join("|");
      if (!coverCache.has(key)) coverCache.set(key, panels.includes("WES") ? null : new Set(panels.flatMap((p) => panelGenes.get(p) || [])));
      return coverCache.get(key)!;
    };
    for (const r of rows) {
      withPanel[gi]++;
      const values = covariates.map((_, k) => String(r["c" + k] ?? "").trim());
      if (values.some((x) => x === "")) continue;
      used[gi]++;
      patients.push({ group: gi === 0 ? 1 : 0, covers: covers((r.panels as unknown as string[]) || []), genes: new Set((r.genes as unknown as string[]) || []), values });
    }
  }
  if (!patients.length) return no(excludedRemote.length && !withPanel[0] && !withPanel[1]
    ? "no patient-level participant could answer: " + excludedRemote.map((e) => e.study).join(", ") + " answer with counts only, and a per-patient regression needs patient rows"
    : "no patient had a mutation panel" + (covariates.length ? " and every covariate (" + covariates.join(", ") + ") on record" : ""));
  if (!used[0] || !used[1]) return no("cohort “" + vNames[used[0] ? 1 : 0] + "” has no patient with a mutation panel" + (covariates.length ? " and every covariate on record" : ""));
  const kinds = covariateKinds(patients, covariates.length);
  const cats = kinds.flatMap((k, i) => k === "cat" ? [{ a: covariates[i], n: new Set(patients.map((r) => r.values[i])).size }] : []).filter((x) => x.n > 30);
  if (cats.length) return no(cats.map((x) => x.a + " takes " + x.n + " values").join(", ") + "; a categorical covariate takes at most 30");

  // genes mutated in at least minShare of the patients profiled for them, both cohorts together
  const altered = new Map<string, number>();
  for (const r of patients) for (const g of r.genes) if (!r.covers || r.covers.has(g)) altered.set(g, (altered.get(g) || 0) + 1);
  const byCover = new Map<Set<string> | null, number>();
  for (const r of patients) byCover.set(r.covers, (byCover.get(r.covers) || 0) + 1);
  const profiledFor = (g: string) => { let n = 0; for (const [cv, k] of byCover) if (!cv || cv.has(g)) n += k; return n; };
  const genes = [...altered].filter(([g, a]) => a >= minAltered && a / profiledFor(g) >= minShare).map(([g]) => g).sort();
  if (!genes.length) return no("no gene is mutated in at least " + (100 * minShare).toFixed(1) + "% (and " + minAltered + ") of the patients profiled for it; lower minShare");
  { const e = overLimit("an adjusted view", ADJUSTED_MAX_GENES, genes.length); if (e) return no(e.replace("at most " + ADJUSTED_MAX_GENES, "at most " + ADJUSTED_MAX_GENES + " genes").replace("remove " + (genes.length - ADJUSTED_MAX_GENES), "raise minShare to test fewer") + " (" + genes.length + " genes are mutated in at least " + (100 * minShare).toFixed(1) + "% of patients)"); }

  const { rows, failed } = adjustedFit(patients, genes, covariates, kinds);
  if (!rows.length) return no("no gene could be fit: " + failed.slice(0, 10).map((f) => f.gene + " (" + f.reason + ")").join("; "));
  const significant = rows.filter((g) => g.q < 0.05).length;
  const labels = rows.filter((g) => g.q < 0.05).slice(0, labelN).map((g) => g.gene);
  const result: AdjustedResult = { groups: [vNames[0], vNames[1]], covariates, measure, minShare, minAltered,
    patients: vNames.map((c, i) => ({ cohort: c, withPanel: withPanel[i], used: used[i] })),
    rows, failed, significant, labels, ...(excludedRemote.length ? { excludedRemote } : {}) };
  const mergedN = rows.filter((g) => g.merged).length;
  const flips = rows.filter((g) => g.fisherP < 0.05 && g.p >= 0.05).length;
  const multi = vStudies.length > 1;
  return {
    kind: "adjusted", cohorts: vNames, adjusted: result,
    participation: ctx.participationFor(vStudies, true),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Per gene, a logistic regression of mutated (yes/no) on cohort (“" + vNames[0] + "” = 1 against “" + vNames[1] + "”)" +
      (covariates.length ? " and " + covariates.join(", ") + " (" + covariates.map((c, i) => c + (kinds[i] === "num" ? " as a number" : " as categories against its commonest value")).join(", ") + "; a sample attribute is the patient's first cohort sample's)" : ", with no covariates — so the adjusted odds ratio is the raw one, from a model") +
      "; the odds ratio is the cohort term's, Wald 95% CI, and q is Benjamini–Hochberg over the " + rows.length + " genes fit. " +
      "Patients, not samples: a patient is mutated in a gene when any of their samples in the cohort carries a called " + (measure === "driver" ? "OncoKB driver mutation (" + pin + ")" : "mutation") + " in it, and is in a gene's model only when the mutation panel of one of those samples covers it (or whole-exome) — panel-aware, so a patient not profiled for a gene is left out of that gene, never counted as wild type. " +
      "Tested: the " + plural(genes.length, "gene") + " mutated in at least " + (100 * minShare).toFixed(1) + "% (and " + minAltered + ") of the patients profiled for them, both cohorts together (at most " + ADJUSTED_MAX_GENES + "). " +
      vNames.map((c, i) => "“" + c + "”: " + plural(withPanel[i], "patient") + " with a mutation panel" + (covariates.length ? ", " + used[i].toLocaleString("en-US") + " with every covariate" : "")).join("; ") + ". " +
      "Beside each adjusted odds ratio is the raw one with its two-sided Fisher p, on the same patients" + (flips ? "; " + plural(flips, "gene") + " significant raw (Fisher p < 0.05) are not after adjustment (adjusted p ≥ 0.05)" : "") + ". " +
      (mergedN ? "For " + plural(mergedN, "gene") + ", a covariate category in which no patient (or every patient) was mutated was merged into its reference level, since it would separate. " : "") +
      (failed.length ? "Not fit, listed rather than dropped: " + failed.slice(0, 15).map((f) => f.gene + " (" + f.reason + ")").join("; ") + (failed.length > 15 ? "; and " + (failed.length - 15) + " more" : "") + ". " : "") +
      "Adjustment removes only what the covariates measure: a hypermutated tumour raises every gene's odds at once, which TMB or MSI status as a covariate absorbs and nothing else does. " +
      "Cohorts are expected not to share patients; a patient in both would count on both sides. " +
      (multi ? "Pooled across " + vStudies.length + " studies without a study term; vocabularies are not harmonized. " : "") +
      (excludedRemote.length ? "Left out: " + excludedRemote.map((e) => e.study + " (" + e.patients + " patients, aggregate-only)").join(", ") + "." : "")
  };
}
