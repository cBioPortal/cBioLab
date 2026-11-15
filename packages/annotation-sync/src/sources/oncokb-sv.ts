// OncoKB for structural variants: each structural variant resolved the way the portal's Structural
// Variants tab asks OncoKB about it — its two genes, OncoKB's SV type and the sample's tumour type
// (oncokb-frontend-commons generateAnnotateStructuralVariantQuery) — so the call and its levels are
// the pair's in the sample's cancer, not a partner gene's. Stored in `annotation.oncokb_sv` (sql/005),
// licensed like `annotation.oncokb` and written by the same writer. `data` is OncoKB's whole answer.
//
// The key is what the portal deduplicates its queries on (generateQueryStructuralVariantId): site 1's
// and site 2's Entrez ids ('' where a site names no gene), the SV type and the tumour type ('' when
// none). The SV type is FUSION when both sites name a gene; with one, the variant's class when it is
// exactly one of OncoKB's types, else UNKNOWN. The tumour type is the one tumorTypeKeySpace gives a
// mutation. A key is asked when either partner is a gene OncoKB curates; any other is stored unasked,
// with an empty oncogenicity, so the sync does not pick it up again.
import type { Row } from "@cbiolab/clickhouse";
import { sq } from "@cbiolab/clickhouse";
import type { AnnotationSource } from "../source.ts";
import { oncokbFetch, oncokbSource } from "./oncokb.ts";
import { curatedGenes, sampleTumorTypesSql, studyTumorTypesSql } from "./oncokb-tumor-type.ts";

export const ONCOKB_SV_TABLE = "annotation.oncokb_sv";

/** the SV types OncoKB takes for a one-gene variant, matched exactly (deriveStructuralVariantType) */
const ONE_GENE_TYPES = ["DELETION", "TRANSLOCATION", "DUPLICATION", "INSERTION", "INVERSION", "FUSION"];

/** a site's Entrez id as the key holds it: '' where the site names no gene */
const site = (col: string) => "if(ifNull(" + col + ", 0) = 0, '', toString(" + col + "))";

/** The key space's SQL: one row per distinct (site 1, site 2, SV type, tumour type) of a study's structural variants. */
export function svKeySpace(portalDb: string, study: string | null): string {
  const only = study == null ? "" : " AND cs.cancer_study_identifier = " + sq(study);
  const genes = "(ifNull(g1.hugo_gene_symbol, '') != '') + (ifNull(g2.hugo_gene_symbol, '') != '')";
  return (
    "SELECT site1_entrez, site2_entrez, sv_type, tumor_type FROM (" +
    "SELECT " + site("sv.site1_entrez_gene_id") + " AS site1_entrez, " + site("sv.site2_entrez_gene_id") + " AS site2_entrez, " +
    "if(" + genes + " >= 2, 'FUSION', if(ifNull(sv.class, '') IN (" + ONE_GENE_TYPES.map(sq).join(", ") + "), sv.class, 'UNKNOWN')) AS sv_type, " +
    "if(c.sample_unique_id = '', ifNull(st.name, ''), if(c.n_detailed > 0, c.detailed, '')) AS tumor_type" +
    " FROM " + portalDb + ".structural_variant sv" +
    " INNER JOIN " + portalDb + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id" +
    " INNER JOIN " + portalDb + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id" +
    " INNER JOIN " + portalDb + ".sample smp ON smp.internal_id = sv.sample_id" +
    " LEFT JOIN " + portalDb + ".gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id" +
    " LEFT JOIN " + portalDb + ".gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id" +
    " LEFT JOIN (" + sampleTumorTypesSql(portalDb, study) + ") c ON c.sample_unique_id = concat(cs.cancer_study_identifier, '_', smp.stable_id)" +
    " LEFT JOIN (" + studyTumorTypesSql(portalDb) + ") st ON st.study = cs.cancer_study_identifier" +
    " WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND (ifNull(sv.site1_entrez_gene_id, 0) != 0 OR ifNull(sv.site2_entrez_gene_id, 0) != 0)" + only +
    ") GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type"
  );
}

interface Annotation {
  oncogenic?: string; mutationEffect?: { knownEffect?: string };
  highestSensitiveLevel?: string; highestResistanceLevel?: string; highestDiagnosticImplicationLevel?: string; highestPrognosticImplicationLevel?: string;
}

