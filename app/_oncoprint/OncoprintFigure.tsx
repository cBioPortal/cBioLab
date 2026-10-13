"use client";
// The interactive oncoprint: fetch the binary contract for a spec, decode it into typed
// arrays, and draw it on a level-of-detail canvas with zoom, pan, hover, hide-unaltered,
// client-side re-sort and category gaps.
//
// Used by the analysis page and by the lab. Viewing options are CONTROLLED props so the
// analysis page can keep them in its document (and therefore in the URL, the server SVG,
// the CLI and the Python package) while the lab keeps them in local state. Only `spec`
// changes cause a refetch; everything else is applied to the decoded arrays in place.
import { useEffect, useMemo, useRef, useState } from "react";
import { unpackContract, type UnpackedContract } from "../../lib/oncoprint-binary.ts";
import { GEOM, PALETTE, CAT_COLORS, canvasHeight, decodeGene, draw, fitZoom, groupOffsets, hitTest, paletteOf, segmentByTrack, sortColumns,
  virtualWidth, type Gap, type Hit, type View, type VisibleGroup } from "./canvas.ts";
import { geneLegendFor, resolveStyle, styleForDisplay, trackTooltipLines } from "../../lib/oncoprint-style.ts";
import { labLinks } from "../../lib/lab-links.ts";
import type { ColumnDetail } from "../../lib/oncoprint-detail.ts";
import { setPngDpi } from "../../lib/png-dpi.ts";
import { api } from "../lab/api.ts";
import type { UploadBinding } from "../lab/custom-data-client.ts";
import type { OncoprintBody } from "../../lib/api-schemas.ts";
import type { OncoprintSpec } from "../../lib/types.ts";
import { Check, Download, Ellipsis, ImageDown, ListOrdered, LoaderCircle, Minus, Plus, Sheet, SlidersHorizontal, Tag, X } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { GearMenu, MenuItem } from "../_ui/gear-menu.tsx";
import { Input } from "../_ui/input";
import { OptionSelect } from "../_ui/choice.tsx";
import { FIELD, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

/** one of the zoom group's buttons: the group draws the border */
const ZOOM = "h-full rounded-none text-muted-foreground hover:bg-muted hover:text-foreground";

const MAX_ZOOM = 24;
/** common page widths for the export dialog's preset picker; the number field beside it takes any value */
const EXPORT_PRESETS: { label: string; in: number }[] = [
  { label: "Half page (5.5\")", in: 5.5 }, { label: "A4 (8.27\")", in: 8.27 }, { label: "Letter (8.5\")", in: 8.5 }, { label: "Poster (24\")", in: 24 },
];
/** the layout is computed in this reference density regardless of the raster DPI chosen for a PNG,
 * so a figure at a given inch width has the same proportions whether exported as SVG or PNG */
const EXPORT_LAYOUT_DPI = 96;

/** unaltered cells drawn white; not-profiled keeps its stripe, which is what still tells them apart */
function withBackground(S: ReturnType<typeof resolveStyle>, white?: boolean) {
  if (!white) return S;
  return { ...S, palette: { ...S.palette, unaltered: "#ffffff" },
    glyph: { ...S.glyph, notProfiled: { ...S.glyph.notProfiled, fill: "#ffffff" } } };
}

/**
 * The viewing options the BROWSER can apply to a decoded contract: they change the picture,
 * never a number, so they never need a refetch. Options that change numbers — hideVUS,
 * annotate — live in the spec and are the page's business.
 */
export interface FigureDisplay {
  showUnaltered: boolean; whitespace: boolean; gaps: "none" | "gaps" | "pct" | "pct-left"; colorByType: boolean;
  /** per track, per value: the portal's Edit Colors, applied in the browser */
  colors?: Record<string, Record<string, string>>;
  /**
   * Draw unaltered cells white instead of grey. The portal offers this for printing and warns
   * about it, because profiled and unprofiled then look alike — so the legend says so too.
   */
  whiteBackground?: boolean;
}
export const DEFAULT_FIGURE_DISPLAY: FigureDisplay = { showUnaltered: true, whitespace: true, gaps: "none", colorByType: true };

export interface Perf { fetchMs?: number; bytes?: number; engineMs?: number; packMs?: number; decodeMs?: number; drawMs?: number;
  cellsDrawn?: number; bucketsDrawn?: number; sortMs?: number; hideMs?: number; gapMs?: number; frames: number; heapMB?: number;
  /** compressed size of the response, when the server reported it */
  wireBytes?: number }

export interface OncoprintFigureProps {
  /** POSTed to the endpoint below; a change of value (by JSON) refetches */
  spec: unknown;
  /** where the contract comes from; the local-tables route takes the same shapes back */
  endpoint?: string;
  /** ordered sort keys: "genomic" | "id" | "[-]<track label>"; empty = the engine's own order */
  sortKeys: string[];
  display: FigureDisplay;
  onSortKeys: (keys: string[]) => void;
  /** move a track within its kind, or drop it; absent means the page cannot edit tracks */
  onMoveTrack?: (label: string, dir: -1 | 1) => void;
  onRemoveTrack?: (label: string) => void;
  /** draw a merged gene row's members as rows of their own */
  onExpandTrack?: (label: string) => void;
  /** the Tracks menu's contents — the page owns what can be added */
  tracksMenu?: React.ReactNode;
  onDisplay: (d: FigureDisplay) => void;
  /** extra toolbar controls, placed before the viewing options */
  controls?: React.ReactNode;
  /** below the legend — the page's provenance panel, say */
  footer?: React.ReactNode;
  /** called with each decoded contract (frequencies, queries, column count) */
  onContract?: (c: UnpackedContract) => void;
  /** the document's pinned uploads: a spec names datasets but carries no pins of its own */
  uploads?: UploadBinding[];
  /** show the timings panel (the lab's instrument) */
  timings?: boolean;
  /** expose the figure on window.__onco so headless runs can drive it */
  instrument?: boolean;
  busy?: boolean;
  /**
   * Turn a dragged selection of columns into a cohort. Absent means the figure still lets a
   * reader drag and count, but offers no cohort action — the lab and the pasted-data page have
   * no document to put one in. Throwing is how the page refuses; the message is shown in the
   * dialog.
   */
  onCreateCohort?: (sel: ColumnSelection) => void | Promise<void>;
  /**
   * Freeze a dragged selection into a yes/no attribute: the selected columns against every
   * other column in the figure (`all`). Absent means no such action. Throwing refuses, as above.
   */
  onSaveFeature?: (sel: ColumnSelection, all: string[]) => void | Promise<void>;
}

/** what a drag across the plot picked out */
export interface ColumnSelection {
  /** the column ids as drawn, in drawn order */
  ids: string[];
  unit: string;
  /** the name typed in the dialog */
  name: string;
  /** the column groups the drag crossed */
  groups: string[];
}

/** a cohort's explicit id list is capped in the compiler; the dialog says so before the refusal */
const MAX_SELECTION = 50000;

export default function OncoprintFigure(props: OncoprintFigureProps) {
  const { spec, sortKeys, display, onSortKeys, onDisplay, busy } = props;
  const [data, setData] = useState<UnpackedContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [perf, setPerf] = useState<Perf>({ frames: 0 });
  const [view, setView] = useState<View>({ zoom: 1, scrollX: 0, whitespace: display.whitespace });
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  /** the gutter label under the pointer: a track row, not a column */
  const [labelHover, setLabelHover] = useState<{ ti: number; x: number; y: number } | null>(null);
  // per-column specifics, fetched only for the column under the pointer and remembered
  const [detail, setDetail] = useState<Record<string, ColumnDetail | "loading">>({});
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the track whose menu is open, and where to put it */
  const [trackMenu, setTrackMenu] = useState<{ ti: number; x: number; y: number } | null>(null);
  /** a drag across the plot: canvas x of where it started and where it is now */
  const [sel, setSel] = useState<{ x0: number; x1: number; live: boolean } | null>(null);
  /**
   * A finished selection, held in k-space (positions in the drawn order) rather than in pixels,
   * so scrolling or zooming while the dialog is open moves the marquee with the columns it
   * picked instead of quietly picking different ones.
   */
  const [selRanges, setSelRanges] = useState<{ gi: number; k0: number; k1: number }[] | null>(null);
  const [selName, setSelName] = useState("selection");
  const [selBusy, setSelBusy] = useState(false);
  const [selError, setSelError] = useState<string | null>(null);
  const [cssW, setCssW] = useState(1200);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [showMini, setShowMini] = useState(false);
  // Export sizing is a one-off action, not a view of the figure — nobody else reading a shared
  // link needs to know what page width someone once exported it at — so it stays local state,
  // not a `display` field.
  // in state, so the preview draws once the dialog has mounted its canvas
  const [exportCanvas, setExportCanvas] = useState<HTMLCanvasElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "svg">("png");
  const [exportWidthIn, setExportWidthIn] = useState(8.5);
  const [exportDpi, setExportDpi] = useState(150);
  const openExport = () => setExportOpen(true);
  const perfRef = useRef<Perf>({ frames: 0 });
  const bump = (p: Partial<Perf>) => {
    perfRef.current = { ...perfRef.current, ...p };
    setPerf(perfRef.current);
    if (props.instrument) (window as any).__onco = { ...(window as any).__onco, perf: perfRef.current };
  };

  // ---- fetch + decode: only when the spec itself changes -------------------
  const specKey = useMemo(() => JSON.stringify(spec), [spec]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    (async () => {
      try {
        const t0 = performance.now();
        const res = await api.oncoprint(JSON.parse(specKey), { query: "?format=bin&provenance=1", endpoint: props.endpoint, pins: props.uploads });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        const buf = await res.arrayBuffer();
        const fetchMs = performance.now() - t0;
        const t1 = performance.now();
        const d = unpackContract(buf);
        const decodeMs = performance.now() - t1;
        if (!alive) return;
        const raw = Number(res.headers.get("X-Raw-Bytes")) || 0;
        bump({ fetchMs, bytes: buf.byteLength, decodeMs, engineMs: Number(res.headers.get("X-Engine-Ms")) || undefined,
          packMs: Number(res.headers.get("X-Pack-Ms")) || undefined,
          ...(raw && raw === buf.byteLength ? {} : {}) });
        setData(d); setLoading(false);
        props.onContract?.(d);
      } catch (e) { if (alive) { setError(String((e as Error).message || e)); setLoading(false); } }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, props.endpoint]);

  useEffect(() => { setView((v) => ({ ...v, whitespace: display.whitespace })); }, [display.whitespace]);

  // ---- visible columns: an order indirection, never a copy of the data ------
  const base = useMemo(() => {
    if (!data) return null;
    const order = new Uint32Array(data.n); for (let i = 0; i < data.n; i++) order[i] = i;
    const groups: VisibleGroup[] = data.groups.map((g) => ({ name: g.name, start: g.start, count: g.count, patients: g.patients ?? g.count }));
    return { order, groups };
  }, [data]);

  // gaps follow the primary sort key, and only when it is categorical (runs are contiguous only then)
  const primaryKey = data ? (((sortKeys[0] || "").startsWith("cluster:") ? data.conventions.sort[0] : sortKeys[0]) || data.conventions.sort[0] || "genomic").replace(/^-/, "") : "";
  const gapTrack = data ? data.tracks.find((t) => t.label === primaryKey && t.categories && t.categories.length) : undefined;
  const gapMode = gapTrack ? display.gaps : "none";
  const pctMode = gapMode === "pct" || gapMode === "pct-left";
  const gapPx: Gap = useMemo(() => gapMode === "none" ? GEOM.groupGap : gapMode === "pct" || gapMode === "pct-left"
    ? { px: 40, edge: gapMode === "pct-left" ? "left" : "right" } : 8, [gapMode]);

  const visible = useMemo(() => {
    if (!data || !base) return null;
    let order: Uint32Array = base.order; let groups: VisibleGroup[] = base.groups;
    if (!display.showUnaltered) {
      const t0 = performance.now();
      const genes = data.tracks.filter((t) => t.kind === "gene");
      const keep: number[] = []; const ng: VisibleGroup[] = [];
      for (const g of groups) {
        const start = keep.length;
        for (let k = g.start; k < g.start + g.count; k++) {
          const ci = order[k];
          let alt = false;
          for (const t of genes) if (t.cells[ci] > 0) { alt = true; break; }
          if (alt) keep.push(ci);
        }
        ng.push({ ...g, start, count: keep.length - start });
      }
      order = new Uint32Array(keep); groups = ng;
      bump({ hideMs: performance.now() - t0 });
    }
    // A clustering is computed in the engine from values the browser never receives, so a
    // figure sorted that way keeps the order it was given rather than trying to redo it.
    const engineSorted = sortKeys.some((k) => k.replace(/^-/, "").startsWith("cluster:"));
    if (sortKeys.length && !engineSorted) {
      const t0 = performance.now();
      order = sortColumns(data, order, groups, sortKeys.map((k) => k.startsWith("-")
        ? { track: k.slice(1), dir: "desc" as const } : { track: k, dir: "asc" as const }));
      bump({ sortMs: performance.now() - t0 });
    }
    if (gapMode !== "none" && gapTrack) {
      const t0 = performance.now();
      groups = segmentByTrack(data, order, groups, gapTrack.label, pctMode);
      bump({ gapMs: performance.now() - t0 });
    }
    return { order, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, base, display.showUnaltered, sortKeys.join("\u0000"), gapMode, gapTrack]);

  // ---- sizing ---------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setCssW(el.clientWidth));
    ro.observe(el); setCssW(el.clientWidth);
    return () => ro.disconnect();
  }, [data]);
  const plotW = Math.max(50, cssW - GEOM.gutter);
  const minZoom = visible ? fitZoom(visible.groups, plotW, gapPx) : 1;
  const maxScroll = visible ? Math.max(0, virtualWidth(visible.groups, view.zoom, gapPx) - plotW) : 0;

  // Fit when the set of drawn columns changes — not on a re-sort of the same columns, and not
  // when the width changes: a reader who has zoomed in should keep their zoom when the page
  // reflows (the scrollbar appearing was enough to snap them back to fit).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) setView((v) => ({ ...v, zoom: fitZoom(visible.groups, plotW, gapPx), scrollX: 0 })); }, [data, display.showUnaltered, gapMode]);
  // a narrower figure can leave the zoom below what now fits, or scrolled past the end
  useEffect(() => {
    if (!visible) return;
    setView((v) => {
      const zoom = Math.max(v.zoom, fitZoom(visible.groups, plotW, gapPx));
      const scrollX = Math.max(0, Math.min(v.scrollX, Math.max(0, virtualWidth(visible.groups, zoom, gapPx) - plotW)));
      return zoom === v.zoom && scrollX === v.scrollX ? v : { ...v, zoom, scrollX };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotW]);

  // ---- draw -----------------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !data || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const H = canvasHeight(data.tracks.length);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = cssW + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = withBackground(styleForDisplay(resolveStyle(data.display?.style), display), display.whiteBackground);
    const r = draw(ctx, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, Math.max(0, view.scrollX)) },
      cssW, paletteOf(S), { gap: gapPx, pctLabels: pctMode, style: S, colors: display.colors ?? data.display?.colors });
    const mem = (performance as any).memory;
    bump({ drawMs: r.ms, cellsDrawn: r.cellsDrawn, bucketsDrawn: r.bucketsDrawn, frames: perfRef.current.frames + 1, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible, view, cssW, maxScroll, gapPx, gapMode, display.colorByType, display.colors]);

  // ---- minimap: the whole figure at two pixels a row, with the viewport on it -----
  const MINI_ROW = 3;
  useEffect(() => {
    const cv = miniRef.current; if (!cv || !data || !visible || !showMini) return;
    const dpr = window.devicePixelRatio || 1;
    const H = data.tracks.length * MINI_ROW + 2;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = cssW + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = styleForDisplay(resolveStyle(data.display?.style), display);
    // the same renderer at row height 3 and no gutter: an overview, not a second drawing
    const saved = { ...GEOM };
    Object.assign(GEOM, { rowH: MINI_ROW - 1, rowGap: 1, gutter: 0, header: 0 });
    try {
      draw(ctx, data, visible.order, visible.groups, { zoom: fitZoom(visible.groups, cssW, gapPx), scrollX: 0, whitespace: false },
        cssW, paletteOf(S), { gap: gapPx, style: S, colors: display.colors ?? data.display?.colors });
    } finally { Object.assign(GEOM, saved); }
    // the viewport
    const vw = virtualWidth(visible.groups, view.zoom, gapPx) || 1;
    const x0 = cssW * Math.min(maxScroll, view.scrollX) / vw, w = Math.max(2, cssW * plotW / vw);
    ctx.strokeStyle = "#1f2933"; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, Math.min(w, cssW - x0) - 1, H - 1);
    ctx.fillStyle = "rgba(31,41,51,0.10)";
    ctx.fillRect(0, 0, x0, H); ctx.fillRect(x0 + w, 0, cssW - x0 - w, H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible, view, cssW, gapPx, showMini, display]);

  // ---- export preview: the same draw() the PNG download uses, at the dialog's chosen width ----
  useEffect(() => {
    if (!exportOpen || !data || !visible) return;
    const cv = exportCanvas; if (!cv) return;
    const w = Math.max(200, Math.round(exportWidthIn * EXPORT_LAYOUT_DPI));
    const H = canvasHeight(data.tracks.length);
    cv.width = w; cv.height = H;
    cv.style.width = w + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const S2 = withBackground(styleForDisplay(resolveStyle(data.display?.style), display), display.whiteBackground);
    draw(ctx, data, visible.order, visible.groups, { zoom: fitZoom(visible.groups, w - GEOM.gutter, gapPx), scrollX: 0, whitespace: display.whitespace },
      w, paletteOf(S2), { gap: gapPx, pctLabels: pctMode, style: S2, colors: display.colors ?? data.display?.colors });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOpen, exportCanvas, exportWidthIn, data, visible, gapPx, gapMode, display]);

  /**
   * The scrollbar is ours rather than the browser's. A native one over a virtual width of
   * 200,000 px gives a five-pixel thumb that nobody can grab; this one keeps a usable minimum,
   * is always visible, and jumps to where the track is clicked.
   */
  const BAR_MIN = 34;
  const barGeom = () => {
    const track = Math.max(1, plotW);
    const w = Math.max(BAR_MIN, track * plotW / Math.max(plotW, plotW + maxScroll));
    const x = maxScroll <= 0 ? 0 : (track - w) * Math.min(maxScroll, Math.max(0, view.scrollX)) / maxScroll;
    return { track, w, x };
  };
  const barDrag = useRef<{ startX: number; startScroll: number } | null>(null);
  const barToScroll = (px: number) => {
    const { track, w } = barGeom();
    return Math.max(0, Math.min(maxScroll, px / Math.max(1, track - w) * maxScroll));
  };
  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { w, x } = barGeom();
    const at = e.clientX - rect.left;
    if (at < x || at > x + w) setView((v) => ({ ...v, scrollX: barToScroll(at - w / 2) }));   // click the track: jump
    barDrag.current = { startX: e.clientX, startScroll: at < x || at > x + w ? barToScroll(at - w / 2) : view.scrollX };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBarMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!barDrag.current) return;
    const { track, w } = barGeom();
    const dx = e.clientX - barDrag.current.startX;
    const delta = dx / Math.max(1, track - w) * maxScroll;
    setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, barDrag.current!.startScroll + delta)) }));
  };
  const onBarUp = (e: React.PointerEvent<HTMLDivElement>) => {
    barDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const miniScroll = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!visible) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const vw = virtualWidth(visible.groups, view.zoom, gapPx);
    setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, frac * vw - plotW / 2)) }));
  };

  // ---- interactions ---------------------------------------------------------
  const zoomAt = (factor: number, px?: number) => setView((v) => {
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, v.zoom * factor));
    const anchor = px ?? plotW / 2;
    const vx = (v.scrollX + anchor) / v.zoom; // column-space position under the anchor
    return { ...v, zoom: z, scrollX: Math.max(0, vx * z - anchor) };
  });
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, v.scrollX + (e.deltaX || e.deltaY))) }));
      else zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left - GEOM.gutter);
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  });
  useEffect(() => {
    if (!props.instrument) return;
    (window as any).__onco = { ...(window as any).__onco, zoomAt,
      setZoom: (z: number) => setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(minZoom, z)) })),
      setScroll: (x: number) => setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, x)) })),
      fit: () => setView((v) => ({ ...v, zoom: minZoom, scrollX: 0 })),
      setShowUnaltered: (b: boolean) => onDisplay({ ...display, showUnaltered: b }),
      setWhitespace: (b: boolean) => onDisplay({ ...display, whitespace: b }),
      setGapMode: (g: FigureDisplay["gaps"]) => onDisplay({ ...display, gaps: g }),
      setSortKey: (k: string) => onSortKeys(k ? [k] : []), setSortKeys: onSortKeys, view, minZoom, maxScroll, ready: !!visible };
  });

  /** the track whose row contains this canvas y, or -1 */
  const trackAt = (y: number): number => {
    if (!data) return -1;
    const ti = Math.floor((y - GEOM.header) / (GEOM.rowH + GEOM.rowGap));
    return ti >= 0 && ti < data.tracks.length && y - GEOM.header - ti * (GEOM.rowH + GEOM.rowGap) <= GEOM.rowH ? ti : -1;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; if (!cv || !data || !visible || selDrag.current) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    // the gutter is labels, not cells: hovering one explains the row it names
    if (x < GEOM.gutter) {
      const ti = trackAt(y);
      setLabelHover(ti >= 0 ? { ti, x, y } : null);
      setHover(null);
      return;
    }
    if (labelHover) setLabelHover(null);
    const hit = hitTest(x, y, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, view.scrollX) }, gapPx);
    setHover(hit ? { hit, x, y } : null);
    // one column under the pointer: ask the server what it carries, once, after a pause
    if (detailTimer.current) clearTimeout(detailTimer.current);
    if (hit && hit.n === 1) {
      const col = data.columns()[hit.ci];
      if (!props.endpoint && !(col in detail)) detailTimer.current = setTimeout(async () => {
        setDetail((d) => ({ ...d, [col]: "loading" }));
        try {
          const res = await api.oncoprintDetail({ spec: spec as OncoprintSpec, column: col });
          const j = await res.json();
          setDetail((d) => ({ ...d, [col]: j.error ? { column: col, study: "", unit: data.unit, alterations: [], panels: [], notProfiled: [], annotation: j.error } : j }));
        } catch { setDetail((d) => { const n = { ...d }; delete n[col]; return n; }); }
      }, 220);
    }
  };

  // ---- drag a selection of columns ------------------------------------------
  const clampX = (x: number) => Math.max(GEOM.gutter, Math.min(cssW, x));
  const scrollNow = () => Math.min(maxScroll, Math.max(0, view.scrollX));

  /** the columns under a canvas-x range, as ranges in the drawn order */
  const rangesFor = (xa: number, xb: number): { gi: number; k0: number; k1: number }[] => {
    if (!visible) return [];
    const lo = clampX(Math.min(xa, xb)), hi = clampX(Math.max(xa, xb));
    const sx = scrollNow();
    const v0 = lo - GEOM.gutter + sx, v1 = hi - GEOM.gutter + sx;
    const offs = groupOffsets(visible.groups, view.zoom, gapPx);
    const out: { gi: number; k0: number; k1: number }[] = [];
    visible.groups.forEach((g, gi) => {
      const gx = offs[gi];
      if (v1 <= gx || v0 >= gx + g.count * view.zoom) return;
      const k0 = Math.max(0, Math.floor((v0 - gx) / view.zoom));
      const k1 = Math.min(g.count, Math.ceil((v1 - gx) / view.zoom));
      if (k1 > k0) out.push({ gi, k0: g.start + k0, k1: g.start + k1 });
    });
    return out;
  };
  const countOf = (ranges: { k0: number; k1: number }[]) => ranges.reduce((n, r) => n + (r.k1 - r.k0), 0);
  /** where a finished selection sits on screen now */
  const rectOf = (ranges: { gi: number; k0: number; k1: number }[]): { x0: number; x1: number } | null => {
    if (!visible || !ranges.length) return null;
    const offs = groupOffsets(visible.groups, view.zoom, gapPx);
    const sx = scrollNow();
    let v0 = Infinity, v1 = -Infinity;
    for (const r of ranges) {
      const g = visible.groups[r.gi], gx = offs[r.gi];
      v0 = Math.min(v0, gx + (r.k0 - g.start) * view.zoom);
      v1 = Math.max(v1, gx + (r.k1 - g.start) * view.zoom);
    }
    return { x0: v0 - sx + GEOM.gutter, x1: v1 - sx + GEOM.gutter };
  };
  const selCount = sel && sel.live ? countOf(rangesFor(sel.x0, sel.x1)) : selRanges ? countOf(selRanges) : 0;
  const clearSelection = () => { setSel(null); setSelRanges(null); setSelError(null); };

  const selDrag = useRef<{ x0: number } | null>(null);
  const onSelDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !data || !visible) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < GEOM.gutter) return;                       // the gutter belongs to the track menu
    selDrag.current = { x0: x };
    setSel({ x0: x, x1: x, live: true }); setSelRanges(null); setSelError(null); setHover(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSelMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = selDrag.current; if (!st) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSel({ x0: st.x0, x1: e.clientX - rect.left, live: true });
  };
  const onSelUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const st = selDrag.current; selDrag.current = null;
    if (!st) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ranges = Math.abs(x - st.x0) < 4 ? [] : rangesFor(st.x0, x);   // under 4px is a click, not a drag
    if (!ranges.length) { setSel(null); return; }
    setSel({ x0: st.x0, x1: x, live: false });
    setSelRanges(ranges);
  };

  /** the ids a finished selection stands for, in drawn order */
  const selectionIds = (): string[] => {
    if (!data || !visible || !selRanges) return [];
    const cols = data.columns();
    const out: string[] = [];
    for (const r of selRanges) for (let k = r.k0; k < r.k1; k++) out.push(cols[visible.order[k]]);
    return out;
  };
  const selGroups = selRanges && visible ? [...new Set(selRanges.map((r) => visible.groups[r.gi].name))] : [];

  const zoomToSelection = () => {
    if (!visible || !selRanges || !selRanges.length) return;
    const offs = groupOffsets(visible.groups, view.zoom, gapPx);
    let v0 = Infinity, v1 = -Infinity;
    for (const r of selRanges) {
      const g = visible.groups[r.gi], gx = offs[r.gi];
      v0 = Math.min(v0, gx + (r.k0 - g.start) * view.zoom);
      v1 = Math.max(v1, gx + (r.k1 - g.start) * view.zoom);
    }
    const span = Math.max(1e-6, v1 - v0);
    const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, view.zoom * plotW / span));
    setView((v) => ({ ...v, zoom, scrollX: Math.max(0, v0 / v.zoom * zoom) }));
    clearSelection();
  };

  const createCohort = async () => {
    if (!data || !props.onCreateCohort) return;
    setSelBusy(true); setSelError(null);
    try {
      await props.onCreateCohort({ ids: selectionIds(), unit: data.unit, name: selName.trim() || "selection", groups: selGroups });
      clearSelection();
    } catch (e) { setSelError(String((e as Error).message || e)); }
    setSelBusy(false);
  };

  const saveFeature = async () => {
    if (!data || !props.onSaveFeature) return;
    setSelBusy(true); setSelError(null);
    try {
      await props.onSaveFeature({ ids: selectionIds(), unit: data.unit, name: selName.trim() || "selection", groups: selGroups }, data.columns());
      clearSelection();
    } catch (e) { setSelError(String((e as Error).message || e)); }
    setSelBusy(false);
  };

  // a selection is a position in the drawn order, so a re-sort or a change of visible columns
  // retires it rather than pointing at whatever now sits in those slots
  useEffect(() => { setSel(null); setSelRanges(null); setSelError(null); }, [visible]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tip = useMemo(() => {
    if (!hover || !data || !visible) return null;
    const { hit } = hover; const t = data.tracks[hit.ti];
    const lines: { text: string; mono?: boolean; dim?: boolean }[] = [];
    const col = hit.n === 1 ? data.columns()[hit.ci] : null;
    lines.push({ text: col ?? hit.n.toLocaleString() + " " + data.unit + "s under this pixel", mono: !!col });
    lines.push({ text: visible.groups[hit.gi].name, dim: true });
    if (hit.n === 1) {
      const c = t.cells[hit.ci];
      if (t.kind === "gene") {
        lines.push({ text: t.label + ": " + decodeGene(c) });
        if (t.members && t.members.length > 1) lines.push({ text: "merged: " + t.members.join(" · "), dim: true });
      }
      else if (t.kind === "derivedEvent") lines.push({ text: t.label + ": " + (c > 0 ? "yes" : "no") });
      else if (t.numeric) lines.push({ text: t.label + ": " + (c === -1 ? "no data" : "≈" + (Math.round(((t.min ?? 0) + (c / 255) * ((t.max ?? 1) - (t.min ?? 0))) * 10) / 10)) });
      else lines.push({ text: t.label + ": " + (c === -1 ? "no data" : (t.categories && t.categories[c]) || "Other") });
    } else if (t.kind === "gene" || t.kind === "derivedEvent") {
      let alt = 0, prof = 0;
      for (let k = hit.k; k < hit.k1; k++) { const c = t.cells[visible.order[k]]; if (c !== -1) prof++; if (c > 0) alt++; }
      lines.push({ text: t.label + ": " + alt + " altered of " + prof + " profiled" });
    } else lines.push({ text: t.label + ": zoom in for per-" + data.unit + " values" });
    // the specifics, once they arrive
    const d = col ? detail[col] : undefined;
    if (d === "loading") lines.push({ text: "…", dim: true });
    else if (d) {
      const isMine = (gene: string) => t.kind !== "gene" || (t.members ? t.members.includes(gene) : gene === t.label);
      const mine = d.alterations.filter((a) => isMine(a.gene));
      for (const a of mine)
        lines.push({ text: a.gene + " " + a.alteration + " · " + a.kind.replace(/_/g, " ") + (a.driver ? " · putative driver" : " · unknown significance"), mono: true });
      if (t.kind === "gene" && !mine.length && d.alterations.length) lines.push({ text: "no " + t.label + " alteration; " + d.alterations.length + " in other genes", dim: true });
      if (d.panels.length) lines.push({ text: "panel " + d.panels.map((p) => p.panel).join(", ") + (d.notProfiled.length ? " — not covering " + d.notProfiled.join(", ") : ""), dim: true });
      else if (d.notProfiled.length) lines.push({ text: "no panel covers " + d.notProfiled.join(", "), dim: true });
    }
    return lines;
  }, [hover, data, visible, detail]);

  // ---- render ---------------------------------------------------------------
  const pct = visible ? Math.round(100 * Math.log(view.zoom / minZoom) / Math.log(MAX_ZOOM / minZoom)) : 0;
  const fmt = (n?: number, d = 0) => n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d });
  const set = (p: Partial<FigureDisplay>) => onDisplay({ ...display, ...p });
  /**
   * How many viewing options are away from their default. The display button wears the count so
   * folding them behind it never hides the fact that one of them is on.
   */
  const offDefaults = (Number(display.showUnaltered !== DEFAULT_FIGURE_DISPLAY.showUnaltered) +
    Number(display.whitespace !== DEFAULT_FIGURE_DISPLAY.whitespace) +
    Number(display.colorByType !== DEFAULT_FIGURE_DISPLAY.colorByType) +
    Number(!!display.whiteBackground) + Number(display.gaps !== "none")) || 0;

  // The figure applies sort and viewing options in the browser. A server-rendered download has
  // to be told about them, or the file would not be the picture on screen.
  const specOnScreen = (): unknown => {
    const base = (typeof spec === "object" && spec !== null ? spec : {}) as Record<string, unknown>;
    const d = (base.display || {}) as Record<string, unknown>;
    return { ...base, ...(sortKeys.length ? { sort: sortKeys } : {}), display: { ...d, ...display } };
  };
  // The same spec, addressed as a link: the two lab pages re-run this figure from it, one on the
  // command line and one in Python. Recomputed only when the picture's definition changes.
  const lab = useMemo(() => labLinks(specOnScreen()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(spec), sortKeys.join(","), JSON.stringify(display)]);
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const [saving, setSaving] = useState<string | null>(null);
  const download = async (what: "png" | "svg" | "tsv" | "ids") => {
    if (!data || !visible) return;
    setSaving(what);
    try {
      const stem = "oncoprint-" + (data.studies || [data.study]).join("+").slice(0, 40);
      if (what === "ids") {
        const ids = visible.order.length === data.n ? data.columns() : Array.from(visible.order, (i) => data.columns()[i]);
        save(new Blob([data.unit + " order in the oncoprint is:\n" + ids.join("\n") + "\n"], { type: "text/plain" }), stem + "-" + data.unit + "-order.txt");
      } else if (what === "png") {
        // the layout is computed at the reference density, then supersampled to the chosen DPI —
        // so 8.5in looks like a page at any resolution, and the pixel count is exactly widthIn*dpi
        const w = Math.max(200, Math.round(exportWidthIn * EXPORT_LAYOUT_DPI));
        const scale = exportDpi / EXPORT_LAYOUT_DPI;
        const S2 = withBackground(styleForDisplay(resolveStyle(data.display?.style), display), display.whiteBackground);
        const cv = document.createElement("canvas");
        const H = canvasHeight(data.tracks.length);
        cv.width = Math.round(w * scale); cv.height = Math.round(H * scale);
        const ctx = cv.getContext("2d")!;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        draw(ctx, data, visible.order, visible.groups, { zoom: fitZoom(visible.groups, w - GEOM.gutter, gapPx), scrollX: 0, whitespace: display.whitespace },
          w, paletteOf(S2), { gap: gapPx, pctLabels: pctMode, style: S2, colors: display.colors ?? data.display?.colors });
        const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
        // canvas.toBlob writes bare pixels; a pHYs chunk is what lets Word/Photoshop/Preview
        // print this at exportWidthIn rather than guessing 72 or 96 dpi.
        const out = setPngDpi(new Uint8Array(await blob.arrayBuffer()), exportDpi);
        const sized = new Blob([out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer], { type: "image/png" });
        save(sized, stem + "-" + exportWidthIn + "in.png");
      } else if (what === "svg") {
        const w = Math.max(200, Math.round(exportWidthIn * EXPORT_LAYOUT_DPI));
        const res = await api.oncoprint(specOnScreen() as OncoprintBody, { query: "?format=svg&width=" + w + "&widthIn=" + exportWidthIn,
          endpoint: props.endpoint, pins: props.uploads });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        save(await res.blob(), stem + "-" + exportWidthIn + "in.svg");
      } else {
        const res = await api.oncoprint(specOnScreen() as OncoprintBody, { query: "?format=" + what, endpoint: props.endpoint, pins: props.uploads });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        save(await res.blob(), stem + "." + what);
      }
    } catch (e) { setError(String((e as Error).message || e)); }
    setSaving(null);
  };
  return (
    <>
      {error && <div className="error">oncoprint: {error}</div>}
      {/* the figure's own fetch (its spec changed): a skeleton the size of a figure when there is
          none yet, and over the plot when there is one, so the old picture isn't read as the new */}
      {loading && !error && !data && <>
        <div className="loading-block" role="status"><span className="spinner" /> querying and building the oncoprint…</div>
        <div className="skeleton skeleton-view" />
      </>}
      {data && visible && !error && <>
        {/* The toolbar is two kinds of control, and they are kept apart on purpose. DATA changes
            what is drawn and costs a query; VIEW changes how it is drawn and is instant. Each zone
            wraps as a unit — nowrap inside — so a pair like the zoom controls can never be split
            across a line break. */}
        <div className="viewtb">
          <div className="tbz">
            <span className="tbl" title="these change what is drawn, and re-run the query">data</span>
            {props.tracksMenu}
            {props.controls}
          </div>
          <div className="tbz">
            <span className="tbl" title="these change how it is drawn, here in your browser">view</span>
            <GearMenu menuId="onco-display" title="how the figure is drawn — nothing here re-runs a query" wide contentClassName="px-2.5"
              label={<><SlidersHorizontal />display{offDefaults ? " (" + offDefaults + ")" : ""}</>}>
                <label className="chk"><Checkbox checked={display.showUnaltered} disabled={busy}
                  onCheckedChange={(c) => set({ showUnaltered: (c === true) })} /> show unaltered {data.unit}s</label>
                <label className="chk"><Checkbox checked={display.whitespace} disabled={busy}
                  onCheckedChange={(c) => set({ whitespace: (c === true) })} /> whitespace between cells</label>
                <label className="chk" title="colour each mutation class separately, or draw them all as one">
                  <Checkbox checked={display.colorByType} disabled={busy}
                    onCheckedChange={(c) => set({ colorByType: (c === true) })} /> colour by mutation type</label>
                <label className="chk" title="white instead of grey for unaltered cells — for print; profiled and unprofiled then look alike, apart from the stripe">
                  <Checkbox checked={!!display.whiteBackground} disabled={busy}
                    onCheckedChange={(c) => set({ whiteBackground: (c === true) || undefined })} /> white background (for print)</label>
                <label className="setrow" title={gapTrack ? "split each cohort into runs of " + gapTrack.label : "choose a categorical track as the sort key first"}>
                  <span className="meta">gaps</span>
                  <OptionSelect value={display.gaps} disabled={busy || !gapTrack} onValueChange={(v) => set({ gaps: v as FigureDisplay["gaps"] })}>
                    <option value="none">none</option><option value="gaps">gaps</option><option value="pct">gaps with % on the right</option><option value="pct-left">gaps with % on the left</option>
                  </OptionSelect>
                </label>
                <span className="meta">{view.zoom >= 1 ? view.zoom.toFixed(1) + " px per column" : (1 / view.zoom).toFixed(0) + " columns per pixel"} · {data.tracks.length} tracks</span>
                {/* Everything above is written into the document, so a shared link, the server SVG,
                    the CLI and the Python package all reproduce this picture. The minimap is not: it
                    draws no part of the figure and no other renderer has one, so it would be a
                    setting that only one reader could see. */}
                <div className="menu-aside">
                  <span className="meta">this browser only</span>
                  <label className="chk" title="an overview of the whole figure, with the part you are looking at marked">
                    <Checkbox checked={showMini} onCheckedChange={(c) => setShowMini((c === true))} /> minimap</label>
                </div>
            </GearMenu>
            <label className="tbfield">sort <OptionSelect value={sortKeys[0] || ""} disabled={busy}
              onValueChange={(v) => onSortKeys(v ? [v, ...sortKeys.slice(1)].slice(0, 4) : sortKeys.slice(1))}>
              <option value="">engine order ({data.conventions.sort.join(", ")})</option>
              {sortKeys[0]?.startsWith("cluster:") && !data.tracks.some((t) => t.profileType === sortKeys[0].slice(8)) &&
                <option value={sortKeys[0]}>{sortKeys[0]}</option>}
              <option value="genomic">genomic staircase</option>
              <option value="id">{data.unit} id</option>
              {[...new Set(data.tracks.filter((t) => t.kind === "heatmap" && t.profileType).map((t) => t.profileType!))].map((pt) => (
                <option key={"cluster:" + pt} value={"cluster:" + pt}>cluster by {pt}</option>
              ))}
              {data.tracks.filter((t) => t.kind !== "gene" && !/\(no data\)$/.test(t.label)).flatMap((t) => [
                <option key={t.label} value={t.label}>{t.label} ↑</option>,
                <option key={"-" + t.label} value={"-" + t.label}>{t.label} ↓</option>])}
            </OptionSelect></label>
            <span className="zoomctl">
              <Button type="button" variant="ghost" size="icon-xs" className={ZOOM} onClick={() => zoomAt(1 / 1.4)} title="zoom out" aria-label="zoom out"><Minus /></Button>
              <input type="range" min={0} max={100} value={pct} title="zoom" aria-label="zoom"
                onChange={(e) => { const p = Number(e.target.value) / 100; setView((v) => ({ ...v, zoom: minZoom * Math.pow(MAX_ZOOM / minZoom, p) })); }} />
              <Button type="button" variant="ghost" size="icon-xs" className={ZOOM} onClick={() => zoomAt(1.4)} title="zoom in" aria-label="zoom in"><Plus /></Button>
              <Button type="button" variant="ghost" size="xs" className={cn(ZOOM, "w-auto border-l px-2 text-sm")} onClick={() => setView((v) => ({ ...v, zoom: minZoom, scrollX: 0 }))} title="fit every column in the width">fit</Button>
            </span>
          </div>
          <div className="tbz">
            <GearMenu menuId="onco-figure" title="download or open this figure elsewhere" ariaLabel="download or open this figure elsewhere" wide
              label={saving ? "saving…" : <Ellipsis />}>
              {(close) => <>
                <span className="meta px-2">download figures</span>
                <MenuItem onClick={() => { close(); openExport(); }}><ImageDown />Export image (PNG or SVG)… — choose a page width</MenuItem>
                <MenuItem onClick={() => { close(); download("tsv"); }}><Sheet />Tabular TSV — one row per track, one column per {data.unit}</MenuItem>
                <MenuItem onClick={() => { close(); download("ids"); }}><ListOrdered />{data.unit} order — the ids as drawn</MenuItem>
                {/* Not a download: the same spec, opened where it can be run rather than looked at.
                    Nothing is exported — the link carries the definition, and the lab page re-runs it. */}
                <div className="menu-aside">
                  <span className="meta">open this figure elsewhere</span>
                  {lab ? <>
                    <a className="linklike block px-2 py-1" href={lab.cli} target="_blank" rel="noreferrer"
                      title="the node and Python command lines, run against this spec on this server">export to CLI emulator ↗</a>
                    <a className="linklike block px-2 py-1" href={lab.python} target="_blank" rel="noreferrer"
                      title="this figure in a Pyodide notebook — the cohortlab package, in your browser">export to Python notebook ↗</a>
                    <a className="linklike block px-2 py-1" href={lab.ipynb} download="oncoprint.ipynb"
                      title="a real .ipynb with the package and this figure's contract embedded; it opens in JupyterLab, VS Code or Colab">export to Jupyter (.ipynb)</a>
                    {lab.cut && <span className="meta">{lab.cut}</span>}
                  </> : <span className="meta">this figure&apos;s spec is too large to travel in a link;
                    export the tabular TSV instead</span>}
                </div>
              </>}
            </GearMenu>
          </div>
        </div>
        {sortKeys.length > 1 && <div className="viewtb-more">
          <span className="meta" title="ties in the first key are broken by these, in order">then</span>
          {sortKeys.slice(1).map((k) => (
            <Button key={k} variant="link" size="inline" disabled={busy} title="drop this tiebreaker"
              onClick={() => onSortKeys(sortKeys.filter((x) => x !== k))}>{k.startsWith("-") ? k.slice(1) + " ↓" : k + " ↑"}<X /></Button>
          ))}
        </div>}
        <div ref={wrapRef} className="onco-plot">
          {loading && <div className="view-updating" style={{ top: 0, borderRadius: 0 }} role="status" aria-live="polite">
            <div className="loading-block"><span className="spinner" /> updating…</div>
            <div className="skeleton" />
          </div>}
          <canvas ref={canvasRef} className="onco-canvas"
            onPointerDown={onSelDown} onPointerMove={onSelMove} onPointerUp={onSelUp} onPointerCancel={onSelUp}
            onMouseMove={onMove} onMouseLeave={() => { setHover(null); setLabelHover(null); }}
            onClick={(e) => {
              // a click on a track's label opens that track's menu, like the portal's three dots
              const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
              const x = e.clientX - rect.left, y = e.clientY - rect.top;
              if (x >= GEOM.gutter) { setTrackMenu(null); return; }
              const ti = Math.floor((y - GEOM.header) / (GEOM.rowH + GEOM.rowGap));
              setTrackMenu(ti >= 0 && ti < data.tracks.length ? { ti, x, y } : null);
            }} />
          {trackMenu && (() => {
            const t = data.tracks[trackMenu.ti];
            // gene tracks set the staircase, and a track with no values sorts nothing
            const sortable = t.kind !== "gene" && !/\(no data\)$/.test(t.label);
            const key = (dir: "" | "-") => dir + t.label;
            const isKey = (dir: "" | "-") => sortKeys[0] === key(dir);
            const setPrimary = (k: string | null) => onSortKeys(k ? [k, ...sortKeys.filter((x) => x.replace(/^-/, "") !== t.label)].slice(0, 4)
              : sortKeys.filter((x) => x.replace(/^-/, "") !== t.label));
            const item = (label: string, on: boolean, act: () => void, enabled = true) => (
              <MenuItem className={on ? "font-semibold text-accent-foreground" : undefined} disabled={!enabled || busy}
                onClick={() => { act(); setTrackMenu(null); }}>{label}{on && <Check className="ml-auto" />}</MenuItem>
            );
            return (
              <div className="onco-trackmenu" style={{ left: Math.min(trackMenu.x, cssW - 210), top: trackMenu.y + 6 }}
                onMouseLeave={() => setTrackMenu(null)}>
                <span className="meta onco-trackmenu-name">{t.label}
                  {t.members && t.members.length > 1 && <><br />{t.members.join(" · ")}</>}</span>
                {props.onMoveTrack && item("Move up", false, () => props.onMoveTrack!(t.label, -1))}
                {props.onMoveTrack && item("Move down", false, () => props.onMoveTrack!(t.label, 1))}
                {props.onRemoveTrack && item("Remove track", false, () => props.onRemoveTrack!(t.label))}
                {props.onExpandTrack && t.members && t.members.length > 1 &&
                  item("Expand into " + t.members.length + " rows", false, () => props.onExpandTrack!(t.label))}
                {item("Sort a-Z", isKey(""), () => setPrimary(key("")), sortable)}
                {item("Sort Z-a", isKey("-"), () => setPrimary(key("-")), sortable)}
                {item("Don't sort by this", sortable && !isKey("") && !isKey("-"), () => setPrimary(null), sortable)}
                {t.categories && t.categories.length > 0 && primaryKey === t.label &&
                  item(display.gaps === "none" ? "Show gaps" : "Hide gaps", display.gaps !== "none", () => set({ gaps: display.gaps === "none" ? "gaps" : "none" }))}
                {t.categories && t.categories.length > 0 && primaryKey === t.label &&
                  item("Show gaps (w/% on right)", display.gaps === "pct", () => set({ gaps: "pct" }))}
                {t.categories && t.categories.length > 0 && primaryKey === t.label &&
                  item("Show gaps (w/% on left)", display.gaps === "pct-left", () => set({ gaps: "pct-left" }))}
                {t.categories && t.categories.length > 0 && (
                  <details>
                    <summary className="meta" style={{ cursor: "pointer", padding: "0.2rem 0.3rem" }}>Edit colours</summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", padding: "0.2rem 0.3rem", maxHeight: 200, overflowY: "auto" }}>
                      {t.categories.map((v, ci) => (
                        <label key={v} className="meta" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                          <input type="color" value={(display.colors?.[t.label]?.[v]) || CAT_COLORS[ci % CAT_COLORS.length]}
                            onChange={(e) => set({ colors: { ...(display.colors || {}), [t.label]: { ...(display.colors?.[t.label] || {}), [v]: e.target.value } } })}
                            style={{ width: 26, height: 18, padding: 0, border: "none", background: "none" }} />
                          <span style={{ flex: 1 }}>{v}</span>
                        </label>
                      ))}
                      {display.colors?.[t.label] && (
                        <Button variant="link" size="inline" className="self-start" onClick={() => {
                          const next = { ...(display.colors || {}) }; delete next[t.label];
                          set({ colors: Object.keys(next).length ? next : undefined });
                        }}>Reset colours</Button>
                      )}
                    </div>
                  </details>
                )}
                {!sortable && <span className="meta" style={{ padding: "0.2rem 0.3rem" }}>
                  {t.kind === "gene" ? "gene tracks set the staircase; use the sort menu" : "no values to sort by"}</span>}
              </div>
            );
          })()}

          {(() => {
            const r = sel && sel.live ? { x0: Math.min(sel.x0, sel.x1), x1: Math.max(sel.x0, sel.x1) }
              : selRanges ? rectOf(selRanges) : null;
            if (!r) return null;
            const x0 = Math.max(GEOM.gutter, Math.min(cssW, r.x0)), x1 = Math.max(GEOM.gutter, Math.min(cssW, r.x1));
            if (x1 <= x0) return null;
            return (
              <div className="onco-marquee" style={{ left: x0, width: x1 - x0, height: canvasHeight(data.tracks.length) }}>
                {sel?.live && <span className="onco-marquee-n">
                  {selCount.toLocaleString()} {data.unit}{selCount === 1 ? "" : "s"}</span>}
              </div>
            );
          })()}

          {labelHover && !trackMenu && (() => {
            const t = data.tracks[labelHover.ti];
            const lines = trackTooltipLines(t, data.n, data.unit);
            return (
              <div className="onco-tip" style={{ left: Math.min(labelHover.x + 12, cssW - 300), top: labelHover.y + 14 }}>
                {lines.map((l, i) => <div key={i} className={i ? "dim" : "lead"}>{l}</div>)}
                <div className="dim">click for track options</div>
              </div>
            );
          })()}

          {hover && tip && (
            <div className="onco-tip" style={{ left: Math.min(hover.x + 12, cssW - 260), top: hover.y + 14 }}>
              {tip.map((l, i) => <div key={i} className={(l.mono ? "mono " : "") + (l.dim ? "dim" : "")}>{l.text}</div>)}
            </div>
          )}
        </div>
        {maxScroll > 0 && (() => {
          const { w, x } = barGeom();
          return (
            <div className="onco-bar" title="drag to move across the figure"
              onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}
              style={{ marginLeft: GEOM.gutter, width: Math.max(0, cssW - GEOM.gutter) }}>
              <div className="onco-bar-thumb" style={{ left: Math.round(x), width: Math.round(w) }} />
            </div>
          );
        })()}
        {selRanges && !sel?.live && (() => {
          const n = selCount, tooMany = n > MAX_SELECTION;
          return (
            <div className="card onco-select">
              <strong>{n.toLocaleString()} {data.unit}{n === 1 ? "" : "s"} selected</strong>
              {selGroups.length > 0 && <span className="meta">from {selGroups.join(", ")}</span>}
              <span className="spacer" />
              {props.onCreateCohort && <>
                <label className="meta">name <Input className={cn(FIELD, "w-40")} value={selName}
                  onChange={(e) => setSelName(e.target.value)} /></label>
                <Button size="sm" disabled={selBusy || tooMany} onClick={createCohort}>
                  {selBusy ? <><LoaderCircle className="animate-spin" />making the cohort…</> : <><Plus />New cohort</>}</Button>
              </>}
              {props.onSaveFeature && (
                <Button variant="outline" size="sm" className={TB} disabled={selBusy}
                  title={"save this selection as a yes/no custom attribute: the selected " + data.unit + "s are Yes, every other " + data.unit + " in the figure No"}
                  onClick={saveFeature}><Tag />Save as feature</Button>
              )}
              <Button variant="link" size="inline" className="text-md" onClick={zoomToSelection}>Zoom to selection</Button>
              <Button variant="link" size="inline" className="text-md" onClick={async () => {
                const ids = selectionIds();
                const text = ids.join("\n") + "\n";
                try { await navigator.clipboard.writeText(text); setSelError(ids.length.toLocaleString() + " ids copied"); }
                catch { save(new Blob([text], { type: "text/plain" }), "selection-" + data.unit + "s.txt"); }
              }}>Copy ids</Button>
              <Button variant="link" size="inline" className="text-md" onClick={clearSelection}>Cancel</Button>
              {data.unit === "sample" && props.onCreateCohort && <span className="meta" style={{ flexBasis: "100%" }}>
                a cohort selects patients — the patients these samples belong to become the cohort, so it may also carry
                their other samples</span>}
              {tooMany && <span className="mark" style={{ flexBasis: "100%" }}>
                a cohort&apos;s explicit list is capped at {MAX_SELECTION.toLocaleString()} ids — narrow the drag, or filter with a
                cohort definition instead</span>}
              {selError && <span className="mark" style={{ flexBasis: "100%" }}>{selError}</span>}
            </div>
          );
        })()}
        {showMini && (
          <canvas ref={miniRef} className="onco-mini" onMouseDown={miniScroll}
            onMouseMove={(e) => { if (e.buttons === 1) miniScroll(e); }} />
        )}
        <div className="vfoot">
          <Legend data={data} colorByType={display.colorByType} colors={display.colors ?? data.display?.colors} white={display.whiteBackground} />
          {props.footer}
        </div>
        {props.timings && (
          <details className="onco-timings" open>
            <summary className="meta">timings</summary>
            <table className="meta"><tbody>
              <tr><td>engine (server)</td><td>{fmt(perf.engineMs)} ms</td><td>pack (server)</td><td>{fmt(perf.packMs)} ms</td></tr>
              <tr><td>fetch incl. engine</td><td>{fmt(perf.fetchMs)} ms</td><td>payload</td><td>{fmt((perf.bytes || 0) / 1048576, 2)} MB decoded{perf.wireBytes ? " · " + fmt(perf.wireBytes / 1048576, 2) + " MB on the wire" : ""}</td></tr>
              <tr><td>decode</td><td>{fmt(perf.decodeMs, 1)} ms</td><td>last draw</td><td>{fmt(perf.drawMs, 1)} ms ({fmt(perf.cellsDrawn)} cells, {fmt(perf.bucketsDrawn)} buckets)</td></tr>
              <tr><td>client re-sort</td><td>{fmt(perf.sortMs)} ms</td><td>hide unaltered</td><td>{fmt(perf.hideMs)} ms{perf.gapMs != null && <> · gaps {fmt(perf.gapMs)} ms</>}</td></tr>
              <tr><td>frames</td><td>{perf.frames}</td><td>JS heap</td><td>{fmt(perf.heapMB)} MB</td></tr>
            </tbody></table>
          </details>
        )}
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          {exportOpen && <DialogContent aria-describedby={undefined}
            className="exportdialog flex h-[min(94vh,60rem)] w-[min(96vw,90rem)] max-w-[90rem] flex-col gap-2 overflow-auto sm:max-w-[90rem]">
            <DialogHeader><DialogTitle className="text-base">Export image</DialogTitle></DialogHeader>
            <label className="setrow">
              <span className="meta">format</span>
              <OptionSelect value={exportFormat} onValueChange={(v) => setExportFormat(v as "png" | "svg")}>
                <option value="png">PNG — raster</option>
                <option value="svg">SVG — vector, sharp at any size</option>
              </OptionSelect>
            </label>
            <label className="setrow">
              <span className="meta">page width</span>
              <OptionSelect value={EXPORT_PRESETS.some((p) => p.in === exportWidthIn) ? String(exportWidthIn) : "custom"}
                onValueChange={(v) => { if (v !== "custom") setExportWidthIn(Number(v)); }}>
                {EXPORT_PRESETS.map((p) => <option key={p.label} value={p.in}>{p.label}</option>)}
                <option value="custom">custom</option>
              </OptionSelect>
              <Input type="number" min={1} max={60} step={0.25} value={exportWidthIn} className={cn(FIELD, "w-20")}
                onChange={(e) => setExportWidthIn(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
              <span className="meta">in</span>
            </label>
            {exportFormat === "png" ? (
              <label className="setrow">
                <span className="meta">resolution</span>
                <OptionSelect value={exportDpi} onValueChange={(v) => setExportDpi(Number(v))}>
                  <option value={96}>96 dpi — screen</option>
                  <option value={150}>150 dpi — print</option>
                  <option value={300}>300 dpi — high-res print</option>
                </OptionSelect>
                <span className="meta">{(Math.round(exportWidthIn * exportDpi)).toLocaleString()}px wide</span>
              </label>
            ) : <p className="meta">vector — the same file prints sharp at 8.5in or 48in alike</p>}
            <div className="onco-export-preview">
              <canvas ref={setExportCanvas} />
            </div>
            <DialogFooter className="mt-1">
              <Button type="button" variant="ghost" onClick={() => setExportOpen(false)}>Cancel</Button>
              <Button disabled={!!saving} onClick={() => download(exportFormat)}>
                <Download />{saving ? "exporting…" : "Export " + exportFormat.toUpperCase()}</Button>
            </DialogFooter>
          </DialogContent>}
        </Dialog>
      </>}
    </>
  );
}

