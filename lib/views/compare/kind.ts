// The compare view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { compareSvg } from "./figure.ts";

export const compareKind: ViewKindDef<"compare"> = {
  kind: "compare",
  figure: (v, o) => v.rows && v.rows.length ? compareSvg(v, o) : null,
  title: () => "Alteration frequencies",
  text: (v, { out, noteOf }) => {
    const rows = v.rows.slice(0, 20).map((row) =>
      `  ${row.gene}: ` + row.cells.map((c) => `${c.cohort} ${c.driverPct}%/${c.anyPct}%`).join(" | ") +
      (row.pAny != null ? `  p=${row.pAny < 1e-4 ? row.pAny.toExponential(1) : row.pAny.toFixed(4)}` : ""));
    out.push(`Compare (driver%/any%, panel-aware denominators; annotation ${v.annotation}):\n` + rows.join("\n") +
      noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares how often specific genes are altered — mutated, gained, or lost — between two or more groups of patients. If a gene is altered much more often in one group than another, that's a clue it might be connected to whatever makes the groups different, like a cancer subtype or how patients respond to treatment."
  },
};
