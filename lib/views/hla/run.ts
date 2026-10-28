// HLA view: class I homozygosity and HLA loss of heterozygosity per cohort, and overall survival by
// each (Chowell et al. 2018; McGranahan et al. 2017). Per-patient rows from patient-level studies.
import type { ViewResult } from "../../types.ts";
import { hasViewAggregates, isPatientLevel } from "../../federation.ts";
import { kaplanMeier, logRank, coxRegression, type SurvRecord } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, plural, refuse, ATTR_NAME } from "../shared.ts";
import type { HlaView, HlaPanel, HlaSplit, HlaHr, HlaResult } from "./types.ts";
import { hlaRowsSql, hlaAttributesSql } from "./sql.ts";
import type { HlaRowsOpts } from "./sql.ts";

const LOCI = ["A", "B", "C"] as const;
/** fewer patients than this in either group and that split is not drawn */
const KM_MIN_GROUP = 5;
/** a categorical covariate keeps its commonest levels, the rest pooled as "other" */
const COV_MAX_LEVELS = 10;
const LOH_DEFAULT = ["HLA_A1_LOH", "HLA_A2_LOH", "HLA_B1_LOH", "HLA_B2_LOH", "HLA_C1_LOH", "HLA_C2_LOH", "HLA_LOH"];
const LOSS_DEFAULT = ["Loss", "Yes", "LOH", "True"];

/** the allele layouts the public studies use: HLA-A1/HLA-A2 (MSK-IMPACT), HLA_A1_ALLELE(S) (NSCLC), HLA_A = "A0201/A2402" (melanoma) */
const defaultLocus = (x: string) => ({
  first: ["HLA-" + x + "1", "HLA_" + x + "1", "HLA_" + x + "1_ALLELE", "HLA_" + x + "1_ALLELES"],
  second: ["HLA-" + x + "2", "HLA_" + x + "2", "HLA_" + x + "2_ALLELE", "HLA_" + x + "2_ALLELES"],
  pair: ["HLA_" + x, "HLA-" + x],
});

/** one patient: homozygous per locus (null: not typed there), typed fields, HLA LOH (null: no call), the endpoint, covariates */
export interface HlaRec {
  hom: (number | null)[]; nf: number | null; loss: number | null;
  t: number | null; ev: number; cov: (string | null)[]; study: string;
}

const hrOf = (rows: { t: number; event: number; x: number[]; stratum?: string }[]): HlaHr | null => {
  if (!rows.length) return null;
  try {
    const f = coxRegression(rows);
    if (!Number.isFinite(f.hr[0]) || !Number.isFinite(f.ciLow[0])) return null;
    return { hr: f.hr[0], ciLow: f.ciLow[0], ciHigh: f.ciHigh[0], p: f.p[0], n: f.n, events: f.events };
  } catch { return null; }
};

/** covariate columns: a numeric covariate as it is; a categorical one as indicators against its commonest level */
export function covariateColumns(recs: HlaRec[], k: number): ((r: HlaRec) => number[])[] {
  const cols: ((r: HlaRec) => number[])[] = [];
  for (let i = 0; i < k; i++) {
    const vals = recs.map((r) => r.cov[i]);
    if (vals.every((v) => v != null && Number.isFinite(Number(v)))) { cols.push((r) => [Number(r.cov[i])]); continue; }
    const counts = new Map<string, number>();
    for (const v of vals) counts.set(String(v), (counts.get(String(v)) || 0) + 1);
    const levels = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
    const kept = levels.slice(0, COV_MAX_LEVELS), pooled = levels.length > COV_MAX_LEVELS;
    const dummies = [...kept.slice(1), ...(pooled ? ["\u0000other"] : [])];
    cols.push((r) => {
      const v = String(r.cov[i]), lv = kept.includes(v) ? v : "\u0000other";
      return dummies.map((d) => d === lv ? 1 : 0);
    });
  }
  return cols;
}

