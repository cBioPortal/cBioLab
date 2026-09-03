// Federation: an analysis document fulfilled by several *instances* of differing
// trust level.
//
// Two modes, one interface:
//   - patient-level  — the engine may see member ids. All views work.
//   - aggregate-only — the instance answers with counts only, never ids. Compare
//                      and survival work (their inputs decompose into sums);
//                      oncoprint cannot, because its columns ARE patients.
//
// The distinction is enforced STRUCTURALLY, not by a flag: AggregateResolver has
// no method that returns a patient id, so no code path — buggy or otherwise —
// can leak one. Adding such a method is a type error at every call site that
// expects the aggregate contract.
//
// PROTOTYPE NOTE: both resolvers presently talk to the same ClickHouse
// connection; the aggregate-only instance *declines* to expose patient-level
// data rather than being unable to reach it. That is a faithful test of the
// engine (merge math, capability negotiation, honest degradation) and a stub
// for the transport — a real deployment swaps in a second connection
// (data-level federation) or an MCP client to a remote Cohort Lab
// (document-level federation) behind the same interface.
import { chQuery, DB, PRIMARY, connections, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { canonicalEventName } from "./event-names.ts";
import { compileCohortDef } from "./cohort2.ts";
import { genomicEventsSql, coverageSql } from "./oncoprint.ts";
import type { CohortDef, CompileCtx, ChRow, ChResult } from "./types.ts";

export type InstanceMode = "patient-level" | "aggregate-only";

export interface Instance {
  id: string;
  mode: InstanceMode;
  /** human label for captions */
  label: string;
  /** the ClickHouse connection (and database) that answers for this instance */
  conn: ChConn;
}

/** per (cohort, gene) alteration tallies — the compare view's atom */
export interface GeneCounts { gene: string; profiled: number; altered: number; driver: number }
/** (months, event) multiset — pools exactly across instances, carries no ids */
export interface SurvivalCount {
  months: number; event: number; n: number;
  /** delayed-entry time; absent means observed from time zero */
  entry?: number;
}
/** How to re-anchor survival to a timeline event. */
export interface SurvivalAnchor {
  eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST";
}
/** Additive moments for one gene on a continuous profile. */
export interface ProfileMoments { gene: string; n: number; sum: number; sumsq: number }
/** One protein change and how many patients carry it. */
export interface VariantCount {
  gene: string; variant: string; type: string; pos: number | null; n: number;
}
/** Per-gene mutation totals — the denominator, and how much the cap withheld. */
export interface GeneMutationTotal { gene: string; n: number; distinctVariants: number }
export interface VariantReport { variants: VariantCount[]; totals: GeneMutationTotal[]; minCount: number }
/** Six sums for one gene pair on a continuous profile. Sufficient for Pearson's r. */
export interface PairMoments {
  a: string; b: string;
  n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number;
}
/** One clinical attribute's distribution in one cohort/study — counts or moments. */
export interface AttrStats {
  attribute: string; per: "patient" | "sample"; kind: "cat" | "num";
  /** categorical: the complete value distribution */
  values?: { v: string; n: number }[];
  /** numeric: additive moments, from which mean and variance are exact */
  n?: number; sum?: number; sumsq?: number; min?: number; max?: number;
  /** set when THIS site declines to describe it, with the reason */
  skipped?: string;
}
/** One gene pair's 2x2 among patients profiled for BOTH genes. Counts only. */
export interface PairCounts {
  a: string; b: string;
  both: number; onlyA: number; onlyB: number; neither: number; profiled: number;
}

/**
 * Access policy. Some studies in a portal database are consortium- or
 * institution-restricted (GENIE ships "-consortium" cohorts alongside their
 * "-public" counterparts, plus the private cohort). This deployment is a public
 * demo, so those are excluded — and excluded at the ROUTING layer, so no
 * surface can reach them: not the study picker, not a hand-written ?doc= link,
 * not an MCP call. Override with STUDY_ALLOW_RESTRICTED=1 in a deployment
 * entitled to the data; add ids to STUDY_DENY to exclude more.
 */
export function isRestrictedStudy(id: string, name = ""): boolean {
  const extra = (process.env.STUDY_DENY || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (extra.includes(id)) return true;
  if (process.env.STUDY_ALLOW_RESTRICTED === "1") return false;
  // GENIE's convention is a version SUFFIX: "v3.1-consortium" vs "v2.0-public".
  // Match that, not the bare word — several public studies are named after a
  // consortium (GLASS, A5, Pediatric Preclinical Testing) and must not be hidden.
  return /-consortium\b/i.test(name) || /\bprivate\b/i.test(name) || /_private$|^private_/i.test(id);
}

/**
 * study -> owning connection, discovered by asking each configured instance
 * which studies it holds. Cached per process. First instance wins a collision,
 * and the collision is reported rather than silently resolved. Restricted
 * studies are never routed, so they are unreachable rather than merely hidden.
 */
let _routing: Map<string, ChConn> | null = null;
export const routingCollisions: string[] = [];
/** ids withheld by policy — used to explain refusals rather than say "unknown" */
export const restrictedStudies = new Set<string>();
export async function studyRouting(): Promise<Map<string, ChConn>> {
  if (_routing) return _routing;
  const map = new Map<string, ChConn>();
  for (const conn of connections()) {
    try {
      const r = await chQuery<{ id: string; name: string }>(
        "SELECT cancer_study_identifier AS id, name FROM " + conn.db + ".cancer_study", conn);
      for (const { id, name } of r.data) {
        if (isRestrictedStudy(id, name)) { restrictedStudies.add(id); continue; }
        if (map.has(id)) { routingCollisions.push(id); continue; } // first instance wins; surfaced, not hidden
        map.set(id, conn);
      }
    } catch { /* an unreachable instance simply contributes no studies */ }
  }
  _routing = map;
  return map;
}

/** Instances the deployment treats as aggregate-only (prototype switch). */
function aggregateOnlyIds(): string[] {
  return (process.env.AGGREGATE_ONLY_INSTANCES || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}
/** Studies forced aggregate-only regardless of instance (finer-grained switch). */
function aggregateOnlyStudies(): string[] {
  return (process.env.AGGREGATE_ONLY_STUDIES || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

export async function instanceForStudy(study: string): Promise<Instance> {
  const conn = (await studyRouting()).get(study) || PRIMARY;
  const agg = aggregateOnlyIds().includes(conn.id) || aggregateOnlyStudies().includes(study);
  return {
    id: conn.id,
    mode: agg ? "aggregate-only" : "patient-level",
    label: conn.label + (agg ? " (aggregate-only)" : ""),
    conn
  };
}

// ---------------------------------------------------------------------------
// SQL builders shared by both resolvers. The aggregate resolver needs these
// pushed into ClickHouse (it may not pull rows back and tally in JS); the
// patient-level resolver benefits from the same pushdown.
// ---------------------------------------------------------------------------

/** high-level CNA only, matching the oncoprint/compare convention (±2) */
const ALTERED_COND = "(g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)";

function driverJoin(pin: string): string {
  return (
    "  LEFT JOIN oncokb_annotation.variant_annotation ann\n" +
    "    ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
    "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
    "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
    "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
    "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n"
  );
}

/**
 * Per-gene (profiled, altered, driver) counts for one cohort in one study,
 * computed entirely in the database. Returns counts only — no ids.
 */
export function geneCountsSql(cohortSql: string, genes: string[], study: string, pin: string | null, db: string = DB): string {
  const pid = "replaceOne(g.patient_unique_id, " + sq(study + "_") + ", '')";
  const covPid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  const geneList = genes.map(sq).join(",");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "altered AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, " + pid + " AS pid,\n" +
    (pin ? "         max(ann.is_driver) AS is_driver\n" : "         0 AS is_driver\n") +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY gene, pid\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covPid + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    ")\n" +
    "SELECT gene,\n" +
    "       uniqExact(pid) AS profiled,\n" +
    "       uniqExactIf(pid, is_alt) AS altered,\n" +
    "       uniqExactIf(pid, is_drv) AS driver\n" +
    "FROM (\n" +
    "  SELECT gene, pid, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered\n" +
    "  UNION ALL\n" +
    "  SELECT gene, pid, 0 AS is_alt, 0 AS is_drv FROM covered\n" +
    ")\n" +
    "GROUP BY gene"
  );
}

/**
 * Per-PAIR 2x2 counts for one cohort in one study: of the patients profiled for
 * both genes, how many carry both alterations, one, or neither.
 *
 * Returns four counts per pair and nothing else — which is the whole privacy
 * argument in one line. The alternative shape (a per-patient alteration bitmask,
 * which would answer every pair at once and be cheaper) is deliberately NOT used:
 * a bitmask row with n=1 is one patient's complete genomic profile.
 *
 * "Profiled for both" is computed here, against this study's own panels, because
 * only this instance knows what its panels cover. That is also why a federated
 * co-occurrence is more correct than one computed from pooled exports.
 */
export function pairCountsSql(cohortSql: string, pairs: [string, string][], study: string, db: string = DB): string {
  const genes = [...new Set(pairs.flat())];
  const geneList = genes.map(sq).join(",");
  const pid = "replaceOne(g.patient_unique_id, " + sq(study + "_") + ", '')";
  const covPid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  const arrA = "[" + pairs.map((p) => sq(p[0])).join(",") + "]";
  const arrB = "[" + pairs.map((p) => sq(p[1])).join(",") + "]";
  const bothCov = "has(cov, ga) AND has(cov, gb)";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "altered AS (\n" +
    "  SELECT DISTINCT g.hugo_gene_symbol AS gene, " + pid + " AS pid\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covPid + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    // one row per patient carrying the two gene sets it belongs to
    "pp AS (\n" +
    "  SELECT pid,\n" +
    "         groupUniqArrayIf(gene, k = 1) AS alt,\n" +
    "         groupUniqArrayIf(gene, k = 0) AS cov\n" +
    "  FROM (SELECT gene, pid, 1 AS k FROM altered UNION ALL SELECT gene, pid, 0 AS k FROM covered)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT ga, gb,\n" +
    "       countIf(" + bothCov + ") AS profiled,\n" +
    "       countIf(" + bothCov + " AND has(alt, ga) AND has(alt, gb)) AS both,\n" +
    "       countIf(" + bothCov + " AND has(alt, ga) AND NOT has(alt, gb)) AS only_a,\n" +
    "       countIf(" + bothCov + " AND NOT has(alt, ga) AND has(alt, gb)) AS only_b\n" +
    "FROM pp\n" +
    "ARRAY JOIN " + arrA + " AS ga, " + arrB + " AS gb\n" +
    "GROUP BY ga, gb"
  );
}

/**
 * Per-gene (n, sum, sum of squares) on a continuous profile.
 *
 * Used to build a z-score REFERENCE distribution. Note what this enables: an
 * instance that will never disclose a patient — and so can contribute no
 * oncoprint columns — can still contribute three totals per gene, which is
 * enough to define the population the drawn columns are scored against. The
 * reference gets broader without anyone's values moving.
 */
export function profileMomentsSql(cohortSql: string, genes: string[], profileType: string, study: string, db: string = DB): string {
  const pid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "vals AS (\n" +
    "  SELECT " + pid + " AS pid, ga.hugo_gene_symbol AS gene,\n" +
    "         avg(toFloat64OrNull(ga.alteration_value)) AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "    AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "    AND toFloat64OrNull(ga.alteration_value) IS NOT NULL\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid, gene\n" +
    ")\n" +
    "SELECT gene, count() AS n, sum(v) AS sx, sum(v * v) AS sxx FROM vals GROUP BY gene"
  );
}

/** Display cap on variants per gene; the per-gene total is reported separately. */
export const VARIANT_LIMIT = 100;

/**
 * Per-protein-change patient counts for a gene — the lollipop's data.
 *
 * NOTE that the codon is PARSED from the protein-change string (the schema has
 * no position column), so a variant whose change does not contain a number is
 * counted but not positioned, and says so rather than being dropped or placed
 * at zero.
 *
 * This is the most disclosive aggregate in the system: a private variant seen
 * in one patient is close to an identifier. `minCount` is the floor a site
 * applies BEFORE returning anything, which is where small-cell suppression
 * belongs — at the data holder, not at the coordinator.
 */
export function variantCountsSql(cohortSql: string, genes: string[], study: string, minCount = 1, db: string = DB): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const floor = Math.max(1, Math.floor(minCount));
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT hugo_gene_symbol AS gene, mutation_variant AS variant,\n" +
    "       any(mutation_type) AS mtype,\n" +
    "       toUInt32OrNull(extract(mutation_variant, '([0-9]+)')) AS pos,\n" +
    "       uniqExact(patient_unique_id) AS n\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND variant_type = 'mutation'\n" +
    "  AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND mutation_variant != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY gene, variant, pos\n" +
    "HAVING n >= " + floor + "\n" +
    "ORDER BY n DESC\n" +
    "LIMIT " + VARIANT_LIMIT + " BY gene"
  );
}

