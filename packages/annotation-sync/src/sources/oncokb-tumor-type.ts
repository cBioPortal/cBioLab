// OncoKB by tumour type: each somatic mutation resolved the way the portal's mutation table asks
// OncoKB about it — gene, protein change, mutation type and the sample's tumour type — so the
// levels of evidence, which depend on the tumour type, are those of the sample's cancer. Stored in
// `annotation.oncokb_tumor_type` (sql/004), licensed like `annotation.oncokb` and written by the same
// writer. `data` is OncoKB's whole answer, for the annotation card.
//
// The tumour type is the sample's CANCER_TYPE_DETAILED; a sample with neither CANCER_TYPE nor
// CANCER_TYPE_DETAILED (a blank value is none, as the portal's API never returns one) takes its study's cancer type; a sample with CANCER_TYPE alone has none ('',
// sent as null). Only genes OncoKB curates are asked about; any other gene's keys are stored
// unasked, with an empty oncogenicity, so the sync does not pick them up again.
import type { Row } from "@cbiolab/clickhouse";
import { sq } from "@cbiolab/clickhouse";
import type { AnnotationSource } from "../source.ts";
import { oncokbFetch, oncokbSource } from "./oncokb.ts";

export const ONCOKB_TUMOR_TYPE_TABLE = "annotation.oncokb_tumor_type";

const only = (study: string | null, col: string) => (study == null ? "" : " AND " + col + " = " + sq(study));

/**
 * Per sample with any (non-blank) cancer-type value: `sample_unique_id`, `n_detailed` (has a
 * CANCER_TYPE_DETAILED) and `detailed`. A sample absent here takes its study's type
 * (studyTumorTypesSql); one present with n_detailed 0 has none.
 */
export const sampleTumorTypesSql = (portalDb: string, study: string | null): string =>
  "SELECT sample_unique_id, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS n_detailed, " +
  "anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS detailed FROM " + portalDb + ".clinical_data_derived" +
  " WHERE type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED') AND attribute_value != ''" + only(study, "cancer_study_identifier") +
  " GROUP BY sample_unique_id";

/** each study's cancer type's name, as `study`, `name` */
export const studyTumorTypesSql = (portalDb: string): string =>
  "SELECT s.cancer_study_identifier AS study, t.name AS name FROM " + portalDb + ".cancer_study s INNER JOIN " +
  portalDb + ".type_of_cancer t ON t.type_of_cancer_id = s.type_of_cancer_id";

/** The key space's SQL: one row per distinct (gene, protein change, mutation type, tumour type) of a study's somatic mutations. */
export function tumorTypeKeySpace(portalDb: string, study: string | null): string {
  const types = sampleTumorTypesSql(portalDb, study), studyType = studyTumorTypesSql(portalDb);
  return (
    "SELECT 'MUTATION' AS alteration_type, hugo_gene_symbol, alteration, consequence, tumor_type, " +
    "toString(any(entrez)) AS entrez_gene_id, ifNull(toString(any(pstart)), '') AS protein_start, ifNull(toString(any(pend)), '') AS protein_end FROM (" +
    "SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.entrezGeneId AS entrez, m.proteinChange AS alteration, " +
    "ifNull(m.mutationType, '') AS consequence, m.proteinPosStart AS pstart, m.proteinPosEnd AS pend, " +
    "if(c.sample_unique_id = '', ifNull(st.name, ''), if(c.n_detailed > 0, c.detailed, '')) AS tumor_type" +
    " FROM " + portalDb + ".mutation_derived m" +
    " LEFT JOIN (" + types + ") c ON c.sample_unique_id = concat(m.studyId, '_', m.sampleId)" +
    " LEFT JOIN (" + studyType + ") st ON st.study = m.studyId" +
    " WHERE ifNull(m.proteinChange, '') != '' AND ifNull(m.`GENE.hugoGeneSymbol`, '') != ''" +
    " AND positionCaseInsensitive(ifNull(m.mutationStatus, ''), 'germline') = 0 AND ifNull(m.mutationType, '') != 'Fusion'" + only(study, "m.studyId") +
    ") GROUP BY hugo_gene_symbol, alteration, consequence, tumor_type"
  );
}