/** exposed against not: KM curves, log-rank stratified by study, Cox HR (stratified by study), and adjusted for the covariates */
export function hlaSplit(recs: HlaRec[], exposed: (r: HlaRec) => boolean, labels: [string, string], k: number, multi: boolean):
  { split: HlaSplit | null; why?: string; noCovariate: number } {
  const a = recs.filter(exposed), b = recs.filter((r) => !exposed(r));
  if (a.length < KM_MIN_GROUP || b.length < KM_MIN_GROUP)
    return { split: null, why: "fewer than " + KM_MIN_GROUP + " patients with the endpoint in a group (" + a.length + " " + labels[0] + ", " + b.length + " " + labels[1] + ")", noCovariate: 0 };
  const sv = (r: HlaRec): SurvRecord => ({ t: r.t!, event: r.ev });
  const studies = [...new Set(recs.map((r) => r.study))].sort();
  const lr = logRank(studies.map((s) => ({ a: a.filter((r) => r.study === s).map(sv), b: b.filter((r) => r.study === s).map(sv) })));
  const base = (r: HlaRec) => ({ t: r.t!, event: r.ev, ...(multi ? { stratum: r.study } : {}) });
  const hr = hrOf(recs.map((r) => ({ ...base(r), x: [exposed(r) ? 1 : 0] })));
  let adjusted: HlaHr | null = null, noCovariate = 0;
  if (k) {
    const full = recs.filter((r) => r.cov.every((c) => c != null && c !== ""));
    noCovariate = recs.length - full.length;
    const cols = covariateColumns(full, k);
    adjusted = hrOf(full.map((r) => ({ ...base(r), x: [exposed(r) ? 1 : 0, ...cols.flatMap((c) => c(r))] })));
  }
  return {
    split: { curves: [{ label: labels[0], ...kaplanMeier(a.map(sv)) }, { label: labels[1], ...kaplanMeier(b.map(sv)) }], logrank: lr, hr, adjusted },
    noCovariate,
  };
}

/** a cohort's genotype and LOH counts and its two survival splits */
export function hlaPanel(cohort: string, patients: number, recs: HlaRec[], fields: number, k: number, multi: boolean): HlaPanel {
  const typed = recs.filter((r) => r.hom.every((h) => h != null));
  const homozygous: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of typed) homozygous[r.hom.reduce((s: number, h) => s + (h || 0), 0)]++;
  const withOs = (r: HlaRec) => r.t != null && Number.isFinite(r.t);
  const homRecs = typed.filter(withOs), lohRecs = recs.filter((r) => r.loss != null && withOs(r));
  const h = hlaSplit(homRecs, (r) => r.hom.some((x) => x === 1), ["homozygous at ≥1 locus", "heterozygous at all"], k, multi);
  const l = !lohRecs.length ? { split: null, why: "no patient here has an HLA LOH call with the endpoint", noCovariate: 0 } : hlaSplit(lohRecs, (r) => r.loss === 1, ["HLA LOH", "no HLA LOH"], k, multi);
  return {
    cohort, patients,
    anyTyped: recs.filter((r) => r.hom.some((x) => x != null) || r.nf != null && r.nf < 99).length,
    typed: typed.length, homozygous,
    loci: LOCI.map((locus, i) => ({ locus, typed: recs.filter((r) => r.hom[i] != null).length, homozygous: recs.filter((r) => r.hom[i] === 1).length })),
    coarser: fields < 99 ? typed.filter((r) => r.nf != null && r.nf < fields).length : 0,
    lohEvaluated: recs.filter((r) => r.loss != null).length, loh: recs.filter((r) => r.loss === 1).length,
    byHomozygosity: h.split, ...(h.why ? { byHomozygosityWhy: h.why } : {}),
    byLoh: l.split, ...(l.why ? { byLohWhy: l.why } : {}),
    noOutcome: recs.filter((r) => !withOs(r)).length,
    noCovariate: Math.max(h.noCovariate, l.noCovariate),
  };
}

