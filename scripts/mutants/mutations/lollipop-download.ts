// Planted bugs: the Mutations tab's lollipop download (MUT-LP-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "lollipop-file-old-name", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "The lollipop downloads as <GENE>_mutation_diagram, where the portal names it <GENE>_lollipop.",
    find: "return gene + \"_lollipop\";", replace: "return gene + \"_mutation_diagram\";" },
  { id: "lollipop-no-pdf", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "The lollipop's download offers no PDF, where the portal's does.",
    find: "export const LOLLIPOP_FORMATS = [\"svg\", \"png\", \"pdf\"] as const;", replace: "export const LOLLIPOP_FORMATS = [\"svg\", \"png\"] as const;" },
];
