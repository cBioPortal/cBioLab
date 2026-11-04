// The mutexpr view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { mutexprSvg } from "./figure.ts";

export const mutexprKind: ViewKindDef<"mutexpr"> = {
  kind: "mutexpr",
  figure: (v, o) => v.mutexpr.strata.some((s) => s.groups.some((g) => g.n != null)) ? mutexprSvg(v, o) : null,
  title: (v) => "Expression by mutation" + (v.mutexpr ? " — " + v.mutexpr.expressionGene + " by " + v.mutexpr.gene : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.mutexpr, f = (x: number | undefined) => x == null ? "–" : x.toPrecision(3);
    out.push(`Expression by mutation: ${m.valueLabel}, grouped by ${m.gene} ${m.resolution === "codon" ? "codon" : "protein change"}` +
      (m.stratify.length ? `, within ${m.stratify.map((s) => s === "cancerType" ? "cancer type" : (m.fusionGene || m.gene) + " fusion status").join(" × ")}` : "") +
      ` (minCount ${m.minCount}; ${m.samples.withValue.toLocaleString()} of ${m.samples.cohort.toLocaleString()} samples have a value):\n` +
      m.strata.map((s) => (m.strata.length > 1 || s.label !== "All samples" ? `  ${s.label} (${s.n.toLocaleString()} samples)${s.untested ? " — " + s.untested : ""}\n` : "") +
        s.groups.map((g) => `    ${g.label}: ` + (g.n == null ? `fewer than ${m.minCount} samples, withheld`
          : `n=${g.n.toLocaleString()}, mean ${f(g.mean)}, median ${f(g.median)} (IQR ${f(g.q1)}–${f(g.q3)})` +
            (g.diff != null ? `, vs not mutated ${g.diff > 0 ? "+" : ""}${f(g.diff)} p=${pFmt(g.p!)} q=${pFmt(g.q!)}` : ""))).join("\n")).join("\n") +
      (m.withheldStrata ? `\n  ${m.withheldStrata} strat${m.withheldStrata === 1 ? "um" : "a"} with fewer than ${m.minCount} samples withheld` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows how active one gene is in tumours that carry each particular change in a gene — for example, how much MDM2 is switched on in tumours with TP53 R175H, R273H and so on, compared with tumours whose TP53 was tested and found unchanged. Tumours whose test did not cover the gene are shown separately rather than counted as unchanged. Groups too small to describe reliably are withheld, and the samples can first be split by cancer type or by whether the tumour carries a gene fusion."
  },
  need: "local",
  isNew: true,
};
