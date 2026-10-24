// The method record: what a view computed between its SQL and its numbers, built from the
// values the computation itself used, on every run.
//
// A view's queries say what was fetched; this says what was then done to the rows — which were
// dropped and why, how each covariate was coded and against which reference level, which model
// was fitted with which settings, and how the fit went — plus a Python script that refits the
// same model with a standard library. Each builder below takes the same variables the fit was
// given, so the record cannot describe a different computation from the one that ran.
//
// Browser-safe: no I/O, so the analysis page can import its types.

import type { CoxCovariate } from "./types.ts";
import type { AxisKind } from "./plot.ts";
import { OQL_UNALTERED } from "./plot-oql.ts";

export interface MethodStep {
  kind: "fetch" | "transform" | "statistic";
  title: string;
  detail: string;
  /** the study a fetch ran against, or the cohort a per-cohort fit belongs to */
  scope?: string;
  rowsIn?: number;
  rowsOut?: number;
  /** ordered name/value pairs: a fit's settings, or one line per model term */
  params?: [string, string][];
}

export interface MethodRecord {
  steps: MethodStep[];
  implementation: { functions: string[]; file: string; commit: string | null };
  /** the reference implementation this one is tested against, and the test that does it */
  verification?: string;
  /** a script that recomputes the view's numbers from what its queries returned; absent when the
   *  queries' own counts are the numbers, with nothing computed from them */
  python?: string;
  /** the script exists but was left out of this response (the page's requests): POST the view's
   *  one-view document to /api/analysis/method for it */
  pythonDeferred?: true;
  /** the view's own numbers that the script must reproduce, by the name the script reports them
   *  under — scripts/check-method-scripts.ts runs every gallery example's script and compares */
  check?: Record<string, CheckValue>;
}

/** One number a script must reproduce: within `abs` of it (default 1e-300, so a p-value below that
 *  counts as zero), or within `rel` of it (default 1e-6), whichever is looser. */
export interface CheckValue { v: number | null; rel?: number; abs?: number }

/** The line a script's last output starts with, followed by its RESULT as JSON. */
export const RESULT_MARKER = "METHOD_RESULT ";

export const RESULT_INIT = "RESULT = {}  # the numbers the automated check compares with the view's (printed at the end)";

/** The end of every script: RESULT as one machine-readable line, NaN and infinities as null. */
export function withResult(python: string): string {
  return python.trimEnd() + "\n\n" + [
    "# for the check that this script reproduces the view (scripts/check-method-scripts.ts)",
    "import json as _json, math as _math",
    "def _num(x):",
    "    try:",
    "        x = float(x)",
    "    except (TypeError, ValueError):",
    "        return None",
    "    return None if _math.isnan(x) or _math.isinf(x) else x",
    "print(" + JSON.stringify(RESULT_MARKER) + " + _json.dumps({k: _num(v) for k, v in RESULT.items()}))",
  ].join("\n") + "\n";
}

/** check entries for a list of named results, each field with its own tolerance */
export function checks(prefix: string, rows: Record<string, unknown>[], keyOf: (r: any) => string,
  fields: [string, string, { rel?: number; abs?: number }?][]): Record<string, CheckValue> {
  const out: Record<string, CheckValue> = {};
  for (const r of rows) for (const [field, name, tol] of fields) {
    const v = (r as any)[field];
    if (v === undefined) continue;
    out[prefix + keyOf(r) + ":" + name] = { v: v == null || !Number.isFinite(Number(v)) ? null : Number(v), ...(tol || {}) };
  }
  return out;
}

/**
 * The library releases test/regression-golden.test.ts compares our fits against. That test
 * asserts these equal the versions recorded in its fixture, so this claim cannot drift from
 * what was actually checked.
 */
