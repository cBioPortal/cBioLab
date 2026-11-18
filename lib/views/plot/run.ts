// Plot view: two axes over one cohort's cases, drawn as a scatter, box or contingency table as
// the axes decide; local, or federated where every participant can answer.
import type { ViewResult } from "../../types.ts";
import { pearsonR, regressionFromMoments, type Moments } from "../../stats.ts";
import { plotCasesOf, hasFederatedPlot, legendFor, type Resolver, type FederatedPlotCapable, type PlotCasesCapable } from "../../federation.ts";
import { fromLog, logRuleOf, logScaleExempt, plotExtent, plotRangeOf, type LogRule, type PlotAxis, type PlotCell, type PlotRange } from "../../plot.ts";
import { fitOf, portalBox, ringsAbsence, spearmanRho, corrPValue, AXIS_LABELS, DEFAULT_BINS, CATEGORY_CAP, POINTS_CAP, OUTLIER_CELL_MAX, VIOLIN_BINS, axisLabel, outlierExtremity, tukey, coverageNote, combineNote, sparseCellMax,
  type AxisKind, type HighlightPoint, type PlotData, type PlotGroup, type PlotLayer, type PlotPoint, type PlotRequest, type PointRank,
  type ViolinBin, type Whiskers } from "../../plot.ts";
import { DEFAULT_POINT_LAYERS, LAYER_COLORS, POINT_LAYER_CAP, POINT_RULE_N, POINT_RULE_N_MAX, layerLabel, type PointLayerSpec } from "../../plot-layers.ts";
import { untimed, Untimed, type ViewRun, type DocView } from "../run.ts";
import { resolveAxes } from "../../plot-profile.ts";
import { titledAxes } from "../../clinical-titles.ts";
import { OQL_NOT_PROFILED } from "../../plot-oql.ts";
import { naturalSort } from "./natural-sort.ts";
import { fmtInt, fmtNum } from "../../chart/format.ts";
import { assayEntitiesKnown } from "../shared.ts";
import type { PlotView } from "./types.ts";
import { plotMethod } from "./method.ts";
import { resolveDrivers, type DriverSettings } from "../../driver-settings.ts";

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

/** the most values (a box) or pairs (a scatter) a site hands over for statistics over several studies' cases together */
const POOLED_VALUES_CAP = 50000;

/** one box per group over the values themselves, by the portal's rule (portalBox) */
function poolBoxValues(pts: PlotPoint[]): PlotGroup[] {
  const byGroup = new Map<string, number[]>();
  for (const p of pts) {
    const vs = byGroup.get(p.g);
    if (vs) vs.push(p.v); else byGroup.set(p.g, [p.v]);
  }
  return [...byGroup.entries()].map(([g, vs]) => {
    const b = portalBox(vs)!, t = tukey(b.q1, b.q3, b.lo, b.hi);
    return { g, ...b, loWhisker: t.loWhisker, hiWhisker: t.hiWhisker };
  });
}

type Def = ViewRun["doc"]["cohorts"][string];

/**
 * Every study's (x, y) pairs, for a statistic that needs them ranked together, where every study may
 * show its cases and each has at most POOLED_VALUES_CAP; otherwise why not, for the caption.
 */
async function pooledPairs(sites: string[], resolvers: Record<string, Resolver>, def: Def, spec: PlotRequest, n: number):
  Promise<{ pairs: { x: number; y: number }[]; why?: undefined } | { pairs: null; why: string }> {
  const closed = sites.filter((s) => !plotCasesOf(resolvers[s]));
  if (closed.length) return { pairs: null, why: closed.join(", ") + " may not show individual cases" };
  const perSite = await peerSafe(sites.map((s) => resolvers[s]),
    () => Promise.all(sites.map((s) => plotCasesOf(resolvers[s])!.plotScatterPoints(def, pairsOnly(spec), POOLED_VALUES_CAP))), () => [null]);
  const pairs = perSite.every((p) => p) ? perSite.flatMap((p) => p!) : null;
  if (!pairs) return { pairs: null, why: "not every study handed over its pairs (one past " + fmtInt(POOLED_VALUES_CAP) + ", or a peer that cannot)" };
  if (pairs.length !== n) return { pairs: null, why: "the studies' pairs (" + fmtInt(pairs.length) + ") did not add up to the plotted " + fmtInt(n) };
  return { pairs };
}

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

/** copy-number levels in their own order, as the portal draws them */
const CNA_LEVELS = [AXIS_LABELS.portal.deepDel, AXIS_LABELS.portal.shallowDel, "Diploid", "Gain", "Amplification"];
/** mutation classes in the portal's order (PlotsTabUtils.tsx mutTypeCategoryOrder), then the cases without one */
const MUT_TYPES = ["Missense", "Inframe", "Truncating", "Splice", "Promoter", "Other", "Multiple"];
const NO_MUTATION = [AXIS_LABELS.portal.noMutation, OQL_NOT_PROFILED];

/**
 * The order an axis's categories are drawn in, as the portal's makeBoxScatterPlotData orders a
 * box plot's (PLT-BX-1): a data type with an order of its own keeps it — copy-number levels deep
 * deletion to amplification, mutation classes (Missense, Inframe, Truncating, Splice, Promoter,
 * Other, Multiple, then no mutation and not profiled; each class's Driver before its VUS),
 * Mutated / No mutation / Not profiled, Driver / VUS / … — and any other is alphabetical, by code
 * unit as lodash's sortBy compares strings (`rest`; a contingency table's is naturalSort, as the
 * portal's TablePlot sorts). A category outside a type's order follows it, by `rest` (the portal
 * puts a box's first, an artefact of indexOf, and leaves a table's out). An OQL axis, which the
 * portal does not have, keeps its groups by size; null leaves the order as it is.
 */
