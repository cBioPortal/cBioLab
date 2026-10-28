"use client";
// Explore's lists, the portal study view's way: every row has a checkbox, and the checked rows of a
// list become one filter when its "Apply filter" is pressed — rows of one list are alternatives, so
// they join as an OR. Only the rows in view are rendered (TanStack Virtual), so a list of thousands
// of values scrolls as cheaply as a list of ten; rows never wrap, so every row is one height.
import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "../_ui/checkbox";
import { Button } from "../_ui/button";
import { cn } from "@/lib/cn";
import { fmtPct } from "../../lib/chart/format.ts";

/** a list's checked rows, in the order they were checked */
export function usePicks() {
  const [picked, setPicked] = useState<string[]>([]);
  return {
    picked,
    has: (k: string) => picked.includes(k),
    toggle: (k: string) => setPicked((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]),
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
          <div key={r.key} data-index={r.index} ref={v.measureElement} className="vrow" style={{ transform: "translateY(" + r.start + "px)" }}>
            {children(items[r.index], r.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** one row: the whole row toggles its checkbox; `on` marks a row whose value is already in the draft */
export function PickRow({ className, picks, k, on, disabled, title, label, children }: {
  className: string; picks: Picks; k: string; on?: boolean; disabled?: boolean; title?: string; label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn(className, on && "on", disabled && "is-static")} data-tip={title}>
      <Checkbox checked={picks.has(k)} disabled={disabled} onCheckedChange={() => picks.toggle(k)} aria-label={label} />
      {children}
    </label>
  );
}

/**
 * Under a list once anything is checked: how many, a way to uncheck them, and the button that
 * applies them. `why` is the reason they cannot be applied as they are, said beside the button.
 */
export function PickBar({ picks, onApply, why, action = "Apply filter", hint }: {
  picks: Picks; onApply: (keys: string[]) => void; why?: string | null; action?: string; hint?: string;
}) {
  const n = picks.picked.length;
  if (!n) return null;
  return (
    <div className="pickbar">
      <span className="meta">{n.toLocaleString()} checked{why ? " · " + why : ""}</span>
      <span className="spacer" />
      <Button variant="ghost" size="xs" onClick={picks.clear}>Clear</Button>
      <Button size="xs" disabled={!!why} data-tip={hint} onClick={() => { onApply(picks.picked); picks.clear(); }}>{action}</Button>
    </div>
  );
}

/** a value list's row height in px: one line of --t-md plus the row's padding */
const VALROW_H = 24;

export type ValueRow = { key: string; name: string; n: number; total?: number; on?: boolean; muted?: boolean; disabled?: boolean; title: string };

/**
 * A ranked value list (a categorical facet, a gene's states, timeline events, case lists): name, a
 * bar of its count against the largest, the count, and its share of `total` when there is one.
 */
export function ValueList({ rows, onApply, why, hint, picks: shared }: {
  rows: ValueRow[]; onApply: (keys: string[]) => void; why?: (keys: string[]) => string | null; hint?: string;
  /** the checked rows, when something outside the list (its chart menu) reads them too */
  picks?: Picks;
}) {
  const own = usePicks();
  const picks = shared ?? own;
  const live = picks.picked.filter((k) => rows.some((r) => r.key === k));
  const max = Math.max(...rows.map((r) => r.n), 1);
  return <>
    <VirtualRows items={rows} rowKey={(r) => r.key} estimate={VALROW_H} className="vallist">
      {(r) => (
        <PickRow className="valrow" picks={picks} k={r.key} on={r.on} disabled={r.disabled} title={r.title} label={r.name}>
          <span className="vname" style={r.muted ? { color: "var(--muted)" } : undefined}>{r.name}</span>
          <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * r.n / max)) + "%" }} /></span>
          <span className="vn">{r.n.toLocaleString()}</span>
          <span className="vpct">{r.total ? fmtPct(100 * r.n / r.total) : ""}</span>
        </PickRow>
      )}
    </VirtualRows>
    <PickBar picks={picks} hint={hint} why={why ? why(live) : null} onApply={() => onApply(live)} />
  </>;
}
