"use client";
// Explore's charts that are not one attribute's tally — the portal study view's survival curve, its
// mutation count against fraction of genome altered and the reader's other X vs Y density charts —
// built from the analysis engine's own views over the current selection, so their numbers are the
// same ones an analysis would report. A density is a filter: drag a rectangle over it to add both
// axes' ranges to the selection.
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cardRank, type GridCard } from "./explore-grid.tsx";
import { chartCells, kmPlotTitle } from "../../lib/study-view-layout.ts";
import { api } from "./api.ts";
import { Choice } from "../_ui/choice.tsx";
import { Button } from "../_ui/button";
import { useWidth } from "./figure.tsx";
import { linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight } from "../../lib/svg-kit.ts";
import { fmtInt } from "../../lib/chart/format.ts";
import type { CohortDef, KmCurve } from "../../lib/types.ts";
import type { PlotCell } from "../../lib/plot.ts";
import { ChartMenu } from "./partitions.tsx";
import { caseFileAction, densityFigureSvg, figureActions, standaloneSvg } from "./chart-files.ts";
import { chartFileName } from "../../lib/study-view-download.ts";
import { curveSummary, survivalSvg } from "../../lib/views/survival/figure.ts";
import { PORTAL_STUDY_VIEW_KM } from "../../lib/chart/style.ts";
import {
  FGA, MUTATION_COUNT, correlationLines, densityAxes, densityPairKey, densityAxisLabel, densityColors, densityGradient, densitySelection, densityTip,
  densityTitle, densityView, densityHeld, densityChartsShown, lnFromEngine, logOffered, swapDensity, type DensityAxis, type DensityPair, type DensitySettings
} from "../../lib/study-view-density.ts";

type Clause = Record<string, unknown>;
type Draft = { all: Clause[] } | null;

/** the two attributes' names as the portal shows them */
const DENSITY_NAMES: Record<string, string> = { [MUTATION_COUNT]: "Mutation Count", [FGA]: "Fraction Genome Altered" };
/** the browser storage key of the density chart's menu settings (Swap Axes, Log Scale) */
const DENSITY_KEY = "cbiolab.explore.density";

interface Props {
  studies: string[];
  /** the selection a chart's per-case file lists, as every Explore download reads it */
  selection: () => { def: CohortDef; study: string } | null;
  draft: Draft;
  /** the attributes this study has, with the level each is recorded at and the name it is shown by */
  attrs: { attribute: string; per?: string; displayName?: string }[];
  /** the endpoints the study can fit a survival curve on (OS, PFS, …); null while unknown */
  endpoints: string[] | null;
  addClauses: (clauses: Clause[]) => void;
  /** draws the survival curves the way the analysis page draws them */
  km: (curves: unknown[]) => React.ReactNode;
  /** the reader's X vs Y density charts, added from Add chart (STV-AC-7) */
  pairs?: DensityPair[];
  onRemovePair?: (pair: DensityPair) => void;
  /** a density chart's Reset: its drag's selection, which has no pill (STV-FB-3b) */
  onClearDensity?: (pair: DensityPair) => void;
  /** the Mutation Count vs FGA density, unless unchecked in Add chart's Genomic tab */
  density?: boolean;
}

type PlotData = { shape: string; n: number; extent?: { x0: number; x1: number; y0: number; y1: number }; grid?: [number, number];
  bins?: PlotCell[]; stats?: { pearson: number | null; spearman: number | null }; coverage?: { total: number; nx: number; ny: number } };

/**
 * The survival chart and the density charts as grid cards. The survival chart is one card with an
 * endpoint picker (kept on purpose, 2026-11-13), drawn at 2 × 2 where the portal draws a 1 × 1 tile
 * per endpoint.
 */
