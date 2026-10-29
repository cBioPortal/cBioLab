// The `clinical` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const clinicalDoc: KindDoc = {
  summary: "attribute distributions per cohort",
  reference: `\`attributes:[\u22641-20], cohorts:[names]\` | compares clinical attribute distributions across cohorts. Categorical: Pearson chi-squared over the **full** value vocabulary, any number of cohorts. Numeric: Welch's unequal-variance t-test for exactly 2 cohorts, **Welch's ANOVA for 3+** \u2014 both from (n, \u03a3x, \u03a3x\u00b2) per cohort, additive across sites, so pooled mean/variance are exact and no individual value is transmitted, at any study count. BH q across attributes (moment-based test only). Each site types its own attributes from \`clinical_attribute_meta\`; disagreements are refused, not merged. **Single-study views only:** numeric attributes also report median/IQR, and a rank-based test alongside the moment-based one \u2014 a Mann-Whitney U for exactly 2 cohorts, **Kruskal-Wallis for 3+** \u2014 a check worth having when the mean is misleading (skew, outliers); computed from the complete value distribution, which is exact only when the whole comparison stays within one study, so it is not offered otherwise, and not part of the q-value correction above`,
  grammar: `{"kind":"clinical","attributes":[...(1-20)],"cohorts":[names?]}`,
};