export const VERIFIED = {
  cox: { library: "lifelines", version: "0.30.3", fn: "CoxPHFitter", ties: "Efron" },
  logistic: { library: "statsmodels", version: "0.15.0", fn: "Logit" },
  km: { library: "lifelines", version: "0.30.3", fn: "KaplanMeierFitter" },
  logrank: { library: "statsmodels", version: "0.15.0", fn: "survdiff" },
  fisher: { library: "scipy", version: "1.18.1", fn: "fisher_exact" },
  chi2: { library: "scipy", version: "1.18.1", fn: "chi2_contingency" },
  bh: { library: "statsmodels", version: "0.15.0", fn: "multipletests(method=\"fdr_bh\")" },
  cmh: { library: "statsmodels", version: "0.15.0", fn: "StratifiedTable" },
  welch: { library: "scipy", version: "1.18.1", fn: "ttest_ind(equal_var=False)" },
  anova: { library: "statsmodels", version: "0.15.0", fn: "anova_generic(use_var=\"unequal\")" },
  ranks: { library: "scipy", version: "1.18.1", fn: "mannwhitneyu / kruskal" },
  pearson: { library: "scipy", version: "1.18.1", fn: "pearsonr" },
  meta: { library: "statsmodels", version: "0.15.0", fn: "combine_effects (fixed effect)" },
  gsea: { library: "gseapy", version: "1.3.1", fn: "prerank" },
  cif: { library: "statsmodels", version: "0.15.0", fn: "CumIncidenceRight" },
  mcnemar: { library: "statsmodels", version: "0.15.0", fn: "mcnemar(exact=True)" },
} as const;
export const GOLDEN_TEST = "test/regression-golden.test.ts";

/** One dummy-coded or numeric model term, as buildCoxColumns produced it. */
export interface MethodColumn { axisIndex: number; label: string; reference?: string; level?: string }

/** What one fit was given and what came back — everything the record is built from. */
export interface FitTrace {
  /** the cohort this fit belongs to, when each cohort is fitted separately */
  scope?: string;
  /** per study: patients in the cohort there, and rows its query returned */
  /** each study's cohort patients, rows fetched, and patients left out as not profiled for an axis's gene */
  perStudy: { study: string; cohortPatients: number; rows: number; notProfiled?: number }[];
  covariates: CoxCovariate[];
  kinds: AxisKind[];
  columns: MethodColumn[];
  /** the design matrix exactly as fitted, for per-term counts */
  x: number[][];
  fit: { n: number; events: number; iterations: number; loglik: number };
}

export interface CoxTrace extends FitTrace {
  censoredAtCutoff: number;
  droppedBadTime: number;
  /** what the fit reported, per term — for the script check */
  coefficients: { label: string; beta: number; se: number; p: number }[];
}

export const plural = (n: number, one: string, many = one + "s") => n.toLocaleString() + " " + (n === 1 ? one : many);
export const py = (s: string) => JSON.stringify(s);
/** Text for a `#` comment: a line break in a cohort name or a value would end the comment and run the rest. */
export const pyComment = (s: unknown) => String(s).replace(/[\r\n]+/g, " ");

/** Why a categorical covariate's reference level is the one it is — mirrors buildCoxColumns. */
function referenceReason(cov: CoxCovariate, reference: string): string {
  if (cov.reference && cov.reference === reference) return "declared in the view";
  const absentLevel = cov.source !== "alteration" ? undefined
    : "oql" in cov ? OQL_UNALTERED : (cov.by === "mutated" || cov.by === undefined) ? "Not mutated" : undefined;
  const fallback = absentLevel && reference === absentLevel
    ? (absentLevel === OQL_UNALTERED ? "the fixed default for an OQL axis" : "the fixed default for a mutated-vs-not axis")
    : "the most frequent level";
  return cov.reference ? "declared “" + cov.reference + "” was never observed, so " + fallback : fallback;
}

export function fetchSteps(t: FitTrace, query: string, keep: string): MethodStep[] {
  return t.perStudy.map((s) => ({
    kind: "fetch" as const,
    title: "Fetch one row per patient",
    detail: "The " + query + " query above. " + keep + " " +
      (s.cohortPatients > s.rows ? plural(s.cohortPatients - s.rows, "cohort patient") + " had no row" +
        (s.notProfiled ? ", " + s.notProfiled.toLocaleString("en-US") + " of them because " + (s.notProfiled === 1 ? "it was" : "they were") +
          " not profiled for the gene of an axis (a value of “Not profiled” is left out, never fitted as a level)" : "") + "." : "Every cohort patient had a row."),
    scope: s.study,
    rowsIn: s.cohortPatients,
    rowsOut: s.rows,
  }));
}

export function codingStep(t: FitTrace): MethodStep {
  const params: [string, string][] = t.columns.map((col, i) => {
    const source = "c" + col.axisIndex;
    if (t.kinds[col.axisIndex] === "num") return [col.label, "numeric, as fetched (" + source + ")"];
    const ones = t.x.reduce((n, row) => n + (row[i] === 1 ? 1 : 0), 0);
    return [col.label, "1 if " + source + " = “" + col.level + "”, else 0 · " + ones.toLocaleString() + " of " +
      t.x.length.toLocaleString() + " patients · reference “" + col.reference + "”: " + referenceReason(t.covariates[col.axisIndex], col.reference!)];
  });
  return {
    kind: "transform",
    title: "Code the covariates",
    detail: "Each numeric covariate is one term. Each categorical covariate becomes one 0/1 term per level, measured against a reference level that gets no term.",
    ...(t.scope ? { scope: t.scope } : {}),
    params,
  };
}

