// The `drivernegative` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const drivernegativeDoc: KindDoc = {
  summary: "one cohort split into patients with and without an OncoKB driver in a canonical driver list, panel-aware, and every other gene's frequency compared between them",
  reference: `\`drivers?:["<symbol>" ×≤40] (default EGFR, KRAS, ALK, ROS1, BRAF, MET, RET, ERBB2, NTRK1, NTRK2, NTRK3), alteration?:"mutation"\|"sv"\|"cna", measure?:"any"\|"driver", minAltered?:5, label?:12, cohorts:[1 name]\` | **driver-negative analysis within one cohort**: each patient sequenced for mutations is driver-positive with an OncoKB driver (oncogenic or likely oncogenic, at the pin: a called mutation, a high-level copy-number call or a structural variant) in one of \`drivers\`; else driver-negative when a mutation panel of theirs covers every listed gene (or whole-exome); else "not fully profiled" — counted, in neither group, never driver-negative. Then every other gene's \`alteration\` (default mutation; \`sv\` counts either fusion partner) frequency is compared between the two groups in PATIENTS over the patients profiled for that gene (panel-aware as \`enrichment\` counts, an off-panel call left out): two-sided Fisher, Benjamini–Hochberg q, log2 of the driver-negative share over the driver-positive one. Drawn as the group split and a volcano, with the genes most enriched in the driver-negative group. Counts only.`,
  grammar: `{"kind":"drivernegative","drivers":["EGFR","KRAS","ALK",...]?,"alteration":"mutation|sv|cna","measure":"any|driver","minAltered":5,"cohorts":[one name]}
  // driver-positive vs driver-negative (panel-aware; not fully profiled kept apart), every other gene compared (Fisher, BH)`,
};
