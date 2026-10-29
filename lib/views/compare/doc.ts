// The `compare` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const compareDoc: KindDoc = {
  reference: `\`genes:[≤20], cohorts:[names]\` | per-gene driver% / altered% per cohort with **panel-aware denominators** (profiled patients only); two-sided Fisher p for exactly 2 cohorts, a Pearson chi-squared (2×N table, altered vs not) for 3+; either way, q-values are Benjamini–Hochberg across the genes tested, separately for any-alteration and driver-only. \`altered%\` combines mutation/CNA/structural-variant, matching the oncoprint's "any alteration" convention; each cell also carries the same three counts split by type, and if a WHOLE type was never assayed anywhere in the participating studies (e.g. no copy-number data at all) the view says so rather than let a false 0% for that type alone read as a real negative`,
  grammar: `{"kind":"compare","genes":[...(max 20)],"cohorts":[names?]}`,
};
