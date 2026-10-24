// The hla view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { hlaSvg } from "./figure.ts";

export const hlaKind: ViewKindDef<"hla"> = {
  kind: "hla",
  figure: (v, o) => v.hla.panels.some((pn) => pn.typed || pn.lohEvaluated) ? hlaSvg(v, o) : null,
  title: (v) => "HLA class I genotype and " + (v.hla ? v.hla.endpoint : "OS"),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.hla, pc = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + "%" : "—";
    const hr = (h: { hr: number; ciLow: number; ciHigh: number; p: number; n: number } | null) => h ? `HR ${h.hr.toFixed(2)} (95% CI ${h.ciLow.toFixed(2)}-${h.ciHigh.toFixed(2)}, p=${pFmt(h.p)}, n=${h.n})` : "n/a";
    const split = (name: string, s: (typeof m.panels)[number]["byLoh"], why?: string) => s
      ? `\n    ${m.endpoint} by ${name}: ` + s.curves.map((c) => `${c.label} n=${c.n}, ${c.events} events, median ${c.median == null ? "not reached" : c.median.toFixed(1) + "mo"}`).join("; ") +
        (s.logrank ? `; log-rank p=${pFmt(s.logrank.p)}` : "") + `; ${hr(s.hr)}` + (m.covariates.length ? `; adjusted for ${m.covariates.join(", ")} ${hr(s.adjusted)}` : "")
      : `\n    ${m.endpoint} by ${name} not drawn: ${why || "no data"}`;
    out.push(`HLA class I genotype (alleles compared at ${m.resolution === "full" ? "full" : m.resolution + "-field"} resolution) and HLA LOH:\n` +
      m.panels.map((pn) => `  ${pn.cohort} (${pn.typed.toLocaleString()} of ${pn.patients.toLocaleString()} patients typed at A, B and C): homozygous at 0 loci ${pc(pn.homozygous[0], pn.typed)}, ` +
        `1 ${pc(pn.homozygous[1], pn.typed)}, 2+ ${pc(pn.homozygous[2] + pn.homozygous[3], pn.typed)}; ` + pn.loci.map((l) => `HLA-${l.locus} ${pc(l.homozygous, l.typed)}`).join(", ") +
        `; HLA LOH ${pn.loh.toLocaleString()} of ${pn.lohEvaluated.toLocaleString()} with a call (${pc(pn.loh, pn.lohEvaluated)})` +
        split("homozygosity (≥1 locus vs none)", pn.byHomozygosity, pn.byHomozygosityWhy) + split("HLA LOH", pn.byLoh, pn.byLohWhy)).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "HLA class I molecules (HLA-A, -B and -C) show pieces of a tumour's proteins to the immune system. Everyone inherits two copies of each; a person who inherited two identical copies at a gene (homozygous) shows a narrower range of pieces, and a tumour can also lose one copy (HLA loss of heterozygosity) to hide. This shows how common each is in a cohort, and whether patients homozygous at any of the three genes, or whose tumour lost a copy, lived shorter or longer. In patients treated with immunotherapy, homozygosity has been linked to worse survival; in a cohort not limited to them the comparison describes prognosis, not response to treatment."
  },
  need: "patients",
  preview: "no method record or golden test of the homozygosity and LOH counts or the survival splits yet",
  isNew: true,
};
