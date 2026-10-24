"use client";
// The logistic view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AxisPicker, ViewHead } from "../view-chrome.tsx";
import type { CardProps } from "../view-cards.tsx";
import { CovariateList, placement } from "./parts.tsx";
import { Input } from "../../_ui/input";
import type { KindUi } from "./kind-ui.ts";
import { ViewFigure } from "../figure.tsx";

function LogisticCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, patchView, profileCatalog, trackAttrs } = ctx;
  return <>
    {v.kind === "logistic" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Logistic regression" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Multivariate logistic, odds ratios</>} />
      {(() => {
        const sv: any = (doc.views || [])[vi] || {};
        const covariates: any[] = Array.isArray(sv.covariates) ? sv.covariates : [];
        const setCovariate = (ci: number, next: any) => {
          const nc = covariates.map((c, j) => j === ci ? next : c);
          patchView(vi, { covariates: nc });
        };
        const removeCovariate = (ci: number) => patchView(vi, { covariates: covariates.filter((_, j) => j !== ci) });
        const addCovariate = () => patchView(vi, { covariates: [...covariates, { source: "clinical", attribute: (trackAttrs.attrs[0] || {}).attribute || "" }] });
        // Same idea as the Cox picker's observedLevels, but there's only ever one
        // pooled fit here (logistic has no stratifyByCohort yet).
        const observedLevels = (ci: number): string[] => {
          const coefs = (v.logistic && v.logistic.coefficients) || [];
          const mine = coefs.filter((c: any) => c.axisIndex === ci);
          if (!mine.length) return [];
          const levels = new Set<string>();
          for (const c of mine) { if (c.reference) levels.add(c.reference); if (c.level) levels.add(c.level); }
          return [...levels];
        };
        // The outcome's own observed levels, for the outcomeEvent picker: the
        // currently-chosen event (if the fit succeeded) plus whatever got collapsed
        // into "not event" (outcomeOther) — together, everything this run has seen.
        const outcomeLevels = [...new Set([
          ...(sv.outcomeEvent ? [String(sv.outcomeEvent)] : []),
          ...((v.logistic && v.logistic.outcomeOther) || [])
        ])];
        const outcomeIsAlteration = sv.outcome?.source === "alteration";
        return (
          <div className="basis wraps">
            <span className="meta">outcome</span>
            <AxisPicker side="outcome" axis={sv.outcome || { source: "clinical", attribute: "" }} attrs={catalogAttrs()}
              catalog={profileCatalog()} loading={attrsLoading()} busy={busy}
              onChange={(next) => patchView(vi, { outcome: next })} />
            {!outcomeIsAlteration && <label className="tbfield" title="which observed value of the outcome counts as the event (1); every other observed value is treated as 'not event' and disclosed in the caveat. Required for a categorical outcome; not used for a numeric one, which must already be coded 0/1">
              event <Input type="text" list={"outcome-levels-" + vi} disabled={busy} className="h-ctl w-36 bg-card text-md md:text-md"
                placeholder="e.g. Responder" value={sv.outcomeEvent || ""}
                onChange={e => patchView(vi, { outcomeEvent: e.target.value || undefined })} />
              <datalist id={"outcome-levels-" + vi}>
                {outcomeLevels.map(l => <option key={l} value={l} />)}
              </datalist>
            </label>}
            <CovariateList covariates={covariates} ratio="odds" observedLevels={observedLevels} busy={busy}
              attrs={catalogAttrs()} catalog={profileCatalog()} loading={attrsLoading()}
              onChange={setCovariate} onRemove={removeCovariate} onAdd={addCovariate} />
          </div>
        );
      })()}
      <ViewFigure v={v} error={v.error} />
    </>}
  </>;
}

export const logisticUi: KindUi<"logistic"> = {
  kind: "logistic",
  label: "Logistic regression (odds ratios)",
  title: "Logistic regression",
  defaults: (k, p) => ({ kind: "logistic",
    outcome: { source: "alteration", gene: k.genes[0] || "TP53", by: "mutated" }, outcomeEvent: "Mutated",
    covariates: [{ source: "clinical", attribute: p.viewAttrs()[0] || "SEX" }] }),
  Card: LogisticCard,
  drawsOwnHead: () => true,
};
