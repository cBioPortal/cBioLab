// Planted bugs: #318, a box plot's Filter categories and Sort Categories by Median (PLT-AX-9, PLT-AX-10, PLT-STM-9). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "box-categories-filter-ignored", layer: "counts", guard: "unit", file: "lib/views/plot/run.ts",
    effect: "A box plot's \"Filter categories\" draws every category's box though the view names only some.",
    find: "const keep = pv.categories && pv.categories.length ? new Set(pv.categories) : null;",
    replace: "const keep = null as Set<string> | null;" },
  { id: "box-sort-log-median", layer: "counts", guard: "unit", file: "lib/views/plot/run.ts",
    effect: "\"Sort Categories by Median\" on a log axis orders the boxes by the log values' median, where the portal orders them by the raw values' (an even count can swap two boxes).",
    find: "return vs && vs.length === g.n ? portalBox(vs)!.median : rule ? fromLog(rule, g.median) : g.median;",
    replace: "return g.median;" },
];
