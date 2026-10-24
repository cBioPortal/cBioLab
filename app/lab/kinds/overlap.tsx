"use client";
// The overlap view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindUi } from "./kind-ui.ts";

export const overlapUi: KindUi<"overlap"> = {
  kind: "overlap",
  label: "Cohort overlap (UpSet)",
  title: "Cohort overlap",
  maxCohorts: 6,
  minCohorts: 2,
  sub: () => "patients in exactly each combination of cohorts",
};
