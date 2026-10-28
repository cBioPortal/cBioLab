// Aggregate SQL behind the view kinds in lib/views/ that query through a resolver's viewAggregate,
// viewAggregateMany and viewMeta (genome, pathways, enrichment, …). Same rules as every builder in
// lib/federation.ts, which re-exports these so test/boundary.test.ts sweeps them with the rest:
// the outer SELECT returns counts, sums and grouping keys — never an identifier — so any
// participant, aggregate-only included, can answer.
import { survivalMonthsSql, survivalEventSql } from "./survival-sql.ts";
import { sq } from "./compiler.ts";
import { ALTERED_COND, driverJoin, inCohortClinical } from "./federation.ts";
import { clinicalValueFoldSql, nameFoldSql, foldedEqualsSql, foldedInSql } from "./event-names.ts";
import { clinicalTable } from "./custom-data.ts";
import { splitBucketSql, inCohortSamples, inCohortPatients, bareSampleId } from "./cohort2.ts";
import { finiteSql } from "./sql-number.ts";
import { linesCtes, type LineSpec } from "./treatment-lines.ts";
import { VIEW_ATTR_RE } from "./custom-data-names.ts";
import { aggregateSql, type AggregateSql, patientSql, type PatientSql } from "./sql-kinds.ts";
import { DAYS_PER_MONTH } from "./time-units.ts";

/** bare patient id for a *_unique_id column of this study */
export const pidOf = (col: string, study: string): string => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";

// ---------------------------------------------------------------------------
// genome: copy-number segments, binned along the genome

/** Autosomes in order, then X. Y is never drawn: its log ratio mostly records sex, not tumour. */
export const GENOME_CHROMS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
  "17", "18", "19", "20", "21", "22", "X"] as const;

/** Chromosome lengths (bp), UCSC hg19 and hg38 chromInfo. */
export const CHROM_LENGTHS: Record<"hg19" | "hg38", Record<string, number>> = {
  hg19: { "1": 249250621, "2": 243199373, "3": 198022430, "4": 191154276, "5": 180915260, "6": 171115067,
    "7": 159138663, "8": 146364022, "9": 141213431, "10": 135534747, "11": 135006516, "12": 133851895,
    "13": 115169878, "14": 107349540, "15": 102531392, "16": 90354753, "17": 81195210, "18": 78077248,
    "19": 59128983, "20": 63025520, "21": 48129895, "22": 51304566, "X": 155270560 },
  hg38: { "1": 248956422, "2": 242193529, "3": 198295559, "4": 190214555, "5": 181538259, "6": 170805979,
    "7": 159345973, "8": 145138636, "9": 138394717, "10": 133797422, "11": 135086622, "12": 133275309,
    "13": 114364328, "14": 107043718, "15": 101991189, "16": 90338345, "17": 83257441, "18": 80373285,
    "19": 58617616, "20": 64444167, "21": 46709983, "22": 50818468, "X": 156040895 }
};

/** The study's reference genome, from its own metadata. Metadata only. */
export function studyGenomeSql(study: string, db: string): AggregateSql {
  return aggregateSql("SELECT rg.name AS build FROM " + db + ".cancer_study cs\n" +
    "JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study));
}

/** How many samples the cohort holds, and how many of them have any segment at all. */
export function genomeCoverageSql(cohortSql: string, study: string, db: string): AggregateSql {
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    ")\n" +
    "SELECT (SELECT count() FROM samp) AS samples,\n" +
    "       (SELECT uniqExact(sample_id) FROM " + db + ".copy_number_seg\n" +
    "         WHERE cancer_study_id = (SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "           AND sample_id IN (SELECT sid FROM samp)) AS segmented\n" +
    "FROM system.one"
  ));
}

/**
 * The per-gene counting after a `ps` CTE (suid, pid, side 'a' | 'b') — shared by every view that
 * puts each patient's samples on two sides: the paired view's sample attribute, the acquired
 * view's samples before and after a treatment start.
 */