export function exploreChartCards(props: Props): GridCard[] {
  const { attrs, density = true, pairs = [], onRemovePair, onClearDensity, studies, draft, selection, addClauses } = props;
  const nameOf = (a: string) => attrs.find((x) => x.attribute === a)?.displayName || DENSITY_NAMES[a] || a;
  // the default Mutation Count vs FGA chart (unless unchecked), then the reader's X vs Y charts (STS-SC-1)
  // the same rule the filter bar reads to hide a drag's pills (STV-FB-3b)
  const shown = densityChartsShown(attrs.map((a) => a.attribute), density, pairs);
  return [
    ...(props.endpoints && props.endpoints.length ? [{ key: "survival", ...cardRank('[data-chart="survival"]'), ...chartCells("density"), node: <SurvivalCard {...props} /> }] : []),
    ...shown.map(({ pair, added }): GridCard => ({
      key: "density:" + densityPairKey(pair), ...(added ? { name: nameOf(pair.x) + " vs " + nameOf(pair.y) } : cardRank('[data-chart="mutcount-fga"]')),
      ...chartCells("density"),
      node: <DensityCard pair={pair} added={added} studies={studies} draft={draft} selection={selection} addClauses={addClauses}
        nameOf={nameOf} onRemove={added && onRemovePair ? () => onRemovePair(pair) : undefined} onClear={onClearDensity ? () => onClearDensity(pair) : undefined} />,
    })),
  ];
}

function SurvivalCard({ studies, selection, draft, endpoints, km, attrs }: Props) {
  const [endpoint, setEndpoint] = useState<string>("OS");
  const ep = endpoints && endpoints.length ? (endpoints.includes(endpoint) ? endpoint : endpoints[0]) : null;
  const [res, setRes] = useState<{ key: string; curves?: unknown[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const want = useRef("");
  const key = JSON.stringify([studies, draft, ep]);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!studies.length || !ep) return;
    want.current = key;
    setLoading(true);
    const cohort: CohortDef = { ...(studies.length > 1 ? { studies } : {}), all: (draft ? draft.all : []) as CohortDef["all"] };
    // a superseded request is cancelled, so the server stops its queries instead of finishing them
    const ac = new AbortController();
    api.analysis({ study: studies[0], cohorts: { Selected: cohort }, views: [{ kind: "survival", endpoint: ep }] }, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (want.current !== key) return;   // a newer selection was asked for meanwhile
        const sv = j.views?.[0];
        setRes(j.error || !sv || sv.error ? { key, error: String(j.error || sv?.error || "the survival view returned nothing") } : { key, curves: sv.curves || [] });
      })
      .catch((e) => { if (!ac.signal.aborted && want.current === key) setRes({ key, error: String(e) }); })
      .finally(() => { if (!ac.signal.aborted && want.current === key) setLoading(false); });
    return () => ac.abort();
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const stale = loading || !res || res.key !== key;
  return <>
    {ep && (
      <div className="card xc-card" data-chart="survival">
        <div className="xc-head">
          <span className="xc-title" data-tip={"the selection's patients, " + ep + "_MONTHS and " + ep + "_STATUS"}>{kmPlotTitle(attrs.find((a) => a.attribute === ep + "_STATUS")?.displayName || ep + " Status")}</span>
          <ChartMenu label="the survival chart" actions={[{ label: "Download", title: "save this chart as a file",
            sub: [caseFileAction("Data", { kind: "survival", status: ep + "_STATUS", months: ep + "_MONTHS" }, chartFileName((ep === "OS" ? "Overall" : ep) + " survival", "data"),
              selection, (update) => setFileError((cur) => update(cur))),
            ...figureActions((ep === "OS" ? "Overall" : ep) + " survival", () => {
              const curves = res?.curves;
              return curves && curves.length ? standaloneSvg(survivalSvg({ kind: "survival", curves } as never, { width: 480, theme: "light" }, PORTAL_STUDY_VIEW_KM)) : null;
            }, (message) => setFileError(message))] }]} />
          {endpoints && endpoints.length > 1 && (
            <Choice className="w-20 h-5 data-[size=sm]:h-5 px-1.5 text-xs" title="the outcome the curve follows" value={ep} onChange={setEndpoint}
              options={endpoints.map((x) => [x, x] as const)} />
          )}
        </div>
        {/* the curve's median, patients and events in its tooltip, where the portal's small KM chart keeps its legend (STS-KM-3) */}
        <div className="xc-body" data-tip={res?.curves?.length ? (res.curves as KmCurve[]).map((c) => c.cohort + ": " + curveSummary(c)).join("\n") : undefined}>
          {res && res.curves && (res.curves.length ? km(res.curves) : <p className="note">no patient in the selection has a {ep} time and status</p>)}
          {res && res.error && <p className="note">{res.error}</p>}
          {fileError && <p className="note">{fileError}</p>}
          {stale && <div className="xc-wait"><span className="spinner" /> {res ? "updating…" : "loading…"}</div>}
        </div>
      </div>
    )}
  </>;
}

