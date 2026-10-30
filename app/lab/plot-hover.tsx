"use client";
// A plot's hover: one listener over the whole figure maps the pointer to the nearest drawn point (a
// grid index over the marks the renderer tagged with `data-id`), rather than a listener or a
// `<title>` per point, and shows that case's tip (lib/views/plot/point-tip.ts) beside it, with a
// link to its page when the plot is over one study. The hovered point is drawn again on top of its
// neighbours and ringed, so the reader sees which dot the tip is about. Browser state only, like any hover.
import { useEffect, useRef } from "react";
import { FloatingTip, useHoverTip, type TipBox } from "../_ui/tooltip.tsx";
import type { PlotData } from "../../lib/plot.ts";
import { pointTip, type PointTip } from "../../lib/views/plot/point-tip.ts";

/** how far from a point's centre, in pixels, the pointer still picks it */
const REACH = 6;
const CELL = 16;

type Mark = { el: Element; x: number; y: number };
type Index = { svg: SVGSVGElement; cells: Map<string, Mark[]> };

/** every tagged mark of the figure by grid cell, in its own pixel coordinates (figures are drawn 1:1) */
function indexOf(svg: SVGSVGElement): Index {
  const cells = new Map<string, Mark[]>();
  for (const el of svg.querySelectorAll("[data-id]")) {
    let x: number, y: number;
    if (el instanceof SVGCircleElement) { x = el.cx.baseVal.value; y = el.cy.baseVal.value; }
    else { const b = (el as SVGGraphicsElement).getBBox(); x = b.x + b.width / 2; y = b.y + b.height / 2; }
    const k = Math.floor(x / CELL) + ":" + Math.floor(y / CELL);
    (cells.get(k) ?? cells.set(k, []).get(k)!).push({ el, x, y });
  }
  return { svg, cells };
}

/** a mark the reader can see: not in a hidden group, not in a layer stepped back to a ghost */
function visible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  const g = el.closest("g[data-layer]");
  return !g || Number(getComputedStyle(g).opacity) > 0.5;
}

/** the visible mark nearest (x, y) within REACH; the later of two equally near, as it is drawn on top */
function nearest(ix: Index, x: number, y: number): Mark | null {
  let best: Mark | null = null, bestD = REACH * REACH;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++)
    for (const m of ix.cells.get(i + ":" + j) || []) {
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d <= bestD && visible(m.el)) { best = m; bestD = d; }
    }
  return best;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The hovered point drawn again at the end of the figure, so no neighbour covers it, with a ring
 * round it; one group, replaced by the next hover and removed when the hover ends. The figure is
 * markup the page sets whole (app/lab/figure.tsx), so a redraw takes this group with it.
 */
function highlight(svg: SVGSVGElement, m: Mark): () => void {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "plot-hover-mark");
  const dot = m.el.cloneNode(true) as Element;
  dot.removeAttribute("data-id");
  const b = (m.el as SVGGraphicsElement).getBBox();
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", String(m.x));
  ring.setAttribute("cy", String(m.y));
  ring.setAttribute("r", String(Math.max(b.width, b.height) / 2 + 2));
  g.append(dot, ring);
  svg.append(g);
  return () => g.remove();
}

type Hover = { tip: PointTip; at: TipBox; svg: SVGSVGElement; mark: Mark };

export function PlotHover({ plot, unit, study, className, children }: {
  plot?: PlotData;
  unit: "patient" | "sample";
  /** the plot's one study, for a link to the case's page; none over several */
  study?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const index = useRef<Index | null>(null);
  const { tip: hover, move, hide, live } = useHoverTip<Hover>();
  useEffect(() => hover ? highlight(hover.svg, hover.mark) : undefined, [hover]);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const svg = e.currentTarget.querySelector("svg");
    if (!plot || !svg) return;
    if (index.current?.svg !== svg) index.current = indexOf(svg);
    const r = svg.getBoundingClientRect();
    const m = nearest(index.current, e.clientX - r.left, e.clientY - r.top);
    const tip = m && pointTip(plot, m.el.getAttribute("data-id") || "", m.el.closest("g[data-layer]")?.getAttribute("data-layer") || "base");
    if (!m || !tip) { move(null, e.clientX, e.clientY); return; }
    const b = m.el.getBoundingClientRect();
    move({ tip, at: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, svg, mark: m }, e.clientX, e.clientY);
  };
  const t = hover?.tip;
  return (
    <div className={className} onPointerMove={onMove} onPointerLeave={(e) => move(null, e.clientX, e.clientY)} onPointerDown={hide}>
      {children}
      {hover && t && (
        <FloatingTip at={hover.at} live={live} className="plot-tip">
          <div className="mono">{t.id}</div>
          {t.rows.map(([k, v], i) => <div key={i}>{k}: <b>{v}</b></div>)}
          {t.layers.length > 0 && <div className="dim">in {t.layers.join(", ")}</div>}
          {study && <a className="tip-link" href={"/portal/patient?" + new URLSearchParams({ study, [unit]: t.id }).toString()} target="_blank" rel="noreferrer">
            {unit === "sample" ? "open this sample" : "open this patient"} ↗</a>}
        </FloatingTip>
      )}
    </div>
  );
}
