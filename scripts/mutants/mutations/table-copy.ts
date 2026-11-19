// Planted bugs: the mutation table's Copy button (MUT-TB-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "copy-refusal-silent", layer: "counts", guard: "unit", file: "app/_table/copy-text.ts",
    effect: "A browser that refuses the copy still reads as copied, so the reader pastes nothing.",
    find: "if (!ok) throw new Error(\"the browser refused to copy\");", replace: "" },
  { id: "copy-textarea-left", layer: "counts", guard: "unit", file: "app/_table/copy-text.ts",
    effect: "Each copy on a plain-http address leaves a hidden textarea of the whole table in the page.",
    find: "  area.remove();\n", replace: "" },
];
