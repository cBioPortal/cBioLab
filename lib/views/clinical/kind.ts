// The clinical view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { clinicalSvg } from "./figure.ts";

export const clinicalKind: ViewKindDef<"clinical"> = {
  kind: "clinical",
  figure: (v, o) => v.clinical && v.clinical.some((r) => !r.skipped) ? clinicalSvg(v, o) : null,
  title: () => "Clinical comparison",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    out.push("Clinical comparison across cohorts:\n" +
      (v.clinical || []).slice(0, 20).map((row) => {
        const cells = row.cells.map((c) => row.kind === "num"
          ? `${c.cohort} mean ${c.mean != null ? c.mean.toFixed(2) : "—"}` +
            (c.sd != null ? ` sd ${c.sd.toFixed(2)}` : "") + ` (n=${c.n.toLocaleString()})`
          : `${c.cohort} ` + (c.top && c.top.length
              ? c.top.slice(0, 3).map((t) => `${t.v} ${c.n ? Math.round(1000 * t.n / c.n) / 10 : 0}%`).join(", ")
              : "—")).join(" | ");
        return `  ${row.attribute} [${row.per}, ${row.kind}]: ${cells}` +
          (row.p != null ? `  ${row.test || "test"} p=${pFmt(row.p)} q=${pFmt(row.q!)}` : "") +
          (row.skipped ? `  SKIPPED: ${row.skipped}` : "");
      }).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares things recorded about the patients themselves — age, sex, a lab result, and similar details — rather than their genetics, between two or more groups. It answers whether the groups differ in ways beyond whatever genetic difference defined them, which matters for judging whether a genetic finding is really the explanation."
  },
};
