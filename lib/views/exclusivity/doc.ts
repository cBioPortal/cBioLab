// The `exclusivity` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const exclusivityDoc: KindDoc = {
  summary: "mutual exclusivity and co-occurrence of up to 20 genes against each tumour's alteration burden, DISCOVER, beside the plain Fisher test",
  reference: `\`genes:[2-20], stratifyBy?:<sample attribute>, measure?:"any"\|"driver", cohorts:[one name]\` | **mutual exclusivity against each tumour's alteration burden** (preview; DISCOVER, Canisius et al. 2016): over the cohort's samples with a gene panel (every sample of each patient), each sample and gene get a background probability σ(a_sample + b_gene), fitted so that every sample's expected number of altered genes is its observed burden and every gene's expected count its observed one — over the whole altered-gene matrix, each sample's own panels deciding which genes it has a probability for (panel-aware; a gene off its panel is not profiled there). Within each study, and within each value of \`stratifyBy\` (e.g. CANCER_TYPE) when given — the confounder DISCOVER exists to remove. For each pair, over the samples profiled for both, the co-altered count is tested against the Poisson-binomial with p_i = p_iA·p_iB: lower tail exclusivity, upper tail co-occurrence, each BH across the pairs; exact, or the refined normal approximation where the exact sum is too large (counted in the caption). The plain two-sided Fisher test on the same samples is reported beside it. More than 20 genes is refused with the limit named. Counts only; a remote peer cannot answer yet.`,
  grammar: `{"kind":"exclusivity","genes":[...(2-20)],"stratifyBy":"CANCER_TYPE"?,"measure":"any|driver","cohorts":[one name]}
  // (preview) DISCOVER: burden-aware background, Poisson-binomial tails per pair (exclusive / co-occurring), Fisher beside it`,
  examples: [
    {
      title: "Mutual exclusivity that accounts for each tumour's burden (DISCOVER)",
      snapshot: "exclusivity",
      demonstrates: "An `exclusivity` view (preview): DISCOVER's background — each sample's and gene's probability of alteration fitted from the margins of the whole altered-gene matrix, panel by panel — tests every pair's co-altered count against its Poisson-binomial null, exclusivity in the lower tail and co-occurrence in the upper, beside the plain Fisher test that assumes every tumour is alike.",
      tags: ["mutual exclusivity", "co-occurrence", "lung", "preview"],
      note: "MSK-IMPACT non-small cell lung cancer, 1,680 samples. The oncogenic drivers stay exclusive (KRAS/EGFR 19 together against 170 expected, q≈1e-56), and so do EGFR with STK11 and KEAP1; STK11/KEAP1 co-occur. What moves is what the burden explains: Fisher calls EGFR/TP53 co-occurring (q≈2e-7) because both mark heavily altered tumours, while DISCOVER expects 300 together and sees 294 (q 0.45); KEAP1/TP53, null by Fisher, turns exclusive.",
      doc: {
        study: "msk_impact_2017",
        cohorts: { "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
        views: [{ kind: "exclusivity", cohorts: ["NSCLC"], genes: ["KRAS", "EGFR", "BRAF", "STK11", "KEAP1", "TP53"] }]
      }
    }
  ],
};
