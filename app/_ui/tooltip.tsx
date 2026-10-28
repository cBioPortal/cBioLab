"use client";
// THE app's tooltips. Two parts, both drawn into document.body with fixed positions, so a scrolling
// or clipped container (the oncoprint, the timeline, a dialog's list) never cuts one off:
//
// - `TooltipLayer`, mounted once by the root layout: any element with `data-tip="…"` shows that text
//   on hover (after a short pause, at once while moving between tipped elements) and on keyboard
//   focus. It replaces the browser's `title`, which waits about a second and can't be styled. A
//   `<title>` inside a figure's drawn SVG (the renderers in lib/ emit them for MCP, exports and the
//   CLI) is read the same way. A tip that only repeats text the reader can already see whole is
//   not shown, so `data-tip` on a cell that may be cut with an ellipsis appears only when it is cut.
// - `FloatingTip`, for a component that draws its own rich tip at the pointer (an oncoprint cell,
//   a timeline event): it places it beside the pointer, inside the viewport. With `useHoverTip` the
//   reader can move into it and click what it holds (an oncoprint cell's link to its patient).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DELAY = 300;
const WARM = 400;
const GAP = 8;
const EDGE = 8;
/** how long a tip waits for a pointer heading into it before following the pointer instead */
const HEADING = 300;

type Shown = { el: Element; text: string; x: number; rect: DOMRect };

/** the nearest element that carries a tip, reading a drawn SVG's `<title>` into `data-tip` on the way */
function tipTarget(from: EventTarget | null): Element | null {
  let el = from instanceof Element ? from : null;
  for (; el; el = el.parentElement) {
    if (el.hasAttribute("data-tip")) return el.getAttribute("data-tip") ? el : null;
    if (el instanceof SVGElement) {
      const t = [...el.children].find((c) => c.tagName === "title");
      // React-rendered <title>s are left alone: removing a node React owns breaks its next render
      if (t && !Object.keys(t).some((k) => k.startsWith("__react"))) {
        el.setAttribute("data-tip", t.textContent || "");
        if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", t.textContent || "");
        t.remove();
        return el;
      }
    }
  }
  return null;
}

const words = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** a tip that says no more than the element's own text, shown whole, adds nothing (a drawn label
 *  cut to fit ends in "…", so it no longer matches; a fold marker or other symbol beside it is not text) */