/** Patients carrying ANY mutation in each gene — the lollipop's denominator. */
export function geneMutationTotalsSql(cohortSql: string, genes: string[], study: string, db: string = DB): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT hugo_gene_symbol AS gene, uniqExact(patient_unique_id) AS n,\n" +
    "       uniqExact(mutation_variant) AS distinct_variants\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND variant_type = 'mutation'\n" +
    "  AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND mutation_variant != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY gene"
  );
}

/**
 * Six sums per gene pair from a continuous molecular profile: n, Sx, Sy, Sxy,
 * Sxx, Syy over the patients that have BOTH values.
 *
 * That is all a correlation depends on, so a site can join a co-expression
 * analysis without transmitting one expression value — and because the six sums
 * add, the federated correlation is exact rather than approximate. Values are
 * averaged per patient first, matching the oncoprint heatmap convention.
 */
export function momentPairsSql(cohortSql: string, pairs: [string, string][], profileType: string, study: string, db: string = DB): string {
  const genes = [...new Set(pairs.flat())];
  const arrA = "[" + pairs.map((p) => sq(p[0])).join(",") + "]";
  const arrB = "[" + pairs.map((p) => sq(p[1])).join(",") + "]";
  const pid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "vals AS (\n" +
    "  SELECT " + pid + " AS pid, ga.hugo_gene_symbol AS gene,\n" +
    "         avg(toFloat64OrNull(ga.alteration_value)) AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "    AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "    AND toFloat64OrNull(ga.alteration_value) IS NOT NULL\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid, gene\n" +
    "),\n" +
    "pp AS (SELECT pid, groupArray(gene) AS gs, groupArray(v) AS vs FROM vals GROUP BY pid)\n" +
    "SELECT ga, gb, countIf(ok) AS n,\n" +
    "       sumIf(x, ok) AS sx, sumIf(y, ok) AS sy,\n" +
    "       sumIf(x * y, ok) AS sxy, sumIf(x * x, ok) AS sxx, sumIf(y * y, ok) AS syy\n" +
    "FROM (\n" +
    "  SELECT ga, gb, indexOf(gs, ga) AS ia, indexOf(gs, gb) AS ib,\n" +
    "         (ia > 0 AND ib > 0) AS ok,\n" +
    "         if(ok, vs[ia], 0) AS x, if(ok, vs[ib], 0) AS y\n" +
    "  FROM pp\n" +
    "  ARRAY JOIN " + arrA + " AS ga, " + arrB + " AS gb\n" +
    ")\n" +
    "GROUP BY ga, gb"
  );
}

