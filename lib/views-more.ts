// View kinds beyond the original thirteen: attrition, genome, pathways, diffexpr, paired,
// clonality, incidence and labs. runAnalysis (lib/analysis.ts) evaluates the cohorts and
// resolvers exactly as for every other view and hands them here, so these views count,
// federate and disclose under the same rules — they just live in their own module rather
// than growing that file's if/else chain further.
import type { AnalysisDoc, CohortDef, ViewResult, ViewParticipation, AttritionView, AttritionPanel,
  GenomeView, GenomeSeries } from "./types.ts";
import { cohortClauses, describeClause } from "./cohort2.ts";
import { hasMoreAggregates, type Resolver, type MoreAggregateCapable } from "./federation.ts";
import { genomeBinsSql, genomeCoverageSql, studyGenomeSql, CHROM_LENGTHS, GENOME_CHROMS } from "./federation-more.ts";
import { fisherExact, benjaminiHochberg } from "./stats.ts";
import { viewToSvg } from "./view-svg.ts";

export interface EvaluatedCohort {
  studies: string[];
  perStudy: Record<string, { sql: string; count: number; mode: string }>;
  count: number;
  text: string;
}

/** Everything a view runner needs from runAnalysis, and nothing it could use to bypass it. */
export interface ViewCtx {
  doc: AnalysisDoc;
  cohorts: Record<string, EvaluatedCohort>;
  resolvers: Record<string, Resolver>;
  /** the cohorts this view reads, in document order */
  vNames: string[];
  /** every study those cohorts span */
  vStudies: string[];
  participationFor: (studies: string[], requiresPatientLevel: boolean) => ViewParticipation;
  pin: string | null;
  overLimit: (what: string, max: number, given: number) => string | null;
}

export const MORE_VIEW_KINDS = ["attrition", "genome"] as const;

export function isMoreViewKind(kind: unknown): boolean {
  return (MORE_VIEW_KINDS as readonly string[]).includes(String(kind));
}

export async function runMoreView(view: { kind: string }, ctx: ViewCtx): Promise<ViewResult> {
  let r: ViewResult;
  try {
    if (view.kind === "attrition") r = await attritionView(view as AttritionView, ctx);
    else if (view.kind === "genome") r = await genomeView(view as GenomeView, ctx);
    else r = { kind: view.kind, error: "unknown view kind" };
  } catch (e) {
    r = { kind: view.kind, cohorts: ctx.vNames, error: (e as Error).message };
  }
  if (!r.error && !r.svg) r.svg = viewToSvg(r) || undefined;
  return r;
}

// ---------------------------------------------------------------------------
// attrition: how each cohort's clauses narrow the study, one step at a time

const ATTRITION_COHORT_LIMIT = 6;

/**
 * Every clause of `all` is ANDed, so the running count after the first k clauses is the cohort
 * a reader would get by stopping there. Each prefix is evaluated as its own cohort definition —
 * the same compiler, the same per-study counts — so the last step is the cohort's own count by
 * construction, not a separate calculation that could disagree with it.
 */
async function attritionView(view: AttritionView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  const e = ctx.overLimit("an attrition view", ATTRITION_COHORT_LIMIT, vNames.length);
  if (e) return { kind: "attrition", error: e.replace("at most " + ATTRITION_COHORT_LIMIT, "at most " + ATTRITION_COHORT_LIMIT + " cohorts") };
  const queries: NonNullable<ViewResult["queries"]> = [];
  const panels: AttritionPanel[] = await Promise.all(vNames.map(async (name) => {
    const def = doc.cohorts[name];
    const clauses = cohortClauses(def);
    const prefix = (k: number): CohortDef => ({ ...(def || {}), all: clauses.slice(0, k), a: undefined, b: undefined, rel: undefined });
    const studies = cohorts[name].studies;
    const countAt = async (k: number): Promise<number> => {
      const per = await Promise.all(studies.map(async (st) => {
        const n = await resolvers[st].count(prefix(k));
        // count() is not a logged aggregate (cohort sizes are provenance of their own), so the
        // step's query is recorded here — after the count, because a remote peer only reports
        // its compiled SQL once it has answered.
        queries.push({ study: st, label: "attrition:" + name + ":step " + k,
          sql: "SELECT count() AS n FROM (" + resolvers[st].cohortSql(prefix(k)) + ")",
          ...(resolvers[st].instance.id === "peer" ? { remote: true } : {}) });
        return n;
      }));
      return per.reduce((a, b) => a + b, 0);
    };
    const counts = await Promise.all([0, ...clauses.map((_, i) => i + 1)].map(countAt));
    const base = counts[0];
    const steps = clauses.map((c, i) => ({
      label: describeClause(c),
      n: counts[i + 1],
      excluded: counts[i] - counts[i + 1],
      pctOfBase: base ? Math.round(1000 * counts[i + 1] / base) / 10 : null
    }));
    return { cohort: name, base, steps, studies };
  }));
  const mismatched = panels.filter((p) => (p.steps.length ? p.steps[p.steps.length - 1].n : p.base) !== cohorts[p.cohort].count);
  const multi = vStudies.length > 1;
  return {
    kind: "attrition", cohorts: vNames, attrition: panels,
    queries: queries.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })),
    participation: ctx.participationFor(vStudies, false),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Each step counts the patients left after ANDing that clause onto every clause above it, in the order the " +
      "cohort lists them. The order changes the path, never the final count: reorder the clauses to see a different " +
      "attrition sequence. Each view further drops patients who lack its own data (survival without follow-up, genes " +
      "never profiled), and says how many in its own caption." +
      (multi ? " Counts are summed across " + vStudies.length + " studies; patient overlap across studies is NOT deduplicated." : "") +
      (mismatched.length ? " WARNING: the last step for " + mismatched.map((p) => p.cohort).join(", ") +
        " does not equal that cohort's own count — the definition was evaluated twice and gave two answers." : "")
  };
}

