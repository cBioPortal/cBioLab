// The forest view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { metaForestSvg } from "./figure.ts";

export const forestKind: ViewKindDef<"forest"> = {
  kind: "forest",
  figure: (v, o) => v.forest.rows.length ? metaForestSvg(v, o) : null,
  title: (v) => "Forest plot" + (v.forest ? " — " + v.forest.exposedLabel + " by " + v.forest.strata + ", " + v.forest.endpoint : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const f = v.forest, hr = (x: { hr: number; ciLow: number; ciHigh: number; p: number }) =>
      `HR ${x.hr.toFixed(2)} (95% CI ${x.ciLow.toFixed(2)}-${x.ciHigh.toFixed(2)}) p=${pFmt(x.p)}`;
    out.push(`Forest plot: ${f.endpoint} hazard ratio for ${f.exposedLabel} by ${f.strata}` + (f.covariates.length ? `, adjusted for ${f.covariates.join(", ")}` : "") +
      ` (n=${f.n.toLocaleString()}, ${f.events.toLocaleString()} events):\n` +
      f.rows.map((r) => `  ${r.label} (n=${r.n.toLocaleString()}, ${r.events} events, ${r.exposed} exposed): ${hr(r)}${f.random ? `, weight ${(100 * r.weight).toFixed(1)}%` : ""}`).join("\n") +
      (f.random && f.fixed ? `\n  pooled, random effects (DerSimonian–Laird): ${hr(f.random)}\n  pooled, fixed effect: ${hr(f.fixed)}` +
        `\n  heterogeneity: tau²=${f.tau2.toFixed(3)}, I²=${(100 * f.i2).toFixed(0)}%, Q=${f.q.toFixed(1)} on ${f.qDf} df, p=${pFmt(f.qP)}` : "") +
      (f.left.length ? `\n  not estimated: ` + f.left.map((l) => `${l.label} (${l.reason})`).join("; ") : "") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Asks whether one thing — a gene being mutated, a high tumour mutation burden — goes with shorter or longer survival, separately in each cancer type, and then combines those answers. Each row is one cancer type: its square is the hazard ratio (right of the dashed line at 1 means patients with the change died sooner; left means they lived longer) and its line how sure we can be. The diamonds at the bottom combine the rows into one overall estimate. When the rows disagree a lot (a high I²), the overall estimate is an average of different effects, so read the rows. This shows an association, not a cause."
  },
  need: "patients",
  preview: "no method record or golden test of the per-stratum Cox fits and the DerSimonian–Laird pooling yet",
  isNew: true,
};
