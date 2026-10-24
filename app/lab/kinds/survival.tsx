"use client";
// The survival view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import { Choice } from "../../_ui/choice.tsx";
import { Input } from "../../_ui/input";
import type { KindUi } from "./kind-ui.ts";
import { ViewFigure } from "../figure.tsx";
import { ViewHead } from "../view-chrome.tsx";
import { Waiting } from "../../_oncoprint/OncoprintCard.tsx";
import { placement } from "./parts.tsx";

function SurvivalCard({ ctx, v, vi }: CardProps) {
  const { busy, cat, catLoading, cohortChoice, doc, docView, menuOpenRef, patchView } = ctx;
  return <>
    {v.kind === "survival" && v.curves && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Survival" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Kaplan–Meier, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}{v.anchoredTo && <> — from {v.anchoredTo}</>}</>}
        chips={v.truncated ? <span className="trunc" title={
          "Delayed entry is applied: a patient joins the risk set when the study could first observe them, not at the anchor." +
          (v.entryMonths ? "\n\nMedian " + v.entryMonths.median + " months from anchor to entry; 90th percentile "
            + v.entryMonths.p90 + "; longest " + v.entryMonths.max + "." : "")}>left-truncated</span> : null} />
      {(() => {
        // The basis of a survival analysis — which endpoint, and what
        // the clock starts from — is the thing people most want to
        // change, so it is a control rather than a JSON edit.
        const sv: any = (doc.views || [])[vi] || {};
        const a = sv.anchor || null;
        const eps: string[] = (cat && cat.survivalEndpoints) || [];
        const types: string[] = ((cat && cat.types) || []).map((t: any) => t.t);
        const keys: string[] = (cat && a && cat.keys && cat.keys[a.eventType]) || [];
        const vals: string[] = (cat && a && a.key && cat.values && cat.values[a.eventType]
          && cat.values[a.eventType][a.key]) || [];
        return (
          <div className="basis">
            <span className="meta">endpoint</span>
            <Choice size="ctl" value={sv.endpoint || "OS"} disabled={busy} onChange={v => patchView(vi, { endpoint: v })}
              options={(eps.length ? eps : [sv.endpoint || "OS"]).map(x => [x, x] as const)} pending={!cat ? "loading…" : undefined} />
            {catLoading && !cat && <Waiting what="endpoints" />}
            <span className="meta">measured from</span>
            <Choice size="ctl" value={a ? a.eventType : ""} disabled={busy}
              onChange={v => patchView(vi, { anchor: v ? { eventType: v, occurrence: "FIRST" } : null })}
              options={[["", "study baseline (day 0)"], ...types.map(t => [t, t] as const)]}
              pending={!cat ? "loading this study's events…" : undefined} />
            {a && <>
              <Choice size="ctl" value={a.occurrence || "FIRST"} disabled={busy}
                onChange={v => patchView(vi, { anchor: { ...a, occurrence: v } })} options={[["FIRST", "first"], ["LAST", "last"]]} />
              <span className="meta">where</span>
              <Choice size="ctl" value={a.key || ""} disabled={busy}
                onChange={v => patchView(vi, { anchor: v
                  ? { ...a, key: v, value: (cat.values[a.eventType] || {})[v]?.[0] ?? "" }
                  : { eventType: a.eventType, occurrence: a.occurrence || "FIRST" } })}
                options={[["", "(any)"], ...keys.map(k => [k, k] as const)]} />
              {a.key && (
                <Choice size="ctl" value={a.value ?? ""} disabled={busy}
                  onChange={v => patchView(vi, { anchor: { ...a, value: v } })} options={vals.map(x => [x, x] as const)} />
              )}
            </>}
            <span className="meta">display</span>
            <Choice size="ctl" value={sv.display === "incidence" ? "incidence" : "survival"} disabled={busy}
              onChange={v => patchView(vi, { display: v === "incidence" ? "incidence" : undefined })}
              options={[["survival", "survival"], ["incidence", "cumulative incidence"]]} />
            <span className="meta">ticks</span>
            <Choice size="ctl" value={String(sv.tickMonths || "")} disabled={busy}
              onChange={v => patchView(vi, { tickMonths: v ? Number(v) : undefined })}
              options={[["", "auto"], ...[6, 12, 24, 60].map(m => [String(m), m + "mo"] as const)]} />
            <span className="meta">cutoff</span>
            <Input type="number" min={1} placeholder="none" disabled={busy} className="h-ctl w-20 bg-card text-md md:text-md"
              value={sv.cutoffMonths ?? ""}
              onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
            <span className="meta">mo</span>
          </div>
        );
      })()}
      <ViewFigure v={v} error={v.error} />
    </>}
  </>;
}

export const survivalUi: KindUi<"survival"> = {
  kind: "survival",
  label: "Survival",
  category: "outcomes",
  title: "Survival",
  why: (_k, p) => p.noSurvivalWhy(),
  loading: (_k, p) => p.catLoading,
  defaults: () => ({ kind: "survival" }),
  Card: SurvivalCard,
  drawsOwnHead: (v) => !!v.curves,
};
