// The cooccurrence view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { cooccurrenceSvg } from "./figure.ts";

export const cooccurrenceKind: ViewKindDef<"cooccurrence"> = {
  kind: "cooccurrence",
  figure: (v, o) => v.pairs && v.pairs.length ? cooccurrenceSvg(v, o) : null,
  title: () => "Co-occurrence and mutual exclusivity",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    out.push("Co-occurrence (2x2 per pair, among patients profiled for BOTH genes):\n" +
      (v.pairs || []).slice(0, 20).map((x) =>
        `  ${x.a}/${x.b}: both ${x.both.toLocaleString()}, ${x.a} only ${x.onlyA.toLocaleString()}, ` +
        `${x.b} only ${x.onlyB.toLocaleString()}, neither ${x.neither.toLocaleString()} (of ${x.profiled.toLocaleString()} profiled)` +
        (x.log2Odds != null ? `  log2OR=${x.log2Odds.toFixed(2)} ${x.log2Odds > 0 ? "(co-occur)" : "(mutually exclusive)"}` : "") +
        `  p=${pFmt(x.p)} q=${pFmt(x.q)}` +
        (x.pStratified != null ? `  stratified p=${pFmt(x.pStratified)}` : "")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Checks whether alterations in two genes tend to show up in the same patients more often than you'd expect by chance (\"co-occurring\"), or rarely appear together (\"mutually exclusive\"). Genes that are mutually exclusive often play overlapping roles — if one is already altered, changing the other adds little, so cells rarely need both."
  },
};
