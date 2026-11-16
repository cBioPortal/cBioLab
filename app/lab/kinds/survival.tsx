"use client";
// The survival view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import { Choice } from "../../_ui/choice.tsx";
import { EndpointChoice } from "../outcome-choice.tsx";
import { Input } from "../../_ui/input";
import type { KindUi } from "./kind-ui.ts";
import { ViewFigure } from "../figure.tsx";
import { ViewHead } from "../view-chrome.tsx";
import { Waiting } from "../../_oncoprint/OncoprintCard.tsx";
import { placement } from "./parts.tsx";
import { useState } from "react";
import { type Col, PortalTable } from "../portal-bodies.tsx";
import { fmtInt, portalPMin } from "../../../lib/chart/format.ts";
import type { SurvivalType } from "../../../lib/views/survival/types.ts";
import type { DrawnResultOf } from "../../../lib/types.ts";

/** the portal's default Min. # Patients per Group (its survival_min_group_threshold) */
const MIN_GROUP_DEFAULT = 3;

/**
 * The Comparison page's Survival tab, as the portal's: the survival-type table (when the study has
 * more than one endpoint) beside the curves; a row picks the endpoint drawn. "Min. # Patients per
 * Group" hides the types where a group has fewer, as the portal's slider does; it is this browser's.
 */
function SurvivalTypesBody({ v, spec, patch, busy }: { v: DrawnResultOf<"survival">; spec: { endpoint?: string }; patch: (p: Record<string, unknown>) => void; busy: boolean }) {
  const types = v.types || [];
  const smallest = (t: SurvivalType) => Math.min(...t.groups.map((g) => g.n));
  const [min, setMin] = useState(MIN_GROUP_DEFAULT);
  const drawn = String(spec.endpoint || v.endpoint || "OS").toUpperCase();
  const shown = types.filter((t) => smallest(t) >= min);
  const cols: Col<SurvivalType>[] = [
    { key: "title", label: "Survival Type", value: (t) => t.title, render: (t) => <span data-tip={t.endpoint + "_MONTHS / " + t.endpoint + "_STATUS"}>{t.title}</span> },
    { key: "n", label: "Number of Patients", num: true, value: (t) => t.patients, render: (t) => fmtInt(t.patients) },
    { key: "p", label: "p-Value", num: true, value: (t) => t.p ?? null, render: (t) => t.p != null ? portalPMin(t.p) : <span className="muted" data-tip={t.why}>N/A</span>,
      title: "Derived from Log Rank test." },
    { key: "q", label: "q-Value", num: true, value: (t) => t.q ?? null, render: (t) => t.q != null ? portalPMin(t.q) : <span className="muted">N/A</span>,
      title: "Derived from Benjamini-Hochberg FDR correction procedure." },
  ];
  const pick = (t: SurvivalType) => { if (!busy && t.endpoint !== drawn) patch({ endpoint: t.endpoint === "OS" ? undefined : t.endpoint }); };
  const lo = types.length ? Math.min(...types.map(smallest)) : 0, hi = types.length ? Math.max(...types.map(smallest)) : 0;
  return (
    <div className="pb" data-test="survival-types">
      <div className="pb-row">
        {types.length > 1 && <div className="max-w-[475px]">
          <PortalTable rows={shown} cols={cols} initialSort={{ key: "p" }} pageSize={15} search={(t) => t.title + " " + t.endpoint}
            selected={shown.find((t) => t.endpoint === drawn) || null} onSelect={pick}
            bar={<label className="chk">Min. # Patients per Group:
              <Input type="number" min={lo} max={Math.max(lo, hi)} value={min} aria-label="Min. # Patients per Group" className="h-ctl w-16 bg-card text-md md:text-md"
                onChange={(e) => setMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>} />
          {types.length > 0 && !shown.length && <p className="note">The current <b>Min. # Patients per Group</b> is <b>{min}</b>. Adjust the filter to see comparisons for groups with fewer patients.</p>}
        </div>}
        <div className="pb-plot min-w-0 flex-1">
          {types.length > 1 && <h4 className="text-lg font-semibold">{types.find((t) => t.endpoint === drawn)?.title || drawn}</h4>}
          {/* the page writes the caveat under the card */}
          <ViewFigure v={{ ...v, caveat: undefined }} />
        </div>
      </div>
    </div>
  );
}

function SurvivalCard({ ctx, v, vi }: CardProps) {
  const { busy, cat, catLoading, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, patchView } = ctx;
  return <>
    {v.kind === "survival" && (v.curves || v.error) && <>
      {v.curves && <ViewHead menuStore={menuOpenRef.current} v={v} title="Survival" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Kaplan–Meier, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}{v.anchoredTo && <> — from {v.anchoredTo}</>}</>}
        chips={v.truncated ? <span className="trunc" data-tip={
          "Delayed entry is applied: a patient joins the risk set when the study could first observe them, not at the anchor." +
          (v.entryMonths ? "\n\nMedian " + v.entryMonths.median + " months from anchor to entry; 90th percentile "
            + v.entryMonths.p90 + "; longest " + v.entryMonths.max + "." : "")}>left-truncated</span> : null} />}
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
            <EndpointChoice spec={sv} endpoints={eps} attrs={catalogAttrs()} busy={busy} pending={!cat ? "loading…" : undefined}
              onPatch={(p) => patchView(vi, p)} />
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
      {v.curves && <ViewFigure v={v} error={v.error} />}
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
  // on a portal page, which draws no card of a kind's own: the survival-type table beside the curves
  body: (c) => c.v.curves && c.v.types ? <SurvivalTypesBody v={c.v} spec={c.spec} patch={c.patch} busy={c.busy} /> : null,
  drawsOwnHead: (v) => !!v.curves,
};
