"use client";
// Card bodies for the views that reproduce cBioPortal's own tabs, laid out as the portal lays them
// out: its sub-tabs, its sortable tables beside the charts, a row that opens its own plot. The
// charts are lib/view-svg-portal.ts's — the same functions that draw the server figure for chat
// and MCP — so the two cannot drift; only the arrangement and the interaction live here. Which
// sub-tab or row is open is this browser's (invariant 9), never the document's.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ViewResult, TableQuery } from "../../lib/types";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
export { usePages, Pager } from "../_table/DataTable.tsx";
import { cancertypesPanelSvg, enrichmentVolcanoSvg, enrichmentScatterSvg, enrichmentTopSvg } from "../../lib/view-svg-portal";
import { frame, palette, SERIES } from "../../lib/svg-kit";

const framed = (c: { body: string; width: number; height: number } | null) => c ? frame(c.width, c.height, c.body, palette("auto").bg, true) : null;
export const pFmt = (x: number) => x === 0 ? "< 1e-300" : x < 1e-3 ? x.toExponential(2) : x.toFixed(3);

const Svg = ({ html }: { html: string }) => <div className="viewfig" dangerouslySetInnerHTML={{ __html: html }} />;

/** Pills over a body, the portal's gene / group selectors. */
function Pills({ items, on, set }: { items: string[]; on: string; set: (x: string) => void }) {
  return (
    <div className="pb-pills" role="tablist">
      {items.map((x) => <button key={x} type="button" role="tab" aria-selected={x === on} className={x === on ? "on" : undefined} onClick={() => set(x)}>{x}</button>)}
    </div>
  );
}

// ---- Cancer Types Summary: "All Queried Genes" and one tab per gene, a bar chart per cohort ----

export function CancertypesBody({ v }: { v: ViewResult }) {
  const r = v.cancertypes!;
  const ALL = "All Queried Genes";
  const [gene, setGene] = useState(ALL);
  const svgs = useMemo(() => r.panels.map((_, i) => {
    const c = cancertypesPanelSvg(r, i, { gene: gene === ALL ? null : gene, title: r.panels.length > 1 || gene !== ALL });
    return frame(c.width, c.height, c.body, palette("auto").bg, true);
  }), [r, gene]);
  return (
    <div className="pb">
      {r.genes.length > 1 && <Pills items={[ALL, ...r.genes]} on={gene} set={setGene} />}
      <div className="pb-scroll">{svgs.map((s, i) => <Svg key={i} html={s} />)}</div>
    </div>
  );
}

// ---- a sortable, searchable, paged table — the portal's tables ---------------------------------

export interface Col<T> { key: string; label: string; num?: boolean; value: (r: T) => string | number | null; render?: (r: T) => React.ReactNode; title?: string }