/**
 * One X vs Y density chart (STS-SC-1…6): its own settings (Swap Axes, Log Scale; the default
 * chart's kept under its old key), its own request, its menu, and a drag box that filters on both.
 */
function DensityCard({ pair, added, studies, draft, selection, addClauses, nameOf, onRemove, onClear }: { pair: DensityPair; added: boolean; studies: string[];
  draft: Draft; selection: Props["selection"]; addClauses: Props["addClauses"]; nameOf: (a: string) => string; onRemove?: () => void; onClear?: () => void }) {
  const storeKey = added ? DENSITY_KEY + "." + densityPairKey(pair) : DENSITY_KEY;
  // the reader's own menu settings, kept by this browser; read after mounting, so a server render never touches storage
  const [dset, setDset] = useState<DensitySettings>({});
  useEffect(() => { try { setDset(JSON.parse(localStorage.getItem(storeKey) || "{}") || {}); } catch { /* the defaults */ } }, [storeKey]);
  const saveDensity = (v: DensitySettings) => {
    setDset(v);
    try { localStorage.setItem(storeKey, JSON.stringify(v)); } catch { /* kept for this page only */ }
  };
  const axes = densityAxes(dset, pair);
  const [res, setRes] = useState<{ key: string; data?: PlotData; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const want = useRef("");
  const key = JSON.stringify([studies, draft, axes]);
  // the density figure as a file, set by the drawn chart; a save that fails says why under the chart
  const densityFile = useRef<(() => string | null) | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  useEffect(() => {
    if (!studies.length) return;
    want.current = key;
    setLoading(true);
    const cohort: CohortDef = { ...(studies.length > 1 ? { studies } : {}), all: (draft ? draft.all : []) as CohortDef["all"] };
    const ac = new AbortController();
    api.analysis({ study: studies[0], cohorts: { Selected: cohort }, views: [densityView(dset, pair)] }, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (want.current !== key) return;
        const pv = j.views?.[0];
        setRes(j.error || !pv || pv.error ? { key, error: String(j.error || pv?.error || "the density view returned nothing") } : { key, data: pv.plot });
      })
      .catch((e) => { if (!ac.signal.aborted && want.current === key) setRes({ key, error: String(e) }); })
      .finally(() => { if (!ac.signal.aborted && want.current === key) setLoading(false); });
    return () => ac.abort();
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stale = loading || !res || res.key !== key;
  const plot = res?.data;
  const title = densityTitle(nameOf(axes.x.attribute), nameOf(axes.y.attribute));
  const names = { x: nameOf(axes.x.attribute), y: nameOf(axes.y.attribute) };
  // its drag's selection, shown here only (no pill, STV-FB-3b), by the axes as drawn
  const held = densityHeld(draft, { x: axes.x.attribute, y: axes.y.attribute });
  const heldText = held ? (["x", "y"] as const).flatMap((k) => held[k] ? [names[k] + " " + String(held[k]!.gte) + "–" + String(held[k]!.lte)] : []).join(", ") : "";
  return (
    <div className="card xc-card" data-chart={added ? "xvsy" : "mutcount-fga"} data-pair={densityPairKey(pair)}>
      <div className="xc-head">
        <span className="xc-title" data-tip={title + "\n" + (plot && plot.coverage && plot.coverage.total > plot.n
          ? fmtInt(plot.n) + " of " + fmtInt(plot.coverage.total) + " samples have both · " : "") + (held ? "selected: " + heldText : "drag a box to filter")}>{title}</span>
        {held && onClear && <Button variant="ghost" size="icon-xs" className="charticon" data-chart-reset onClick={onClear} aria-label="Reset filters in chart"
          data-tip={"Reset filters: clear this chart's selection (" + heldText + ")"}><RotateCcw /></Button>}
        <ChartMenu label={"the " + title + " chart"} actions={[
          { label: "Swap Axes", title: "put " + names.y + " along the bottom", onClick: () => saveDensity(swapDensity(dset)) },
          ...(["x", "y"] as const).filter((k) => logOffered(axes[k].attribute)).map((k) => ({
            label: "Log Scale " + k.toUpperCase(), checked: axes[k].log,
            title: axes[k].log ? "draw " + names[k] + " on a linear scale" : "draw " + names[k] + " as ln(1 + count)",
            onClick: () => saveDensity({ ...dset, [k + "Log"]: !axes[k].log }) })),
          { label: "Download", title: "save this chart as a file",
            sub: [caseFileAction("Data", { kind: "density", x: axes.x.attribute, y: axes.y.attribute }, chartFileName(title, "data"),
              selection, (update) => setFileError((cur) => update(cur))),
            ...figureActions(title, () => densityFile.current ? densityFile.current() : null, (message) => setFileError(message))] },
          ...(onRemove ? [{ label: "Remove chart", title: "stop drawing " + title, onClick: onRemove }] : [])]} />
      </div>
      <div className="xc-body">
        {plot && plot.shape === "scatter" && !plot.grid && <p className="note">No data to plot.</p>}
        {plot && plot.shape === "scatter" && plot.grid &&
          <Density data={plot} axes={axes} names={names} figure={densityFile} held={held} onSelect={(box, span) => addClauses(densitySelection(box, dset, span, pair))} />}
        {fileError && <p className="note">{fileError}</p>}
        {res && res.error && <p className="note">{res.error}</p>}
        {stale && <div className="xc-wait"><span className="spinner" /> {res ? "updating…" : "loading…"}</div>}
      </div>
    </div>
  );
}

/** the portal's density: a dot per non-empty bin coloured by its count, the legend and coefficients beside it, a drag box to filter */
function Density({ data, axes, names, figure, held, onSelect }: { data: PlotData; axes: { x: DensityAxis; y: DensityAxis };
  /** the chart's held selection, drawn as its box (the portal shows it on the chart only) */
  held: ReturnType<typeof densityHeld>;
  /** the axes' attributes' names, as the chart's title writes them */
  names: { x: string; y: string };
  /** set to draw the chart as a file */
  figure: React.MutableRefObject<(() => string | null) | null>;
  onSelect: (box: { x0: number; x1: number; y0: number; y1: number }, span: { x: number; y: number }) => void }) {
  const { ref, width } = useWidth(260);
  const LEGEND_W = 92;
  const W = Math.max(200, (width ?? 340) - LEGEND_W), H = Math.round(Math.max(200, Math.min(300, W * 0.72)));
  const [gx, gy] = data.grid!;
  // the engine's log axis is log2(1 + v); the portal draws ln(1 + v)
  const show = (v: number, log: boolean) => log ? lnFromEngine(v) : v;
  const e = { x0: show(data.extent!.x0, axes.x.log), x1: show(data.extent!.x1, axes.x.log),
    y0: show(data.extent!.y0, axes.y.log), y1: show(data.extent!.y1, axes.y.log) };
  const xName = names.x, yName = names.y;
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
  useEffect(() => {
    figure.current = () => svgRef.current ? densityFigureSvg(svgRef.current, legend, lines) : null;
    return () => { figure.current = null; };
  });
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
          {held && !drag && (() => {
            // a count on Log Scale is drawn at ln(1 + v); each range is clamped to the plot
            const at = (k: "x" | "y", v: number) => axes[k].log ? Math.log1p(v) : v;
            const clampX = (v: number) => Math.min(L + PW, Math.max(L, v)), clampY = (v: number) => Math.min(T + PH, Math.max(T, v));
            const x0 = held.x ? clampX(xs(at("x", held.x.gte))) : L, x1 = held.x ? clampX(xs(at("x", held.x.lte))) : L + PW;
            const y0 = held.y ? clampY(ys(at("y", held.y.lte))) : T, y1 = held.y ? clampY(ys(at("y", held.y.gte))) : T + PH;
            return <rect x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} className="xc-held" data-held />;
          })()}
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
