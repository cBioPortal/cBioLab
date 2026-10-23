// The organotropism view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { organotropismSvg } from "./figure.ts";

export const organotropismKind: ViewKindDef<"organotropism"> = {
  kind: "organotropism",
  figure: (v, o) => v.organotropism.sites.length && v.organotropism.genes.length ? organotropismSvg(v, o) : null,
  title: (v) => "Organotropism" + (v.organotropism ? " — " + v.organotropism.genes.length + " genes × " + v.organotropism.sites.length + " sites, " + v.organotropism.source : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const o = v.organotropism, pct = (k: number, n: number) => n ? (100 * k / n).toFixed(1) + "%" : "–";
    const lab = new Map(o.sites.map((s) => [s.site, s.label]));
    const sig = o.cells.filter((c) => c.q != null && c.q < 0.05).sort((a, b) => a.p! - b.p!);
    out.push(`Metastatic organotropism (${o.patients.toLocaleString()} patients; sites from ${o.sourceLabel}; ${o.measure === "driver" ? "OncoKB-driver " : ""}${o.alteration}s; ` +
      `${o.stratifyBy ? "CMH stratified by " + o.stratifyBy : "unstratified"}): ${o.genes.length} genes × ${o.sites.length} sites, ${o.tested} cells tested, ${o.significant} at q<0.05.\n` +
      `  Sites (patients with a metastasis there / evaluable): ` + o.sites.map((s) => `${s.label} ${s.withSite}/${s.evaluable}`).join(", ") + "\n" +
      sig.slice(0, 30).map((c) => `  ${lab.get(c.site) || c.site} × ${c.gene}: altered ${c.withAltered}/${c.withSite} (${pct(c.withAltered, c.withSite)}) with the site vs ${c.withoutAltered}/${c.without} (${pct(c.withoutAltered, c.without)}) without, ` +
        `MH OR ${c.or == null ? "undefined" : c.or.toFixed(2)}, p=${pFmt(c.p!)} q=${pFmt(c.q!)}`).join("\n") +
      (o.incidence ? `\n  Cumulative incidence of ${o.incidence.site} by ${o.incidence.gene} (death competing): ` +
        o.incidence.horizons.map((h) => `${h.months} mo ` + h.cells.map((c) => `${c.cohort} ${(100 * c.f1).toFixed(1)}% [${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}]`).join(" vs ")).join("; ") +
        (o.incidence.gray ? `; Gray's test p=${pFmt(o.incidence.gray.p)}` : "") : o.noIncidence ? `\n  No incidence panel: ${o.noIncidence}` : "") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Asks, for each organ a cancer spread to — brain, liver, bone and the rest — whether patients whose tumour carries a change in a given gene spread there more or less often than patients whose tumour does not, comparing patients within the same cancer type. Red squares mean the gene's change goes with spread to that organ, blue that it goes with spreading there less; outlined squares are the ones unlikely to be chance after testing many pairs. Where the study dates each site, the curve below shows how quickly patients with and without one gene's change develop spread to one organ, counting deaths as a separate outcome. Sites are only known where scans or biopsies found them."
  },
  need: "local",
  preview: "no method record or golden test of the per-cell Cochran–Mantel–Haenszel tests or the site incidence yet",
  isNew: true,
};
