"use client";
// Explore's filter bar, laid out as the Study View's (lib/study-view-pills.ts): "<chart> : a or b",
// numeric intervals with editable ends; clauses of no clinical chart drawn as the generic pills.
import { Fragment, useEffect, useState } from "react";
import type { CohortDef } from "../../lib/types.ts";
import { editInterval, filterGroups, intervalEnds, intervalText, removePill, type Interval, type SvPill } from "../../lib/study-view-pills.ts";
import { ClausePill, CLINICAL_COLOR, type OnCustomData } from "./pills";

type Result = { draft: CohortDef } | { why: string };

/** one end of an interval, typed in place: Enter or leaving the field applies it, Escape puts it back */
function EditNum({ value, label, onCommit }: { value: number; label: string; onCommit: (raw: string) => boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { if (text.trim() !== String(value) && !onCommit(text)) setText(String(value)); };
  return (
    <input className="svedit" aria-label={label} inputMode="decimal" value={text} size={Math.max(2, text.length)}
      onChange={(e) => setText(e.target.value.replace(/[^0-9eE.+-]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") { setText(String(value)); }
      }} />
  );
}

function IntervalBody({ iv, name, edit }: { iv: Interval; name: string; edit: (end: "lo" | "hi" | "point", raw: string) => boolean }) {
  if (iv.kind === "point") return <EditNum value={iv.value} label={name + " value"} onCommit={(r) => edit("point", r)} />;
  const lo = iv.lo != null && <EditNum value={iv.lo} label={name + " start"} onCommit={(r) => edit("lo", r)} />;
  const hi = iv.hi != null && <EditNum value={iv.hi} label={name + " end"} onCommit={(r) => edit("hi", r)} />;
  if (iv.lo != null && iv.hi != null) return <>{lo}{` ${iv.loIn ? "≤" : "<"} x ${iv.hiIn ? "≤" : "<"} `}{hi}</>;
  if (iv.lo != null) return <>{iv.loIn ? "≥ " : "> "}{lo}</>;
  return <>{iv.hiIn ? "≤ " : "< "}{hi}</>;
}

const pillText = (p: SvPill) => p.kind === "na" ? "NA" : p.kind === "value" ? String(p.value) : intervalText(p.interval);

export default function StudyViewPills({ draft, labelOf, apply, onIntervalEdited, onRemoveClause, onCustomData }: {
  draft: CohortDef;
  labelOf: (attribute: string) => string | undefined;
  /** applies an edited draft, or says why it can't be; false when refused */
  apply: (r: Result) => boolean;
  /** an interval's ends were typed: the numbers the chart's filter now runs between */
  onIntervalEdited?: (attribute: string, ends: number[]) => void;
  onRemoveClause: (i: number) => void;
  onCustomData?: OnCustomData;
}) {
  return (
    <span className="svpills">
      {filterGroups(draft, labelOf).map((g) => g.kind === "other"
        ? <ClausePill key={g.clause} clause={draft.all![g.clause]} onRemove={() => onRemoveClause(g.clause)} onCustomData={onCustomData} />
        : (
          <span key={g.clause} className="svgroup" data-sv-chart={g.attribute}>
            <span className="svname" data-tip={g.attribute}>{g.label}</span>
            <span className="svop">:</span>
            {g.pills.map((p, k) => (
              <Fragment key={k}>
                {k > 0 && <span className="svop">or</span>}
                <span className="fpill svpill" style={{ borderLeftColor: CLINICAL_COLOR }} data-sv-pill={pillText(p)}>
                  {p.kind === "interval"
                    ? <IntervalBody iv={p.interval} name={g.label}
                        edit={(end, raw) => {
                          const r = editInterval(draft, g.clause, p.leaf, end, raw);
                          if ("draft" in r) onIntervalEdited?.(g.attribute, intervalEnds(r.draft, g.clause, p.leaf));
                          return apply(r);
                        }} />
                    : <span className="fval">{pillText(p)}</span>}
                  <button className="fx" aria-label={"remove " + g.label + " " + pillText(p)}
                    onClick={() => apply({ draft: removePill(draft, g.clause, p) })}>×</button>
                </span>
              </Fragment>
            ))}
          </span>
        ))}
    </span>
  );
}
