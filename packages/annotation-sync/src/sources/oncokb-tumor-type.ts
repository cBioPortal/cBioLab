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
//
// The same table holds the patient header's TMB-H and MSI-H calls (PatientViewPageStore
// otherBiomarkerQueries), under gene "Other Biomarkers": a key per biomarker a sample qualifies for
// and tumour type the header asks it with (biomarkerKeySpace), asked by Hugo symbol.
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

/** the gene OncoKB files TMB-H and MSI-H under (oncokb-frontend-commons OTHER_BIOMARKER_HUGO_SYMBOL) */
export const OTHER_BIOMARKERS = "Other Biomarkers";

/**
 * The header's biomarker keys, one row per (biomarker, tumour type), in tumorTypeKeySpace's columns.
 * A sample qualifies for TMB-H when CVR_TMB_SCORE or TMB_NONSYNONYMOUS is a finite number ≥ 10, for
 * MSI-H when MSI_TYPE is "Instable" (StoreUtils getSampleClinicalDataMapByThreshold / ByKeywords).
 * The portal asks with one tumour type for every sample shown: the first CANCER_TYPE_DETAILED among
 * them, else the first CANCER_TYPE, else the study's (getSampleTumorTypeMap, tumorTypeResolver), and
 * "first" is taken by sample id. The patient view shows all the patient's samples, a sample view
 * that one alone, so each qualifying sample gives a key at both. `clinical` is the clinical table,
 * for a check that adds rows of its own.
 */
export function biomarkerKeySpace(portalDb: string, study: string | null, clinical = portalDb + ".clinical_data_derived"): string {
  const rows = "(SELECT sample_unique_id AS s, patient_unique_id AS p, cancer_study_identifier AS study, attribute_name AS a, attribute_value AS v FROM " +
    clinical + " WHERE type = 'sample' AND notEmpty(attribute_value)" + only(study, "cancer_study_identifier") + ")";
  const num = "ifNull(toFloat64OrNull(trimBoth(v)), nan)";
  const marks = "arrayFilter(m -> m != '', [if(countIf(a = 'MSI_TYPE' AND v = 'Instable') > 0, 'MSI-H', ''), " +
    "if(countIf(a IN ('CVR_TMB_SCORE', 'TMB_NONSYNONYMOUS') AND isFinite(" + num + ") AND " + num + " >= 10) > 0, 'TMB-H', '')])";
  const resolve = (t: string) => "if(" + t + ".d != '', " + t + ".d, if(" + t + ".c != '', " + t + ".c, ifNull(st.name, '')))";
  return (
    "SELECT 'MUTATION' AS alteration_type, " + sq(OTHER_BIOMARKERS) + " AS hugo_gene_symbol, alteration, '' AS consequence, tumor_type, " +
    "'' AS entrez_gene_id, '' AS protein_start, '' AS protein_end FROM (" +
    "SELECT arrayJoin(x.marks) AS alteration, arrayJoin([" + resolve("x") + ", " + resolve("y") + "]) AS tumor_type FROM (" +
    "SELECT s, any(p) AS p, any(study) AS study, anyIf(v, a = 'CANCER_TYPE_DETAILED') AS d, anyIf(v, a = 'CANCER_TYPE') AS c, " + marks + " AS marks" +
    " FROM " + rows + " GROUP BY s HAVING notEmpty(marks)) x" +
    " LEFT JOIN (SELECT p, argMinIf(v, s, a = 'CANCER_TYPE_DETAILED') AS d, argMinIf(v, s, a = 'CANCER_TYPE') AS c FROM " + rows + " GROUP BY p) y ON y.p = x.p" +
    " LEFT JOIN (" + studyTumorTypesSql(portalDb) + ") st ON st.study = x.study" +
    ") GROUP BY alteration, tumor_type"
  );
}

/** The portal's query for a biomarker key (PatientViewPageStore getOtherBiomarkerQueries): by Hugo symbol, the tumour type absent when none. */
export function biomarkerQuery(k: Row) {
  return { alteration: String(k.alteration), gene: { hugoSymbol: OTHER_BIOMARKERS }, tumorType: String(k.tumor_type) || undefined };
}

const isBiomarker = (k: Row) => String(k.hugo_gene_symbol) === OTHER_BIOMARKERS;

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
  keySpace: (portalDb: string, study: string | null) => tumorTypeKeySpace(portalDb, study) + " UNION ALL " + biomarkerKeySpace(portalDb, study),
  release: () => oncokbSource.release(),

  async annotate(keys: Row[]): Promise<Row[]> {
    const genes = await curatedGenes();
    const asked = (k: Row) => isBiomarker(k) || genes.has(Number(k.entrez_gene_id));
    const ask = keys.filter(asked);
    const rows = keys.filter((k) => !asked(k)).map(uncuratedRow);
    if (ask.length) {
      const out = await oncokbFetch("/annotate/mutations/byProteinChange", ask.map((k) => isBiomarker(k) ? biomarkerQuery(k) : proteinChangeQuery(k))) as Annotation[];
      if (!Array.isArray(out) || out.length !== ask.length) throw new Error("OncoKB answered " + (Array.isArray(out) ? out.length : "no list") + " for " + ask.length + " queries");
      ask.forEach((k, i) => rows.push(storeRow(k, out[i])));
    }
    return rows;
  }
};
