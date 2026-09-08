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
import { GEOM, PALETTE, CAT_COLORS, canvasHeight, decodeGene, draw, fitZoom, hitTest, paletteOf, segmentByTrack, sortColumns,
  virtualWidth, type Hit, type View, type VisibleGroup } from "./canvas.ts";
import { geneLegendFor, resolveStyle, styleForDisplay } from "../../lib/oncoprint-style.ts";
import type { ColumnDetail } from "../../lib/oncoprint-detail.ts";

const MAX_ZOOM = 24;

/**
 * The viewing options the BROWSER can apply to a decoded contract: they change the picture,
 * never a number, so they never need a refetch. Options that change numbers — hideVUS,
 * annotate — live in the spec and are the page's business.
 */
export interface FigureDisplay { showUnaltered: boolean; whitespace: boolean; gaps: "none" | "gaps" | "pct"; colorByType: boolean }
export const DEFAULT_FIGURE_DISPLAY: FigureDisplay = { showUnaltered: true, whitespace: true, gaps: "none", colorByType: true };

export interface Perf { fetchMs?: number; bytes?: number; engineMs?: number; packMs?: number; decodeMs?: number; drawMs?: number;
  cellsDrawn?: number; bucketsDrawn?: number; sortMs?: number; hideMs?: number; gapMs?: number; frames: number; heapMB?: number;
  /** compressed size of the response, when the server reported it */
  wireBytes?: number }

export interface OncoprintFigureProps {
  /** POSTed to /api/oncoprint?format=bin; a change of value (by JSON) refetches */
  spec: unknown;
  /** "" = the engine's own order; otherwise "genomic" | "id" | "[-]<track label>" */
  sortKey: string;
  display: FigureDisplay;
  onSortKey: (key: string) => void;
  onDisplay: (d: FigureDisplay) => void;
  /** left of the toolbar; defaults to a heading describing the contract */
  heading?: React.ReactNode;
  /** extra toolbar controls, placed before the viewing options */
  controls?: React.ReactNode;
  /** below the legend — the page's provenance panel, say */
  footer?: React.ReactNode;
  /** called with each decoded contract (frequencies, queries, column count) */
  onContract?: (c: UnpackedContract) => void;
  /** show the timings panel (the lab's instrument) */
  timings?: boolean;
  /** expose the figure on window.__onco so headless runs can drive it */
  instrument?: boolean;
  busy?: boolean;
}

