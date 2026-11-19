// Planted bugs: the Patient mutation table's Cohort % (PAT-STM-2), the portal's variant counts. How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cohort-pct-no-keyword-shown", layer: "statistics", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "A mutation with no keyword (TCGA-A6-2671 CPD N210_D215del) shows a Cohort %, where the portal's variant counts give it none.",
    find: "if(g.kw != '' AND ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq",
    replace: "if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq" },
];
