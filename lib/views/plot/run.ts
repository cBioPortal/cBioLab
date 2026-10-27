// Plot view: two axes over one cohort's cases, drawn as a scatter, box or contingency table as
// the axes decide; local, or federated where every participant can answer.
import type { ViewResult } from "../../types.ts";
import { pearsonFromMoments, regressionFromMoments, type Moments } from "../../stats.ts";
import { plotCasesOf, hasFederatedPlot, legendFor, type Resolver, type FederatedPlotCapable, type PlotCasesCapable } from "../../federation.ts";
import { DEFAULT_BINS, CATEGORY_CAP, POINTS_CAP, OUTLIER_CELL_MAX, VIOLIN_BINS, axisLabel, outlierExtremity, tukey, coverageNote, combineNote, sparseCellMax,
  type AxisKind, type HighlightPoint, type PlotData, type PlotGroup, type PlotLayer, type PlotPoint, type PlotRequest, type PointRank,
  type ViolinBin, type Whiskers } from "../../plot.ts";
import { DEFAULT_POINT_LAYERS, LAYER_COLORS, POINT_LAYER_CAP, POINT_RULE_N, POINT_RULE_N_MAX, layerLabel, type PointLayerSpec } from "../../plot-layers.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { resolveAxes } from "../../plot-profile.ts";
import { assayEntitiesKnown } from "../shared.ts";
import type { PlotView } from "./types.ts";

type BoxRow = { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number };

/**
 * Per-site box rows pooled into one box per group. n/lo/hi are exact; q1/median/q3 are
 * size-weighted across sites, the same approximation Explore's federated numeric histograms
 * already use and disclose — it shifts where an outlier bar falls, never a count. One site's
 * rows come back as they are.
 */
function poolBoxRows(parts: BoxRow[][]): PlotGroup[] {
  const byGroup = new Map<string, { n: number; lo: number; hi: number; q1w: number; medw: number; q3w: number }>();
  for (const rows of parts) for (const r of rows) {
    const cur = byGroup.get(r.g) || { n: 0, lo: r.lo, hi: r.hi, q1w: 0, medw: 0, q3w: 0 };
    byGroup.set(r.g, { n: cur.n + r.n, lo: Math.min(cur.lo, r.lo), hi: Math.max(cur.hi, r.hi),
      q1w: cur.q1w + r.q1 * r.n, medw: cur.medw + r.median * r.n, q3w: cur.q3w + r.q3 * r.n });
  }
  return [...byGroup.entries()].map(([g, a]) => {
    const q1 = a.q1w / a.n, median = a.medw / a.n, q3 = a.q3w / a.n;
    const t = tukey(q1, q3, a.lo, a.hi);
    return { g, n: a.n, lo: a.lo, hi: a.hi, q1, median, q3, loWhisker: t.loWhisker, hiWhisker: t.hiWhisker };
  });
}

type Def = ViewRun["doc"]["cohorts"][string];

/**
 * The value range every site bins a pooled box's density over, and how many bins. The figure's
 * axis spans the whiskers and reaches at most one whisker span past them, so that is the range: a
 * value beyond it is off the figure, and an outlier far past it would otherwise squeeze every
 * group's density into one bin. The bin count keeps a bin about as tall as a single study's.
 */
export function pooledViolinRange(groups: PlotGroup[]): { range: [number, number]; bins: number } {
  const wLo = Math.min(...groups.map((g) => g.loWhisker)), wHi = Math.max(...groups.map((g) => g.hiWhisker));
  const span = wHi - wLo;
  const x0 = Math.max(Math.min(...groups.map((g) => g.lo)), wLo - span);
  const x1 = Math.min(Math.max(...groups.map((g) => g.hi)), wHi + span);
  const bins = span > 0 ? Math.max(VIOLIN_BINS, Math.min(3 * VIOLIN_BINS, Math.round(VIOLIN_BINS * (x1 - x0) / span))) : VIOLIN_BINS;
  return { range: [x0, x1], bins };
}

/** each site's density bins summed per group, bin and colour class: exact, because every site cut the same bins */
function poolViolin(parts: ViolinBin[][]): ViolinBin[] {
  const byKey = new Map<string, ViolinBin>();
  for (const part of parts) for (const v of part) {
    const key = v.g + "\u0000" + v.b + "\u0000" + (v.c ?? "");
    const cur = byKey.get(key);
    if (cur) cur.n += v.n; else byKey.set(key, { ...v });
  }
  return [...byKey.values()];
}

