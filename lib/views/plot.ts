// Plot view: two axes over one cohort's cases, drawn as a scatter, box or contingency table as
// the axes decide; local, or federated where every participant can answer.
import type { PlotView, ViewResult } from "../types.ts";
import { pearsonFromMoments, regressionFromMoments, type Moments } from "../stats.ts";
import { isPatientLevel, hasFederatedPlot, legendFor, type Resolver, type FederatedPlotCapable } from "../federation.ts";
import { DEFAULT_BINS, CATEGORY_CAP, POINTS_CAP, HIGHLIGHT_CAP, HIGHLIGHT_COLORS, OUTLIER_CELL_MAX, tukey, coverageNote, sparseCellMax,
  type PlotData, type PlotGroup, type PlotHighlight, type PlotRequest } from "../plot.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";

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

/**
 * The view's highlight cohorts, each drawn over the plotted one: points when every study it
 * draws from may show cases and there are at most POINTS_CAP of them, otherwise the same cases
 * as an aggregate on the plot's own scale (cells on the scatter's grid, a box per group). A
 * highlight is never cut to its first POINTS_CAP cases.
 */
async function highlightLayers(pv: PlotView, data: PlotData, c: ViewRun, cn: string, sites: string[],
  spec: PlotRequest): Promise<PlotHighlight[]> {
  const names = pv.highlight || [];
  if (!names.length) return [];
  const missing = sites.filter((s) => !hasFederatedPlot(c.resolvers[s]));
  if (missing.length) throw new Error("highlight: " + missing.join(", ") + " cannot answer a highlight (a remote peer over MCP, most likely)");
  const fr = c.resolvers as Record<string, Resolver & FederatedPlotCapable>;
  const def = c.doc.cohorts[cn];
  const xk = data.x.kind, yk = data.y.kind;
  return Promise.all(names.map(async (name, i): Promise<PlotHighlight> => {
    const hDef = c.doc.cohorts[name], hc = c.cohorts[name];
    // a highlight's cases in a study the plot does not draw are outside the plotted cohort by definition
    const hSites = sites.filter((s) => hc.studies.includes(s));
    const base = { name, color: HIGHLIGHT_COLORS[i], patients: hc.count };
    const inPlot = (await Promise.all(hSites.map((s) => fr[s].plotHighlightCount(def, hDef)))).reduce((a, n) => a + n, 0);
    if (data.shape === "table")
      return { ...base, inPlot, n: 0, shown: "none", why: "a contingency table counts cases and has no points to mark" };
    if (!inPlot || !data.n) return { ...base, inPlot, n: 0, shown: "none" };

    let why: string;
    const closed = hSites.filter((s) => !isPatientLevel(c.resolvers[s]));
    if (!closed.length) {
      const parts = await Promise.all(hSites.map((s) => {
        const r = c.resolvers[s];
        return isPatientLevel(r) ? r.plotHighlightPoints(def, hDef, spec, xk, yk, POINTS_CAP) : Promise.resolve(null);
      }));
      const pts = parts.every((p) => p) ? parts.flatMap((p) => p!) : null;
      if (pts && pts.length <= POINTS_CAP) return { ...base, inPlot, n: pts.length, shown: "points", points: pts };
      why = "more than " + POINTS_CAP.toLocaleString("en-US") + " cases, too many to draw as points";
    } else {
      why = closed.join(", ") + " may not show individual cases";
    }

    if (data.shape === "scatter" && data.extent && data.grid) {
      const parts = await Promise.all(hSites.map((s) => fr[s].plotHighlightBins(def, hDef, spec, xk, yk, data.grid!, data.extent!)));
      const cells = new Map<string, number>();
      for (const part of parts) for (const b of part) cells.set(b.bx + "," + b.by, (cells.get(b.bx + "," + b.by) || 0) + b.n);
      const bins = [...cells.entries()].map(([k, n]) => { const [bx, by] = k.split(",").map(Number); return { bx, by, n }; });
      return { ...base, inPlot, n: bins.reduce((a, b) => a + b.n, 0), shown: "density", bins, why };
    }
    const groups = poolBoxRows(await Promise.all(hSites.map((s) => fr[s].plotHighlightBoxRows(def, hDef, spec, xk, yk))));
    return { ...base, inPlot, n: groups.reduce((a, g) => a + g.n, 0), shown: "boxes", groups, why };
  }));
}

/** what is wrong with a view's highlight list, before anything is queried; null when nothing is */
function highlightProblem(pv: PlotView, c: ViewRun, cn: string): string | null {
  const names = pv.highlight;
  if (names == null) return null;
  if (!Array.isArray(names) || names.some((h) => typeof h !== "string")) return "highlight: give a list of cohort names";
  if (names.length > HIGHLIGHT_CAP) return "a plot highlights at most " + HIGHLIGHT_CAP + " cohorts; this view names " + names.length;
  for (const h of names) {
    if (!c.cohorts[h]) return "highlight: there is no cohort named “" + h + "”";
    if (h === cn) return "highlight: “" + h + "” is the plotted cohort itself, so it would mark every case";
  }
  if (new Set(names).size !== names.length) return "highlight: a cohort is named twice";
  return null;
}

