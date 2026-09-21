"use client";
// The Cohorts tab's primary entry surface: type one short filter, hit Enter,
// get a pill — see lib/quickfilter.ts for the grammar and why it replaced a
// hand-typed-JSON editor (nobody was going to type JSON by hand). Existing
// clauses render through the same CohortPills used everywhere else a
// CohortDef needs to be read at a glance, so a cohort built here looks
// exactly like one built any other way.
//
// Suggestions render as a real dropdown below the input (arrow keys to
// move, Enter or click to pick), not the browser's native <datalist> popup —
// closer to a search bar's own suggestion list, and lets each row carry a
// kind label datalist can't.
//
// Picking a suggestion fills the input; it does NOT commit a pill by itself.
// That is deliberate, not a shortcut skipped: several suggestions are
// mid-token completions inviting more typing ("Treatment: " wants a filter
// next, an attribute name wants "= value" next), so treating "picked" the
// same as "done" would commit a clause before it says what it means. A
// second Enter — now with nothing highlighted — commits.
//
// Adding and removing are callbacks, not a single onChange(nextArray):
// this app already has addClause() (page.tsx), which merges a second
// equality filter on the same clinical attribute into one OR'd `values`
// list instead of ANDing two contradictory clauses together, and is shared
// with the Explore tab's facet-click path. Reimplementing that merge here
// would silently diverge from it the first time someone changes one but not
// the other.
import { useRef, useState } from "react";
import CohortPills from "./pills";
import { parseToken, suggestToken, type QuickFilterContext, type Suggestion } from "../../lib/quickfilter.ts";
import type { Clause } from "../../lib/types.ts";

export default function QuickFilterBar({
  clauses, onAdd, onRemove, ctx, placeholder = "TP53: MUT · SEX = Female · Treatment · Diagnosis before Treatment <=90d"
}: {
  clauses: Clause[];
  onAdd: (clause: Clause) => void;
  onRemove: (index: number) => void;
  ctx: QuickFilterContext;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions: Suggestion[] = draft.trim() ? suggestToken(draft, ctx) : [];
  const showSuggestions = open && suggestions.length > 0;

  const commit = () => {
    if (!draft.trim()) return;
    try {
      onAdd(parseToken(draft, ctx));
      setDraft("");
      setError(null);
      setOpen(false);
      setHighlighted(-1);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  };
  const pick = (s: Suggestion) => {
    setDraft(s.apply);
    setError(null);
    setHighlighted(-1);
    setOpen(true); // stay open: the applied text often invites more typing
    inputRef.current?.focus();
  };

  return (
    <div>
      <CohortPills def={{ all: clauses }} onRemoveClause={onRemove} />
      <div style={{ position: "relative", marginTop: "0.4rem" }}>
        <div className="row" style={{ gap: "0.4rem" }}>
          <input
            ref={inputRef}
            style={{ flex: 1 }}
            value={draft}
            placeholder={placeholder}
            role="combobox" aria-expanded={showSuggestions} aria-autocomplete="list"
            onChange={(e) => { setDraft(e.target.value); setError(null); setOpen(true); setHighlighted(-1); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setOpen(true); setHighlighted((h) => Math.min(h + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, -1)); }
              else if (e.key === "Enter") {
                e.preventDefault();
                if (showSuggestions && highlighted >= 0) pick(suggestions[highlighted]);
                else commit();
              } else if (e.key === "Escape") { setOpen(false); setHighlighted(-1); }
              else if (e.key === "Backspace" && !draft && clauses.length) onRemove(clauses.length - 1);
            }}
          />
          <button disabled={!draft.trim()} onClick={commit}>add</button>
        </div>
        {showSuggestions && (
          <div className="qf-suggest" role="listbox">
            {suggestions.map((s, i) => (
              <div key={s.type + s.label + i} role="option" aria-selected={i === highlighted}
                className={"qf-suggest-row" + (i === highlighted ? " on" : "")}
                onMouseEnter={() => setHighlighted(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
                <span className="qf-suggest-label">{s.label}</span>
                {s.detail && <span className="qf-suggest-detail">{s.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: "0.3rem" }}>{error}</p>}
    </div>
  );
}