/** copy-number levels in their own order, as the portal draws them; anything else keeps its place after them */
const CNA_LEVELS = ["Deep deletion", "Shallow deletion", "Diploid", "Gain", "Amplification"];
/** a box grouped by a discrete copy-number profile runs from deep deletion to amplification, not by size */
function orderLevels(data: PlotData, spec: PlotRequest): void {
  const cat = data.x.kind === "cat" ? spec.x : spec.y;
  if (data.shape !== "box" || !data.groups || cat.source !== "molecular" || !cat.discrete) return;
  const rank = (g: string) => { const i = CNA_LEVELS.indexOf(g); return i < 0 ? CNA_LEVELS.length : i; };
  data.groups = [...data.groups].sort((a, b) => rank(a.g) - rank(b.g));
}
const TABLE_WHY = "a contingency table counts cases and has no points to mark";
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The plotted cohort's own cases as points, set on `data`: every case at or under POINTS_CAP, from
 * a participant entitled to see cases (a local patient-level one, or a peer sharing `plot`), unless
 * the view says `allPoints: false`. Over the cap the crowd is density, and the subsets worth seeing
 * one by one are the view's point layers. plotCasesOf is a type guard, so asking a participant that
 * may not show cases is a compile error.
 */
async function basePoints(pv: PlotView, r0: Resolver, def: Def, spec: PlotRequest, data: PlotData, site: string): Promise<void> {
  if (data.shape === "table" || !data.n) return;
  const none = (why: string) => { data.pointSet = { rule: "none", drawn: 0, why }; };
  if (pv.allPoints === false) return none("allPoints: false");
  if (data.n > POINTS_CAP) return none("more than " + fmt(POINTS_CAP) + " cases");
  const rc = plotCasesOf(r0);
  if (!rc) return none(site + " may not show individual cases");
  // a peer that refuses (its rules do not share this study's plot cases) leaves the density, saying why
  try { await drawAll(rc, def, spec, data); }
  catch (e) { if (r0.instance.id !== "peer") throw e; none(String((e as Error).message || e)); }
}

/** every case of a plot at or under the cap, from a participant that may show them */
async function drawAll(rc: PlotCasesCapable, def: Def, spec: PlotRequest, data: PlotData): Promise<void> {
  if (data.shape === "box") {
    const all = await rc.plotPoints(def, spec);
    if (!all || !all.length) return;
    data.points = all; data.overlay = "points";
    data.pointSet = { rule: "all", drawn: all.length };
    if (spec.colorBy) data.legend = legendFor(all.map((x) => x.c || ""));
    if (spec.ringBy) data.legend = [...(data.legend || []), ...legendFor(all.map((x) => x.r || ""), true)];
    return;
  }
  const all = await rc.plotScatterPoints(def, spec);
  if (!all || !all.length) return;
  data.xyPoints = all;
  data.pointSet = { rule: "all", drawn: all.length };
}

/** what the caption says when the plotted cohort is drawn as density rather than as its cases */
function densityNote(data: PlotData, unit: "patient" | "sample"): string {
  if (data.shape === "table" || !data.n || data.pointSet?.rule === "all") return "";
  const cases = (n: number) => fmt(n) + " " + unit + (n === 1 ? "" : "s");
  const lead = data.shape === "scatter"
    ? "Drawn as density: " + cases(data.n) + " counted into " + fmt((data.bins || []).length) + " cells. The coefficients are over every " +
      unit + ", not over what you can see."
    : "Drawn as a density per group" + (data.n > POINTS_CAP ? ": " + fmt(data.n) + " values is past what a cloud of dots can show, and" : ";") +
      " the quartiles are over every value.";
  const why = data.pointSet?.why;
  return lead + (why && why !== "allPoints: false" && !why.startsWith("more than") ? " No case is drawn as a point: " + why + "." : "");
}

/** what is wrong with a view's point settings, before anything is queried; null when nothing is */
function layersProblem(pv: PlotView, c: ViewRun, cn: string): string | null {
  if ("highlight" in (pv as object))
    return "highlight is now a point layer: list each cohort in the view's points as {\"cohort\": \"<name>\"}";
  if (pv.allPoints != null && typeof pv.allPoints !== "boolean") return "allPoints: give true or false";
  const ls = pv.points;
  if (ls == null) return null;
  if (!Array.isArray(ls)) return "points: give a list of layers, e.g. [{\"rule\": \"outliers\"}, {\"cohort\": \"KRAS G12C\"}]; [] draws none";
  if (ls.length > POINT_LAYER_CAP) return "a plot draws at most " + POINT_LAYER_CAP + " point layers; this view asks for " + ls.length;
  const cohortsSeen = new Set<string>();
  for (const l of ls as unknown[]) {
    if (!l || typeof l !== "object") return "points: each layer is an object, {\"rule\": …} or {\"cohort\": …}";
    const o = l as Record<string, unknown>;
    if ("cohort" in o) {
      const h = o.cohort;
      if (typeof h !== "string" || !c.cohorts[h]) return "points: there is no cohort named “" + String(h) + "”";
      if (h === cn) return "points: “" + h + "” is the plotted cohort itself, so it would mark every case";
      if (cohortsSeen.has(h)) return "points: the cohort “" + h + "” is named twice";
      cohortsSeen.add(h);
      continue;
    }
    if (o.rule !== "outliers" && o.rule !== "extremes" && o.rule !== "trend")
      return "points: unknown rule “" + String(o.rule) + "” — use outliers, extremes or trend, or name a cohort";
    if (o.rule === "extremes" && o.axis !== "x" && o.axis !== "y") return "points: an extremes layer names its axis, \"x\" or \"y\"";
    if (o.n != null && !(Number.isInteger(o.n) && (o.n as number) >= 1 && (o.n as number) <= POINT_RULE_N_MAX))
      return "points: n is a whole number from 1 to " + POINT_RULE_N_MAX + "; this layer asks for " + String(o.n);
  }
  return null;
}

