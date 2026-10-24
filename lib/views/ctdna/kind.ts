// The ctdna view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { ctdnaSvg } from "./figure.ts";

export const ctdnaKind: ViewKindDef<"ctdna"> = {
  kind: "ctdna",
  figure: (v, o) => v.ctdna && v.ctdna.panels.some((pn) => pn.patients) ? ctdnaSvg(v, o) : null,
  title: () => "ctDNA vs tissue",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const cr = v.ctdna, pc = (x: number | null) => x == null ? "—" : (100 * x).toFixed(0) + "%";
    out.push(`ctDNA vs tissue (plasma ${cr.attribute} = ${cr.plasma.join("/")}${cr.plasmaPanels.length ? " or panel " + cr.plasmaPanels.join("/") : ""}, tissue ${cr.tissue.join("/")}; ` +
      `${cr.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}${cr.withinDays != null ? `; samples within ${cr.withinDays} days` : ""}; both panels cover the gene):\n` +
      cr.panels.map((pn) => `  ${pn.cohort} (${pn.patients.toLocaleString()} patients with both; ctDNA detected in ${pn.detected.toLocaleString()} of ${pn.plasmaPatients.toLocaleString()} with plasma, ` +
        `${pc(pn.plasmaPatients ? pn.detected / pn.plasmaPatients : null)} [95% CI ${pc(pn.detectedLow)}–${pc(pn.detectedHigh)}]):\n` +
        pn.genes.map((g) => `    ${g.gene}: both ${g.both}, tissue-only ${g.tissueOnly}, plasma-only ${g.plasmaOnly}, neither ${g.neither} of ${g.pairs}; ` +
          `PPA ${pc(g.ppa)}${g.ppa != null ? ` [${pc(g.ppaLow)}–${pc(g.ppaHigh)}]` : ""}, concordance ${pc(g.concordance)}`).join("\n") +
        (pn.survival ? `\n    OS: ` + pn.survival.curves.map((c) => `${c.label} n=${c.n}, ${c.events} deaths, median ${c.median == null ? "not reached" : c.median.toFixed(1) + "mo"}`).join("; ") +
          (pn.survival.logrank ? `; log-rank p=${pFmt(pn.survival.logrank.p)}` : "") : pn.survivalWhy ? `\n    OS by ctDNA not drawn: ${pn.survivalWhy}` : "") +
        (pn.ch ? `\n    CH filter: removed ${pn.ch.removed} of ${pn.ch.calls} plasma mutation calls in ${pn.ch.patients} patients (${pn.ch.byGene} by gene, ${pn.ch.byNormal} by the matched normal)` +
          (pn.ch.genes.length ? ": " + pn.ch.genes.map((g) => `${g.gene} ${g.calls}`).join(", ") : "") +
          `; unfiltered: ctDNA detected ${pn.ch.before.detected.toLocaleString()} (${pc(pn.plasmaPatients ? pn.ch.before.detected / pn.plasmaPatients : null)})` +
          (pn.ch.before.survival && pn.ch.before.survival.p != null ? `, OS log-rank p=${pFmt(pn.ch.before.survival.p)}` : "") +
          `; plasma-only unfiltered ` + pn.ch.before.genes.map((g) => `${g.gene} ${g.plasmaOnly}`).join(", ") : "")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Tumours shed DNA into the blood, and a blood test (a \"liquid biopsy\") can read it. For patients who had both a blood sample and a tumour tissue sample tested, this shows gene by gene how often a change was found in both, only in the tissue, or only in the blood — and how often the blood test caught what the tissue showed. Below, it shows how many patients had tumour DNA detected in their blood at all, and whether those patients lived shorter or longer than those without it. With the clonal-haematopoiesis filter on, changes that probably come from ageing blood cells rather than the tumour — in genes such as DNMT3A and TET2, or also found in the patient's white blood cells — are left out first, and the figure says how many were removed and what the numbers were without the filter."
  },
  need: "local",
  preview: "no method record or golden test of the agreement counts, Wilson intervals and survival split, or of the clonal-haematopoiesis filter (chFilter) yet",
  isNew: true,
};