/** what the caption says about the highlights: how many of each were drawn, and as what */
function highlightNote(hs: PlotHighlight[], unit: "patient" | "sample"): string {
  if (!hs.length) return "";
  const f = (n: number) => n.toLocaleString("en-US");
  const cases = (n: number) => f(n) + " " + unit + (n === 1 ? "" : "s");
  const one = (h: PlotHighlight) => {
    const where = h.inPlot === h.patients ? f(h.patients) + " patient" + (h.patients === 1 ? "" : "s")
      : f(h.inPlot) + " of its " + f(h.patients) + " patients in the plotted cohort";
    // in patient units, "all" when every patient in the plot had both axes; samples are counted as samples
    const count = unit === "patient" && h.n === h.inPlot ? "all" : cases(h.n);
    const drawn = h.shown === "points" ? count + " drawn as points"
      : h.shown === "density" ? count + " drawn as shaded cells (" + h.why + ")"
      : h.shown === "boxes" ? count + " drawn as a box per group (" + h.why + ")"
      : h.why ? "not drawn: " + h.why : h.inPlot ? "none with a value on both axes" : "none drawn";
    return "“" + h.name + "”: " + where + ", " + drawn;
  };
  return "Highlighted — " + hs.map(one).join("; ") + "." +
    (hs.some((h) => h.shown !== "none") ? " The statistics are over the whole plotted cohort." : "");
}

/**
 * The cases a single-study plot draws as points, set on `data`, and the sentence its caption says
 * about them. At or under POINTS_CAP every case is a point. Over it the crowd stays density and
 * the outliers are points: on a box the values beyond each group's whiskers (over a violin), on
 * a scatter the cases in cells of at most `cellMax` (the cells the figure then leaves unshaded).
 * Points come only from a participant entitled to see cases — isPatientLevel is a type guard,
 * so asking an aggregate-only one is a compile error rather than a review catch.
 */
async function pointLayer(pv: PlotView, r0: Resolver, def: ViewRun["doc"]["cohorts"][string], spec: PlotRequest,
  data: PlotData, unit: "patient" | "sample", site: string): Promise<string | undefined> {
  const f = (n: number) => n.toLocaleString("en-US");
  const cases = (n: number) => f(n) + " " + unit + (n === 1 ? "" : "s");
  if (data.shape === "table" || !data.n) return undefined;
  const none = (why: string) => { data.pointSet = { rule: "none", drawn: 0, why }; };
  const densityNote = data.shape === "scatter"
    ? "Drawn as density: " + cases(data.n) + " counted into " + f((data.bins || []).length) + " cells. The coefficients are over every " +
      unit + ", not over what you can see."
    : "Drawn as a density per group: " + f(data.n) + " values is past what a cloud of dots can show, and the quartiles are over every one of them.";
  if (pv.points === false) { none("points: false"); return data.n > POINTS_CAP ? densityNote : undefined; }
  if (!isPatientLevel(r0)) {
    none(site + " may not show individual cases");
    return densityNote + " No case is drawn as a point: " + site + " may not show individual cases.";
  }
  const colourKey = (pts: { c?: string; r?: string }[]) => {
    if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
    if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
  };

  if (data.shape === "box") {
    const all = data.n <= POINTS_CAP ? await r0.plotPoints(def, spec) : null;
    if (all && all.length) {
      data.points = all; data.overlay = "points";
      data.pointSet = { rule: "all", drawn: all.length };
      colourKey(all);
      return undefined;
    }
    const groups = data.groups || [];
    const outliers = await r0.plotPoints(def, spec, POINTS_CAP, groups);
    if (!outliers) {
      none("more than " + f(POINTS_CAP) + " values lie beyond the whiskers");
      return densityNote + " More than " + f(POINTS_CAP) + " values lie beyond the whiskers, too many to draw as points.";
    }
    data.points = outliers;
    data.pointSet = { rule: "outliers", drawn: outliers.length };
    // the key describes what is drawn: the violin's classes, and any the outliers add
    if (pv.colorBy || pv.ringBy) {
      const fromViolin = data.legend || [];
      colourKey(outliers);
      const fromPoints = data.legend || [];
      data.legend = [...fromViolin, ...fromPoints.filter((k) => !fromViolin.some((v) => v.label === k.label && !!v.ring === !!k.ring))];
    }
    return densityNote + " " + (outliers.length
      ? f(outliers.length) + " value" + (outliers.length === 1 ? "" : "s") + " beyond the whiskers " +
        (outliers.length === 1 ? "is" : "are") + " drawn as points."
      : "No value lies beyond the whiskers.");
  }

  if (data.n <= POINTS_CAP) {
    const all = await r0.plotScatterPoints(def, spec);
    if (all && all.length) {
      data.xyPoints = all;
      data.pointSet = { rule: "all", drawn: all.length };
      return undefined;
    }
  }
  if (!data.bins || !data.grid || !data.extent) return densityNote;
  const cellMax = sparseCellMax(data.bins, POINTS_CAP, OUTLIER_CELL_MAX);
  if (!cellMax) {
    const lone = data.bins.reduce((a, b) => b.n === 1 ? a + b.n : a, 0);
    none(f(lone) + " " + unit + "s sit alone in a cell, more than the " + f(POINTS_CAP) + " a figure draws as points");
    return densityNote + " " + f(lone) + " " + unit + "s sit alone in a cell, more than the " + f(POINTS_CAP) +
      " drawn as points, so none is.";
  }
  const pts = await r0.plotScatterPoints(def, spec, POINTS_CAP, { grid: data.grid, extent: data.extent, cellMax });
  if (!pts) { none("the sparse cells hold more than " + f(POINTS_CAP) + " cases"); return densityNote; }
  data.xyPoints = pts;
  data.pointSet = { rule: "outliers", drawn: pts.length, cellMax };
  return densityNote + " " + cases(pts.length) + " in cells holding at most " + cellMax + " " +
    (pts.length === 1 ? "is" : "are") + " drawn as points; the other " + cases(data.n - pts.length) + " as shaded cells.";
}