/**
 * A call that may reach a peer for cases: run as it is when every participant is this instance's
 * own (an error then is a real one), and when one is a peer, its refusal (its rules do not share the
 * study's plot cases, or it predates them) becomes `fallback`'s answer, which the caption says.
 */
async function peerSafe<T>(rs: Resolver[], run: () => Promise<T>, fallback: (why: string) => T): Promise<T> {
  if (!rs.some((r) => r.instance.id === "peer")) return run();
  try { return await run(); }
  catch (e) { return fallback(String((e as Error).message || e)); }
}

/** a layer's points, each with the key that says whether an earlier layer already drew the case */
type Picked = { layer: PlotLayer; keys?: string[] };

/**
 * The view's point layers, in order, each drawn in its own colour over the plotted cohort. Every
 * layer shares one POINTS_CAP budget; a case two layers share is drawn by the first. A layer that
 * does not fit is never cut to its first cases: a cohort layer becomes density cells or a box per
 * group, a rule layer is not drawn, and either way the caption says why. Points come only from
 * participants entitled to see cases, and a layer is drawn from all of its studies or not at all.
 */
async function pointLayers(pv: PlotView, data: PlotData, c: ViewRun, cn: string, sites: string[], spec: PlotRequest): Promise<PlotLayer[]> {
  const specs = pv.points ?? DEFAULT_POINT_LAYERS;
  if (!specs.length) return [];
  const fr = c.resolvers as Record<string, Resolver & FederatedPlotCapable>;
  const def = c.doc.cohorts[cn];
  const xk = data.x.kind, yk = data.y.kind;
  const closed = sites.filter((s) => !plotCasesOf(c.resolvers[s]));
  // each drawn case, and the layer (its place in the list) that drew it
  const seen = new Map<string, number>();
  let budget = POINTS_CAP;
  const out: PlotLayer[] = [];
  for (const [i, l] of specs.entries()) {
    const base = { label: layerLabel(l, (side) => data[side].label), color: LAYER_COLORS[i] };
    const kind = "cohort" in l ? "cohort" as const : l.rule;
    let picked: Picked;
    if ("cohort" in l) picked = await cohortLayer(l.cohort, base, data, c, def, sites, spec, budget);
    else if (data.shape === "table" || !data.n)
      picked = { layer: { kind, ...base, n: 0, shown: "none", why: data.n ? TABLE_WHY : undefined } };
    else if (closed.length) picked = { layer: { kind, ...base, n: 0, shown: "none", why: closed.join(", ") + " may not show individual cases" } };
    else picked = await peerSafe(sites.map((s) => c.resolvers[s]), () => ruleLayer(l, base, data, fr, def, sites, spec, xk, yk, budget),
      (why) => ({ layer: { kind, ...base, n: 0, shown: "none", why } }));
    const { layer, keys } = picked;
    if (layer.shown === "points" && layer.points && keys) {
      const kept = layer.points.filter((_, j) => !seen.has(keys[j]));
      const sharedAt = keys.map((k, j) => seen.has(k) ? j : -1).filter((j) => j >= 0);
      const owners = sharedAt.map((j) => seen.get(keys[j])!);
      for (const k of keys) if (!seen.has(k)) seen.set(k, i);
      layer.drawn = kept.length;
      if (sharedAt.length) { layer.shared = sharedAt.map((j) => layer.points![j]); layer.sharedOwners = owners; }
      layer.points = kept;
      budget -= kept.length;
    }
    out.push(layer);
  }
  return out;
}

/** points gathered from several studies, keyed by study and case so two studies' ids never collide */
function gather<T extends { id: string }>(parts: T[][], sites: string[]): { points: T[]; keys: string[] } {
  const points: T[] = [], keys: string[] = [];
  parts.forEach((part, k) => { for (const p of part) { points.push(p); keys.push(sites[k] + "\u0000" + p.id); } });
  return { points, keys };
}

