// Planted bugs: the table's header text-filter conditions (MUT-TB-6). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "filter-not-begins-keeps-begins", layer: "counts", guard: "unit", file: "lib/table-query.ts",
    effect: "\"does not begin with\" keeps the rows that do begin with the text, the opposite of the portal's.",
    find: "case \"notStartsWith\": return \"NOT startsWith(\"", replace: "case \"notStartsWith\": return \"startsWith(\"" },
  { id: "filter-not-ends-case-sensitive", layer: "counts", guard: "unit", file: "lib/table-query.ts",
    effect: "\"does not end with\" compares case-sensitively, so \"g12d\" keeps a G12D row the portal drops.",
    find: "case \"notEndsWith\": return \"NOT endsWith(\" + lx + \", \" + lv + \")\";", replace: "case \"notEndsWith\": return \"NOT endsWith(\" + x + \", \" + v + \")\";" },
  { id: "filter-empty-text-filters", layer: "counts", guard: "unit", file: "lib/table-query.ts",
    effect: "A text condition with no text filters rows (\"does not contain\" nothing keeps none) where the portal keeps every row.",
    find: "  if (f.value === \"\") return \"1\";\n", replace: "" },
];
