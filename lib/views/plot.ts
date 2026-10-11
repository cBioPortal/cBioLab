// Plot view: two axes over one cohort's cases, drawn as a scatter, box or contingency table as
// the axes decide; local, or federated where every participant can answer.
import type { PlotView, ViewResult } from "../types.ts";
import { pearsonFromMoments, regressionFromMoments, type Moments } from "../stats.ts";
import { viewToSvg } from "../view-svg.ts";
import { isPatientLevel, hasFederatedPlot, legendFor, type Resolver, type FederatedPlotCapable } from "../federation.ts";
import { DEFAULT_BINS, CATEGORY_CAP, POINTS_CAP, tukey, coverageNote, type PlotData, type PlotGroup } from "../plot.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";

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
  try {
    if (sites.length === 1) {
      const r0 = resolvers[sites[0]];
      const data = await r0.plot(doc.cohorts[cn], { ...spec, bins: pv.bins ? bins : undefined });
      // The points behind a box come only from a participant entitled to see cases, and only
      // when there are few enough to be a drawing. isPatientLevel is a type guard, so asking an
      // aggregate-only participant for them is a compile error rather than a review catch.
      if (data.shape === "box" && pv.points !== false && isPatientLevel(r0)) {
        const pts = await r0.plotPoints(doc.cohorts[cn], spec);
        if (pts.length) {
          data.points = pts;
          data.overlay = "points";
          // the key describes what is drawn, so it is built from the points themselves
          if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
          if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
        }
      }
      const shapeNote = data.shape === "box" && data.overlay === "violin"
          ? "Drawn as a density per group: " + data.n.toLocaleString("en-US") + " values is past what a cloud of dots can show, " +
            "and the quartiles are over every one of them."
          : data.shape === "box" && data.overlay === "points"
          ? "Every value is drawn over its box; the jitter is fixed per case, so the figure does not move between renderings."
          : data.shape === "scatter" && data.n > 5000
          ? "Drawn as density: " + data.n.toLocaleString("en-US") + " " + (unit === "sample" ? "samples" : "patients") +
            " counted into " + (data.bins || []).length.toLocaleString("en-US") + " cells. The coefficients are over every " +
            (unit === "sample" ? "sample" : "patient") + ", not over what you can see."
          : undefined;
      // what the pair left out leads: cases missing either axis are not on the figure at all
      const pr: ViewResult = {
        kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false),
        note: [coverageNote(data, unit), shapeNote].filter(Boolean).join(" ") || undefined
      };
      // drawn on the server, like every view but the oncoprint, so MCP gets the figure
      const tPlot = Date.now();
      pr.svg = viewToSvg(pr, { width: 960 }) || undefined;
      pr.renderMs = Date.now() - tPlot;
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
        const parts = await Promise.all(sites.map((s) => fr[s].plotBoxRows(doc.cohorts[cn], spec, xk, yk)));
        const byGroup = new Map<string, { n: number; lo: number; hi: number; q1w: number; medw: number; q3w: number }>();
        for (const rows of parts) for (const r of rows) {
          const cur = byGroup.get(r.g) || { n: 0, lo: r.lo, hi: r.hi, q1w: 0, medw: 0, q3w: 0 };
          // n/lo/hi are exact; q1/median/q3 are size-weighted across sites, the same
          // approximation Explore's federated numeric histograms already use and disclose —
          // it shifts where an outlier bar falls, never a count.
          byGroup.set(r.g, { n: cur.n + r.n, lo: Math.min(cur.lo, r.lo), hi: Math.max(cur.hi, r.hi),
            q1w: cur.q1w + r.q1 * r.n, medw: cur.medw + r.median * r.n, q3w: cur.q3w + r.q3 * r.n });
        }
        if (byGroup.size > CATEGORY_CAP)
          throw new Error("more than " + CATEGORY_CAP + " groups on the categorical axis; narrow the cohort or pick another attribute");
        const groups: PlotGroup[] = [...byGroup.entries()].map(([g, a]) => {
          const q1 = a.q1w / a.n, median = a.medw / a.n, q3 = a.q3w / a.n;
          const t = tukey(q1, q3, a.lo, a.hi);
          return { g, n: a.n, lo: a.lo, hi: a.hi, q1, median, q3, loWhisker: t.loWhisker, hiWhisker: t.hiWhisker };
        });
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
          const pts = perSite.flat();
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
      const pr: ViewResult = { kind: "plot", plot: data, cohorts: [cn], studies: sites,
        participation: participationFor(sites, false), note: [coverageNote(data, unit), data.note].filter(Boolean).join(" ") || undefined };
      const tPlot = Date.now();
      pr.svg = viewToSvg(pr, { width: 960 }) || undefined;
      pr.renderMs = Date.now() - tPlot;
      return pr;
    }
  } catch (e) {
    return { kind: "plot", error: String((e as Error).message || e) };
  }
}
