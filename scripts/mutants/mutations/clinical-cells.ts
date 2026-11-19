// Planted bugs: the clinical attributes' cells and headers in the Mutations table (MUT-COL-36). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-cut-without-buffer", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A 31- or 32-character value is cut, where the portal's TruncatedText leaves it whole (its buffer of 2).",
    find: "return text.length > 32 ? {", replace: "return text.length > 30 ? {" },
  { id: "clinical-na-no-tip", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A clinical cell with no value says nothing, where the portal's tip says the attribute is not available for the sample.",
    find: "if (value == null || value === \"\") return { text: \"\", tip: CLINICAL_NA_TIP };", replace: "if (value == null || value === \"\") return { text: \"\", tip: null };" },
  { id: "clinical-header-no-description", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "A clinical column's header has no tooltip, where the portal's shows the attribute's description.",
    find: "const description = String(m.description ?? \"\").trim();", replace: "const description = \"\";" },
];
