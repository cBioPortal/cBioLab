// The coexpression view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { coexpressionSvg } from "./figure.ts";

export const coexpressionKind: ViewKindDef<"coexpression"> = {
  kind: "coexpression",
  figure: (v, o) => v.coexpression && v.coexpression.length ? coexpressionSvg(v, o) : null,
  title: () => "Co-expression",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    out.push("Co-expression (Pearson r, computed from six per-site sums so the pooled value is exact):\n" +
      (v.coexpression || []).slice(0, 20).map((x) =>
        `  ${x.a}/${x.b}: r=${x.r != null ? x.r.toFixed(3) : "—"} (n=${x.n.toLocaleString()}) p=${pFmt(x.p)} q=${pFmt(x.q)}` +
        (x.rMeta != null ? `  meta-r=${x.rMeta.toFixed(3)} across ${x.sites} sites` : "")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Checks whether two genes tend to be more or less active together across patients — measured by how much each gene is \"read out\" into the working molecules a cell actually uses. Genes that rise and fall together are often working in the same biological pathway, or controlled by the same switch."
  },
};
