// The acquired view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { acquiredSvg } from "./figure.ts";

export const acquiredKind: ViewKindDef<"acquired"> = {
  kind: "acquired",
  figure: (v, o) => v.acquired && v.acquired.panels.some((pn) => pn.patients && pn.genes.length) ? acquiredSvg(v, o) : null,
  title: (v) => "Acquired under therapy" + (v.acquired ? " — samples before and after " + v.acquired.anchoredTo : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const ar = v.acquired;
    out.push(`Acquired under therapy: last sample on or before the first ${ar.anchoredTo} against the first at least ${ar.minGapDays} days after (${ar.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}; both samples' panels cover the gene):\n` +
      ar.panels.map((pn) => `  ${pn.cohort} (${pn.anchored.toLocaleString()} started, ${pn.withPre.toLocaleString()} with a sample before, ${pn.withPost.toLocaleString()} after, ${pn.patients.toLocaleString()} with both` +
        (pn.gapDays ? `; samples a median ${pn.gapDays.median} days apart` : "") +
        (pn.tested != null ? `; ${pn.tested.toLocaleString()} genes tested, the ${pn.genes.length} smallest p listed` : "") + `):\n` +
        pn.genes.map((g) => `    ${g.gene}: acquired ${g.acquired}, lost ${g.lost}, shared ${g.shared}, neither ${g.neither} of ${g.pairs} pairs` +
          (g.acquired + g.lost ? `, McNemar p=${pFmt(g.p)} q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "For patients who had a tumour sample tested before a treatment started and another one afterwards, shows gene by gene how many had a change only in the later sample (acquired, to the right) or only in the earlier one (lost, to the left). Genes that keep turning up only after treatment can point to how tumours resist it. It cannot say the treatment caused the change: second biopsies are usually taken when the cancer grows again, and a change can simply have been missed the first time."
  },
  need: "local",
  preview: "no method record or golden test of the before/after pairing and McNemar counts yet",
  isNew: true,
};
