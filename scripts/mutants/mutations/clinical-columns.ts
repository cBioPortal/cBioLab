// Planted bugs: the mutation table's clinical-attribute columns (MUT-COL-36). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-patient-read-as-sample", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "A patient attribute (SEX, AGE) is read from the sample's map, so its column is blank on every row.",
    find: "const map = row[c.per === \"patient\" ? CLIN_PATIENT : CLIN_SAMPLE]", replace: "const map = row[CLIN_SAMPLE]" },
  { id: "clinical-number-as-text", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "A NUMBER attribute's column holds text, so it sorts as text (\"10\" before \"9\") and takes no range filter.",
    find: "numeric: String(m.datatype ?? \"\").toUpperCase() === \"NUMBER\"", replace: "numeric: false" },
  { id: "clinical-cancer-type-twice", layer: "counts", guard: "unit", file: "lib/mutation-clinical.ts",
    effect: "CANCER_TYPE is offered as a clinical column beside the table's own Cancer Type column.",
    find: "\"MUTATION_COUNT\", \"CANCER_TYPE\"]", replace: "\"MUTATION_COUNT\"]" },
  { id: "clinical-filter-misses-lollipop", layer: "counts", guard: "unit", file: "lib/views/hotspots/run.ts",
    effect: "A filter on a clinical column narrows the mutation table but the lollipop is refused (or narrowed by other columns), so their counts disagree.",
    find: "if (narrowing && clinical.length) narrowing = { ...narrowing, clinical };", replace: "" },
];
