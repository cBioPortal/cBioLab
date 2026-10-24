// The survival view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { survivalSvg } from "./figure.ts";

export const survivalKind: ViewKindDef<"survival"> = {
  kind: "survival",
  figure: (v, o) => v.curves && v.curves.length ? survivalSvg(v, o) : null,
  title: (v) => (v.endpoint || "OS") + " survival" + (v.anchoredTo ? " from " + v.anchoredTo : ""),
  text: (v, { out, pFmt }) => {
    out.push(`Survival (KM, ${v.endpoint || "OS"}${v.anchoredTo ? " from " + v.anchoredTo : ""}):\n` + v.curves.map((c) =>
      `  ${c.cohort}: median ${c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n=${c.n}, ${c.events} events${c.missing ? ", " + c.missing + " missing OS" : ""}${c.unobserved ? ", " + c.unobserved + " with no follow-up after entry left out" : ""})`).join("\n") +
      (v.logrank ? `\n  log-rank p=${pFmt(v.logrank.p)}${v.logrank.strata > 1 ? " (stratified by study)" : ""}`
        : v.logrankK ? `\n  k-group log-rank p=${pFmt(v.logrankK.p)}` : "") +
      "\nCAVEAT (tell the user): " + v.caveat);
  },
  help: {
    title: "What is this?",
    text: "Shows what share of patients in each group were still alive (or still free of disease progression) at each point in time, drawn as a curve that steps downward every time a patient's outcome is recorded. Comparing the curves for two or more groups answers: did one group tend to do better than the other, and if so, is the difference too large to be chance?"
  },
};
