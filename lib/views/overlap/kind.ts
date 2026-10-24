// The overlap view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { overlapSvg } from "./figure.ts";

export const overlapKind: ViewKindDef<"overlap"> = {
  kind: "overlap",
  figure: (v, o) => v.overlap && v.overlap.union > 0 ? overlapSvg(v, o) : null,
  title: () => "Cohort overlap",
  text: (v, { out, caveatOf, noteOf }) => {
    const ov = v.overlap;
    out.push(`Cohort overlap (patients in exactly these cohorts and no other):\n` +
      `  cohort sizes: ` + ov.sets.map((x) => `${x.name} ${x.size.toLocaleString()}`).join(", ") + `\n` +
      ov.intersections.map((x) => `  ${x.members.join(" ∩ ")}${x.members.length < ov.sets.length ? " only" : ""}: ${x.n.toLocaleString()}`).join("\n") +
      `\n  ${ov.union.toLocaleString()} patients in at least one cohort` + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows how the groups of patients you defined overlap: for every combination of groups, how many patients belong to exactly those groups and none of the others. Each column is one combination — the dots below it say which groups — and its bar is how many patients fall there, so you can see at a glance whether two groups are mostly the same people or nearly separate."
  },
  need: "local",
};
