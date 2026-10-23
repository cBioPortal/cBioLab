// The exclusivity view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { exclusivitySvg } from "./figure.ts";

export const exclusivityKind: ViewKindDef<"exclusivity"> = {
  kind: "exclusivity",
  figure: (v, o) => v.exclusivity && v.exclusivity.pairs.length ? exclusivitySvg(v, o) : null,
  title: (v) => "Mutual exclusivity (DISCOVER)" + (v.exclusivity ? " — " + v.exclusivity.cohort : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const ex = v.exclusivity;
    out.push(`Mutual exclusivity (DISCOVER background over ${ex.samples.toLocaleString()} samples and ${ex.matrixGenes} genes${ex.stratifyBy ? `, within ${ex.strata.length} ${ex.stratifyBy} strata` : ""}; ` +
      `${ex.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}; fit ${ex.converged ? "converged" : "NOT converged"} in ${ex.iterations} rounds) in ${ex.cohort}:\n` +
      ex.pairs.map((x) => `  ${x.a}/${x.b}: both ${x.both} of ${x.profiled} profiled, ${x.expected} expected; DISCOVER exclusivity q=${pFmt(x.qExclusive)}, co-occurrence q=${pFmt(x.qCooccur)}` +
        `${x.exact ? "" : " (normal approx.)"}; Fisher q=${pFmt(x.fisherQ)}${x.log2Odds != null ? `, log2 OR ${x.log2Odds.toFixed(2)}` : ""}`).join("\n") +
      (ex.unassessable.length ? `\n  not assessable: ${ex.unassessable.join(", ")}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Asks, for each pair of genes, whether tumours carry changes in both more or less often than chance — \"mutually exclusive\" genes are rarely changed together, which can mean either change alone is enough to drive the cancer. Its sense of \"chance\" accounts for how many changes each tumour has overall: a tumour with hundreds of changes is expected to share genes with many others, so it does not make two genes look linked just because they both turn up in heavily altered tumours. Beside it is the simpler test that ignores this, to show the difference."
  },
  need: "local",
  preview: "no method record or golden test of the DISCOVER background fit against the R package yet",
  isNew: true,
};