export function sideCountsTail(study: string, db: string, genes: string[] | null, pin: string | null, measure: "driver" | "any", exclude?: string): string {
  const scan = genes == null;
  const geneList = scan ? "SELECT DISTINCT gene FROM alt" : genes.map(sq).join(",");
  const hit = measure === "driver" ? "max(ann.is_driver)" : "1";
  return (
    "alt AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, " + (pin || measure === "any" ? hit : "0") + " AS hit\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin && measure === "driver" ? driverJoin(pin) : "") +
    "  INNER JOIN ps ON ps.suid = g.sample_unique_id\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + (scan ? "" : " AND g.hugo_gene_symbol IN (" + geneList + ")") + " AND " + ALTERED_COND + "\n" +
    // narrows the events before the annotation join rather than after it
    "    AND g.sample_unique_id IN (SELECT suid FROM ps)" + (exclude ? " AND " + exclude : "") + "\n" +
    "  GROUP BY gene, pid, side\n" +
    (scan ? "  HAVING hit > 0\n" : "") +
    "),\n" +
    "cov AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  INNER JOIN ps ON ps.suid = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,\n" +
    "         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab\n" +
    "  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)\n" +
    "  GROUP BY gene, pid\n" +
    ")\n" +
    "SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only\n" +
    "FROM per WHERE pa AND pb GROUP BY gene" + (scan ? " HAVING both + a_only + b_only > 0" : "")
  );
}

/** Every value the attribute takes among the cohort's samples, for a refusal that names them. */
export function sampleAttributeValuesSql(cohortSql: string, study: string, db: string, attribute: string): AggregateSql {
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT attribute_value AS value, count() AS samples FROM " + clinicalTable(db, [attribute]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
    "  AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    "GROUP BY value ORDER BY samples DESC LIMIT 50"
  ));
}

/** Which studies hold allele-specific copy number for their current mutation profile. Metadata only. */
export function ascnStudiesSql(_study: string, db: string): AggregateSql {
  return aggregateSql("SELECT DISTINCT cs.cancer_study_identifier AS study FROM " + db + ".allele_specific_copy_number a\n" +
    "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = a.genetic_profile_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id ORDER BY study");
}

// ---------------------------------------------------------------------------
// incidence: time to a timeline event, with death as the competing risk

export interface EventSel { eventType: string; attrs?: { key: string; value: string }[] }
export interface IncidenceAnchor { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" }

/** Timeline events of a type (with every given attribute), per cohort patient: (pid, day). */
function eventDaysSql(db: string, study: string, sel: EventSel, cohortRef: string): string {
  const attrs = (sel.attrs || []).slice(0, 3);
  return "SELECT p.stable_id AS pid, ce.start_date AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", sel.eventType) + "\n" +
    attrs.map((a) => "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", a.key) + " AND " + foldedEqualsSql("value", a.value) + ")\n").join("") +
    "    AND " + inCohortPatients("p.stable_id", cohortRef);
}

/**
 * Per cohort, counts of (entry, t, cause) in months from the anchor (the study's day 0 when
 * there is none): cause 1 the first qualifying event after the anchor, 2 death without it
 * (OS_STATUS), 0 censored at last follow-up (OS_MONTHS). Entry is the delay from the anchor to
 * day 0 when the anchor precedes it — the same left truncation the survival view applies, since
 * a patient is only in the study because they were alive at day 0.
 *
 * Patients who cannot enter the risk set are counted under `kind`, never silently dropped:
 * 'prior' already had the event at or before the anchor; 'unobserved' had it after the anchor
 * but before observation began; 'nofollowup' has no OS follow-up (or none after the anchor);
 * 'late' is a flag on records whose first event was recorded after their last follow-up (they
 * are kept, as censored or dead at follow-up). A cohort patient with no anchor event appears in
 * no row at all; the caller counts them as the cohort size less every row's n.
 */