function redundant(el: Element, text: string): boolean {
  if (words(el.textContent || "") !== words(text)) return false;
  if (!(el instanceof HTMLElement)) return true;
  return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef(0);
  const current = useRef<Element | null>(null);
  // the element just clicked keeps quiet until the pointer leaves it, as the browser's title does
  const quiet = useRef<Element | null>(null);
  const pointer = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    const hide = () => {
      cancel();
      if (current.current) hiddenAt.current = Date.now();
      current.current = null;
      setShown((s) => (s ? null : s));
    };
    const show = (el: Element, byPointer: boolean) => {
      const text = el.getAttribute("data-tip") || "";
      if (!text || redundant(el, text)) return;
      let rect = el.getBoundingClientRect();
      // a large target (a table row, a long label, a tall bar) is tipped at the pointer, not around it
      if (byPointer && (rect.width > 240 || rect.height > 48)) {
        const [px, py] = pointer.current;
        rect = new DOMRect(px, py - 12, 0, 32);
      }
      current.current = el;
      setShown({ el, text, x: rect.left + rect.width / 2, rect });
    };
    const arm = (el: Element, byPointer: boolean) => {
      cancel();
      if (Date.now() - hiddenAt.current < WARM || current.current) show(el, byPointer);
      else timer.current = setTimeout(() => show(el, byPointer), DELAY);
    };
    const onMove = (e: PointerEvent) => { pointer.current = [e.clientX, e.clientY]; };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = tipTarget(e.target);
      if (el === current.current && el) return;
      if (quiet.current && quiet.current !== el) quiet.current = null;
      if (!el || el === quiet.current) { if (current.current || timer.current) hide(); return; }
      if (current.current) { hiddenAt.current = Date.now(); current.current = null; }
      pointer.current = [e.clientX, e.clientY];
      arm(el, true);
    };
    const onOut = (e: PointerEvent) => {
      // leaving the page, or into nothing that carries a tip
      if (!e.relatedTarget) { quiet.current = null; hide(); }
    };
    const onDown = (e: PointerEvent) => { quiet.current = tipTarget(e.target); hide(); };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element;
      if (!(t instanceof Element) || !t.matches(":focus-visible")) return;
      const el = tipTarget(t);
      if (el) arm(el, false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      cancel();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // the tipped element changes its tip, or leaves the page, while the tip is up
  useEffect(() => {
    if (!shown) return;
    const { el } = shown;
    const mo = new MutationObserver(() => {
      const text = el.getAttribute("data-tip");
      if (!el.isConnected || !text) { current.current = null; setShown(null); }
      else if (text !== shown.text) setShown({ ...shown, text });
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-tip"] });
    if (el.parentNode) mo.observe(el.parentNode, { childList: true });
    return () => mo.disconnect();
  }, [shown]);

  if (!shown) return null;
  // a modal <dialog> sits in the browser's top layer, above anything in body, so its tips go inside it
  return createPortal(<Bubble shown={shown} />, shown.el.closest("dialog[open]") || document.body);
}

function Bubble({ shown }: { shown: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current; if (!box) return;
    const w = box.offsetWidth, h = box.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const { rect, x } = shown;
    const left = Math.max(EDGE, Math.min(x - w / 2, vw - w - EDGE));
    const below = rect.bottom + GAP;
    const top = below + h <= vh - EDGE || rect.top - GAP - h < EDGE ? below : rect.top - GAP - h;
    setPos({ left, top: Math.max(EDGE, Math.min(top, vh - h - EDGE)) });
  }, [shown]);
  return (
    <div ref={ref} role="tooltip" className="tip" style={pos ? pos : { left: 0, top: 0, visibility: "hidden" }}>
      {shown.text}
    </div>
  );
}

type Live = { ref: React.RefObject<HTMLDivElement | null>; onPointerEnter: () => void; onPointerLeave: () => void };

const gap = (x: number, y: number, r: DOMRect) =>
  Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/**
 * The state of a tip the reader can move into. `move(next, x, y)` on every pointer move over the
 * figure (`next` null over nothing tipped, and on leaving it): while the pointer is heading for the
 * tip it stays where it is, so crossing other cells on the way does not move it, and while the
 * pointer is over it, it stays open. A pointer that stops short is followed after `HEADING` ms.
 * `hide()` closes it at once. Pass `live` to the FloatingTip.
 */
export function useHoverTip<T>() {
  const [tip, setTip] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const inside = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (pending.current) { clearTimeout(pending.current); pending.current = null; } };
  const move = useCallback((next: T | null, x: number, y: number) => {
    clear();
    if (inside.current) return;
    const prev = last.current; last.current = [x, y];
    const r = ref.current?.getBoundingClientRect();
    if (r && prev && gap(x, y, r) < gap(prev[0], prev[1], r)) pending.current = setTimeout(() => setTip(next), HEADING);
    else setTip(next);
  }, []);
  const hide = useCallback(() => { clear(); inside.current = false; last.current = null; setTip(null); }, []);
  useEffect(() => clear, []);
  const live = useMemo<Live>(() => ({
    ref,
    onPointerEnter: () => { inside.current = true; clear(); },
    onPointerLeave: () => { inside.current = false; last.current = null; setTip(null); },
  }), []);
  return { tip, move, hide, live };
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** a rich tip drawn at the pointer (viewport coordinates), kept inside the viewport; with `live`
 *  (from useHoverTip) the pointer can enter it and click what it holds */
export function FloatingTip({ x, y, className, live, children }: { x: number; y: number; className?: string; live?: Live; children: React.ReactNode }) {
  const own = useRef<HTMLDivElement>(null);
  const ref = live ? live.ref : own;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current; if (!box) return;
    const w = box.offsetWidth, h = box.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const left = x + 14 + w <= vw - EDGE ? x + 14 : Math.max(EDGE, x - 14 - w);
    const top = y + 14 + h <= vh - EDGE ? y + 14 : Math.max(EDGE, y - 14 - h);
    setPos({ left, top });
  }, [x, y, children, ref]);
  if (typeof document === "undefined") return null;
  return createPortal(
    // a portal still bubbles React events to the figure that drew it; the tip's own clicks stay here
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- hover keeps the tip open; its links are the controls
    <div ref={ref} className={"onco-tip" + (live ? " live" : "") + (className ? " " + className : "")} style={pos ? pos : { left: 0, top: 0, visibility: "hidden" }}
      onPointerEnter={live?.onPointerEnter} onPointerLeave={live?.onPointerLeave} onPointerDown={stop} onMouseDown={stop} onClick={stop} onKeyDown={stop} onMouseMove={stop}>
      {children}
    </div>,
    document.body);
}
