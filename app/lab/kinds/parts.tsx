"use client";
// What several view kinds' cards share (app/lab/kinds/<kind>.tsx): the text field, the header's placement
// controls, a regression's covariate list, a table's p-value cell.
import { AxisPicker } from "../view-chrome.tsx";
import { Button } from "../../_ui/button";
import { Choice } from "../../_ui/choice.tsx";
import { FIELD, TB } from "../../_ui/toolbar.ts";
import { Input } from "../../_ui/input";
import { Plus, X } from "lucide-react";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";
import type { ViewCtx } from "../view-cards.tsx";
import { cn } from "../../../lib/cn";
import { pDigits } from "../../../lib/chart/format.ts";
import { useEffect, useState } from "react";

/**
 * A text field that keeps what is being typed to itself and hands the page the value only on
 * Enter or blur — the page is one large component, and a keystroke in page state re-renders
 * every card.
 */
export function DraftInput({ value, onCommit, disabled, width, placeholder, title }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; width?: string; placeholder?: string; title?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return <Input type="text" value={draft} disabled={disabled} placeholder={placeholder} data-tip={title} aria-label={title} className={FIELD} style={{ width: width || "8rem" }}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

export const PAIRED_DEFAULT_GENES = ["TP53", "KRAS", "PIK3CA", "ESR1", "AR", "CDKN2A", "MYC", "TERT"];

/** a p- or q-value for a table cell, where the column header already says "p" (lib/chart/format.ts) */
export const pCell = pDigits;

/** A card header's reorder and remove controls, and its note's when the analysis is saved. */
export function placement({ result, moveView, removeView, noteEdit }: ViewCtx, vi: number, note = true) {
  return {
    onMoveUp: vi > 0 ? () => moveView(vi, -1) : undefined,
    onMoveDown: vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined,
    onRemove: () => removeView(vi),
    ...(note ? { onEditNote: noteEdit(vi) } : {}),
  };
}

/** A regression view's covariates: each an axis, with the reference level its ratio is measured
 *  against once the fit has seen more than one level. */
export function CovariateList({ covariates, ratio, observedLevels, busy, attrs, catalog, loading, onChange, onRemove, onAdd }: {
  covariates: any[]; ratio: "hazard" | "odds"; observedLevels: (ci: number) => string[]; busy: boolean;
  attrs: { attribute: string; kind: string }[]; catalog: ProfileInfo[]; loading: boolean;
  onChange: (ci: number, next: any) => void; onRemove: (ci: number) => void; onAdd: () => void;
}) {
  return (
    <div className="covlist">
      {covariates.map((c, ci) => {
        const levels = observedLevels(ci);
        return (
          <span key={ci} className="covrow">
            <AxisPicker side={"covariate " + (ci + 1)} axis={c} attrs={attrs}
              catalog={catalog} loading={loading} busy={busy}
              onChange={(next) => onChange(ci, next)} />
            {levels.length > 1 && <label className="tbfield" data-tip={(ratio === "hazard" ? "the level a hazard ratio" : "the level an odds ratio") + " is measured against; unset uses this covariate's default (mutated/not always compares against 'Not mutated', other categoricals use whichever level is most frequent)"}>
              ref <Choice size="ctl" value={c.reference && levels.includes(c.reference) ? c.reference : ""} disabled={busy}
                onChange={v => onChange(ci, { ...c, reference: v || undefined })}
                options={[["", "(default)"], ...levels.map(l => [l, l] as const)]} />
            </label>}
            <Button type="button" variant="outline" size="sm" className={TB} disabled={busy} data-tip="remove this covariate"
              onClick={() => onRemove(ci)}><X />remove</Button>
          </span>
        );
      })}
      <Button type="button" variant="outline" size="sm" className={cn(TB, "covadd")} disabled={busy} onClick={onAdd}><Plus />add covariate</Button>
    </div>
  );
}
