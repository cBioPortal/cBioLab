// The mutexpr view's SQL: what its runner (run.ts) asks each participant's database for.
// mutexpr: one gene's expression per sample, grouped by another (or the same) gene's mutations
import { sq } from "../../compiler.ts";
import { inCohortSamples, bareSampleId, profiledCasesSql } from "../../cohort2.ts";
import { finiteSql } from "../../sql-number.ts";
import { clinicalValueFoldSql, clinicalRecordedSql } from "../../event-names.ts";
import { clinicalTable } from "../../custom-data.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import type { MutexprResolution, MutexprStratum } from "./types.ts";

/** the group keys that are not a protein change or codon: none can begin with "#" */
export const GROUP_MULTIPLE = "#multiple", GROUP_NOT_MUTATED = "#notMutated", GROUP_NOT_PROFILED = "#notProfiled";
/** the stratum key of a sample with no cancer type recorded */
export const NO_CANCER_TYPE = "#none";
export const FUSION_KEYS = { yes: "#fusion", no: "#nofusion", unprofiled: "#svnotprofiled" } as const;
/** the attribute the cancer-type stratum reads (a sample attribute in every cBioPortal study) */
export const CANCER_TYPE_ATTRIBUTE = "CANCER_TYPE";

export interface ExprOpts { expressionGene: string; profileType: string; log2: boolean }

/** a finite number as a SQL literal: the shared range crosses into the query as numbers, never text */
function num(x: number): string {
  if (!Number.isFinite(x)) throw new Error("mutexpr: the value range must be finite numbers");
  return String(x);
}

/**
 * The cohort's samples' values of one gene on one profile: one value per sample (the mean of its
 * rows, as every expression view reads them), as stored or as log2(v + 1). Under log2 a negative
 * stored value has no logarithm and is left out, never clamped.
 */
function exprCtes(cohortSql: string, study: string, db: string, o: ExprOpts): string {
  const raw = finiteSql("ga.alteration_value");
  const val = o.log2 ? "log2(" + raw + " + 1)" : raw;
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    "),\n" +
    "raw AS (\n" +
    "  SELECT ga.sample_unique_id AS suid, avg(" + raw + ") AS r, avg(" + val + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(o.profileType) +
    " AND ga.hugo_gene_symbol = " + sq(o.expressionGene) + "\n" +
    "    AND " + raw + " IS NOT NULL" + (o.log2 ? " AND " + raw + " >= 0" : "") + "\n" +
    "    AND ga.sample_unique_id IN (SELECT suid FROM samp)\n" +
    "  GROUP BY suid\n" +
    ")" + (o.log2
      ? ",\nneg AS (\n" +
        "  SELECT uniqExact(ga.sample_unique_id) AS c FROM " + db + ".genetic_alteration_derived ga\n" +
        "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(o.profileType) +
        " AND ga.hugo_gene_symbol = " + sq(o.expressionGene) + "\n" +
        "    AND " + raw + " < 0 AND ga.sample_unique_id IN (SELECT suid FROM samp) AND ga.sample_unique_id NOT IN (SELECT suid FROM raw)\n" +
        ")"
      : "");
}

/**
 * One row: the cohort's samples, those with a value, those left out for a negative value under
 * log2, and the values' 0.5th and 99.5th percentiles — the range the bins are cut over, so one
 * extreme value does not squeeze every other into one bin. Counts and two percentiles only.
 */
export function mutexprRangeSql(cohortSql: string, study: string, db: string, o: ExprOpts): AggregateSql {
  return aggregateSql(exprCtes(cohortSql, study, db, o) + "\n" +
    "SELECT (SELECT count() FROM samp) AS cohort_samples, count() AS with_value,\n" +
    "       " + (o.log2 ? "(SELECT c FROM neg)" : "0") + " AS negative,\n" +
    "       quantileExact(0.005)(v) AS lo, quantileExact(0.995)(v) AS hi\n" +
    "FROM raw");
}

export interface GroupsOpts extends ExprOpts {
  gene: string;
  resolution: MutexprResolution;
  stratify: MutexprStratum[];
  fusionGene: string;
  range: [number, number];
  bins: number;
}

/** a protein change as its group: as written, or its codon (reference residue(s) and first position) */
function groupLabelSql(resolution: MutexprResolution): string {
  const mv = "g.mutation_variant";
  const asWritten = "if(" + mv + " = '', '(no protein change)', " + mv + ")";
  if (resolution === "protein") return asWritten;
  // R175H and R175C → R175; E746_A750del → E746; a change with no position (Promoter) stays as written
  return "if(match(" + mv + ", '^(p[.])?[A-Z*]+[0-9]+'), concat(extract(" + mv + ", '^(?:p[.])?([A-Z*]+)[0-9]'), extract(" + mv + ", '^(?:p[.])?[A-Z*]+([0-9]+)')), " + asWritten + ")";
}

/**
 * Per (stratum, group, bin) of the cohort's samples with a value: how many samples, Σv and Σv².
 * A sample's group is its one protein change (or codon) of `gene`; "#multiple" when it carries more
 * than one; "#notMutated" when it carries none and its panel covers `gene` for mutations (whole
 * exome included); "#notProfiled" when its panel does not — never counted as wild type. A mutation
 * is a call on the panel (not off-panel, not UNCALLED). The strata are the sample's cancer type
 * (folded, as clinical values fold everywhere) and/or whether it carries a structural variant of
 * `fusionGene`, with "not profiled" kept apart the same way. Values outside `range` are counted in
 * the end bins. Grouping keys and sums only: no sample leaves.
 */