/** Cap on distinct categorical values before an attribute is refused rather than truncated. */
export const ATTR_VALUE_CAP = 200;

/**
 * Per-value counts for CATEGORICAL clinical attributes in one cohort/study.
 *
 * Returns the full value distribution up to ATTR_VALUE_CAP + 1 rows. It must be
 * complete: a chi-squared on a silently truncated contingency table is simply
 * wrong, so the caller refuses an attribute that exceeds the cap instead of
 * testing a partial table.
 */
export function clinicalCountsSql(cohortSql: string, attrs: string[], study: string, db: string = DB): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT attribute_name AS a, type AS per, attribute_value AS v,\n" +
    "       uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS n\n" +
    "FROM " + db + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND attribute_name IN (" + attrs.map(sq).join(",") + ")\n" +
    "  AND attribute_value != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY a, per, v\n" +
    "ORDER BY n DESC\n" +
    "LIMIT " + (ATTR_VALUE_CAP + 1) + " BY a, per"
  );
}

/**
 * (n, sum, sum of squares, min, max) for NUMERIC clinical attributes.
 *
 * These five numbers are additive across sites, so a pooled mean and variance —
 * and therefore Welch's t — are EXACT from per-site totals, never approximated.
 * No individual value is ever transmitted.
 */
export function clinicalMomentsSql(cohortSql: string, attrs: string[], study: string, db: string = DB): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx\n" +
    "FROM (\n" +
    "  SELECT attribute_name AS a, type AS per, toFloat64OrNull(attribute_value) AS x\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "    AND attribute_name IN (" + attrs.map(sq).join(",") + ")\n" +
    "    AND attribute_value != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    ")\n" +
    "WHERE x IS NOT NULL AND isFinite(x)\n" +
    "GROUP BY a, per"
  );
}

/**
 * (months, event, n) triples for one cohort in one study. Aggregate — pools
 * exactly with other instances' triples to give a correct pooled KM curve.
 */
/** Endpoint prefix -> the (<X>_MONTHS, <X>_STATUS) attribute pair cBioPortal stores. */
export const ENDPOINT_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * (months, event, n) triples for one cohort in one study. Aggregate — pools
 * exactly with other instances' triples to give a correct pooled KM curve.
 *
 * `endpoint` names the pair: "OS" reads OS_MONTHS/OS_STATUS, "PFS" reads
 * PFS_MONTHS/PFS_STATUS, and so on. Studies carry wildly different sets (this
 * database has 27 distinct pairs across 519 studies), so the caller must be
 * told when a study has nothing for the endpoint asked for rather than seeing
 * its patients quietly vanish from a curve.
 */
export function survivalCountsSql(cohortSql: string, study: string, db: string = DB, endpoint = "OS"): string {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = endpoint + "_MONTHS", status = endpoint + "_STATUS";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(months) + ") AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT toFloat64OrNull(months) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n\n" +
    "FROM os WHERE toFloat64OrNull(months) IS NOT NULL\n" +
    "GROUP BY m, ev ORDER BY m"
  );
}

/**
 * Survival re-anchored to a timeline event, with the delayed entry that implies.
 *
 * The study's <X>_MONTHS is measured from the timeline's day 0 (in MSK-CHORD
 * that is first sequencing). Anchoring at an earlier event — initial diagnosis,
 * first treatment — moves the clock back by `-anchorDay` and makes the patient
 * UNOBSERVABLE until day 0. Reporting that without also reporting the entry time
 * would manufacture immortal time: every patient would appear to survive from
 * the anchor to their sequencing, which is exactly what got them into the study.
 *
 * So this returns (entry, months, event, n): entry is the anchor-to-day-0 gap,
 * months is anchor-to-outcome. Still four numbers and a count — no identifiers,
 * still additive across sites.
 */
