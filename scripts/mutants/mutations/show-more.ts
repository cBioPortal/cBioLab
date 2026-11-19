// Planted bugs: the Mutations table's Show more pager and "(page x of y)" (MUT-TB-4, MUT-TB-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "show-more-doubles", layer: "counts", guard: "unit", file: "lib/table-pager.ts",
    effect: "Show more past 100 rows doubles the page (200, 400) instead of adding 100 each time as the portal does.",
    find: ": size + sizes[sizes.length - 1];", replace: ": size * 2;" },
  { id: "show-more-never-disabled", layer: "counts", guard: "unit", file: "lib/table-pager.ts",
    effect: "Show more stays enabled once every row is shown.",
    find: "!total || size >= total;", replace: "!total;" },
  { id: "pager-shown-for-one-page", layer: "counts", guard: "unit", file: "lib/table-pager.ts",
    effect: "The pager shows under a table of 25 rows or fewer, where the portal hides it.",
    find: "sizes[0] >= total;", replace: "sizes[0] > total;" },
  { id: "page-of-one-page", layer: "counts", guard: "unit", file: "lib/table-pager.ts",
    effect: "The title says \"(page 1 of 1)\" for a table of one page, where the portal says nothing.",
    find: "return pages > 1 ?", replace: "return pages > 0 ?" },
];
