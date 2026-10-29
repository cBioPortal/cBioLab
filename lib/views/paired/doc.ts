// The `paired` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const pairedDoc: KindDoc = {
  summary: "primary-vs-metastasis or before-vs-after-treatment concordance within patients; omit genes to scan every gene, pairBy.studies to pool studies that label samples differently",
  reference: `\`genes?:[≤20], top?:1-40, pairBy?:{attribute, a, b, studies?:{<study>:{attribute, a, b}}, labels?:{a, b}}, measure?:"driver"\|"any", cohorts:[names] (≤3)\` | **paired samples within patients**: among patients with at least one sample on each side of \`pairBy\` (a SAMPLE-level attribute and its values for side a and side b — default \`SAMPLE_TYPE\` Primary / Metastasis; values fold on case and whitespace like every clinical predicate), per gene, the patients with a driver (or, with \`measure:"any"\`, any alteration) on both sides, on side a only, on side b only — counted only among patients profiled for that gene on BOTH sides by each side's own panels, so a gene one side never assayed never reads as discordant. A patient with several samples on a side is altered there if any is. Concordance = both ÷ altered anywhere; an exact McNemar test (two-sided binomial on the discordant patients) asks whether discordance runs one way, BH q across the genes of each cohort. When no patient has both sides, the refusal lists the values the attribute actually takes. Sample type records where tissue came from, not when — the caption says "metastasis-only" is not "acquired later". Counts only; a remote peer cannot answer yet and is named. **Without \`genes\` it scans**: every gene with a driver (or any alteration) in some paired patient is tested, q is Benjamini–Hochberg across all of them, and the \`top\` (default 20) most one-sided are drawn, ordered by McNemar p — how to ask "what is acquired after treatment" without naming genes first. **\`pairBy.studies\`** gives each study its own attribute and values (PRE-TX / POST-TX in one, pre-treatment / post-treatment in another) so their patients pool into one count; a study not listed uses the top-level attribute, and \`labels\` names the two sides in the figure (default: their values). With an attribute other than a sample site, the caption says the sides are as each study labels them, and that a side-only call can also be a subclone one biopsy missed or a lower-purity sample under-calling`,
  grammar: `{"kind":"paired","genes":[...(max 20)]?,"top":20?,"pairBy":{"attribute":"SAMPLE_TYPE","a":"Primary","b":"Metastasis",
   "studies":{"<study>":{"attribute":"...","a":"...","b":"..."}}?,"labels":{"a":"before","b":"after"}?}?,
 "measure":"driver|any","cohorts":[names?(max 3)]}
  // patients with both kinds of sample: per gene, altered on both / a only / b only; McNemar test.
  // no genes = scan every altered gene, draw the top most one-sided; studies = per-study sides, pooled`,
  examples: [
    {
      title: "Paired samples: what differs between a patient's primary and metastasis",
      snapshot: "paired",
      demonstrates: "A `paired` view: among patients with both a primary and a metastatic sample, per gene, how often a driver is on both, only the primary or only the metastasis — counted only where each side's own panel covered the gene — with an exact McNemar test of whether discordance runs one way. A patient-level comparison computed entirely inside the database; only the four counts per gene leave it.",
      tags: ["metastasis", "evolution"],
      note: "MSK-IMPACT, the 2,278 patients sequenced at both a primary and a metastatic site. Truncal drivers agree (TP53 78% concordant); what the metastasis alone carries is the resistance biology — ESR1 mutations (49 metastasis-only against 7 primary-only) and AR alterations (71 against 1), both selected under hormone therapy — and MYC amplification and CDKN2A loss.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "paired", cohorts: ["all patients"], genes: ["TP53", "KRAS", "PIK3CA", "ESR1", "AR", "CDKN2A", "MYC", "TERT"] }]
      }
    },
    {
      title: "Paired samples, every gene: what the metastasis carries that the primary does not",
      demonstrates: "A `paired` view with no `genes`: it scans every gene with a driver in some patient sampled at both a primary and a metastatic site, tests each with an exact McNemar test, takes Benjamini–Hochberg q across all of them, and draws the most one-sided — the question asked without guessing the answer's genes first.",
      tags: ["metastasis", "evolution", "scan"],
      note: "MSK-IMPACT again, the 2,278 patients with both kinds of sample, but no gene list. Of 347 genes with a discordant patient, the scan puts AR (71 metastasis-only against 1 primary-only) and ESR1 (49 against 7) first — the hormone-therapy resistance genes the hand-picked version above had to be told to look at — followed by MYC, NKX3-1 and PTEN.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "paired", cohorts: ["all patients"], top: 15 }]
      }
    },
    {
      title: "Before and after treatment, pooled across studies that label it differently",
      snapshot: "pooled-paired",
      demonstrates: "A `paired` view whose `pairBy.studies` gives each study its own before/after attribute and values — five studies, five spellings — so their patients pool into one before-vs-after count per gene, scanned across every driver gene, with `labels` naming the sides.",
      tags: ["treatment", "resistance", "scan"],
      note: "111 patients with a sample on each side across gastroesophageal (two studies), breast (alpelisib, and a second cohort) and bladder cancer. At this size nothing survives correction across the 278 genes tested — the honest answer — and the most one-sided genes run the other way: CCND1 and MYC amplifications seen before treatment and not after (10 and 10 patients against 1 and 2), as a lower-purity post-treatment sample would also show. Read it as a lead, not a finding; the same view over a large serially sampled cohort is where acquired resistance would show.",
      doc: {
        study: "egc_msk_2017",
        cohorts: { "before and after treatment": { studies: ["egc_msk_2017", "breast_alpelisib_2020", "egc_trap_ccr_msk_2023", "blca_cornell_2016", "brca_dldccc_2022"], all: [] } },
        views: [{ kind: "paired", cohorts: ["before and after treatment"], top: 12, pairBy: { labels: { a: "before", b: "after" }, studies: {
          egc_msk_2017: { attribute: "IMPACT_PRE_POST", a: "PRE-TX", b: "POST-TX" },
          breast_alpelisib_2020: { attribute: "SAMPLE_COLLECTION_TIMEPOINT", a: "pre-treatment", b: "post-treatment" },
          egc_trap_ccr_msk_2023: { attribute: "PRE_OR_POST_TREATMENT", a: "Pre", b: "Post" },
          blca_cornell_2016: { attribute: "SPECIMEN_COLLECTION_PRE_OR_POST_CHEMO", a: "pre-chemotherapy", b: "post-chemotherapy" },
          brca_dldccc_2022: { attribute: "TREATMENT_STATUS", a: "Pre-Treatment", b: "Post-Treatment" } } } }]
      }
    }
  ],
};