/** a cohort layer: the plotted cohort's cases that are also in `name` */
async function cohortLayer(name: string, base: { label: string; color: string }, data: PlotData, c: ViewRun, def: Def,
  sites: string[], spec: PlotRequest, budget: number): Promise<Picked> {
  const fr = c.resolvers as Record<string, Resolver & FederatedPlotCapable>;
  const hDef = c.doc.cohorts[name], hc = c.cohorts[name];
  const xk = data.x.kind, yk = data.y.kind;
  // the layer's cases in a study the plot does not draw are outside the plotted cohort by definition
  const hSites = sites.filter((s) => hc.studies.includes(s));
  const head = { kind: "cohort" as const, ...base, name, patients: hc.count };
  const unable = hSites.filter((s) => !hasFederatedPlot(c.resolvers[s]));
  if (unable.length) return { layer: { ...head, inPlot: 0, n: 0, shown: "none", why: unable.join(", ") + " cannot answer a cohort layer (a remote peer over MCP, most likely)" } };
  const inPlot = (await Promise.all(hSites.map((s) => fr[s].plotHighlightCount(def, hDef)))).reduce((a, n) => a + n, 0);
  if (data.shape === "table") return { layer: { ...head, inPlot, n: 0, shown: "none", why: TABLE_WHY } };
  if (!inPlot || !data.n) return { layer: { ...head, inPlot, n: 0, shown: "none" } };
  let why: string;
  let closedWhy = "";
  const closed = hSites.filter((s) => !plotCasesOf(c.resolvers[s]));
  if (!closed.length && budget > 0) {
    // a peer that refuses its cases leaves this layer to its aggregate form, saying why
    const parts = await peerSafe(hSites.map((s) => c.resolvers[s]),
      () => Promise.all(hSites.map((s) => plotCasesOf(c.resolvers[s])!.plotHighlightPoints(def, hDef, spec, xk, yk, budget))),
      (w) => { closedWhy = w; return hSites.map(() => null); });
    if (!closedWhy && parts.every((p) => p)) {
      const g = gather(parts as HighlightPoint[][], hSites);
      if (g.points.length <= budget) return { layer: { ...head, inPlot, n: g.points.length, shown: "points", points: g.points }, keys: g.keys };
    }
    why = closedWhy || (budget === POINTS_CAP ? "more than " + fmt(POINTS_CAP) + " cases, too many to draw as points"
      : "more cases than the " + fmt(budget) + " points the earlier layers left");
  } else {
    why = closed.length ? closed.join(", ") + " may not show individual cases" : "the earlier layers used every point the figure draws";
  }
  if (data.shape === "scatter" && data.extent && data.grid) {
    const parts = await Promise.all(hSites.map((s) => fr[s].plotHighlightBins(def, hDef, spec, xk, yk, data.grid!, data.extent!)));
    const cells = new Map<string, number>();
    for (const part of parts) for (const b of part) cells.set(b.bx + "," + b.by, (cells.get(b.bx + "," + b.by) || 0) + b.n);
    const bins = [...cells.entries()].map(([k, n]) => { const [bx, by] = k.split(",").map(Number); return { bx, by, n }; });
    return { layer: { ...head, inPlot, n: bins.reduce((a, b) => a + b.n, 0), shown: "density", bins, why } };
  }
  const groups = poolBoxRows(await Promise.all(hSites.map((s) => fr[s].plotHighlightBoxRows(def, hDef, spec, xk, yk))));
  return { layer: { ...head, inPlot, n: groups.reduce((a, g) => a + g.n, 0), shown: "boxes", groups, why } };
}

/**
 * A rule layer, from participants that may all show cases. Outliers apply where the plotted cohort
 * is density: a box's values beyond its whiskers, a single study's scatter's cases in sparse cells.
 * Extremes and trend ask each study for its own top `n` and keep the overall top `n`, which is exact.
 */
