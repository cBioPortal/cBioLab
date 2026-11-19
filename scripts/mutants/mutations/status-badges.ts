// Planted bugs: the Mutations tab's Somatic / Germline badges (MUT-HD-3, MUT-FM-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "status-none-keeps-all", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "With both badges off the tab keeps every mutation, where the portal keeps none.",
    find: "  return { values: [] };\n}", replace: "  return undefined;\n}" },
  { id: "status-badge-inverted", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "Turning Somatic off keeps the somatic mutations instead of the germline ones.",
    find: "value: sel.somatic ? \"somatic\" : \"germline\"", replace: "value: sel.somatic ? \"germline\" : \"somatic\"" },
  { id: "status-filter-other-gene", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A badge on one gene keeps the table query of another gene, so the lollipop is narrowed by the wrong gene's search.",
    find: "const base = table && table.gene === gene ? table : ({ gene } as T);", replace: "const base = table ? { ...table, gene } : ({ gene } as T);" },
  { id: "status-not-linked-to-table", layer: "counts", guard: "unit", file: "app/portal/results-layout.ts",
    effect: "The badges narrow the lollipop but not the mutation table under it.",
    find: "if (status) filters[STATUS_COLUMN] = status; else delete filters[STATUS_COLUMN];", replace: "" },
  { id: "status-badges-without-germline", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "The germline rate and the Somatic / Germline badges show for a gene with no germline mutation, where the portal shows the somatic rate alone.",
    find: "return (g.germlineSamples ?? 0) > 0 && (g.germlineCohortSamples ?? 0) > 0;", replace: "return (g.germlineCohortSamples ?? 0) > 0;" },
  { id: "status-table-outlives-gene", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "Removing a gene from the lab's lollipop keeps its table query (a badge's filter), and the view then fails as naming a gene it does not draw.",
    find: "return table && genes.includes(table.gene) ? table : undefined;", replace: "return table;" },
];
