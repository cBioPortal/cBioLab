// The `hla` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const hlaDoc: KindDoc = {
  summary: "HLA class I genotype: the share homozygous at 0/1/2+ of HLA-A, -B, -C and with HLA LOH, and overall survival by each with log-rank and Cox HRs, optionally adjusted; patient-level studies only",
  reference: `\`resolution?:1\|2\|"full", alleles?:{A?:[first, second]\|[both], B?, C?}, lohAttributes?:[names], lohValues?:[values], endpoint?:"OS", monthsAttribute?/statusAttribute?, covariates?:["<attribute>" ×≤4], cohorts:[names] (≤3)\` | **HLA class I genotype and HLA LOH** (preview; Chowell et al. 2018, McGranahan et al. 2017): per patient, whether each of HLA-A, -B and -C carries two alleles that match at \`resolution\` fields of the allele name (default 2, protein level: hla_a_02_01_01_01, A*02:01 and A0201 all read A*02:01; 1 = allele group; "full" = every field recorded). The alleles are read from the layouts the public studies use — HLA-A1/HLA-A2 (MSK-IMPACT), HLA_A1_ALLELE(S)/HLA_A2_ALLELES, or one HLA_A attribute holding "A0201/A2402" — or from \`alleles\`. Per cohort: the share of patients typed at all three loci homozygous at 0, 1, 2 or 3, per-locus homozygosity, and the share of patients with an HLA LOH call (\`lohAttributes\`, default HLA_A1_LOH … HLA_C2_LOH and HLA_LOH, any sample) that is a loss (\`lohValues\`, default Loss/Yes/LOH/True). Then the endpoint (default OS) by homozygous at ≥1 locus against heterozygous at all, and by HLA LOH against none: Kaplan–Meier, log-rank and Cox HR (stratified by study when pooled), drawn when each group has ≥ 5 patients; with \`covariates\`, the HR adjusted for them (numbers as they are, categories against the commonest, past 10 levels pooled). A study without HLA alleles is refused, listing its HLA-named attributes. The endpoint runs from the study's own origin — a checkpoint-blockade start only in a study of treated patients that measures from it — and the caption says homozygosity then reads prognosis, not response. Patient-level studies only.`,
  grammar: `{"kind":"hla","cohorts":[names?(max 3)],"resolution":2,"alleles":{"A":["HLA-A1","HLA-A2"]}?,"lohAttributes":["HLA_A1_LOH"]?,"endpoint":"OS","covariates":["TMB_SCORE"]?}
  // (preview) % homozygous at 0/1/2+ class I loci, % HLA LOH; OS KM + Cox by homozygosity and by LOH`,
  examples: [
    {
      title: "HLA class I homozygosity and HLA loss in lung cancer, and survival",
      demonstrates: "An `hla` view (preview): from the germline HLA class I alleles MSK-IMPACT types for each patient, the share homozygous at 0, 1 or 2+ of HLA-A, -B and -C (alleles compared at two fields, A*02:01), and the share whose tumour lost an HLA allele (LOHHLA-style calls); then overall survival by homozygous-at-any-locus against fully heterozygous and by HLA LOH against none, with log-rank tests and Cox hazard ratios, unadjusted and adjusted for tumour mutational burden.",
      tags: ["immunogenomics", "hla-genotype", "prognosis", "preview"],
      note: "MSK-IMPACT 50K, non-small cell lung cancer (6,633 patients; 5,901 typed at all three loci). 22% are homozygous at one locus or more, about the share Chowell et al. report; in this cohort, not restricted to immunotherapy, homozygosity does not move overall survival (HR 1.02). HLA LOH, called in 30% of the 4,158 patients with a call, goes with shorter survival (median 32 against 48 months, HR 1.35, 1.31 adjusted for TMB) — tumour biology, not a treatment effect.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: { "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
        views: [{ kind: "hla", cohorts: ["NSCLC"], covariates: ["TMB_SCORE"] }]
      }
    },
    {
      title: "HLA class I homozygosity and survival on checkpoint blockade in melanoma",
      snapshot: "hla",
      demonstrates: "An `hla` view (preview) over three studies pooled: the melanoma checkpoint-inhibitor cohorts that record each patient's HLA-A, -B and -C as one \"A0201/A2402\" value — homozygosity per patient, then overall survival (from the start of treatment, as these studies measure it) by homozygous at any class I locus against fully heterozygous, the log-rank test and Cox model stratified by study.",
      tags: ["immunotherapy", "immunogenomics", "hla-genotype", "preview"],
      note: "Van Allen 2015 (ipilimumab), Snyder 2014 (ipilimumab) and Hugo 2016 (anti-PD-1): 212 patients, 22% homozygous at a locus or more. Homozygous patients have a median overall survival of 12 against 22 months (HR 1.22, 95% CI 0.82–1.82) — the direction Chowell et al. found pooling these and other cohorts, though 212 patients cannot show it alone. These studies record no HLA LOH, so that split says so.",
      doc: {
        study: "skcm_dfci_2015",
        cohorts: { "melanoma on checkpoint blockade": { studies: ["skcm_dfci_2015", "skcm_mskcc_2014", "mel_ucla_2016"], all: [] } },
        views: [{ kind: "hla", cohorts: ["melanoma on checkpoint blockade"] }]
      }
    }
  ],
};
