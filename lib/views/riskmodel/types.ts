// The riskmodel view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRankK } from "../../types.ts";

/**
 * A lab value's course from a treatment start: % change from each patient's baseline over time
 * (median and interquartile band per bin), the best response and the share responding (e.g.
 * PSA50, PCWG3), and — from a participant entitled to patient-level values — a waterfall.
 */
/**
 * A risk model in the manner of OncoCast (Martin et al., github.com/AxelitoMartin/OncoCast): an
 * elastic-net Cox model of one cohort's survival on the genes mutated in it, fitted `runs` times
 * on random two-thirds of the patients and scored on the held-out third. Each patient's risk score
 * is the mean of the scores they got while held out; the patients are then cut into risk groups at
 * quantiles of that score (no outcome is used to place the cuts) and drawn as Kaplan–Meier curves.
 * Patient-level studies only: a model of individual patients needs their rows.
 */
export interface RiskmodelView {
  note?: string;
  kind: "riskmodel"; cohorts?: string[];
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** "any" mutation (default) or OncoKB drivers only */
  measure?: "any" | "driver";
  /** only genes mutated in at least this many patients are candidates (default 30) */
  minMutated?: number;
  /** a clinical attribute to stratify by (each stratum its own baseline hazard), e.g. CANCER_TYPE */
  strata?: string;
  /** l1 share of the penalty: 1 lasso, 0 ridge (default 0.5, elastic net) */
  alpha?: number;
  /** random splits (default 20, at most 100) */
  runs?: number;
  /** risk groups, cut at equal quantiles of the score (default 3, 2 to 5) */
  groups?: number;
  /** instead of `groups`: the quantiles of the score to cut at, increasing, each strictly between 0 and 1
   *  (1 to 4 of them, so 2 to 5 groups) — e.g. [0.8] for the top fifth against the rest, OncoCast's `cuts` */
  cuts?: number[];
  seed?: number;
  /** clinical attributes always in the model, never penalised (at most 6): numbers as they are,
   *  categories as indicators against the commonest value */
  covariates?: string[];
  /** start each patient's clock at a timeline event (as the survival view), with delayed entry */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** train on the discovery half of the engine's fixed split only, and report on the validation half */
  validate?: boolean;
  /** the volcano names the genes kept in at least this share of runs (0 to 1, default 0.5); drawn in
   *  the browser from the whole result, so changing it re-runs nothing */
  labelAbove?: number;
  /** Table 1: the risk groups' clinical and genomic makeup, tested across groups. Present, the view
   *  computes it; a list left out is the default (the study's leading attributes; the genes the
   *  model kept most often) */
  describe?: { attributes?: string[]; genes?: string[] };
  /** external validation: another cohort of the document, scored with the fitted ensemble's mean
   *  coefficients and cut at the training risk-group thresholds */
  validateOn?: string;
}

/** A risk model scored on another cohort it never saw (RiskmodelView.validateOn). */
export interface RiskExternal {
  cohort: string; study: string;
  /** patients scored, their events, and those left out with why */
  n: number; events: number;
  cohortPatients: number; rowsReturned: number;
  notProfiled: number; noStratum: number; noAnchor: number; anchorAfterStart: number; noFollowUp: number;
  /** patients whose panels do not cover every gene the model weighs: never scored as wild-type */
  notCovered: number;
  /** the model's genes with a non-zero ensemble coefficient, which every scored patient's panels cover */
  modelGenes: number;
  /** Harrell's C-index of the score (within strata), with a seeded bootstrap 95% interval */
  cIndex: number; cIndexLo: number; cIndexHi: number; bootstrap: number;
  /** the training thresholds (raw scores) the groups are cut at */
  cuts: number[];
  groups: { name: string; curve: Omit<KmCurve, "cohort">; hr: number | null; ciLow: number | null; ciHigh: number | null; p: number | null }[];
  logrank: LogRankK | null;
}

/** Why a Table 1 row differs between the risk groups by construction, or is the model's stratum. */
export type RiskTable1Role = "in the model" | "outcome" | "stratum" | null;

interface RiskTable1Test {
  /** null when the row cannot be tested (the reason in `untested`) */
  test: "chi-squared" | "Kruskal-Wallis" | null; statistic: number | null; df: number | null; p: number | null;
  /** Benjamini–Hochberg across the tested rows that are not in the model or the outcome; null for those */
  q: number | null;
  untested?: string;
}