export function categoryOrder(cat: PlotRequest["x"], rest: (a: string, b: string) => number = alpha): ((labels: string[]) => string[]) | null {
  const listed = (order: string[]) => (labels: string[]) => {
    const rank = (g: string) => { const i = order.indexOf(g); return i < 0 ? order.length : i; };
    return [...labels].sort((a, b) => rank(a) - rank(b) || rest(a, b));
  };
  if (cat.source === "molecular" && cat.discrete) return listed(CNA_LEVELS);
  if (cat.source === "alteration" && "gene" in cat) {
    if (cat.by === "mutationType") return listed([...MUT_TYPES.flatMap((t) => [t, t + " (Driver)", t + " (VUS)"]), ...NO_MUTATION]);
    if (cat.by === "driver") return listed(["Driver", "VUS", ...NO_MUTATION]);
    // the portal's legend order (PlotsTabUtils.tsx mutationLegendOrder): each class's Driver before its VUS, then none
    if (cat.by === "topMutationType") return listed([...["Promoter", "Splice", "Truncating", "Inframe", "Missense", "Other"]
      .flatMap((t) => t === "Promoter" || t === "Other" ? [t + " (VUS)", t] : [t + " (Driver)", t + " (VUS)", t]),
      "Not mutated", "Not profiled for mutations"]);
    if (cat.by === "copyNumberSv") return listed(["Amplification", "Gain", "Diploid", "Shallow Deletion", "Deep Deletion", "Structural Variant", OQL_NOT_PROFILED]);
    if (cat.by === "cna") return listed(["Deep deletion", "Neutral", "Amplification", OQL_NOT_PROFILED]);
    if (cat.by === "sv") return listed([AXIS_LABELS.portal.sv, AXIS_LABELS.portal.noSv, AXIS_LABELS.portal.svNotProfiled]);
    return listed(["Mutated", ...NO_MUTATION]);
  }
  if (cat.source === "alteration") return "oql" in cat ? null : listed(["Mutated", ...NO_MUTATION]);
  return (labels: string[]) => [...labels].sort(rest);
}
const alpha = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** a box plot's groups in their axis's category order; a contingency table's rows and columns in theirs (PLT-TB-3) */
function orderLevels(data: PlotData, spec: PlotRequest): void {
  if (data.shape === "table" && data.cells) {
    const along = (axis: PlotRequest["x"], key: "cx" | "cy") => categoryOrder(axis, naturalSort)?.([...new Set(data.cells!.map((c) => c[key]))]);
    const x = along(spec.x, "cx"), y = along(spec.y, "cy");
    if (x || y) data.order = { ...(x ? { x } : {}), ...(y ? { y } : {}) };
    return;
  }
  const cat = data.x.kind === "cat" ? spec.x : spec.y;
  if (data.shape !== "box" || !data.groups) return;
  const order = categoryOrder(cat);
  if (!order) return;
  const at = new Map(order(data.groups.map((g) => g.g)).map((g, i) => [g, i]));
  data.groups = [...data.groups].sort((a, b) => at.get(a.g)! - at.get(b.g)!);
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
    colourKey(data, spec, all);
    return;
  }
  const all = await rc.plotScatterPoints(def, spec);
  if (!all || !all.length) return;
  data.xyPoints = all;
  data.pointSet = { rule: "all", drawn: all.length };
  colourKey(data, spec, all);
}

/** the request without its colour and ring: a statistic over the pairs needs neither */
function pairsOnly(spec: PlotRequest): PlotRequest {
  const rest = { ...spec };
  delete rest.colorBy; delete rest.ringBy;
  return rest;
}

/** the key to points coloured and ringed by a category, a box's or a scatter's, titled by the axes they come from (PLT-CL-8, PLT-SC-6) */
function colourKey(data: PlotData, spec: PlotRequest, pts: { c?: string; r?: string }[]): void {
  // a participant that predates coloured points answers without the categories: said, not drawn plain
  const unanswered = [spec.colorBy && pts.every((x) => x.c === undefined) ? "colour" : "", spec.ringBy && pts.every((x) => x.r === undefined) ? "ring" : ""].filter(Boolean);
  if (pts.length && unanswered.length) data.colourNote = "The points are not coloured: the study's participant answered without their " + unanswered.join(" and ") + " categories.";
  if (spec.colorBy && !unanswered.includes("colour")) { data.legend = legendFor(pts.map((x) => x.c || ""), false, spec.colorBy); data.colorLabel = axisLabel(spec.colorBy); }
  if (spec.ringBy && !unanswered.includes("ring")) { data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true, spec.ringBy)]; data.ringLabel = axisLabel(spec.ringBy);
    if (ringsAbsence(spec.ringBy)) data.ringAbsent = true;
  }
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

