"use client";
// What the card bodies that reproduce cBioPortal's own tabs share (cancertypes, enrichment, correlates,
// assays and mutations, each in app/lab/kinds/<kind>.tsx): the portal's sortable, searchable, paged
// table and its annotation badges. Those bodies lay their views out as the portal does — its sub-tabs,
// its tables beside the charts, a row that opens its own plot — with the charts the server figure is
// drawn from, so the two cannot drift. Which sub-tab or row is open is this browser's (invariant 9),
// never the document's.
import React, { useMemo, useState } from "react";
export { usePages, Pager } from "../_table/DataTable.tsx";
import { textOn } from "../../lib/chart/style";
import { SERIES } from "../../lib/svg-kit";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { FIELD, TB } from "../_ui/toolbar.ts";



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

export const Badge = ({ text, color }: { text: string; color: string | null }) =>
  <span className="pb-badge" style={color ? { background: color, color: textOn(color) } : { background: "var(--line)", color: "var(--ink)" }}>{text}</span>;

/** An OncoKB annotation cell: oncogenic calls coloured, the rest grey; nothing when there is no call. */
export const AnnotationBadge = ({ text }: { text: string }) => text
  ? <Badge text={text} color={/oncogenic/i.test(text) && !/likely neutral|inconclusive/i.test(text) ? SERIES[4] : null} /> : null;