async function ruleLayer(l: Exclude<PointLayerSpec, { cohort: string }>, base: { label: string; color: string }, data: PlotData,
  fr: Record<string, Resolver & FederatedPlotCapable>, def: Def, sites: string[], spec: PlotRequest,
  xk: AxisKind, yk: AxisKind, budget: number): Promise<Picked> {
  const kind = l.rule;
  const none = (why: string): Picked => ({ layer: { kind, ...base, n: 0, shown: "none", why } });
  const tooMany = (n: number) => none(fmt(n) + " cases, more than the " + fmt(budget) + " points " + (budget === POINTS_CAP ? "a figure draws" : "the earlier layers left"));
  const entitled = sites.map((s) => plotCasesOf(fr[s])!);
  if (l.rule === "outliers") {
    // outliers stand out of a density too large to draw as points; under the cap there is none
    if (data.n <= POINTS_CAP) return none("at or under " + fmt(POINTS_CAP) + " cases there is no density for them to stand out of");
    if (data.shape === "box") {
      if (budget <= 0) return none("the earlier layers used every point the figure draws");
      // each site's most extreme `budget`, pooled into the overall most extreme `budget`: exact,
      // as the ranked layers are, and the caption says how many it left out
      const whiskers = data.groups || [];
      const { points, keys, total } = pooledOutliers(
        await Promise.all(entitled.map((r) => r.plotOutlierPoints(def, spec, budget, whiskers))), sites, whiskers, budget);
      return { layer: { kind, ...base, n: points.length, shown: "points", points, ...(total > points.length ? { of: total } : {}) }, keys };
    }
    if (sites.length > 1) return none("a pooled scatter's sparse cells are known only after pooling, and no study can be asked for them yet");
    if (!data.bins || !data.grid || !data.extent) return none("the plot has no density to find sparse cells in");
    const cellMax = sparseCellMax(data.bins, budget, OUTLIER_CELL_MAX);
    if (!cellMax) return none("the cases alone in a cell are more than the " + fmt(budget) + " points left to draw");
    const pts = await entitled[0].plotScatterPoints(def, spec, budget, { grid: data.grid, extent: data.extent, cellMax });
    if (!pts) return none("the sparse cells hold more than " + fmt(budget) + " cases");
    const g = gather([pts], sites);
    return { layer: { kind, ...base, n: pts.length, shown: "points", points: pts, cellMax }, keys: g.keys };
  }
  const n = l.n ?? POINT_RULE_N;
  let rank: PointRank;
  if (l.rule === "trend") {
    if (data.shape !== "scatter") return none("a fitted line exists only on a scatter");
    const st = data.stats;
    if (!st || st.slope == null || st.intercept == null) return none("the plot has no fitted line");
    rank = { by: "residual", n, slope: st.slope, intercept: st.intercept };
  } else {
    if (data[l.axis].kind !== "num") return none(data[l.axis].label + " is not numeric, so it has no extremes");
    rank = { by: l.axis, n };
  }
  const g = gather(await Promise.all(entitled.map((r) => r.plotRankedPoints(def, spec, xk, yk, rank))), sites);
  const kept = topRanked(g.points, g.keys, rank, data.shape === "box");
  if (kept.points.length > budget) return tooMany(kept.points.length);
  return { layer: { kind, ...base, n: kept.points.length, shown: "points", points: kept.points }, keys: kept.keys };
}

/**
 * Each site's most extreme outliers pooled into the overall `budget` most extreme, by how far each
 * lies beyond its own group's whiskers (outlierExtremity, the order every site already used, so the
 * pooled top is exact). Ties go by study and case. `total` is how many lie beyond the whiskers in all.
 */
export function pooledOutliers(parts: { points: PlotPoint[]; total: number }[], sites: string[], whiskers: Whiskers[], budget: number):
  { points: PlotPoint[]; keys: string[]; total: number } {
  const g = gather(parts.map((p) => p.points), sites);
  const at = new Map(whiskers.map((w) => [w.g, w]));
  const ext = (p: PlotPoint) => { const w = at.get(p.g); return w ? outlierExtremity(p.v, w) : 0; };
  const order = g.points.map((_, i) => i)
    .sort((i, j) => ext(g.points[j]) - ext(g.points[i]) || (g.keys[i] < g.keys[j] ? -1 : 1)).slice(0, budget);
  return { points: order.map((i) => ({ id: g.points[i].id, g: g.points[i].g, v: g.points[i].v })), keys: order.map((i) => g.keys[i]),
    total: parts.reduce((a, p) => a + p.total, 0) };
}

/** each study's own top `n` pooled into the overall top `n` (per end, and per group on a box) */
function topRanked(points: HighlightPoint[], keys: string[], rank: PointRank, box: boolean): { points: HighlightPoint[]; keys: string[] } {
  const rows = points.map((p, i) => ({ p, k: keys[i] }));
  const val = (p: HighlightPoint) => "v" in p ? p.v : rank.by === "residual" ? Math.abs(p.y - (rank.intercept + rank.slope * p.x))
    : rank.by === "x" ? p.x : p.y;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const g = box && "g" in r.p ? r.p.g : ""; (groups.get(g) ?? groups.set(g, []).get(g)!).push(r); }
  const keep = new Map<string, (typeof rows)[number]>();
  for (const rs of groups.values()) {
    const byVal = [...rs].sort((a, b) => val(b.p) - val(a.p) || (a.k < b.k ? -1 : 1));
    for (const r of byVal.slice(0, rank.n)) keep.set(r.k, r);
    if (rank.by !== "residual") for (const r of byVal.slice(-rank.n)) keep.set(r.k, r);
  }
  const kept = [...keep.values()];
  return { points: kept.map((r) => r.p), keys: kept.map((r) => r.k) };
}