// ---------------------------------------------------------------------------
// shared: which participants can answer a lib/federation-more.ts aggregate

type MoreResolver = Resolver & MoreAggregateCapable;

/**
 * Split the view's studies into those that can answer (every local participant) and those that
 * cannot (a remote MCP peer, which does not serve these aggregates yet). The second list is
 * reported by the view, never silently dropped.
 */
function answering(ctx: ViewCtx): { ok: Record<string, MoreResolver>; excluded: { study: string; reason: string }[] } {
  const ok: Record<string, MoreResolver> = {};
  const excluded: { study: string; reason: string }[] = [];
  for (const st of ctx.vStudies) {
    const r = ctx.resolvers[st];
    if (hasMoreAggregates(r)) ok[st] = r;
    else excluded.push({ study: st, reason: "a remote peer, which does not serve this view's aggregates yet" });
  }
  return { ok, excluded };
}

const plural = (n: number, one: string, many = one + "s") => n.toLocaleString("en-US") + " " + (n === 1 ? one : many);

/** A view-level refusal: past a limit, or nothing that can answer. */
const refuse = (kind: string, ctx: ViewCtx, error: string): ViewResult => ({ kind, cohorts: ctx.vNames, error });

// ---------------------------------------------------------------------------
// genome: genome-wide copy-number frequency from segments

const GENOME_COHORT_LIMIT = 4;

