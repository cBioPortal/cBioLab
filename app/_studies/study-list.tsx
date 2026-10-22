"use client";
// The study list's parts — a search over name, id and cancer type with the data filters beside it,
// and one row per study under a "select all" — that the study chooser (study-chooser.tsx) puts
// together for every page that asks for studies.
import { ChevronDown, ListFilter } from "lucide-react";
import { Checkbox } from "../_ui/checkbox";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../_ui/dropdown-menu";
import { cn } from "../../lib/cn";
import type { StudyInfo } from "../lab/use-catalogs.ts";

/** the capability filters, each a test on a study row */
export const STUDY_CAPS: [string, string, (s: StudyInfo) => boolean][] = [
  ["timeline", "timeline events", (s) => s.timelinePatients > 0],
  ["mrna", "mRNA", (s) => !!s.caps?.mrna],
  ["protein", "protein", (s) => !!s.caps?.protein],
  ["ga", "generic assay", (s) => !!s.caps?.ga],
  ["oncokb", "OncoKB-synced", (s) => !!s.oncokb],
  ["peer", "other instance", (s) => !!s.instance && s.instance !== "a"],
];

/** the most rows drawn; the rest are counted and the search narrows them */
export const STUDY_ROWS_SHOWN = 200;

export function filterStudies(studies: StudyInfo[], query: string, caps: Set<string>): StudyInfo[] {
  const q = query.trim().toLowerCase();
  return studies.filter((s) =>
    (!q || (s.name + " " + s.id + " " + (s.cancerType || "")).toLowerCase().includes(q)) &&
    STUDY_CAPS.every(([k, , pred]) => !caps.has(k) || pred(s)));
}

/** the search box, the data filters (a dropdown beside it) and the count; `children` are the caller's own controls */
export function StudySearch({ query, onQuery, caps, onCaps, matches, total, children }: {
  query: string; onQuery: (q: string) => void; caps: Set<string>; onCaps: (next: Set<string>) => void;
  matches: number; total: number; children?: React.ReactNode;
}) {
  const toggle = (k: string) => { const n = new Set(caps); if (n.has(k)) n.delete(k); else n.add(k); onCaps(n); };
  return (
    <div className="row g5 center mt-2.5 mb-2.5">
      <Input placeholder="search name, id, or cancer type…" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="search studies"
        className="h-8 min-w-64 flex-1 text-md md:text-md" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 font-normal", caps.size > 0 && "border-primary text-accent-foreground")}
            title="show only studies that hold a kind of data">
            <ListFilter />Filters{caps.size > 0 && <span className="tabular-nums">({caps.size})</span>}<ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Studies with</DropdownMenuLabel>
          {STUDY_CAPS.map(([k, label]) => (
            // stays open, so several can be ticked in one go
            <DropdownMenuCheckboxItem key={k} checked={caps.has(k)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle(k)}>
              {label}
            </DropdownMenuCheckboxItem>
          ))}
          {caps.size > 0 && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCaps(new Set())}>clear filters</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="meta">{matches.toLocaleString()} of {total.toLocaleString()}</span>
      {children}
    </div>
  );
}

function StudyName({ s }: { s: StudyInfo }) {
  return (
    <span className="studyname">
      <strong>{s.name}</strong>
      {s.instance && s.instance !== "a" && <span className="peerbadge" title={"held by the federated peer " + s.instanceLabel}>⧉ {s.instanceLabel}</span>}
    </span>
  );
}

/** the list's "select all": every study listed, or none of them; disabled with the reason when it may not */
export interface SelectAll { checked: boolean | "indeterminate"; onChange: () => void; label: string; disabled?: boolean; title?: string }

/**
 * One row per matching study, a checkbox each, in one grid so every column lines up; the header row
 * holds "select all" over the rows listed. `actions` draws a row's own buttons (the quick jumps),
 * which act on that study alone.
 */
export function StudyRows({ hits, loading, selected, onToggle, selectAll, actions }: {
  hits: StudyInfo[]; loading?: boolean;
  selected: string[]; onToggle: (id: string) => void;
  selectAll?: SelectAll;
  actions?: (id: string) => React.ReactNode;
}) {
  return <>
    {loading && <div className="loading-block"><span className="spinner" /> Loading studies…</div>}
    <div className="scrollbox studylist">
      {hits.length > 0 && (
        <div className="study-row study-head pb-2">
          {selectAll
            ? <label className="contents cursor-pointer" title={selectAll.title}>
                <Checkbox checked={selectAll.checked} disabled={selectAll.disabled} onCheckedChange={selectAll.onChange} aria-label={selectAll.label} title={selectAll.title} />
                <span className="normal-case tracking-normal text-sm">{selectAll.label}</span>
              </label>
            : <><span /><span /></>}
          <span>Cancer type</span><span className="pts">Patients</span><span />
        </div>
      )}
      {hits.slice(0, STUDY_ROWS_SHOWN).map((s) => (
        <label key={s.id} title={s.name + " (" + s.id + ")"} className={"study-row" + (selected.includes(s.id) ? " sel" : "")}>
          <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => onToggle(s.id)} aria-label={"stage " + s.name} />
          <StudyName s={s} />
          <span className="meta">{s.cancerType}</span>
          <span className="meta pts">{s.patients.toLocaleString()}</span>
          {actions ? actions(s.id) : <span />}
        </label>
      ))}
      {hits.length > STUDY_ROWS_SHOWN &&
        <p className="note studylist-note">Showing the {STUDY_ROWS_SHOWN} largest of {hits.length.toLocaleString()} matches — refine the search.</p>}
    </div>
  </>;
}