function Legend({ data, colorByType, colors, white }: { data: UnpackedContract; colorByType: boolean; colors?: Record<string, Record<string, string>>; white?: boolean }) {
  const S = styleForDisplay(resolveStyle(data.display?.style), { colorByType });
  const P = paletteOf(S);
  let bitsPresent = 0;
  for (const t of data.tracks) if (t.kind === "gene") for (let i = 0; i < t.cells.length; i++) if (t.cells[i] > 0) bitsPresent |= t.cells[i];
  const sw = (c: string, w = 10) => <span style={{ display: "inline-block", width: w, height: 10, background: c, marginRight: 4, verticalAlign: -1, borderRadius: 2 }} />;
  const np = <span style={{ display: "inline-block", width: 10, height: 10, background: `linear-gradient(${P.np} 45%, ${P.npStripe} 45%, ${P.npStripe} 55%, ${P.np} 55%)`, marginRight: 4, verticalAlign: -1, borderRadius: 2 }} />;
  if (data.display?.clinicalLegends === "none") return null;
  return (
    <div className="onco-legend">
      {geneLegendFor(bitsPresent, S).map((it) => <span key={it.label}>{it.kind === "notProfiled" ? np
        : it.kind === "outline" ? <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid " + it.color, background: P.unaltered, marginRight: 4, verticalAlign: -1, borderRadius: 2, boxSizing: "border-box" }} />
        : sw(it.color)}{it.label}</span>)}
      {data.tracks.some((t) => t.kind === "derivedEvent") && <span>{sw(P.derived)}Derived event</span>}
      <span>{S.glyph.driverNote} · % = driver / any</span>
      {white && <span className="mark">white background: unaltered and not-profiled differ only by the stripe</span>}
      {data.stats.hiddenVus != null && <span className="mark">{data.stats.hiddenVus.toLocaleString()} alterations of unknown significance hidden — the percentages are over drivers alone</span>}
      {data.display?.annotate === "none" && <span className="mark">driver annotation off: nothing is called a driver</span>}
      {data.tracks.filter((t) => t.kind !== "gene" && t.kind !== "derivedEvent").map((t) => (
        <span key={t.label}>{t.label}: {t.numeric
          ? <>{sw(t.center != null ? "linear-gradient(90deg,#2166ac,#fff,#b2182b)" : "linear-gradient(90deg,#deebf7,#084887)", 44)}{t.min} → {t.max}</>
          : <>{(t.categories || []).slice(0, 8).map((c, i) => <span key={c} style={{ marginRight: 6 }}>{sw((colors && colors[t.label] && colors[t.label][c]) || CAT_COLORS[i % CAT_COLORS.length])}{c}</span>)}
            {(t.categories || []).length > 8 && <span className="meta">+{(t.categories || []).length - 8} more</span>}</>}</span>
      ))}
    </div>
  );
}