export function anchoredSurvivalSql(
  cohortSql: string, study: string, db: string, endpoint: string,
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" }
): string {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = endpoint + "_MONTHS", status = endpoint + "_STATUS";
  const pick = anchor.occurrence === "LAST" ? "max" : "min";
  const attrCond = anchor.key
    ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data\n" +
      "        WHERE key = " + sq(anchor.key) + " AND value = " + sq(String(anchor.value ?? "")) + ")\n"
    : "";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name=" + sq(months) + ")) AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND ce.event_type = " + sq(anchor.eventType) + "\n" + attrCond +
    "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    // offset = months from anchor to day 0; only anchors at or before day 0 make
    // sense as a start of follow-up, so later ones are dropped and counted.
    "SELECT round(-anch.day / 30.4375, 4) AS entry,\n" +
    "       round(os.months - anch.day / 30.4375, 4) AS m,\n" +
    "       if(os.status LIKE '1%', 1, 0) AS ev, count() AS n\n" +
    "FROM os INNER JOIN anch USING (pid)\n" +
    "WHERE os.months IS NOT NULL AND anch.day <= 0\n" +
    "GROUP BY entry, m, ev ORDER BY m"
  );
}

/** Which (<X>_MONTHS, <X>_STATUS) pairs a study actually declares. Metadata only. */
export function survivalEndpointsSql(study: string, db: string = DB): string {
  return (
    "SELECT replaceOne(cam.attr_id, '_MONTHS', '') AS endpoint\n" +
    "FROM " + db + ".clinical_attribute_meta cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND cam.attr_id LIKE '%\\_MONTHS'\n" +
    "  AND replaceOne(cam.attr_id, '_MONTHS', '_STATUS') IN (\n" +
    "    SELECT cam2.attr_id FROM " + db + ".clinical_attribute_meta cam2\n" +
    "    JOIN " + db + ".cancer_study cs2 ON cs2.cancer_study_id = cam2.cancer_study_id\n" +
    "    WHERE cs2.cancer_study_identifier = " + sq(study) + ")\n" +
    "ORDER BY endpoint"
  );
}

// ---------------------------------------------------------------------------
// Timeline: alignment and the clinical course
// ---------------------------------------------------------------------------

/** Days per month, matching the constant survival already uses. */
const DAYS_PER_MONTH = 30.4375;

/**
 * Match an event type by CANONICAL name. Curators spell one concept several
 * ways (`Treatment` / `TREATMENT`), and the database stores those as distinct
 * literals, so a canonical name has to match case-insensitively at the column.
 * See lib/event-names.ts for why case+trim is the whole rule.
 */
function eventTypeMatchSql(col: string, canonical: string): string {
  return "lower(trim(" + col + ")) = " + sq(canonicalEventName(canonical));
}

/**
 * What a cohort's timeline looks like STRUCTURALLY, per event type: how many
 * patients, how many distinct days it spans, and how many of its events carry a
 * real duration (`stop_date` beyond `start_date`).
 *
 * Two jobs. It powers the degenerate-timeline gate — 17 of the 131 studies with
 * timeline rows put every event on a single day, and without this they render an
 * empty chart instead of an error. And `interval_events` is how the course view
 * decides to draw a band rather than a mark, WITHOUT consulting the event's
 * name: empirically only treatments carry duration, but that is a fact to be
 * read off the data, not hardcoded from a spelling.
 */
export function timelineSpanSql(cohortSql: string, study: string, db: string = DB): string {
  const pid = "p.stable_id";
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT ce.event_type AS et,\n" +
    "       uniqExact(" + pid + ") AS pts,\n" +
    "       count() AS events,\n" +
    "       uniqExact(ce.start_date) AS days,\n" +
    "       min(ce.start_date) AS first_day,\n" +
    "       max(ce.start_date) AS last_day,\n" +
    "       countIf(ce.stop_date IS NOT NULL AND ce.stop_date != ce.start_date) AS interval_events\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY et ORDER BY pts DESC"
  );
}

/** One event type's structural footprint in a cohort's timeline. */
export interface TimelineSpan {
  /** the spelling as stored; fold with canonicalEventName for grouping */
  eventType: string;
  patients: number; events: number;
  /** distinct days — 1 means the study records no temporal information at all */
  days: number;
  firstDay: number; lastDay: number;
  /** events with a real duration; >0 means draw a band, not a mark */
  intervalEvents: number;
}

/** One (bin, state) cell. `eventType: ''` is the at-risk denominator. */
export interface CourseCount { bin: number; eventType: string; n: number }

export interface CourseOpts {
  /** align on this event; null aligns on the study's own day 0 (single study only) */
  anchor: SurvivalAnchor | null;
  /** canonical event names to measure */
  eventTypes: string[];
  /** bin width in months */
  binMonths: number;
  /** inclusive bin index range, relative to the anchor */
  from: number;
  to: number;
}

/**
 * The clinical course: for each time bin relative to the anchor, how many
 * patients were still observable and how many were in each event state.
 *
 * BIN ARITHMETIC. Bins are half-open, `[anchor + b*w, anchor + (b+1)*w)`, and a
 * span `[s, e]` occupies every bin from `floor((s-anchor)/w)` to
 * `floor((e-anchor)/w)`. Half-open matters: with closed bins the anchoring
 * treatment itself spills into the bin *before* the anchor and reports 100% of
 * the cohort already on treatment before their first treatment. Point events
 * (`stop_date` null or equal) fall out of the same formula with s == e, so
 * there is one code path, not two.
 *
 * DENOMINATOR. Not the whole cohort — the patients still under observation in
 * that bin, which is the at-risk logic Kaplan-Meier uses. Without it a curve
 * decays merely because follow-up ran out. Observation runs from the patient's
 * first recorded event (the same left-truncation notion `anchoredSurvivalSql`
 * applies) to their last contact: the later of their last recorded event and
 * their OS follow-up where the study declares one.
 *
 * Rows come back as (bin, et, n); `et = ''` carries the at-risk denominator.
 */
