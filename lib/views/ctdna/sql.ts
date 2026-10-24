// The ctdna view's SQL: what its runner (run.ts) asks each participant's database for.
import { sideCountsTail, pidOf } from "../../federation-views.ts";
import { finiteSql } from "../../sql-number.ts";
import { clinicalTable } from "../../custom-data.ts";
import { sq } from "../../compiler.ts";
import { clinicalValueFoldSql, foldedEqualsSql, foldedInSql } from "../../event-names.ts";
import { driverJoin, ALTERED_COND } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Per gene, among patients with plasma and tissue both profiled for it: as pairedCountsSql (a = tissue, b = plasma). */
export function ctdnaCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, o: CtdnaSides,
  pin: string | null, measure: "driver" | "any"): AggregateSql {
  return aggregateSql(ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" + sideCountsTail(study, db, genes, pin, measure, chKeep(o, "ps.side")));
}

/**
 * The patients with a plasma sample, a tissue sample, both (and, with dates, how many classed
 * samples were dated); and of those with plasma, how many had any alteration called in it
 * (ctDNA detected: a mutation, an amplification or deep deletion, or a structural variant; with
 * `driver`, an OncoKB oncogenic one).
 */
export function ctdnaFunnelSql(cohortSql: string, study: string, db: string, o: CtdnaSides, pin: string | null, measure: "driver" | "any"): AggregateSql {
  return aggregateSql((
    ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" +
    ctdnaDetectedCte(study, db, pin, measure, chKeep(o, "s.side")) + "\n" +
    "SELECT (SELECT uniqExactIf(pid, side = 'b') FROM classed) AS plasma_all, (SELECT uniqExactIf(pid, side = 'a') FROM classed) AS tissue_all,\n" +
    "       (SELECT uniqExactIf(pid, side = 'b') FROM sides) AS plasma, (SELECT uniqExactIf(pid, side = 'a') FROM sides) AS tissue,\n" +
    "       (SELECT count() FROM paired) AS both, (SELECT count() FROM det) AS detected,\n" +
    "       (SELECT countIf(side = 'b') FROM ps) AS plasma_samples, (SELECT countIf(side = 'a') FROM ps) AS tissue_samples,\n" +
    "       " + (o.withinDays != null ? "(SELECT count() FROM dated)" : "toUInt64(0)") + " AS dated_samples" +
    (o.ch ? ",\n       (SELECT count() FROM chx) AS ch_calls, (SELECT countIf(has_normal) FROM chx) AS ch_with_normal,\n" +
      "       (SELECT countIf(by_gene) FROM chx) AS ch_by_gene, (SELECT countIf(by_normal) FROM chx) AS ch_by_normal, (SELECT countIf(by_gene OR by_normal) FROM chx) AS ch_removed,\n" +
      "       (SELECT uniqExact(s.pid) FROM chx INNER JOIN sides s ON s.suid = chx.suid WHERE by_gene OR by_normal) AS ch_patients" : "") + "\n" +
    "FROM system.one"
  ));
}

/**
 * Overall survival of the patients with a plasma sample, by ctDNA detected or not: counts of
 * (detected, months, dead) — OS_MONTHS / OS_STATUS as the study records them.
 */
export function ctdnaSurvivalSql(cohortSql: string, study: string, db: string, o: CtdnaSides, pin: string | null, measure: "driver" | "any"): AggregateSql {
  const pid = pidOf("patient_unique_id", study);
  return aggregateSql((
    ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" +
    ctdnaDetectedCte(study, db, pin, measure, chKeep(o, "s.side")) + ",\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid, " + finiteSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead, " + pid + " IN (SELECT pid FROM det) AS detected\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM sides WHERE side = 'b')\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT detected, round(months, 2) AS t, dead, count() AS n\n" +
    "FROM os WHERE months IS NOT NULL AND months >= 0 GROUP BY detected, t, dead ORDER BY t"
  ));
}

/** with a CH rule: per gene, the plasma mutation calls it removes and their patients, by which rule */
export function ctdnaChRemovedSql(cohortSql: string, study: string, db: string, o: CtdnaSides): AggregateSql {
  if (!o.ch) throw new Error("ctdnaChRemovedSql needs a CH rule");
  return aggregateSql((
    ctdnaSidesCtes(cohortSql, study, db, o) + "\n" +
    "SELECT chx.gene AS gene, countIf(by_gene OR by_normal) AS calls, uniqExactIf(s.pid, by_gene OR by_normal) AS patients,\n" +
    "       countIf(by_gene) AS gene_calls, countIf(by_normal) AS normal_calls\n" +
    "FROM chx INNER JOIN sides s ON s.suid = chx.suid\n" +
    "GROUP BY gene HAVING calls > 0 ORDER BY calls DESC, gene LIMIT 40"
  ));
}

// ---------------------------------------------------------------------------
// ctdna: a patient's plasma (cfDNA) samples against their tissue samples

export interface CtdnaSides {
  /** the sample attribute that classes samples (SAMPLE_CLASS), its plasma values and its tissue values */
  attribute: string; plasma: string[]; tissue: string[];
  /** samples on these panels are plasma whatever the attribute says (e.g. ACCESS129) */
  plasmaPanels: string[];
  /** keep only samples with a sample of the other kind dated within this many days (timeline dates); null: no dates needed */
  withinDays: number | null;
  sampleEvents: string[]; sampleKey: string;
  /**
   * leave out plasma mutation calls likely from clonal haematopoiesis: those in `genes`, and (with
   * `normalMinAlt`) those whose matched normal (white-cell) sample carries at least that many
   * alternate reads at an allele fraction at least `normalMinRatio` of the plasma's; absent, every call counts
   */
  ch?: { genes: string[]; normalMinAlt: number | null; normalMinRatio: number };
}

