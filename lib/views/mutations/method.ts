// The mutations view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

/**
 * `drivers`: with the page's driver settings, what calls a row a putative driver under them (lib/driver-settings.ts
 * driverSourceText); without, the rule is OncoKB at the pin or a Cancer Hotspot.
 */
export function mutationsMethod(t: { gene: string; cohorts: string[]; oncokbPin: string | null; variantPins: string; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number; drivers?: string; duplicates?: number }): MethodRecord {
  const steps = tableSteps({ label: "mutations", what: t.gene + " mutation calls", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every called " + t.gene + " mutation in each cohort's samples (uncalled calls left out), with the sample's CANCER_TYPE_DETAILED and MUTATION_COUNT where recorded" +
      (t.oncokbPin ? " and the OncoKB " + t.oncokbPin + " call for its protein change" : "") +
      (t.drivers !== undefined
        ? "; a putative driver by the page's driver settings: " + t.drivers + " (each source only where it is switched on and this deployment stores it; a study's own calls and tiers only where the study holds any; with none annotating, every row is counted by its type alone)"
        : t.oncokbPin && t.variantPins ? "; a driver when OncoKB calls it oncogenic or its genomic variant is a Cancer Hotspot of its kind in the stored " + t.variantPins + " annotation (a splice-site hotspot for a splice mutation, single-residue or in-frame indel otherwise)" : "") +
      (t.variantPins ? "; HGVSc, Functional Impact, gnomAD, ClinVar, dbSNP and SIGNAL from the stored " + t.variantPins + " annotation of its genomic variant" : "") +
      "; HGVSg from its coordinates; allele frequency = variant / (variant + reference) reads, the matched normal's likewise (4 decimals below 0.01, none at 0); " +
      "Copy # the sample's call for the gene in the study's discrete copy-number profile; Exon from the canonical transcript of the stored Genome Nexus annotation. " +
      "Each structural variant with " + t.gene + " as site 1 or site 2 in the study's structural-variant profile is a row too, as the portal lists it: " +
      "its protein change built from its genes (\"A-B Fusion\", or \"A intragenic\" / \"A intergenic\"), type Fusion, site 1's chromosome and position, the variant class as its variant type" +
      (t.oncokbPin ? ", OncoKB " + t.oncokbPin + "'s call for the pair in the sample's tumour type as its annotation and the pair's call with no tumour type as its driver status (each the partners' gene-level Fusion calls where the pair has none stored)" : "") + "." +
      (t.duplicates !== undefined ? " Duplicates (" + t.duplicates + "): the rows grouped by study, patient and protein change, the count of rows beyond the first in each group, over every row whatever the search and filters (the portal's MutationUtils countDuplicateMutations, which keys on the patient id alone)." : ""),
    order: (t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + ", missing last" : "by the portal\'s annotation value (OncoKB\'s oncogenicity, then its highest sensitive, resistance, diagnostic and prognostic levels, then a Cancer Hotspot), then by codon") + ", then sample" });
  return { steps, implementation: { functions: ["mutationRowSource", "pageSql", "countsSql"], file: "lib/mutation-table.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}