export function eventCourseSql(
  cohortSql: string, study: string, db: string, opts: CourseOpts
): string {
  const w = Math.max(1, Number(opts.binMonths) || 3) * DAYS_PER_MONTH;
  const lo = Math.floor(Number(opts.from)), hi = Math.floor(Number(opts.to));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new Error("bad course window");
  const types = [...new Set((opts.eventTypes || []).map(canonicalEventName).filter(Boolean))].slice(0, 8);
  if (!types.length) throw new Error("course view needs at least one event type");
  const anchor = opts.anchor;
  const pid = "p.stable_id";
  const studyWhere =
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n";

  // Anchor day per patient. Without an anchor every patient aligns on day 0,
  // which is only meaningful inside one study — the caller enforces that.
  const anchCte = anchor
    ? "anch AS (\n" +
      "  SELECT " + pid + " AS pid, " + (anchor.occurrence === "LAST" ? "max" : "min") + "(ce.start_date) AS day\n" +
      "  FROM " + db + ".clinical_event ce\n" + studyWhere +
      "    AND " + eventTypeMatchSql("ce.event_type", anchor.eventType) + "\n" +
      (anchor.key
        ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data\n" +
          "        WHERE lower(trim(key)) = " + sq(canonicalEventName(anchor.key)) +
          " AND value = " + sq(String(anchor.value ?? "")) + ")\n"
        : "") +
      "  GROUP BY pid\n" +
      ")"
    : "anch AS (\n" +
      "  SELECT DISTINCT " + pid + " AS pid, CAST(0 AS Int64) AS day\n" +
      "  FROM " + db + ".clinical_event ce\n" + studyWhere +
      ")";

  // Bins a [s,e] span occupies, clamped to the window so an anchor far from
  // day 0 (birth-anchored studies sit ~6000 days out) cannot explode the range.
  const binsOf = (s: string, e: string) =>
    "range(\n" +
    "    toInt32(greatest(floor((" + s + " - a.day) / " + w + "), " + lo + ")),\n" +
    "    toInt32(least(floor((" + e + " - a.day) / " + w + "), " + hi + ")) + 1)";

  return (
    "WITH cohort AS (" + cohortSql + "),\n" + anchCte + ",\n" +
    // Observation window: first recorded event to last contact.
    "os AS (\n" +
    "  SELECT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) * " + DAYS_PER_MONTH + " AS os_day\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient'\n" +
    "    AND attribute_name = 'OS_MONTHS'\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "span AS (\n" +
    "  SELECT " + pid + " AS pid, min(ce.start_date) AS entry,\n" +
    "         max(coalesce(ce.stop_date, ce.start_date)) AS last_ev\n" +
    "  FROM " + db + ".clinical_event ce\n" + studyWhere +
    "  GROUP BY pid\n" +
    "),\n" +
    // last_ev is Int64 and os_day Float64; cast so greatest() has a supertype.
    "obs AS (\n" +
    "  SELECT sp.pid AS pid, toFloat64(sp.entry) AS entry,\n" +
    "         greatest(toFloat64(sp.last_ev), coalesce(os.os_day, toFloat64(sp.last_ev))) AS last_day\n" +
    "  FROM span sp LEFT JOIN os ON os.pid = sp.pid\n" +
    "),\n" +
    // Denominator: one row per (patient, bin) they were observable in.
    "denom AS (\n" +
    "  SELECT arrayJoin(" + binsOf("o.entry", "o.last_day") + ") AS bin, o.pid AS pid, '' AS et\n" +
    "  FROM obs o JOIN anch a ON a.pid = o.pid\n" +
    "),\n" +
    // Numerator: one row per (patient, bin, event type) the patient was in that
    // state. Half-open bins via floor() — see the note above.
    "numer AS (\n" +
    "  SELECT arrayJoin(" + binsOf("ce.start_date", "coalesce(ce.stop_date, ce.start_date)") + ") AS bin,\n" +
    "         " + pid + " AS pid, lower(trim(ce.event_type)) AS et\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN anch a ON a.pid = " + pid + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "    AND lower(trim(ce.event_type)) IN (" + types.map(sq).join(", ") + ")\n" +
    ")\n" +
    "SELECT bin, et, uniqExact(pid) AS n\n" +
    "FROM (SELECT bin, pid, et FROM denom UNION ALL SELECT bin, pid, et FROM numer)\n" +
    "GROUP BY bin, et ORDER BY bin, et"
  );
}

export interface SequenceOpts {
  /** canonical event type carrying the therapies */
  eventType: string;
  /** attribute key labelling each therapy (SUBTYPE, TREATMENT_TYPE, AGENT…) */
  labelKey: string;
  /** label values to drop — a DOCUMENT-level choice, see the note below */
  exclude: string[];
  /** days with no therapy that begin a new line */
  lineGap: number;
  /** how many lines to follow */
  maxSteps: number;
}

/** One transition. `to: ''` means the patient began no further line. */
export interface SequenceFlow { step: number; from: string; to: string; n: number }

/**
 * Treatment sequences: what follows what.
 *
 * LINES, NOT RECORDS. A patient has a median of 6 treatment records and 4
 * distinct agents, often overlapping — combination therapy is several records
 * describing ONE decision. So records are first grouped into *lines*: therapies
 * separated by less than `lineGap` days of no treatment belong to the same line,
 * and a line's label is its combination, sorted so `A + B` and `B + A` are one
 * thing. This is the window-function scheme lib/compiler.ts already uses for its
 * derived treatment lines, generalised off MSK's fixed SUBTYPE allowlist.
 *
 * WHY `exclude` IS A PARAMETER AND NOT A RULE. In MSK-CHORD the SUBTYPE value
 * `Prior Medications to MSK` is a data-provenance marker, not a therapy — but it
 * is NOT structurally distinguishable: it carries no duration, and neither do
 * `Radiation Therapy` or `Investigational`, which are real treatments. There is
 * no honest way for the engine to tell them apart, so the choice belongs in the
 * document where a reader can see it, not buried in a hardcoded list here.
 *
 * Rows are (step, from, to, n) with `to = ''` for "no further line", so the
 * flows out of a node sum to that node's size and nobody is silently dropped.
 */
export function sequenceSql(
  cohortSql: string, study: string, db: string, opts: SequenceOpts
): string {
  const gap = Math.max(1, Math.min(3650, Math.floor(Number(opts.lineGap) || 90)));
  const steps = Math.max(2, Math.min(8, Math.floor(Number(opts.maxSteps) || 3)));
  const et = canonicalEventName(opts.eventType || "treatment");
  const key = canonicalEventName(opts.labelKey || "");
  if (!key) throw new Error("a sequence view needs a labelKey (e.g. SUBTYPE)");
  const drop = [...new Set((opts.exclude || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 40);
  const pid = "p.stable_id";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "tx AS (\n" +
    "  SELECT ce.clinical_event_id AS eid, " + pid + " AS pid, ce.start_date AS s,\n" +
    "         coalesce(ce.stop_date, ce.start_date) AS e, trim(d.value) AS lbl\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
    "    AND lower(trim(d.key)) = " + sq(key) + "\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + eventTypeMatchSql("ce.event_type", et) + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "    AND trim(d.value) != ''\n" +
    (drop.length ? "    AND trim(d.value) NOT IN (" + drop.map(sq).join(", ") + ")\n" : "") +
    "),\n" +
    // toNullable: over an empty frame max() on a non-nullable column returns 0,
    // which corrupts first-row detection because day offsets are often <= 0.
    "flagged AS (\n  SELECT *, max(toNullable(e)) OVER (PARTITION BY pid\n" +
    "    ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms\n  FROM tx\n),\n" +
    "numbered AS (\n  SELECT *, sum(if(pms IS NULL OR s > pms + " + gap + ", 1, 0)) OVER (\n" +
    "    PARTITION BY pid ORDER BY s, e, eid ROWS UNBOUNDED PRECEDING) AS line_no\n  FROM flagged\n),\n" +
    // A line's identity is its COMBINATION, sorted so ordering cannot split one
    // regimen into two apparent states.
    "lines AS (\n  SELECT pid, line_no,\n" +
    "         arrayStringConcat(arraySort(groupUniqArray(lbl)), ' + ') AS combo\n" +
    "  FROM numbered GROUP BY pid, line_no\n),\n" +
    "seq AS (\n  SELECT pid, line_no, combo,\n" +
    "         leadInFrame(combo) OVER (PARTITION BY pid ORDER BY line_no\n" +
    "           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS nxt\n" +
    "  FROM lines\n)\n" +
    "SELECT line_no AS step, combo AS a, coalesce(nxt, '') AS b, uniqExact(pid) AS n\n" +
    "FROM seq WHERE line_no <= " + steps + "\n" +
    "GROUP BY step, a, b ORDER BY n DESC LIMIT 2000"
  );
}

/** Which label keys a study's therapy events actually carry, and how varied. */
export function sequenceKeysSql(cohortSql: string, study: string, db: string, eventType: string): string {
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT lower(trim(d.key)) AS k, any(trim(d.key)) AS label,\n" +
    "       uniqExact(p.stable_id) AS pts, uniqExact(trim(d.value)) AS values\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "  AND " + eventTypeMatchSql("ce.event_type", eventType) + "\n" +
    "  AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "GROUP BY k ORDER BY pts DESC LIMIT 25"
  );
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/**
 * Does this definition carry explicit patient identifiers? A `patients` leaf
 * embeds ids directly into the compiled SQL, so sending one to an instance
 * that is not entitled to patient-level data would push identifiers across
 * exactly the boundary this design exists to respect — and the ids are
 * study-scoped anyway, so they could never match there.
 */
export function carriesPatientIds(def: CohortDef | null | undefined): boolean {
  if (!def) return false;
  if (Array.isArray(def.patients) && def.patients.length) return true;
  const leafHasIds = (l: any): boolean => !!l && l.kind === "patients" && Array.isArray(l.ids) && l.ids.length > 0;
  for (const c of def.all || []) {
    const any = (c as any).any, not = (c as any).not;
    if (Array.isArray(any) ? any.some(leafHasIds) : false) return true;
    if (not && leafHasIds(not)) return true;
    if (leafHasIds(c)) return true;
  }
  return false;
}

const NO_IDS_MSG =
  "this cohort contains an explicit patient list, which cannot be sent to an instance that is not entitled to patient-level data";

/** What every participant can answer, whatever its trust level. */
export interface AggregateCapable {
  readonly instance: Instance;
  readonly study: string;
  /** cohort size — a count, not a roster */
  count(def: CohortDef | null | undefined): Promise<number>;
  geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]>;
  survivalCounts(def: CohortDef | null | undefined, endpoint?: string, anchor?: SurvivalAnchor | null): Promise<SurvivalCount[]>;
  /** endpoints this participant can answer for; [] when it cannot say */
  survivalEndpoints(): Promise<string[]>;
  /** structural shape of this cohort's timeline, per event type */
  timelineSpan(def: CohortDef | null | undefined): Promise<TimelineSpan[]>;
  /** per-bin clinical course; `et: ''` rows carry the at-risk denominator */
  eventCourse(def: CohortDef | null | undefined, opts: CourseOpts): Promise<CourseCount[]>;
  /** line-to-line therapy transitions; `to: ''` means no further line */
  treatmentSequence(def: CohortDef | null | undefined, opts: SequenceOpts): Promise<SequenceFlow[]>;
  /** which attribute keys could label a therapy line here */
  sequenceKeys(def: CohortDef | null | undefined, eventType: string): Promise<{ key: string; label: string; patients: number; values: number }[]>;
  pairCounts(def: CohortDef | null | undefined, pairs: [string, string][]): Promise<PairCounts[]>;
  attributeStats(def: CohortDef | null | undefined, attributes: string[]): Promise<AttrStats[]>;
  pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]>;
  variantCounts(def: CohortDef | null | undefined, genes: string[], minCount?: number): Promise<VariantReport>;
  profileMoments(def: CohortDef | null | undefined, genes: string[], profileType: string): Promise<ProfileMoments[]>;
  /** the SQL this participant would run, for provenance */
  cohortSql(def: CohortDef | null | undefined): string;
  /**
   * Every aggregate query this resolver ran, in order. The document panel shows
   * cohort SQL; this is how each NUMBER was computed, which is the part a reader
   * checking a result actually needs.
   */
  readonly queries: QueryLogEntry[];
}

