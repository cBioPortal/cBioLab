// The evolution view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";
import { evolutionSvg, cellText } from "./figure.ts";

/** drawn mutations listed in the results text; the figure draws every one */
const TEXT_MUTATIONS = 100;

export const evolutionKind: ViewKindDef<"evolution"> = {
  kind: "evolution",
  figure: (v, o) => evolutionSvg(v, o),
  title: (v) => "Genomic evolution" + (v.evolution?.patient ? " — " + v.evolution.patient.id : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const e = v.evolution, pt = e.patient;
    const head = `Genomic evolution — patients to choose from (two or more samples, with allele counts): ${e.total < e.all ? `${e.total.toLocaleString()} of ${e.all.toLocaleString()} kept by the query` : e.total.toLocaleString()}; ` + tableText(e);
    if (!pt) { out.push(head + caveatOf(v) + noteOf(v)); return; }
    const s = pt.samples;
    const drawn = e.drawn || [];
    out.push(head + `\n${pt.id} (${pt.study}); samples in order: ` + s.map((x) => `${x.label} = ${x.id}${x.type ? " (" + x.type + ")" : ""}${x.day != null ? ", day " + x.day : ""}${x.panel ? "" : ", not sequenced for mutations"}`).join("; ") +
      (e.drawn ? `\nVAF of each drawn mutation by sample (${drawn.length} drawn, ${e.x === "time" ? "placed by collection day" : "in sequence"}${e.display.chart === "heatmap" ? ", as a heatmap" : ""}):\n` +
        drawn.slice(0, TEXT_MUTATIONS).map((m) => `  ${m.gene} ${m.proteinChange}: ` + m.cells.map((c, i) => s[i].label + " " + cellText(c)).join("; ")).join("\n") +
        (drawn.length > TEXT_MUTATIONS ? `\n  … ${drawn.length - TEXT_MUTATIONS} more (the figure draws all of them)` : "") : `\nNot drawn: ${e.undrawn}`) +
      (e.mutations ? `\nMutation table: ${e.mutations.total < e.mutations.all ? `${e.mutations.total.toLocaleString()} of ${e.mutations.all.toLocaleString()} kept by its query` : e.mutations.total.toLocaleString() + " rows"}; ` + tableText(e.mutations) : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Follows one patient's mutations across their tumour samples, as cBioPortal's Genomic Evolution tab does. For each mutation, the share of the sequencing reads at its position that carry it (the variant allele frequency, VAF) is drawn in every sample, in the order the samples were taken: a line per mutation, or a heatmap with a row per mutation. A mutation that rises, appears or disappears between samples shows how the tumour changed. A sample whose test did not cover the gene is marked not profiled — it is not counted as zero. Below the chart, the mutations as a table you can search, filter and sort; the chart draws the mutations the table keeps. Step to the previous or next patient with the arrows (or the ← and → keys), or open the patient list.",
  },
  need: "patients",
};