/** pandas columns for the design matrix, one line per term */
export function pyTerms(t: FitTrace, indent: string): string {
  return t.columns.map((col) => {
    const c = py("c" + col.axisIndex);
    return indent + py(col.label) + ": " + (t.kinds[col.axisIndex] === "num"
      ? "df[" + c + "].astype(float),"
      : "(df[" + c + "] == " + py(col.level!) + ").astype(float),  # reference: " + pyComment(col.reference));
  }).join("\n");
}

export function pyCategoricalDtypes(t: FitTrace, extra: string[] = []): string {
  const cols = [...extra, ...t.kinds.map((k, i) => k === "num" ? null : "c" + i).filter((c): c is string => !!c)];
  return cols.length ? ", dtype={" + cols.map((c) => py(c) + ": str").join(", ") + "}" : "";
}

// ---- aggregate inputs, embedded in a script ---------------------------------------------------
// The aggregate views' inputs are counts with no identifiers in them, so a script can carry them
// and run as is. Past this many rows it names the query instead of inlining a table that size.

export const INLINE_ROWS_MAX = 20000;

function csvField(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
}

/** `name = pd.read_csv(...)`: inline when small enough, else from a file the reader exports. */
export function pyTable(name: string, what: string, columns: string[], rows: (string | number | null | undefined)[][], file: string): string[] {
  if (rows.length > INLINE_ROWS_MAX) {
    return ["# " + pyComment(what) + " — " + rows.length.toLocaleString() + " rows, too many to include here: export them as " + pyComment(file),
      "# with columns " + pyComment(columns.join(", ")) + ".",
      name + " = pd.read_csv(" + py(file) + ")"];
  }
  // each CSV line is its own string literal, so no value in the data can end the string
  return ["# " + pyComment(what) + ".",
    name + " = pd.read_csv(io.StringIO(\"\\n\".join([",
    "    " + py(columns.map(csvField).join(",")) + ",",
    ...rows.map((r) => "    " + py(r.map(csvField).join(",")) + ","),
    "])))"];
}

export const pFmt = (p: number) => p === 0 ? "<1e-300" : p < 1e-4 ? p.toExponential(2) : p.toPrecision(3);

// ---- compare: per-gene alteration frequency, Fisher / chi-squared, Benjamini-Hochberg ---------

/** What "altered" and "driver" mean in every gene count, stated once for the views that use them. */
export const ALTERED_MEANING = "altered: any mutation or structural variant, or a copy-number change of ±2 (amplification or deep deletion)";
export const driverMeaning = (pin: string | null) => pin
  ? "driver: an alteration OncoKB calls oncogenic, from the OncoKB release pinned for this run (" + pin + ")"
  : "driver: no OncoKB release is pinned, so no alteration is counted as a driver";

// ---- table views: listings, nothing computed ----------------------------------------------------

export type TableLists = { cohort: string; study: string; total: number; all: number }[];

/** The steps every table view shares after its count: what the query keeps, its order, the page. */
export function tableSteps(t: { label: string; what: string; queryText: string; order: string; shown: number; lists: TableLists; instances: number; excluded: { study: string }[]; source: string }): MethodStep[] {
  return [{
    kind: "fetch" as const, title: "Count the " + t.what + " per cohort and study" + (t.queryText ? ", and those the query keeps" : ""),
    detail: "The " + t.label + ":counts query above: " + t.source + (t.queryText ? " The query keeps " + t.queryText + "." : ""),
    params: t.lists.map((l) => [l.cohort + " · " + l.study, (t.queryText ? l.total.toLocaleString("en-US") + " of " : "") + l.all.toLocaleString("en-US")] as [string, string]),
  }, {
    kind: "fetch" as const, title: "Sort them together and take one page",
    detail: "The " + t.label + ":rows query above: the " + t.what + " of every cohort and study combined in one query" + (t.instances > 1 ? " per database (" + t.instances + " here, listed in turn)" : "") +
      (t.queryText ? ", kept to " + t.queryText : "") + ", sorted " + t.order + ", and the " + t.shown + " rows of the first page taken." +
      " Every other page, and the download, is the same query at another offset." +
      (t.excluded.length ? " Studies that do not disclose patients contribute no rows and are named: " + t.excluded.map((e) => e.study).join(", ") + "." : ""),
  }];
}