/** One query a resolver actually ran, for provenance. */
export interface QueryLogEntry { label: string; sql: string; ms?: number; remote?: boolean }

/** Additionally available when the instance permits patient-level access. */
export interface PatientLevelCapable extends AggregateCapable {
  readonly instance: Instance & { mode: "patient-level" };
  members(def: CohortDef | null | undefined): Promise<string[]>;
}

export type Resolver = AggregateCapable | PatientLevelCapable;

export function isPatientLevel(r: Resolver): r is PatientLevelCapable {
  return r.instance.mode === "patient-level";
}

// NOTE: no TS parameter properties / enums / namespaces anywhere in this repo —
// Node runs the scripts and MCP server through strip-only type removal, which
// rejects any TypeScript syntax that would emit code.
abstract class BaseResolver implements AggregateCapable {
  abstract readonly instance: Instance;
  readonly study: string;
  readonly queries: QueryLogEntry[] = [];
  protected readonly ctx: Partial<CompileCtx>;
  /**
   * Run a query and record it with what it cost. The entry is pushed BEFORE the
   * await and stamped after, so concurrent queries each update their own entry
   * rather than racing for "the last one".
   */
  protected async runLogged<R = ChRow>(label: string, sql: string, conn: ChConn): Promise<ChResult<R>> {
    const entry: QueryLogEntry = { label, sql };
    this.queries.push(entry);
    const r = await chQuery<R>(sql, conn);
    entry.ms = r._ms;
    return r;
  }
  constructor(study: string, ctx: Partial<CompileCtx>) {
    this.study = study;
    this.ctx = ctx;
  }

