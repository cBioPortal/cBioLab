"use client";
// The course view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Button } from "../../_ui/button";
import { CHIP } from "../../_ui/toolbar.ts";
import type { CardProps } from "../view-cards.tsx";
import { Choice } from "../../_ui/choice.tsx";
import { CohortPicker, DrawnCohorts, Latency, Participation, SplitByNote, ViewHelpButton, ViewMenu } from "../view-chrome.tsx";
import { GearMenu } from "../../_ui/gear-menu";
import type { KindUi } from "./kind-ui.ts";
import { MenuSeparator } from "../../_ui/gear-menu.tsx";
import { Settings2 } from "lucide-react";
import { ViewFigure } from "../figure.tsx";
import { placement } from "./parts.tsx";

function CourseCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, doc, docView, menuOpenRef, openCohortChooser, patchView, setViewCohorts, viewIds } = ctx;
  return <>
    {v.kind === "course" && !v.error && <>
      <div className="vhead">
        <h2 className="vtitle">Clinical course <span className="plain">
          — {[...new Set((v.course || []).map(c => c.eventType))].join(", ")}
          {" · "}{v.courseAxis ? v.courseAxis.binMonths + "-month bins" : ""}</span></h2>
        <div className="vmeta">
          <ViewHelpButton kind="course" menuId={"help:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} />
          <CohortPicker nodes={cohortChoice(vi, docView(vi)).nodes} chosen={cohortChoice(vi, docView(vi)).chosen} busy={busy}
            menuId={"pick:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} onAdd={() => openCohortChooser(vi)}
            onChange={(next) => setViewCohorts(vi, next, cohortChoice(vi, docView(vi)).all)} />
        <GearMenu menuId={"settings:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} wide
          label={<><Settings2 />settings</>} title="clinical course options">
          {/* Every parameter of this chart is a choice, and the defaults are only a
            guess at a good one — so all of them are settable. They live behind
            the gear rather than above the figure because they are read when
            setting a chart up and rarely after. Each event type shows the two
            structural facts that decide whether it is worth plotting: how often
            it recurs, and whether it carries a duration. */}
      {v.eventOptions && v.eventOptions.length > 0 && (() => {
        const cv: any = (doc.views || [])[vi] || {};
        const chosen: string[] = (cv.eventTypes || []).map((x: string) => String(x).trim().toLowerCase());
        const anchor = cv.anchor || null;
        const toggle = (canon: string) => {
          const next = chosen.includes(canon) ? chosen.filter(x => x !== canon) : [...chosen, canon];
          if (next.length && next.length <= 6) patchView(vi, { eventTypes: next });
        };
        return (
          <>
            <div className="setcol"><span className="meta">measuring</span><div className="flex flex-wrap gap-1">
            {v.eventOptions.map(e => (
              <Button key={e.canonical} type="button" variant="outline" size="xs" disabled={busy || (!chosen.includes(e.canonical) && chosen.length >= 6)}
                className={CHIP} aria-pressed={chosen.includes(e.canonical)}
                onClick={() => toggle(e.canonical)}
                data-tip={(!chosen.includes(e.canonical) && chosen.length >= 6 ? "a course view measures at most 6 event types — drop one first. " : "") +
                  e.patients.toLocaleString() + " patients · " + e.perPatient + " events each · " +
                  (e.hasDurations ? "carries durations, so it is drawn as a state patients are IN"
                    : e.perPatient < 1.5 ? "about one per patient and no duration — likely a filing record rather than a clinical course"
                    : "no durations, so it is drawn as an event that HAPPENED")}>
                {e.label}{e.hasDurations ? " ⏱" : ""}
              </Button>
            ))}
            </div></div>
            <MenuSeparator />
            <div className="setrow"><span className="meta">aligned on</span>
            <Choice className="flex-1" value={anchor ? String(anchor.eventType).trim().toLowerCase() : ""} disabled={busy}
              onChange={ev => patchView(vi, { anchor: ev
                ? { eventType: ev, occurrence: anchor ? anchor.occurrence || "FIRST" : "FIRST" } : null })}
              options={[["", "study day 0 (single study only)"], ...v.eventOptions.map(e => [e.canonical, e.label] as const)]} />
            {anchor && (
              <Choice className="flex-none" value={anchor.occurrence || "FIRST"} disabled={busy}
                onChange={o => patchView(vi, { anchor: { ...anchor, occurrence: o } })} options={[["FIRST", "first"], ["LAST", "last"]]} />
            )}
            </div>
            <div className="setrow"><span className="meta">bins</span>
            <Choice className="flex-1" value={String(v.courseAxis ? v.courseAxis.binMonths : 3)} disabled={busy}
              onChange={b => patchView(vi, { binMonths: Number(b) })}
              options={[1, 3, 6, 12].map(b => [String(b), b + " month" + (b === 1 ? "" : "s")] as const)} />
            </div>
            <div className="setrow"><span className="meta">window</span>
            <Choice className="flex-1" value={String(v.courseAxis ? v.courseAxis.from : -12)} disabled={busy}
              onChange={f => patchView(vi, { fromMonths: Number(f) })}
              options={[0, -6, -12, -24, -60].map(f => [String(f), f === 0 ? "the anchor" : f + "mo"] as const)} />
            <span className="meta min-w-0">to</span>
            <Choice className="flex-1" value={String(v.courseAxis ? v.courseAxis.to : 60)} disabled={busy}
              onChange={t => patchView(vi, { toMonths: Number(t) })}
              options={[12, 24, 60, 120, 240].map(t => [String(t), "+" + t + "mo"] as const)} />
            </div>
          </>
        );
      })()}
        </GearMenu>
        <Latency v={v} /><Participation p={v.participation} />
        <ViewMenu menuId={"reorder:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} {...placement(ctx, vi)} hasNote={!!v.annotationNote} />
        </div>
        </div>
      <DrawnCohorts drawn={cohortChoice(vi, docView(vi)).drawn} nodes={cohortChoice(vi, docView(vi)).nodes} />
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
      <SplitByNote v={v} />
      <ViewFigure v={v} />
    </>}
  </>;
}

export const courseUi: KindUi<"course"> = {
  kind: "course",
  label: "Clinical course",
  category: "treatment",
  title: "Clinical course",
  why: (k) => k.events.length ? null
    : "this study records no timeline events (only 131 of 545 studies have any)",
  loading: (k, p) => !k.events.length && (p.catLoading || p.exploreBusy),
  defaults: (k) => {
    const evs = k.events;
    // Rank by STRUCTURE, not by how common the type is. Picking the two
    // commonest gives Sequencing and Sample acquisition on MSK-CHORD —
    // exactly one event per patient and no duration, i.e. filing records
    // that draw a spike and nothing else. A type that carries durations is
    // a state worth plotting; one that recurs is an event worth counting;
    // one that happens once per patient is neither.
    const tier = (e: any) => e.hasDurations ? 2 : (e.perPatient || 0) >= 1.5 ? 1 : 0;
    const ranked = [...evs].sort((a, b) => tier(b) - tier(a) || b.n - a.n);
    // The anchor wants the opposite property: a landmark nearly everyone
    // has. A therapy start is the classic one; failing that, the most
    // universal event.
    const anchorOn = evs.find(e => e.hasDurations)
      || [...evs].sort((a, b) => b.n - a.n)[0];
    return { kind: "course", eventTypes: ranked.slice(0, 2).map(e => e.canonical),
             ...(anchorOn ? { anchor: { eventType: anchorOn.label, occurrence: "FIRST" } } : {}),
             binMonths: 3, fromMonths: -12, toMonths: 60 };
  },
  Card: CourseCard,
  drawsOwnHead: (v) => !!v.svg,
};