export default function OncoprintFigure(props: OncoprintFigureProps) {
  const { spec, sortKey, display, onSortKey, onDisplay, busy } = props;
  const [data, setData] = useState<UnpackedContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [perf, setPerf] = useState<Perf>({ frames: 0 });
  const [view, setView] = useState<View>({ zoom: 1, scrollX: 0, whitespace: display.whitespace });
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  // per-column specifics, fetched only for the column under the pointer and remembered
  const [detail, setDetail] = useState<Record<string, ColumnDetail | "loading">>({});
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cssW, setCssW] = useState(1200);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; scrollX: number } | null>(null);
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
        const res = await fetch("/api/oncoprint?format=bin&provenance=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: specKey });
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
  }, [specKey]);

  useEffect(() => { setView((v) => ({ ...v, whitespace: display.whitespace })); }, [display.whitespace]);

  // ---- visible columns: an order indirection, never a copy of the data ------
  const base = useMemo(() => {
    if (!data) return null;
    const order = new Uint32Array(data.n); for (let i = 0; i < data.n; i++) order[i] = i;
    const groups: VisibleGroup[] = data.groups.map((g) => ({ name: g.name, start: g.start, count: g.count, patients: g.patients ?? g.count }));
    return { order, groups };
  }, [data]);

  // gaps follow the primary sort key, and only when it is categorical (runs are contiguous only then)
  const primaryKey = data ? (sortKey || data.conventions.sort[0] || "genomic").replace(/^-/, "") : "";
  const gapTrack = data ? data.tracks.find((t) => t.label === primaryKey && t.categories && t.categories.length) : undefined;
  const gapMode = gapTrack ? display.gaps : "none";
  const gapPx = gapMode === "none" ? GEOM.groupGap : gapMode === "pct" ? 40 : 8;

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
    if (sortKey) {
      const t0 = performance.now();
      const desc = sortKey.startsWith("-");
      order = sortColumns(data, order, groups, [{ track: desc ? sortKey.slice(1) : sortKey, dir: desc ? "desc" : "asc" }]);
      bump({ sortMs: performance.now() - t0 });
    }
    if (gapMode !== "none" && gapTrack) {
      const t0 = performance.now();
      groups = segmentByTrack(data, order, groups, gapTrack.label, gapMode === "pct");
      bump({ gapMs: performance.now() - t0 });
    }
    return { order, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, base, display.showUnaltered, sortKey, gapMode, gapTrack]);

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

  // fit when the set of drawn columns changes, not on a re-sort of the same columns
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) setView((v) => ({ ...v, zoom: fitZoom(visible.groups, plotW, gapPx), scrollX: 0 })); }, [data, display.showUnaltered, plotW, gapMode]);

  // ---- draw -----------------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !data || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const H = canvasHeight(data.tracks.length);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = cssW + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = styleForDisplay(resolveStyle(data.display?.style), display);
    const r = draw(ctx, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, Math.max(0, view.scrollX)) },
      cssW, paletteOf(S), { gap: gapPx, pctLabels: gapMode === "pct", style: S });
    const mem = (performance as any).memory;
    bump({ drawMs: r.ms, cellsDrawn: r.cellsDrawn, bucketsDrawn: r.bucketsDrawn, frames: perfRef.current.frames + 1, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible, view, cssW, maxScroll, gapPx, gapMode]);

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
      setSortKey: onSortKey, view, minZoom, maxScroll, ready: !!visible };
  });

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; if (!cv || !data || !visible) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      if (Math.abs(dx) > 2) setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, drag.current!.scrollX - dx)) }));
      setHover(null); return;
    }
    const hit = hitTest(x, y, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, view.scrollX) }, gapPx);
    setHover(hit ? { hit, x, y } : null);
    // one column under the pointer: ask the server what it carries, once, after a pause
    if (detailTimer.current) clearTimeout(detailTimer.current);
    if (hit && hit.n === 1) {
      const col = data.columns()[hit.ci];
      if (!(col in detail)) detailTimer.current = setTimeout(async () => {
        setDetail((d) => ({ ...d, [col]: "loading" }));
        try {
          const res = await fetch("/api/oncoprint/detail", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spec, column: col }) });
          const j = await res.json();
          setDetail((d) => ({ ...d, [col]: j.error ? { column: col, study: "", unit: data.unit, alterations: [], panels: [], notProfiled: [], annotation: j.error } : j }));
        } catch { setDetail((d) => { const n = { ...d }; delete n[col]; return n; }); }
      }, 220);
    }
  };

  const tip = useMemo(() => {
    if (!hover || !data || !visible) return null;
    const { hit } = hover; const t = data.tracks[hit.ti];
    const lines: { text: string; mono?: boolean; dim?: boolean }[] = [];
    const col = hit.n === 1 ? data.columns()[hit.ci] : null;
    lines.push({ text: col ?? hit.n.toLocaleString() + " " + data.unit + "s under this pixel", mono: !!col });
    lines.push({ text: visible.groups[hit.gi].name, dim: true });
    if (hit.n === 1) {
      const c = t.cells[hit.ci];
      if (t.kind === "gene") lines.push({ text: t.label + ": " + decodeGene(c) });
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
      const mine = d.alterations.filter((a) => t.kind !== "gene" || a.gene === t.label);
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

  // The figure applies sort and viewing options in the browser. A server-rendered download has
  // to be told about them, or the file would not be the picture on screen.
  const specOnScreen = (): unknown => {
    const base = (typeof spec === "object" && spec !== null ? spec : {}) as Record<string, unknown>;
    const d = (base.display || {}) as Record<string, unknown>;
    return { ...base, ...(sortKey ? { sort: [sortKey] } : {}), display: { ...d, ...display } };
  };
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
        // drawn offscreen at full width so the file is the whole figure, not the visible window
        const w = 2000, S2 = resolveStyle(data.display?.style);
        const cv = document.createElement("canvas");
        const H = canvasHeight(data.tracks.length);
        cv.width = w * 2; cv.height = H * 2;
        const ctx = cv.getContext("2d")!;
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        draw(ctx, data, visible.order, visible.groups, { zoom: fitZoom(visible.groups, w - GEOM.gutter, gapPx), scrollX: 0, whitespace: display.whitespace },
          w, paletteOf(S2), { gap: gapPx, pctLabels: gapMode === "pct", style: S2 });
        const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
        save(blob, stem + ".png");
      } else {
        const res = await fetch("/api/oncoprint?format=" + what + (what === "svg" ? "&width=1600" : ""),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(specOnScreen()) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        save(await res.blob(), stem + "." + what);
      }
    } catch (e) { setError(String((e as Error).message || e)); }
    setSaving(null);
  };
  return (
    <>
      {error && <div className="error">oncoprint: {error}</div>}
      {loading && !error && <p className="meta">querying and building the contract…</p>}
      {data && visible && !error && <>
        <div className="row" style={{ alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
          {props.heading ?? <h2 style={{ margin: 0 }}>Oncoprint <span className="plain">— {data.stats.nColumns.toLocaleString()} {data.unit}s · {data.tracks.length} tracks · {data.conventions.annotation}</span></h2>}
          <span className="spacer" />
          {props.controls}
          <label className="meta"><input type="checkbox" checked={display.showUnaltered} disabled={busy} onChange={(e) => set({ showUnaltered: e.target.checked })} /> show unaltered</label>
          <label className="meta"><input type="checkbox" checked={display.whitespace} disabled={busy} onChange={(e) => set({ whitespace: e.target.checked })} /> whitespace</label>
          <label className="meta" title="colour each mutation class separately, or draw them all as one"><input type="checkbox" checked={display.colorByType} disabled={busy} onChange={(e) => set({ colorByType: e.target.checked })} /> colour by type</label>
          <label className="meta">sort <select value={sortKey} disabled={busy} onChange={(e) => onSortKey(e.target.value)} style={{ fontSize: "0.78rem" }}>
            <option value="">engine order ({data.conventions.sort.join(", ")})</option>
            <option value="genomic">genomic staircase</option>
            <option value="id">patient id</option>
            {data.tracks.filter((t) => t.kind !== "gene" && !/\(no data\)$/.test(t.label)).flatMap((t) => [
              <option key={t.label} value={t.label}>{t.label} ↑</option>,
              <option key={"-" + t.label} value={"-" + t.label}>{t.label} ↓</option>])}
          </select></label>
          <label className="meta" title={gapTrack ? "split each cohort into runs of " + gapTrack.label : "choose a categorical track as the sort key first"}>gaps <select
            value={display.gaps} disabled={busy || !gapTrack} onChange={(e) => set({ gaps: e.target.value as FigureDisplay["gaps"] })} style={{ fontSize: "0.78rem" }}>
            <option value="none">none</option><option value="gaps">gaps</option><option value="pct">gaps with %</option></select></label>
          <button className="linklike" onClick={() => zoomAt(1 / 1.4)} title="zoom out">−</button>
          <input type="range" min={0} max={100} value={pct} title="zoom"
            onChange={(e) => { const p = Number(e.target.value) / 100; setView((v) => ({ ...v, zoom: minZoom * Math.pow(MAX_ZOOM / minZoom, p) })); }} style={{ width: 110 }} />
          <button className="linklike" onClick={() => zoomAt(1.4)} title="zoom in">+</button>
          <span className="meta" style={{ minWidth: 84 }}>{view.zoom >= 1 ? view.zoom.toFixed(1) + " px/col" : (1 / view.zoom).toFixed(0) + " cols/px"}</span>
          <button className="linklike" onClick={() => setView((v) => ({ ...v, zoom: minZoom, scrollX: 0 }))}>fit</button>
          <details className="gearmenu">
            <summary title="download this figure">{saving ? "…" : "download"}</summary>
            <div className="gearmenu-items">
              <button className="linklike" onClick={() => download("png")}>PNG — the whole figure at 4000px</button>
              <button className="linklike" onClick={() => download("svg")}>SVG — re-rendered on the server from this spec</button>
              <button className="linklike" onClick={() => download("tsv")}>Tabular TSV — one row per track, one column per {data.unit}</button>
              <button className="linklike" onClick={() => download("ids")}>{data.unit} order — the ids as drawn</button>
            </div>
          </details>
        </div>
        <div ref={wrapRef} style={{ position: "relative", marginTop: "0.5rem", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <canvas ref={canvasRef} style={{ display: "block", cursor: view.zoom > minZoom ? "grab" : "crosshair" }}
            onMouseMove={onMove} onMouseLeave={() => { setHover(null); drag.current = null; }}
            onMouseDown={(e) => { drag.current = { x: e.clientX, scrollX: view.scrollX }; }}
            onMouseUp={() => { drag.current = null; }} />
          {maxScroll > 0 && (
            <div style={{ position: "absolute", left: GEOM.gutter, right: 0, bottom: 0, height: 6, background: "var(--code-bg)" }}>
              <div style={{ position: "absolute", height: 6, background: "var(--accent)", opacity: 0.6, borderRadius: 3,
                left: (100 * Math.min(maxScroll, view.scrollX) / (maxScroll + plotW)) + "%", width: (100 * plotW / (maxScroll + plotW)) + "%" }} />
            </div>
          )}
          {hover && tip && (
            <div style={{ position: "absolute", left: Math.min(hover.x + 12, cssW - 260), top: hover.y + 14, pointerEvents: "none", background: "var(--card)", color: "var(--ink)",
              border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", fontSize: "0.78rem", boxShadow: "0 4px 14px rgba(0,0,0,.12)", maxWidth: 330, zIndex: 2 }}>
              {tip.map((l, i) => <div key={i} style={{ ...(l.mono ? { fontFamily: "IBM Plex Mono, monospace", fontSize: "0.72rem" } : {}), ...(l.dim ? { color: "var(--muted)" } : {}) }}>{l.text}</div>)}
            </div>
          )}
        </div>
        <Legend data={data} colorByType={display.colorByType} />
        {props.footer}
        {props.timings && (
          <details style={{ marginTop: "0.5rem" }} open>
            <summary className="meta">timings</summary>
            <table className="meta" style={{ fontVariantNumeric: "tabular-nums", borderSpacing: "10px 2px" }}><tbody>
              <tr><td>engine (server)</td><td>{fmt(perf.engineMs)} ms</td><td>pack (server)</td><td>{fmt(perf.packMs)} ms</td></tr>
              <tr><td>fetch incl. engine</td><td>{fmt(perf.fetchMs)} ms</td><td>payload</td><td>{fmt((perf.bytes || 0) / 1048576, 2)} MB decoded{perf.wireBytes ? " · " + fmt(perf.wireBytes / 1048576, 2) + " MB on the wire" : ""}</td></tr>
              <tr><td>decode</td><td>{fmt(perf.decodeMs, 1)} ms</td><td>last draw</td><td>{fmt(perf.drawMs, 1)} ms ({fmt(perf.cellsDrawn)} cells, {fmt(perf.bucketsDrawn)} buckets)</td></tr>
              <tr><td>client re-sort</td><td>{fmt(perf.sortMs)} ms</td><td>hide unaltered</td><td>{fmt(perf.hideMs)} ms{perf.gapMs != null && <> · gaps {fmt(perf.gapMs)} ms</>}</td></tr>
              <tr><td>frames</td><td>{perf.frames}</td><td>JS heap</td><td>{fmt(perf.heapMB)} MB</td></tr>
            </tbody></table>
          </details>
        )}
      </>}
    </>
  );
}

function Legend({ data, colorByType }: { data: UnpackedContract; colorByType: boolean }) {
  const S = styleForDisplay(resolveStyle(data.display?.style), { colorByType });
  const P = paletteOf(S);
  let bitsPresent = 0;
  for (const t of data.tracks) if (t.kind === "gene") for (let i = 0; i < t.cells.length; i++) if (t.cells[i] > 0) bitsPresent |= t.cells[i];
  const sw = (c: string, w = 10) => <span style={{ display: "inline-block", width: w, height: 10, background: c, marginRight: 4, verticalAlign: -1, borderRadius: 2 }} />;
  const np = <span style={{ display: "inline-block", width: 10, height: 10, background: `linear-gradient(${P.np} 45%, ${P.npStripe} 45%, ${P.npStripe} 55%, ${P.np} 55%)`, marginRight: 4, verticalAlign: -1, borderRadius: 2 }} />;
  const colors = data.display?.colors;
  if (data.display?.clinicalLegends === "none") return null;
  return (
    <div className="meta" style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem 0.9rem", marginTop: "0.4rem" }}>
      {geneLegendFor(bitsPresent, S).map((it) => <span key={it.label}>{it.kind === "notProfiled" ? np
        : it.kind === "outline" ? <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid " + it.color, background: P.unaltered, marginRight: 4, verticalAlign: -1, borderRadius: 2, boxSizing: "border-box" }} />
        : sw(it.color)}{it.label}</span>)}
      {data.tracks.some((t) => t.kind === "derivedEvent") && <span>{sw(P.derived)}Derived event</span>}
      <span>{S.glyph.driverNote} · % = driver / any</span>
      {data.stats.hiddenVus != null && <span className="mark">{data.stats.hiddenVus.toLocaleString()} alterations of unknown significance hidden — the percentages are over drivers alone</span>}
      {data.display?.annotate === "none" && <span className="mark">driver annotation off: nothing is called a driver</span>}
      {data.tracks.filter((t) => t.kind !== "gene" && t.kind !== "derivedEvent").map((t) => (
        <span key={t.label}>{t.label}: {t.numeric
          ? <>{sw(t.center != null ? "linear-gradient(90deg,#2166ac,#fff,#b2182b)" : "linear-gradient(90deg,#deebf7,#084887)", 44)}{t.min} → {t.max}</>
          : (t.categories || []).slice(0, 8).map((c, i) => <span key={c} style={{ marginRight: 6 }}>{sw((colors && colors[t.label] && colors[t.label][c]) || CAT_COLORS[i % CAT_COLORS.length])}{c}</span>)}</span>
      ))}
    </div>
  );
}
