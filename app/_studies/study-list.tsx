"use client";
// The study list as Explore draws it — a search over name, id and cancer type, capability filters,
// and one row per study — for every page that asks for studies: Explore's picker (several, staged)
// and the Results page's query (one).
import { Checkbox } from "../_ui/checkbox";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { RadioGroup, RadioGroupItem } from "../_ui/radio-group";
import { CHIP } from "../_ui/toolbar.ts";
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

/** the search box, the capability chips and the count; `children` are the caller's own actions on the matches */
export function StudySearch({ query, onQuery, caps, onCaps, matches, total, children }: {
  query: string; onQuery: (q: string) => void; caps: Set<string>; onCaps: (next: Set<string>) => void;
  matches: number; total: number; children?: React.ReactNode;
}) {
  return (
    <div className="row g5 center mt-2.5 mb-2.5">
      <Input placeholder="search name, id, or cancer type…" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="search studies"
        className="h-8 min-w-64 flex-1 text-md md:text-md" />
      {STUDY_CAPS.map(([k, label]) => (
        <Button key={k} variant="outline" size="xs" className={CHIP} aria-pressed={caps.has(k)}
          onClick={() => { const n = new Set(caps); if (n.has(k)) n.delete(k); else n.add(k); onCaps(n); }}>
          {label}
        </Button>
      ))}
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

/**
 * One row per matching study, in one grid so every column lines up. `pick` "many" ticks
 * checkboxes; "one" is a radio group. `actions` draws a row's own buttons (Explore's per-study
 * icons), which act on that study alone.
 */
export function StudyRows({ hits, loading, pick, selected, onToggle, actions }: {
  hits: StudyInfo[]; loading?: boolean;
  pick: "many" | "one"; selected: string[]; onToggle: (id: string) => void;
  actions?: (id: string) => React.ReactNode;
}) {
  const head = hits.length > 0 && (
    <div className="study-row study-head" aria-hidden>
      <span /><span>Study</span><span>Cancer type</span><span className="pts">Patients</span><span />
    </div>
  );
  const more = hits.length > STUDY_ROWS_SHOWN &&
    <p className="note studylist-note">Showing the {STUDY_ROWS_SHOWN} largest of {hits.length.toLocaleString()} matches — refine the search.</p>;
  const cells = (s: StudyInfo) => <>
    <StudyName s={s} />
    <span className="meta">{s.cancerType}</span>
    <span className="meta pts">{s.patients.toLocaleString()}</span>
    {actions ? actions(s.id) : <span />}
  </>;
  return <>
    {loading && <div className="loading-block"><span className="spinner" /> Loading studies…</div>}
    {pick === "many" ? (
      <div className="scrollbox studylist">
        {head}
        {hits.slice(0, STUDY_ROWS_SHOWN).map((s) => (
          <label key={s.id} title={s.name + " (" + s.id + ")"} className={"study-row" + (selected.includes(s.id) ? " sel" : "")}>
            <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => onToggle(s.id)} aria-label={"stage " + s.name} />
            {cells(s)}
          </label>
        ))}
        {more}
      </div>
    ) : (
      <RadioGroup value={selected[0] ?? ""} onValueChange={onToggle} aria-label="study" className="scrollbox studylist gap-x-2.5 gap-y-0">
        {head}
        {hits.slice(0, STUDY_ROWS_SHOWN).map((s) => (
          <label key={s.id} title={s.name + " (" + s.id + ")"} className={"study-row" + (selected.includes(s.id) ? " sel" : "")}>
            <RadioGroupItem value={s.id} aria-label={s.name} className="p-0" />
            {cells(s)}
          </label>
        ))}
        {more}
      </RadioGroup>
    )}
  </>;
}