export function PortalTable<T>({ rows, cols, initialSort, search, filters, selected, onSelect, pageSize = 25, note }: {
  rows: T[]; cols: Col<T>[]; initialSort: { key: string; desc?: boolean };
  /** the text a row is found by */
  search?: (r: T) => string;
  /** checkboxes that narrow the rows */
  filters?: { label: string; test: (r: T) => boolean; on?: boolean }[];
  selected?: T | null; onSelect?: (r: T) => void; pageSize?: number;
  /** said under the pager: what the rows are out of */
  note?: React.ReactNode;
}) {
  const [sort, setSort] = useState(initialSort);
  const [q, setQ] = useState("");
  const [on, setOn] = useState<boolean[]>(() => (filters || []).map((f) => !!f.on));
  const [page, setPage] = useState(0);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const col = cols.find((c) => c.key === sort.key) || cols[0];
    const out = rows.filter((r) => (!needle || !search || search(r).toLowerCase().includes(needle)) && (filters || []).every((f, i) => !on[i] || f.test(r)));
    return out.sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [rows, cols, sort, q, on, search, filters]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize)), pg = Math.min(page, pages - 1);
  return (
    <div className="pb-tablewrap">
      <div className="pb-tablebar">
        {(filters || []).map((f, i) => (
          <label key={f.label} className="chk"><input type="checkbox" checked={on[i]} onChange={(e) => { setOn((o) => o.map((x, j) => j === i ? e.target.checked : x)); setPage(0); }} /> {f.label}</label>
        ))}
        {search && <input type="search" placeholder="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}
      </div>
      <table className="pb-table">
        <thead><tr>{cols.map((c) => (
          <th key={c.key} className={c.num ? "num" : undefined} title={c.title} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
            onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !!c.num }))}>
            {c.label}{sort.key === c.key ? (sort.desc ? " ▾" : " ▴") : ""}
          </th>))}</tr></thead>
        <tbody>{shown.slice(pg * pageSize, (pg + 1) * pageSize).map((r, i) => (
          <tr key={i} className={selected === r ? "sel" : undefined} onClick={onSelect ? () => onSelect(r) : undefined}>
            {cols.map((c) => <td key={c.key} className={c.num ? "num" : undefined}>{c.render ? c.render(r) : String(c.value(r) ?? "")}</td>)}
          </tr>))}</tbody>
      </table>
      <div className="pb-pager">
        <button type="button" className="tbbtn" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
        <span>Showing {shown.length ? pg * pageSize + 1 : 0}–{Math.min(shown.length, (pg + 1) * pageSize)} of {shown.length.toLocaleString()}</span>
        <button type="button" className="tbbtn" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
        {note && <span>{note}</span>}
      </div>
    </div>
  );
}

const Badge = ({ text, color }: { text: string; color: string | null }) =>
  <span className="pb-badge" style={color ? { background: color } : { background: "var(--line)", color: "var(--ink)" }}>{text}</span>;

// ---- Genomic Alterations: the three charts, then the table -------------------------------------

type EnRow = NonNullable<ViewResult["enrichment"]>["rows"][number];

export function EnrichmentBody({ v }: { v: ViewResult }) {
  const r = v.enrichment!;
  const two = r.groups.length === 2;
  const charts = useMemo(() => [enrichmentVolcanoSvg(r), enrichmentScatterSvg(r), enrichmentTopSvg(r)].map(framed).filter((x): x is string => !!x), [r]);
  const color = (g: string) => SERIES[r.groups.indexOf(g) % SERIES.length];
  const cols: Col<EnRow>[] = [
    { key: "gene", label: "Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong> },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null },
    ...r.groups.map((name, i): Col<EnRow> => ({ key: "g" + i, label: name, num: true, title: "altered / profiled in " + name,
      value: (g) => g.cells[i].pct, render: (g) => <>{g.cells[i].altered.toLocaleString()} ({g.cells[i].pct == null ? "—" : g.cells[i].pct!.toFixed(2) + "%"})</> })),
    ...(two ? [{ key: "lr", label: "Log2 Ratio", num: true, value: (g: EnRow) => g.log2Ratio ?? (g.cells[0].altered ? 99 : -99),
      render: (g: EnRow) => g.log2Ratio == null ? (g.cells[0].altered ? ">10" : "<-10") : g.log2Ratio.toFixed(2) }] : []),
    { key: "p", label: "p-Value", num: true, value: (g) => g.p, render: (g) => pFmt(g.p) },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <span style={{ fontWeight: g.q < 0.05 ? 700 : 400 }}>{pFmt(g.q)}</span> },
    { key: "in", label: two ? "Enriched in" : "Most enriched in", value: (g) => g.enrichedIn, render: (g) => <Badge text={g.enrichedIn} color={g.q < 0.05 ? color(g.enrichedIn) : null} /> },
  ];
  return (
    <div className="pb">
      <div className="pb-row pb-scroll">{charts.map((c, i) => <Svg key={i} html={c} />)}</div>
      <PortalTable rows={r.rows} cols={cols} initialSort={{ key: "q" }} search={(g) => g.gene + " " + (g.cytoband || "")}
        filters={[{ label: "Significant only", test: (g) => g.q < 0.05 }]}
        note={r.tested > r.rows.length ? "the " + r.rows.length + " most significant of " + r.tested.toLocaleString() + " genes tested" : undefined} />
    </div>
  );
}

