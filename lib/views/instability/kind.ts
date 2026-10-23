// The instability view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { instabilitySvg } from "./figure.ts";

export const instabilityKind: ViewKindDef<"instability"> = {
  kind: "instability",
  figure: (v, o) => v.instability && v.instability.panels.some((pn) => pn.score.some((n) => n > 0)) ? instabilitySvg(v, o) : null,
  title: () => "Genomic instability — aneuploidy score and FGA",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const ir = v.instability, f = (s: { median: number | null; q1: number | null; q3: number | null }) => s.median == null ? "—" : `${s.median} [${s.q1}–${s.q3}]`;
    out.push(`Genomic instability (hg19 segments, threshold ±${ir.threshold}, arm called past ${Math.round(ir.armShare * 100)}% of its length; ${ir.arms.length} arms):\n` +
      ir.panels.map((pn) => `  ${pn.cohort}: ${pn.score.reduce((s, x) => s + x, 0).toLocaleString()} samples scored; aneuploidy score median [IQR] ${f(pn.scoreSpread)}, FGA ${f(pn.fgaSpread)}%\n` +
        `    most often gained: ${[...pn.arms].filter((a) => a.measured).sort((a, b) => b.gain / b.measured - a.gain / a.measured).slice(0, 5).map((a) => `${a.arm} ${Math.round(100 * a.gain / a.measured)}%`).join(", ")}\n` +
        `    most often lost: ${[...pn.arms].filter((a) => a.measured).sort((a, b) => b.loss / b.measured - a.loss / a.measured).slice(0, 5).map((a) => `${a.arm} ${Math.round(100 * a.loss / a.measured)}%`).join(", ")}`).join("\n") +
      (ir.test ? `\n  ${ir.test.name}: aneuploidy score p=${pFmt(ir.test.scoreP)}, FGA p=${pFmt(ir.test.fgaP)}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Cancer cells often gain or lose whole chromosome arms, and how much of a tumour's genome is out of balance is a measure of how unstable it is. For each group of tumours, this shows how many chromosome arms are typically gained or lost (the \"aneuploidy score\") and what share of the genome is altered, then which arms are gained (red) or lost (blue) most often — patterns that differ by cancer type, such as chromosome 20q gained and 18q lost in colorectal cancer."
  },
  need: "local",
  preview: "no method record, and no check of the arm calls and aneuploidy scores against Taylor et al.'s published values yet",
  isNew: true,
};
