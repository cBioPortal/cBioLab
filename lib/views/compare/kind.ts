// The compare view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { compareSvg } from "./figure.ts";
import { verifiedBy, type Finding } from "../../findings.ts";

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
  findings: (v) => {
    const out: Finding[] = [];
    for (const row of v.rows) {
      const g = row.gene, test = row.cells.length > 2 ? "chi-squared, 2×" + row.cells.length : "Fisher's exact";
      for (const c of row.cells) {
        const at = "compare:" + g + ":" + c.cohort + ":";
        // unrounded, from the counts: the cell's anyPct/driverPct are rounded for display
        const pct = (k: number) => c.profiled ? 100 * k / c.profiled : null;
        out.push({ name: "profiled", value: c.profiled, gene: g, cohort: c.cohort, unit: "samples", ...verifiedBy(v, at + "profiled") },
          { name: "altered", value: c.any, gene: g, cohort: c.cohort, unit: "samples", ...verifiedBy(v, at + "altered") },
          { name: "driver_altered", value: c.driver, gene: g, cohort: c.cohort, unit: "samples", ...verifiedBy(v, at + "driver") },
          { name: "pct_altered", value: pct(c.any), gene: g, cohort: c.cohort, unit: "percent" },
          { name: "pct_driver_altered", value: pct(c.driver), gene: g, cohort: c.cohort, unit: "percent" });
      }
      const at = "compare:" + g + ":";
      if (row.pAny !== undefined) out.push({ name: "p_altered", value: row.pAny, gene: g, unit: "p", test, ...verifiedBy(v, at + "p_any") });
      if (row.pDriver !== undefined) out.push({ name: "p_driver_altered", value: row.pDriver, gene: g, unit: "p", test, ...verifiedBy(v, at + "p_driver") });
      if (row.qAny !== undefined) out.push({ name: "q_altered", value: row.qAny, gene: g, unit: "q", test: "Benjamini–Hochberg over this view's genes", ...verifiedBy(v, at + "q_any") });
      if (row.qDriver !== undefined) out.push({ name: "q_driver_altered", value: row.qDriver, gene: g, unit: "q", test: "Benjamini–Hochberg over this view's genes", ...verifiedBy(v, at + "q_driver") });
    }
    return out;
  },
  help: {
    title: "What is this?",
    text: "Compares how often specific genes are altered — mutated, gained, or lost — between two or more groups of patients. If a gene is altered much more often in one group than another, that's a clue it might be connected to whatever makes the groups different, like a cancer subtype or how patients respond to treatment."
  },
};