  cohortSql(def: CohortDef | null | undefined): string {
    return compileCohortDef(def, { ...this.ctx, study: this.study, db: this.instance.conn.db });
  }
  async count(def: CohortDef | null | undefined): Promise<number> {
    const r = await chQuery<ChRow>("SELECT count() AS n FROM (" + this.cohortSql(def) + ")", this.instance.conn);
    return Number(r.data[0].n);
  }
  async geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]> {
    if (!genes.length) return [];
    const r = await this.runLogged<ChRow>("geneCounts",
      geneCountsSql(this.cohortSql(def), genes, this.study, this.ctx.oncokbPin ?? null, this.instance.conn.db), this.instance.conn);
    return r.data.map((x) => ({
      gene: x.gene, profiled: Number(x.profiled), altered: Number(x.altered), driver: Number(x.driver)
    }));
  }
  async survivalCounts(def: CohortDef | null | undefined, endpoint = "OS", anchor?: SurvivalAnchor | null): Promise<SurvivalCount[]> {
    const sql = anchor
      ? anchoredSurvivalSql(this.cohortSql(def), this.study, this.instance.conn.db, endpoint, anchor)
      : survivalCountsSql(this.cohortSql(def), this.study, this.instance.conn.db, endpoint);
    const r = await this.runLogged<ChRow>("survivalCounts:" + endpoint + (anchor ? "@" + anchor.eventType : ""), sql, this.instance.conn);
    return r.data.map((x) => ({
      months: Number(x.m), event: Number(x.ev), n: Number(x.n),
      ...(anchor ? { entry: Number(x.entry) } : {})
    }));
  }
  async survivalEndpoints(): Promise<string[]> {
    const r = await chQuery<ChRow>(survivalEndpointsSql(this.study, this.instance.conn.db), this.instance.conn)
      .catch(() => ({ data: [] as ChRow[] }));
    return r.data.map((x) => String(x.endpoint));
  }
  async timelineSpan(def: CohortDef | null | undefined): Promise<TimelineSpan[]> {
    const sql = timelineSpanSql(this.cohortSql(def), this.study, this.instance.conn.db);
    const r = await this.runLogged<ChRow>("timelineSpan", sql, this.instance.conn);
    return r.data.map((x) => ({
      eventType: String(x.et), patients: Number(x.pts), events: Number(x.events),
      days: Number(x.days), firstDay: Number(x.first_day), lastDay: Number(x.last_day),
      intervalEvents: Number(x.interval_events)
    }));
  }
  async treatmentSequence(def: CohortDef | null | undefined, opts: SequenceOpts): Promise<SequenceFlow[]> {
    const sql = sequenceSql(this.cohortSql(def), this.study, this.instance.conn.db, opts);
    const r = await this.runLogged<ChRow>("treatmentSequence:" + opts.labelKey + "/gap" + opts.lineGap, sql, this.instance.conn);
    return r.data.map((x) => ({ step: Number(x.step), from: String(x.a), to: String(x.b), n: Number(x.n) }));
  }
  async sequenceKeys(def: CohortDef | null | undefined, eventType: string): Promise<{ key: string; label: string; patients: number; values: number }[]> {
    const sql = sequenceKeysSql(this.cohortSql(def), this.study, this.instance.conn.db, eventType);
    const r = await this.runLogged<ChRow>("sequenceKeys", sql, this.instance.conn).catch(() => ({ data: [] as ChRow[] }));
    return r.data.map((x) => ({ key: String(x.k), label: String(x.label), patients: Number(x.pts), values: Number(x.values) }));
  }
  async eventCourse(def: CohortDef | null | undefined, opts: CourseOpts): Promise<CourseCount[]> {
    const sql = eventCourseSql(this.cohortSql(def), this.study, this.instance.conn.db, opts);
    const label = "eventCourse:" + (opts.anchor ? "@" + opts.anchor.eventType : "day0") +
      "/" + opts.binMonths + "mo";
    const r = await this.runLogged<ChRow>(label, sql, this.instance.conn);
    return r.data.map((x) => ({ bin: Number(x.bin), eventType: String(x.et), n: Number(x.n) }));
  }
  async profileMoments(def: CohortDef | null | undefined, genes: string[], profileType: string): Promise<ProfileMoments[]> {
    if (!genes.length || !profileType) return [];
    const r = await this.runLogged<ChRow>("profileMoments",
      profileMomentsSql(this.cohortSql(def), genes, profileType, this.study, this.instance.conn.db), this.instance.conn);
    return r.data.map((x) => ({ gene: x.gene, n: Number(x.n), sum: Number(x.sx), sumsq: Number(x.sxx) }));
  }

  async variantCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<VariantReport> {
    const empty = { variants: [], totals: [], minCount };
    if (!genes.length) return empty;
    const cohort = this.cohortSql(def), db = this.instance.conn.db, conn = this.instance.conn;
    const [v, t] = await Promise.all([
      this.runLogged<ChRow>("variantCounts", variantCountsSql(cohort, genes, this.study, minCount, db), conn),
      this.runLogged<ChRow>("geneMutationTotals", geneMutationTotalsSql(cohort, genes, this.study, db), conn)
    ]);
    return {
      minCount,
      variants: v.data.map((x) => ({
        gene: x.gene, variant: x.variant, type: x.mtype,
        pos: x.pos == null || x.pos === "" ? null : Number(x.pos), n: Number(x.n)
      })),
      totals: t.data.map((x) => ({ gene: x.gene, n: Number(x.n), distinctVariants: Number(x.distinct_variants) }))
    };
  }

  async pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]> {
    if (!pairs.length || !profileType) return [];
    const r = await this.runLogged<ChRow>("pairMoments",
      momentPairsSql(this.cohortSql(def), pairs, profileType, this.study, this.instance.conn.db), this.instance.conn);
    return r.data.map((x) => ({
      a: x.ga, b: x.gb, n: Number(x.n),
      sx: Number(x.sx), sy: Number(x.sy), sxy: Number(x.sxy), sxx: Number(x.sxx), syy: Number(x.syy)
    }));
  }

  /**
   * Clinical attribute distributions. The SITE decides which of its attributes
   * are numeric, from its own clinical_attribute_meta — only it knows what it
   * declared. An attribute it does not declare is reported as skipped rather
   * than sniffed from the data and silently mis-typed.
   */
  async attributeStats(def: CohortDef | null | undefined, attributes: string[]): Promise<AttrStats[]> {
    const attrs = [...new Set(attributes)].filter((a) => /^[A-Za-z0-9_]{1,64}$/.test(a)).slice(0, 20);
    if (!attrs.length) return [];
    const db = this.instance.conn.db, conn = this.instance.conn;
    const list = attrs.map(sq).join(",");
    const meta = await chQuery<ChRow>(
      "SELECT cam.attr_id AS a, upper(cam.datatype) AS dt\n" +
      "FROM " + db + ".clinical_attribute_meta cam\n" +
      "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
      "WHERE cs.cancer_study_identifier = " + sq(this.study) + " AND cam.attr_id IN (" + list + ")", conn)
      .catch(() => ({ data: [] as ChRow[] }));
    const kindOf = new Map<string, "cat" | "num">(
      meta.data.map((r) => [r.a, String(r.dt) === "NUMBER" ? "num" as const : "cat" as const]));
    const catAttrs = attrs.filter((a) => kindOf.get(a) === "cat");
    const numAttrs = attrs.filter((a) => kindOf.get(a) === "num");
    const cohort = this.cohortSql(def);
    const empty = { data: [] as ChRow[] };
    const [cats, nums] = await Promise.all([
      catAttrs.length ? this.runLogged<ChRow>("clinicalCounts", clinicalCountsSql(cohort, catAttrs, this.study, db), conn) : Promise.resolve(empty),
      numAttrs.length ? this.runLogged<ChRow>("clinicalMoments", clinicalMomentsSql(cohort, numAttrs, this.study, db), conn) : Promise.resolve(empty)
    ]);
    const out: AttrStats[] = [];
    const grouped = new Map<string, { per: string; values: { v: string; n: number }[] }>();
    for (const r of cats.data) {
      if (!grouped.has(r.a)) grouped.set(r.a, { per: r.per, values: [] });
      grouped.get(r.a)!.values.push({ v: r.v, n: Number(r.n) });
    }
    for (const a of catAttrs) {
      const g = grouped.get(a);
      if (!g) { out.push({ attribute: a, per: "patient", kind: "cat", values: [] }); continue; }
      out.push(g.values.length > ATTR_VALUE_CAP
        // refused, not truncated: a chi-squared on a partial table is wrong
        ? { attribute: a, per: g.per as "patient" | "sample", kind: "cat",
            skipped: "more than " + ATTR_VALUE_CAP + " distinct values in " + this.study + "; a contingency test on a truncated table would be wrong" }
        : { attribute: a, per: g.per as "patient" | "sample", kind: "cat", values: g.values });
    }
    for (const r of nums.data) {
      out.push({ attribute: r.a, per: r.per as "patient" | "sample", kind: "num",
        n: Number(r.n), sum: Number(r.sx), sumsq: Number(r.sxx), min: Number(r.mn), max: Number(r.mx) });
    }
    for (const a of attrs) {
      if (!kindOf.has(a))
        out.push({ attribute: a, per: "patient", kind: "cat", skipped: "not declared by " + this.study });
    }
    return out;
  }

  async pairCounts(def: CohortDef | null | undefined, pairs: [string, string][]): Promise<PairCounts[]> {
    if (!pairs.length) return [];
    const r = await this.runLogged<ChRow>("pairCounts",
      pairCountsSql(this.cohortSql(def), pairs, this.study, this.instance.conn.db), this.instance.conn);
    return r.data.map((x) => {
      const profiled = Number(x.profiled), both = Number(x.both), onlyA = Number(x.only_a), onlyB = Number(x.only_b);
      return { a: x.ga, b: x.gb, both, onlyA, onlyB, profiled, neither: profiled - both - onlyA - onlyB };
    });
  }
}