/** what the caption says about the point layers: what each holds, how much of it was drawn, and as what */
function layerNote(ls: PlotLayer[], unit: "patient" | "sample"): string {
  if (!ls.length) return "";
  const cases = (n: number) => fmt(n) + " " + unit + (n === 1 ? "" : "s");
  const one = (l: PlotLayer) => {
    const shared = l.drawn != null && l.drawn < l.n ? " (" + fmt(l.n - l.drawn) + " drawn by an earlier layer)" : "";
    if (l.kind === "cohort") {
      const where = l.inPlot === l.patients ? fmt(l.patients!) + " patient" + (l.patients === 1 ? "" : "s")
        : fmt(l.inPlot!) + " of its " + fmt(l.patients!) + " patients in the plotted cohort";
      // in patient units, "all" when every patient in the plot had both axes; samples are counted as samples
      const count = unit === "patient" && l.n === l.inPlot ? "all" : cases(l.n);
      const drawn = l.shown === "points" ? count + " drawn as points" + shared
        : l.shown === "density" ? count + " drawn as shaded cells (" + l.why + ")"
        : l.shown === "boxes" ? count + " drawn as a box per group (" + l.why + ")"
        : l.why ? "not drawn: " + l.why : l.inPlot ? "none with a value on both axes" : "none drawn";
      return "“" + l.name + "”: " + where + ", " + drawn;
    }
    if (l.shown !== "points") return l.label + ": not drawn, " + (l.why || "nothing to draw");
    const what = l.kind === "outliers"
      ? (l.cellMax ? cases(l.n) + " in cells holding at most " + l.cellMax + ", left unshaded under them"
        : l.of ? "the " + fmt(l.n) + " most extreme of the " + fmt(l.of) + " values beyond the whiskers (the most points a figure draws)"
        : fmt(l.n) + " value" + (l.n === 1 ? "" : "s") + " beyond the whiskers")
      : cases(l.n);
    return l.label + ": " + what + shared;
  };
  // many cases can share the value at a ranked layer's cut (a fraction of 0 or 1, a count of 0)
  const ranked = ls.some((l) => (l.kind === "extremes" || l.kind === "trend") && l.shown === "points");
  return "Point layers — " + ls.map(one).join("; ") + "." +
    (ranked ? " A ranked layer breaks ties at its cut by case id." : "") +
    (ls.some((l) => l.shown !== "none") ? " The statistics are over the whole plotted cohort." : "");
}

