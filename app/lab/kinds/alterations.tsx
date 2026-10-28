"use client";
// The alterations view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AlterationsBody } from "../alterations-body";
import type { KindUi } from "./kind-ui.ts";

export const alterationsUi: KindUi<"alterations"> = {
  kind: "alterations",
  label: "Patient alterations (mutations, copy number, SVs; one patient at a time)",
  category: "patient",
  title: "Patient alterations",
  maxCohorts: 1,
  cohortInHeader: true,
  sub: (_spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.alterations ? v.alterations.total.toLocaleString() + " patients · " : ""}mutations, copy-number alterations and structural variants</>;
  },
  body: (c) => c.v.alterations ? <AlterationsBody a={c.v.alterations} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} fixed={c.fixedPatient} /> : null,
  drawsOwnWaiting: true,
};
