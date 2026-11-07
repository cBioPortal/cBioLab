// The segments view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { segmentsSvg } from "./figure.ts";

/** samples the results text names one by one; the figure draws every drawn row */
const TEXT_SAMPLES = 40;

export const segmentsKind: ViewKindDef<"segments"> = {
  kind: "segments",
  figure: (v, o) => v.segments && v.segments.samples.length ? segmentsSvg(v, o) : null,
  title: (v) => "Copy-number segments" + (v.segments ? " — " + v.segments.region.label : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const s = v.segments;
    const segsIn = (x: typeof s.samples[number]) => x.segs.length / 4;
    out.push(`Copy-number segments (${s.build}, ${s.region.label}): ${s.samples.length.toLocaleString()} of ${s.segmented.toLocaleString()} samples with segments drawn` +
      (s.leftOut ? `, ${s.leftOut.toLocaleString()} left out by the row limit (${s.rowsLimit})` : "") + `; mean log2 ratio over the region per sample:\n` +
      s.samples.slice(0, TEXT_SAMPLES).map((x) => `  ${x.mark ? x.mark.label + ". " : ""}${x.sample}: ` +
        (x.score == null ? "no segment in the region" : (x.score >= 0 ? "+" : "") + x.score.toFixed(2) + " (" + segsIn(x) + " segment" + (segsIn(x) === 1 ? "" : "s") + ")")).join("\n") +
      (s.samples.length > TEXT_SAMPLES ? `\n  … ${s.samples.length - TEXT_SAMPLES} more drawn (the figure draws all of them)` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Each row is one tumour sample, drawn along the chromosomes (or zoomed to one gene or stretch of DNA). The colour says how many copies of each stretch the sample has compared with normal: red where it has extra copies (deeper red, more copies), blue where copies were lost, white where it looks normal, grey where the sample was not measured. A column of red or blue running down many rows at a gene marks a gain or loss the tumours share. This is cBioPortal's CN Segments tab, and the patient page's genomic overview.",
  },
  need: "patients",
};