/**
 * The cohort's samples classed plasma ('b') or tissue ('a'), as a `ps` CTE of the patients with
 * both; `sides` keeps every classed sample, for questions about plasma alone. With `withinDays`,
 * a sample is kept only when the timeline dates it and a sample of the other kind within that
 * many days (`dated` and `near` say how many).
 */
function ctdnaSidesCtes(cohortSql: string, study: string, db: string, o: CtdnaSides): string {
  const fold = (x: string) => clinicalValueFoldSql(x);
  const lit = (vs: string[]) => vs.map((v) => fold(sq(v))).join(",");
  const dated = o.withinDays != null;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "cls AS (\n" +
    "  SELECT sample_unique_id AS suid, any(" + fold("attribute_value") + ") AS v\n" +
    "  FROM " + clinicalTable(db, [o.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(o.attribute) + "\n" +
    "    AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY suid\n" +
    "),\n" +
    "classed AS (\n" +
    "  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,\n" +
    "         multiIf(" + (o.plasmaPanels.length ? "sd.sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_to_gene_panel_derived WHERE cancer_study_identifier = " + sq(study) +
      " AND gene_panel_id IN (" + o.plasmaPanels.map(sq).join(",") + ")), 'b', " : "") +
    "cls.v IN (" + lit(o.plasma) + "), 'b', cls.v IN (" + lit(o.tissue) + "), 'a', '') AS side\n" +
    "  FROM " + db + ".sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id\n" +
    "  WHERE sd.cancer_study_identifier = " + sq(study) + " AND sd.patient_stable_id IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (dated
      ? "tl AS (\n" +
        "  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day\n" +
        "  FROM " + db + ".clinical_event ce\n" +
        "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
        "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
        "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("d.key", o.sampleKey) + "\n" +
        "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedInSql("ce.event_type", o.sampleEvents) + "\n" +
        "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid, sample\n" +
        "),\n" +
        "dated AS (SELECT c.suid AS suid, c.pid AS pid, c.side AS side, tl.day AS day FROM classed c INNER JOIN tl ON tl.pid = c.pid AND tl.sample = c.sample WHERE c.side != ''),\n" +
        "near AS (\n" +
        "  SELECT DISTINCT x.suid AS suid FROM dated x INNER JOIN dated y ON y.pid = x.pid\n" +
        "  WHERE x.side != y.side AND abs(x.day - y.day) <= " + Math.floor(o.withinDays!) + "\n" +
        "),\n" +
        "sides AS (SELECT suid, pid, side FROM classed WHERE side != '' AND suid IN (SELECT suid FROM near)),\n"
      : "sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),\n") +
    "paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),\n" +
    "ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired))" +
    (o.ch ? ",\n" + ctdnaChCte(study, db, o.ch) : "")
  );
}

/**
 * `chx`: the plasma samples' mutation calls a clonal-haematopoiesis rule removes — by gene, or by
 * alternate reads in the matched normal (mutation_derived's normal counts, where the study loads them).
 */
function ctdnaChCte(study: string, db: string, ch: NonNullable<CtdnaSides["ch"]>): string {
  const byGene = ch.genes.length ? "g.hugo_gene_symbol IN (" + ch.genes.map(sq).join(",") + ")" : "0";
  const normal = ch.normalMinAlt != null;
  return (
    (normal
      ? "nm AS (\n" +
        "  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,\n" +
        "         max(normalAltCount >= " + Math.floor(ch.normalMinAlt!) + " AND normalAltCount / (normalAltCount + normalRefCount) >= " + Number(ch.normalMinRatio) +
        " * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded\n" +
        "  FROM " + db + ".mutation_derived\n" +
        "  WHERE studyId = " + sq(study) + " AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')\n" +
        "  GROUP BY suid, gene, mv\n" +
        "),\n"
      : "") +
    "chx AS (\n" +
    "  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,\n" +
    "         max(" + byGene + ") AS by_gene, " + (normal ? "max(ifNull(nm.hit, 0) = 1)" : "toUInt8(0)") + " AS by_normal,\n" +
    "         " + (normal ? "max(ifNull(nm.loaded, 0) = 1)" : "toUInt8(0)") + " AS has_normal\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (normal ? "  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant\n" : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation'\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')\n" +
    "  GROUP BY suid, gene, mv\n" +
    ")"
  );
}

/** with a CH rule, the condition that keeps an event: not a plasma mutation call `chx` removes (`side` is the side column) */
const chKeep = (o: CtdnaSides, side: string): string | undefined => o.ch
  ? "NOT (" + side + " = 'b' AND g.variant_type = 'mutation' AND (g.sample_unique_id, g.hugo_gene_symbol, g.mutation_variant) IN (SELECT suid, gene, mv FROM chx WHERE by_gene OR by_normal))"
  : undefined;

/** the patients with any (driver) alteration called in a plasma sample */
function ctdnaDetectedCte(study: string, db: string, pin: string | null, measure: "driver" | "any", exclude?: string): string {
  return (
    "det AS (\n" +
    "  SELECT DISTINCT s.pid AS pid FROM " + db + ".genomic_event_derived g\n" +
    (pin && measure === "driver" ? driverJoin(pin) : "") +
    "  INNER JOIN sides s ON s.suid = g.sample_unique_id\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND s.side = 'b' AND " + ALTERED_COND + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')" + (pin && measure === "driver" ? " AND ann.is_driver" : measure === "driver" ? " AND 0" : "") +
    (exclude ? " AND " + exclude : "") + "\n" +
    ")"
  );
}