/** a box plot's point layers without the cases of the categories its filter leaves out */
function keptLayers(ls: PlotLayer[], data: PlotData, pv: PlotView): PlotLayer[] {
  if (data.shape !== "box" || !pv.categories || !pv.categories.length) return ls;
  const keep = new Set(pv.categories);
  const inKept = (p: HighlightPoint) => !("g" in p) || keep.has(p.g);
  return ls.map((l) => {
    const keptShared = (l.shared || []).map((p, i) => [p, i] as const).filter(([p]) => inKept(p));
    return { ...l, ...(l.points ? { points: l.points.filter(inKept) } : {}),
      ...(l.shared ? { shared: keptShared.map(([p]) => p), ...(l.sharedOwners ? { sharedOwners: keptShared.map(([, i]) => l.sharedOwners![i]) } : {}) } : {}) };
  });
}

/** what is wrong with the view's category filter, or null */
function categoriesProblem(pv: PlotView): string | null {
  const cats = pv.categories;
  if (cats != null && (!Array.isArray(cats) || cats.some((x) => typeof x !== "string")))
    return "categories lists the categories whose boxes are drawn, as strings";
  if (cats && cats.length > CATEGORY_CAP) return "categories takes at most " + CATEGORY_CAP + " categories; this lists " + cats.length;
  return null;
}

/**
 * A box plot's "Filter categories" and "Sort Categories by Median", after the category order, as
 * the portal applies them (PlotsTab.tsx:5396-5419): only the chosen categories' boxes and points;
 * then the boxes by ascending median of their raw values (a log axis's points converted back),
 * equal medians keeping the category order. A plot that is not a box refuses sortByMedian.
 */
