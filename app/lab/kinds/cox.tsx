"use client";
// The cox view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import { Checkbox } from "../../_ui/checkbox";
import { Choice } from "../../_ui/choice.tsx";
import { CovariateList, placement } from "./parts.tsx";
import { Input } from "../../_ui/input";
import type { KindUi } from "./kind-ui.ts";
import { ViewFigure } from "../figure.tsx";
import { ViewHead } from "../view-chrome.tsx";
import { Waiting } from "../../_oncoprint/OncoprintCard.tsx";

function CoxCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, cat, catLoading, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, patchView, profileCatalog, trackAttrs } = ctx;
  return <>
    {v.kind === "cox" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Cox regression" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Multivariate Cox, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}</>} />
      {(() => {
        const sv: any = (doc.views || [])[vi] || {};
        const covariates: any[] = Array.isArray(sv.covariates) ? sv.covariates : [];
        const eps: string[] = (cat && cat.survivalEndpoints) || [];
        const setCovariate = (ci: number, next: any) => {
          const nc = covariates.map((c, j) => j === ci ? next : c);
          patchView(vi, { covariates: nc });
        };
        const removeCovariate = (ci: number) => patchView(vi, { covariates: covariates.filter((_, j) => j !== ci) });
        const addCovariate = () => patchView(vi, { covariates: [...covariates, { source: "clinical", attribute: (trackAttrs.attrs[0] || {}).attribute || "" }] });
        // The reference level for a categorical covariate is picked from the levels
        // this run actually observed (v.cox.coefficients), not re-derived client-side —
        // a covariate the fit dropped (only one level, or no result yet) simply gets no
        // picker rather than a guess at what the data might contain.
        const observedLevels = (ci: number): string[] => {
          // when stratified by cohort there's no single pooled coefficients array —
          // union the levels each cohort's own fit happened to observe instead
          const coefs = (v.cox && v.cox.coefficients.length) ? v.cox.coefficients
            : (v.cox?.byCohort || []).flatMap((c: any) => c.coefficients);
          const mine = coefs.filter((c: any) => c.axisIndex === ci);
          if (!mine.length) return [];
          const levels = new Set<string>();
          for (const c of mine) { if (c.reference) levels.add(c.reference); if (c.level) levels.add(c.level); }
          return [...levels];
        };
        return (
          <div className="basis wraps">
            <span className="meta">endpoint</span>
            <Choice size="ctl" value={sv.endpoint || "OS"} disabled={busy} onChange={v => patchView(vi, { endpoint: v })}
              options={(eps.length ? eps : [sv.endpoint || "OS"]).map(x => [x, x] as const)} pending={!cat ? "loading…" : undefined} />
            {catLoading && !cat && <Waiting what="endpoints" />}
            <span className="meta">cutoff</span>
            <Input type="number" min={1} placeholder="none" disabled={busy} className="h-ctl w-20 bg-card text-md md:text-md"
              value={sv.cutoffMonths ?? ""}
              onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
            <span className="meta">mo</span>
            <label className="chk" title="fit a separate baseline hazard per study instead of pooling them">
              <Checkbox checked={!!sv.stratifyByStudy} disabled={busy}
                onCheckedChange={c => patchView(vi, { stratifyByStudy: c === true || undefined })} />
              stratify by study
            </label>
            <label className="chk" title="fit each cohort as its own separate model — own coefficients, own reference levels — instead of pooling them into one fit; a no-op with only one cohort">
              <Checkbox checked={!!sv.stratifyByCohort} disabled={busy}
                onCheckedChange={c => patchView(vi, { stratifyByCohort: c === true || undefined })} />
              stratify by cohort
            </label>
            <CovariateList covariates={covariates} ratio="hazard" observedLevels={observedLevels} busy={busy}
              attrs={catalogAttrs()} catalog={profileCatalog()} loading={attrsLoading()}
              onChange={setCovariate} onRemove={removeCovariate} onAdd={addCovariate} />
          </div>
        );
      })()}
      <ViewFigure v={v} error={v.error} />
    </>}
  </>;
}

export const coxUi: KindUi<"cox"> = {
  kind: "cox",
  label: "Cox regression (forest plot)",
  category: "outcomes",
  title: "Cox regression",
  why: (_k, p) => p.noSurvivalWhy(),
  loading: (_k, p) => p.catLoading,
  defaults: (k) => ({ kind: "cox", covariates: [{ source: "alteration", gene: k.genes[0] || "TP53", by: "mutated" }] }),
  Card: CoxCard,
  drawsOwnHead: () => true,
};
