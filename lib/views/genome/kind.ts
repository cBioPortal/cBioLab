// The genome view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { genomeSvg } from "./figure.ts";

export const genomeKind: ViewKindDef<"genome"> = {
  kind: "genome",
  figure: (v, o) => v.genome && v.genome.series.length ? genomeSvg(v, o) : null,
  title: () => "Genome-wide copy number",
  text: (v, { out, caveatOf, noteOf }) => {
    const g = v.genome;
    // per chromosome, the highest gained and lost share of each cohort — enough to name the
    // regions without reciting every bin
    const perChrom = (s: typeof g.series[number]) => {
      const best = new Map<string, { gain: number; loss: number }>();
      g.bins.forEach((b, i) => {
        if (!s.profiled[i]) return;
        const cur = best.get(b.chrom) || { gain: 0, loss: 0 };
        cur.gain = Math.max(cur.gain, 100 * s.gain[i] / s.profiled[i]);
        cur.loss = Math.max(cur.loss, 100 * s.loss[i] / s.profiled[i]);
        best.set(b.chrom, cur);
      });
      return [...best].map(([c, x]) => `chr${c} +${x.gain.toFixed(0)}/−${x.loss.toFixed(0)}`).join(", ");
    };
    out.push(`Genome-wide copy number (${g.build}, ${g.binMb} Mb bins, |log2| ≥ ${g.threshold}; peak % gained/lost per chromosome):\n` +
      g.series.map((s) => `  ${s.cohort} (${s.segmented.toLocaleString()} segmented samples): ${perChrom(s)}`).join("\n") +
      (g.test ? `\n  bins differing at q<0.05: ${g.test.significantGain} for gains, ${g.test.significantLoss} for losses, of ${g.bins.length}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Walks along every chromosome and shows, at each stretch, what share of the group's tumours have extra copies of that stretch of DNA (drawn upward, in red) or have lost copies of it (drawn downward, in blue). Stretches gained or lost in many tumours often hold genes that help the cancer grow, or genes that would have held it back."
  },
  need: "local",
  isNew: true,
};
