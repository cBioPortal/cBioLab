// The Patient page header's TMB-H and MSI-H badges (PAT-STM-9), as cBioPortal's SampleSummaryList
// shows them: after a sample's attributes, the biomarker's name and OncoKB's call for it at the
// tumour type the page asks with. The calls are read from the OncoKB store at the pin, where the
// sync stores them under gene "Other Biomarkers" (packages/annotation-sync oncokb-tumor-type.ts
// biomarkerKeySpace, whose qualifying and tumour-type rules these mirror). Browser-safe but for the SQL.
import { sq } from "./compiler.ts";
import { ONCOKB_TUMOR_TYPE_TABLE } from "./annotation-store.ts";

/** the gene OncoKB files these biomarkers under (oncokb-frontend-commons OTHER_BIOMARKER_HUGO_SYMBOL) */
export const OTHER_BIOMARKERS = "Other Biomarkers";
export const BIOMARKERS = ["MSI-H", "TMB-H"] as const;
export type Biomarker = (typeof BIOMARKERS)[number];

/** TMB_H_THRESHOLD (shared/constants.ts): a score at or above it is TMB-H */
const TMB_H_THRESHOLD = 10;
/** the TMB attributes, the preferred first (OTHER_BIOMARKERS_CONFIG) */
const TMB_ATTRIBUTES = ["CVR_TMB_SCORE", "TMB_NONSYNONYMOUS"];

type Attrs = Record<string, string | undefined>;
const present = (v: string | undefined): v is string => v != null && v !== "";

/**
 * The biomarkers a sample is asked about and shown with, in the header's order. MSI-H: MSI_TYPE is
 * "Instable" exactly, and the sample has an MSI_SCORE, whatever its value (getSampleClinicalDataMapByKeywords;
 * SampleSummaryList's `numericalData !== undefined`). TMB-H: CVR_TMB_SCORE or TMB_NONSYNONYMOUS is a
 * finite number ≥ 10 (getSampleClinicalDataMapByThreshold).
 */
export function sampleBiomarkers(attrs: Attrs): Biomarker[] {
  const out: Biomarker[] = [];
  if (attrs.MSI_TYPE === "Instable" && present(attrs.MSI_SCORE)) out.push("MSI-H");
  if (TMB_ATTRIBUTES.some((a) => present(attrs[a]) && Number.isFinite(Number(attrs[a])) && Number(attrs[a]) >= TMB_H_THRESHOLD)) out.push("TMB-H");
  return out;
}

/**
 * The tumour type every shown sample is asked with: the first CANCER_TYPE_DETAILED among them, else
 * the first CANCER_TYPE, else null for the study's (getSampleTumorTypeMap over all the page's
 * samples, tumorTypeResolver); "first" by sample id, as the sync takes it.
 */
export function biomarkerTumorType(samples: { id: string; attrs: Attrs }[]): string | null {
  const sorted = [...samples].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = (attr: string) => sorted.map((s) => s.attrs[attr]).find(present);
  return first("CANCER_TYPE_DETAILED") ?? first("CANCER_TYPE") ?? null;
}

/** OncoKB's call for one biomarker at one tumour type, as stored */
export interface BiomarkerCall {
  alteration: Biomarker; tumorType: string; oncogenicity: string;
  sensitive: string; resistance: string; diagnostic: string; prognostic: string;
  /** OncoKB's summary for the tumour type, else for the variant */
  summary: string;
}

/** The stored calls at `pin` for these biomarkers at `tumorType` ('' for none), as SQL. */
export function biomarkerCallsSql(pin: string, tumorType: string, alterations: readonly Biomarker[]): string {
  return "SELECT alteration, tumor_type AS tumorType, oncogenicity, highest_sensitive_level AS sensitive, highest_resistance_level AS resistance, " +
    "highest_diagnostic_level AS diagnostic, highest_prognostic_level AS prognostic, " +
    "if(JSONExtractString(data, 'tumorTypeSummary') != '', JSONExtractString(data, 'tumorTypeSummary'), JSONExtractString(data, 'variantSummary')) AS summary" +
    " FROM " + ONCOKB_TUMOR_TYPE_TABLE + " FINAL WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION'" +
    " AND hugo_gene_symbol = " + sq(OTHER_BIOMARKERS) + " AND tumor_type = " + sq(tumorType) +
    " AND alteration IN (" + (alterations.length ? alterations.map(sq).join(", ") : "''") + ") AND oncogenicity != '' ORDER BY alteration";
}

const levelName = (l: string) => l.replace(/^LEVEL_/, "Level ");

/**
 * The call as the header writes it beside the name, as the Annotation column does: the oncogenicity
 * OncoKB gave (none when Unknown), then its highest sensitive level, else its resistance level — the
 * level the portal's OncoKB icon shows.
 */
export function biomarkerCallText(c: BiomarkerCall): string {
  const level = c.sensitive || c.resistance;
  const onc = c.oncogenicity === "Unknown" ? "" : c.oncogenicity;
  return [onc, level ? levelName(level) : ""].filter(Boolean).join(" · ");
}

/** The study's cancer type's name (`name`), as SQL: the tumour type asked with when no sample names one. */
export const studyCancerTypeSql = (db: string, study: string): string =>
  "SELECT t.name AS name FROM " + db + ".cancer_study s INNER JOIN " + db + ".type_of_cancer t ON t.type_of_cancer_id = s.type_of_cancer_id" +
  " WHERE s.cancer_study_identifier = " + sq(study);