function applyCategoryChoices(data: PlotData, pv: PlotView): void {
  if (pv.sortByMedian && data.shape !== "box") throw new Error("sortByMedian applies to a box plot; this pair is drawn as a " + data.shape);
  if (data.shape !== "box" || !data.groups) return;
  // every category, for the filter to offer: alphabetical, as the portal lists them
  data.categoryOptions = data.groups.map((g) => g.g).sort(alpha);
  const notes: string[] = [];
  const keep = pv.categories && pv.categories.length ? new Set(pv.categories) : null;
  if (keep) {
    const kept = data.groups.filter((g) => keep.has(g.g));
    if (!kept.length) notes.push("None of the chosen categories (" + pv.categories!.slice(0, 8).join(", ") + (pv.categories!.length > 8 ? ", …" : "") + ") is in the plot.");
    else notes.push("Filtered to " + kept.length + " of " + data.groups.length + " categories: " + kept.map((g) => g.g).join(", ") + ".");
    data.groups = kept;
    data.n = kept.reduce((a, g) => a + g.n, 0);
    if (data.points) data.points = data.points.filter((p) => keep.has(p.g));
    if (data.violin) data.violin = data.violin.filter((v) => keep.has(v.g));
  }
  if (pv.sortByMedian && data.groups.length > 1) {
    // the raw values' median, from the points where they are drawn (a log axis's converted back);
    // without points, the box's own median, which a log scale orders the same way but for an even count
    const numSide = data.x.kind === "num" ? data.x : data.y;
    const rule = numSide.log;
    const byGroup = new Map<string, number[]>();
    for (const p of data.points || []) (byGroup.get(p.g) ?? byGroup.set(p.g, []).get(p.g)!).push(rule ? fromLog(rule, p.v) : p.v);
    const medianOf = (g: PlotGroup) => {
      const vs = byGroup.get(g.g);
      return vs && vs.length === g.n ? portalBox(vs)!.median : rule ? fromLog(rule, g.median) : g.median;
    };
    const at = new Map(data.groups.map((g, i) => [g.g, i]));
    data.groups = [...data.groups].sort((a, b) => medianOf(a) - medianOf(b) || at.get(a.g)! - at.get(b.g)!);
    data.order = { ...(data.order || {}), [data.x.kind === "num" ? "y" : "x"]: data.groups.map((g) => g.g) };
    notes.push("Boxes are ordered by their median, lowest first.");
  }
  if (notes.length) data.categoryNote = notes.join(" ");
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
  if (unable.length) return { layer: { ...head, inPlot: 0, n: 0, shown: "none", why: unable.join(", ") + " cannot answer a cohort layer (a remote federation peer, most likely)" } };
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
 * A rule layer, from participants that may all show cases. Outliers are a box's values beyond its
 * whiskers at any size, and a single study's crowded scatter's cases in sparse cells.
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
    // a box's outliers are its values beyond the whiskers, at any size and whether its cases are
    // points or density; a scatter's are the cases in sparse cells, which a grid only has when crowded
    if (data.shape === "box") {
      if (budget <= 0) return none("the earlier layers used every point the figure draws");
      const whiskers = data.groups || [];
      // each group's most extreme by value at either end, which holds its `n` most extreme outliers
      const ranked = async (n: number) => gather(await Promise.all(entitled.map((r) =>
        r.plotRankedPoints(def, spec, xk, yk, { by: xk === "num" ? "x" : "y", n }))), sites);
      if (l.n != null) {
        const total = (await Promise.all(entitled.map((r) => r.plotOutlierPoints(def, spec, 1, whiskers)))).reduce((a, p) => a + p.total, 0);
        const n = l.n, c = await ranked(n);
        const { points, keys, trimmed } = groupOutliers(c.points, c.keys, whiskers, () => n, budget);
        return { layer: { kind, ...base, n: points.length, shown: "points", points, perGroup: l.n,
          ...(total > points.length ? { of: total } : {}), ...(trimmed ? { trimmed } : {}) }, keys };
      }
      // each site's most extreme `budget`, pooled into the overall most extreme `budget`: exact,
      // as the ranked layers are, and the caption says how many it left out
      const pooled = pooledOutliers(
        await Promise.all(entitled.map((r) => r.plotOutlierPoints(def, spec, budget, whiskers))), sites, whiskers, budget);
      if (pooled.total <= budget) return { layer: { kind, ...base, n: pooled.points.length, shown: "points", points: pooled.points }, keys: pooled.keys };
      // past the budget, ranked overall a group with milder outliers could draw none: each group's
      // own most extreme join the overall ones, and the budget is shared out between the groups.
      // Each group's candidates are exact as far as the longer of the two lists reaches into it.
      const own = await ranked(POINT_RULE_N_MAX);
      const reach = new Map<string, number>();
      for (const p of pooled.points) reach.set(p.g, (reach.get(p.g) || 0) + 1);
      const { points, keys } = groupOutliers([...pooled.points, ...own.points], [...pooled.keys, ...own.keys], whiskers,
        (g) => Math.max(POINT_RULE_N_MAX, reach.get(g) || 0), budget);
      return { layer: { kind, ...base, n: points.length, shown: "points", points, of: pooled.total }, keys };
    }
    if (data.n <= POINTS_CAP) return none("on a scatter, outliers are the cases in near-empty cells of a crowded density, and at " + fmt(data.n) +
      " cases (at most " + fmt(POINTS_CAP) + ") nearly every cell is near-empty; the trend layer marks the cases furthest from the fitted line instead");
    const cap = Math.min(budget, l.n ?? budget);
    if (sites.length > 1) return none("a pooled scatter's sparse cells are known only after pooling, and no study can be asked for them yet");
    if (!data.bins || !data.grid || !data.extent) return none("the plot has no density to find sparse cells in");
    const cellMax = sparseCellMax(data.bins, cap, OUTLIER_CELL_MAX);
    if (!cellMax) return none("the cases alone in a cell are more than the " + fmt(cap) + " points " + (cap < budget ? "the layer asks for" : "left to draw"));
    const pts = await entitled[0].plotScatterPoints(def, spec, cap, { grid: data.grid, extent: data.extent, cellMax });
    if (!pts) return none("the sparse cells hold more than " + fmt(cap) + " cases");
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

/**
 * A box's outliers chosen group by group: each group's candidates beyond its whiskers, furthest first
 * (outlierExtremity, ties by study and case), at most `limit(group)` of them; then `budget` shared out,
 * so a group with fewer than an even share keeps them all and the rest is split between the others.
 * `trimmed` says a group drew fewer than its limit allowed. A case listed twice counts once.
 */
export function groupOutliers(points: HighlightPoint[], keys: string[], whiskers: Whiskers[], limit: (g: string) => number, budget: number):
  { points: PlotPoint[]; keys: string[]; trimmed: boolean } {
  const at = new Map(whiskers.map((w) => [w.g, w]));
  const byGroup = new Map<string, { p: PlotPoint; k: string; e: number }[]>();
  const seen = new Set<string>();
  points.forEach((p, i) => {
    if (!("g" in p) || seen.has(keys[i])) return;
    const w = at.get(p.g);
    const e = w ? outlierExtremity(p.v, w) : 0;
    if (e <= 0) return;
    seen.add(keys[i]);
    (byGroup.get(p.g) ?? byGroup.set(p.g, []).get(p.g)!).push({ p: { id: p.id, g: p.g, v: p.v }, k: keys[i], e });
  });
  const groups = [...byGroup.entries()]
    .map(([g, rs]) => rs.sort((a, b) => b.e - a.e || (a.k < b.k ? -1 : 1)).slice(0, limit(g)))
    // smallest first, so a group under its share hands what it leaves on to the larger ones
    .sort((a, b) => a.length - b.length || (a[0].p.g < b[0].p.g ? -1 : 1));
  let left = Math.max(0, budget), trimmed = false;
  const kept = groups.flatMap((rs, i) => {
    const take = Math.min(rs.length, Math.ceil(left / (groups.length - i)));
    left -= take;
    if (take < rs.length) trimmed = true;
    return rs.slice(0, take);
  });
  return { points: kept.map((r) => r.p), keys: kept.map((r) => r.k), trimmed };
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
    const values = (n: number) => fmt(n) + " value" + (n === 1 ? "" : "s");
    const what = l.kind === "outliers"
      ? (l.cellMax ? cases(l.n) + " in cells holding at most " + l.cellMax + ", left unshaded under them"
        : l.perGroup ? "each group's " + fmt(l.perGroup) + " most extreme beyond the whiskers, " + values(l.n) +
          (l.of ? " of " + fmt(l.of) : "") + (l.trimmed ? " (fewer in the largest groups, so every group fits in the points a figure draws)" : "")
        : l.of ? "the " + fmt(l.n) + " most extreme of the " + fmt(l.of) + " values beyond the whiskers (the most points a figure draws, " +
          "shared between the groups so each draws its own most extreme)"
        : values(l.n) + " beyond the whiskers")
      : cases(l.n);
    return l.label + ": " + what + shared;
  };
  // many cases can share the value at a ranked layer's cut (a fraction of 0 or 1, a count of 0)
  const ranked = ls.some((l) => (l.kind === "extremes" || l.kind === "trend") && l.shown === "points");
  return "Point layers — " + ls.map(one).join("; ") + "." +
    (ranked ? " A ranked layer breaks ties at its cut by case id." : "") +
    (ls.some((l) => l.shown !== "none") ? " The statistics are over the whole plotted cohort." : "");
}

