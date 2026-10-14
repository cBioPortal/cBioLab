"use client";
// A figure drawn in the browser at the width its card gives it, by the same renderer MCP and the
// portal use (lib/view-svg.ts and the modules it draws through). Drawn at the card's width, a
// figure's text is its own size: never scaled down to fit (unreadable), never scaled up to fill
// (oversized), and the space beside it is used rather than left empty. A figure that needs more
// room than the card has keeps its size and scrolls sideways, with an edge that says so.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { viewToSvg } from "../../lib/view-svg.ts";
import type { ViewResult } from "../../lib/types.ts";

/** narrower than this a figure stops reflowing and scrolls instead */
export const MIN_FIGURE_W = 560;

/** the width of an element's content box, followed as it changes; null before the first measure */
export function useWidth(min = MIN_FIGURE_W) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 8px steps, so a resize redraws a figure a few times rather than on every pixel
    const measure = () => setWidth(Math.max(min, Math.floor(el.clientWidth / 8) * 8));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return { ref, width };
}

/** SVG markup laid out at `width` (lib/svg-kit.ts frame()), shown 1:1, scrolling when wider than its box */
export function SvgAtWidth({ svg, className = "viewfig" }: { svg: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const w = Number(/viewBox="0 0 ([\d.]+) /.exec(svg)?.[1]) || undefined;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [svg]);
  return (
    <div className={className + " figbox"} data-more={more || undefined}>
      <div ref={box} className="figscroll">
        {/* the renderer escapes every label it writes (lib/chart/esc.ts) */}
        <div style={{ width: w }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {more && <span className="figmore" aria-hidden>scroll →</span>}
    </div>
  );
}

/** A view's figure drawn here at its card's width; with none, says so in words — unless the view's error says why already. */
export function ViewFigure({ v, error, empty = "nothing to draw", className, min }: { v: ViewResult; error?: string | null; empty?: string; className?: string; min?: number }) {
  const { ref, width } = useWidth(min);
  const svg = useMemo(() => width == null ? null : viewToSvg(v, { width }), [v, width]);
  return (
    <div ref={ref} className="figwidth">
      {svg ? <SvgAtWidth svg={svg} className={className} /> : width != null && !error ? <p className="note">{empty}</p> : null}
    </div>
  );
}

/** Any figure function drawn at its box's width (portal bodies, lollipop, timeline) */
export function DrawAtWidth({ draw, deps, className, min }: { draw: (width: number) => string | null; deps: unknown[]; className?: string; min?: number }) {
  const { ref, width } = useWidth(min);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` are the drawing's inputs, named by the caller
  const svg = useMemo(() => width == null ? null : draw(width), [width, ...deps]);
  return <div ref={ref} className="figwidth">{svg && <SvgAtWidth svg={svg} className={className} />}</div>;
}
