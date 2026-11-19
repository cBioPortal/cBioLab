// Planted bugs: a gene table's selection drawn as the portal's filter bar draws it (STV-FB-3 #9). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-pill-cna-one-colour", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Every copy-number gene pill is drawn red, so a deep deletion reads as an amplification.",
    find: ": g.cna.options.find((o) => o.bit === m[2])!.color;", replace: ": g.cna.options[0].color;" },
  { id: "gene-pill-remove-takes-clause", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Removing one gene of a gene-table selection removes the whole selection, every other gene with it.",
    find: "if (rest.length) all[clause] = { ...c, q: rest.join(\"; \") } as never; else all.splice(clause, 1);", replace: "all.splice(clause, 1);" },
];
