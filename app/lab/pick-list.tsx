"use client";
// Explore's lists, the portal study view's way: every row has a checkbox, and the checked rows of a
// list become one filter when its "Apply filter" is pressed — rows of one list are alternatives, so
// they join as an OR. Only the rows in view are rendered (TanStack Virtual), so a list of thousands
// of values scrolls as cheaply as a list of ten; rows never wrap, so every row is one height.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "../_ui/checkbox";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { cn } from "@/lib/cn";
import { fmtInt, fmtPct } from "../../lib/chart/format.ts";
import { LIST_SEARCH_FROM, listBulk, listRows } from "../../lib/value-list.ts";

/** a list's checked rows, in the order they were checked */
export function usePicks() {
  const [picked, setPicked] = useState<string[]>([]);
  return {
    picked,
    has: (k: string) => picked.includes(k),
    toggle: (k: string) => setPicked((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]),
    set: (keys: string[]) => setPicked(keys),
    clear: () => setPicked([]),
  };
}
export type Picks = ReturnType<typeof usePicks>;

/**
 * The rows of a scrolling list, only those in view mounted. `className` is the scroll container's
 * (its CSS caps the height); each row sits in a positioned wrapper whose `data-index` is its place
 * in `items`. A `header` row stays at the top of the scroll area as the rows scroll under it, so
 * it shares their width (and their columns) whether or not a scrollbar takes some of it.
 */
