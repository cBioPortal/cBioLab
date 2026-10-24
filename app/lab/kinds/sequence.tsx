"use client";
// The sequence view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import { Choice } from "../../_ui/choice.tsx";
import { CohortPicker, DrawnCohorts, Latency, Participation, SplitByNote, ViewHelpButton, ViewMenu } from "../view-chrome.tsx";
import { GearMenu } from "../../_ui/gear-menu";
import type { KindUi } from "./kind-ui.ts";
import { Settings2 } from "lucide-react";
import { ViewFigure } from "../figure.tsx";
import { placement } from "./parts.tsx";
import { treatmentEventOf } from "../../../lib/event-names.ts";

function SequenceKeyHint({ ctx, v, vi }: CardProps) {
  const { busy, patchView } = ctx;
  return <>
    {v.kind === "sequence" && v.error && v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
      <div className="basis">
        <span className="meta">label lines by</span>
        <Choice size="ctl" value={v.sequence.labelKey} disabled={busy} onChange={k => patchView(vi, { labelKey: k })}
          options={v.sequence.keyOptions.map(k => [k.label, k.label + " — " + k.values + " value" + (k.values === 1 ? "" : "s")] as const)} />
      </div>
    )}
  </>;
}

function SequenceCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openCohortChooser, patchView, setViewCohorts, viewIds } = ctx;
  return <>
    {v.kind === "sequence" && !v.error && <>
      <div className="vhead">
        <h2 className="vtitle">Treatment sequence <span className="plain">
          — lines of therapy by {v.sequence ? v.sequence.labelKey : ""}
          {v.sequence ? " · " + v.sequence.lineGap + "-day line gap" : ""}</span></h2>
        <div className="vmeta">
          <ViewHelpButton kind="sequence" menuId={"help:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} />
          <CohortPicker nodes={cohortChoice(vi, docView(vi)).nodes} chosen={cohortChoice(vi, docView(vi)).chosen} max={1} busy={busy}
            menuId={"pick:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} onAdd={() => openCohortChooser(vi)}
            onChange={(next) => setViewCohorts(vi, next, cohortChoice(vi, docView(vi)).all)} />
        {v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
          <GearMenu menuId={"settings:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} wide
            label={<><Settings2 />settings</>} title="treatment sequence options">
            {/* Label granularity is the choice that most changes this chart, and
                the keys are not interchangeable: in MSK-CHORD SUBTYPE has 10
                values, AGENT hundreds, TREATMENT_TYPE exactly one. So each option
                carries its value count rather than leaving the reader to discover
                a useless key by picking it. */}
              <div className="setrow">
                <span className="meta">label lines by</span>
                <Choice className="flex-1" value={v.sequence.labelKey} disabled={busy} onChange={k => patchView(vi, { labelKey: k })}
                  options={v.sequence.keyOptions.map(k => [k.label, k.label + " — " + k.values + " value" + (k.values === 1 ? "" : "s") +
                    (k.values === 1 ? " (unusable)" : k.values > 60 ? " (very granular)" : "")] as const)} />
              </div>
              <div className="setrow">
                <span className="meta">new line after</span>
                <Choice className="flex-1" value={String(v.sequence.lineGap)} disabled={busy} onChange={g => patchView(vi, { lineGap: Number(g) })}
                  options={[30, 60, 90, 120, 180].map(g => [String(g), g + " days"] as const)} />
              </div>
              <div className="setrow">
                <span className="meta">lines shown</span>
                <Choice className="flex-1" value={String(v.sequence.steps)} disabled={busy} onChange={m => patchView(vi, { maxSteps: Number(m) })}
                  options={[2, 3, 4, 5].map(m => [String(m), String(m)] as const)} />
              </div>
          </GearMenu>
        )}
        <Latency v={v} /><Participation p={v.participation} />
        <ViewMenu menuId={"reorder:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} {...placement(ctx, vi)} hasNote={!!v.annotationNote} />
        </div>
      </div>
      <DrawnCohorts drawn={cohortChoice(vi, docView(vi), 1).drawn} nodes={cohortChoice(vi, docView(vi), 1).nodes} />
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
      <SplitByNote v={v} />
      <ViewFigure v={v} />
    </>}
  </>;
}

/** the sequence view's card: the key's hint over its own card */
function Card(p: CardProps) {
  return <><SequenceKeyHint {...p} /><SequenceCard {...p} /></>;
}

export const sequenceUi: KindUi<"sequence"> = {
  kind: "sequence",
  label: "Treatment sequence",
  category: "treatment",
  title: "Treatment sequence",
  maxCohorts: 1,
  why: (k) => treatmentEventOf(k.events) ? null
    : "this study records no treatment events, so there are no lines of therapy to sequence",
  loading: (k, p) => !k.events.length && (p.catLoading || p.exploreBusy),
  defaults: (k) => {
    const tx = treatmentEventOf(k.events);
    return { kind: "sequence", ...(tx ? { eventType: tx.canonical } : {}), labelKey: "SUBTYPE",
             lineGap: 90, maxSteps: 3, topN: 8 };
  },
  Card,
  drawsOwnHead: (v) => !!v.svg,
};
