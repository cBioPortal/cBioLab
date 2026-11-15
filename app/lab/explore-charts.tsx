"use client";
// Explore's two charts that are not one attribute's tally — the portal study view's survival curve
// and its mutation count against fraction of genome altered — built from the analysis engine's own
// views over the current selection, so their numbers are the same ones an analysis would report.
// The density is a filter: drag a rectangle over it to add both axes' ranges to the selection.
import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Choice } from "../_ui/choice.tsx";
import { useWidth } from "./figure.tsx";
import { linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight } from "../../lib/svg-kit.ts";
import { fmtInt } from "../../lib/chart/format.ts";
import type { CohortDef, View } from "../../lib/types.ts";
import type { PlotCell } from "../../lib/plot.ts";
import { ChartMenu } from "./partitions.tsx";
import {
  FGA, MUTATION_COUNT, correlationLines, densityAxes, densityAxisLabel, densityColors, densityGradient, densitySelection, densityTip,
  densityTitle, densityView, lnFromEngine, logOffered, swapDensity, type DensityAxis, type DensitySettings
} from "../../lib/study-view-density.ts";

type Clause = Record<string, unknown>;
type Draft = { all: Clause[] } | null;

/** the two attributes' names as the portal shows them */
const DENSITY_NAMES: Record<string, string> = { [MUTATION_COUNT]: "Mutation Count", [FGA]: "Fraction Genome Altered" };
/** the browser storage key of the density chart's menu settings (Swap Axes, Log Scale) */
const DENSITY_KEY = "cbiolab.explore.density";

interface Props {
  studies: string[];
  draft: Draft;
  /** the attributes this study has, with the level each is recorded at */
  attrs: { attribute: string; per?: string }[];
  /** the endpoints the study can fit a survival curve on (OS, PFS, …); null while unknown */
  endpoints: string[] | null;
  addClauses: (clauses: Clause[]) => void;
  /** draws the survival curves the way the analysis page draws them */
  km: (curves: unknown[]) => React.ReactNode;
}

type PlotData = { shape: string; n: number; extent?: { x0: number; x1: number; y0: number; y1: number }; grid?: [number, number];
  bins?: PlotCell[]; stats?: { pearson: number | null; spearman: number | null }; coverage?: { total: number; nx: number; ny: number } };