export type RiskTable1Row =
  | ({ kind: "cat"; name: string; per: "patient" | "sample"; role: RiskTable1Role;
      /** every value recorded among the groups' patients, commonest first, with its count per group */
      levels: { value: string; counts: number[] }[];
      /** per group, patients with no value recorded */
      missing: number[];
      /** patients whose samples hold more than one value (counted under their first sample's) */
      multiValued: number; minExpected: number | null } & RiskTable1Test)
  | ({ kind: "num"; name: string; per: "patient" | "sample"; role: RiskTable1Role;
      perGroup: { n: number; median: number | null; q1: number | null; q3: number | null; missing: number }[];
      multiValued: number } & RiskTable1Test)
  | ({ kind: "gene"; name: string; role: RiskTable1Role;
      /** per group: patients with the gene mutated, patients whose panels cover it, and those whose do not */
      perGroup: { altered: number; profiled: number; notProfiled: number }[]; minExpected: number | null } & RiskTable1Test)
  | { kind: "skipped"; name: string; what: "attribute" | "gene"; skipped: string };

export interface RiskTable1 {
  /** the patients described: the same as the groups' curves */
  reportedOn: "held-out scores" | "validation half";
  groups: { name: string; n: number }[];
  /** the gene rows count mutations as the model does */
  measure: "any" | "driver";
  /** what the table holds, as a document would name it — what "Add to document" writes */
  describe: { attributes: string[]; genes: string[] };
  /** the default lists were used (no list named in the view) */
  defaults: { attributes: boolean; genes: boolean };
  rows: RiskTable1Row[];
  /** attributes the default rule considered and left out, with why */
  omitted: { name: string; why: string }[];
  /** rows in the Benjamini–Hochberg family */
  tested: number;
}

export interface RiskmodelResult {
  study: string;
  /** patients modelled, their events, and those left out with why */
  n: number; events: number;
  notProfiled: number; noStratum: number; neverHeldOut: number;
  noCovariate: number; noAnchor: number; anchorAfterStart: number; noFollowUp: number;
  /** "Treatment (FIRST)" etc. when the clock starts at a timeline event */
  anchoredTo: string | null;
  /** the always-in covariates as fitted columns (a category's indicator per non-reference level), with
   *  the share of runs they ended non-zero in (always 1 unless no variation) and their mean coefficient */
  covariates: { name: string; meanCoef: number; hr: number }[];
  /** with `validate`: the patients trained on (discovery) and reported on (validation) */
  validation: { discovery: number; validation: number; validationEvents: number; cIndex: number } | null;
  /** what the groups, table and refit below are computed on */
  reportedOn: "held-out scores" | "validation half";
  /** genes every patient was sequenced for (mutations), and of those the candidates */
  genesCovered: number; candidates: number; minMutated: number;
  strata: string | null; strataLevels: number;
  alpha: number; runs: number; seed: number; measure: "any" | "driver";
  /** test-set C-index across runs */
  cIndex: { median: number; q1: number; q3: number; values: number[] };
  /** candidates kept in at least one run, by how often: share of runs, mean coefficient where kept, patients mutated */
  features: { gene: string; selected: number; meanCoef: number; hr: number; mutated: number }[];
  groups: { name: string; from: number | null; to: number | null; curve: Omit<KmCurve, "cohort">;
    /** Kaplan-Meier survival at 12 and 36 months; null past the group's follow-up */
    at12: number | null; at36: number | null;
    /** hazard ratio against the lowest-risk group (null for that group), 95% Wald interval, p */
    hr: number | null; ciLow: number | null; ciHigh: number | null; p: number | null }[];
  logrank: LogRankK | null;
  /** a Cox model of the outcome on the risk score alone (per standard deviation of the score) */
  refit: { hr: number; ciLow: number; ciHigh: number; p: number } | null;
  /** the scores' distribution, for the histogram: bin edges and counts (raw scores) */
  histogram: { edges: number[]; counts: number[] };
  /** OncoCast's 0–10 risk score: (raw − min) / (max − min) × 10, min and max the lowest and highest of
   *  the held-out scores the cuts are placed on (with `validate`, the discovery half's — so a
   *  validation patient can fall below 0 or above 10) */
  scale: { min: number; max: number };
  /** the volcano's label threshold, as the view asked (default 0.5) */
  labelAbove: number;
  /** the quantiles the view chose to cut at; null when the groups are `groups` equal quantiles */
  cutsChosen: number[] | null;
  /** the held-out score (raw) at each whole percentile 0…100 of the scores the cuts are placed on,
   *  the rank a cut at that quantile starts from — what the risk-groups dialog places its handles by */
  percentiles: number[];
  /** with `describe`: Table 1, the groups' makeup */
  table1?: RiskTable1;
  /** with `validateOn`: the model scored on that cohort */
  external?: RiskExternal;
}

declare module "../../types.ts" {
  interface ViewSpecs { riskmodel: RiskmodelView }
  interface ViewResultFields {
    riskmodel: {
      riskmodel?: RiskmodelResult;
    };
  }
  interface ViewResultMain { riskmodel: "riskmodel" }
}