export async function runPlot(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const pv = view as PlotView;
  const cn = vNames[0];
  const sites = cohorts[cn].studies;
  // a point is a sample unless the view asks for patients, as on cBioPortal's Plots tab
  const unit = pv.unit === "patient" ? "patient" as const : "sample" as const;
  // a profile axis is read as the studies describe the profile
  let axes: { x: PlotView["x"]; y: PlotView["y"]; colorBy?: PlotView["x"]; ringBy?: PlotView["x"] };
  try {
    const catalogs = await Promise.all(sites.map(async (st) => ({ study: st, catalog: (await c.studyProfiles(st)).catalog || [] })));
    axes = resolveAxes({ x: pv.x, y: pv.y, colorBy: pv.colorBy, ringBy: pv.ringBy }, catalogs);
    axes = await assayEntitiesKnown(c, axes, sites) as typeof axes;
  } catch (e) { return untimed({ kind: "plot", error: String((e as Error).message || e) }); }
  const spec = { x: axes.x, y: axes.y, unit,
    ...(axes.colorBy ? { colorBy: axes.colorBy } : {}), ...(axes.ringBy ? { ringBy: axes.ringBy } : {}) };
  const bins: [number, number] = Array.isArray(pv.bins) && pv.bins.length === 2
    ? [Number(pv.bins[0]), Number(pv.bins[1])] : DEFAULT_BINS;
  const problem = layersProblem(pv, c, cn);
  if (problem) return untimed({ kind: "plot", error: problem });
  try {
    if (sites.length === 1) {
      const r0 = resolvers[sites[0]];
      const data = await r0.plot(doc.cohorts[cn], { ...spec, bins: pv.bins ? bins : undefined });
      orderLevels(data, spec);
      await basePoints(pv, r0, doc.cohorts[cn], spec, data, sites[0]);
      const ls = await pointLayers(pv, data, c, cn, sites, spec);
      if (ls.length) data.layers = ls;
      if (ls.some((l) => l.kind === "outliers" && l.shown === "points" && data.shape === "box")) data.overlay = "violin";
      // what the pair left out leads: cases missing either axis are not on the figure at all
      const pr: ViewResult = {
        kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [coverageNote(data, unit), combineNote(data, unit), densityNote(data, unit), layerNote(ls, unit)].filter(Boolean).join(" ") || undefined
      };
      return pr;
    } else {
      // Federated: each site answers a smaller, self-contained question (its own extent, its
      // own bin counts against a shared grid, its own six sums, its own contingency cells or
      // box quartiles) and this pools them — the same division of labour co-expression's
      // pairMoments already uses. A participant that cannot answer these yet (a remote MCP
      // peer, today) is named rather than silently skipped.
      const missing = sites.filter((s) => !hasFederatedPlot(resolvers[s]));
      if (missing.length) {
        return untimed({ kind: "plot", error: "a federated plot needs every participant to support it, and " +
          missing.join(", ") + " does not yet (a remote peer over MCP, most likely)." });
      }
      const fr = resolvers as Record<string, Resolver & FederatedPlotCapable>;
      const { xk, yk, shape, xLabel, yLabel } = await fr[sites[0]].plotAxisKinds(spec);
      if (shape === "waterfall") throw new Error("an ordered-cases axis (a waterfall) is not implemented yet; give both axes a source");
      // a box's cases are read by every site against its own metadata, so an axis a site does not
      // declare refuses the view before anything is counted
      if (shape === "box") await Promise.all(sites.slice(1).map((s) => fr[s].plotAxisKinds(spec)));
      const label = { x: { label: xLabel, kind: xk }, y: { label: yLabel, kind: yk } };
      const scaleNote = sites.length + " studies pooled (" + sites.join(", ") + ")";
      // Each site counts its own cases and their axes, whatever the shape. It needs nothing the
      // figure's queries return, so it is asked for once their first round has answered — beside the
      // second, rather than after it, and not at all for a view refused in the first. A failed count
      // fails the view: dropping the coverage note would hide how many cases the figure leaves out.
      let covsP: Promise<NonNullable<PlotData["coverage"]>[]> | undefined;
      const startCoverage = () => {
        if (!covsP) { covsP = Promise.all(sites.map((s) => fr[s].plotCoverage(doc.cohorts[cn], spec, xk, yk))); covsP.catch(() => {}); }
      };
      let data: PlotData;

      if (shape === "scatter") {
        const extents = await Promise.all(sites.map((s) => fr[s].plotExtent(doc.cohorts[cn], spec, xk, yk)));
        startCoverage();
        const have = extents.filter((e) => e.n > 0);
        const n = have.reduce((a, e) => a + e.n, 0);
        if (!n) { data = { shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" }; }
        else {
          // The shared scale every site's bin counts get re-queried against — see
          // plotBinsSql's `extent` parameter. Pooled exactly (min of mins, max of maxes),
          // unlike a quartile, an extent has no approximation to caveat.
          const extent = { x0: Math.min(...have.map((e) => e.x0)), x1: Math.max(...have.map((e) => e.x1)),
            y0: Math.min(...have.map((e) => e.y0)), y1: Math.max(...have.map((e) => e.y1)) };
          const [binParts, momentParts] = await Promise.all([
            Promise.all(sites.map((s) => fr[s].plotBinCounts(doc.cohorts[cn], spec, xk, yk, bins, extent))),
            Promise.all(sites.map((s) => fr[s].plotMoments(doc.cohorts[cn], spec, xk, yk)))
          ]);
          const cellCounts = new Map<string, number>();
          for (const part of binParts) for (const c of part) {
            const key = c.bx + "," + c.by;
            cellCounts.set(key, (cellCounts.get(key) || 0) + c.n);
          }
          const pooledM = momentParts.reduce((a, m) => ({ n: a.n + m.n, sx: a.sx + m.sx, sy: a.sy + m.sy,
            sxy: a.sxy + m.sxy, sxx: a.sxx + m.sxx, syy: a.syy + m.syy }),
            { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 } as Moments);
          const corr = pearsonFromMoments(pooledM), reg = regressionFromMoments(pooledM);
          data = { shape, n, ...label, extent, grid: bins,
            bins: [...cellCounts.entries()].map(([k, cn2]) => {
              const [bx, by] = k.split(",").map(Number); return { bx, by, n: cn2 };
            }),
            stats: { pearson: corr.r, spearman: null, slope: reg.slope, intercept: reg.intercept,
              pPearson: corr.r != null ? corr.p : null, pSpearman: null },
            note: scaleNote + ". Each site reports six sums (n, Σx, Σy, Σxy, Σx², Σy²), exact and additive, for" +
              " Pearson's r and the regression line; the bin grid uses one shared scale (each site's own extent," +
              " pooled) so cells sum correctly. Spearman rank correlation is not reported for a federated plot: it" +
              " needs the pooled GLOBAL ranking, which per-site aggregates cannot reconstruct exactly." };
        }
      } else if (shape === "table") {
        const parts = await Promise.all(sites.map((s) => fr[s].plotTableCells(doc.cohorts[cn], spec, xk, yk)));
        const cellCounts = new Map<string, number>();
        for (const part of parts) for (const c of part) {
          const key = c.cx + "" + c.cy;
          cellCounts.set(key, (cellCounts.get(key) || 0) + c.n);
        }
        const cells = [...cellCounts.entries()].map(([k, n2]) => {
          const [cx, cy] = k.split(""); return { cx, cy, n: n2 };
        }).sort((a, b) => b.n - a.n);
        const n = cells.reduce((a, c) => a + c.n, 0);
        const kx = new Set(cells.map((c) => c.cx)).size, ky = new Set(cells.map((c) => c.cy)).size;
        if (!n) { data = { shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" }; }
        else if (kx > CATEGORY_CAP || ky > CATEGORY_CAP)
          throw new Error("this pair has " + Math.max(kx, ky) + " distinct categories on one axis and " + CATEGORY_CAP +
            " is the most a contingency table stays readable (and testable) at; narrow the cohort or pick another attribute");
        else data = { shape, n, ...label, cells,
          note: scaleNote + ". Contingency counts are exact sums — a category means the same thing whichever" +
            " site records it, so there is no shared-scale question here the way there is for a numeric axis." };
      } else {
        // box: numeric axis grouped by the categorical one, pooled per group
        const groups = poolBoxRows(await Promise.all(sites.map((s) => fr[s].plotBoxRows(doc.cohorts[cn], spec, xk, yk))));
        if (groups.length > CATEGORY_CAP)
          throw new Error("more than " + CATEGORY_CAP + " groups on the categorical axis; narrow the cohort or pick another attribute");
        startCoverage();
        const n = groups.reduce((a, g) => a + g.n, 0);
        data = { shape, n, ...label, groups, overlay: "none",
          note: scaleNote + ". Counts and extremes per group sum exactly; the quartiles are a size-weighted" +
            " approximation across sites (it can shift where an outlier bar falls, never a count)." };
        // Points, unlike a density, just concatenate: each entitled site's own case-level
        // rows are already independent of any shared scale. A site that may not disclose
        // cases contributes none, the same rule the oncoprint's columns follow. A site's points
        // are at least its box's cases, so past the cap in all there is nothing to ask for.
        if (pv.allPoints !== false && n <= POINTS_CAP) {
          const perSite = await peerSafe(sites.map((s) => resolvers[s]), () => Promise.all(sites.map((s) => {
            const rc = plotCasesOf(resolvers[s]);
            return rc ? rc.plotPoints(doc.cohorts[cn], spec) : Promise.resolve([]);
          })), () => []);
          const pts = perSite.every((p) => p) ? perSite.flatMap((p) => p!) : [];
          if (pts.length && pts.length <= POINTS_CAP) {
            data.points = pts; data.overlay = "points";
            data.pointSet = { rule: "all", drawn: pts.length };
            if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
            if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
          }
        }
        // Without the points, a density: every site bins over one shared range, so the counts add.
        // A peer that predates the op leaves the boxes bare and the caption says why.
        if (!data.points && n) {
          const { range, bins: vBins } = pooledViolinRange(groups);
          const box = data;
          await peerSafe(sites.map((s) => resolvers[s]), async () => {
            const violin = poolViolin(await Promise.all(sites.map((s) => fr[s].plotViolinCounts(doc.cohorts[cn], spec, xk, yk, vBins, range))));
            box.violin = violin; box.violinBins = vBins; box.violinExtent = range; box.overlay = "violin";
            if (spec.colorBy) { box.colorLabel = axisLabel(spec.colorBy); box.legend = legendFor(violin.map((v) => v.c || "")); }
            box.note += " The density behind each box is binned by every site over one shared range, the pooled whiskers and up to" +
              " one whisker span beyond them, so its counts add exactly; a value past that range is off the figure and not in it.";
          }, (why) => { box.note += " No density is drawn behind the boxes: " + why + "."; });
        }
      }

      orderLevels(data, spec);
      // the sites' coverage counts sum exactly
      startCoverage();
      const covs = await covsP!;
      data.coverage = covs.reduce<NonNullable<PlotData["coverage"]>>(
        (a, c) => ({ total: a.total + c.total, nx: a.nx + c.nx, ny: a.ny + c.ny, ...(c.multi != null || a.multi != null ? { multi: (a.multi || 0) + (c.multi || 0) } : {}) }),
        { total: 0, nx: 0, ny: 0 });
      const ls = await pointLayers(pv, data, c, cn, sites, spec);
      if (ls.length) data.layers = ls;
      const pr: ViewResult = { kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [coverageNote(data, unit), combineNote(data, unit), data.note, layerNote(ls, unit)].filter(Boolean).join(" ") || undefined };
      return pr;
    }
  } catch (e) {
    return { kind: "plot", error: String((e as Error).message || e) };
  }
}
