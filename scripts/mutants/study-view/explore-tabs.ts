// Planted bugs: Explore's tabs in the URL and CN Segments at 0 selected samples (STV-URL-1, STV-STM-13). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cn-info-zero-says-segmented", layer: "counts", guard: "unit", file: "lib/study-view-cn-segments.ts",
    effect: "CN Segments at 0 selected samples says \"Segmented copy-number data for the selected 0 samples.\", where there is none to read.",
    find: "(segmented === 0 || selected === 0 ? \"No segmented\"", replace: "(segmented === 0 ? \"No segmented\"" },
  { id: "svtab-unknown-opens-clinical", layer: "counts", guard: "unit", file: "lib/study-view-url.ts",
    effect: "A link without a tab, or naming one Explore does not have, opens the Clinical Data table instead of Summary.",
    find: "return hit ?? \"summary\";", replace: "return hit ?? \"clinical\";" },
];