export function ExploreCharts({ studies, draft, attrs, endpoints, addClauses, km }: Props) {
  const hasScatter = [MUTATION_COUNT, FGA].every((a) => attrs.some((x) => x.attribute === a));
  // the reader's own menu settings, kept by this browser; read after mounting, so a server render never touches storage
  const [dset, setDset] = useState<DensitySettings>({});
  useEffect(() => { try { setDset(JSON.parse(localStorage.getItem(DENSITY_KEY) || "{}") || {}); } catch { /* the defaults */ } }, []);
  const saveDensity = (v: DensitySettings) => {
    setDset(v);
    try { localStorage.setItem(DENSITY_KEY, JSON.stringify(v)); } catch { /* kept for this page only */ }
  };
  const axes = densityAxes(dset);
  const [endpoint, setEndpoint] = useState<string>("OS");
  const ep = endpoints && endpoints.length ? (endpoints.includes(endpoint) ? endpoint : endpoints[0]) : null;
  const [res, setRes] = useState<{ key: string; survival?: { curves?: unknown[]; error?: string }; plot?: { data?: PlotData; error?: string } } | null>(null);
  const [loading, setLoading] = useState(false);
  const want = useRef("");
  const key = JSON.stringify([studies, draft, ep, hasScatter, axes]);

  useEffect(() => {
    if (!studies.length || (!ep && !hasScatter)) return;
    want.current = key;
    setLoading(true);
    const cohort: CohortDef = { ...(studies.length > 1 ? { studies } : {}), all: (draft ? draft.all : []) as CohortDef["all"] };
    const views: View[] = [];
    if (ep) views.push({ kind: "survival", endpoint: ep });
    if (hasScatter) views.push(densityView(dset));
    // a superseded request is cancelled, so the server stops its queries instead of finishing them
    const ac = new AbortController();
    api.analysis({ study: studies[0], cohorts: { Selected: cohort }, views }, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (want.current !== key) return;   // a newer selection was asked for meanwhile
        if (j.error) { setRes({ key, ...(ep ? { survival: { error: j.error } } : {}), ...(hasScatter ? { plot: { error: j.error } } : {}) }); return; }
        const vs: any[] = j.views || [];
        const sv = ep ? vs[0] : null, pv = hasScatter ? vs[ep ? 1 : 0] : null;
        setRes({ key,
          ...(sv ? { survival: sv.error ? { error: sv.error } : { curves: sv.curves || [] } } : {}),
          ...(pv ? { plot: pv.error ? { error: pv.error } : { data: pv.plot } } : {}) });
      })
      .catch((e) => { if (!ac.signal.aborted && want.current === key) setRes({ key, survival: { error: String(e) }, plot: { error: String(e) } }); })
      .finally(() => { if (!ac.signal.aborted && want.current === key) setLoading(false); });
    return () => ac.abort();
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!ep && !hasScatter) return null;
  const stale = loading || !res || res.key !== key;
  const plot = res && res.plot && res.plot.data;
  return <>
    {ep && (
      <div className="card xc-card" data-chart="survival">
        <div className="xc-head">
          <span className="xc-title">{ep === "OS" ? "Overall survival" : ep + " survival"} of the selection</span>
          {endpoints && endpoints.length > 1 && (
            <Choice className="w-28" title="the outcome the curve follows" value={ep} onChange={setEndpoint}
              options={endpoints.map((x) => [x, x] as const)} />
          )}
        </div>
        <div className="xc-body">
          {res && res.survival && res.survival.curves && (res.survival.curves.length ? km(res.survival.curves) : <p className="note">no patient in the selection has a {ep} time and status</p>)}
          {res && res.survival && res.survival.error && <p className="note">{res.survival.error}</p>}
          {stale && <div className="xc-wait"><span className="spinner" /> {res ? "updating…" : "loading…"}</div>}
        </div>
      </div>
    )}
    {hasScatter && (
      <div className="card xc-card" data-chart="mutcount-fga">
        <div className="xc-head">
          <span className="xc-title">{densityTitle(DENSITY_NAMES[axes.x.attribute], DENSITY_NAMES[axes.y.attribute])}</span>
          <span className="meta">{plot && plot.coverage && plot.coverage.total > plot.n
            ? fmtInt(plot.n) + " of " + fmtInt(plot.coverage.total) + " samples have both · " : ""}drag a box to filter</span>
          <ChartMenu label="the density chart" actions={[
            { label: "Swap Axes", title: "put " + DENSITY_NAMES[axes.y.attribute] + " along the bottom", onClick: () => saveDensity(swapDensity(dset)) },
            ...(["x", "y"] as const).filter((k) => logOffered(axes[k].attribute)).map((k) => ({
              label: "Log Scale " + k.toUpperCase(), checked: axes[k].log,
              title: axes[k].log ? "draw " + DENSITY_NAMES[axes[k].attribute] + " on a linear scale" : "draw " + DENSITY_NAMES[axes[k].attribute] + " as ln(1 + count)",
              onClick: () => saveDensity({ ...dset, [k + "Log"]: !axes[k].log }) }))]} />
        </div>
        <div className="xc-body">
          {plot && plot.shape === "scatter" && !plot.grid && <p className="note">No data to plot.</p>}
          {plot && plot.shape === "scatter" && plot.grid &&
            <Density data={plot} axes={axes} onSelect={(box, span) => addClauses(densitySelection(box, dset, span))} />}
          {res && res.plot && res.plot.error && <p className="note">{res.plot.error}</p>}
          {stale && <div className="xc-wait"><span className="spinner" /> {res ? "updating…" : "loading…"}</div>}
        </div>
      </div>
    )}
  </>;
}

