"use client";
// Explore's filter bar, laid out as the Study View's (lib/study-view-pills.ts): "<chart> : a or b",
// numeric intervals with editable ends; clauses of no clinical chart drawn as the generic pills.
import { Fragment, useEffect, useState } from "react";
import type { CohortDef } from "../../lib/types.ts";
import { editInterval, filterGroups, geneTablePills, intervalEnds, intervalText, removeOqlLine, joinedByAnd, removePill, type Interval, type SvPill } from "../../lib/study-view-pills.ts";
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
  type ChartGroup = Extract<ReturnType<typeof filterGroups>[number], { kind: "chart" }>;
  /** a clinical chart's pills: "<chart> : a or b" */
  const chart = (g: ChartGroup) => (
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
  );
  /** any other clause: a gene table's selection as the portal draws it, a pill per gene coloured by alteration (STV-FB-3 #9); else the generic pill */
  const other = (clause: number) => {
    const genes = geneTablePills(draft.all![clause]);
    if (!genes) return <ClausePill key={clause} portal clause={draft.all![clause]} onRemove={() => onRemoveClause(clause)} onCustomData={onCustomData} />;
    return (
      <span key={clause} className="fgroup" data-gene-pills>
        {genes.length > 1 && <span className="fconn">(</span>}
        {genes.map((p, k) => (
          <Fragment key={p.line}>
            {k > 0 && <span className="fconn">or</span>}
            <span className="fpill" style={{ borderLeftColor: p.color }} data-tip={p.line}>
              <span className="fval">{p.gene}</span>
              <button className="fx" aria-label={"remove " + p.line} onClick={() => apply({ draft: removeOqlLine(draft, clause, p.line) })}>×</button>
            </span>
          </Fragment>
        ))}
        {genes.length > 1 && <span className="fconn">)</span>}
      </span>
    );
  };
  // two groups in a row from one chart are joined by "and" (STV-FB-2)
  const groups = filterGroups(draft, labelOf), and = joinedByAnd(draft, groups);
  // a density drag's ranges have no pill (STV-FB-3b): its chart shows them and resets them
  return <span className="svpills">{groups.map((g, i) => g.kind === "hidden" ? null : g.kind === "other"
    ? <Fragment key={g.clause}>{and[i] && <span className="svop">and</span>}{other(g.clause)}</Fragment>
    : chart(g))}</span>;
}
