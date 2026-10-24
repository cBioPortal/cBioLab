"use client";
// The oncoprint view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { OncoprintCard } from "../../_oncoprint/OncoprintCard.tsx";
import { ViewHead } from "../view-chrome.tsx";
import { placement } from "./parts.tsx";

function OncoprintViewCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, cohortFromSelection, contracts, doc, docView, featureFromSelection, menuOpenRef, ocView, openGenes, result, setContracts, trackAttrs, trackAttrsLoading, updateView, updateViewLocal } = ctx;
  return <>
    {v.kind === "oncoprint" && v.spec && (() => {
      const c = contracts[JSON.stringify(v.spec)];
      const vNames = v.cohorts || ocView(vi).cohorts || Object.keys(result.cohorts);
      const vStudies = [...new Set(vNames.flatMap(n => (result.cohorts[n] && result.cohorts[n].studies) || []))];
      return <>
        <ViewHead menuStore={menuOpenRef.current} v={{ ...v, ms: c ? c.stats.ms : v.ms }} title="Oncoprint" {...placement(ctx, vi)}
          cohorts={cohortChoice(vi, docView(vi), 4)}
          sub={c ? <>{c.stats.nColumns.toLocaleString()} {c.unit}s · {c.conventions.annotation}</> : "loading…"} />
        <OncoprintCard
          view={ocView(vi) as any}
          spec={v.spec}
          uploads={doc.uploads}
          onSaveFeature={(sel, all) => featureFromSelection(sel, all, (c ? c.studies : vStudies) || vStudies)}
          busy={busy}
          cohortNames={Object.keys(result.cohorts)}
          catalog={{ attrs: trackAttrs.attrs, profiles: trackAttrs.profiles, loading: trackAttrsLoading }}
          onView={(next, rerun) => rerun ? updateView(vi, () => next) : updateViewLocal(vi, () => next)}
          onGenes={() => openGenes(vi)}
          onCreateCohort={(sel) => cohortFromSelection(sel, (c ? c.studies : vStudies) || vStudies)}
          onContract={(ct) => { const k = JSON.stringify(v.spec); setContracts((m) => m[k] === ct ? m : { ...m, [k]: ct }); }}
          contract={c || null}
          note={v.note} studies={v.studies}
          onUndo={ctx.docHistory.canUndo ? ctx.docHistory.undo : undefined}
        />
      </>;
    })()}
  </>;
}

export const oncoprintUi: KindUi<"oncoprint"> = {
  kind: "oncoprint",
  label: "Oncoprint",
  category: "alterations",
  title: "Oncoprint",
  maxCohorts: 4,
  defaults: (k) => ({ kind: "oncoprint", genes: k.genes.slice(0, 5) }),
  Card: OncoprintViewCard,
  drawsOwnHead: (v) => !!v.spec,
};