// ---- Co-expression: the correlated genes, and the query gene against the one picked ----------

type CoRow = NonNullable<ViewResult["correlates"]>["positive"][number];

/**
 * A plot of two values over one cohort, computed when asked: an ordinary plot view sent for the
 * pair, drawn by the shared server renderer. A newer pick supersedes one still in flight.
 */
function usePairPlot(docJson: (() => string) | undefined, cohort: string, view: Record<string, unknown> | null) {
  const [state, setState] = useState<{ key: string; svg?: string; error?: string } | null>(null);
  const want = useRef("");
  const key = JSON.stringify(view);
  useEffect(() => {
    if (!view || !docJson) return;
    want.current = key;
    setState(null);
    let doc: { study?: string; cohorts?: Record<string, unknown> };
    try { doc = JSON.parse(docJson()); } catch { setState({ key, error: "no document to plot from" }); return; }
    const def = doc.cohorts && doc.cohorts[cohort];
    if (!def) { setState({ key, error: "cohort “" + cohort + "” is not in the document" }); return; }
    fetch("/api/analysis?figures=svg", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study: doc.study, cohorts: { [cohort]: def }, views: [{ ...view, cohorts: [cohort] }] }) })
      .then((r) => r.json())
      .then((j) => { if (want.current !== key) return; const pv = j.views && j.views[0]; setState({ key, ...(j.error || pv?.error ? { error: j.error || pv.error } : { svg: pv?.svg }) }); })
      .catch((e) => { if (want.current === key) setState({ key, error: String(e) }); });
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.key === key ? state : null;
}

export function CorrelatesBody({ v, docJson }: { v: ViewResult; docJson?: () => string }) {
  const r = v.correlates!;
  const [which, setWhich] = useState<"any" | "positive" | "negative">("any");
  const rows = useMemo(() => which === "positive" ? r.positive : which === "negative" ? r.negative : [...r.positive, ...r.negative], [r, which]);
  const [sel, setSel] = useState<CoRow | null>(null);
  const picked = sel && rows.includes(sel) ? sel : [...rows].sort((a, b) => a.q - b.q || Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0))[0] || null;
  const plot = usePairPlot(docJson, r.cohort, picked ? { kind: "plot", unit: "patient",
    x: { source: "molecular", profileType: r.profileType, gene: r.gene }, y: { source: "molecular", profileType: r.otherProfile, gene: picked.gene } } : null);
  const cols: Col<CoRow>[] = [
    { key: "gene", label: "Correlated Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong> },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null },
    { key: "rho", label: "Spearman's Correlation", num: true, value: (g) => g.rho,
      render: (g) => <span style={{ color: (g.rho ?? 0) > 0 ? SERIES[2] : SERIES[4] }}>{g.rho?.toFixed(3)}</span> },
    { key: "p", label: "p-Value", num: true, value: (g) => g.rhoP, render: (g) => pFmt(g.rhoP) },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <strong>{pFmt(g.q)}</strong> },
  ];
  return (
    <div className="pb">
      <p className="meta">Genes on <code>{r.otherProfile}</code> correlated with <strong>{r.gene}</strong> on <code>{r.profileType}</code>, over {r.cohort} · {r.tested.toLocaleString()} genes tested · {r.significant.toLocaleString()} at q &lt; 0.05</p>
      <div className="pb-row">
        <div>
          <label className="tbfield">
            <select value={which} onChange={(e) => setWhich(e.target.value as typeof which)}>
              <option value="any">Show Any Correlation</option><option value="positive">Show Positive Correlations</option><option value="negative">Show Negative Correlations</option>
            </select>
          </label>
          <PortalTable rows={rows} cols={cols} initialSort={{ key: "q" }} search={(g) => g.gene + " " + (g.cytoband || "")} selected={picked} onSelect={setSel}
            note={"the " + r.positive.length + " most positive and " + r.negative.length + " most negative of " + r.tested.toLocaleString()} />
        </div>
        <div className="pb-plot">
          {picked && <p className="meta">{r.gene} vs {picked.gene} · Spearman {picked.rho?.toFixed(2)} (p = {pFmt(picked.rhoP)}) · Pearson {picked.r?.toFixed(2)} (p = {pFmt(picked.p)})</p>}
          {!plot && picked && <div className="loading-block"><span className="spinner" /> drawing {r.gene} vs {picked.gene}…</div>}
          {plot?.error && <p className="note">{plot.error}</p>}
          {plot?.svg && <Svg html={plot.svg} />}
        </div>
      </div>
    </div>
  );
}

