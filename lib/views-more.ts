// View kinds beyond the original thirteen: attrition, genome, pathways, diffexpr, paired,
// clonality, incidence and labs. runAnalysis (lib/analysis.ts) evaluates the cohorts and
// resolvers exactly as for every other view and hands them here, so these views count,
// federate and disclose under the same rules — they just live in their own module rather
// than growing that file's if/else chain further.
import type { AnalysisDoc, CohortDef, ViewResult, ViewParticipation, AttritionView, AttritionPanel,
  GenomeView, GenomeSeries, PathwaysView, PathwayRow, PathwayCell, DiffexprView, DiffexprGene } from "./types.ts";
import { SANCHEZ_VEGA_2018, PATHWAY_NAMES, type PathwayRole } from "./pathways.ts";
import { cohortClauses, describeClause } from "./cohort2.ts";
import { hasMoreAggregates, type Resolver, type MoreAggregateCapable } from "./federation.ts";
import { genomeBinsSql, genomeCoverageSql, studyGenomeSql, geneSetCountsSql, profileMomentsAllSql, genesetMembersSql,
  CHROM_LENGTHS, GENOME_CHROMS } from "./federation-more.ts";
import { fisherExact, benjaminiHochberg, varianceFromMoments, welchT, preRankedGsea } from "./stats.ts";
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
  /** the molecular and generic-assay profiles a study holds (runAnalysis's cached inventory) */
  studyProfiles: (study: string) => Promise<{ profiles: string[]; gaProfiles: string[] }>;
  overLimit: (what: string, max: number, given: number) => string | null;
}

export const MORE_VIEW_KINDS = ["attrition", "genome", "pathways", "diffexpr"] as const;

export function isMoreViewKind(kind: unknown): boolean {
  return (MORE_VIEW_KINDS as readonly string[]).includes(String(kind));
}

