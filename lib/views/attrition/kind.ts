// The attrition view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { attritionSvg } from "./figure.ts";

export const attritionKind: ViewKindDef<"attrition"> = {
  kind: "attrition",
  figure: (v, o) => v.attrition && v.attrition.length ? attritionSvg(v, o) : null,
  title: () => "Cohort attrition",
  text: (v, { out, caveatOf, noteOf }) => {
    out.push("Cohort attrition (patients left after each clause, in order):\n" + v.attrition.map((pn) =>
      `  ${pn.cohort}: study base ${pn.base.toLocaleString()}\n` +
      pn.steps.map((st) => `    → ${st.label}: ${st.n.toLocaleString()} (−${st.excluded.toLocaleString()})`).join("\n")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows how each group of patients was narrowed down, one criterion at a time: how many patients the study started with, how many were left after each rule in the group's definition, and how many each rule removed. It lets a reader see who was left out before trusting any result drawn from the patients who remain."
  },
  isNew: true,
};
