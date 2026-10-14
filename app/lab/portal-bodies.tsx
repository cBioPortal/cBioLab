"use client";
// Card bodies for the views that reproduce cBioPortal's own tabs, laid out as the portal lays them
// out: its sub-tabs, its sortable tables beside the charts, a row that opens its own plot. The
// charts are lib/figures/'s — the same functions that draw the server figure for chat
// and MCP — so the two cannot drift; only the arrangement and the interaction live here. Which
// sub-tab or row is open is this browser's (invariant 9), never the document's.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ViewResult, TableQuery, CohortDef, View } from "../../lib/types";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
export { usePages, Pager } from "../_table/DataTable.tsx";
import { cancertypesPanelSvg } from "../../lib/figures/cancertypes";
import { enrichmentChartsSvg } from "../../lib/figures/enrichment";
import { assayEntitySvg } from "../../lib/figures/assays";
import { pDigits, fmtP, fmtPct, fmtNum } from "../../lib/chart/format";
import { textOn, seriesStyle } from "../../lib/chart/style";
import { frame, palette, SERIES } from "../../lib/svg-kit";
import { api } from "./api.ts";
import { DrawAtWidth, ViewFigure } from "./figure.tsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { OptionSelect } from "../_ui/choice.tsx";
import { FIELD, SEG_TAB, SEG_TABS, TB } from "../_ui/toolbar.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";



/** Tabs over a body, the portal's gene / group selectors. */
function Pills({ items, on, set }: { items: string[]; on: string; set: (x: string) => void }) {
  return (
    <Tabs value={on} onValueChange={set} className="my-2">
      <TabsList className={SEG_TABS}>
        {items.map((x) => <TabsTrigger key={x} value={x} className={SEG_TAB}>{x}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}

// ---- Cancer Types Summary: "All Queried Genes" and one tab per gene, a bar chart per cohort ----

export function CancertypesBody({ v }: { v: ViewResult }) {
  const r = v.cancertypes!;
  const ALL = "All Queried Genes";
  const [gene, setGene] = useState(ALL);
  // each cohort's chart laid out for the card's width; one with more groups than fit grows and scrolls
  const draw = (i: number) => (width: number) => {
    const c = cancertypesPanelSvg(r, i, { width, gene: gene === ALL ? null : gene, title: r.panels.length > 1 || gene !== ALL });
    return frame(c.width, c.height, c.body, palette("auto").bg, c.grown, "Cancer types summary — " + r.panels[i].cohort);
  };
  return (
    <div className="pb">
      {r.genes.length > 1 && <Pills items={[ALL, ...r.genes]} on={gene} set={setGene} />}
      {r.panels.map((_, i) => <DrawAtWidth key={i} draw={draw(i)} deps={[r, gene]} />)}
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
          <label key={f.label} className="chk"><Checkbox checked={on[i]} onCheckedChange={(c) => { setOn((o) => o.map((x, j) => j === i ? (c === true) : x)); setPage(0); }} /> {f.label}</label>
        ))}
        {search && <Input type="search" placeholder="search" className={cn(FIELD, "w-44")} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}
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
      <div className="viewtb pb-pager"><div className="tbz">
        <Button type="button" variant="outline" size="sm" className={TB} disabled={pg === 0} aria-label="previous page" onClick={() => setPage(pg - 1)}><ChevronLeft /></Button>
        <span>Showing {shown.length ? pg * pageSize + 1 : 0}–{Math.min(shown.length, (pg + 1) * pageSize)} of {shown.length.toLocaleString()}</span>
        <Button type="button" variant="outline" size="sm" className={TB} disabled={pg >= pages - 1} aria-label="next page" onClick={() => setPage(pg + 1)}><ChevronRight /></Button>
        {note && <span>{note}</span>}
      </div></div>
    </div>
  );
}

const Badge = ({ text, color }: { text: string; color: string | null }) =>
  <span className="pb-badge" style={color ? { background: color, color: textOn(color) } : { background: "var(--line)", color: "var(--ink)" }}>{text}</span>;

/** An OncoKB annotation cell: oncogenic calls coloured, the rest grey; nothing when there is no call. */
export const AnnotationBadge = ({ text }: { text: string }) => text
  ? <Badge text={text} color={/oncogenic/i.test(text) && !/likely neutral|inconclusive/i.test(text) ? SERIES[4] : null} /> : null;

// ---- Genomic Alterations: the three charts, then the table -------------------------------------

type EnRow = NonNullable<ViewResult["enrichment"]>["rows"][number];

