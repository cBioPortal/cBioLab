"use client";
// The Cohorts tab's primary entry surface: type one short filter, hit Enter,
// get a pill — see lib/quickfilter.ts for the grammar and why it replaced a
// hand-typed-JSON editor (nobody was going to type JSON by hand). Existing
// clauses render through the same CohortPills used everywhere else a
// CohortDef needs to be read at a glance, so a cohort built here looks
// exactly like one built any other way.
//
// Adding and removing are callbacks, not a single onChange(nextArray):
// this app already has addClause() (page.tsx), which merges a second
// equality filter on the same clinical attribute into one OR'd `values`
// list instead of ANDing two contradictory clauses together, and is shared
// with the Explore tab's facet-click path. Reimplementing that merge here
// would silently diverge from it the first time someone changes one but not
// the other.
import { useId, useState } from "react";
import CohortPills from "./pills";
import { parseToken, suggestToken, type QuickFilterContext } from "../../lib/quickfilter.ts";
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
  const listId = useId();

  const commit = () => {
    if (!draft.trim()) return;
    try {
      onAdd(parseToken(draft, ctx));
      setDraft("");
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  };

  const suggestions = draft.trim() ? suggestToken(draft, ctx) : [];

  return (
    <div>
      <CohortPills def={{ all: clauses }} onRemoveClause={onRemove} />
      <div className="row" style={{ marginTop: "0.4rem", gap: "0.4rem" }}>
        <input
          style={{ flex: 1 }}
          value={draft}
          list={listId}
          placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Backspace" && !draft && clauses.length) onRemove(clauses.length - 1);
          }}
        />
        <button disabled={!draft.trim()} onClick={commit}>add</button>
      </div>
      <datalist id={listId}>
        {suggestions.map((s, i) => <option key={s.type + i} value={s.apply} label={s.label + (s.detail ? " — " + s.detail : "")} />)}
      </datalist>
      {error && <p className="error" style={{ marginTop: "0.3rem" }}>{error}</p>}
    </div>
  );
}
