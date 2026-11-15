// The `cooccurrence` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const cooccurrenceDoc: KindDoc = {
  summary: "pairwise 2x2 tests",
  reference: `\`genes:[2-12], oql?:["<line>", …], drivers?, exp?, prot?, ifHeld?, cohorts:[names]\` | With \`oql\` (one OQL line per entry, one gene each) the tracks are the lines, as the portal's Mutual Exclusivity tab: a bare line is its gene, a line with OQL is named by its written-back line ("KRAS: AMP") and altered where the line matches; two lines of one gene are two tracks. Pairwise co-occurrence / mutual exclusivity **within one cohort** (the first named). Each pair's 2×2 is counted among samples profiled for **both** genes, per study against that study's own panels; log₂ odds ratio, two-sided Fisher, Benjamini–Hochberg q across pairs. Across studies the test is **stratified by study** (Cochran–Mantel–Haenszel). Pairs no panel covers are reported as not assessable, never as a null result`,
  grammar: `{"kind":"cooccurrence","genes":[...(2-12)],"oql":["KRAS: MUT", "TP53: MUT HOMDEL", ...]?,"cohorts":[names?]}`,
};