export async function runMoreView(view: { kind: string }, ctx: ViewCtx): Promise<ViewResult> {
  let r: ViewResult;
  try {
    if (view.kind === "attrition") r = await attritionView(view as AttritionView, ctx);
    else if (view.kind === "genome") r = await genomeView(view as GenomeView, ctx);
    else if (view.kind === "pathways") r = await pathwaysView(view as PathwaysView, ctx);
    else if (view.kind === "diffexpr") r = await diffexprView(view as DiffexprView, ctx);
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

// ---------------------------------------------------------------------------
// pathways: oncogenic signalling pathways, per cohort

const GENE_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const PATHWAYS_COHORT_LIMIT = 4;

async function pathwaysView(view: PathwaysView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const lim = ctx.overLimit("a pathways view", PATHWAYS_COHORT_LIMIT, vNames.length);
  if (lim) return refuse("pathways", ctx, lim.replace("at most " + PATHWAYS_COHORT_LIMIT, "at most " + PATHWAYS_COHORT_LIMIT + " cohorts"));
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (view.measure != null && view.measure !== "any" && view.measure !== "driver")
    return refuse("pathways", ctx, "measure is \"driver\" or \"any\"; got " + JSON.stringify(view.measure).slice(0, 30));
  if (measure === "driver" && !pin)
    return refuse("pathways", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const topGenes = view.topGenes == null ? 6 : Math.floor(Number(view.topGenes));
  if (!(topGenes >= 1 && topGenes <= 12)) return refuse("pathways", ctx, "topGenes is 1 to 12; got " + String(view.topGenes).slice(0, 20));

  const chosen = view.pathways == null ? PATHWAY_NAMES : view.pathways.map(String);
  const unknown = chosen.filter((n) => !PATHWAY_NAMES.includes(n));
  if (unknown.length) return refuse("pathways", ctx, "unknown pathway " + unknown.map((u) => "“" + u.slice(0, 40) + "”").join(", ") +
    " — the canonical ten are " + PATHWAY_NAMES.join(", ") + "; use sets for your own");
  const sets = Array.isArray(view.sets) ? view.sets : [];
  { const e = ctx.overLimit("a pathways view", 4, sets.length); if (e) return refuse("pathways", ctx, e.replace("at most 4", "at most 4 custom sets")); }
  const custom: { name: string; genes: { gene: string; role: PathwayRole }[] }[] = [];
  for (const [i, x] of sets.entries()) {
    const name = String(x?.name || "").trim().slice(0, 60);
    const genes = [...new Set((Array.isArray(x?.genes) ? x.genes : []).map((g) => String(g).trim().toUpperCase()))];
    if (!name) return refuse("pathways", ctx, "set " + (i + 1) + " needs a name");
    if (!genes.length) return refuse("pathways", ctx, "set “" + name + "” has no genes");
    { const e = ctx.overLimit("a custom set", 40, genes.length); if (e) return refuse("pathways", ctx, e.replace("at most 40", "at most 40 genes") + " (set “" + name + "”)"); }
    const bad = genes.filter((g) => !GENE_SYMBOL.test(g));
    if (bad.length) return refuse("pathways", ctx, "not a gene symbol: " + bad.slice(0, 5).join(", ") + " (set “" + name + "”)");
    if (PATHWAY_NAMES.includes(name) || custom.some((c) => c.name === name)) return refuse("pathways", ctx, "two sets are named “" + name + "”");
    custom.push({ name, genes: genes.map((gene) => ({ gene, role: null })) });
  }
  const drawn = [
    ...SANCHEZ_VEGA_2018.filter((p) => chosen.includes(p.name)).map((p) => ({ ...p, source: "Sanchez-Vega 2018" as const })),
    ...custom.map((p) => ({ ...p, source: "document" as const }))
  ];
  if (!drawn.length) return refuse("pathways", ctx, "no pathway or set to draw");
  const allGenes = [...new Set(drawn.flatMap((p) => p.genes.map((g) => g.gene)))];

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("pathways", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per cohort: gene counts and set counts, summed across studies (both halves are additive)
  const geneTally = new Map<string, { profiled: number; altered: number }>();   // cohort|gene
  const setTally = new Map<string, { profiled: number; altered: number }>();    // cohort|set
  const bump = (m: Map<string, { profiled: number; altered: number }>, k: string, profiled: number, altered: number) => {
    const cur = m.get(k) || { profiled: 0, altered: 0 };
    cur.profiled += profiled; cur.altered += altered; m.set(k, cur);
  };
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const def = doc.cohorts[n];
    const [gc, sc] = await Promise.all([
      ok[st].geneCounts(def, allGenes),
      ok[st].moreAggregate("pathways:sets:" + n, def, (c, s, d) =>
        geneSetCountsSql(c, drawn.map((p) => ({ name: p.name, genes: p.genes.map((g) => g.gene) })), s, pin, d))
    ]);
    for (const g of gc) bump(geneTally, n + "|" + g.gene, g.profiled, measure === "driver" ? g.driver : g.altered);
    for (const r of sc) bump(setTally, n + "|" + String(r.set_name), Number(r.profiled), Number(measure === "driver" ? r.driver : r.altered));
  })));
  const cell = (m: Map<string, { profiled: number; altered: number }>, n: string, key: string): PathwayCell => {
    const t = m.get(n + "|" + key) || { profiled: 0, altered: 0 };
    return { cohort: n, profiled: t.profiled, altered: t.altered, pct: t.profiled ? Math.round(1000 * t.altered / t.profiled) / 10 : null };
  };
  const two = vNames.length === 2;
  const fisher = (cs: PathwayCell[]): number | undefined =>
    two && cs[0].profiled && cs[1].profiled
      ? fisherExact(cs[0].altered, cs[0].profiled - cs[0].altered, cs[1].altered, cs[1].profiled - cs[1].altered) : undefined;

  const geneP = new Map<string, number>();
  const rows: PathwayRow[] = drawn.map((p) => {
    const cells = vNames.map((n) => cell(setTally, n, p.name));
    const members = p.genes.map((g) => {
      const cs = vNames.map((n) => cell(geneTally, n, g.gene));
      const gp = fisher(cs);
      if (gp != null) geneP.set(g.gene, gp);
      return { gene: g.gene, role: g.role, cells: cs };
    });
    const profiledMembers = members.filter((m) => m.cells.some((c) => c.profiled > 0));
    const ranked = profiledMembers.filter((m) => m.cells.some((c) => c.altered > 0))
      .sort((a, b) => Math.max(...b.cells.map((c) => c.pct ?? 0)) - Math.max(...a.cells.map((c) => c.pct ?? 0)) || (a.gene < b.gene ? -1 : 1));
    const top = ranked.slice(0, topGenes);
    const pp = fisher(cells);
    return { name: p.name, source: p.source, genes: p.genes.length, profiledGenes: profiledMembers.length, cells,
      ...(pp != null ? { p: pp } : {}), top, otherAltered: ranked.length - top.length,
      notProfiled: members.filter((m) => !m.cells.some((c) => c.profiled > 0)).map((m) => m.gene) };
  });
  if (two) {
    const tested = rows.filter((r) => r.p != null);
    benjaminiHochberg(tested.map((r) => r.p!)).forEach((q, i) => { tested[i].q = q; });
    // gene q-values over every member gene tested, once each (SCRIB sits in two pathways)
    const genes = [...geneP.keys()], gq = new Map<string, number>();
    benjaminiHochberg(genes.map((g) => geneP.get(g)!)).forEach((q, i) => gq.set(genes[i], q));
    for (const r of rows) for (const t of r.top) if (gq.has(t.gene)) t.q = gq.get(t.gene);
  }
  if (!rows.some((r) => r.cells.some((c) => c.profiled > 0)))
    return refuse("pathways", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " was profiled for any gene in these pathways");
  const multi = ctx.vStudies.length > 1;
  const unprofiled = rows.reduce((n, r) => n + r.notProfiled.length, 0);
  return {
    kind: "pathways", cohorts: vNames, annotation: pin ? "OncoKB " + pin : undefined,
    pathways: { measure, rows, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (measure === "driver"
        ? "Share of patients with an OncoKB driver (" + pin + ") in at least one member gene — drivers only, as Sanchez-Vega et al. counted curated oncogenic events. "
        : "Share of patients with any alteration (mutation, high-level CNA, structural variant) in at least one member gene, drivers or not. ") +
      "A pathway's denominator is the patients profiled for at least one of its genes, so a panel that covers few members makes a pathway look rarer than a genome-wide assay would; " +
      "each member gene's own % is over the patients profiled for THAT gene. " +
      (unprofiled ? unprofiled + " member-gene slots were on no participating panel and are listed as not profiled rather than counted as unaltered. " : "") +
      "Pathway membership is the paper's Table S3; a gene's pathway role (oncogene / tumour suppressor) is not used in the count." +
      (two ? " Two-sided Fisher tests; q is Benjamini–Hochberg across the pathways drawn, and separately across every member gene tested." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// diffexpr: a volcano of every gene, and preranked GSEA of the same ranking

const DE_MIN_N = 3, DE_POINT_CAP = 1500, DE_PERMUTATIONS = 1000;
const SET_NAME = /^[A-Z0-9_]{3,120}$/;

/** The smallest 1, 2 or 5 × 10^k at or above x — an axis end a reader can read off. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= x - 1e-12) return m * k;
  return 10 * k;
}

/** RNA-seq counts/RSEM/TPM are compared on log2(v + 1); z-scores, protein and methylation as stored. */
export function defaultLog2(profileType: string): boolean {
  return /rna_seq|rnaseq|tpm|fpkm|rsem/i.test(profileType) && !/zscore|log/i.test(profileType);
}

async function diffexprView(view: DiffexprView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 2)
    return refuse("diffexpr", ctx, "a diffexpr view compares exactly two cohorts; this one draws " + vNames.length +
      (vNames.length > 2 ? " — name two in its cohorts" : " — add a second cohort to compare against"));
  const profileType = String(view.profileType || "").trim();
  if (!profileType) return refuse("diffexpr", ctx, "a diffexpr view needs profileType, the molecular profile to compare on");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("diffexpr", ctx, "label is 0 to 40 genes; got " + String(view.label).slice(0, 20));
  const setNames = view.geneSets == null ? null : view.geneSets.map((x) => String(x).trim().toUpperCase());
  if (setNames) {
    const e = ctx.overLimit("a diffexpr view", 12, setNames.length);
    if (e) return refuse("diffexpr", ctx, e.replace("at most 12", "at most 12 gene sets"));
    const bad = setNames.filter((x) => !SET_NAME.test(x));
    if (bad.length) return refuse("diffexpr", ctx, "not an MSigDB set name: " + bad.slice(0, 3).join(", "));
  }
  const log2 = view.log2 == null ? defaultLog2(profileType) : view.log2 === true;
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("diffexpr", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") +
    (empty.length === 1 ? " is" : " are") + " empty — check its definition; the profile is not the problem");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("diffexpr", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // the profile must exist wherever a cohort has patients — named, with what IS there, if not
  const missing: string[] = [];
  const offered = new Set<string>();
  for (const st of Object.keys(ok)) {
    if (!vNames.some((n) => (cohorts[n].perStudy[st]?.count || 0) > 0)) continue;
    const { profiles } = await ctx.studyProfiles(st);
    profiles.forEach((x) => offered.add(x));
    if (!profiles.includes(profileType)) missing.push(st);
  }
  if (missing.length)
    return refuse("diffexpr", ctx, (missing.length === 1 ? missing[0] + " has" : missing.join(", ") + " have") + " no " + profileType +
      " profile — available: " + ([...offered].sort().join(", ") || "none"));

  const moments = new Map<string, { n: number; sx: number; sxx: number }>(); // cohort|gene
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const rows = await ok[st].moreAggregate("diffexpr:moments:" + n, doc.cohorts[n],
      (c, s, d) => profileMomentsAllSql(c, s, d, profileType, log2));
    for (const r of rows) {
      const k = n + "|" + String(r.gene), cur = moments.get(k) || { n: 0, sx: 0, sxx: 0 };
      cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx);
      moments.set(k, cur);
    }
  })));
  const [A, B] = vNames;
  const genes = [...new Set([...moments.keys()].map((k) => k.slice(k.indexOf("|") + 1)))];
  const tested: DiffexprGene[] = [];
  let skipped = 0;
  for (const g of genes) {
    const a = moments.get(A + "|" + g), b = moments.get(B + "|" + g);
    if (!a || !b || a.n < DE_MIN_N || b.n < DE_MIN_N) { skipped++; continue; }
    const va = varianceFromMoments(a.n, a.sx, a.sxx), vb = varianceFromMoments(b.n, b.sx, b.sxx);
    const ma = a.sx / a.n, mb = b.sx / b.n;
    // a constant gene's variance from Σv² − (Σv)²/n is rounding noise, whose sign depends on the
    // order the database happened to sum in — so "no variance" is judged to a relative tolerance,
    // or the same document would test a different number of genes on different runs
    if (!(va + vb > 1e-9 * (1 + ma * ma + mb * mb))) { skipped++; continue; }
    const w = welchT(a.n, ma, va, b.n, mb, vb);
    // the ranking uses the unrounded statistic; welchT's rounded one is for display
    const t = (ma - mb) / Math.sqrt(va / a.n + vb / b.n);
    tested.push({ gene: g, nA: a.n, nB: b.n, meanA: ma, meanB: mb, effect: ma - mb, t, p: w.p, q: 1 });
  }
  if (!tested.length)
    return refuse("diffexpr", ctx, "no gene had at least " + DE_MIN_N + " patients with a " + profileType + " value in both cohorts" +
      " (cohort sizes " + vNames.map((n) => n + " " + cohorts[n].count).join(", ") + ")");
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  const sig = tested.filter((g) => g.q < 0.05);
  const up = sig.filter((g) => g.effect > 0).length, down = sig.length - up;
  const byP = [...tested].sort((x, y) => x.p - y.p || Math.abs(y.effect) - Math.abs(x.effect));
  // half the labels to each direction, so a lopsided comparison still names both sides
  const upFirst = byP.filter((g) => g.effect > 0), downFirst = byP.filter((g) => g.effect <= 0);
  const half = Math.ceil(label / 2);
  const labels = [...upFirst.slice(0, Math.max(half, label - downFirst.length)), ...downFirst.slice(0, Math.max(label - half, label - upFirst.length))]
    .slice(0, label).map((g) => g.gene);
  const pointSet = new Set([...labels, ...byP.filter((g) => g.q < 0.05).slice(0, DE_POINT_CAP).map((g) => g.gene)]);
  const points = byP.filter((g) => pointSet.has(g.gene));
  const P_FLOOR = 1e-300;
  const yOf = (p: number) => -Math.log10(Math.max(P_FLOOR, p));
  const xMax = niceCeil(Math.max(1e-9, ...tested.map((g) => Math.abs(g.effect))));
  const yMax = niceCeil(Math.max(1, ...tested.map((g) => yOf(g.p))));
  const nx = 90, ny = 60, cellMap = new Map<string, number>();
  for (const g of tested) {
    if (pointSet.has(g.gene)) continue;
    const bx = Math.min(nx - 1, Math.floor((g.effect + xMax) / (2 * xMax) * nx));
    const by = Math.min(ny - 1, Math.floor(yOf(g.p) / yMax * ny));
    const cls = g.q < 0.05 ? (g.effect > 0 ? 1 : 2) : 0;
    const k = bx + "," + by + "," + cls;
    cellMap.set(k, (cellMap.get(k) || 0) + 1);
  }
  const cells = [...cellMap].map(([k, c]) => {
    const [x, y, cls] = k.split(",").map(Number);
    return [x, y, c, cls as 0 | 1 | 2] as [number, number, number, 0 | 1 | 2];
  });

  // enrichment: rank by t, best (higher in the first cohort) first
  let gsea: NonNullable<ViewResult["diffexpr"]>["gsea"];
  if (!setNames || setNames.length) {
    const meta = ok[Object.keys(ok)[0]];
    const rows = await meta.moreMeta("diffexpr:genesets", (_s, d) => genesetMembersSql(setNames || [], setNames ? null : "HALLMARK_", d));
    const found = rows.map((r) => ({ name: String(r.set_name), genes: (r.genes as unknown as string[]).map(String) }));
    const absent = (setNames || []).filter((x) => !found.some((f) => f.name === x));
    if (absent.length) return refuse("diffexpr", ctx, "no MSigDB set named " + absent.slice(0, 3).join(", ") + " in this warehouse" +
      " (it holds the collections as named in MSigDB, e.g. HALLMARK_E2F_TARGETS, KEGG_…, REACTOME_…)");
    const ranked = [...tested].sort((x, y) => y.t - x.t).map((g) => ({ gene: g.gene, score: g.t }));
    const res = preRankedGsea(ranked, found, { permutations: DE_PERMUTATIONS });
    const qs = benjaminiHochberg(res.map((r) => r.p));
    // many sets reach the permutation floor together, so p alone cannot order them: q, then |NES|
    const sets = res.map((r, i) => ({ ...r, q: qs[i] })).sort((x, y) => x.q - y.q || Math.abs(y.nes) - Math.abs(x.nes));
    gsea = { ranking: "Welch t, " + A + " over " + B, permutations: DE_PERMUTATIONS, sets,
      skipped: found.filter((f) => !res.some((r) => r.name === f.name)).map((f) => f.name) };
  }
  const effectLabel = log2 ? "log2 fold change (difference of mean log2(v+1))"
    : /zscore/i.test(profileType) ? "difference in mean z-score" : "difference in mean value";
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "diffexpr", cohorts: vNames,
    diffexpr: { profileType, log2, effectLabel, groups: [A, B], tested: tested.length, skipped, up, down,
      points, grid: { xMax, yMax, nx, ny, cells }, pooledSignificant: sig.length - points.filter((g) => g.q < 0.05).length,
      labels, ...(gsea ? { gsea } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Welch's t-test per gene on " + profileType + (log2 ? " as log2(v + 1)" : " as stored") + ", " + A + " minus " + B +
      ", each patient contributing the mean of their samples; computed from three running totals per gene and cohort, so it is exact across sites. " +
      tested.length.toLocaleString("en-US") + " genes tested" + (skipped ? ", " + skipped.toLocaleString("en-US") + " left out (fewer than " + DE_MIN_N + " patients with a value in a cohort, or no variance)" : "") +
      "; q is Benjamini–Hochberg across every gene tested. " +
      (sig.length > points.filter((g) => g.q < 0.05).length ? "The " + DE_POINT_CAP + " most significant genes are drawn as points, the rest as density. " : "") +
      (/zscore/i.test(profileType) ? "Z-scores are standardised within each study, so a difference is in study-specific units. " : "") +
      "A t-test on thousands of patients finds tiny differences significant — read the effect, not only the q. " +
      (gsea ? "Enrichment is preranked GSEA on the unrounded t (Subramanian et al. 2005, weight 1), significance from " + DE_PERMUTATIONS +
        " random sets of the same size drawn from the same ranking, seeded by the set's name so a shared link reproduces it; p = (b+1)/(m+1) over the same-sign nulls, q is Benjamini–Hochberg across the sets tested (not GSEA's own NES-based FDR). " +
        "Gene-set permutation ignores gene–gene correlation, so it is anti-conservative next to phenotype permutation, which needs patient-level values. " : "") +
      (multi ? "Values are pooled across " + ctx.vStudies.length + " studies with no batch correction. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
