// Adjusted view: each gene's alteration compared between two cohorts by a logistic regression of
// altered ~ cohort + covariates on per-patient rows inside each local study, beside the raw odds
// ratio and Fisher test. Covariates are coded by ./covariates.ts, as the cox and logistic views code them.
import type { ViewResult } from "../../types.ts";
import { isPatientLevel, hasViewAggregates } from "../../federation.ts";
import { riskmodelPanelGenesSql } from "../../federation-views.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, refuse, plural, ATTR_NAME } from "../shared.ts";
import type { AdjustedView, AdjustedResult } from "./types.ts";
import { adjustedRowsSql } from "./sql.ts";
import { compute } from "../../compute-pool.ts";
import { covariateKinds, type AdjustedPatient } from "./fit.ts";

export const ADJUSTED_MAX_GENES = 200, ADJUSTED_MAX_COVARIATES = 6;

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

  const { rows, failed } = await compute("adjustedFit", patients, genes, covariates, kinds);
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