let curated: Promise<Set<number>> | null = null;
/** The Entrez ids of the genes OncoKB curates (its cancer gene list's `oncokbAnnotated`), asked once per process. */
export function curatedGenes(): Promise<Set<number>> {
  curated ??= (oncokbFetch("/utils/cancerGeneList") as Promise<{ entrezGeneId: number; oncokbAnnotated?: boolean }[]>)
    .then((genes) => new Set(genes.filter((g) => g.oncokbAnnotated).map((g) => g.entrezGeneId)));
  return curated;
}

interface Annotation {
  oncogenic?: string; mutationEffect?: { knownEffect?: string };
  highestSensitiveLevel?: string; highestResistanceLevel?: string; highestDiagnosticImplicationLevel?: string; highestPrognosticImplicationLevel?: string;
}

/** a stored position as the portal sends it: absent when missing or 0, otherwise as stored (the importer's -1 included) */
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) === 0 ? undefined : Number(v));

/** The portal's query for one key (oncokb-frontend-commons generateProteinChangeQuery). */
export function proteinChangeQuery(k: Row) {
  return {
    alteration: String(k.alteration),
    consequence: String(k.consequence) || undefined,
    gene: { entrezGeneId: Number(k.entrez_gene_id) },
    proteinStart: num(k.protein_start),
    proteinEnd: num(k.protein_end),
    tumorType: String(k.tumor_type) || null,
    germline: false
  };
}

const keyRow = (k: Row): Row => ({
  alteration_type: "MUTATION", hugo_gene_symbol: String(k.hugo_gene_symbol), alteration: String(k.alteration),
  consequence: String(k.consequence), tumor_type: String(k.tumor_type)
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

/** A key of a gene OncoKB does not curate: stored without asking, oncogenicity empty. */
const uncuratedRow = (k: Row): Row => ({
  ...keyRow(k), oncogenicity: "", mutation_effect: "", highest_sensitive_level: "", highest_resistance_level: "",
  highest_diagnostic_level: "", highest_prognostic_level: "", data: ""
});

export const oncokbTumorTypeSource: AnnotationSource = {
  id: "oncokb_tumor_type",
  label: "OncoKB by tumour type",
  table: ONCOKB_TUMOR_TYPE_TABLE,
  versionColumn: "oncokb_version",
  keyColumns: ["alteration_type", "hugo_gene_symbol", "alteration", "consequence", "tumor_type"],
  writer: "oncokb",
  needs: ["ONCOKB_TOKEN"],
  batchSize: Number(process.env.ONCOKB_BATCH_SIZE || 100),
  batchDelayMs: Number(process.env.ONCOKB_BATCH_DELAY_MS || 300),
  ddl: [
    "CREATE TABLE IF NOT EXISTS " + ONCOKB_TUMOR_TYPE_TABLE + " (oncokb_version LowCardinality(String), " +
      "alteration_type Enum8('MUTATION' = 1, 'CNA' = 2, 'SV' = 3), hugo_gene_symbol LowCardinality(String), alteration String, " +
      "consequence LowCardinality(String), tumor_type LowCardinality(String), oncogenicity LowCardinality(String), " +
      "mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), highest_resistance_level LowCardinality(String), " +
      "highest_diagnostic_level LowCardinality(String), highest_prognostic_level LowCardinality(String), data String CODEC(ZSTD(3)), " +
      "api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
      "PARTITION BY oncokb_version ORDER BY (oncokb_version, alteration_type, hugo_gene_symbol, alteration, consequence, tumor_type)"
  ],
  keySpace: tumorTypeKeySpace,
  release: () => oncokbSource.release(),

  async annotate(keys: Row[]): Promise<Row[]> {
    const genes = await curatedGenes();
    const ask = keys.filter((k) => genes.has(Number(k.entrez_gene_id)));
    const rows = keys.filter((k) => !genes.has(Number(k.entrez_gene_id))).map(uncuratedRow);
    if (ask.length) {
      const out = await oncokbFetch("/annotate/mutations/byProteinChange", ask.map(proteinChangeQuery)) as Annotation[];
      if (!Array.isArray(out) || out.length !== ask.length) throw new Error("OncoKB answered " + (Array.isArray(out) ? out.length : "no list") + " for " + ask.length + " queries");
      ask.forEach((k, i) => rows.push(storeRow(k, out[i])));
    }
    return rows;
  }
};