export function incidenceCountsSql(cohortSql: string, study: string, db: string, event: EventSel, anchor: IncidenceAnchor | null): AggregateSql {
  const pid = pidOf("patient_unique_id", study);
  const pick = anchor?.occurrence === "LAST" ? "max" : "min";
  const anchCte = anchor
    ? "anch AS (\n" +
      "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" +
      (anchor.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
        foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n" : "") +
      "    AND " + inCohortPatients("p.stable_id") + "\n" +
      "  GROUP BY pid\n" +
      "),\n"
    : "anch AS (SELECT DISTINCT pid, toInt64(0) AS day FROM cohort),\n";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')", "anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    anchCte +
    "ev AS (" + eventDaysSql(db, study, event, "cohort") + "),\n" +
    "evs AS (\n" +
    "  SELECT ev.pid AS pid, countIf(ev.day <= anch.day) AS n_prior, countIf(ev.day > anch.day) AS n_after,\n" +
    "         minIf(ev.day, ev.day > anch.day) AS first_after\n" +
    "  FROM ev INNER JOIN anch ON anch.pid = ev.pid GROUP BY ev.pid\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT anch.pid AS pid, anch.day AS a, os.months AS months, " + survivalEventSql("os.status") + " AS dead,\n" +
    "         evs.pid != '' AS has_ev, evs.n_prior AS n_prior, evs.n_after AS n_after, evs.first_after AS first_after\n" +
    "  FROM anch\n" +
    "  LEFT JOIN os ON os.pid = anch.pid\n" +
    "  LEFT JOIN evs ON evs.pid = anch.pid\n" +
    "),\n" +
    "cls AS (\n" +
    "  SELECT greatest(0, -a) / " + DAYS_PER_MONTH + " AS entry, months - a / " + DAYS_PER_MONTH + " AS tend,\n" +
    "         (first_after - a) / " + DAYS_PER_MONTH + " AS tev,\n" +
    "         multiIf(months IS NULL OR months - a / " + DAYS_PER_MONTH + " <= 0, 'nofollowup',\n" +
    "                 has_ev AND n_prior > 0, 'prior',\n" +
    "                 has_ev AND n_after > 0 AND first_after < 0, 'unobserved',\n" +
    "                 'record') AS kind,\n" +
    "         has_ev AND n_after > 0 AND (first_after - a) / " + DAYS_PER_MONTH + " <= months - a / " + DAYS_PER_MONTH + " AS hit,\n" +
    "         has_ev AND n_after > 0 AND (first_after - a) / " + DAYS_PER_MONTH + " > months - a / " + DAYS_PER_MONTH + " AS late,\n" +
    "         dead\n" +
    "  FROM per\n" +
    ")\n" +
    "SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(if(hit, tev, tend), 4), 0) AS t,\n" +
    "       if(kind != 'record', -1, if(hit, 1, if(dead, 2, 0))) AS cause, late, count() AS n\n" +
    "FROM cls GROUP BY kind, entry, t, cause, late ORDER BY t"
  ));
}

/** The tests a lab event type holds, with how many patients and results each has. */
export function labTestsSql(cohortSql: string, study: string, db: string, eventType: string, testKey: string): AggregateSql {
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT " + nameFoldSql("t.value") + " AS tk, arraySort((x) -> (-x.2, x.1), arrayMap((v) -> (v, countEqual(groupArray(trimBoth(t.value)), v)), groupUniqArray(trimBoth(t.value))))[1].1 AS test,\n" +
    "       uniqExact(ce.patient_id) AS patients, count() AS results\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", testKey) + "\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", eventType) + " AND " + inCohortPatients("p.stable_id") + "\n" +
    "GROUP BY tk ORDER BY patients DESC, tk LIMIT 40"
  ));
}

// ---------------------------------------------------------------------------
// enrichment: every gene's alteration frequency in a cohort, for one alteration type

