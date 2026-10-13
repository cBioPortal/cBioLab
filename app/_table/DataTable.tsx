"use client";
// Every table view's table: the columns shown (and a chooser for the rest), a search across them,
// a filter per column — text conditions or a pick from the values the column takes, a range for a
// number — a sort from the headers, pages, and the CSV download of every row kept.
//
// The search, filters, sort and columns are the view's spec (lib/table-query.ts), so a change
// re-runs the view and a shared document reproduces the table; the page is this browser's.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ColumnFilter, ColumnValues, TableQuery, TableRows, TextFilterOp } from "../../lib/types.ts";
import { api } from "../lab/api.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { ViewPageBody, TableBody } from "../../lib/api-schemas.ts";
import { ChevronLeft, ChevronRight, Columns3, Download, X } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { OptionSelect } from "../_ui/choice.tsx";
import { FIELD, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

/** a page number in the pager, filled while it is the page shown */
const PAGE = "min-w-ctl justify-center aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground";
/** the × that removes a chip */
const CHIP_X = "size-4 text-muted-foreground [&_svg:not([class*='size-'])]:size-3";

const OP_LABELS: Record<TextFilterOp, string> = {
  contains: "contains", notContains: "does not contain", equals: "equals", notEquals: "does not equal",
  startsWith: "begins with", endsWith: "ends with", regex: "matches regex",
};

/** The query with nothing set dropped, so a cleared control leaves the spec as it was. */
function clean(q: TableQuery): TableQuery {
  return {
    columns: q.columns && q.columns.length ? q.columns : undefined,
    search: q.search && q.search.trim() ? q.search : undefined,
    filters: q.filters && Object.keys(q.filters).length ? q.filters : undefined,
    sort: q.sort || undefined,
  };
}

function isRange(f: ColumnFilter): f is { min?: number; max?: number } { return "min" in f || "max" in f; }
function isValues(f: ColumnFilter): f is { values: string[] } { return "values" in f; }

/** A filter in a few words, for its chip. */
function filterText(f: ColumnFilter): string {
  if (isRange(f)) return f.min != null && f.max != null ? f.min + " – " + f.max : f.min != null ? "≥ " + f.min : "≤ " + f.max;
  if (isValues(f)) return f.values.length === 1 ? "= " + (f.values[0] || "(blank)") : "one of " + f.values.length;
  return OP_LABELS[f.op] + " “" + f.value + "”";
}

// ---- paging: page 1 comes with the result; any other page is fetched for this view ------------

export type PageRows<R> = { rows: R[]; loading: boolean; error: string | null; page: number; size: number; pages: number; total: number;
  setPage: (p: number) => void; setSize: (n: number) => void };

/**
 * The rows of one page of a table view. The page and its size are this browser's (like scroll) —
 * not in the document, never re-running the view: page 1 at the view's own size is the result's;
 * any other is POSTed to /api/view-page as {document, view, offset, limit} and kept, so moving
 * back and forth is instant. A new result (a filter or sort changed, say) starts again at page 1.
 */
export function usePages<R>(first: R[], total: number, offset0: number, viewSize: number, vi: number, docJson?: () => string, table?: string): PageRows<R> {
  const [size, setSizeState] = useState(viewSize);
  const [page, setPageState] = useState(0);
  const [cache, setCache] = useState<Map<string, R[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  // a new result starts again at page 1; the page size is the reader's and stays
  // and a page still loading for the old query is dropped when it lands, not cached under this one
  useEffect(() => { gen.current++; setPageState(0); setCache(new Map()); setError(null); }, [first, total]);
  const pages = Math.max(1, Math.ceil(total / size));
  const k = page + ":" + size;
  const local = offset0 === 0 && page * size + size <= first.length || (offset0 === 0 && first.length >= total) ? first.slice(page * size, page * size + size) : null;
  useEffect(() => {
    if (local || cache.has(k) || !docJson) return;
    const g = ++gen.current;
    setError(null);
    let doc: unknown;
    try { doc = JSON.parse(docJson()); } catch { setError("no document to page"); return; }
    api.viewPage({ doc: doc as ViewPageBody["doc"], view: vi, offset: page * size, limit: size, ...(table ? { table } : {}) })
      .then((r) => r.json())
      .then((j) => { if (gen.current !== g) return; if (j.error) setError(j.error); else setCache((m) => new Map(m).set(k, j.rows)); })
      .catch((e) => { if (gen.current === g) setError(String(e)); });
  }, [k, local, cache]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a page not on hand is loading from the render that asks for it (the effect above fetches it), so the
  // rows never flash empty first; with no document to fetch from, nothing is loading
  return { rows: local || cache.get(k) || [], loading: !local && !cache.has(k) && !error && !!docJson, error, page, size, pages, total,
    setPage: (p) => setPageState(Math.max(0, Math.min(pages - 1, p))),
    setSize: (n) => { setSizeState(n); setPageState(0); } };
}

/** The pager under a table: previous, a window of page numbers, next; the rows shown; the page size. */
export function Pager({ p, unit }: { p: PageRows<unknown>; unit: string }) {
  const nums: (number | null)[] = [];
  const lo = Math.max(0, p.page - 2), hi = Math.min(p.pages - 1, p.page + 2);
  if (lo > 0) nums.push(0, ...(lo > 1 ? [null] : []));
  for (let i = lo; i <= hi; i++) nums.push(i);
  if (hi < p.pages - 1) nums.push(...(hi < p.pages - 2 ? [null] : []), p.pages - 1);
  const from = p.total ? p.page * p.size + 1 : 0, to = Math.min(p.total, (p.page + 1) * p.size);
  return (
    <div className="viewtb pb-pager"><div className="tbz">
      <Button type="button" variant="outline" size="sm" className={TB} disabled={p.page === 0} onClick={() => p.setPage(p.page - 1)} aria-label="previous page"><ChevronLeft /></Button>
      {nums.map((n, i) => n == null ? <span key={"g" + i}>…</span>
        : <Button key={n} type="button" variant="outline" size="sm" className={cn(TB, PAGE)} aria-current={n === p.page ? "page" : undefined} onClick={() => p.setPage(n)}>{(n + 1).toLocaleString()}</Button>)}
      <Button type="button" variant="outline" size="sm" className={TB} disabled={p.page >= p.pages - 1} onClick={() => p.setPage(p.page + 1)} aria-label="next page"><ChevronRight /></Button>
      <span>Showing {from.toLocaleString()}–{to.toLocaleString()} of {p.total.toLocaleString()} {unit}</span>
      <label className="tbfield">per page <OptionSelect value={String(p.size)} onValueChange={(v) => p.setSize(Number(v))}>
        {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
      </OptionSelect></label>
      {p.error && <span className="mark">{p.error}</span>}
    </div></div>
  );
}

// ---- a popover anchored under its button, closed by a click outside or Escape --------------------

function Popover({ open, onClose, children, align = "left" }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  // fixed to the viewport under its anchor, so a table that scrolls sideways does not clip it
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = ref.current?.parentElement?.getBoundingClientRect();
      if (!a) return;
      const h = window.innerHeight, below = h - a.bottom, above = a.top;
      // below its anchor, or above it when that has more room; never past the window
      const v: React.CSSProperties = below >= 320 || below >= above ? { top: a.bottom + 4, maxHeight: below - 12 } : { bottom: h - a.top + 4, maxHeight: above - 12 };
      setPos({ ...v, ...(align === "right" ? { right: Math.max(8, window.innerWidth - a.right) } : { left: Math.max(8, Math.min(a.left, window.innerWidth - 360)) }) });
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    // a dropdown opened from inside renders in a portal of its own: a click there is still inside, and
    // Escape closes that dropdown first
    const PORTAL = "[data-radix-popper-content-wrapper], [data-slot=select-content]";
    const inPortal = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(PORTAL);
    const portalOpen = () => !!document.querySelector(PORTAL);
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !inPortal(e.target)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !portalOpen()) onClose(); };
    // the click that opened it must not close it
    const t = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className="dt-pop" style={pos || { visibility: "hidden" }} role="dialog" onClick={(e) => e.stopPropagation()}>{children}</div>;
}

// ---- a column's filter ---------------------------------------------------------------------------

/**
 * The values a column takes among the rows the rest of the query keeps, fetched when its filter
 * opens. Loading, failed and loaded are three states, and `retry` asks again after a failure.
 */
type Values = { status: "loading" } | { status: "failed"; error: string } | { status: "loaded"; v: ColumnValues };
function useColumnValues(column: string, vi: number, docJson?: () => string, table?: string): Values & { retry: () => void } {
  const [state, setState] = useState<Values>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let doc: unknown, live = true;
    try { doc = JSON.parse(docJson ? docJson() : ""); } catch { setState({ status: "failed", error: "no document to read the values from" }); return; }
    setState({ status: "loading" });
    api.viewPage({ doc: doc as ViewPageBody["doc"], view: vi, values: column, ...(table ? { table } : {}) })
      .then((r) => r.json())
      .then((j) => { if (live) setState(j.error || !j.values ? { status: "failed", error: j.error || "no values came back" } : { status: "loaded", v: j.values }); })
      .catch((e) => { if (live) setState({ status: "failed", error: String((e as Error)?.message || e) }); });
    return () => { live = false; };
  }, [column, attempt]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** What a filter menu shows in place of its values while they load, or when they could not be read. */
function ValuesState({ s, what }: { s: Values & { retry: () => void }; what: string }) {
  if (s.status === "loading") return <div className="dt-loading"><Waiting what={what} />{[0, 1, 2, 3, 4].map((i) => <span key={i} className="skeleton dt-skel" />)}</div>;
  if (s.status === "failed") return <div className="dt-loading"><span className="mark">could not read the {what}: {s.error}</span> <Button type="button" variant="link" size="inline" onClick={s.retry}>retry</Button></div>;
  return null;
}

function FilterMenu({ col, current, vi, docJson, table, onApply }: {
  col: { id: string; name: string; numeric: boolean }; current: ColumnFilter | undefined; vi: number; docJson?: () => string; table?: string;
  onApply: (f: ColumnFilter | undefined) => void;
}) {
  const vals = useColumnValues(col.id, vi, docJson, table);
  const v = vals.status === "loaded" ? vals.v : null;
  const cur = current;
  const [op, setOp] = useState<TextFilterOp>(cur && !isRange(cur) && !isValues(cur) ? cur.op : "contains");
  const [text, setText] = useState(cur && !isRange(cur) && !isValues(cur) ? cur.value : "");
  const [picked, setPicked] = useState<Set<string> | null>(cur && isValues(cur) ? new Set(cur.values) : null);
  const [find, setFind] = useState("");
  const [lo, setLo] = useState(cur && isRange(cur) && cur.min != null ? String(cur.min) : "");
  const [hi, setHi] = useState(cur && isRange(cur) && cur.max != null ? String(cur.max) : "");

  if (col.numeric) {
    const range = v && v.numeric ? v : null;
    const apply = () => {
      const min = lo.trim() === "" ? undefined : Number(lo), max = hi.trim() === "" ? undefined : Number(hi);
      if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) return;
      onApply(min == null && max == null ? undefined : { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) });
    };
    return (
      <div className="dt-filter">
        <b>{col.name}</b>
        {range ? <span className="meta">{range.n ? "values from " + range.min!.toLocaleString() + " to " + range.max!.toLocaleString() + " in " + range.n.toLocaleString() + " rows" : "no values in the rows kept"}</span>
          : <ValuesState s={vals} what="range" />}
        {/* typing a bound need not wait for the range; the range only fills the placeholders */}
        <div className="row">
          <label className="tbfield">from <Input type="number" step="any" className={cn(FIELD, "w-28")} value={lo} placeholder={range && range.min != null ? String(range.min) : "min"} onChange={(e) => setLo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label>
          <label className="tbfield">to <Input type="number" step="any" className={cn(FIELD, "w-28")} value={hi} placeholder={range && range.max != null ? String(range.max) : "max"} onChange={(e) => setHi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label>
        </div>
        <span className="meta">blank rows are left out once a range is set</span>
        <div className="row end">
          <Button type="button" variant="outline" size="sm" className={TB} disabled={!cur} onClick={() => onApply(undefined)}>remove filter</Button>
          <Button type="button" size="sm" className="h-ctl px-3 text-md" onClick={apply}>apply</Button>
        </div>
      </div>
    );
  }

  const list = v && !v.numeric ? v : null;
  const shown = list ? list.values.filter((x) => x.value.toLowerCase().includes(find.trim().toLowerCase())) : [];
  const isOn = (x: string) => picked ? picked.has(x) : true;
  const toggle = (x: string) => {
    const base = picked || new Set(list ? list.values.map((y) => y.value) : []);
    const next = new Set(base);
    if (next.has(x)) next.delete(x); else next.add(x);
    setPicked(next); setText("");
  };
  const apply = () => {
    if (text.trim()) return onApply({ op, value: text });
    if (picked && list && !(picked.size === list.values.length && !list.truncated)) return onApply({ values: [...picked] });
    onApply(undefined);
  };
  return (
    <div className="dt-filter">
      <b>{col.name}</b>
      <div className="row">
        <OptionSelect value={op} onValueChange={(v) => setOp(v as TextFilterOp)} ariaLabel="condition">
          {(Object.keys(OP_LABELS) as TextFilterOp[]).map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </OptionSelect>
        <Input type="text" className={cn(FIELD, "w-40")} value={text} placeholder="text" onChange={(e) => { setText(e.target.value); if (e.target.value) setPicked(null); }}
          onKeyDown={(e) => e.key === "Enter" && apply()} aria-label="condition text" />
      </div>
      <span className="meta">or pick values{list ? " — " + list.values.length.toLocaleString() + (list.truncated ? "+ (the most frequent)" : "") + " in the rows kept" : ""}</span>
      {list && list.values.length > 8 && <Input type="search" className={FIELD} value={find} placeholder="find a value" onChange={(e) => setFind(e.target.value)} aria-label="find a value" />}
      <div className="row">
        <Button type="button" variant="link" size="inline" disabled={!list} title={list ? undefined : "waiting for the column's values"} onClick={() => { setPicked(null); setText(""); }}>all</Button>
        <Button type="button" variant="link" size="inline" disabled={!list} title={list ? undefined : "waiting for the column's values"} onClick={() => { setPicked(new Set()); setText(""); }}>none</Button>
      </div>
      <div className="dt-values">
        {!list && <ValuesState s={vals} what="values" />}
        {list && !list.values.length && <span className="meta">no values in the rows kept</span>}
        {shown.map((x) => (
          <label key={x.value} className="meta">
            <Checkbox checked={isOn(x.value)} onCheckedChange={() => toggle(x.value)} />
            <span className="dt-grow">{x.value === "" ? <i>(blank)</i> : x.value}</span>
            <span className="n">{x.n.toLocaleString()}</span>
          </label>))}
      </div>
      <div className="row end">
        <Button type="button" variant="outline" size="sm" className={TB} disabled={!cur} onClick={() => onApply(undefined)}>remove filter</Button>
        <Button type="button" size="sm" className="h-ctl px-3 text-md" onClick={apply}>apply</Button>
      </div>
    </div>
  );
}

// ---- the column chooser ----------------------------------------------------------------------------

function ColumnsMenu({ columns, shown, onShown }: { columns: { id: string; name: string }[]; shown: string[]; onShown: (ids: string[] | undefined) => void }) {
  const [find, setFind] = useState("");
  const match = (c: { id: string; name: string }) => !find.trim() || (c.name + " " + c.id).toLowerCase().includes(find.trim().toLowerCase());
  const toggle = (id: string) => {
    const next = shown.includes(id) ? shown.filter((x) => x !== id) : columns.map((c) => c.id).filter((x) => x === id || shown.includes(x));
    if (next.length) onShown(next);
  };
  return (
    <div className="dt-filter">
      <b>Columns ({shown.length} of {columns.length})</b>
      {columns.length > 10 && <Input type="search" className={FIELD} value={find} placeholder="find a column" onChange={(e) => setFind(e.target.value)} aria-label="find a column" />}
      <div className="row">
        <Button type="button" variant="link" size="inline" onClick={() => onShown(columns.map((c) => c.id))}>all</Button>
        <Button type="button" variant="link" size="inline" onClick={() => onShown(undefined)}>default</Button>
      </div>
      <div className="dt-values">
        {columns.filter(match).map((c) => (
          <label key={c.id} className="meta">
            <Checkbox checked={shown.includes(c.id)} disabled={shown.length === 1 && shown.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
            <span className="dt-grow">{c.name}</span>
            {c.name !== c.id && <span className="n mono">{c.id}</span>}
          </label>))}
      </div>
      <span className="meta">the download holds every column</span>
    </div>
  );
}

// ---- the table ---------------------------------------------------------------------------------------

/** A table view's query as its spec holds it — older `attributes` and `sort.attribute` read as `columns` and `sort.column`. */
export function specQuery(spec: Record<string, unknown>): TableQuery {
  const s = spec.sort as { column?: string; attribute?: string; desc?: boolean } | undefined;
  const column = s ? s.column || s.attribute : undefined;
  return clean({
    columns: (spec.columns || spec.attributes) as string[] | undefined,
    search: spec.search as string | undefined,
    filters: spec.filters as TableQuery["filters"],
    sort: column ? { column, ...(s!.desc ? { desc: true } : {}) } : undefined,
  });
}

export interface DataTableProps<V> {
  /** the last result: the rows on screen, the columns, the counts */
  t: TableRows<V>;
  /** the query as the document holds it now — what the controls show and what an edit builds on, so a second
   *  edit made while the first is still running keeps the first (default: the result's) */
  query?: TableQuery;
  /** a request for this view is running (a query change, or the whole document): the rows are covered */
  updating: boolean;
  /** the view's index in the document, and the document — for pages, a column's values and the download */
  vi: number; docJson?: () => string;
  /** which of the view's tables this is, for a view that holds several (the alterations view's "mutations", "cna", "sv") */
  table?: string;
  /** what a row is, plural: "mutations", "samples" */
  unit: string;
  /** the view's search, filters, sort and columns changed: write them to its spec (re-runs the view) */
  onQuery: (q: TableQuery) => void;
  /** a cell drawn other than as its text (a badge, a link) */
  cell?: (column: string, value: V) => React.ReactNode;
  /** how a number shows (default: grouped) */
  num?: (column: string, value: number) => string;
  title?: React.ReactNode;
  /** a row can be chosen (the timeline view's patient): called with the clicked row */
  onRow?: (row: TableRows<V>["rows"][number]) => void;
  /** which row is chosen, highlighted */
  selected?: (row: TableRows<V>["rows"][number]) => boolean;
  /** a column whose runs of one value are drawn as groups (the alterations view's gene): the value shown on a run's
   *  first row only, no rule inside a run, alternate runs shaded */
  groupBy?: string;
}

export function DataTable<V extends string | number | null>({ t, query, updating, vi, docJson, table, unit, onQuery, cell, num, title, onRow, selected, groupBy }: DataTableProps<V>) {
  const q = query || t.query || {};
  const p = usePages(t.rows, t.total, t.offset || 0, t.pageSize || t.rows.length || 25, vi, docJson, table);
  const multi = t.lists.length > 1;
  // runs of one value of `groupBy` on this page: whether a row continues the run above, has more below, and is in an odd run
  const gi = groupBy ? t.columns.findIndex((c) => c.id === groupBy) : -1;
  const groups = gi < 0 ? null : (() => {
    let run = 0;
    return p.rows.map((r, k) => {
      const v = r.values[gi], cont = k > 0 && v === p.rows[k - 1].values[gi];
      if (k > 0 && !cont) run++;
      return { cont, more: k + 1 < p.rows.length && p.rows[k + 1].values[gi] === v, odd: run % 2 === 1 };
    });
  })();
  const [menu, setMenu] = useState<string | null>(null);   // a column id, or "\x01columns"
  const [search, setSearch] = useState(q.search || "");
  useEffect(() => { setSearch(q.search || ""); }, [q.search]);
  const head = useRef<HTMLTableSectionElement>(null);
  const [headH, setHeadH] = useState(0);
  // measures after every render; setState with an unchanged height is a no-op
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (head.current) setHeadH(head.current.offsetHeight); });
  const set = (patch: Partial<TableQuery>, keepOpen = false) => {
    if (!keepOpen) setMenu(null);
    const next = clean({ ...q, ...patch });
    if (JSON.stringify(next) !== JSON.stringify(clean(q))) onQuery(next);
  };
  const setFilter = (id: string, f: ColumnFilter | undefined) => {
    const filters = { ...(q.filters || {}) };
    if (f) filters[id] = f; else delete filters[id];
    set({ filters });
  };
  const sortBy = (c: { id: string; numeric: boolean }) => {
    const on = q.sort && q.sort.column === c.id;
    set({ sort: on ? { column: c.id, ...(q.sort!.desc ? {} : { desc: true }) } : { column: c.id, ...(c.numeric ? { desc: true } : {}) } });
  };
  // the columns as the document asks for them; the result's own until it says otherwise
  const known = (id: string) => t.columns.some((c) => c.id === id);
  const shownIds = q.columns && q.columns.some(known) ? q.columns.filter(known) : !q.columns && t.query.columns ? (t.defaults || t.shown) : t.shown;
  const shownIdx = shownIds.map((id) => t.columns.findIndex((c) => c.id === id)).filter((i) => i >= 0);
  const filters = Object.entries(q.filters || {});
  const filtered = t.total < t.all || filters.length > 0 || !!(q.search || "").trim();
  const waiting = updating ? "updating…" : p.loading ? "loading page " + (p.page + 1).toLocaleString() + "…" : null;
  const show = (c: { id: string; numeric: boolean }, x: V) => {
    if (cell) { const r = cell(c.id, x); if (r !== undefined) return r; }
    if (x == null || x === "") return "";
    return typeof x === "number" ? (num ? num(c.id, x) : x.toLocaleString()) : String(x);
  };
  const download = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    let doc: unknown;
    try { doc = JSON.parse(docJson ? docJson() : ""); } catch { return; }
    (f.elements.namedItem("payload") as HTMLInputElement).value = await api.tablePayload({ doc: doc as TableBody["doc"], view: vi, ...(table ? { table } : {}) });
    f.submit();
  };
  return (
    <div className="dt">
      <div className="dt-bar">
        <span className={"dt-title" + (updating ? " stale" : "")}>{title}{title ? " · " : ""}{filtered ? <>{t.total.toLocaleString()} of {t.all.toLocaleString()} {unit}</> : <>{t.total.toLocaleString()} {unit}</>}
          {multi ? <span className="meta"> across {t.lists.length} cohorts and studies</span> : null}</span>
        {updating && <span className="waiting" role="status"><span className="spinner" /> updating…</span>}
        <span className="spacer" />
        <form className="dt-search" onSubmit={(e) => { e.preventDefault(); set({ search }); }}>
          <Input type="search" className={cn(FIELD, "w-52")} value={search} placeholder={"search " + unit} aria-label={"search " + unit}
            onChange={(e) => { setSearch(e.target.value); if (!e.target.value && q.search) set({ search: undefined }); }}
            onBlur={() => { if ((search || "") !== (q.search || "")) set({ search }); }} />
        </form>
        <span className="dt-anchor">
          <Button type="button" variant="outline" size="sm" className={cn(TB, "aria-expanded:border-primary aria-expanded:bg-accent aria-expanded:text-accent-foreground")}
            aria-expanded={menu === "\x01columns"} onClick={() => setMenu(menu === "\x01columns" ? null : "\x01columns")}
            title="choose the columns shown"><Columns3 />columns ({shownIdx.length}/{t.columns.length})</Button>
          <Popover open={menu === "\x01columns"} onClose={() => setMenu(null)} align="right">
            <ColumnsMenu columns={t.columns} shown={shownIds} onShown={(ids) => set({ columns: ids }, true)} />
          </Popover>
        </span>
        <form method="post" action="/api/table" target="_blank" onSubmit={download}>
          <input type="hidden" name="payload" />
          <Button variant="outline" size="sm" className={TB} type="submit" disabled={updating || !docJson || !t.total}
            title={updating ? "waiting for the table to update, so the download matches it" : !t.total ? "no rows to download"
              : "every row kept, with all " + t.columns.length + " columns, as comma-separated text"}><Download />download CSV ({t.total.toLocaleString()})</Button>
        </form>
      </div>
      {(filters.length > 0 || (q.search || "").trim()) && (
        <div className="dt-chips">
          {(q.search || "").trim() && <span className="dt-chip">search “{q.search}” <Button type="button" variant="ghost" size="icon-xs" className={CHIP_X} aria-label="clear search" onClick={() => set({ search: undefined })}><X /></Button></span>}
          {filters.map(([id, f]) => (
            <span key={id} className="dt-chip">
              <Button type="button" variant="link" size="inline" onClick={() => setMenu(id)}>{t.columns.find((c) => c.id === id)?.name || id} {filterText(f)}</Button>
              <Button type="button" variant="ghost" size="icon-xs" className={CHIP_X} aria-label={"remove the filter on " + id} onClick={() => setFilter(id, undefined)}><X /></Button>
            </span>))}
          <Button type="button" variant="link" size="inline" onClick={() => set({ search: undefined, filters: undefined })}>clear all</Button>
        </div>
      )}
      <div className={"dt-body" + (waiting ? " waiting-rows" : "")} aria-busy={!!waiting}>
        <div className="tv-scroll">
          <table className="pb-table dt-table">
            <thead ref={head}><tr>
              {multi && <th>cohort</th>}
              {multi && <th>study</th>}
              {shownIdx.map((i) => {
                const c = t.columns[i];
                const sorted = q.sort && q.sort.column === c.id;
                const fon = !!(q.filters && q.filters[c.id]);
                return (
                  <th key={c.id} className={c.numeric ? "num" : undefined} aria-sort={sorted ? (q.sort!.desc ? "descending" : "ascending") : "none"}>
                    <span className="dt-th">
                      <button type="button" className="dt-sort" onClick={() => sortBy(c)} title="sort the whole table by this column, across every page">
                        {c.name}{sorted ? (q.sort!.desc ? " ▾" : " ▴") : ""}
                      </button>
                      <span className="dt-anchor">
                        <button type="button" className={"dt-funnel" + (fon ? " on" : "")} aria-label={"filter " + c.name}
                          title={fon ? "filtered: " + filterText(q.filters![c.id]) : "filter this column"} onClick={() => setMenu(menu === c.id ? null : c.id)}>
                          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M1 1.5h10L7.2 6.2V10L4.8 11V6.2z" fill="currentColor" /></svg>
                        </button>
                        <Popover open={menu === c.id} onClose={() => setMenu(null)} align={c.numeric ? "right" : "left"}>
                          <FilterMenu col={c} current={q.filters?.[c.id]} vi={vi} docJson={docJson} table={table} onApply={(f) => setFilter(c.id, f)} />
                        </Popover>
                      </span>
                    </span>
                  </th>);
              })}
            </tr></thead>
            <tbody>
              {p.rows.map((r, k) => {
                const g = groups ? groups[k] : null;
                const cls = [onRow ? "dt-pick" + (selected && selected(r) ? " sel" : "") : "", g?.odd ? "dt-galt" : "", g?.more ? "dt-gmid" : ""].filter(Boolean).join(" ");
                return (
                <tr key={k} className={cls || undefined}
                  onClick={onRow ? () => onRow(r) : undefined} aria-selected={onRow ? !!(selected && selected(r)) : undefined}>
                  {multi && <td className="meta">{r.cohort}</td>}
                  {multi && <td className="meta">{r.study}</td>}
                  {shownIdx.map((i) => <td key={i} className={t.columns[i].numeric ? "num" : undefined}>
                    {g?.cont && t.columns[i].id === groupBy ? null : show(t.columns[i], r.values[i])}</td>)}
                </tr>);
              })}
              {!p.rows.length && !waiting && <tr><td className="meta" colSpan={shownIdx.length + (multi ? 2 : 0)}>{filtered ? "no rows match — loosen the search or a filter" : "no rows"}</td></tr>}
            </tbody>
          </table>
        </div>
        {/* the rows under it are the last answer, not this one: covered until the new one lands; the header stays usable */}
        {waiting && <div className="dt-wait" style={{ top: headH + 1 }} role="status" aria-live="polite"><span className="loading-block"><span className="spinner" /> {waiting}</span></div>}
      </div>
      <Pager p={p as PageRows<unknown>} unit={unit} />
    </div>
  );
}
