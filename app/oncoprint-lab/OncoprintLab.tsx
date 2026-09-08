"use client";
// Interactive oncoprint over the binary contract: fetch, decode, level-of-detail
// canvas, zoom/pan, hover, hide-unaltered, client-side re-sort. Exposes timings on
// window.__onco so headless measurements read the same numbers the panel shows.
import { useEffect, useMemo, useRef, useState } from "react";
import { unpackContract, type UnpackedContract } from "../../lib/oncoprint-binary.ts";
import { GEOM, PALETTE, CAT_COLORS, canvasHeight, decodeGene, draw, fitZoom, hitTest, staircaseOrder, virtualWidth,
  type Hit, type View, type VisibleGroup } from "./canvas.ts";

const MAX_ZOOM = 24;

interface Perf { fetchMs?: number; bytes?: number; engineMs?: number; packMs?: number; decodeMs?: number; drawMs?: number;
  cellsDrawn?: number; bucketsDrawn?: number; sortMs?: number; hideMs?: number; frames: number; heapMB?: number }

export default function OncoprintLab({ spec }: { spec: Record<string, unknown> }) {
  const [data, setData] = useState<UnpackedContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState<Perf>({ frames: 0 });
  const [view, setView] = useState<View>({ zoom: 1, scrollX: 0, whitespace: true });
  const [showUnaltered, setShowUnaltered] = useState(true);
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [cssW, setCssW] = useState(1200);
  const [sortKey, setSortKey] = useState<"server" | "client">("server");
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; scrollX: number } | null>(null);
  const perfRef = useRef<Perf>({ frames: 0 });
  const bump = (p: Partial<Perf>) => { perfRef.current = { ...perfRef.current, ...p }; setPerf(perfRef.current); (window as any).__onco = { ...(window as any).__onco, perf: perfRef.current }; };

  // ---- fetch + decode ----------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t0 = performance.now();
        const res = await fetch("/api/oncoprint?format=bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        const buf = await res.arrayBuffer();
        const fetchMs = performance.now() - t0;
        const t1 = performance.now();
        const d = unpackContract(buf);
        const decodeMs = performance.now() - t1;
        if (!alive) return;
        bump({ fetchMs, bytes: buf.byteLength, decodeMs, engineMs: Number(res.headers.get("X-Engine-Ms")) || undefined, packMs: Number(res.headers.get("X-Pack-Ms")) || undefined });
        setData(d);
      } catch (e) { if (alive) setError(String((e as Error).message || e)); }
    })();
    return () => { alive = false; };
  }, [spec]);

  // ---- visible columns: order indirection + groups ----------------------
  const base = useMemo(() => {
    if (!data) return null;
    const order = new Uint32Array(data.n); for (let i = 0; i < data.n; i++) order[i] = i;
    const groups: VisibleGroup[] = data.groups.map((g) => ({ name: g.name, start: g.start, count: g.count, patients: g.patients ?? g.count }));
    return { order, groups };
  }, [data]);

  const visible = useMemo(() => {
    if (!data || !base) return null;
    let order: Uint32Array = base.order; let groups: VisibleGroup[] = base.groups;
    if (!showUnaltered) {
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
    if (sortKey === "client") {
      const t0 = performance.now();
      order = staircaseOrder(data, order, groups);
      bump({ sortMs: performance.now() - t0 });
    }
    return { order, groups };
  }, [data, base, showUnaltered, sortKey]);

  // ---- sizing --------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setCssW(el.clientWidth));
    ro.observe(el); setCssW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const plotW = Math.max(50, cssW - GEOM.gutter);
  const minZoom = visible ? fitZoom(visible.groups, plotW) : 1;
  const maxScroll = visible ? Math.max(0, virtualWidth(visible.groups, view.zoom) - plotW) : 0;

  // fit on first data / when the visible set changes
  useEffect(() => { if (visible) setView((v) => ({ ...v, zoom: fitZoom(visible.groups, plotW), scrollX: 0 })); }, [visible, plotW]);

  // ---- draw ----------------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !data || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const H = canvasHeight(data.tracks.length);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = cssW + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = draw(ctx, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, Math.max(0, view.scrollX)) }, cssW, PALETTE);
    const mem = (performance as any).memory;
    bump({ drawMs: r.ms, cellsDrawn: r.cellsDrawn, bucketsDrawn: r.bucketsDrawn, frames: perfRef.current.frames + 1, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined });
  }, [data, visible, view, cssW, maxScroll]);

  // ---- interactions -----------------------------------------------------
  const zoomAt = (factor: number, px?: number) => setView((v) => {
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, v.zoom * factor));
    const anchor = px ?? plotW / 2;
    const vx = (v.scrollX + anchor) / v.zoom; // column-space position under the anchor
    const scrollX = Math.max(0, vx * z - anchor);
    return { ...v, zoom: z, scrollX };
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
    (window as any).__onco = { ...(window as any).__onco, zoomAt, setZoom: (z: number) => setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(minZoom, z)) })),
      setScroll: (x: number) => setView((v) => ({ ...v, scrollX: Math.max(0, Math.min(maxScroll, x)) })), fit: () => setView((v) => ({ ...v, zoom: minZoom, scrollX: 0 })),
      setShowUnaltered, setSortKey, setWhitespace: (w: boolean) => setView((v) => ({ ...v, whitespace: w })), view, minZoom, maxScroll, ready: !!visible };
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
    const hit = hitTest(x, y, data, visible.order, visible.groups, { ...view, scrollX: Math.min(maxScroll, view.scrollX) });
    setHover(hit ? { hit, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
  };

  const tip = useMemo(() => {
    if (!hover || !data || !visible) return null;
    const { hit } = hover; const t = data.tracks[hit.ti];
    const lines: string[] = [];
    if (hit.n === 1) lines.push(data.columns()[hit.ci]);
    else lines.push(hit.n.toLocaleString() + " patients under this pixel");
    lines.push(visible.groups[hit.gi].name);
    if (hit.n === 1) {
      const c = t.cells[hit.ci];
      if (t.kind === "gene") lines.push(t.label + ": " + decodeGene(c));
      else if (t.kind === "derivedEvent") lines.push(t.label + ": " + (c > 0 ? "yes" : "no"));
      else if (t.numeric) lines.push(t.label + ": " + (c === -1 ? "no data" : "≈" + (Math.round(((t.min ?? 0) + (c / 255) * ((t.max ?? 1) - (t.min ?? 0))) * 10) / 10)));
      else lines.push(t.label + ": " + (c === -1 ? "no data" : (t.categories && t.categories[c]) || "Other"));
    } else if (t.kind === "gene" || t.kind === "derivedEvent") {
      let alt = 0, prof = 0;
      for (let k = hit.k; k < hit.k1; k++) { const c = t.cells[visible.order[k]]; if (c !== -1) prof++; if (c > 0) alt++; }
      lines.push(t.label + ": " + alt + " altered of " + prof + " profiled");
    } else lines.push(t.label + ": zoom in for per-patient values");
    return lines;
  }, [hover, data, visible]);

  // ---- render --------------------------------------------------------------
  const pct = visible ? Math.round(100 * Math.log(view.zoom / minZoom) / Math.log(MAX_ZOOM / minZoom)) : 0;
  const fmt = (n?: number, d = 0) => n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d });
  return (
    <div className="card" style={{ position: "relative" }}>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="meta">querying and building the contract…</p>}
      {data && visible && <>
        <div className="row" style={{ alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Oncoprint <span className="plain">— {data.stats.nColumns.toLocaleString()} patients · {data.tracks.length} tracks · {data.conventions.annotation}</span></h2>
          <span className="spacer" />
          <label className="meta"><input type="checkbox" checked={showUnaltered} onChange={(e) => setShowUnaltered(e.target.checked)} /> show unaltered</label>
          <label className="meta"><input type="checkbox" checked={view.whitespace} onChange={(e) => setView((v) => ({ ...v, whitespace: e.target.checked }))} /> whitespace</label>
          <label className="meta">sort <select value={sortKey} onChange={(e) => setSortKey(e.target.value as "server" | "client")} style={{ fontSize: "0.78rem" }}>
            <option value="server">engine order</option><option value="client">re-sort in browser (staircase)</option></select></label>
          <button className="linklike" onClick={() => zoomAt(1 / 1.4)} title="zoom out">−</button>
          <input type="range" min={0} max={100} value={pct} onChange={(e) => { const p = Number(e.target.value) / 100; setView((v) => ({ ...v, zoom: minZoom * Math.pow(MAX_ZOOM / minZoom, p) })); }} style={{ width: 120 }} />
          <button className="linklike" onClick={() => zoomAt(1.4)} title="zoom in">+</button>
          <span className="meta" style={{ minWidth: 88 }}>{view.zoom >= 1 ? view.zoom.toFixed(1) + " px/col" : (1 / view.zoom).toFixed(0) + " cols/px"}</span>
          <button className="linklike" onClick={() => setView((v) => ({ ...v, zoom: minZoom, scrollX: 0 }))}>fit</button>
        </div>
        <div ref={wrapRef} style={{ position: "relative", marginTop: "0.5rem", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <canvas ref={canvasRef} style={{ display: "block", cursor: drag.current ? "grabbing" : view.zoom > minZoom ? "grab" : "crosshair" }}
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
              border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", fontSize: "0.78rem", boxShadow: "0 4px 14px rgba(0,0,0,.12)", maxWidth: 250, zIndex: 2 }}>
              {tip.map((l, i) => <div key={i} style={i === 0 ? { fontFamily: "IBM Plex Mono, monospace" } : undefined}>{l}</div>)}
            </div>
          )}
        </div>
        <Legend data={data} />
        <details style={{ marginTop: "0.5rem" }} open>
          <summary className="meta">timings — this is the spike's instrument panel</summary>
          <table className="meta" style={{ fontVariantNumeric: "tabular-nums", borderSpacing: "10px 2px" }}><tbody>
            <tr><td>engine (server)</td><td>{fmt(perf.engineMs)} ms</td><td>pack (server)</td><td>{fmt(perf.packMs)} ms</td></tr>
            <tr><td>fetch incl. engine</td><td>{fmt(perf.fetchMs)} ms</td><td>payload</td><td>{fmt((perf.bytes || 0) / 1048576, 2)} MB binary</td></tr>
            <tr><td>decode</td><td>{fmt(perf.decodeMs, 1)} ms</td><td>last draw</td><td>{fmt(perf.drawMs, 1)} ms ({fmt(perf.cellsDrawn)} cells, {fmt(perf.bucketsDrawn)} buckets)</td></tr>
            <tr><td>client re-sort</td><td>{fmt(perf.sortMs)} ms</td><td>hide unaltered</td><td>{fmt(perf.hideMs)} ms</td></tr>
            <tr><td>frames</td><td>{perf.frames}</td><td>JS heap</td><td>{fmt(perf.heapMB)} MB</td></tr>
          </tbody></table>
        </details>
      </>}
    </div>
  );
}

