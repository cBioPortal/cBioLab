// The predictive view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { predictiveSvg } from "./figure.ts";

export const predictiveKind: ViewKindDef<"predictive"> = {
  kind: "predictive",
  figure: (v, o) => v.predictive.genes.length ? predictiveSvg(v, o) : null,
  title: (v) => "Predictive biomarkers" + (v.predictive ? " — gene × " + v.predictive.exposure : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.predictive;
    const eff = (e: { hr: number; ciLow: number; ciHigh: number; p: number } | null) => e ? `HR ${e.hr.toFixed(2)} (95% CI ${e.ciLow.toFixed(2)}-${e.ciHigh.toFixed(2)}, ${pFmt(e.p)})` : "n/a";
    out.push(`Predictive biomarkers: gene x ${m.exposure} on ${m.endpoint} (Cox per gene; ${m.n.toLocaleString()} patients, ${m.exposed.toLocaleString()} exposed, ${m.events.toLocaleString()} events` +
      (m.covariates.length ? `; adjusted for ${m.covariates.join(", ")}` : "") + `):\n` +
      m.genes.map((g) => `  ${g.gene}: mutated ${g.mutatedExposed}/${g.exposed} exposed, ${g.mutatedUnexposed}/${g.unexposed} unexposed; ` +
        (g.interaction ? `among exposed ${eff(g.inExposed)}; among unexposed ${eff(g.inUnexposed)}; interaction ${eff(g.interaction)}, q=${pFmt(g.q!)}` : `not fitted: ${g.skipped}`)).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Asks, gene by gene, whether a mutation changes how patients do on a particular treatment — not just whether it marks a better or worse outlook in general. For each gene it compares patients with and without the mutation twice: among those who received the treatment (upper marker) and among those who did not (lower marker). A gene whose markers sit far apart — say, much worse with the mutation only among the treated — may predict who benefits from that treatment; the right-hand column tests that difference. Treatment here was not assigned at random, and patients had to live long enough to receive it, so a finding is a lead to test properly, not proof."
  },
  need: "patients",
  preview: "no method record or golden test of the per-gene interaction fits yet",
  isNew: true,
};
