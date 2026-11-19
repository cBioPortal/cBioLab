// Planted bugs: the Download tab case table's per-alteration columns, hidden at first (RDL-3.3)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-alt-columns-shown",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "The per-alteration columns (KRAS: MUT, KRAS: AMP, …) are shown from the start, where the portal hides them.",
    find: "const defs = cols.map((c) => c.id).filter((c) => !c.startsWith(\"alt_\"));",
    replace: "const defs = cols.map((c) => c.id);" },
  { id: "download-alt-columns-line-order",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/tables.ts",
    effect: "A gene's columns follow its lines in query order, where the portal puts a later line's commands first.",
    find: "for (const l of lines.filter((x) => x.gene === gene).reverse())",
    replace: "for (const l of lines.filter((x) => x.gene === gene))" },
  { id: "download-alt-columns-off-panel-profiled",
    layer: "counts",
    guard: "results-oql",
    file: "lib/views/datafiles/tables.ts",
    effect: "A sample whose panel leaves the gene out reads \"no alteration\" in its per-alteration columns, where the portal writes \"not profiled\".",
    find: "lines.some((l) => l.gene === c.gene && l.types.includes(type)) ? profiledIn(pre, c.gene, type, \"s.sid\") : \"0\"",
    replace: "\"1\"" },
];
