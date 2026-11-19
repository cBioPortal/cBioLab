// Planted bugs: the table search over clinical attributes' columns, STRING attributes only (MUT-COL-36). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-search-reads-numbers", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "The search matches a NUMBER attribute's value (\"42\" finds every patient aged 42), where the portal's searches STRING attributes only.",
    find: "...(c.unsearched ? { search: \"''\" } : {})", replace: "" },
  { id: "clinical-search-boolean-searched", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "A BOOLEAN attribute is searched, where the portal's passes over every attribute but STRING.",
    find: "String(m.datatype ?? \"\").toUpperCase() !== \"STRING\"", replace: "String(m.datatype ?? \"\").toUpperCase() === \"NUMBER\"" },
];