export type EnrichAlteration = "mutation" | "cna" | "amp" | "homdel" | "sv";
export const ENRICH_PANEL_TYPE: Record<EnrichAlteration, string> = {
  mutation: "MUTATION_EXTENDED", cna: "COPY_NUMBER_ALTERATION", amp: "COPY_NUMBER_ALTERATION", homdel: "COPY_NUMBER_ALTERATION", sv: "STRUCTURAL_VARIANT"
};
/** one alteration type's calls, made on a panel covering the gene (an off-panel call is in neither side) */
export const enrichEventCond = (a: EnrichAlteration): string => "NOT g.off_panel AND " + (
  a === "mutation" ? "g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'"
  : a === "sv" ? "g.variant_type = 'structural_variant'"
  : a === "amp" ? "g.variant_type = 'cna' AND g.cna_alteration >= 2"
  : a === "homdel" ? "g.variant_type = 'cna' AND g.cna_alteration <= -2"
  : "g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2");

// ---------------------------------------------------------------------------
// assays: a generic-assay profile's every entity, compared between cohorts

/** The profile's data type as the study declared it (LIMIT-VALUE, CATEGORICAL, BINARY, …). Metadata only. */
export function assayProfileSql(study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql("SELECT datatype, generic_assay_type, ifNull(patient_level, 0) AS patient_level, name FROM " + db + ".genetic_profile\n" +
    "WHERE stable_id = " + sq(study + "_" + profileType) + " AND genetic_alteration_type = 'GENERIC_ASSAY'");
}

/** Display names for a profile's entities, where the study gave them (NAME). Metadata only: an
 *  entity is a signature, an arm or a compound, never a patient. */
export function assayEntityNamesSql(study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql("WITH named AS (\n" +
    "  SELECT ge.stable_id AS entity, p.value AS name FROM " + db + ".generic_entity_properties p\n" +
    "  JOIN " + db + ".genetic_entity ge ON ge.id = p.genetic_entity_id\n" +
    "  WHERE p.name = 'NAME' AND ge.stable_id IN (SELECT DISTINCT entity_stable_id FROM " + db + ".generic_assay_data_derived\n" +
    "    WHERE profile_type = " + sq(profileType) + " AND profile_stable_id = " + sq(study + "_" + profileType) + ")\n" +
    ")\nSELECT entity, name FROM named");
}

/** Each gene's cytoband in the study's own reference genome (the portal's Cytoband column). Metadata only. */
export function geneCytobandsSql(genes: string[], study: string, db: string): AggregateSql {
  return aggregateSql("SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM " + db + ".gene g\n" +
    "JOIN " + db + ".reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id\n" +
    "WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "  AND g.hugo_gene_symbol IN (" + (genes.length ? genes.map(sq).join(",") : "''") + ")\n" +
    "GROUP BY gene");
}

// ---------------------------------------------------------------------------
// riskmodel: an elastic-net Cox ensemble over the cohort's mutated genes (lib/coxnet.ts)

export interface RiskmodelRowsOpts {
  endpoint: string;
  columns?: { months: string; status: string };
  /** a clinical attribute giving each patient a stratum (patient value, or the first sample's) */
  strata?: string | null;
  /** clinical attributes returned as c0, c1, … (patient value, or the first sample's) */
  covariates?: string[];
  /** count only OncoKB drivers, at this pin */
  driverPin?: string | null;
  /** re-anchor the clock at a timeline event, with the delayed entry that implies */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" } | null;
  /** Table 1's clinical attributes, returned as d0, d1, … (the folded value: the patient's, or the
   *  first sample's), r0, r1, … (that value as spelled) and u0, u1, … (how many distinct folded
   *  values the patient's samples hold) */
  describe?: string[];
}