export function mutexprGroupsSql(cohortSql: string, study: string, db: string, o: GroupsOpts): AggregateSql {
  const bare = (col: string) => bareSampleId(col, study);
  const [x0, x1] = o.range.map(num).map(Number);
  if (!(x1 > x0)) throw new Error("mutexpr: the value range must run upwards");
  const B =Math.max(4, Math.min(200, Math.round(o.bins)));
  const ctes: string[] = [];
  ctes.push("mut AS (\n" +
    "  SELECT g.sample_unique_id AS suid, groupUniqArray(" + groupLabelSql(o.resolution) + ") AS labels\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol = " + sq(o.gene) + " AND g.variant_type = 'mutation'\n" +
    "    AND g.mutation_status != 'UNCALLED' AND NOT g.off_panel AND g.sample_unique_id IN (SELECT suid FROM raw)\n" +
    "  GROUP BY suid\n" +
    ")");
  ctes.push("prof AS (" + profiledCasesSql(o.gene, "MUTATION", { study, db, unit: "sample" }) + ")");
  const keyParts: string[] = [], labelParts: string[] = [];
  const joins: string[] = [];
  for (const s of o.stratify) {
    if (s === "cancerType") {
      ctes.push("ct AS (\n" +
        "  SELECT sample_unique_id AS suid, any(" + clinicalValueFoldSql("attribute_value") + ") AS k, min(trimBoth(attribute_value)) AS label\n" +
        "  FROM " + clinicalTable(db, [CANCER_TYPE_ATTRIBUTE]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(CANCER_TYPE_ATTRIBUTE) + "\n" +
        "    AND " + clinicalRecordedSql("attribute_value") + " AND sample_unique_id IN (SELECT suid FROM raw)\n" +
        "  GROUP BY suid\n" +
        ")");
      joins.push("LEFT JOIN ct ON ct.suid = raw.suid");
      keyParts.push("if(ct.k = '', " + sq(NO_CANCER_TYPE) + ", ct.k)");
      labelParts.push("if(ct.k = '', 'No cancer type recorded', ct.label)");
    } else {
      const fg = o.fusionGene;
      ctes.push("fus AS (\n" +
        "  SELECT DISTINCT g.sample_unique_id AS suid FROM " + db + ".genomic_event_derived g\n" +
        "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol = " + sq(fg) + " AND g.variant_type = 'structural_variant'\n" +
        "    AND NOT g.off_panel AND g.sample_unique_id IN (SELECT suid FROM raw)\n" +
        ")");
      ctes.push("fprof AS (" + profiledCasesSql(fg, "SV", { study, db, unit: "sample" }) + ")");
      const has = "raw.suid IN (SELECT suid FROM fus)", prof = bare("raw.suid") + " IN (SELECT profiled_id FROM fprof)";
      keyParts.push("multiIf(" + has + ", " + sq(FUSION_KEYS.yes) + ", " + prof + ", " + sq(FUSION_KEYS.no) + ", " + sq(FUSION_KEYS.unprofiled) + ")");
      labelParts.push("multiIf(" + has + ", " + sq(fg + " fusion") + ", " + prof + ", " + sq("No " + fg + " fusion") + ", " + sq(fg + " fusions not profiled") + ")");
    }
  }
  const key = keyParts.length ? (keyParts.length === 1 ? keyParts[0] : "concat(" + keyParts.join(", ' | ', ") + ")") : "''";
  const label = labelParts.length ? (labelParts.length === 1 ? labelParts[0] : "concat(" + labelParts.join(", ' · ', ") + ")") : "''";
  const grp = "multiIf(length(mut.labels) = 1, mut.labels[1], length(mut.labels) > 1, " + sq(GROUP_MULTIPLE) + ",\n" +
    "           " + bare("raw.suid") + " IN (SELECT profiled_id FROM prof), " + sq(GROUP_NOT_MUTATED) + ", " + sq(GROUP_NOT_PROFILED) + ")";
  const bin = "least(" + (B - 1) + ", greatest(0, toInt32(floor((raw.v - " + num(x0) + ") * " + num(B / (x1 - x0)) + "))))";
  return aggregateSql(exprCtes(cohortSql, study, db, o) + ",\n" + ctes.join(",\n") + ",\n" +
    "lab AS (\n" +
    "  SELECT raw.v AS v, " + grp + " AS grp,\n" +
    "         " + key + " AS stratum, " + label + " AS stratum_label\n" +
    "  FROM raw LEFT JOIN mut ON mut.suid = raw.suid" + (joins.length ? "\n  " + joins.join("\n  ") : "") + "\n" +
    ")\n" +
    "SELECT stratum, min(stratum_label) AS stratum_label, grp, " + bin.replace(/raw\.v/g, "v") + " AS bin,\n" +
    "       count() AS n, sum(v) AS sx, sum(v * v) AS sxx\n" +
    "FROM lab GROUP BY stratum, grp, bin ORDER BY stratum, grp, bin");
}
