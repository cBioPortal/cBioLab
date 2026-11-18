// Planted bugs: the Patient page's mutation table columns and paging (PAT-MT-1, PAT-MT-2, PAT-CNA-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
"patient-tables": ["node", "--env-file=.env.local", "scripts/check-patient-tables.ts"],
};

export const mutants: Mutant[] = [
  { id: "patient-samples-column-always", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "The Patient tables show a Samples column for a one-sample patient, where the portal leaves it out.",
    find: "!(c === \"samples\" && inView < 2)",
    replace: "true" },
  { id: "patient-copy-column-multi-sample", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "The Patient mutation table shows Copy # with several samples in view, where the portal shows it only for one sample.",
    find: "!(t === \"mutations\" && c === \"copy\" && inView > 1)",
    replace: "true" },
  { id: "patient-mutation-type-stored", layer: "counts", guard: "patient-tables", file: "lib/views/alterations/run.ts",
    effect: "The Patient mutation table's Mutation Type shows the stored type (Missense_Mutation) while its filter and search read the portal's label, so a filter on what is shown matches nothing.",
    find: "if (c.id === \"mutationType\") return mutationTypeLabel(x == null ? \"\" : String(x));",
    replace: "" },
  { id: "patient-mutation-type-filtered-raw", layer: "counts", guard: "patient-tables", file: "lib/patient-alterations.ts",
    effect: "The Patient mutation table filters, searches and sorts Mutation Type by the stored type, so \"Nonsense\" as shown finds nothing.",
    find: "{ id: \"mutationType\", name: \"Mutation Type\", numeric: false, ...mutationTypeColumn(\"mutationType\") }",
    replace: "{ id: \"mutationType\", name: \"Mutation Type\", numeric: false, text: \"mutationType\" }" },
];