/**
 * One row per patient of the cohort with a survival time: months and event (from the anchor, with
 * `entry` its offset to the study's day 0, when one is given; `anchored` 0 for a patient without
 * the anchor event), the gene panels their samples in the cohort were sequenced on for mutations, the
 * genes mutated in those samples (OncoKB drivers only with `driverPin`), their stratum and covariate
 * values (a sample attribute's from their first sample in the cohort), and
 * which half of the engine's fixed held-out split they are in (`half`, the split leaf's own
 * expression), in patient-id order. Values only: the patient id joins and orders the rows and is
 * never returned. Run only through PatientLevelResolver.viewRows, since a model of individual
 * patients needs their rows.
 */
export function riskmodelRowsSql(cohortSql: string, study: string, db: string, o: RiskmodelRowsOpts): PatientSql {
  const { endpoint, columns, strata = null, covariates = [], driverPin = null, anchor = null, describe = [] } = o;
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  for (const a of [strata, ...covariates, ...describe]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  const pid = pidOf("patient_unique_id", study);
  const attrs = [...(strata ? [strata] : []), ...covariates];
  const pick = anchor?.occurrence === "LAST" ? "max" : "min";
  const anchorAttr = anchor?.key
    ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data\n" +
      "        WHERE " + foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n"
    : "";
  return patientSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name=" + sq(months) + ")", "anyIf(attribute_value, attribute_name=" + sq(status) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status,\n" +
    "         " + splitBucketSql(pid, study) + " AS half\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "panels AS (\n" +
    "  SELECT " + pidOf("sd.patient_unique_id", study) + " AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + inCohortSamples(bareSampleId("sp.sample_unique_id", study)) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + pidOf("g.patient_unique_id", study) + " AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driverPin ? driverJoin(driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND " + ALTERED_COND + "\n" +
    (driverPin ? "    AND ann.is_driver = 1\n" : "") +
    "    AND " + inCohortSamples(bareSampleId("g.sample_unique_id", study)) + "\n" +
    "  GROUP BY pid\n" +
    ")" +
    (attrs.length ?
      ",\nattrs AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      attrs.map((a, k) => "         argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(a) + ") AS a" + k).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, attrs) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''\n" +
      "    AND " + inCohortClinical(study) + "\n" +
      "  GROUP BY pid\n" +
      ")" : "") +
    (anchor ?
      ",\nanch AS (\n" +
      "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day, 1 AS hit\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
      "    AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" + anchorAttr +
      "    AND " + inCohortPatients("p.stable_id") + "\n" +
      "  GROUP BY pid\n" +
      ")" : "") +
    (describe.length ?
      ",\ndescr AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      describe.map((a, k) => {
        const is = "attribute_name = " + sq(a), fold = clinicalValueFoldSql("attribute_value");
        return "         argMinIf(" + fold + ", sample_unique_id, " + is + ") AS d" + k + ", argMinIf(attribute_value, sample_unique_id, " + is + ") AS r" + k +
          ", uniqExactIf(" + fold + ", " + is + ") AS u" + k;
      }).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, describe) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + describe.map(sq).join(",") + ") AND trimBoth(attribute_value) != ''\n" +
      "    AND " + inCohortClinical(study) + "\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT os.months AS m, " + survivalEventSql("os.status") + " AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes" +
    (strata ? ", attrs.a0 AS stratum" : "") +
    covariates.map((_, k) => ", attrs.a" + (k + (strata ? 1 : 0)) + " AS c" + k).join("") +
    (anchor ? ", anch.hit AS anchored, round(anch.day / " + DAYS_PER_MONTH + ", 4) AS anchor_months" : "") +
    describe.map((_, k) => ", descr.d" + k + " AS d" + k + ", descr.r" + k + " AS r" + k + ", descr.u" + k + " AS u" + k).join("") + "\n" +
    "FROM os\n" +
    "  LEFT JOIN panels ON panels.pid = os.pid\n" +
    "  LEFT JOIN mut ON mut.pid = os.pid\n" +
    (attrs.length ? "  LEFT JOIN attrs ON attrs.pid = os.pid\n" : "") +
    (anchor ? "  LEFT JOIN anch ON anch.pid = os.pid\n" : "") +
    (describe.length ? "  LEFT JOIN descr ON descr.pid = os.pid\n" : "") +
    "WHERE os.months IS NOT NULL AND os.months > 0\n" +
    // a fixed order: the ensemble's seeded splits are drawn over row positions, so the same
    // document gives the same model only if the rows come back in the same order. The id orders
    // the rows inside the database and is not returned.
    "ORDER BY os.pid"
  ));
}