/** the portal's density: a dot per non-empty bin coloured by its count, the legend and coefficients beside it, a drag box to filter */
function Density({ data, axes, onSelect }: { data: PlotData; axes: { x: DensityAxis; y: DensityAxis };
  onSelect: (box: { x0: number; x1: number; y0: number; y1: number }, span: { x: number; y: number }) => void }) {
  const { ref, width } = useWidth(260);
  const LEGEND_W = 92;
  const W = Math.max(200, (width ?? 340) - LEGEND_W), H = Math.round(Math.max(200, Math.min(300, W * 0.72)));
  const [gx, gy] = data.grid!;
  // the engine's log axis is log10(1 + v); the portal draws ln(1 + v)
  const show = (v: number, log: boolean) => log ? lnFromEngine(v) : v;
  const e = { x0: show(data.extent!.x0, axes.x.log), x1: show(data.extent!.x1, axes.x.log),
    y0: show(data.extent!.y0, axes.y.log), y1: show(data.extent!.y1, axes.y.log) };
  const xName = DENSITY_NAMES[axes.x.attribute], yName = DENSITY_NAMES[axes.y.attribute];
  const xTitle = densityAxisLabel(xName, axes.x.log), yTitle = densityAxisLabel(yName, axes.y.log);
  const ys0 = linear(e.y0, e.y1, 0, 1, { nice: false, count: 8 });
  const L = 6 + leftAxisWidth(ys0, yTitle), R = 8, T = 8, B = bottomAxisHeight(xTitle) + 2, PW = W - L - R, PH = H - T - B;
  const ys = linear(e.y0, e.y1, T + PH, T, { nice: false, count: 8 });
  const xs = linear(e.x0, e.x1, L, L + PW, { nice: false, count: 8 });
  const pal = { ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)" };
  const axesSvg = axisLeft(ys, L, pal, { title: yTitle }) + axisBottom(xs, T + PH, pal, { title: xTitle, minX: 0, maxX: W });
  const bins = data.bins || [];
  const { color, legend } = densityColors(bins.map((b) => b.n));
  const lines = correlationLines({ pearson: data.stats?.pearson ?? null, spearman: data.stats?.spearman ?? null }, bins.reduce((a, b) => a + b.n, 0));
  const cw = PW / gx, ch = PH / gy, r = Math.max(1, Math.min(cw, ch) / 2);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const vx = (px: number) => e.x0 + (e.x1 - e.x0) * Math.min(1, Math.max(0, (px - L) / PW));
  const vy = (py: number) => e.y0 + (e.y1 - e.y0) * Math.min(1, Math.max(0, (T + PH - py) / PH));
  const local = (ev: React.PointerEvent) => {
    const b = svgRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - b.left) * W / b.width, y: (ev.clientY - b.top) * H / b.height };
  };
  return (
    <div ref={ref} className="xc-dens">
      {width != null && <>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="xc-density" role="img"
          aria-label={"density of " + fmtInt(data.n) + " samples; drag to select a range"}
          onPointerDown={(ev) => { const p = local(ev); (ev.target as Element).setPointerCapture?.(ev.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={(ev) => { if (drag) { const p = local(ev); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 4 && Math.abs(drag.y1 - drag.y0) > 4)
              onSelect({ x0: vx(Math.min(drag.x0, drag.x1)), x1: vx(Math.max(drag.x0, drag.x1)),
                y0: vy(Math.max(drag.y0, drag.y1)), y1: vy(Math.min(drag.y0, drag.y1)) }, { x: e.x1 - e.x0, y: e.y1 - e.y0 });
            setDrag(null);
          }}>
          <rect x={L} y={T} width={PW} height={PH} className="xc-frame" />
          {bins.map((b, i) => (
            <circle key={i} cx={L + cw * (b.bx + 0.5)} cy={T + PH - ch * (b.by + 0.5)} r={r} fill={color(b.n)}
              data-tip={drag ? undefined : densityTip({ n: b.n, minX: show(b.minX ?? NaN, axes.x.log), maxX: show(b.maxX ?? NaN, axes.x.log),
                minY: show(b.minY ?? NaN, axes.y.log), maxY: show(b.maxY ?? NaN, axes.y.log) },
              { name: xName, log: axes.x.log }, { name: yName, log: axes.y.log }).join("\n")} />
          ))}
          {/* the axes are drawn by the figures' own kit (lib/chart/axis.ts), which escapes what it writes */}
          <g dangerouslySetInnerHTML={{ __html: axesSvg }} />
          {drag && <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="xc-brush" />}
        </svg>
        <div className="xc-legend">
          {legend && <>
            <div className="xc-legend-title"># samples</div>
            <div className="xc-legend-scale">
              <span className={"xc-legend-bar" + (legend.mid == null ? " short" : "")} style={{ background: densityGradient() }} />
              <span className="xc-legend-labels">
                <span>{fmtInt(legend.max)}</span>{legend.mid != null && <span>{fmtInt(legend.mid)}</span>}<span>{fmtInt(legend.min)}</span>
              </span>
            </div>
          </>}
          {lines && lines.map((l) => (
            <div key={l.name} className="xc-corr"><div className="dim">{l.name}</div><div>{l.r}</div><div>{l.p}</div></div>
          ))}
        </div>
      </>}
    </div>
  );
}
