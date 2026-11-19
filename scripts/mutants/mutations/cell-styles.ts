// Planted bugs: the Mutations table's Protein Change and MS cells (MUT-COL-6, MUT-COL-19). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "protein-change-germline-case", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A call whose status is \"GERMLINE\" (any case but \"Germline\") gets no Germline tag beside its protein change.",
    find: "germline: /germline/i.test(status ?? \"\")", replace: "germline: (status ?? \"\") === \"Germline\"" },
  { id: "protein-change-not-truncated", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A long protein change is shown whole instead of cut at 40 characters.",
    find: "shown: truncate(full, 40)", replace: "shown: full" },
  { id: "status-germline-before-somatic", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A status naming both somatic and germline shows G, where the portal checks somatic first.",
    find: "  if (low.includes(\"somatic\")) return { kind: \"somatic\", text: \"S\", tip: v };\n  if (low.includes(\"germline\")) return { kind: \"germline\", text: \"G\", tip: v };",
    replace: "  if (low.includes(\"germline\")) return { kind: \"germline\", text: \"G\", tip: v };\n  if (low.includes(\"somatic\")) return { kind: \"somatic\", text: \"S\", tip: v };" },
  { id: "status-unknown-dropped", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A status other than somatic or germline (LOH) is shown blank, where the portal writes it small and grey.",
    find: "return { kind: \"other\", text: v, tip: null };", replace: "return { kind: \"none\", text: \"\", tip: null };" },
];