/** The genes on each mutation panel this study uses (study metadata; no cohort, no patient). */
export function riskmodelPanelGenesSql(study: string, db: string): AggregateSql {
  return aggregateSql((
    "SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes\n" +
    "FROM " + db + ".gene_panel_to_gene_derived pg\n" +
    "WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type = 'MUTATION_EXTENDED')\n" +
    "GROUP BY panel"
  ));
}

// ---------------------------------------------------------------------------
// txendpoints: real-world treatment endpoints from a treatment anchor

/** Days per month on the timeline clock: OS_MONTHS × this is the last follow-up's timeline day. */
/** a timeline event this many days past OS_MONTHS × DAYS_PER_MONTH says the two clocks disagree */
export const CLOCK_SLACK_DAYS = 31;

export interface TxEndpointOpts {
  endpoint: "ttnt" | "tot" | "rwpfs" | "os";
  /** the anchored treatment (event type, optional key = value; the first or last such record) */
  anchor: IncidenceAnchor;
  /** how records form lines (lib/treatment-lines.ts) */
  lines: LineSpec;
  /** rwpfs: the progression event — its type, key and accepted values, and an optional probability floor */
  progression?: ProgressionEvent;
  /** tot: a stop this many days or fewer before the last follow-up of a living patient counts as ongoing */
  ongoingDays?: number;
}

/** Timeline events of the study's cohort patients, aliased `alias` (the FROM … WHERE of a CTE). */
export function cohortEventsFrom(db: string, study: string, alias: string): string {
  return "  FROM " + db + ".clinical_event " + alias + "\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = " + alias + ".patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + inCohortPatients("p.stable_id") + "\n";
}

/** an event of `alias` carrying `key` (folded) with a value meeting `valueCond` */
export function eventHasKv(db: string, alias: string, key: string, valueCond: string): string {
  return "    AND " + alias + ".clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
    foldedEqualsSql("key", key) + " AND " + valueCond + ")\n";
}

/** the progression event: its type, key and accepted values, and an optional probability floor */
export interface ProgressionEvent { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number }

/** `os`: each cohort patient's OS_MONTHS (months) and whether OS_STATUS says deceased (dead) */
export function osCte(study: string, db: string): string {
  const pid = pidOf("patient_unique_id", study);
  return "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')", "anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS months,\n" +
    "         " + survivalEventSql("anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")";
}

/** `lastday`: each cohort patient's latest timeline day (a start or a stop) — the clock check's input */
export function lastDayCte(study: string, db: string): string {
  return "lastday AS (\n" +
    "  SELECT p.stable_id AS pid, max(greatest(ce.start_date, coalesce(ce.stop_date, ce.start_date))) AS d\n" + cohortEventsFrom(db, study, "ce") +
    "  GROUP BY pid\n" +
    ")";
}

/** `prog`: (pid, day) of every progression event of the cohort's patients */
export function progressionCte(study: string, db: string, pr: ProgressionEvent): string {
  return "prog AS (\n" +
    "  SELECT p.stable_id AS pid, ce.start_date AS day\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", pr.eventType) + "\n" +
    eventHasKv(db, "ce", pr.key, foldedInSql("value", pr.values)) +
    (pr.probabilityKey && pr.minProbability != null
      ? eventHasKv(db, "ce", pr.probabilityKey, finiteSql("value") + " >= " + Number(pr.minProbability)) : "") +
    ")";
}

