// Planted bugs: the mutation table's Columns menu Freq (MUT-TB-5, MUT-STM-15). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-freq-averaged", layer: "statistics", guard: "unit", file: "lib/mutation-clinical-freq.ts",
    effect: "Freq over several studies is the last study's share, not the samples with a value over every queried sample.",
    find: "if (a === \"\") total += k; else n.set(a, (n.get(a) || 0) + k);", replace: "if (a === \"\") total = k; else n.set(a, k);" },
  { id: "clinical-freq-of-patients", layer: "statistics", guard: "mutation-columns", file: "lib/mutation-clinical-freq.ts",
    effect: "A patient attribute's Freq counts patients, where the portal counts their samples (lgg_ucsf_2014 SEX: 23 of 61, not 61).",
    find: "SELECT v.a AS a, c.sid AS sid FROM cohort AS c JOIN (\" + from(\"patient\")", replace: "SELECT v.a AS a, c.pid AS sid FROM cohort AS c JOIN (\" + from(\"patient\")" },
  { id: "clinical-tab-misses-study-of-origin", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "Study of Origin is missing from the Columns menu's Clinical tab, where the portal lists it at 100%.",
    find: "[\"studyOfOrigin\", null], ", replace: "" },
];
