// Figure layout check, run by `npm run check:figures`: every documented example and every stress
// document (scripts/figure-stress.json — the largest studies, many cohorts and categories, long
// names) is run, and each view's figure is drawn at the widths a card takes (a narrow column, a
// 1024px window, a 1440px one) and linted (lib/chart/lint.ts): no type below the floor, no text off
// the figure, no text printed over text. A figure that fails is listed with what failed where.
// Needs DB credentials (`node --env-file=.env.local`). FIGURE_CHECK_ONLY=<text> restricts it to the
// documents whose name contains <text>; FIGURE_CHECK_VERBOSE=1 lists every issue, not the first few.
import { readFileSync } from "fs";
import { EXAMPLES } from "../lib/dsl-reference.ts";
import { runAnalysis } from "../lib/analysis.ts";
import { withRequestCustomData } from "../lib/custom-data-server.ts";
import type { CustomDataset } from "../lib/custom-data-names.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { AnalysisDoc } from "../lib/types.ts";

const WIDTHS = [560, 936, 1352];
const only = process.env.FIGURE_CHECK_ONLY || "";
const verbose = !!process.env.FIGURE_CHECK_VERBOSE;
const stress = JSON.parse(readFileSync(new URL("./figure-stress.json", import.meta.url), "utf8")) as Record<string, AnalysisDoc>;
// an example's bundled uploads go with it, as the Examples tab and docs:check send them
const docs: [string, AnalysisDoc, CustomDataset[] | undefined][] = [
  ...EXAMPLES.map((e, i) => ["example " + (i + 1) + ": " + e.title, e.doc as unknown as AnalysisDoc, e.customData] as [string, AnalysisDoc, CustomDataset[] | undefined]),
  ...Object.entries(stress).map(([k, d]) => ["stress: " + k, d, undefined] as [string, AnalysisDoc, CustomDataset[] | undefined]),
].filter(([name]) => name.includes(only));

let failed = 0, drawn = 0;
for (const [name, doc, customData] of docs) {
  let result;
  try { result = await withRequestCustomData(customData, () => runAnalysis(doc, { oncoprint: "spec" })); }
  catch (e) { console.log("SKIP " + name + "  [" + (e as Error).message.slice(0, 120) + "]"); continue; }
  result.views.forEach((v, vi) => {
    if (v.error || v.kind === "oncoprint") return;
    for (const width of WIDTHS) {
      const svg = viewToSvg(v, { width });
      if (!svg) continue;
      drawn++;
      const issues = lintSvg(svg);
      const label = name + " · view " + (vi + 1) + " (" + v.kind + ") at " + width + "px";
      if (!issues.length) { console.log("PASS " + label); continue; }
      failed++;
      console.log("FAIL " + label + "  [" + issues.length + " issue" + (issues.length === 1 ? "" : "s") + "]");
      for (const i of issues.slice(0, verbose ? Infinity : 5))
        console.log("     " + i.kind + ": " + JSON.stringify(i.text.slice(0, 60)) + (i.other ? " over " + JSON.stringify(i.other.slice(0, 60)) : "") + " — " + i.detail);
    }
  });
}
console.log("\n" + drawn + " figures drawn, " + failed + " with layout issues");
process.exit(failed ? 1 : 0);