// ---- Generic assays: one row per entity, and the picked entity per group --------------------

type AsRow = NonNullable<ViewResult["assays"]>["rows"][number];

/** Each group's mean ± SD (numeric), or its mix of values (categorical), for the picked entity. */
function assayEntitySvg(r: NonNullable<ViewResult["assays"]>, e: AsRow): string {
  const p = palette("auto"), L = 150, W = 520, ROW = 30, T = 26;
  const out: string[] = [`<text x="10" y="16" font-size="12" font-weight="700" fill="${p.ink}">${escapeXml(e.name)}</text>`];
  if (r.datatype === "numeric") {
    const lo = Math.min(...e.cells.map((c) => (c.mean ?? 0) - (c.sd ?? 0))), hi = Math.max(...e.cells.map((c) => (c.mean ?? 0) + (c.sd ?? 0)));
    const a = Math.min(0, lo), b = hi > a ? hi : a + 1, X = (x: number) => L + (W - L - 30) * (x - a) / (b - a);
    e.cells.forEach((c, i) => {
      const y = T + 14 + i * ROW, col = SERIES[i % SERIES.length];
      out.push(`<text x="${L - 8}" y="${y + 4}" font-size="10.5" fill="${p.ink}" text-anchor="end">${escapeXml(c.cohort)} (n=${c.n})</text>`);
      if (c.mean != null) {
        if (c.sd != null) out.push(`<line x1="${X(c.mean - c.sd)}" y1="${y}" x2="${X(c.mean + c.sd)}" y2="${y}" stroke="${col}" stroke-width="2"/>`);
        out.push(`<circle cx="${X(c.mean)}" cy="${y}" r="5" fill="${col}"/><text x="${X(c.mean)}" y="${y - 8}" font-size="9.5" fill="${p.muted}" text-anchor="middle">${c.mean.toPrecision(3)}</text>`);
      }
    });
    const yb = T + 14 + e.cells.length * ROW;
    out.push(`<line x1="${L}" y1="${yb}" x2="${W - 30}" y2="${yb}" stroke="${p.muted}" stroke-width="0.6"/>` +
      [a, (a + b) / 2, b].map((x) => `<text x="${X(x)}" y="${yb + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${Number(x.toPrecision(3))}</text>`).join("") +
      `<text x="${(L + W - 30) / 2}" y="${yb + 26}" font-size="9.5" fill="${p.muted}" text-anchor="middle">mean ± SD per ${r.unit.replace(/s$/, "")}</text>`);
    return frame(W, yb + 34, out.join(""), p.bg);
  }
  const vals = r.values || [];
  e.cells.forEach((c, i) => {
    const y = T + 6 + i * ROW;
    out.push(`<text x="${L - 8}" y="${y + 12}" font-size="10.5" fill="${p.ink}" text-anchor="end">${escapeXml(c.cohort)} (n=${c.n})</text>`);
    let x = L;
    vals.forEach((val, vi) => {
      const n = c.values?.[val] || 0, w = c.n ? (W - L - 30) * n / c.n : 0;
      if (w > 0) out.push(`<rect x="${x}" y="${y}" width="${w}" height="16" fill="${SERIES[vi % SERIES.length]}"><title>${escapeXml(val + ": " + n + " of " + c.n)}</title></rect>`);
      x += w;
    });
  });
  const yb = T + 6 + e.cells.length * ROW + 6;
  let kx = L;
  vals.forEach((val, vi) => { out.push(`<rect x="${kx}" y="${yb}" width="10" height="10" fill="${SERIES[vi % SERIES.length]}"/><text x="${kx + 14}" y="${yb + 9}" font-size="10" fill="${p.ink}">${escapeXml(val)}</text>`); kx += 24 + val.length * 6.2; });
  return frame(Math.max(W, kx), yb + 20, out.join(""), p.bg);
}
const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function AssaysBody({ v }: { v: ViewResult }) {
  const r = v.assays!;
  const [sel, setSel] = useState<AsRow | null>(null);
  const picked = sel && r.rows.includes(sel) ? sel : r.rows[0] || null;
  const color = (g: string) => SERIES[r.groups.indexOf(g) % SERIES.length];
  const numeric = r.datatype === "numeric";
  const cols: Col<AsRow>[] = [
    { key: "name", label: "Entity", value: (e) => e.name, render: (e) => <strong title={e.entity}>{e.name}</strong> },
    ...r.groups.flatMap((name, i): Col<AsRow>[] => numeric
      ? [{ key: "m" + i, label: name + " mean", num: true, value: (e) => e.cells[i].mean ?? null, render: (e) => e.cells[i].mean == null ? "—" : e.cells[i].mean!.toPrecision(3) },
         { key: "s" + i, label: name + " SD", num: true, value: (e) => e.cells[i].sd ?? null, render: (e) => e.cells[i].sd == null ? "—" : e.cells[i].sd!.toPrecision(3) }]
      : [{ key: "n" + i, label: name + " n", num: true, value: (e) => e.cells[i].n }]),
    { key: "p", label: "p-Value", num: true, value: (e) => e.p, render: (e) => pFmt(e.p) },
    { key: "q", label: "q-Value", num: true, value: (e) => e.q, render: (e) => <strong>{pFmt(e.q)}</strong> },
    { key: "in", label: "Higher in", value: (e) => e.higherIn, render: (e) => <Badge text={e.higherIn + (e.value ? " · " + e.value : "")} color={e.q < 0.05 ? color(e.higherIn) : null} /> },
  ];
  return (
    <div className="pb">
      <p className="meta">{r.profileName} · {r.test} · {r.tested.toLocaleString()} entities tested · {r.significant.toLocaleString()} at q &lt; 0.05</p>
      <div className="pb-row">
        <div>
          <PortalTable rows={r.rows} cols={cols} initialSort={{ key: "q" }} search={(e) => e.name + " " + e.entity} selected={picked} onSelect={setSel}
            filters={[{ label: "Significant only", test: (e) => e.q < 0.05 }]}
            note={r.tested > r.rows.length ? "the " + r.rows.length + " most significant of " + r.tested.toLocaleString() : undefined} />
        </div>
        {picked && <div className="pb-plot"><Svg html={assayEntitySvg(r, picked)} /></div>}
      </div>
    </div>
  );
}

// ---- Mutations: one gene's mutation table, on the shared table (app/_table/DataTable.tsx) ---------

export function MutationsBody({ v, spec, vi, updating, docJson, onQuery }: { v: ViewResult; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  const t = v.mutations!;
  return (
    <div className="pb">
      <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit={t.gene + " mutations"} onQuery={onQuery}
        num={(id, x) => id === "vaf" ? x.toFixed(2) : x.toLocaleString()}
        cell={(id, x) => id === "annotation" && x ? <Badge text={String(x)} color={/oncogenic/i.test(String(x)) && !/likely neutral|inconclusive/i.test(String(x)) ? SERIES[4] : null} />
          : id === "sample" ? <span className="mono">{x}</span> : undefined} />
    </div>
  );
}