export function EnrichmentBody({ v }: { v: ViewResult }) {
  const r = v.enrichment!;
  const two = r.groups.length === 2;
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const cols: Col<EnRow>[] = [
    { key: "gene", label: "Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong> },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null },
    ...r.groups.map((name, i): Col<EnRow> => ({ key: "g" + i, label: name, num: true, title: "altered / profiled in " + name,
      value: (g) => g.cells[i].pct, render: (g) => <>{g.cells[i].altered.toLocaleString()} ({g.cells[i].pct == null ? "—" : fmtPct(g.cells[i].pct!)})</> })),
    ...(two ? [{ key: "lr", label: "Log2 Ratio", num: true, value: (g: EnRow) => g.log2Ratio ?? (g.cells[0].altered ? 99 : -99),
      render: (g: EnRow) => g.log2Ratio == null ? (g.cells[0].altered ? ">10" : "<-10") : g.log2Ratio.toFixed(2) }] : []),
    { key: "p", label: "p-Value", num: true, value: (g) => g.p, render: (g) => pDigits(g.p) },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <span style={{ fontWeight: g.q < 0.05 ? 700 : 400 }}>{pDigits(g.q)}</span> },
    { key: "in", label: two ? "Enriched in" : "Most enriched in", value: (g) => g.enrichedIn, render: (g) => <Badge text={g.enrichedIn} color={g.q < 0.05 ? color(g.enrichedIn) : null} /> },
  ];
  return (
    <div className="pb">
      <DrawAtWidth draw={(width) => enrichmentChartsSvg(r, { width })} deps={[r]} />
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
 * pair, drawn here by the shared renderer. A newer pick supersedes one still in flight.
 */
function usePairPlot(docJson: (() => string) | undefined, cohort: string, view: Record<string, unknown> | null) {
  const [state, setState] = useState<{ key: string; view?: ViewResult; error?: string } | null>(null);
  const want = useRef("");
  const key = JSON.stringify(view);
  useEffect(() => {
    if (!view || !docJson) return;
    want.current = key;
    setState(null);
    let doc: { study?: string; cohorts?: Record<string, CohortDef> };
    try { doc = JSON.parse(docJson()); } catch { setState({ key, error: "no document to plot from" }); return; }
    const def = doc.cohorts && doc.cohorts[cohort];
    if (!def) { setState({ key, error: "cohort “" + cohort + "” is not in the document" }); return; }
    api.analysis({ study: doc.study, cohorts: { [cohort]: def }, views: [{ ...view, cohorts: [cohort] } as View] }, { query: "?oncoprint=spec" })
      .then((r) => r.json())
      .then((j) => { if (want.current !== key) return; const pv = j.views && j.views[0]; setState({ key, ...(j.error || pv?.error ? { error: j.error || pv.error } : { view: pv }) }); })
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
    { key: "p", label: "p-Value", num: true, value: (g) => g.rhoP, render: (g) => pDigits(g.rhoP) },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <strong>{pDigits(g.q)}</strong> },
  ];
  return (
    <div className="pb">
      <p className="meta">Genes on <code>{r.otherProfile}</code> correlated with <strong>{r.gene}</strong> on <code>{r.profileType}</code>, over {r.cohort} · {r.tested.toLocaleString()} genes tested · {r.significant.toLocaleString()} at q &lt; 0.05</p>
      <div className="pb-row">
        <div>
          <OptionSelect value={which} ariaLabel="which correlations to show" onValueChange={(v) => setWhich(v as typeof which)}>
            <option value="any">Show Any Correlation</option><option value="positive">Show Positive Correlations</option><option value="negative">Show Negative Correlations</option>
          </OptionSelect>
          <PortalTable rows={rows} cols={cols} initialSort={{ key: "q" }} search={(g) => g.gene + " " + (g.cytoband || "")} selected={picked} onSelect={setSel}
            note={"the " + r.positive.length + " most positive and " + r.negative.length + " most negative of " + r.tested.toLocaleString()} />
        </div>
        <div className="pb-plot">
          {picked && <p className="meta">{r.gene} vs {picked.gene} · Spearman {picked.rho?.toFixed(2)} ({fmtP(picked.rhoP)}) · Pearson {picked.r?.toFixed(2)} ({fmtP(picked.p)})</p>}
          {!plot && picked && <div className="loading-block"><span className="spinner" /> drawing {r.gene} vs {picked.gene}…</div>}
          {plot?.error && <p className="note">{plot.error}</p>}
          {plot?.view && <ViewFigure v={plot.view} min={320} />}
        </div>
      </div>
    </div>
  );
}

// ---- Generic assays: one row per entity, and the picked entity per group --------------------

type AsRow = NonNullable<ViewResult["assays"]>["rows"][number];

export function AssaysBody({ v }: { v: ViewResult }) {
  const r = v.assays!;
  const [sel, setSel] = useState<AsRow | null>(null);
  const picked = sel && r.rows.includes(sel) ? sel : r.rows[0] || null;
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const numeric = r.datatype === "numeric";
  const cols: Col<AsRow>[] = [
    { key: "name", label: "Entity", value: (e) => e.name, render: (e) => <strong title={e.entity}>{e.name}</strong> },
    ...r.groups.flatMap((name, i): Col<AsRow>[] => numeric
      ? [{ key: "m" + i, label: name + " mean", num: true, value: (e) => e.cells[i].mean ?? null, render: (e) => e.cells[i].mean == null ? "—" : fmtNum(e.cells[i].mean!) },
         { key: "s" + i, label: name + " SD", num: true, value: (e) => e.cells[i].sd ?? null, render: (e) => e.cells[i].sd == null ? "—" : fmtNum(e.cells[i].sd!) }]
      : [{ key: "n" + i, label: name + " n", num: true, value: (e) => e.cells[i].n }]),
    { key: "p", label: "p-Value", num: true, value: (e) => e.p, render: (e) => pDigits(e.p) },
    { key: "q", label: "q-Value", num: true, value: (e) => e.q, render: (e) => <strong>{pDigits(e.q)}</strong> },
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
        {picked && <div className="pb-plot"><DrawAtWidth min={320} draw={(width) => assayEntitySvg(r, picked, { width })} deps={[r, picked]} /></div>}
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
        cell={(id, x) => id === "annotation" && x ? <AnnotationBadge text={String(x)} />
          : id === "sample" ? <span className="mono">{x}</span> : undefined} />
    </div>
  );
}
