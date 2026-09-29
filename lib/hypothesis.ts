// Hypotheses as documents, and campaigns as a ledger of them.
//
// A hypothesis is an ordinary Analysis document plus ONE declared primary result — the
// single number that decides it. Declaring it up front is what makes multiplicity
// countable: a compare view over six genes is six tests, and a hypothesis that could be
// "supported" by whichever of them came out best is not a hypothesis. The campaign then
// owns everything a generator could otherwise bend: which half of the patients the test
// runs on (the engine's `split` leaf), the correction across every locked hypothesis, and
// the replication step. Pure and browser-safe; the ledger is lib/campaign.ts.
import { benjaminiHochberg } from "./stats.ts";
import type { AnalysisDoc, AnalysisResult, ClinicalCell, CohortDef, ViewResult } from "./types.ts";

export type Primary =
  /** one gene's alteration frequency, first cohort vs second, from a compare view */
  | { view: number; stat: "compare"; gene: string; measure?: "any" | "driver" }
  /** the log-rank test of a two-cohort survival view */
  | { view: number; stat: "survival" }
  /** one attribute's test in a clinical view */
  | { view: number; stat: "clinical"; attribute: string }
  /** one coefficient of a cox view, matched by its label ("TP53", "GENDER: Male") */
  | { view: number; stat: "cox"; term: string };

/** first cohort relative to the second (compare/clinical/survival), or hazard ratio > 1 (cox) */
export type Direction = "higher" | "lower" | "any";

export interface Hypothesis {
  /** the claim in plain language, as a researcher would say it */
  statement: string;
  /** why it was proposed — literature, mechanism, a hunch — never evidence from this data */
  rationale?: string;
  doc: AnalysisDoc;
  primary: Primary;
  direction?: Direction;
}

export interface Outcome {
  ok: boolean;
  /** why no p-value exists: a refused test, a missing gene row, a view error */
  reason?: string;
  p?: number;
  /** which way the data points, in the same terms as Direction */
  observed?: "higher" | "lower" | null;
  /** false when a directional hypothesis came out the other way — then it is not supported, whatever p says */
  directionOk?: boolean;
  /** one line a researcher can read: "21.9% vs 10.2%", "HR 1.42 (1.10–1.83)" */
  effect?: string;
  n?: Record<string, number>;
}

export const MIN_ARM = 25;

// ---- identity ---------------------------------------------------------------------------

