// The germline view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { germlineSvg } from "./figure.ts";

export const germlineKind: ViewKindDef<"germline"> = {
  kind: "germline",
  figure: (v, o) => v.germline.panels.some((pn) => pn.genes.some((g) => g.sequenced)) ? germlineSvg(v, o) : null,
  title: (v) => "Germline carriers and second hits" + (v.germline ? " — " + v.germline.genes.length + " genes" : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const gm = v.germline, pct = (k: number, n: number) => n ? (100 * k / n).toFixed(1) + "%" : "–";
    out.push(`Germline carriers and somatic second hits (${gm.chosen || gm.genes.length + " genes"}; LOH ${gm.loh}):\n` +
      gm.panels.map((pn) => `  ${pn.cohort} (${pn.patients.toLocaleString()} patients):\n` + pn.genes.map((g) =>
        `    ${g.gene}: ${g.carriers}/${g.sequenced} sequenced carry a germline call (${pct(g.carriers, g.sequenced)})${g.outsidePanel ? `, ${g.outsidePanel} more off their panel` : ""}; ` +
        `second hit in carriers ${g.carrierEither}/${g.carriers} (${pct(g.carrierEither, g.carriers)}: ${g.carrierSomatic} somatic mutation, ${g.carrierDeletion}/${g.carrierCnaProfiled} deep deletion) vs non-carriers ${g.noncarrierEither}/${g.noncarriers} (${pct(g.noncarrierEither, g.noncarriers)})` +
        (g.p != null ? `, Fisher p=${pFmt(g.p)} q=${pFmt(g.q!)}` : "")).join("\n")).join("\n") +
      (gm.survival || []).map((s) => `\n  OS by ${s.gene} carrier status, ${s.cohort}: ` + s.curves.map((c) => `${c.group} n=${c.n}, ${c.events} deaths, median ${c.median == null ? "not reached" : c.median.toFixed(1) + " mo"}`).join("; ") +
        (s.logrank ? `; log-rank p=${pFmt(s.logrank.p)}` : s.noTest ? "; " + s.noTest : "")).join("") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Some people are born with a faulty copy of a cancer gene such as BRCA2 in every cell. For each such gene this counts those patients (carriers) among everyone whose tumour was sequenced for it, and asks whether their tumour knocked out the remaining good copy — a second hit — by a further mutation or by deleting the gene, compared with how often the same gene is hit in patients born without a faulty copy. The commonest second hit, losing the good copy outright (loss of heterozygosity), needs data this view does not read, so the second-hit share is a minimum. Optionally the curves compare survival of carriers and non-carriers for one gene."
  },
  need: "local",
  preview: "no method record or golden test of the carrier and second-hit counts or the Fisher tests yet",
  isNew: true,
};
