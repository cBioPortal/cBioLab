"use client";
// Clicking the lollipop's stems, as the portal's mutation mapper takes them (react-mutation-mapper
// LollipopPlotNoTooltip): a click on a head selects that codon, shift-click adds it to or takes it
// out of the selection, and a click on the plot away from any head clears it. The figure is the
// renderer's SVG (lib/lollipop-svg.ts), which tags each stem with its gene and codon; one listener
// over the figure finds the head under the pointer, so the drawing carries no handlers of its own.
// The head under the pointer grows as the portal's does — browser state only, like any hover.
import { useEffect, useRef, type RefObject } from "react";

/** how far from a head's centre, in the figure's pixels, the pointer still picks it (the portal's hover radius) */
const REACH = 6;
const HOVER_R = "5";

type Head = { circle: SVGCircleElement; codon: number };

/** the head nearest the pointer within REACH, or null */
function headAt(svg: SVGSVGElement, e: MouseEvent): Head | null {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  let best: Head | null = null, bestD = REACH;
  for (const g of svg.querySelectorAll("g[data-codon]")) {
    const circle = g.querySelector("circle.lollipop-head");
    if (!(circle instanceof SVGCircleElement)) continue;
    const d = Math.hypot(circle.cx.baseVal.value - pt.x, circle.cy.baseVal.value - pt.y);
    if (d <= Math.max(bestD, circle.r.baseVal.value)) { best = { circle, codon: Number(g.getAttribute("data-codon")) }; bestD = d; }
  }
  return best;
}

export function useStemClicks(ref: RefObject<HTMLElement | null>, on: { pick: (codon: number, multi: boolean) => void; clear: () => void }) {
  // the latest handlers, so the listeners are added once rather than on every render
  const latest = useRef(on);
  useEffect(() => { latest.current = on; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hovered: { circle: SVGCircleElement; r: string } | null = null;
    const unhover = () => {
      if (hovered) hovered.circle.setAttribute("r", hovered.r);
      hovered = null;
      el.style.cursor = "";
    };
    const svgOf = (e: MouseEvent) => (e.target instanceof Element ? e.target.closest("svg") : null);
    const move = (e: MouseEvent) => {
      const svg = svgOf(e);
      const h = svg ? headAt(svg, e) : null;
      if (h?.circle === hovered?.circle) return;
      unhover();
      if (!h) return;
      hovered = { circle: h.circle, r: h.circle.getAttribute("r") || "2.8" };
      if (Number(hovered.r) < Number(HOVER_R)) h.circle.setAttribute("r", HOVER_R);
      el.style.cursor = "pointer";
    };
    // shift-click would otherwise extend the page's text selection across the figure
    const down = (e: MouseEvent) => { if (e.shiftKey && svgOf(e)) e.preventDefault(); };
    const click = (e: MouseEvent) => {
      const svg = svgOf(e);
      if (!svg) return;
      const h = headAt(svg, e);
      if (h) latest.current.pick(h.codon, e.shiftKey);
      else latest.current.clear();
    };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", unhover);
    el.addEventListener("mousedown", down);
    el.addEventListener("click", click);
    return () => {
      unhover();
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", unhover);
      el.removeEventListener("mousedown", down);
      el.removeEventListener("click", click);
    };
  }, [ref]);
}