/** JSON with object keys sorted at every depth: two spellings of one test hash alike. */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonicalJson).join(",") + "]";
  if (x && typeof x === "object")
    return "{" + Object.keys(x as object).sort()
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalJson((x as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(x);
}

/** What the test IS — document, primary result, direction. The prose statement is not part of it. */
export function testIdentity(h: Hypothesis): string {
  return canonicalJson({ doc: h.doc, primary: h.primary, direction: h.direction || "any" });
}

// ---- validation and the held-out split ----------------------------------------------------

function hasSplit(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(hasSplit);
  if (x && typeof x === "object") {
    if ((x as { kind?: string }).kind === "split") return true;
    return Object.values(x as object).some(hasSplit);
  }
  return false;
}

/** Cohort names a primary result compares, in order: the view's own list, else the document's. */
export function primaryCohorts(h: Hypothesis): string[] {
  const v = (h.doc.views || [])[h.primary.view] as { cohorts?: string[] } | undefined;
  return v?.cohorts && v.cohorts.length ? v.cohorts : Object.keys(h.doc.cohorts || {});
}

/** Structural checks that need no data. Throws with what is wrong, never repairs. */
export function validateHypothesis(h: Hypothesis): void {
  if (!h || typeof h !== "object") throw new Error("hypothesis must be an object");
  if (!String(h.statement || "").trim()) throw new Error("hypothesis needs a plain-language statement");
  if (!h.doc || typeof h.doc !== "object" || !h.doc.cohorts) throw new Error("hypothesis needs an Analysis document with cohorts");
  if (hasSplit(h.doc)) throw new Error("the held-out split is owned by the campaign — remove split clauses from the document");
  const views = h.doc.views || [];
  const p = h.primary;
  if (!p || typeof p.view !== "number" || !views[p.view]) throw new Error("primary.view must index one of the document's views");
  const kind = (views[p.view] as { kind: string }).kind;
  if (kind !== p.stat) throw new Error(`primary.stat is "${p.stat}" but view ${p.view} is a ${kind} view`);
  if (p.stat === "compare" && !p.gene) throw new Error("a compare primary names its gene");
  if (p.stat === "clinical" && !p.attribute) throw new Error("a clinical primary names its attribute");
  if (p.stat === "cox" && !p.term) throw new Error("a cox primary names its coefficient term");
  if (p.stat !== "cox" && primaryCohorts(h).length !== 2)
    throw new Error(`a ${p.stat} primary compares exactly two cohorts (this view has ${primaryCohorts(h).length})`);
  if (h.direction && !["higher", "lower", "any"].includes(h.direction)) throw new Error('direction is "higher", "lower" or "any"');
}

/** The same document restricted to one half of every study's patients. */
export function withSplit(doc: AnalysisDoc, part: "discovery" | "validation"): AnalysisDoc {
  const cohorts: Record<string, CohortDef> = {};
  for (const [name, raw] of Object.entries(doc.cohorts || {})) {
    const def: CohortDef = raw && (raw as CohortDef).a && (raw as CohortDef).rel && !(raw as CohortDef).all
      ? { all: [raw as never] } : { ...(raw as CohortDef) };
    const all = [...(def.all || [])];
    if (all.length >= 8) throw new Error(`cohort "${name}" uses all 8 clauses, leaving no room for the held-out split`);
    cohorts[name] = { ...def, all: [...all, { kind: "split", part }] };
  }
  return { ...doc, cohorts };
}

// ---- reading the primary result ------------------------------------------------------------

/** The value whose share differs most between the two cohorts: "Never: 5.1% vs 14.2%". */
function categoricalEffect(a: ClinicalCell, b: ClinicalCell, test?: string): string {
  const share = (c: ClinicalCell, v: string) => c.n ? 100 * (c.top?.find((x) => x.v === v)?.n ?? 0) / c.n : 0;
  // `top` lists only the commonest values, so a value missing from one list has an unknown share,
  // not a share of zero: compare only values both lists carry
  const inB = new Set((b.top || []).map((x) => x.v));
  const values = (a.top || []).map((x) => x.v).filter((v) => v !== "" && inB.has(v));
  if (!values.length) return test || "";
  const v = values.reduce((best, x) => Math.abs(share(a, x) - share(b, x)) > Math.abs(share(a, best) - share(b, best)) ? x : best);
  return `${v}: ${share(a, v).toFixed(1)}% vs ${share(b, v).toFixed(1)}%` + (test ? ` (${test})` : "");
}

const pct = (x: number | null | undefined) => x == null ? "–" : x.toFixed(1) + "%";
const sign = (d: number): "higher" | "lower" | null => d > 0 ? "higher" : d < 0 ? "lower" : null;

function judge(h: Hypothesis, o: Omit<Outcome, "ok" | "directionOk">): Outcome {
  const want = h.direction || "any";
  return { ok: true, ...o, directionOk: want === "any" || o.observed === want };
}

export function extractPrimary(h: Hypothesis, r: AnalysisResult): Outcome {
  const p = h.primary;
  const v: ViewResult | undefined = r.views[p.view];
  const names = primaryCohorts(h);
  const n = Object.fromEntries(names.map((c) => [c, r.cohorts[c]?.count ?? 0]));
  if (!v) return { ok: false, reason: "the view did not run", n };
  if (v.error) return { ok: false, reason: v.error, n };
  if (p.stat === "compare") {
    const row = (v.rows || []).find((x) => x.gene.toUpperCase() === p.gene.toUpperCase());
    if (!row) return { ok: false, reason: `no row for ${p.gene} in the compare view`, n };
    const driver = p.measure === "driver";
    const pv = driver ? row.pDriver : row.pAny;
    const [a, b] = names.map((c) => row.cells.find((x) => x.cohort === c));
    if (pv == null || !a || !b) return { ok: false, reason: `no test for ${p.gene} (too few profiled patients?)`, n };
    const pa = driver ? a.driverPct : a.anyPct, pb = driver ? b.driverPct : b.anyPct;
    return judge(h, { p: pv, observed: sign((pa ?? 0) - (pb ?? 0)), n,
      effect: `${p.gene} ${driver ? "driver-altered" : "altered"} in ${pct(pa)} vs ${pct(pb)} (${driver ? a.driver : a.any}/${a.profiled} vs ${driver ? b.driver : b.any}/${b.profiled} profiled)` });
  }
  if (p.stat === "survival") {
    const lr = v.logrank;
    if (!lr) return { ok: false, reason: "no log-rank test (an arm below the minimum size, or not two cohorts)", n };
    const [c0, c1] = v.curves || [];
    const med = (c?: { median: number | null }) => c?.median == null ? "not reached" : c.median.toFixed(1) + " mo";
    // more events than expected in the first arm = higher hazard in the first arm
    return judge(h, { p: lr.p, observed: sign(lr.observed[0] - lr.expected[0]), n,
      effect: `median ${med(c0)} vs ${med(c1)} (${lr.observed[0]}/${lr.observed[1]} events; ${lr.observed[0] > lr.expected[0] ? "more" : "fewer"} than expected in the first arm)` });
  }
  if (p.stat === "clinical") {
    const row = (v.clinical || []).find((x) => x.attribute === p.attribute);
    if (!row) return { ok: false, reason: `no row for ${p.attribute} in the clinical view`, n };
    if (row.skipped || row.p == null) return { ok: false, reason: row.skipped || `no test for ${p.attribute}`, n };
    const [a, b] = names.map((c) => row.cells.find((x) => x.cohort === c));
    if (!a || !b) return { ok: false, reason: `${p.attribute} has no cells for both cohorts`, n };
    if (row.kind === "num")
      return judge(h, { p: row.p, observed: sign((a.mean ?? 0) - (b.mean ?? 0)), n,
        effect: `mean ${a.mean?.toFixed(2)} vs ${b.mean?.toFixed(2)} (${row.test})` });
    return judge(h, { p: row.p, observed: null, n, effect: categoricalEffect(a, b, row.test) });
  }
  const cox = v.cox;
  const coef = cox?.coefficients.find((c) => c.label === p.term) ||
    cox?.coefficients.find((c) => c.label.toUpperCase().startsWith(p.term.toUpperCase()));
  if (!coef) return { ok: false, reason: `no cox coefficient "${p.term}"${cox ? " (have: " + cox.coefficients.map((c) => c.label).join(", ") + ")" : ""}`, n };
  return judge(h, { p: coef.p, observed: sign(coef.hr - 1), n: { ...n, "cox n": cox!.n },
    effect: `HR ${coef.hr.toFixed(2)} (${coef.ciLow.toFixed(2)}–${coef.ciHigh.toFixed(2)})${coef.reference ? " vs " + coef.reference : ""}` });
}

// ---- the campaign's decision rules -----------------------------------------------------------

export interface Plan {
  /** false-discovery rate across every tested hypothesis in the campaign */
  fdr: number;
  /** a replication counts when its p is below this and it points the same way */
  replicationAlpha: number;
  minArm: number;
}
export const DEFAULT_PLAN: Plan = { fdr: 0.1, replicationAlpha: 0.05, minArm: MIN_ARM };

export type Verdict =
  | "untestable"      // rejected by the engine, or an arm too small — known before any result
  | "not-supported"   // tested; did not survive the campaign-wide correction (or pointed the wrong way)
  | "not-replicated"  // survived discovery, failed on held-out patients
  | "replicated";     // survived discovery and held up on held-out patients

export interface Scored {
  discovery?: Outcome;
  q?: number;
  validation?: Outcome;
  verdict: Verdict;
  /** what an agent reporting nominal discovery p-values would have claimed */
  naiveClaim: boolean;
}

/** Campaign-wide BH over every hypothesis that produced a discovery p-value. */
export function scoreDiscovery(outcomes: (Outcome | undefined)[], plan: Plan = DEFAULT_PLAN):
  { q?: number; promising: boolean; naiveClaim: boolean }[] {
  const idx = outcomes.map((o, i) => o?.ok && o.p != null ? i : -1).filter((i) => i >= 0);
  const qs = benjaminiHochberg(idx.map((i) => outcomes[i]!.p!));
  const q: (number | undefined)[] = outcomes.map(() => undefined);
  idx.forEach((i, k) => { q[i] = qs[k]; });
  return outcomes.map((o, i) => ({
    q: q[i],
    promising: !!o?.ok && q[i]! <= plan.fdr && o.directionOk !== false,
    naiveClaim: !!o?.ok && o.p! < 0.05
  }));
}

export function replicated(discovery: Outcome, validation: Outcome, plan: Plan = DEFAULT_PLAN): boolean {
  return validation.ok && validation.p! < plan.replicationAlpha &&
    validation.directionOk !== false && (discovery.observed == null || validation.observed === discovery.observed);
}
