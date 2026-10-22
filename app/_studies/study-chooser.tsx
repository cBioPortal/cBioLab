"use client";
// THE study chooser, as cBioPortal's homepage has it: the cancer types down the side (each with its
// count of studies), a search and the data filters over the list, a quick select, and one row per
// study. The homepage, Explore's picker and the Results page's "Modify query" all choose studies
// with it; each says what to do with the selection itself.
import { useMemo, useState } from "react";
import { Button } from "../_ui/button";
import { CHIP } from "../_ui/toolbar.ts";
import { Choice } from "../_ui/choice.tsx";
import { StudySearch, StudyRows, filterStudies } from "./study-list.tsx";
import type { StudyInfo } from "../lab/use-catalogs.ts";
import { cn } from "../../lib/cn";

/** the quick selects: a named set of studies, by a test on each */
const QUICK: [string, string, (s: StudyInfo) => boolean][] = [
  ["TCGA PanCancer Atlas", "every TCGA PanCancer Atlas study: one pipeline, so their expression can be compared across studies", (s) => /pan_can_atlas/.test(s.id)],
];

export function StudyChooser({ studies, loading, selected, onChange, query, onQuery, caps, onCaps, actions, addAllLimit, className }: {
  studies: StudyInfo[]; loading?: boolean;
  selected: string[]; onChange: (ids: string[]) => void;
  /** the search and the data filters, when the caller keeps them (Explore's outlive its panel) */
  query?: string; onQuery?: (q: string) => void; caps?: Set<string>; onCaps?: (next: Set<string>) => void;
  /** a row's own buttons */
  actions?: (id: string) => React.ReactNode;
  /** the most studies "add all" may select at once, when each costs something (Explore's facets) */
  addAllLimit?: number;
  className?: string;
}) {
  const [ownQuery, setOwnQuery] = useState("");
  const [ownCaps, setOwnCaps] = useState<Set<string>>(() => new Set());
  const [type, setType] = useState<string | null>(null);
  const q = query ?? ownQuery, c = caps ?? ownCaps;
  const types = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of studies) n.set(s.cancerType || "Other", (n.get(s.cancerType || "Other") || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [studies]);
  const hits = filterStudies(studies, q, c).filter((s) => !type || (s.cancerType || "Other") === type);
  const union = (ids: string[]) => onChange([...new Set([...selected, ...ids])]);
  const hitIds = new Set(hits.map((h) => h.id));
  const listed = selected.filter((id) => hitIds.has(id)).length;
  const after = new Set([...selected, ...hits.map((h) => h.id)]).size;
  const over = addAllLimit != null && after > addAllLimit;
  return (
    <div data-tw className={cn("grid min-w-0 gap-x-6 gap-y-2.5 lg:grid-cols-[15rem_minmax(0,1fr)]", className)}>
      <nav aria-label="cancer types" className="hidden min-w-0 lg:block">
        <div className="mb-1.5 text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">Cancer types</div>
        <ul className="m-0 max-h-[30rem] list-none overflow-y-auto p-0 pr-1">
          {[["All", studies.length] as [string, number], ...types].map(([t, n]) => {
            const on = t === "All" ? !type : type === t;
            return (
              <li key={t}>
                <button type="button" aria-pressed={on} onClick={() => setType(t === "All" ? null : t)}
                  className={cn("flex w-full items-baseline gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-md hover:bg-accent",
                    on && "bg-accent font-semibold text-accent-foreground")}>
                  <span className="min-w-0 flex-1 truncate">{t}</span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">
        <StudySearch query={q} onQuery={onQuery ?? setOwnQuery} caps={c} onCaps={onCaps ?? setOwnCaps} matches={hits.length} total={studies.length} />
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Quick select:</span>
          {QUICK.map(([label, why, test]) => {
            const ids = studies.filter(test).map((s) => s.id);
            const tooMany = addAllLimit != null && new Set([...selected, ...ids]).size > addAllLimit;
            return (
              <Button key={label} variant="outline" size="xs" className={CHIP} disabled={!ids.length || tooMany}
                title={tooMany ? "this would select more than " + addAllLimit + " studies" : why}
                onClick={() => union(ids)}>{label} ({ids.length})</Button>
            );
          })}
          {/* the side list is hidden on a narrow page, so the type filter is a select there */}
          <Choice title="cancer type" className="max-w-56 lg:hidden" value={type ?? ""} onChange={(v) => setType(v || null)}
            options={[["", "all cancer types"], ...types.map(([t, n]) => [t, t + " (" + n + ")"] as const)]} />
          {type && <Button variant="link" size="inline" onClick={() => setType(null)}>showing {type} only — show all</Button>}
          <span className="flex-1" />
          <Button variant="ghost" size="xs" className={CHIP} disabled={!selected.length} onClick={() => onChange([])}>clear selection</Button>
        </div>
        <StudyRows hits={hits} loading={loading} selected={selected} actions={actions}
          onToggle={(id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])}
          selectAll={{
            label: "Select all " + hits.length.toLocaleString() + " listed",
            checked: listed === hits.length && hits.length > 0 ? true : listed > 0 ? "indeterminate" : false,
            // ticked: every listed study is selected, and a click takes them all off again
            onChange: () => listed === hits.length ? onChange(selected.filter((id) => !hitIds.has(id))) : union(hits.map((h) => h.id)),
            disabled: listed < hits.length && over,
            title: listed < hits.length && over
              ? "select all takes at most " + addAllLimit + " studies; this would make " + after.toLocaleString() + " — narrow the search, or tick studies one by one"
              : listed === hits.length ? "deselect the " + hits.length + " studies listed" : "add the " + hits.length + " studies listed to the selection, keeping what is already selected",
          }} />
      </div>
    </div>
  );
}

/** "N studies selected (M patients)", or what is available before anything is */
export function SelectionStats({ studies, selected, onClear }: { studies: StudyInfo[]; selected: string[]; onClear?: () => void }) {
  const byId = new Map(studies.map((s) => [s.id, s] as const));
  const pts = (ids: string[]) => ids.reduce((n, id) => n + (byId.get(id)?.patients ?? 0), 0);
  return (
    <span data-tw className="inline-flex flex-wrap items-baseline gap-x-2 text-md">
      {selected.length
        ? <><strong className="tabular-nums">{selected.length.toLocaleString()}</strong> {selected.length === 1 ? "study" : "studies"} selected
            <span className="text-muted-foreground tabular-nums">({pts(selected).toLocaleString()} patients)</span>
            {onClear && <Button variant="link" size="inline" onClick={onClear}>deselect all</Button>}</>
        : <><strong className="tabular-nums">{studies.length.toLocaleString()}</strong> studies available
            <span className="text-muted-foreground tabular-nums">({pts(studies.map((s) => s.id)).toLocaleString()} patients)</span></>}
    </span>
  );
}
