// Planted bugs: the Mutations table's data-dependent default columns and its empty Allele Freq cell (MUT-COL-5, MUT-COL-18, MUT-COL-27). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "defaults-copy-number-always", layer: "counts", guard: "unit", file: "lib/mutation-table.ts",
    effect: "Copy # is shown by default for a study with no discrete CNA profile (lgg_ucsf_2014), where the portal hides it.",
    find: "if (f.discreteCna === false) drop.add(\"copyNumber\");", replace: "" },
  { id: "defaults-vaf-always", layer: "counts", guard: "unit", file: "lib/mutation-table.ts",
    effect: "Allele Freq (T) is shown by default when no row has a frequency (stad_tcga_pub TP53), where the portal hides it.",
    find: "if (f.nonZeroVaf === false) drop.add(\"vaf\");", replace: "" },
  { id: "defaults-one-cancer-type-shown", layer: "counts", guard: "unit", file: "lib/mutation-table.ts",
    effect: "Cancer Type Detailed is shown by default when every row has the same type (prad TMPRSS2), where the portal shows it only for more than one.",
    find: "f.cancerTypes <= 1", replace: "f.cancerTypes < 1" },
  { id: "defaults-any-cna-profile", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "A continuous copy-number profile alone shows Copy # by default, where the portal needs a discrete one.",
    find: "p.type === \"COPY_NUMBER_ALTERATION\" && p.datatype === \"DISCRETE\"", replace: "p.type === \"COPY_NUMBER_ALTERATION\"" },
  { id: "defaults-blank-type-counted", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "A sample without Cancer Type Detailed counts as a second type, so the column is shown for a one-type table.",
    find: "types.values.filter((x) => x.value !== \"\").length", replace: "types.values.length" },
  { id: "defaults-cna-every-study", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "Copy # is hidden by default unless every queried study has a discrete CNA profile, where the portal shows it when any does.",
    find: "catalogs.some((c) => c!.some(", replace: "catalogs.every((c) => c!.some(" },
  { id: "vaf-empty-cell-no-tip", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "An Allele Freq (T) cell with no frequency is blank with no tooltip, where the portal's says \"Data not available.\".",
    find: "return value == null || value === \"\" ? \"Data not available.\" : null;", replace: "return null;" },
  { id: "defaults-unanswered-catalog-no-copy-number", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "A study whose profiles could not be read (a peer that did not answer) hides Copy #, where an unknown answer should keep it.",
    find: "catalogs.every((c) => c && c.length)", replace: "catalogs.every((c) => c)" },
  { id: "lollipop-search-fixed-columns", layer: "counts", guard: "unit", file: "lib/views/hotspots/run.ts",
    effect: "A search of the mutation table narrows the lollipop over the fixed eight default columns, so the plot keeps rows the table (showing fewer columns) does not.",
    find: "if (narrowing && narrowing.search && !narrowing.columns?.length)", replace: "if (false)" },
];
