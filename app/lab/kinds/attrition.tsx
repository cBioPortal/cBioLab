"use client";
// The attrition view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindUi } from "./kind-ui.ts";

export const attritionUi: KindUi<"attrition"> = {
  kind: "attrition",
  label: "Cohort attrition (CONSORT)",
  category: "overview",
  title: "Cohort attrition",
  maxCohorts: 6,
  sub: () => "patients left after each clause, in order",
};