/**
 * Per cohort, counts of (entry, t, ev) in months from the anchored treatment's start (day `a`): the
 * time to the endpoint (`ev` 1) or to censoring at the last follow-up (`ev` 0), the last follow-up
 * being day OS_MONTHS × DAYS_PER_MONTH of the timeline clock and death (OS_STATUS 1:…) an event for
 * every endpoint. `entry` is the delay from the anchor to day 0 when the anchor precedes it — the
 * left truncation of the survival and incidence views.
 *   ttnt   the start of the next treatment line after the anchor's (lines as lib/treatment-lines.ts
 *          builds them; for an anchor no line holds, the first line starting after it), or death
 *   tot    the latest stop of the anchored records in the anchor's line (or, outside a line, those
 *          starting on day `a`), or death; a living patient whose stop lies within `ongoingDays` of
 *          the last follow-up is censored there as still on it
 *   rwpfs  the first progression event after day `a`, or death
 *   os     death alone (overall survival from the anchor; `lines` is not read)
 * Patients who cannot enter are counted under `kind`: 'nofollowup' (no OS, or follow-up ending at
 * or before the anchor) and, for tot, 'nostop' (an anchored record of the line without a stop
 * date). `late` flags patients with a timeline event more than CLOCK_SLACK_DAYS past their last
 * follow-up — the check that the timeline and OS_MONTHS share day 0. A cohort patient with no
 * anchored record is in no row; the caller counts them from the cohort's size.
 */
