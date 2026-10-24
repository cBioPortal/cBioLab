// The paired view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { pairedSvg } from "./figure.ts";

export const pairedKind: ViewKindDef<"paired"> = {
  kind: "paired",
  figure: (v, o) => v.paired && v.paired.panels.some((pn) => pn.patients) ? pairedSvg(v, o) : null,
  title: (v) => "Paired samples" + (v.paired ? " — " + v.paired.labels.a + " vs " + v.paired.labels.b : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const pr = v.paired, aL = pr.labels.a, bL = pr.labels.b;
    const sides = pr.perStudy ? Object.entries(pr.perStudy).map(([st, sp]) => `${st}: ${sp.attribute} ${sp.a.join("/")} vs ${sp.b.join("/")}`).join("; ")
      : `${pr.pairBy.attribute} ${pr.pairBy.a.join("/")} vs ${pr.pairBy.b.join("/")}`;
    out.push(`Paired samples, ${aL} vs ${bL} (${sides}; ${pr.measure === "driver" ? "drivers" : "any alteration"}; profiled on both sides):\n` +
      pr.panels.map((pn) => `  ${pn.cohort} (${pn.patients.toLocaleString()} patients with both` +
        (pn.tested != null ? `; scanned ${pn.tested.toLocaleString()} genes with a discordant patient, the ${pn.genes.length} most one-sided listed` : "") + `):\n` +
        pn.genes.map((g) => `    ${g.gene}: both ${g.both}, ${aL}-only ${g.aOnly}, ${bL}-only ${g.bOnly} of ${g.pairs} pairs` +
          (g.concordance != null ? `, ${Math.round(100 * g.concordance)}% concordant` : "") +
          (g.aOnly + g.bOnly ? `, McNemar q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "For patients who had two kinds of tumour sample tested — usually the original tumour and a later spread of it elsewhere in the body — shows, gene by gene, how often a change was found in both samples, only in the original, or only in the spread. Changes found only in the spread can point to how the cancer adapted, for example to a treatment. The two kinds can also be samples taken before and after a treatment. Without a list of genes, it checks every gene and shows the ones most often found on one side only."
  },
  need: "local",
  isNew: true,
};