async function genomeView(view: GenomeView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const lim = ctx.overLimit("a genome view", GENOME_COHORT_LIMIT, vNames.length);
  if (lim) return refuse("genome", ctx, lim.replace("at most " + GENOME_COHORT_LIMIT, "at most " + GENOME_COHORT_LIMIT + " cohorts"));
  const binMb = view.binMb == null ? 2 : Number(view.binMb);
  if (!Number.isFinite(binMb) || binMb < 1 || binMb > 50)
    return refuse("genome", ctx, "binMb must be a number of megabases from 1 to 50; got " + String(view.binMb).slice(0, 20));
  const threshold = view.threshold == null ? 0.2 : Number(view.threshold);
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 2)
    return refuse("genome", ctx, "threshold is a |log2 segment mean| from 0.05 to 2; got " + String(view.threshold).slice(0, 20));
  const includeX = view.includeX === true;
  const binBp = Math.round(binMb * 1e6);

  const { ok, excluded } = answering(ctx);
  // Bins are genome coordinates, and hg19 and hg38 put the same base in different places, so
  // two builds cannot share one axis: refused, naming which study is on which.
  const builds: Record<string, string> = {};
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.moreMeta("genome:build", studyGenomeSql);
    builds[st] = String(rows[0]?.build || "unknown");
  }));
  const distinct = [...new Set(Object.values(builds))];
  if (distinct.some((b) => b !== "hg19" && b !== "hg38"))
    return refuse("genome", ctx, "no chromosome lengths for reference genome " +
      Object.entries(builds).filter(([, b]) => b !== "hg19" && b !== "hg38").map(([st, b]) => st + " (" + b + ")").join(", "));
  if (distinct.length > 1)
    return refuse("genome", ctx, "these studies are on different reference genomes, so their bins are not the same places: " +
      Object.entries(builds).map(([st, b]) => st + " " + b).join(", ") + " — draw each build in its own view");
  const build = (distinct[0] || "hg19") as "hg19" | "hg38";

  // the shared bin axis
  const chroms = GENOME_CHROMS.filter((c) => includeX || c !== "X");
  const bins: { chrom: string; start: number }[] = [];
  const offset: Record<string, number> = {}, nBins: Record<string, number> = {};
  for (const c of chroms) {
    offset[c] = bins.length;
    nBins[c] = Math.ceil(CHROM_LENGTHS[build][c] / binBp);
    for (let k = 0; k < nBins[c]; k++) bins.push({ chrom: c, start: k * binBp });
  }

  let pastEnd = 0;
  const series: GenomeSeries[] = [];
  const noSegments: string[] = [];
  for (const name of vNames) {
    const ser: GenomeSeries = { cohort: name, samples: 0, segmented: 0,
      profiled: new Array(bins.length).fill(0), gain: new Array(bins.length).fill(0), loss: new Array(bins.length).fill(0) };
    await Promise.all(cohorts[name].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[name];
      const [cov, rows] = await Promise.all([
        ok[st].moreAggregate("genome:coverage:" + name, def, genomeCoverageSql),
        ok[st].moreAggregate("genome:bins:" + name, def, (c, s, d) => genomeBinsSql(c, s, d, { binBp, threshold, includeX }))
      ]);
      ser.samples += Number(cov[0]?.samples || 0);
      const segd = Number(cov[0]?.segmented || 0);
      ser.segmented += segd;
      if (!segd && (cohorts[name].perStudy[st]?.count || 0) > 0) noSegments.push(st);
      for (const row of rows) {
        const c = String(row.chrom), k = Number(row.bin);
        if (!(c in offset)) continue;
        if (k >= nBins[c]) { pastEnd++; continue; }
        const i = offset[c] + k;
        ser.profiled[i] += Number(row.profiled); ser.gain[i] += Number(row.gain); ser.loss[i] += Number(row.loss);
      }
    }));
    series.push(ser);
  }
  for (const st of [...new Set(noSegments)]) excluded.push({ study: st, reason: "no copy-number segments" });
  if (!series.some((s) => s.segmented))
    return refuse("genome", ctx, "no sample in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
      " has copy-number segments" + (excluded.length ? " (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")" : "") +
      " — segments exist for 311 of the warehouse's studies, not every one");

  let test: { gainQ: (number | null)[]; lossQ: (number | null)[]; significantGain: number; significantLoss: number } | undefined;
  if (series.length === 2) {
    const [A, B] = series;
    const qFor = (which: "gain" | "loss"): (number | null)[] => {
      const idx: number[] = [], ps: number[] = [];
      for (let i = 0; i < bins.length; i++) {
        if (!A.profiled[i] || !B.profiled[i]) continue;
        const a = A[which][i], c = B[which][i];
        idx.push(i); ps.push(fisherExact(a, A.profiled[i] - a, c, B.profiled[i] - c));
      }
      const q: (number | null)[] = new Array(bins.length).fill(null);
      benjaminiHochberg(ps).forEach((v, j) => { q[idx[j]] = v; });
      return q;
    };
    const gainQ = qFor("gain"), lossQ = qFor("loss");
    test = { gainQ, lossQ,
      significantGain: gainQ.filter((q) => q != null && q < 0.05).length,
      significantLoss: lossQ.filter((q) => q != null && q < 0.05).length };
  }

  const segmented = series.reduce((n, s) => n + s.segmented, 0), samples = series.reduce((n, s) => n + s.samples, 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "genome", cohorts: vNames,
    genome: { build, binMb, threshold, includeX, bins, series, ...(test ? { test } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Share of each cohort's segmented SAMPLES (not patients: a patient with two segmented samples counts twice) " +
      "gained (log2 segment mean ≥ " + threshold + ") or lost (≤ −" + threshold + ") in each " + binMb + " Mb bin, " + build + ". " +
      "Each bin's denominator is the samples whose segmentation covers it; a bin takes the value of the segment over its " +
      "midpoint, so an event narrower than " + binMb + " Mb can be missed — use a smaller binMb to find it. " +
      segmented.toLocaleString("en-US") + " of " + plural(samples, "sample") + " have segments." +
      " Thresholds on a log ratio are not purity- or ploidy-corrected: a low-purity tumour's real loss can sit inside ±" + threshold + "." +
      (includeX ? " Chromosome X is drawn, and in male patients its log ratio can read as a loss against a female reference." : " Chromosome X is not drawn (includeX: true adds it).") +
      (test ? " Per-bin two-sided Fisher tests, Benjamini–Hochberg across bins separately for gains and losses; adjacent bins are not independent, so read a run of significant bins as one region, not many findings." : "") +
      (pastEnd ? " " + plural(pastEnd, "segment bin") + " lay past a chromosome's end and were not drawn." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