export function txEndpointCountsSql(cohortSql: string, study: string, db: string, o: TxEndpointOpts): AggregateSql {
  const pick = o.anchor.occurrence === "LAST" ? "max" : "min";
  const evFrom = (alias: string) => cohortEventsFrom(db, study, alias);
  const hasKv = (alias: string, key: string, valueCond: string) => eventHasKv(db, alias, key, valueCond);
  const ctes: string[] = [
    osCte(study, db),
    "arec AS (\n" +
    "  SELECT p.stable_id AS pid, ce.clinical_event_id AS eid, ce.start_date AS s, ce.stop_date AS e\n" + evFrom("ce") +
    "    AND " + foldedEqualsSql("ce.event_type", o.anchor.eventType) + "\n" +
    (o.anchor.key ? hasKv("ce", o.anchor.key, foldedEqualsSql("value", String(o.anchor.value ?? ""))) : "") +
    ")",
    "anch AS (SELECT pid, " + pick + "(s) AS a FROM arec GROUP BY pid)",
    lastDayCte(study, db),
  ];
  let x: string;
  if (o.endpoint === "os") {
    ctes.push("x AS (SELECT pid, toInt64(0) AS d, 0 AS nostop FROM anch WHERE 0)");
    x = "x";
  } else if (o.endpoint === "rwpfs") {
    ctes.push(
      progressionCte(study, db, o.progression!),
      "x AS (SELECT prog.pid AS pid, min(prog.day) AS d, 0 AS nostop FROM prog INNER JOIN anch ON anch.pid = prog.pid WHERE prog.day > anch.a GROUP BY prog.pid)");
    x = "x";
  } else {
    ctes.push(...linesCtes({ db, study, patientFilter: inCohortPatients("p.stable_id"), spec: o.lines }),
      // the anchor's line: the line of a record that is anchored and starts on day a
      "aline AS (\n" +
      "  SELECT n.pid AS pid, min(n.line_no) AS ln FROM numbered n\n" +
      "  INNER JOIN arec ON arec.eid = n.eid INNER JOIN anch ON anch.pid = n.pid\n" +
      "  WHERE arec.s = anch.a GROUP BY n.pid\n" +
      ")");
    if (o.endpoint === "ttnt") {
      ctes.push(
        "x AS (\n" +
        "  SELECT anch.pid AS pid, minIf(l.ls, if(al.pid != '', l.line_no > al.ln, l.ls > anch.a)) AS d,\n" +
        "         countIf(if(al.pid != '', l.line_no > al.ln, l.ls > anch.a)) AS k, 0 AS nostop\n" +
        "  FROM anch LEFT JOIN aline al ON al.pid = anch.pid INNER JOIN lines l ON l.pid = anch.pid\n" +
        "  GROUP BY anch.pid HAVING k > 0\n" +
        ")");
    } else {
      ctes.push(
        "x AS (\n" +
        "  SELECT anch.pid AS pid, max(arec.e) AS d, countIf(arec.e IS NULL) AS nostop\n" +
        "  FROM anch INNER JOIN arec ON arec.pid = anch.pid\n" +
        "  LEFT JOIN aline al ON al.pid = anch.pid LEFT JOIN numbered n ON n.eid = arec.eid\n" +
        "  WHERE arec.s >= anch.a AND if(al.pid != '', n.line_no = al.ln, arec.s = anch.a)\n" +
        "  GROUP BY anch.pid\n" +
        ")");
    }
    x = "x";
  }
  const ongoing = Math.max(0, Math.floor(Number(o.ongoingDays ?? 30)));
  ctes.push(
    "per AS (\n" +
    "  SELECT anch.a AS a, os.months * " + DAYS_PER_MONTH + " AS fu, os.months IS NOT NULL AS has_os, os.dead AS dead,\n" +
    "         " + x + ".pid != '' AS has_x, toFloat64(" + x + ".d) AS xd, " + x + ".nostop AS nostop, lastday.d AS ld\n" +
    "  FROM anch\n" +
    "  LEFT JOIN os ON os.pid = anch.pid\n" +
    "  LEFT JOIN " + x + " ON " + x + ".pid = anch.pid\n" +
    "  LEFT JOIN lastday ON lastday.pid = anch.pid\n" +
    ")",
    "cls AS (\n" +
    "  SELECT multiIf(NOT has_os OR fu - a <= 0, 'nofollowup',\n" +
    (o.endpoint === "tot" ? "                 NOT has_x OR nostop > 0 OR xd IS NULL, 'nostop',\n" : "") +
    "                 'record') AS kind,\n" +
    "         greatest(0, -a) / " + DAYS_PER_MONTH + " AS entry,\n" +
    (o.endpoint === "tot"
      ? "         (least(xd, fu) - a) / " + DAYS_PER_MONTH + " AS tt,\n" +
        "         if(NOT dead AND xd + " + ongoing + " >= fu, 0, 1) AS ev,\n"
      : "         has_x AND xd <= fu AS hit,\n" +
        "         if(hit, xd - a, fu - a) / " + DAYS_PER_MONTH + " AS tt,\n" +
        "         if(hit, 1, if(dead, 1, 0)) AS ev,\n") +
    "         ld > fu + " + CLOCK_SLACK_DAYS + " AS late\n" +
    "  FROM per\n" +
    ")");
  return aggregateSql("WITH cohort AS (" + cohortSql + "),\n" + ctes.join(",\n") + "\n" +
    "SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(tt, 4), 0) AS t,\n" +
    "       if(kind = 'record', ev, 0) AS ev, late, count() AS n\n" +
    "FROM cls GROUP BY kind, entry, t, ev, late ORDER BY t");
}

// ---------------------------------------------------------------------------
// drivernegative: patients without a driver in a canonical list, against those with one

/** a gene list as SQL literals, checked */
export function geneList(genes: string[]): string {
  for (const g of genes) if (!/^[A-Za-z0-9_.-]{1,40}$/.test(g)) throw new Error("bad gene symbol '" + String(g).slice(0, 40) + "'");
  return genes.map(sq).join(", ");
}

export const orgAttr = (a: string) => { if (!VIEW_ATTR_RE.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'"); return a; };
