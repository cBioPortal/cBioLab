// Planted bugs: the mutation table's Cancer Type Detailed as the portal's tumour-type map (MUT-COL-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cancer-type-detailed-fusions-blank", layer: "counts", guard: "mutation-fusions", file: "lib/mutation-table.ts",
    effect: "A fusion row's Cancer Type Detailed is blank, its sample's type not looked up.",
    find: "sampleTumorTypeCte(\"ct\" + i, p.study, db, \"SELECT sid FROM m\" + i + \" UNION ALL SELECT sid FROM v\" + i)",
    replace: "sampleTumorTypeCte(\"ct\" + i, p.study, db, \"SELECT sid FROM m\" + i)" },
  { id: "cancer-type-detailed-no-study-fallback", layer: "counts", guard: "mutation-columns", file: "lib/mutation-table.ts",
    effect: "A sample with neither cancer-type attribute shows a blank Cancer Type Detailed, where the portal shows its study's cancer type.",
    find: "nullIf(ct.tumorType, '') AS cancerType, m.proteinChange AS proteinChange",
    replace: "nullIf(if(ct.tumorType = (SELECT t.name FROM \" + db + \".cancer_study cs JOIN \" + db + \".type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id WHERE cs.cancer_study_identifier = \" + sq(p.study) + \"), '', ct.tumorType), '') AS cancerType, m.proteinChange AS proteinChange" },
];