export async function runPlot(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const pv = view as PlotView;
  const cn = vNames[0];
  const sites = cohorts[cn].studies;
  const unit = pv.unit === "sample" ? "sample" as const : "patient" as const;
  const spec = { x: pv.x, y: pv.y, unit,
    ...(pv.colorBy ? { colorBy: pv.colorBy } : {}), ...(pv.ringBy ? { ringBy: pv.ringBy } : {}) };
  const bins: [number, number] = Array.isArray(pv.bins) && pv.bins.length === 2
    ? [Number(pv.bins[0]), Number(pv.bins[1])] : DEFAULT_BINS;
  const hlProblem = highlightProblem(pv, c, cn);
  if (hlProblem) return untimed({ kind: "plot", error: hlProblem });
  try {
    if (sites.length === 1) {
      const r0 = resolvers[sites[0]];
      const data = await r0.plot(doc.cohorts[cn], { ...spec, bins: pv.bins ? bins : undefined });
      const shapeNote = await pointLayer(pv, r0, doc.cohorts[cn], spec, data, unit, sites[0]);
      const hs = await highlightLayers(pv, data, c, cn, sites, spec);
      if (hs.length) data.highlights = hs;
      // what the pair left out leads: cases missing either axis are not on the figure at all
      const pr: ViewResult = {
        kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [coverageNote(data, unit), shapeNote, highlightNote(hs, unit)].filter(Boolean).join(" ") || undefined
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
      const label = { x: { label: xLabel, kind: xk }, y: { label: yLabel, kind: yk } };
      const scaleNote = sites.length + " studies pooled (" + sites.join(", ") + ")";
      let data: PlotData;

      if (shape === "scatter") {
        const extents = await Promise.all(sites.map((s) => fr[s].plotExtent(doc.cohorts[cn], spec, xk, yk)));
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
        const n = groups.reduce((a, g) => a + g.n, 0);
        data = { shape, n, ...label, groups, overlay: "none",
          note: scaleNote + ". Counts and extremes per group sum exactly; the quartiles are a size-weighted" +
            " approximation across sites (it can shift where an outlier bar falls, never a count). A federated" +
            " box does not draw a density behind it — that needs the same shared-scale binning a scatter does," +
            " not yet built for this shape — so points are shown when an entitled site has few enough to draw." };
        // Points, unlike a density, just concatenate: each entitled site's own case-level
        // rows are already independent of any shared scale. A site that may not disclose
        // cases contributes none, the same rule the oncoprint's columns follow.
        if (pv.points !== false) {
          const perSite = await Promise.all(sites.map((s) =>
            isPatientLevel(resolvers[s]) ? resolvers[s].plotPoints(doc.cohorts[cn], spec) : Promise.resolve([])));
          const pts = perSite.every((p) => p) ? perSite.flatMap((p) => p!) : [];
          if (pts.length && pts.length <= POINTS_CAP) {
            data.points = pts; data.overlay = "points";
            if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
            if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
          }
        }
      }

      // each site counts its own cases and their axes; the sums are exact. A failed count fails the
      // view: dropping the coverage note would hide how many cases the figure leaves out
      const covs = await Promise.all(sites.map((s) => fr[s].plotCoverage(doc.cohorts[cn], spec, xk, yk)));
      data.coverage = covs.reduce<{ total: number; nx: number; ny: number }>(
        (a, c) => ({ total: a.total + c.total, nx: a.nx + c.nx, ny: a.ny + c.ny }), { total: 0, nx: 0, ny: 0 });
      const hs = await highlightLayers(pv, data, c, cn, sites, spec);
      if (hs.length) data.highlights = hs;
      const pr: ViewResult = { kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [coverageNote(data, unit), data.note, highlightNote(hs, unit)].filter(Boolean).join(" ") || undefined };
      return pr;
    }
  } catch (e) {
    return { kind: "plot", error: String((e as Error).message || e) };
  }
}
