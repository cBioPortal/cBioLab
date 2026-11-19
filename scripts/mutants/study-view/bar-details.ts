// Planted bugs: a bar chart's tooltip, log-scale ticks and Log Scale toggle as the portal's (STS-BAR-3, -4, -7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "log-toggle-keeps-filter", layer: "cohorts", guard: "unit", file: "lib/study-view-bins.ts",
    effect: "Switching Log Scale keeps the chart's filter, whose ranges were the old bars', so no bar of the redrawn chart shows what is selected.",
    find: "all: isCustomAttr(attribute) ? all : withoutAttribute(all, attribute) }", replace: "all }" },
  { id: "log-tick-half-step-labelled", layer: "counts", guard: "unit", file: "lib/chart/format.ts",
    effect: "A log-scale chart labels its half-step ticks (31, 316) as powers of ten, so two adjacent ticks read the same 10ⁿ.",
    find: "  if (Math.abs(e - k) > 1e-9) return \"\";\n", replace: "" },
  { id: "bar-range-closed-left", layer: "counts", guard: "unit", file: "lib/chart/format.ts",
    effect: "A bar's tooltip writes its interval as [20, 25], including a start the bar does not hold.",
    find: "\"(\" + n(b.start) + \", \" + n(b.end) + \"]\"", replace: "\"[\" + n(b.start) + \", \" + n(b.end) + \"]\"" },
];