export async function runHla(view: HlaView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("an hla view", 3, vNames.length); if (e) return refuse("hla", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  const resolution = view.resolution == null ? 2 : view.resolution;
  if (resolution !== 1 && resolution !== 2 && resolution !== "full") return refuse("hla", ctx, "resolution is 1 (allele group), 2 (protein, the default) or \"full\"; got " + JSON.stringify(view.resolution).slice(0, 20));
  const fields = resolution === "full" ? 99 : resolution;
  const loci: HlaRowsOpts["loci"] = [];
  for (const x of LOCI) {
    const given = view.alleles && view.alleles[x];
    if (given == null) { loci.push(defaultLocus(x)); continue; }
    if (!Array.isArray(given) || given.length < 1 || given.length > 2) return refuse("hla", ctx, "alleles." + x + " is [first, second] attributes, or [one attribute holding both]");
    for (const a of given) if (!ATTR_NAME.test(String(a))) return refuse("hla", ctx, "alleles." + x + ": “" + String(a).slice(0, 40) + "” is not an attribute name");
    loci.push(given.length === 2 ? { first: [String(given[0])], second: [String(given[1])], pair: [] } : { first: [], second: [], pair: [String(given[0])] });
  }
  const list = (v: string[] | undefined, d: string[]) => (Array.isArray(v) && v.length ? v : d).map((x) => String(x).trim()).filter(Boolean);
  const lohAttributes = list(view.lohAttributes, LOH_DEFAULT), lohValues = list(view.lohValues, LOSS_DEFAULT);
  if (lohAttributes.length > 12 || lohValues.length > 10) return refuse("hla", ctx, "lohAttributes takes at most 12 names and lohValues at most 10 values");
  for (const a of lohAttributes) if (!ATTR_NAME.test(a)) return refuse("hla", ctx, "lohAttributes: “" + a.slice(0, 40) + "” is not an attribute name");
  for (const v of lohValues) if (!/^[A-Za-z0-9_ .:-]{1,40}$/.test(v)) return refuse("hla", ctx, "lohValues: “" + v.slice(0, 40) + "” has characters it cannot");
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return refuse("hla", ctx, "endpoint is a name like OS or PFS");
  if (!!view.monthsAttribute !== !!view.statusAttribute) return refuse("hla", ctx, "monthsAttribute and statusAttribute go together");
  const months = view.monthsAttribute ? String(view.monthsAttribute) : endpoint + "_MONTHS", status = view.statusAttribute ? String(view.statusAttribute) : endpoint + "_STATUS";
  for (const a of [months, status]) if (!ATTR_NAME.test(a)) return refuse("hla", ctx, "“" + a.slice(0, 40) + "” is not an attribute name");
  const endpointLabel = view.monthsAttribute ? months + "/" + status : endpoint;
  const covariates = list(view.covariates, []);
  { const e = overLimit("an hla view", 4, covariates.length); if (e) return refuse("hla", ctx, e.replace("at most 4", "at most 4 covariates")); }
  for (const a of covariates) if (!ATTR_NAME.test(a)) return refuse("hla", ctx, "covariates: “" + a.slice(0, 40) + "” is not an attribute name");
  const opts: HlaRowsOpts = { loci, fields, lohAttributes, lohValues, months, status, covariates };
  const multi = ctx.vStudies.length > 1;

  const panels: HlaPanel[] = [];
  const queries: NonNullable<ViewResult["queries"]> = [];
  for (const n of vNames) {
    const recs: HlaRec[] = [];
    for (const st of cohorts[n].studies) {
      const r = ctx.resolvers[st];
      if (!isPatientLevel(r) || !hasViewAggregates(r)) return refuse("hla", ctx, st + " answers in aggregate only; the HLA view fits each patient's genotype against their survival, which only a patient-level participant returns");
      const mark = r.queries.length;
      const rows = await r.viewRows("hla:rows:" + n, doc.cohorts[n], (c, s, d) => hlaRowsSql(c, s, d, opts));
      for (const q of r.queries.slice(mark)) queries.push({ study: st, label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) });
      const num = (x: unknown) => x == null ? null : Number(x);
      for (const x of rows) recs.push({
        hom: [num(x.hA), num(x.hB), num(x.hC)], nf: num(x.nf), loss: num(x.loss),
        t: num(x.m), ev: Number(x.ev) === 1 ? 1 : 0, cov: covariates.map((_, i) => x["c" + i] == null || x["c" + i] === "" ? null : String(x["c" + i])), study: st,
      });
    }
    panels.push(hlaPanel(n, cohorts[n].count, recs, fields, covariates.length, multi));
  }
  if (!panels.some((pn) => pn.anyTyped)) {
    const found: string[] = [];
    for (const st of ctx.vStudies) {
      const r = ctx.resolvers[st];
      if (!hasViewAggregates(r)) continue;
      const rows = await r.viewAggregate("hla:attributes", doc.cohorts[vNames[0]], (c, s, d) => hlaAttributesSql(c, s, d));
      found.push(st + (rows.length ? " has " + rows.map((x) => String(x.name) + " (" + x.type + ")").join(", ") : " has no attribute naming HLA"));
    }
    const lohOnly = panels.some((pn) => pn.lohEvaluated);
    return refuse("hla", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has an HLA class I allele recorded" +
      (lohOnly ? " (some have an HLA LOH call, but homozygosity needs the alleles)" : "") +
      " — looked for " + LOCI.map((x, i) => [...loci[i].first, ...loci[i].second, ...loci[i].pair].join("/")).join("; ") + ". " + found.join("; ") +
      ". Name a study's attributes with alleles: {A: [first, second], …} or {A: [both]}");
  }
  const result: HlaResult = { resolution, endpoint: endpointLabel, covariates, panels };
  const pct = (a: number, b: number) => b ? Math.round(1000 * a / b) / 10 + "%" : "—";
  const resText = resolution === 1 ? "allele group (1 field, e.g. A*02)" : resolution === 2 ? "protein level (2 fields, e.g. A*02:01)" : "every field the study records";
  return {
    kind: "hla", cohorts: vNames, hla: result, queries,
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "A locus is homozygous when its two alleles match at the " + resText + "; homozygosity is counted over patients typed at all three class I loci (HLA-A, -B, -C). " +
      panels.map((pn) => pn.cohort + ": " + plural(pn.typed, "patient") + " fully typed of " + plural(pn.patients, "patient") + ", " +
        pct(pn.homozygous[1] + pn.homozygous[2] + pn.homozygous[3], pn.typed) + " homozygous at ≥1 locus; HLA LOH in " + plural(pn.loh, "patient") + " of " + pn.lohEvaluated.toLocaleString("en-US") +
        " with a call (" + pct(pn.loh, pn.lohEvaluated) + ")" + (pn.coarser ? "; " + plural(pn.coarser, "patient") + " typed at fewer fields than asked, compared at what they have" : "")).join("; ") + ". " +
      "HLA LOH is any of " + lohAttributes.join("/") + " = " + lohValues.join("/") + " in any of the patient's samples in the cohort; a patient with no call in any of them is left out of that split, and a homozygous locus cannot show LOH (LOHHLA calls only heterozygous loci), so the LOH split is not independent of the genotype. " +
      endpointLabel + " is as each study records it, from its own origin, which is a checkpoint-blockade start only in a study of treated patients that measures from it (the melanoma immunotherapy studies do; MSK-IMPACT measures from diagnosis or sequencing). Chowell et al. report worse survival with homozygosity in patients treated with checkpoint blockade, so in a cohort not restricted to them this reads prognosis, not response. " +
      "Hazard ratios are Cox (Efron ties), exposed against not" + (multi ? ", stratified by study, with the log-rank test stratified the same way" : "") + "; " +
      (covariates.length ? "the adjusted HR adds " + covariates.join(", ") + " (a number as it is, a category as indicators against its commonest value, past the " + COV_MAX_LEVELS + " commonest pooled as other; the patient's value, or their first sample's in the cohort), on the patients with every covariate. " : "no covariates: the HR is unadjusted, and tumour mutational burden and cancer type are known to confound it. ") +
      "HLA supertypes and evolutionary divergence (HED) are not computed. " +
      (multi ? "Pooled across " + ctx.vStudies.length + " studies whose typing methods and resolutions differ. " : "") +
      "Computed from per-patient rows inside each patient-level study.",
  };
}
