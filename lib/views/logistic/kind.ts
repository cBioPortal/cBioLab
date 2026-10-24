// The logistic view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { logisticSvg } from "./figure.ts";

export const logisticKind: ViewKindDef<"logistic"> = {
  kind: "logistic",
  figure: (v, o) => v.logistic && v.logistic.coefficients.length ? logisticSvg(v, o) : null,
  title: () => "Logistic regression",
  text: (v, { out, pFmt, caveatOf }) => {
    out.push(`Logistic regression (n=${v.logistic.n.toLocaleString()}, ${v.logistic.events.toLocaleString()} with the outcome):\n` +
      v.logistic.coefficients.map((c) =>
        `  ${c.label}${c.reference ? " vs " + c.reference : ""}: OR ${c.or.toFixed(2)} ` +
        `(95% CI ${c.ciLow.toFixed(2)}-${c.ciHigh.toFixed(2)}) p=${pFmt(c.p)}`).join("\n") +
      caveatOf(v));
  },
  help: {
    title: "What is this?",
    text: "Estimates how strongly different factors are linked to a yes-or-no outcome — for example, whether a patient responded to a treatment — while accounting for several factors together. Each result is an \"odds ratio\": above 1 means that factor makes the outcome more likely, below 1 means less likely."
  },
  need: "patients",
  isNew: true,
};