/** The portal's query for one key (generateAnnotateStructuralVariantQuery, generateQueryStructuralVariantId). */
export function structuralVariantQuery(k: Row) {
  const s1 = String(k.site1_entrez), s2 = String(k.site2_entrez), type = String(k.sv_type), tumorType = String(k.tumor_type) || null;
  const genes = [s1, s2].filter((g) => g !== "").map(Number);
  // the API omits an absent site's Entrez id, which the portal's template literal writes as "undefined"
  let id = (s1 || "undefined") + "_" + (s2 || "undefined") + "_" + type;
  if (tumorType) id += "_" + tumorType;
  return {
    id: id.trim().replace(/\s/g, "_"),
    geneA: { entrezGeneId: genes[0] },
    geneB: { entrezGeneId: genes[1] ?? genes[0] },
    structuralVariantType: type,
    functionalFusion: genes.length > 1,
    tumorType
  };
}

const keyRow = (k: Row): Row => ({
  site1_entrez: String(k.site1_entrez), site2_entrez: String(k.site2_entrez), sv_type: String(k.sv_type), tumor_type: String(k.tumor_type)
});

export function storeRow(k: Row, a: Annotation | undefined): Row {
  return {
    ...keyRow(k),
    oncogenicity: a?.oncogenic || "Unknown",
    mutation_effect: a?.mutationEffect?.knownEffect || "",
    highest_sensitive_level: a?.highestSensitiveLevel || "",
    highest_resistance_level: a?.highestResistanceLevel || "",
    highest_diagnostic_level: a?.highestDiagnosticImplicationLevel || "",
    highest_prognostic_level: a?.highestPrognosticImplicationLevel || "",
    data: a ? JSON.stringify(a) : ""
  };
}

/** A key with no partner OncoKB curates: stored without asking, oncogenicity empty. */
const uncuratedRow = (k: Row): Row => ({
  ...keyRow(k), oncogenicity: "", mutation_effect: "", highest_sensitive_level: "", highest_resistance_level: "",
  highest_diagnostic_level: "", highest_prognostic_level: "", data: ""
});

export const oncokbSvSource: AnnotationSource = {
  id: "oncokb_sv",
  label: "OncoKB for structural variants",
  table: ONCOKB_SV_TABLE,
  versionColumn: "oncokb_version",
  keyColumns: ["site1_entrez", "site2_entrez", "sv_type", "tumor_type"],
  writer: "oncokb",
  needs: ["ONCOKB_TOKEN"],
  batchSize: Number(process.env.ONCOKB_BATCH_SIZE || 100),
  batchDelayMs: Number(process.env.ONCOKB_BATCH_DELAY_MS || 300),
  ddl: [
    "CREATE TABLE IF NOT EXISTS " + ONCOKB_SV_TABLE + " (oncokb_version LowCardinality(String), site1_entrez String, site2_entrez String, " +
      "sv_type LowCardinality(String), tumor_type LowCardinality(String), oncogenicity LowCardinality(String), " +
      "mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), highest_resistance_level LowCardinality(String), " +
      "highest_diagnostic_level LowCardinality(String), highest_prognostic_level LowCardinality(String), data String CODEC(ZSTD(3)), " +
      "api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
      "PARTITION BY oncokb_version ORDER BY (oncokb_version, site1_entrez, site2_entrez, sv_type, tumor_type)"
  ],
  keySpace: svKeySpace,
  release: () => oncokbSource.release(),

  async annotate(keys: Row[]): Promise<Row[]> {
    const genes = await curatedGenes();
    const curated = (k: Row) => [k.site1_entrez, k.site2_entrez].some((g) => String(g) !== "" && genes.has(Number(g)));
    const ask = keys.filter(curated);
    const rows = keys.filter((k) => !curated(k)).map(uncuratedRow);
    if (ask.length) {
      const out = await oncokbFetch("/annotate/structuralVariants", ask.map(structuralVariantQuery)) as Annotation[];
      if (!Array.isArray(out) || out.length !== ask.length) throw new Error("OncoKB answered " + (Array.isArray(out) ? out.length : "no list") + " for " + ask.length + " queries");
      ask.forEach((k, i) => rows.push(storeRow(k, out[i])));
    }
    return rows;
  }
};
