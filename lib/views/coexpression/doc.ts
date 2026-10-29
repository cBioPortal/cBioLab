// The `coexpression` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const coexpressionDoc: KindDoc = {
  reference: `\`genes:[2-12], profileType, cohorts:[names]\` | Pearson correlation between gene pairs on a continuous molecular profile, **within one cohort** (the first named). Each site reports only six sums (n, \u03a3x, \u03a3y, \u03a3xy, \u03a3x\u00b2, \u03a3y\u00b2), which are additive \u2014 so the federated correlation is exact, not approximate. Across studies a Fisher-z meta-analysis of per-study correlations is reported alongside the pooled one`,
  grammar: `{"kind":"coexpression","genes":[...(2-12)],"profileType":"<mrna profile>","cohorts":[names?]}`,
};
