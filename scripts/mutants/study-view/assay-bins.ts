// Planted bugs: generic-assay bars by the portal's DataBinner (STS-BAR-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "assay-bins-first-connection-only", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "A generic-assay chart over studies on two databases bins only the first database's values, so its bars leave the other studies' samples out.",
    find: "const bins = dataBins(counted.flatMap(", replace: "const bins = dataBins(counted.slice(0, 1).flatMap(" },
];
