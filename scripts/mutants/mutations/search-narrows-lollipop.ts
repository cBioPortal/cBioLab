// Planted bugs: the Mutations table's search and filters narrowing the lollipop and badges (MUT-TB-3, MUT-FM-1, MUT-FM-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "mutation-search-lollipop": ["node", "--env-file=.env.local", "scripts/check-mutation-search-lollipop.ts"],
};

export const mutants: Mutant[] = [
  { id: "lollipop-ignores-table-search", layer: "counts", guard: "mutation-search-lollipop", file: "lib/federation.ts",
    effect: "A search in the Mutations tab's table leaves the lollipop and badges counting every mutation, where the portal's follow the table.",
    find: "m AS (SELECT * FROM ma WHERE gene != ", replace: "m AS (SELECT * FROM ma WHERE 1 OR gene != " },
  { id: "lollipop-badge-filter-narrows-badges", layer: "counts", guard: "mutation-search-lollipop", file: "lib/lollipop.ts",
    effect: "Hiding a badge narrows the badges' own counts, where the portal's badge counts ignore the badge filter.",
    find: "new Set([\"alteration\", \"proteinPos\"])", replace: "new Set([\"proteinPos\"])" },
];