/**
 * A plot by cohort: the plot run once per cohort, its x axis that cohort's name, and the answers
 * laid side by side, a box (or a contingency column) per cohort. Point layers, colour and ring are
 * refused: each is decided over one cohort's cases. The cases are drawn from every cohort or from
 * none, and a density, binned over each cohort's own range, is not drawn.
 */
/** marks the per-cohort runs of a plot by cohort; a document cannot carry a Symbol key */
const ONE_COHORT = Symbol("one cohort of a plot by cohort");

async function runPlotByCohort(pv: PlotView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { cohorts, vNames, participationFor } = c;
  if (pv.colorBy || pv.ringBy || (Array.isArray(pv.points) && pv.points.length))
    return untimed({ kind: "plot", error: "a plot by cohort draws each cohort's cases plainly: colorBy, ringBy and point layers are not offered with it" });
  if (!vNames.length) return untimed({ kind: "plot", error: "a plot by cohort needs the cohorts it compares" });
  const unit = pv.unit === "patient" ? "patient" as const : "sample" as const;
  const parts: PlotData[] = [];
  for (const n of vNames) {
    const r0 = await runPlot({ ...pv, x: { source: "cohort", label: n }, points: [], cohorts: [n], [ONE_COHORT]: true } as unknown as DocView,
      { ...c, vNames: [n], vStudies: cohorts[n].studies });
    const r = (r0 instanceof Untimed ? r0.result : r0) as { error?: string; plot?: PlotData };
    if (r.error || !r.plot) return untimed({ kind: "plot", error: (vNames.length > 1 ? n + ": " : "") + (r.error || "no plot") });
    parts.push(r.plot);
  }
  const first = parts[0];
  const n = parts.reduce((a, d) => a + d.n, 0);
  const data: PlotData = { shape: first.shape, n, x: first.x, y: first.y };
  if (first.shape === "table") data.cells = parts.flatMap((d) => d.cells || []);
  else {
    data.groups = parts.flatMap((d) => d.groups || []);
    const drawn = parts.reduce((a, d) => a + (d.points?.length || 0), 0);
    if (parts.every((d) => d.points?.length || !d.n) && drawn && drawn <= POINTS_CAP) {
      data.points = parts.flatMap((d) => d.points || []);
      data.overlay = "points"; data.pointSet = { rule: "all", drawn };
    } else {
      data.overlay = "none";
      const why = parts.map((d) => d.pointSet?.why).find(Boolean) || (drawn > POINTS_CAP ? "more than " + fmt(POINTS_CAP) + " values" : undefined);
      data.pointSet = { rule: "none", drawn: 0, ...(why ? { why } : {}) };
    }
  }
  data.coverage = parts.reduce<NonNullable<PlotData["coverage"]>>((a, d) => ({
    total: a.total + (d.coverage?.total ?? d.n), nx: a.nx + (d.coverage?.nx ?? d.n), ny: a.ny + (d.coverage?.ny ?? d.n),
    ...(d.coverage?.multi != null || a.multi != null ? { multi: (a.multi || 0) + (d.coverage?.multi || 0) } : {}) }), { total: 0, nx: 0, ny: 0 });
  const studies = [...new Set(vNames.flatMap((x) => cohorts[x].studies))];
  const cases = data.points ? "" : data.shape === "box" && n
    ? "Each cohort's values are drawn as its box alone" + (data.pointSet?.why ? ": no case is drawn as a point (" + data.pointSet.why + ")." : ".") : "";
  return {
    kind: "plot", plot: data, cohorts: vNames, studies, participation: participationFor(studies, false),
    method: plotMethod({ cohort: vNames.join(", "), studies, unit, data }),
    note: [coverageNote(data, unit), combineNote(data, unit), cases,
      vNames.length > 1 ? "One " + (data.shape === "table" ? "column" : "box") + " per cohort; a " + unit + " in more than one cohort is in each." : ""]
      .filter(Boolean).join(" ") || undefined
  };
}

type Axes = { x: PlotView["x"]; y: PlotView["y"]; colorBy?: PlotView["x"]; ringBy?: PlotView["x"] };
/** an axis that tells Driver from VUS, or splits mutation types by it */
const drivenAxis = (a: PlotView["x"] | undefined): boolean =>
  !!a && a.source === "alteration" && "gene" in a && (a.by === "driver" || a.by === "mutationType");

/**
 * The view's driver sources, carried on each axis that calls drivers, so every participant
 * computing the axis applies the same rule. Only the sources: hiding VUS or germline does not
 * apply to a plot, as it does not on cBioPortal's Plots tab. An axis that names its own keeps
 * them; a Driver-vs-VUS axis with none takes the defaults (lib/plot.ts).
 */
export function withDrivers(axes: Axes, drivers: DriverSettings | undefined): Axes {
  resolveDrivers(drivers);
  const sources: DriverSettings = {};
  if (drivers?.oncokb === false) sources.oncokb = false;
  if (drivers?.hotspots === false) sources.hotspots = false;
  if (drivers?.custom === false) sources.custom = false;
  if (drivers?.tiers) sources.tiers = drivers.tiers;
  const put = (a: PlotView["x"] | undefined) => a && drivers && drivenAxis(a) && !("drivers" in a && a.drivers)
    ? { ...a, drivers: sources } as PlotView["x"] : a;
  return { x: put(axes.x)!, y: put(axes.y)!, ...(axes.colorBy ? { colorBy: put(axes.colorBy) } : {}), ...(axes.ringBy ? { ringBy: put(axes.ringBy) } : {}) };
}