/** Full access: may return member ids, so every view is answerable. */
/**
 * Full access. Note that runAnalysis does NOT call members() — cohort sizes are
 * counts, and the oncoprint re-derives its columns inside the owning database
 * from the cohort SQL. The method is kept deliberately: it is the structural
 * marker of the entitlement, and the type system routes any future feature that
 * genuinely needs identities to an instance permitted to give them.
 */
export class PatientLevelResolver extends BaseResolver implements PatientLevelCapable {
  readonly instance: Instance & { mode: "patient-level" };
  constructor(study: string, ctx: Partial<CompileCtx>, instance: Instance) {
    super(study, ctx);
    this.instance = { ...instance, mode: "patient-level" };
  }
  async members(def: CohortDef | null | undefined): Promise<string[]> {
    const r = await chQuery<ChRow>("SELECT pid FROM (" + this.cohortSql(def) + ")", this.instance.conn);
    return r.data.map((x) => x.pid);
  }
}

/**
 * Aggregate-only participant. Note what is NOT here: there is no members(),
 * no row fetch, no id-returning method of any kind. Everything it can answer
 * is a count computed inside the database.
 */
export class AggregateResolver extends BaseResolver {
  readonly instance: Instance;
  constructor(study: string, ctx: Partial<CompileCtx>, instance: Instance) {
    super(study, ctx);
    this.instance = instance;
  }
  /** compiled SQL for an aggregate-only instance may never embed identifiers */
  cohortSql(def: CohortDef | null | undefined): string {
    if (carriesPatientIds(def)) throw new Error(NO_IDS_MSG + " (" + this.instance.label + ")");
    return super.cohortSql(def);
  }
}

export async function resolverFor(study: string, ctx: Partial<CompileCtx>): Promise<Resolver> {
  // A peer reached over MCP takes precedence: its data is not ours to query.
  const { peerForStudy, RemoteAggregateResolver } = await import("./federation-remote.ts");
  const peer = peerForStudy(study);
  if (peer) {
    return new RemoteAggregateResolver(study, peer.url, {
      id: "peer", mode: "aggregate-only", label: peer.label, conn: PRIMARY /* unused: nothing is queried locally */
    });
  }
  const inst = await instanceForStudy(study);
  return inst.mode === "patient-level"
    ? new PatientLevelResolver(study, ctx, inst)
    : new AggregateResolver(study, ctx, inst);
}

/** Expand pooled (months, event, n) triples into KM input records. */
export function expandSurvivalCounts(counts: SurvivalCount[]): { t: number; event: number; entry?: number }[] {
  const out: { t: number; event: number; entry?: number }[] = [];
  for (const c of counts)
    for (let i = 0; i < c.n; i++)
      out.push(c.entry == null ? { t: c.months, event: c.event } : { t: c.months, event: c.event, entry: c.entry });
  return out;
}
