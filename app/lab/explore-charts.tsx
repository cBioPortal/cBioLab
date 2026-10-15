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

type Clause = Record<string, unknown>;
type Draft = { all: Clause[] } | null;

const X_ATTR = "MUTATION_COUNT", Y_ATTR = "FRACTION_GENOME_ALTERED";

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
  bins?: { bx: number; by: number; n: number }[]; stats?: { spearman: number | null }; coverage?: { total: number; nx: number; ny: number } };

export function ExploreCharts({ studies, draft, attrs, endpoints, addClauses, km }: Props) {
  const hasScatter = [X_ATTR, Y_ATTR].every((a) => attrs.some((x) => x.attribute === a));
  const [endpoint, setEndpoint] = useState<string>("OS");
  const ep = endpoints && endpoints.length ? (endpoints.includes(endpoint) ? endpoint : endpoints[0]) : null;
  const [res, setRes] = useState<{ key: string; survival?: { curves?: unknown[]; error?: string }; plot?: { data?: PlotData; error?: string } } | null>(null);
  const [loading, setLoading] = useState(false);
  const want = useRef("");
  const key = JSON.stringify([studies, draft, ep, hasScatter]);

  useEffect(() => {
    if (!studies.length || (!ep && !hasScatter)) return;
    want.current = key;
    setLoading(true);
    const cohort: CohortDef = { ...(studies.length > 1 ? { studies } : {}), all: (draft ? draft.all : []) as CohortDef["all"] };
    const views: View[] = [];
    if (ep) views.push({ kind: "survival", endpoint: ep });
    if (hasScatter) views.push({ kind: "plot", unit: "sample", x: { source: "clinical", attribute: X_ATTR, log: true }, y: { source: "clinical", attribute: Y_ATTR }, bins: [48, 32] });
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
          <span className="xc-title">Mutation count vs fraction genome altered</span>
          <span className="meta">{res && res.plot && res.plot.data && res.plot.data.coverage && res.plot.data.coverage.total > res.plot.data.n
            ? fmtInt(res.plot.data.n) + " of " + fmtInt(res.plot.data.coverage.total) + " samples have both · " : ""}drag a box to filter</span>
        </div>
        <div className="xc-body">
          {res && res.plot && res.plot.data && res.plot.data.shape === "scatter" && !res.plot.data.grid &&
            <p className="note">no sample in the selection has both values</p>}
          {res && res.plot && res.plot.data && res.plot.data.shape === "scatter" && res.plot.data.grid &&
            <Density data={res.plot.data} onSelect={(x0, x1, y0, y1) => addClauses([
              // the x axis is log10(count + 1): back to whole counts, the box's inside edges
              { kind: "clinical", attribute: X_ATTR, range: { gte: Math.ceil(10 ** x0 - 1 - 1e-9), lte: Math.floor(10 ** x1 - 1 + 1e-9) }, per: "sample" },
              { kind: "clinical", attribute: Y_ATTR, range: { gte: y0, lte: y1 }, per: "sample" }])} />}
          {res && res.plot && res.plot.error && <p className="note">{res.plot.error}</p>}
          {stale && <div className="xc-wait"><span className="spinner" /> {res ? "updating…" : "loading…"}</div>}
        </div>
      </div>
    )}
  </>;
}

/** A density of the binned scatter with a drag-to-select box; the box's corners become value ranges. */
function Density({ data, onSelect }: { data: PlotData; onSelect: (x0: number, x1: number, y0: number, y1: number) => void }) {
  const { ref, width } = useWidth(260);
  const W = width ?? 340, H = Math.round(Math.max(200, Math.min(300, W * 0.62)));
  const e = data.extent!, [gx, gy] = data.grid!;
  const yTitle = "fraction genome altered", xTitle = "mutation count (log scale)";
  // ticks: round fractions up the side; whole counts along the bottom, the axis being log10(count + 1)
  const ys0 = linear(e.y0, e.y1, 0, 1, { nice: false });
  const L = 6 + leftAxisWidth(ys0, yTitle), R = 10, T = 8, B = bottomAxisHeight(xTitle) + 2, PW = W - L - R, PH = H - T - B;
  const ys = linear(e.y0, e.y1, T + PH, T, { nice: false });
  const xs = linear(e.x0, e.x1, L, L + PW, { nice: false });
  xs.ticks = [0, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000].map((c) => Math.log10(c + 1)).filter((t) => t >= e.x0 - 1e-9 && t <= e.x1 + 1e-9);
  xs.fmt = (t) => fmtInt(10 ** t - 1);
  const pal = { ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)" };
  const axes = axisLeft(ys, L, pal, { title: yTitle }) + axisBottom(xs, T + PH, pal, { title: xTitle, minX: 0, maxX: W });
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const maxN = Math.max(1, ...(data.bins || []).map((b) => b.n));
  const vx = (px: number) => e.x0 + (e.x1 - e.x0) * Math.min(1, Math.max(0, (px - L) / PW));
  const vy = (py: number) => e.y0 + (e.y1 - e.y0) * Math.min(1, Math.max(0, (T + PH - py) / PH));
  const local = (ev: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
  };
  const round = (v: number, span: number) => { const d = Math.max(0, 2 - Math.floor(Math.log10(Math.max(1e-9, span)))); return Number(v.toFixed(d)); };
  return (
    <div ref={ref}>
      {width != null && (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="xc-density" role="img"
          aria-label={"density of " + fmtInt(data.n) + " samples; drag to select a range"}
          onPointerDown={(ev) => { const p = local(ev); (ev.target as Element).setPointerCapture?.(ev.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={(ev) => { if (drag) { const p = local(ev); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 4 && Math.abs(drag.y1 - drag.y0) > 4) {
              const ax = [vx(Math.min(drag.x0, drag.x1)), vx(Math.max(drag.x0, drag.x1))];
              const ay = [vy(Math.max(drag.y0, drag.y1)), vy(Math.min(drag.y0, drag.y1))];
              onSelect(ax[0], ax[1], round(ay[0], e.y1 - e.y0), round(ay[1], e.y1 - e.y0));
            }
            setDrag(null);
          }}>
          <rect x={L} y={T} width={PW} height={PH} className="xc-frame" />
          {(data.bins || []).map((b, i) => (
            <rect key={i} x={L + PW * b.bx / gx} y={T + PH - PH * (b.by + 1) / gy} width={PW / gx + 0.3} height={PH / gy + 0.3}
              className="xc-cell" opacity={0.15 + 0.85 * Math.log1p(b.n) / Math.log1p(maxN)}><title>{fmtInt(b.n) + " samples"}</title></rect>
          ))}
          {/* the axes are drawn by the figures' own kit (lib/chart/axis.ts), which escapes what it writes */}
          <g dangerouslySetInnerHTML={{ __html: axes }} />
          {drag && <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="xc-brush" />}
        </svg>
      )}
    </div>
  );
}