/** a caption line when the view's settings hide what a plot nonetheless draws */
function driverNote(drivers: DriverSettings | undefined, spec: Axes): string {
  if (!drivers || !(drivers.hideVus || drivers.hideGermline)) return "";
  const hidden = [drivers.hideVus ? "mutations of unknown significance" : "", drivers.hideGermline ? "germline mutations" : ""].filter(Boolean).join(" and ");
  return [spec.x, spec.y, spec.colorBy, spec.ringBy].some((a) => a && a.source === "alteration")
    ? "The page's settings hide " + hidden + " elsewhere; this plot includes them, as cBioPortal's Plots tab does." : "";
}

export async function runPlot(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const pv = view as PlotView;
  if (pv.x && pv.x.source === "cohort" && !(view as unknown as Record<symbol, unknown>)[ONE_COHORT]) return runPlotByCohort(pv, c);
  const cn = vNames[0];
  const sites = cohorts[cn].studies;
  // a point is a sample unless the view asks for patients, as on cBioPortal's Plots tab
  const unit = pv.unit === "patient" ? "patient" as const : "sample" as const;
  // a profile axis is read as the studies describe the profile
  let axes: Axes;
  let range: PlotRange | undefined;
  try {
    const catalogs = await Promise.all(sites.map(async (st) => ({ study: st, catalog: (await c.studyProfiles(st)).catalog || [] })));
    axes = resolveAxes({ x: pv.x, y: pv.y, colorBy: pv.colorBy, ringBy: pv.ringBy }, catalogs);
    axes = await assayEntitiesKnown(c, axes, sites) as typeof axes;
    axes = withDrivers(axes, pv.drivers);
    axes = await titledAxes(axes, resolvers, sites);
    range = plotRangeOf(pv.range, axisLogs(axes));
  } catch (e) { return untimed({ kind: "plot", error: String((e as Error).message || e) }); }
  let spec = { x: axes.x, y: axes.y, unit,
    ...(axes.colorBy ? { colorBy: axes.colorBy } : {}), ...(axes.ringBy ? { ringBy: axes.ringBy } : {}), ...(range ? { range } : {}) };
  let logs: LogChecks;
  try {
    logs = await checkLogScales(spec, sites, resolvers, doc.cohorts[cn]);
    spec = { ...spec, x: logs.x?.off ? withoutLog(spec.x) : spec.x, y: logs.y?.off ? withoutLog(spec.y) : spec.y };
  } catch (e) { return untimed({ kind: "plot", error: String((e as Error).message || e) }); }
  const bins: [number, number] = Array.isArray(pv.bins) && pv.bins.length === 2
    ? [Number(pv.bins[0]), Number(pv.bins[1])] : DEFAULT_BINS;
  const problem = layersProblem(pv, c, cn) ?? categoriesProblem(pv);
  if (problem) return untimed({ kind: "plot", error: problem });
  try {
    if (sites.length === 1) {
      const r0 = resolvers[sites[0]];
      const data = await r0.plot(doc.cohorts[cn], { ...spec, bins: pv.bins ? bins : undefined });
      if (!pv.regression) delete data.fit;
      orderLevels(data, spec);
      await basePoints(pv, r0, doc.cohorts[cn], spec, data, sites[0]);
      applyCategoryChoices(data, pv);
      const ls = await pointLayers(pv, data, c, cn, sites, spec);
      if (ls.length) data.layers = keptLayers(ls, data, pv);
      if (data.n > POINTS_CAP && ls.some((l) => l.kind === "outliers" && l.shown === "points" && data.shape === "box")) data.overlay = "violin";
      markLogOff(data, logs);
      // what the pair left out leads: cases missing either axis are not on the figure at all
      const pr: ViewResult = {
        kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [logNote(logs, data), coverageNote(data, unit), combineNote(data, unit), densityNote(data, unit), data.colourNote, data.categoryNote, layerNote(ls, unit), driverNote(pv.drivers, spec)].filter(Boolean).join(" ") || undefined,
        method: plotMethod({ cohort: cn, studies: sites, unit, data })
      };
      return pr;
    } else {
      // Federated: each site answers a smaller, self-contained question (its own extent, its
      // own bin counts against a shared grid, its own six sums, its own contingency cells or
      // box quartiles) and this pools them — the same division of labour co-expression's
      // pairMoments already uses. A participant that cannot answer these yet (a remote federation
      // peer, today) is named rather than silently skipped.
      const missing = sites.filter((s) => !hasFederatedPlot(resolvers[s]));
      if (missing.length) {
        return untimed({ kind: "plot", error: "a federated plot needs every participant to support it, and " +
          missing.join(", ") + " does not yet (a remote federation peer, most likely)." });
      }
      const fr = resolvers as Record<string, Resolver & FederatedPlotCapable>;
      const { xk, yk, shape, xLabel, yLabel, colorLabel: siteColorLabel } = await fr[sites[0]].plotAxisKinds(spec);
      if (shape === "waterfall") throw new Error("an ordered-cases axis (a waterfall) is not implemented yet; give both axes a source");
      const lr = axisLogs(spec);
      const label = { x: { label: xLabel, kind: xk, ...(lr.x ? { log: lr.x } : {}) }, y: { label: yLabel, kind: yk, ...(lr.y ? { log: lr.y } : {}) } };
      const scaleNote = sites.length + " studies pooled (" + sites.join(", ") + ")";
      let data: PlotData;
      let moments: (Moments & { study: string })[] | undefined;

      if (shape === "scatter") {
        const extents = await Promise.all(sites.map((s) => fr[s].plotExtent(doc.cohorts[cn], spec, xk, yk)));
        const have = extents.filter((e) => e.n > 0);
        const n = have.reduce((a, e) => a + e.n, 0);
        if (!n) { data = { shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" }; }
        else {
          // The shared scale every site's bin counts get re-queried against — see
          // plotBinsSql's `extent` parameter. Pooled exactly (min of mins, max of maxes),
          // unlike a quartile, an extent has no approximation to caveat.
          const extent = plotExtent({ x0: Math.min(...have.map((e) => e.x0)), x1: Math.max(...have.map((e) => e.x1)),
            y0: Math.min(...have.map((e) => e.y0)), y1: Math.max(...have.map((e) => e.y1)) }, spec.range, axisLogs(spec));
          const [binParts, momentParts] = await Promise.all([
            Promise.all(sites.map((s) => fr[s].plotBinCounts(doc.cohorts[cn], spec, xk, yk, bins, extent))),
            Promise.all(sites.map((s) => fr[s].plotMoments(doc.cohorts[cn], spec, xk, yk)))
          ]);
          moments = momentParts.map((m, i) => ({ ...m, study: sites[i] }));
          const cells = new Map<string, PlotCell>();
          for (const part of binParts) for (const c of part) {
            const key = c.bx + "," + c.by, had = cells.get(key);
            cells.set(key, had ? poolCells(had, c) : { ...c });
          }
          const pooledM = momentParts.reduce((a, m) => ({ n: a.n + m.n, sx: a.sx + m.sx, sy: a.sy + m.sy,
            sxy: a.sxy + m.sxy, sxx: a.sxx + m.sxx, syy: a.syy + m.syy }),
            { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 } as Moments);
          const pearson = pearsonR(pooledM), reg = regressionFromMoments(pooledM);
          const pairs = await pooledPairs(sites, resolvers, doc.cohorts[cn], spec, n);
          const spearman = pairs.pairs ? spearmanRho(pairs.pairs.map((p) => p.x), pairs.pairs.map((p) => p.y)) : null;
          data = { shape, n, ...label, extent, grid: bins, ...(pv.regression ? fitOf(pooledM) : {}),
            bins: [...cells.values()],
            stats: { pearson, spearman, slope: reg.slope, intercept: reg.intercept,
              pPearson: corrPValue(pearson, n), pSpearman: corrPValue(spearman, n) },
            note: scaleNote + ". Each site reports six sums (n, Σx, Σy, Σxy, Σx², Σy²), exact and additive, for" +
              " Pearson's r and the regression line; the bin grid uses one shared scale (each site's own extent," +
              " pooled) so cells sum correctly. " + (pairs.pairs
                ? "Spearman's rank correlation is over every study's pairs ranked together, as the portal ranks them."
                : "Spearman's rank correlation is not reported: it needs every study's pairs ranked together, and " + pairs.why + ".") };
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
        let groups = poolBoxRows(await Promise.all(sites.map((s) => fr[s].plotBoxRows(doc.cohorts[cn], spec, xk, yk))));
        if (groups.length > CATEGORY_CAP)
          throw new Error("more than " + CATEGORY_CAP + " groups on the categorical axis; narrow the cohort or pick another attribute");
        const n = groups.reduce((a, g) => a + g.n, 0);
        // Every value of every site, where each may show its cases: the boxes are then computed over
        // the pooled values, as the portal computes them, and the same rows are the points. A site
        // past its cap answers null, and then no site's values are used.
        const closed = sites.filter((s) => !plotCasesOf(resolvers[s]));
        const perSite = closed.length ? [null] : await peerSafe(sites.map((s) => resolvers[s]),
          () => Promise.all(sites.map((s) => plotCasesOf(resolvers[s])!.plotPoints(doc.cohorts[cn], spec, POOLED_VALUES_CAP))), () => [null]);
        const pts = perSite.every((p) => p) ? perSite.flatMap((p) => p!) : [];
        const exact = pts.length === n ? poolBoxValues(pts) : null;
        if (exact) groups = exact;
        data = { shape, n, ...label, groups, overlay: "none", quartiles: exact ? "pooled" : "weighted",
          note: scaleNote + (exact
            ? ". Each group's box is computed over every study's values together, as the portal computes it."
            : ". Counts and extremes per group sum exactly; the quartiles are a size-weighted approximation across sites" +
              " (it can shift where an outlier bar falls, never a count), because " +
              (closed.length ? closed.join(", ") + " may not show individual values." : "not every site handed over its values (one past " + fmtInt(POOLED_VALUES_CAP) + ", or a peer that cannot).")) };
        // Points, unlike a density, just concatenate: each site's own case-level rows are already
        // independent of any shared scale. They are drawn from every site or from none: a site that
        // may not show cases leaves the boxes to the pooled density, and the caption names it.
        if (pv.allPoints !== false && closed.length) data.note += " Cases are not drawn as points: " + closed.join(", ") + " may not show individual cases.";
        else if (pv.allPoints !== false) {
          if (pts.length && pts.length <= POINTS_CAP) {
            data.points = pts; data.overlay = "points";
            data.pointSet = { rule: "all", drawn: pts.length };
            colourKey(data, spec, pts);
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
            if (spec.colorBy) { box.colorLabel = spec.colorBy.source === "clinical" && !spec.colorBy.label && siteColorLabel ? siteColorLabel : axisLabel(spec.colorBy); box.legend = legendFor(violin.map((v) => v.c || ""), false, spec.colorBy); }
            box.note += " The density behind each box is binned by every site over one shared range, the pooled whiskers and up to" +
              " one whisker span beyond them, so its counts add exactly; a value past that range is off the figure and not in it.";
          }, (why) => { box.note += " No density is drawn behind the boxes: " + why + "."; });
        }
      }

      orderLevels(data, spec);
      applyCategoryChoices(data, pv);
      // each site counts its own cases and their axes; the sums are exact. A failed count fails the
      // view: dropping the coverage note would hide how many cases the figure leaves out
      const covs = await Promise.all(sites.map((s) => fr[s].plotCoverage(doc.cohorts[cn], spec, xk, yk)));
      data.coverage = covs.reduce<NonNullable<PlotData["coverage"]>>(
        (a, c) => ({ total: a.total + c.total, nx: a.nx + c.nx, ny: a.ny + c.ny, ...(c.multi != null || a.multi != null ? { multi: (a.multi || 0) + (c.multi || 0) } : {}) }),
        { total: 0, nx: 0, ny: 0 });
      const ls = await pointLayers(pv, data, c, cn, sites, spec);
      if (ls.length) data.layers = keptLayers(ls, data, pv);
      markLogOff(data, logs);
      const pr: ViewResult = { kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [logNote(logs, data), coverageNote(data, unit), combineNote(data, unit), data.note, data.colourNote, data.categoryNote, layerNote(ls, unit)].filter(Boolean).join(" ") || undefined,
        method: plotMethod({ cohort: cn, studies: sites, unit, data, moments }) };
      return pr;
    }
  } catch (e) {
    return { kind: "plot", error: String((e as Error).message || e) };
  }
}

/** the log rule each axis is drawn with, if any */
function axisLogs(spec: { x: PlotAxis; y: PlotAxis }): { x?: LogRule; y?: LogRule } {
  return { x: logRuleOf(spec.x), y: logRuleOf(spec.y) };
}

/** what became of an axis's log scale: turned off for its negative values (the lowest given), or kept with `negatives` of them drawn at 0 */
type LogCheck = { off: true; min: number } | { off?: false; negatives: number };
type LogChecks = { x?: LogCheck; y?: LogCheck };

const withoutLog = (a: PlotAxis): PlotAxis => { const { log: _, ...rest } = a as PlotAxis & { log?: boolean }; return rest as PlotAxis; };

/**
 * cBioPortal's Plots tab offers no log scale on an axis with negative values (logScalePossible,
 * PLT-AX-4, PLT-MD-11) but an RNA-seq profile's, which log2(max(v, 0) + 1) draws at 0. Each
 * log axis's values over the cohort are read first, on every site, so the plot can follow that rule
 * and say what it did.
 */
async function checkLogScales(spec: PlotRequest, sites: string[], resolvers: Record<string, Resolver>, def: Def): Promise<LogChecks> {
  const out: LogChecks = {};
  for (const side of ["x", "y"] as const) {
    const a = spec[side];
    if (!logRuleOf(a)) continue;
    const rs = sites.map((s) => resolvers[s] as Resolver & Partial<FederatedPlotCapable>);
    if (!rs.every((r) => typeof r.plotAxisNegatives === "function")) continue;
    const parts = await Promise.all(rs.map((r) => r.plotAxisNegatives!(def, withoutLog(a), spec.unit)));
    const mins = parts.map((p) => p.min).filter((m): m is number => m != null);
    const negatives = parts.reduce((t, p) => t + p.negatives, 0);
    if (!negatives) continue;
    out[side] = logScaleExempt(a) ? { negatives } : { off: true, min: Math.min(...mins) };
  }
  return out;
}

/** which axes the view asks a log scale of and are drawn linear, so the page shows their Log scale unchecked and disabled */
function markLogOff(d: PlotData, logs: LogChecks): void {
  const off = { ...(logs.x?.off ? { x: logs.x.min } : {}), ...(logs.y?.off ? { y: logs.y.min } : {}) };
  if (Object.keys(off).length) d.logOff = off;
}

/** the caption's account of a log scale the rule turned off or kept */
function logNote(logs: LogChecks, d: PlotData): string {
  return (["x", "y"] as const).map((side) => {
    const c = logs[side];
    if (!c) return "";
    const name = d[side].label;
    if (c.off) return name + " has values below 0 (the lowest " + fmtNum(c.min) + "), so it is drawn on a linear scale: cBioPortal's Plots tab offers a log scale on such an axis only for an RNA-seq profile.";
    return fmtNum(c.negatives) + " " + name + " value" + (c.negatives === 1 ? " is" : "s are") + " below 0 and drawn at 0, as cBioPortal's log2(max(value, 0) + 1) draws them.";
  }).filter(Boolean).join(" ");
}

/** one density cell from two sites: the counts add, the extremes are the outer ones */
function poolCells(a: PlotCell, b: PlotCell): PlotCell {
  const lo = (u?: number, v?: number) => u == null ? v : v == null ? u : Math.min(u, v);
  const hi = (u?: number, v?: number) => u == null ? v : v == null ? u : Math.max(u, v);
  return { bx: a.bx, by: a.by, n: a.n + b.n, minX: lo(a.minX, b.minX), maxX: hi(a.maxX, b.maxX), minY: lo(a.minY, b.minY), maxY: hi(a.maxY, b.maxY) };
}
