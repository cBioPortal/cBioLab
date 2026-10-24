"use client";
// The timeline view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindUi } from "./kind-ui.ts";
import { TimelineBody } from "../timeline-body";

export const timelineUi: KindUi<"timeline"> = {
  kind: "timeline",
  label: "Patient timeline (one patient at a time)",
  category: "patient",
  title: "Patient timeline",
  maxCohorts: 1,
  cohortInHeader: true,
  why: (k) => k.events.length ? null : "this study records no timeline events",
  sub: (_spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.timeline ? v.timeline.total.toLocaleString() + " patients · " : ""}clinical events from diagnosis</>;
  },
  body: (c) => c.v.timeline ? <TimelineBody t={c.v.timeline} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} /> : null,
  drawsOwnWaiting: true,
};