function Legend({ data }: { data: UnpackedContract }) {
  const P = PALETTE;
  const sw = (c: string, w = 10) => <span style={{ display: "inline-block", width: w, height: 10, background: c, marginRight: 4, verticalAlign: -1, borderRadius: 2 }} />;
  const items: [string, string][] = [[P.amp, "Amp"], [P.homdel, "Deep Del"], [P.sv, "SV"], [P.missense, "Missense"], [P.truncating, "Truncating"], [P.inframe, "In-frame"], [P.splice, "Splice"], [P.otherMut, "Other"]];
  return (
    <div className="meta" style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem 0.9rem", marginTop: "0.4rem" }}>
      {items.map(([c, l]) => <span key={l}>{sw(c)}{l}</span>)}
      <span>{sw(P.npStripe)}Not profiled</span>
      <span>solid = putative driver, faded = unknown significance · % = driver / any</span>
      {data.tracks.filter((t) => t.kind !== "gene").map((t) => (
        <span key={t.label}>{t.label}: {t.numeric
          ? <>{sw(t.center != null ? "linear-gradient(90deg,#2166ac,#fff,#b2182b)" : "linear-gradient(90deg,#deebf7,#084887)", 44)}{t.min} → {t.max}</>
          : (t.categories || []).slice(0, 8).map((c, i) => <span key={c} style={{ marginRight: 6 }}>{sw(CAT_COLORS[i % CAT_COLORS.length])}{c}</span>)}</span>
      ))}
    </div>
  );
}
