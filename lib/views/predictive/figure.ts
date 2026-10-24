// Predictive biomarker figure: per gene, its hazard ratio among the exposed and the unexposed on one
// log axis, with the interaction's p and q beside it.
import type { DrawnResultOf } from "../../types.ts";
import { fmtInt, type SvgOpts } from "../../svg-kit.ts";
import { dualForestSvg } from "../../figures/forest.ts";

export function predictiveSvg(v: DrawnResultOf<"predictive">, o: SvgOpts): string {
  const m = v.predictive;
  const rows = m.genes.map((g) => ({
    label: g.gene,
    detail: "mutated " + fmtInt(g.mutatedExposed) + "/" + fmtInt(g.exposed) + " exposed · " + fmtInt(g.mutatedUnexposed) + "/" + fmtInt(g.unexposed) + " not",
    a: g.inExposed ? { ratio: g.inExposed.hr, ciLow: g.inExposed.ciLow, ciHigh: g.inExposed.ciHigh } : null,
    b: g.inUnexposed ? { ratio: g.inUnexposed.hr, ciLow: g.inUnexposed.ciLow, ciHigh: g.inUnexposed.ciHigh } : null,
    p: g.interaction ? g.interaction.p : null, q: g.q,
    ...(g.skipped ? { note: "not fitted: " + g.skipped } : {}),
  }));
  const note = fmtInt(m.n) + " patients (" + fmtInt(m.exposed) + " exposed to " + m.exposure + "), " + fmtInt(m.events) + " deaths or events on " + m.endpoint +
    ". Each row: the mutated against the wild-type among the exposed (upper marker) and the unexposed (lower marker); the right column is the gene × exposure interaction. " +
    m.genes.filter((g) => g.interaction).map((g) => g.gene + " interaction HR " + g.interaction!.hr.toFixed(2)).join(", ") + ". " + (v.caveat || "");
  return dualForestSvg(rows, { width: o.width, theme: o.theme, ratioName: "HR, mutated vs wild-type", names: ["exposed: " + m.exposure, "unexposed"],
    testName: "interaction p · q", note, title: "Predictive biomarkers — " + m.exposure });
}
