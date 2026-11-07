// Ranking the library's pathways for a gene query, as PathwayMapper ranks them
// (getBestPathways in pathway-mapper 2.3.0's react-pathway-mapper.tsx), and the one the view draws
// when the document names none. Pure and browser-safe: the runner records the default and the
// method record's scores with it, and the page re-ranks with it when a ranking setting changes.
import { PATHWAYS, isGene, type Pathway } from "./library.ts";

/** how pathways are ranked: by the number of query genes they contain, or that number as a % of their gene nodes */
export type RankBy = "count" | "percent";
export interface RankSettings {
  rank: RankBy;
  /** weight each matched gene by its alteration frequency (PathwayMapper's "Consider alteration frequency") */
  byFrequency: boolean;
  /** list only the ten TCGA PanCanAtlas pathways (PathwayMapper's default) */
  pancanOnly: boolean;
}
export const DEFAULT_RANK: RankSettings = { rank: "count", byFrequency: false, pancanOnly: true };

export interface RankedPathway {
  name: string;
  /** the query genes among its gene nodes, in query order */
  matched: string[];
  /** its gene nodes, once each — the denominator of a percentage ranking */
  geneNodes: number;
  /** the matched genes' frequencies added up, each rounded to 2 decimals as PathwayMapper rounds them */
  frequencySum: number;
  score: number;
}

/** to 2 decimals, halves up — the one rounding of a % here, which the method script repeats */
export const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * PathwayMapper's four scores, from the matched genes m, the pathway's gene node count n and the
 * matched genes' summed frequency f (each gene's %, rounded to 2 decimals):
 *   count: |m|;  percent: 100·|m|/n;  count by frequency: f;  percent by frequency: |m|·f/n.
 * (The last is the code's formula; PathwayMapper's own help text describes it as f/n.)
 * `pctOf` is a gene's altered % (the highest across cohorts when there are several), or null when no
 * cohort was profiled for it — which adds nothing, where PathwayMapper adds −101.
 */
export function scorePathway(p: Pathway, query: string[], pctOf: (gene: string) => number | null, s: Pick<RankSettings, "rank" | "byFrequency">): RankedPathway {
  const nodes = new Set(p.genes);
  const matched = query.filter((g) => nodes.has(g));
  const frequencySum = round2(matched.reduce((a, g) => a + round2(pctOf(g) ?? 0), 0));
  const n = p.genes.length;
  const score = s.byFrequency
    ? (s.rank === "count" ? frequencySum : n ? matched.length * frequencySum / n : 0)
    : (s.rank === "count" ? matched.length : n ? 100 * matched.length / n : 0);
  return { name: p.name, matched, geneNodes: n, frequencySum, score };
}

/**
 * The pathways the table lists, best first: the score, then (between equal scores) the matched
 * genes' summed frequency, then the name. PathwayMapper breaks ties by where its heap happens to
 * leave them; this order is stable, so a link always opens on the same pathway.
 */
export function rankPathways(query: string[], pctOf: (gene: string) => number | null, s: RankSettings, library: Pathway[] = PATHWAYS): RankedPathway[] {
  return library.filter((p) => !s.pancanOnly || p.pancan)
    .map((p) => scorePathway(p, query, pctOf, s))
    .sort((a, b) => b.score - a.score || b.frequencySum - a.frequencySum || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** the settings a view's spec asks for, with PathwayMapper's defaults for what it leaves out */
export function rankSettingsOf(spec: { rank?: unknown; byFrequency?: unknown; pancanOnly?: unknown }): RankSettings {
  return { rank: spec.rank === "percent" ? "percent" : "count", byFrequency: spec.byFrequency === true, pancanOnly: spec.pancanOnly !== false };
}

/** why a spec's ranking settings or chosen pathway cannot be honoured, or null */
export function rankProblem(spec: { rank?: unknown; byFrequency?: unknown; pancanOnly?: unknown; pathway?: unknown }, library: Pathway[] = PATHWAYS): string | null {
  if (spec.rank != null && spec.rank !== "count" && spec.rank !== "percent") return "rank is \"count\" or \"percent\"; got " + JSON.stringify(spec.rank).slice(0, 30);
  if (spec.byFrequency != null && typeof spec.byFrequency !== "boolean") return "byFrequency is true or false";
  if (spec.pancanOnly != null && typeof spec.pancanOnly !== "boolean") return "pancanOnly is true or false";
  if (spec.pathway == null) return null;
  const name = String(spec.pathway);
  const p = library.find((x) => x.name === name);
  if (!p) return "no pathway named “" + name.slice(0, 60) + "” — PathwayMapper's library has " + library.length + ": " + library.map((x) => x.name).join(", ");
  if (spec.pancanOnly !== false && !p.pancan) return "“" + name + "” is not one of the ten TCGA PanCanAtlas pathways the list is limited to; set pancanOnly: false to draw it";
  return null;
}

/** a gene's altered % for ranking: the highest across the cohorts that were profiled for it, or null when none was */
export function rankingPct(cells: { pct: number | null }[] | undefined): number | null {
  const ps = (cells || []).map((c) => c.pct).filter((p): p is number => p != null);
  return ps.length ? Math.max(...ps) : null;
}

/**
 * What the view draws for a spec, from the counts it ran with: the ranking for its settings, the
 * pathway (the spec's, or the ranking's first) and that pathway's gene nodes that are labels, not
 * genes. Throws, naming what is available, when the spec's settings or pathway cannot be honoured.
 */
export function arrangeFor(base: { query: string[]; genes: { gene: string; cells: { pct: number | null }[] }[] },
  spec: { rank?: unknown; byFrequency?: unknown; pancanOnly?: unknown; pathway?: unknown }, library: Pathway[] = PATHWAYS):
  { settings: RankSettings; ranked: RankedPathway[]; pathway: string; defaulted: boolean; labels: string[] } {
  const problem = rankProblem(spec, library);
  if (problem) throw new Error(problem);
  const settings = rankSettingsOf(spec);
  const byGene = new Map(base.genes.map((g) => [g.gene, g.cells]));
  const ranked = rankPathways(base.query, (g) => rankingPct(byGene.get(g)), settings, library);
  const pathway = spec.pathway != null ? String(spec.pathway) : ranked[0].name;
  const p = library.find((x) => x.name === pathway)!;
  return { settings, ranked, pathway, defaulted: spec.pathway == null, labels: p.genes.filter((g) => !isGene(g)) };
}
