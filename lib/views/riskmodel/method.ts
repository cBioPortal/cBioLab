// The riskmodel view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, withResult, pFmt, RESULT_INIT, pyTable, checks } from "../../method.ts";
import type { Table1Histogram } from "./table1.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import { TABLE1_CONSIDERED, TABLE1_DEFAULT_MAX_VALUES, TABLE1_DEFAULT_ATTRIBUTES, TABLE1_MAX_VALUES, table1RowKey } from "./table1.ts";

export interface RiskmodelTrace {
  study: string; cohort: string; cohortPatients: number; rowsReturned: number;
  r: import("./types.ts").RiskmodelResult;
  lambdas: number; folds: number; testShare: number;
  /** Table 1's numeric rows: each group's value distribution, for the script */
  table1Histograms: Table1Histogram[];
}

/**
 * The risk model's steps. No script recomputes it: the ensemble draws thousands of fits from a
 * seeded generator, and the fit itself is what test/coxnet-golden.test.ts pins against
 * scikit-survival and lifelines. The record names that test instead.
 */
export function riskmodelMethod(t: RiskmodelTrace): MethodRecord {
  const r = t.r;
  const out: [string, string][] = [["left out: no mutation panel on record", String(r.notProfiled)]];
  if (r.strata) out.push(["left out: no " + r.strata, String(r.noStratum)]);
  if (r.covariates.length) out.push(["left out: missing a covariate", String(r.noCovariate)]);
  if (r.anchoredTo) out.push(["left out: no " + r.anchoredTo + " event", String(r.noAnchor)], ["left out: anchor after the study's day 0", String(r.anchorAfterStart)],
    ["left out: no follow-up after entry", String(r.noFollowUp)]);
  const steps: MethodStep[] = [
    { kind: "fetch", title: "One row per patient", scope: t.cohort + " · " + t.study, rowsIn: t.cohortPatients, rowsOut: t.rowsReturned,
      detail: "The riskmodel:rows query above: each patient's survival time and event" + (r.anchoredTo ? " (from their " + r.anchoredTo + " event, with that event's offset to the study's day 0 as their entry time)" : "") +
        ", the panels their samples were sequenced on for mutations, the genes " + (r.measure === "driver" ? "with an OncoKB driver mutation" : "mutated") + " in them" +
        (r.strata ? ", their " + r.strata : "") + (r.covariates.length ? ", their covariate values" : "") +
        ", and their half of the engine's fixed held-out split. Patient-level: the rows never leave this server's engine, and no identifier is returned." },
    { kind: "transform", title: "Patients, candidate genes and covariates",
      detail: "A gene is a candidate only if every patient's panels cover it, so no patient is counted as wild-type for a gene they were never tested for, " +
        "and only if at least " + r.minMutated + " patients have it mutated." +
        (r.covariates.length ? " Covariates enter as they are when every value is a number, else as one indicator per value against the commonest; they are never penalised." : ""),
      params: [["genes covered for every patient", String(r.genesCovered)], ["candidates", String(r.candidates)], ...out] },
    { kind: "statistic", title: "Elastic-net Cox, " + r.runs + " random splits",
      detail: (r.validation ? "Only the discovery half (" + r.validation.discovery + " patients) is used. " : "") +
        "Each run holds out a random " + Math.round(t.testShare * 100) + "% of the patients; on the rest, the penalty is chosen from a path of " + t.lambdas +
        " by " + t.folds + "-fold cross-validated partial likelihood (Verweij & van Houwelingen), and the model at that penalty scores the held-out patients" +
        (r.validation ? " and every patient of the validation half" : "") + ". Genes are scaled to unit variance before fitting; Breslow ties" +
        (r.strata ? "; a separate baseline hazard per " + r.strata : "") + (r.anchoredTo ? "; delayed entry" : "") +
        ". A patient's risk score is the mean of the scores they got while held out (OncoCast's ensemble, Martin et al.)" +
        (r.validation ? "; a validation patient's is the mean over every run" : "") + ".",
      params: [["l1 share of the penalty (alpha)", String(r.alpha)], ["runs", String(r.runs)], ["seed", String(r.seed)],
        ["test-set C-index, median (IQR)", r.cIndex.median.toFixed(3) + " (" + r.cIndex.q1.toFixed(3) + "–" + r.cIndex.q3.toFixed(3) + ")"],
        ...(r.validation ? [["C-index on the validation half", r.validation.cIndex.toFixed(3)] as [string, string]] : []),
        ["never held out, so unscored", String(r.neverHeldOut)],
        ...r.covariates.map((c) => [c.name, "HR " + c.hr.toFixed(3) + " (mean over runs)"] as [string, string])] },
    { kind: "statistic", title: "Risk groups, their survival and hazard ratios",
      detail: (r.cutsChosen ? "Cuts at the quantiles the view names (" + r.cutsChosen.join(", ") + ")" : "Cuts at equal quantiles") + " of the " +
        (r.validation ? "discovery half's held-out scores, applied to the validation half" : "held-out scores") +
        ", each moved to the nearer edge of any run of tied scores so equal scores share a group" +
        (r.cutsChosen ? " — the quantiles are the view's; the computation does not use the outcome to place them, but whoever chose them may have." : " — no outcome is used to place them.") + " Each group is drawn as a Kaplan–Meier curve" +
        (r.anchoredTo ? " with delayed entry" : "") + " and read at 12 and 36 months; the groups are compared with a " + (r.strata ? "stratified " : "") +
        "log-rank test, and a Cox model of the outcome on the group indicators gives each group's hazard ratio against the lowest (Newton–Raphson, full information matrix, 95% Wald intervals). " +
        "A second Cox model on the standardised score alone gives the hazard ratio per standard deviation. " +
        "The score is also shown on OncoCast's 0–10 scale, (score − min) / (max − min) × 10, min and max the lowest and highest " +
        (r.validation ? "held-out score in the discovery half (so a validation patient can fall outside 0–10)" : "held-out score") +
        "; the scale is linear, so it moves no patient between groups and changes no number above.",
      params: [["0 on the 0–10 scale (raw score)", r.scale.min.toFixed(4)], ["10 on the 0–10 scale (raw score)", r.scale.max.toFixed(4)],
        ...r.groups.map((g) => [g.name, g.curve.n.toLocaleString() + " patients, " + g.curve.events.toLocaleString() + " events, median " +
        (g.curve.median == null ? "not reached" : g.curve.median.toFixed(1) + " months") + (g.hr != null ? ", HR " + g.hr.toFixed(2) : "")] as [string, string])] },
  ];
  const fitVerification = "lib/coxnet.ts's path is checked against scikit-survival's CoxnetSurvivalAnalysis, its delayed-entry, stratified fits (with standard errors) against statsmodels' PHReg and its C-index against lifelines, by test/coxnet-golden.test.ts (fixtures from python/golden/coxnet.py).";
  const implementation = { functions: ["coxnetEnsemble", "coxnetPath", "cvLambda", "concordance", "coxFit"], file: "lib/coxnet.ts", commit: BUILD_COMMIT };
  if (!r.table1) return { steps, implementation, verification: fitVerification };
  const t1 = table1Record(r.table1, t.table1Histograms);
  return { steps: [...steps, ...t1.steps],
    implementation: { ...implementation, functions: [...implementation.functions, "buildTable1", "chiSquareTest", "kruskalWallis", "quantilesFromHistogram", "benjaminiHochberg"],
      file: implementation.file + ", lib/views/riskmodel/table1.ts, lib/stats.ts" },
    verification: fitVerification + " The script below recomputes Table 1's tests and q-values from its counts (the model itself it does not refit); χ² matches scipy " + VERIFIED.chi2.version +
      " chi2_contingency, Kruskal–Wallis and quantiles scipy/numpy, Benjamini–Hochberg statsmodels multipletests (test/tables-golden.test.ts, test/moments-golden.test.ts).",
    python: withResult(t1.python), check: t1.check };
}

