// The drivernegative view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { drivernegativeSvg } from "./figure.ts";

export const drivernegativeKind: ViewKindDef<"drivernegative"> = {
  kind: "drivernegative",
  figure: (v, o) => v.drivernegative.sequenced ? drivernegativeSvg(v, o) : null,
  title: (v) => "Driver-negative analysis" + (v.drivernegative ? " — " + v.drivernegative.alteration + ", driver-negative vs driver-positive" : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const d = v.drivernegative, pct = (k: number, n: number) => n ? (100 * k / n).toFixed(1) + "%" : "–";
    out.push(`Driver-negative analysis (drivers: ${d.drivers.join(", ")}): of ${d.sequenced.toLocaleString()} patients sequenced, ` +
      `${d.positive.toLocaleString()} driver-positive (${pct(d.positive, d.sequenced)}), ${d.negative.toLocaleString()} driver-negative (${pct(d.negative, d.sequenced)}), ` +
      `${d.unprofiled.toLocaleString()} not fully profiled (in neither group).\n` +
      `  ${d.alteration} frequency, driver-negative vs driver-positive, Fisher + BH over ${d.tested} genes, ${d.significant} at q<0.05:\n` +
      d.rows.slice(0, 30).map((g) => `  ${g.gene}: ${g.altered[0]}/${g.profiled[0]} (${pct(g.altered[0], g.profiled[0])}) vs ${g.altered[1]}/${g.profiled[1]} (${pct(g.altered[1], g.profiled[1])}), ` +
        `log2 ratio ${g.log2Ratio == null ? "undefined" : g.log2Ratio.toFixed(2)}, p=${pFmt(g.p)} q=${pFmt(g.q)}`).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Splits one group of patients — say, lung cancers — into those whose tumour carries one of the well-known, usually treatable cancer-driving changes (EGFR, KRAS, ALK and the rest of the list) and those whose tumour carries none, and then asks which other genes are changed more often in the second group. Those genes are candidates for what drives the tumours without a known driver. Patients whose test did not cover every gene on the list are kept apart, since we cannot tell whether they have a driver. The bar shows how big each group is; in the chart, genes to the right are more common without a known driver."
  },
  need: "local",
  preview: "no method record or golden test of the group split and the per-gene Fisher tests yet",
  isNew: true,
};
