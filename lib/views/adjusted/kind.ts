// The adjusted view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { adjustedSvg } from "./figure.ts";

export const adjustedKind: ViewKindDef<"adjusted"> = {
  kind: "adjusted",
  figure: (v, o) => v.adjusted.rows.length ? adjustedSvg(v, o) : null,
  title: (v) => "Adjusted enrichment" + (v.adjusted ? " — " + v.adjusted.groups.join(" vs ") + (v.adjusted.covariates.length ? ", adjusted for " + v.adjusted.covariates.join(", ") : "") : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const a = v.adjusted, pct = (x: number, n: number) => n ? (100 * x / n).toFixed(1) + "%" : "–";
    out.push(`Adjusted enrichment: ${a.groups[0]} vs ${a.groups[1]}, mutation${a.measure === "driver" ? " (OncoKB drivers)" : ""} per gene by logistic regression` +
      (a.covariates.length ? ` adjusted for ${a.covariates.join(", ")}` : " (no covariates)") + `; ${a.rows.length} genes fit, ${a.significant} at q<0.05:\n` +
      a.rows.slice(0, 30).map((g) => `  ${g.gene}: ${a.groups[0]} ${g.altered[0]}/${g.profiled[0]} (${pct(g.altered[0], g.profiled[0])}), ${a.groups[1]} ${g.altered[1]}/${g.profiled[1]} (${pct(g.altered[1], g.profiled[1])}); ` +
        `raw OR ${g.rawOr == null ? "undefined" : g.rawOr.toFixed(2)} (Fisher p=${pFmt(g.fisherP)}); adjusted OR ${g.or.toFixed(2)} (95% CI ${g.ciLow.toFixed(2)}-${g.ciHigh.toFixed(2)}) p=${pFmt(g.p)} q=${pFmt(g.q)}`).join("\n") +
      (a.rows.length > 30 ? `\n  … ${a.rows.length - 30} more genes fit` : "") +
      (a.failed.length ? `\n  not fit: ` + a.failed.map((f) => `${f.gene} (${f.reason})`).join("; ") : "") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares how often each commonly mutated gene is mutated in two groups of patients — say, colorectal cancers diagnosed before and after age 50 — after taking into account other things that differ between the groups and also change mutation rates, such as how many mutations a tumour carries overall. Each dot is a gene: right of centre means more often mutated in the first group, left in the second, and higher means more certain. The table shows each gene's raw difference beside the adjusted one, so you can see which differences were explained away. A difference here is a clue, not proof of a cause."
  },
  need: "patients",
  preview: "no method record or golden test of the per-gene logistic fits yet",
  isNew: true,
};
