// The cox view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { coxSvg } from "./figure.ts";

export const coxKind: ViewKindDef<"cox"> = {
  kind: "cox",
  figure: (v, o) => v.cox && (v.cox.coefficients.length || (v.cox.byCohort || []).some((c) => c.coefficients.length)) ? coxSvg(v, o) : null,
  title: (v) => "Cox regression — " + (v.endpoint || "OS"),
  text: (v, { out, pFmt, caveatOf }) => {
    // stratifyByCohort: no pooled coefficients — one independent fit per cohort instead.
    out.push(v.cox.byCohort
      ? `Cox regression (${v.endpoint || "OS"}, stratified by cohort):\n` +
        v.cox.byCohort.map((c) => c.error
          ? `  ${c.cohort}: ERROR — ${c.error}`
          : `  ${c.cohort} (n=${c.n.toLocaleString()}, ${c.events.toLocaleString()} events):\n` +
            c.coefficients.map((cf) =>
              `    ${cf.label}${cf.reference ? " vs " + cf.reference : ""}: HR ${cf.hr.toFixed(2)} ` +
              `(95% CI ${cf.ciLow.toFixed(2)}-${cf.ciHigh.toFixed(2)}) p=${pFmt(cf.p)}`).join("\n")
        ).join("\n") + caveatOf(v)
      : `Cox regression (${v.endpoint || "OS"}, n=${v.cox.n.toLocaleString()}, ${v.cox.events.toLocaleString()} events):\n` +
        v.cox.coefficients.map((c) =>
          `  ${c.label}${c.reference ? " vs " + c.reference : ""}: HR ${c.hr.toFixed(2)} ` +
          `(95% CI ${c.ciLow.toFixed(2)}-${c.ciHigh.toFixed(2)}) p=${pFmt(c.p)}`).join("\n") +
        caveatOf(v));
  },
  help: {
    title: "What is this?",
    text: "A more advanced version of the survival comparison above, which can weigh several factors at once — for example, a patient's age, a specific gene, and how far the disease had spread — to estimate how much each one changes risk on its own, holding the others equal. Each result is a \"hazard ratio\": above 1 means that factor is linked to worse outcomes, below 1 means it's linked to better ones."
  },
  need: "patients",
  isNew: true,
};