export function VirtualRows<T>({ items, rowKey, estimate, className, header, children }: {
  items: T[]; rowKey: (item: T) => string; estimate: number; className: string; header?: React.ReactNode;
  children: (item: T, index: number) => React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length, getScrollElement: () => scroller.current, estimateSize: () => estimate,
    getItemKey: (i) => rowKey(items[i]), overscan: 8,
    // the server render and the first paint show the top of the list, not an empty box
    initialRect: { width: 0, height: 20 * estimate },
  });
  return (
    <div ref={scroller} className={className}>
      {header && <div className="vrowshead">{header}</div>}
      <div className="vrows" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((r) => (
          <div key={r.key} data-index={r.index} data-odd={r.index % 2 === 1 || undefined} ref={v.measureElement} className="vrow" style={{ transform: "translateY(" + r.start + "px)" }}>
            {children(items[r.index], r.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** one row: the whole row toggles its checkbox; `on` marks a row whose value is already in the draft */
export function PickRow({ className, picks, k, on, disabled, applied, title, label, children }: {
  className: string; picks: Picks; k: string; on?: boolean; disabled?: boolean;
  /** already in the selection's filter: checked and fixed, as the portal pins its applied rows */
  applied?: boolean; title?: string; label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn(className, on && "on", (disabled || applied) && "is-static", applied && "applied")} data-tip={title}>
      <Checkbox checked={applied || picks.has(k)} disabled={disabled || applied} onCheckedChange={() => picks.toggle(k)} aria-label={label} />
      {children}
    </label>
  );
}

/**
 * Under a list once anything is checked: how many, a way to uncheck them, and the button that
 * applies them. `why` is the reason they cannot be applied as they are, said beside the button.
 */
export function PickBar({ picks, onApply, why, action = "Apply filter", hint, children }: {
  picks: Picks; onApply: (keys: string[]) => void; why?: string | null; action?: string; hint?: string;
  /** a choice of how the checked rows apply, beside the button */
  children?: React.ReactNode;
}) {
  const n = picks.picked.length;
  if (!n) return null;
  return (
    <div className="pickbar">
      <span className="meta">{n.toLocaleString()} checked{why ? " · " + why : ""}</span>
      <span className="spacer" />
      <Button variant="ghost" size="xs" onClick={picks.clear}>Clear</Button>
      {children}
      <Button size="xs" disabled={!!why} data-tip={hint} onClick={() => { onApply(picks.picked); picks.clear(); }}>{action}</Button>
    </div>
  );
}

/** a value list's row height in px, the portal's table row (STS-TBL-7) */
const VALROW_H = 25;

export type ValueRow = { key: string; name: string; n: number; total?: number; on?: boolean; muted?: boolean; disabled?: boolean; title: string;
  /** the value of the list's `extra` column: a count, or a word (a sample's "Pre" / "Post") */
  extra?: number | string;
  /** a row that cannot join others in one filter (NA), left out of Select all */
  solo?: boolean };

/** the list's search box: it owns what is typed, and hands it on 400 ms after the last key, as the portal's */
function SearchField({ onSearch }: { onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const t = setTimeout(() => onSearch(draft), 400);
    return () => clearTimeout(t);
  }, [draft, onSearch]);
  return <Input type="search" className="h-7 w-36 text-md md:text-md" placeholder="Search..." aria-label="search the values" value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

/**
 * A ranked value list (a categorical facet, a gene's states, timeline events, case lists), as the
 * portal's study-view table: a header (#, Freq), then per row its name, a bar of its count against
 * the largest, the count, and its share of `total` when there is one; the rows the filter holds
 * pinned first. A list that scrolls gets the portal's search box and Select all / Deselect all over
 * the rows it shows (lib/value-list.ts).
 */
export function ValueList({ rows, onApply, why, hint, picks: shared, pct = fmtPct, unit = "cases", cut, extra }: {
  rows: ValueRow[]; onApply: (keys: string[]) => void; why?: (keys: string[]) => string | null; hint?: string;
  /** how a share (0–100) is written */
  pct?: (pct: number) => string;
  /** the checked rows, when something outside the list (its chart menu) reads them too */
  picks?: Picks;
  /** what the counts count, for the "#" header's tooltip */
  unit?: string;
  /** when the list holds only the most frequent values: how many it holds, of how many */
  cut?: { shown: number; of: number };
  /** a count column before "#" in place of the bar (a mutation-type table's "# Mut"): its header and that header's tooltip */
  extra?: { head: string; tip: string };
}) {
  const own = usePicks();
  const picks = shared ?? own;
  const [search, setSearch] = useState("");
  const searchable = rows.length >= LIST_SEARCH_FROM;
  // a search the box no longer shows filters nothing, and is not there when the box comes back
  useEffect(() => { if (!searchable) setSearch(""); }, [searchable]);
  const withShares = useMemo(() => rows.map((r) => ({ ...r, share: r.total ? pct(100 * r.n / r.total) : "" })), [rows, pct]);
  const shown = useMemo(() => listRows(withShares, searchable ? search : ""), [withShares, searchable, search]);
  const bulk = listBulk(shown, picks.picked);
  const keys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const live = picks.picked.filter((k) => keys.has(k));
  return <>
    <VirtualRows items={shown} rowKey={(r) => r.key} estimate={VALROW_H} className={"vallist" + (extra ? " withextra" : "")}
      header={<div className="valhead" aria-hidden="true"><span /><span />{extra && <span data-tip={extra.tip}>{extra.head}</span>}<span data-tip={"Number of " + unit}>#</span><span>{rows.some((r) => r.total) ? "Freq" : ""}</span></div>}>
      {(r) => (
        <PickRow className="valrow" picks={picks} k={r.key} on={r.on} applied={r.on} disabled={r.disabled} title={r.title} label={r.name}>
          <span className="vname" style={r.muted ? { color: "var(--muted)" } : undefined}>{r.name}</span>
          {extra && <span className="vn">{typeof r.extra === "string" ? r.extra : fmtInt(r.extra ?? 0)}</span>}
          <span className="vn">{r.n.toLocaleString()}</span>
          <span className="vpct">{r.share}</span>
        </PickRow>
      )}
    </VirtualRows>
    {searchable && <div className="vsearch">
      <SearchField onSearch={setSearch} />
      {bulk.selectAll && <Button variant="ghost" size="xs" onClick={() => picks.set(bulk.selectAll!)}
        data-tip={(search.trim() ? "check every value the search shows" : "check every value") + (rows.some((r) => r.solo) ? ", but NA, which is applied alone" : "")}>Select all</Button>}
      {bulk.deselectAll && <Button variant="ghost" size="xs" onClick={() => picks.set(bulk.deselectAll!)}
        data-tip={search.trim() ? "uncheck the values the search shows" : "uncheck every value"}>Deselect all</Button>}
    </div>}
    {searchable && search.trim() && cut && <p className="note flush mt-1">The search covers the {cut.shown.toLocaleString()} most frequent of the {cut.of.toLocaleString()} values.</p>}
    {searchable && search.trim() && !shown.length && <p className="note flush mt-1">No value {cut ? "among these " : ""}matches “{search.trim()}”.</p>}
    <PickBar picks={picks} hint={hint} why={why ? why(live) : null} onApply={() => onApply(live)} />
  </>;
}