/** Table 1's steps, and the script that recomputes its tests from its counts. */
function table1Record(t: import("./types.ts").RiskTable1, histograms: Table1Histogram[]) {
  const fmtP = (p: number | null) => p == null ? "—" : pFmt(p);
  const shown = t.rows.filter((x) => x.kind !== "skipped");
  const groups = t.groups.map((g) => g.name);
  const steps: MethodStep[] = [
    { kind: "fetch", title: "Table 1: the groups' patients again, with their clinical values",
      detail: "The riskmodel:table1 query above is the riskmodel:rows query with Table 1's attributes added: for each, the patient's value (a sample-level attribute: their first sample's), " +
        "case and whitespace folded as everywhere in this app and shown in its commonest spelling, and how many values their samples hold. Its rows are kept exactly as the model's were and must match " +
        "the model's patients one by one — survival time, entry and event — or the view is refused, so each group's column describes the patients its curve drew" +
        (t.reportedOn === "validation half" ? " (the validation half)" : "") + ". riskmodel:table1-attributes gives each attribute's type (NUMBER is numeric), riskmodel:panels each mutation panel's genes. " +
        "Patient-level: the rows never leave this server's engine; only the counts below do.",
      params: t.groups.map((g) => [g.name, g.n.toLocaleString("en-US") + " patients"] as [string, string]) },
    { kind: "transform", title: "Table 1's rows",
      detail: (t.defaults.attributes
        ? "Attributes by the default rule: the model's stratum and covariates, then the study's attributes in its priority order, leaving out survival endpoints' columns (…_MONTHS, …_STATUS), " +
          "considering the first " + TABLE1_CONSIDERED + "; of those, an attribute is left out if no patient here has a value, if it takes one value among them, or if it is categorical with more than " +
          TABLE1_DEFAULT_MAX_VALUES + " values (free text, ids); the first " + TABLE1_DEFAULT_ATTRIBUTES + " that remain are shown."
        : "Attributes as the view names them; a categorical one with more than " + TABLE1_MAX_VALUES + " values among these patients is set aside.") + " " +
        (t.defaults.genes ? "Genes: the " + t.rows.filter((x) => x.kind === "gene").length + " the model kept in the most runs." : "Genes as the view names them.") + " " +
        "A gene is counted as mutated the way the model counts it (" + (t.measure === "driver" ? "OncoKB drivers" : "any mutation") + "), and only among the patients whose mutation panels cover it " +
        "(a whole-exome patient covers every gene): a patient whose panels do not is not profiled for it, never unaltered, and is counted as such in each group. " +
        "A row the groups differ in by construction is marked: a gene the model kept in any run and a covariate are \"in the model\" (the score is built from them), the endpoint's own columns are \"outcome\" (the groups are cut to differ in survival); the model's stratum is marked \"stratum\" but is a description, since the score has no stratum term.",
      params: [...t.omitted.map((o) => ["left out: " + o.name, o.why] as [string, string]),
        ...t.rows.filter((x) => x.kind === "skipped").map((x) => ["set aside: " + x.name, (x as { skipped: string }).skipped] as [string, string])] },
    { kind: "statistic", title: "Each row tested across the groups",
      detail: "A categorical attribute: Pearson χ² on the group × value table, no continuity correction, an all-zero row or column dropped first, patients with no value left out. " +
        "A gene: Pearson χ² on the group × (mutated, not mutated) table of its profiled patients. A numeric attribute: Kruskal–Wallis on each group's values, ranks averaged within ties and tie-corrected; medians and quartiles interpolating linearly between ranks. " +
        "The smallest expected count is reported, since χ² is poor below about 5.",
      params: shown.map((x) => [table1RowKey(x).replace(/^attribute:/, ""), x.p == null ? "not tested: " + (x as { untested?: string }).untested
        : (x.test === "chi-squared" ? "χ² " : "H ") + x.statistic + " on " + x.df + " df · p " + fmtP(x.p) + (x.role ? " · " + x.role : "")] as [string, string]) },
    { kind: "statistic", title: "Benjamini–Hochberg across Table 1's open rows",
      detail: "q-values over the " + t.tested + " tested rows that are not in the model and not its outcome. Those rows differ between the groups by construction, so they get a p-value but no q-value and do not enter the correction, where their p-values would shrink every other row's q." },
  ];
  const tested = shown.filter((x) => x.p != null);
  const cat = tested.filter((x) => x.kind === "cat") as Extract<typeof shown[number], { kind: "cat" }>[];
  const genes = tested.filter((x) => x.kind === "gene") as Extract<typeof shown[number], { kind: "gene" }>[];
  const numKeys = new Set(tested.filter((x) => x.kind === "num").map(table1RowKey));
  const hist = histograms.filter((h) => numKeys.has(h.row));
  const family = tested.filter((x) => x.q != null).map(table1RowKey);
  const python = [
    "# Recompute Table 1's tests from its counts: scipy " + VERIFIED.chi2.version + " and statsmodels " + VERIFIED.bh.version + " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import chi2_contingency, kruskal",
    "from statsmodels.stats.multitest import multipletests",
    "",
    "groups = " + JSON.stringify(groups),
    RESULT_INIT,
    "",
    "def chi2_p(table):",
    "    table = table[table.sum(axis=1) > 0][:, table.sum(axis=0) > 0]  # drop an all-zero row or column",
    "    return chi2_contingency(table, correction=False).pvalue",
    ...(cat.length ? ["",
      ...pyTable("categorical", "Categorical rows: patients per group (by index into groups) and value (by index into the row's values)", ["row", "group", "level", "n"],
        cat.flatMap((x) => x.levels.flatMap((l, li) => l.counts.map((n, gi) => [table1RowKey(x), gi, li, n]))), "table1_categorical.csv"),
      "for row, g in categorical.groupby(\"row\", sort=False):",
      "    table = g.pivot_table(index=\"group\", columns=\"level\", values=\"n\", aggfunc=\"sum\", fill_value=0).to_numpy()",
      "    RESULT[f\"table1:{row}:p\"] = chi2_p(table)",
      "    print(f\"{row}: chi-squared p={RESULT[f'table1:{row}:p']:.4g}\")"] : []),
    ...(genes.length ? ["",
      ...pyTable("genes", "Gene rows: per group (by index into groups), patients with the gene mutated and patients whose panels cover it", ["row", "group", "altered", "profiled"],
        genes.flatMap((x) => x.perGroup.map((c, gi) => [table1RowKey(x), gi, c.altered, c.profiled])), "table1_genes.csv"),
      "for row, g in genes.groupby(\"row\", sort=False):",
      "    table = np.column_stack([g[\"altered\"], g[\"profiled\"] - g[\"altered\"]])",
      "    RESULT[f\"table1:{row}:p\"] = chi2_p(table)",
      "    print(f\"{row}: \" + \", \".join(f\"{a}/{p}\" for a, p in zip(g[\"altered\"], g[\"profiled\"])) + f\" mutated; chi-squared p={RESULT[f'table1:{row}:p']:.4g}\")"] : []),
    ...(hist.length ? ["",
      ...pyTable("numeric", "Numeric rows: each group's values, as (value, patients)", ["row", "group", "value", "n"], hist.map((h) => [h.row, h.group, h.value, h.n]), "table1_numeric.csv"),
      "for row, g in numeric.groupby(\"row\", sort=False):",
      "    values = {grp: np.repeat(h[\"value\"].to_numpy(), h[\"n\"].to_numpy()) for grp, h in g.groupby(\"group\", sort=False)}",
      "    for grp, v in values.items():",
      "        for name, q in ((\"median\", 50), (\"q1\", 25), (\"q3\", 75)):",
      "            RESULT[f\"table1:{row}:{grp}:{name}\"] = np.percentile(v, q)",
      "    RESULT[f\"table1:{row}:p\"] = kruskal(*values.values()).pvalue",
      "    print(f\"{row}: Kruskal-Wallis p={RESULT[f'table1:{row}:p']:.4g}\")"] : []),
    "",
    "# q-values over the open rows only: those in the model or its outcome differ by construction",
    "family = " + JSON.stringify(family),
    "if family:",
    "    for row, qv in zip(family, multipletests([RESULT[f\"table1:{r}:p\"] for r in family], method=\"fdr_bh\")[1]):",
    "        RESULT[f\"table1:{row}:q\"] = qv",
  ].join("\n") + "\n";
  const medians = tested.filter((x) => x.kind === "num").flatMap((x) => (x as Extract<typeof shown[number], { kind: "num" }>).perGroup
    .map((c, gi) => ({ key: table1RowKey(x) + ":" + groups[gi], ...c })).filter((c) => c.n > 0));
  const check = {
    ...checks("table1:", tested.map((x) => ({ key: table1RowKey(x), p: x.p, ...(x.q != null ? { q: x.q } : {}) })), (x) => x.key, [["p", "p"], ["q", "q"]]),
    // medians and quartiles are reported to 3 decimals
    ...checks("table1:", medians, (m) => m.key, [["median", "median", { abs: 5e-4 + 1e-9 }], ["q1", "q1", { abs: 5e-4 + 1e-9 }], ["q3", "q3", { abs: 5e-4 + 1e-9 }]]),
  };
  return { steps, python, check };
}
