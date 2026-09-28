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
// (data-level federation) or an MCP client to a remote cbio-lab
// (document-level federation) behind the same interface.
import { chQuery, DB, PRIMARY, connections, isAbortError, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { canonicalEventName } from "./event-names.ts";
import { compileCohortDef, eventTypeMatchSql } from "./cohort2.ts";
import { axisKind, axisLabel, axisSelect, corrPValue, plotShape, tukey, validateAxis,
  categoryColor, CATEGORY_CAP, COLOR_CAP, DEFAULT_BINS, POINTS_CAP, VIOLIN_BINS,
  plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotMomentsSql, plotPointsSql, plotStatsSql, plotTableSql, plotViolinSql,
  type AxisKind, type PlotAxis, type PlotData, type PlotPoint, type PlotRequest, type PlotShape } from "./plot.ts";
// re-exported so test/boundary.test.ts sweeps them with the other aggregate SQL builders
export * from "./federation-more.ts";
export { plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotMomentsSql, plotStatsSql, plotTableSql, plotViolinSql };
export type { PlotData, PlotRequest, PlotGroup, PlotPoint } from "./plot.ts";
import type { Moments } from "./stats.ts";

/** the colour key: the commonest categories, capped, each with the colour every renderer uses */
export function legendFor(values: string[], ring = false): { label: string; color: string; ring?: boolean }[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, COLOR_CAP)
    .map(([label], i) => ({ label, color: categoryColor(label, i), ...(ring ? { ring: true } : {}) }));
}

const num = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) ? x : null; };
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

/** profiled/altered for one alteration type alone */
export interface TypeCounts { profiled: number; altered: number }
/**
 * per (cohort, gene) alteration tallies — the compare view's atom. `profiled`/`altered`/`driver`
 * combine mutation+CNA+structural-variant, matching the oncoprint's "any alteration" convention;
 * `byType` carries the same profiled/altered split PER type, so a caller can tell "0% altered,
 * fully assayed" apart from "0% altered because this whole type was never assayed here" — a study
 * with zero CNA data (no COPY_NUMBER_ALTERATION panel entries at all) would otherwise report a
 * CNA-only gene as a false 0%, indistinguishable from a real negative result.
 */
export interface GeneCounts {
  gene: string; profiled: number; altered: number; driver: number;
  byType: { mutation: TypeCounts; cna: TypeCounts; structuralVariant: TypeCounts };
}
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
/**
 * Explicit (months, status) column names, overriding the `<endpoint>_MONTHS`/`<endpoint>_STATUS`
 * naming convention — for a study whose outcome columns don't follow it (a real, not hypothetical,
 * gap: several MSK papers store e.g. `PFS_MONTHS_FIRST_LINE_TX`/`PROGRESSION_STATUS`, which the
 * convention-based endpoint discovery has no way to find). `endpoint` is then purely a display
 * label, not something the engine derives column names from.
 */
export interface EndpointColumns { months: string; status: string }
/** Additive moments for one gene on a continuous profile. */
export interface ProfileMoments { gene: string; n: number; sum: number; sumsq: number }
/** One protein change and how many patients carry it. */
export interface VariantCount {
  gene: string; variant: string; type: string; pos: number | null; n: number;
}
/** Per-gene mutation totals — the denominator, and how much the cap withheld. */
export interface GeneMutationTotal { gene: string; n: number; distinctVariants: number }
export interface VariantReport { variants: VariantCount[]; totals: GeneMutationTotal[]; minCount: number }
/** One (codon, protein change) of a gene: distinct patients carrying it, and raw mutation rows. */
export interface LollipopChange { gene: string; pos: number | null; change: string; n: number; rows: number; driver: boolean }
/** Raw mutation rows of one type at one codon — what a lollipop's colour is decided from. */
export interface LollipopType { gene: string; pos: number | null; mtype: string; driver: boolean; rows: number }
export interface LollipopTotal { gene: string; patients: number; pairs: number; somaticSamples: number }
/**
 * A site's per-codon lollipop counts. `annotated` is false when no OncoKB pin was available, in
 * which case every change reads as a driver — cBioPortal's own rule when driver annotation is off.
 */
export interface LollipopReport {
  changes: LollipopChange[]; types: LollipopType[]; totals: LollipopTotal[];
  cohortSamples: number; minCount: number; annotated: boolean;
}
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
  /**
   * numeric, single-study callers only (attributeStats' `histograms` option): the complete
   * (value, count) distribution — enough for an exact median/IQR or a rank-sum test, computed
   * by the caller. Not requested (and not meaningful to combine across sites) otherwise.
   */
  valueCounts?: { v: number; n: number }[];
  /** true when histograms were requested but this attribute had more than HISTOGRAM_CAP distinct
   *  values — valueCounts is omitted rather than sent truncated, since a quantile or rank sum
   *  from a partial histogram would be wrong, not merely approximate */
  histogramTruncated?: boolean;
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
  let complete = true;
  for (const conn of connections()) {
    try {
      const r = await chQuery<{ id: string; name: string }>(
        "SELECT cancer_study_identifier AS id, name FROM " + conn.db + ".cancer_study", conn);
      for (const { id, name } of r.data) {
        if (isRestrictedStudy(id, name)) { restrictedStudies.add(id); continue; }
        if (map.has(id)) { routingCollisions.push(id); continue; } // first instance wins; surfaced, not hidden
        map.set(id, conn);
      }
    } catch (e) {
      // A CANCELLED query says nothing about the instance — the reader simply left. Swallowing
      // it here and memoizing the result below poisoned the process: the map cached empty, every
      // later request answered "unknown study <x>", and only a restart cleared it. Let it out.
      if (isAbortError(e)) throw e;
      complete = false; /* an unreachable instance simply contributes no studies */
    }
  }
  // Only a complete answer is worth remembering; a partial one would outlive the outage that
  // produced it, and a transient failure would look permanent.
  if (complete) _routing = map;
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
export const ALTERED_COND = "(g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)";

export function driverJoin(pin: string): string {
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
 * Per-gene (profiled, altered, driver) counts for one cohort in one study, BOTH combined (vtype
 * = 'any', matching the oncoprint's "any alteration" convention) and split per alteration type
 * (vtype = 'mutation' | 'cna' | 'structural_variant') — computed entirely in the database,
 * counts only, no ids.
 *
 * The per-type split exists so a caller can tell "0% altered, fully assayed" apart from "0%
 * altered because this whole type was never assayed here": a study with zero CNA data has no
 * COPY_NUMBER_ALTERATION rows in sample_to_gene_panel_derived, so a CNA-only gene's 'cna' row
 * naturally comes back with profiled=0 — a signal the combined 'any' row alone cannot carry,
 * since it can only ever say "altered" or "not altered", never "never checked".
 */
export function geneCountsSql(cohortSql: string, genes: string[], study: string, pin: string | null, db: string = DB): string {
  const pid = "replaceOne(g.patient_unique_id, " + sq(study + "_") + ", '')";
  const covPid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  const geneList = genes.map(sq).join(",");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "altered AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, " + pid + " AS pid, g.variant_type AS vtype,\n" +
    (pin ? "         max(ann.is_driver) AS is_driver\n" : "         0 AS is_driver\n") +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY gene, pid, vtype\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covPid + " AS pid,\n" +
    "         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',\n" +
    "                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "raw AS (\n" +
    "  SELECT gene, pid, vtype, max(is_alt) AS is_alt, max(is_drv) AS is_drv\n" +
    "  FROM (\n" +
    "    SELECT gene, pid, vtype, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered\n" +
    "    UNION ALL\n" +
    "    SELECT gene, pid, vtype, 0 AS is_alt, 0 AS is_drv FROM covered\n" +
    "  )\n" +
    "  GROUP BY gene, pid, vtype\n" +
    "),\n" +
    "perPatient AS (\n" +
    "  SELECT gene, pid, max(is_alt) AS is_alt, max(is_drv) AS is_drv\n" +
    "  FROM raw GROUP BY gene, pid\n" +
    ")\n" +
    "SELECT gene, vtype,\n" +
    "       uniqExact(pid) AS profiled, uniqExactIf(pid, is_alt = 1) AS altered, uniqExactIf(pid, is_drv = 1) AS driver\n" +
    "FROM raw GROUP BY gene, vtype\n" +
    "UNION ALL\n" +
    "SELECT gene, 'any' AS vtype,\n" +
    "       uniqExact(pid) AS profiled, uniqExactIf(pid, is_alt = 1) AS altered, uniqExactIf(pid, is_drv = 1) AS driver\n" +
    "FROM perPatient GROUP BY gene"
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

/**
 * The lollipop's rows, counted the way cBioPortal's results-page mutation tab counts them
 * (react-mutation-mapper): one stem per codon — the stored proteinPosStart, never parsed from
 * the change string — whose height is the number of distinct (patient, protein change) pairs
 * there. The four builders below share this CTE. The suppression floor applies to a
 * (codon, change) pair's patient count, at the data holder, before anything leaves.
 */
function lollipopCte(cohortSql: string, genes: string[], study: string, minCount: number, pin: string | null, db: string): string {
  const floor = Math.max(1, Math.floor(minCount));
  // with no pin there is no annotation to split drivers from VUS, and cBioPortal then colours
  // everything as a driver; the report says which happened
  const driver = pin
    ? "if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM oncokb_annotation.variant_annotation\n" +
      "        WHERE oncokb_version = " + sq(pin) + " AND is_driver AND alteration_type = 'MUTATION'), 1, 0)"
    : "1";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,\n" +
    "                  patientId AS pid, sampleId AS sid, mutationStatus AS status, " + driver + " AS driver\n" +
    "           FROM " + db + ".mutation_derived\n" +
    "           WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` IN (" + genes.map(sq).join(",") + ")\n" +
    "             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''\n" +
    "             AND patientId IN (SELECT pid FROM cohort)),\n" +
    "     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= " + floor + ")\n"
  );
}
/** Per (codon, change): distinct patients (the height), raw rows (the label's ordering). */
export function lollipopChangesSql(cohortSql: string, genes: string[], study: string, minCount = 1, pin: string | null = null, db: string = DB): string {
  return lollipopCte(cohortSql, genes, study, minCount, pin, db) +
    "SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver\n" +
    "FROM m GROUP BY gene, pos, change HAVING n >= " + Math.max(1, Math.floor(minCount));
}
/**
 * Per (codon, mutation type, driver): raw rows — a codon's colour is decided from these, and the
 * gene's Driver/VUS tally by type is their sum. A mutation with no codon has pos NULL and still
 * counts toward the tally (the portal's badges count every mutation row), so the floor's
 * membership test compares pos through ifNull rather than letting NULL fail the tuple match.
 */
export function lollipopTypesSql(cohortSql: string, genes: string[], study: string, minCount = 1, pin: string | null = null, db: string = DB): string {
  return lollipopCte(cohortSql, genes, study, minCount, pin, db) +
    "SELECT gene, pos, mtype, driver, count() AS rows\n" +
    "FROM m WHERE (gene, ifNull(pos, -1), change) IN (SELECT gene, ifNull(pos, -1), change FROM kept) GROUP BY gene, pos, mtype, driver";
}
/** Per gene: mutated patients, distinct (patient, change) pairs, and samples with a somatic one. */
export function lollipopTotalsSql(cohortSql: string, genes: string[], study: string, db: string = DB): string {
  return lollipopCte(cohortSql, genes, study, 1, null, db) +
    "SELECT gene, uniqExact(pid) AS patients, uniqExact((pid, change)) AS pairs,\n" +
    "       uniqExactIf(sid, status != 'GERMLINE') AS somatic_samples\n" +
    "FROM m GROUP BY gene";
}
/** Samples in the cohort — the somatic mutation frequency's denominator. */
export function cohortSampleCountSql(cohortSql: string, study: string, db: string = DB): string {
  return "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT uniqExact(sample_unique_id) AS n FROM " + db + ".sample_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM cohort)";
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

/** Cap on distinct numeric values before a rank-sum test is refused rather than run on a truncated
 *  histogram — mirrors ATTR_VALUE_CAP's "refuse, don't truncate" for the categorical case, at a
 *  much larger bound since a real numeric attribute's distinct-value count is legitimately close
 *  to cohort size (ages, scores, lab values), not the small closed vocabulary a category has. */
export const HISTOGRAM_CAP = 20000;

/**
 * The COMPLETE (value, count) distribution for NUMERIC clinical attributes in one cohort/study —
 * every distinct value, not a sample. This is what a median, an IQR, or a rank-based test needs:
 * unlike (n, sum, sumsq), those are not additive across sites, so this is only ever requested for
 * a single-study view, where "the histogram" and "the whole distribution" are the same thing.
 * Capped at HISTOGRAM_CAP + 1 rows per attribute; the caller refuses (attributeStats sets
 * histogramTruncated) rather than compute a quantile or a rank sum from a partial histogram.
 */
export function clinicalHistogramSql(cohortSql: string, attrs: string[], study: string, db: string = DB): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "     raw AS (\n" +
    "       SELECT attribute_name AS a, type AS per, toFloat64OrNull(attribute_value) AS x\n" +
    "       FROM " + db + ".clinical_data_derived\n" +
    "       WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "         AND attribute_name IN (" + attrs.map(sq).join(",") + ")\n" +
    "         AND attribute_value != ''\n" +
    "         AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "     )\n" +
    "SELECT a, per, x, count() AS n\n" +
    "FROM raw\n" +
    "WHERE x IS NOT NULL AND isFinite(x)\n" +
    "GROUP BY a, per, x\n" +
    "ORDER BY n DESC\n" +
    "LIMIT " + (HISTOGRAM_CAP + 1) + " BY a, per"
  );
}

/**
 * One number: the exact p-th quantile of a numeric clinical attribute within one cohort, in one
 * study — the reference population for a percentile-based cohort cutoff (item 4 of the CRC/APC
 * roadmap's "features that would have helped", e.g. Samstein's "top 20% TMB per cancer type").
 * A single ClickHouse aggregate; no individual value leaves the database, only the resolved
 * threshold — same shape as every other aggregate here.
 */
export function attributeQuantileSql(cohortSql: string, attribute: string, per: "patient" | "sample", p: number, study: string, db: string = DB): string {
  if (!(p > 0 && p < 1)) throw new Error("attributeQuantileSql: p must be between 0 and 1 (exclusive), got " + p);
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT quantileExact(" + p + ")(toFloat64OrNull(attribute_value)) AS q\n" +
    "FROM " + db + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attribute) + "\n" +
    "  AND type = " + sq(per) + " AND attribute_value != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)"
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
export function survivalCountsSql(cohortSql: string, study: string, db: string = DB, endpoint = "OS", columns?: EndpointColumns): string {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
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
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" },
  columns?: EndpointColumns
): string {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
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

/**
 * Per-patient rows for a Cox fit: one row per patient with a valid endpoint measurement AND
 * every requested covariate defined (a patient missing any covariate is left out entirely, the
 * usual listwise-deletion rule for a multivariate fit). No patient identifier is SELECTed —
 * `os.pid` only joins the CTEs together — so this can only ever leave the resolver as fitted
 * coefficients, never as a roster; that is also why, unlike survivalCountsSql, this is
 * patient-level only (see PatientLevelResolver.coxRows) rather than something every
 * participant can answer.
 */
export function coxRowsSql(
  cohortSql: string, study: string, db: string, endpoint: string, covariates: { label: string; sel: string }[],
  columns?: EndpointColumns
): string {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  const covCtes = covariates.map((c) => c.label + " AS (\n" + c.sel + "\n)").join(",\n");
  const joins = covariates.map((c) => "INNER JOIN " + c.label + " ON " + c.label + ".id = os.pid").join("\n  ");
  const select = covariates.map((c) => c.label + ".v AS " + c.label).join(", ");
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
    ")" + (covCtes ? ",\n" + covCtes : "") + "\n" +
    "SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev" + (select ? ", " + select : "") + "\n" +
    "FROM os\n" + (joins ? "  " + joins + "\n" : "") +
    "WHERE os.months IS NOT NULL"
  );
}

/**
 * Per-patient (outcome, covariate values) rows for a logistic fit — patient-level only, same
 * boundary reason as coxRowsSql (see its comment). Unlike Cox/survival, there is no special
 * `<endpoint>_MONTHS`/`<endpoint>_STATUS` convention here: the outcome is just another
 * axis-selected CTE like any covariate, joined the same way. The caller turns its raw value
 * into 0/1 (an observed level for a categorical outcome, already-validated 0/1 for a numeric
 * one) — this SQL only assembles the rows, one per patient with a value on every axis.
 */
export function logisticRowsSql(
  cohortSql: string, outcome: { label: string; sel: string }, covariates: { label: string; sel: string }[]
): string {
  const ctes = [outcome, ...covariates].map((c) => c.label + " AS (\n" + c.sel + "\n)").join(",\n");
  const joins = covariates.map((c) => "INNER JOIN " + c.label + " ON " + c.label + ".id = " + outcome.label + ".id").join("\n  ");
  const select = covariates.map((c) => c.label + ".v AS " + c.label).join(", ");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" + ctes + "\n" +
    "SELECT " + outcome.label + ".v AS y" + (select ? ", " + select : "") + "\n" +
    "FROM " + outcome.label + (joins ? "\n  " + joins : "")
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

/**
 * One transition. `to: ''` means no further line — and `fate` says whether that
 * is a finding or an artefact: 1 = the study kept watching for at least one line
 * gap and saw no further line; 2 = the record simply ends, so nothing can be
 * concluded. (0 = the patient went on to another line.)
 */
export interface SequenceFlow { step: number; from: string; to: string; n: number; fate: 0 | 1 | 2 }

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
    // A line's identity is its COMBINATION, sorted so ordering cannot split one
    // regimen into two apparent states. line_end is kept to judge the fate below.
    "lines AS (\n  SELECT pid, line_no,\n" +
    "         arrayStringConcat(arraySort(groupUniqArray(lbl)), ' + ') AS combo,\n" +
    "         max(e) AS line_end\n" +
    "  FROM numbered GROUP BY pid, line_no\n),\n" +
    // How long the study kept watching, from ANY event type plus OS follow-up.
    // This is what separates "we saw them not start another line" from "the
    // records simply stop" — see the fate expression below.
    "os AS (\n" +
    "  SELECT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) * " + DAYS_PER_MONTH + " AS os_day\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient'\n" +
    "    AND attribute_name = 'OS_MONTHS'\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "seen AS (\n" +
    "  SELECT " + pid + " AS pid, max(coalesce(ce.stop_date, ce.start_date)) AS max_ev\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "obs AS (\n" +
    "  SELECT sn.pid AS pid,\n" +
    "         greatest(toFloat64(sn.max_ev), coalesce(os.os_day, toFloat64(sn.max_ev))) AS last_seen\n" +
    "  FROM seen sn LEFT JOIN os ON os.pid = sn.pid\n" +
    "),\n" +
    "seq AS (\n  SELECT pid, line_no, combo, line_end,\n" +
    "         leadInFrame(combo) OVER (PARTITION BY pid ORDER BY line_no\n" +
    "           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS nxt\n" +
    "  FROM lines\n),\n" +
    "fated AS (\n" +
    "  SELECT sq2.line_no AS line_no, sq2.combo AS combo, sq2.pid AS pid,\n" +
    "         coalesce(sq2.nxt, '') AS nxt,\n" +
    // 0 = went on to another line. Otherwise: did the study watch long enough to
    // RULE ONE OUT? A new line needs a gap greater than `gap` days by definition,
    // so ruling one out needs at least that much observation after the line ends.
    // Anything less is censoring, and calling it "stopped treatment" would be a
    // statement about the record-keeping dressed up as one about the patient.
    "         if(coalesce(sq2.nxt, '') != '', 0,\n" +
    "            if(coalesce(o.last_seen, toFloat64(sq2.line_end)) - sq2.line_end >= " + gap + ", 1, 2)) AS fate\n" +
    "  FROM seq sq2 LEFT JOIN obs o ON o.pid = sq2.pid\n" +
    ")\n" +
    "SELECT line_no AS step, combo AS a, nxt AS b, fate, uniqExact(pid) AS n\n" +
    "FROM fated WHERE line_no <= " + steps + "\n" +
    "GROUP BY step, a, b, fate ORDER BY n DESC LIMIT 2000"
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
 * Does this definition carry explicit sample or patient identifiers? A
 * `sampleList`/`patientList` leaf embeds ids directly into the compiled SQL,
 * so sending one to an instance that is not entitled to patient-level data
 * would push identifiers across exactly the boundary this design exists to
 * respect — and the ids are study-qualified anyway, so they could never
 * match there. These leaves are refused for federation entirely: they
 * simply never reach an aggregate-only or remote participant.
 */
export function carriesPatientIds(def: CohortDef | null | undefined): boolean {
  if (!def) return false;
  const leafHasIds = (l: any): boolean =>
    !!l && (l.kind === "sampleList" || l.kind === "patientList") && Array.isArray(l.ids) && l.ids.length > 0;
  for (const c of def.all || []) {
    const any = (c as any).any, not = (c as any).not;
    if (Array.isArray(any) ? any.some(leafHasIds) : false) return true;
    if (not && leafHasIds(not)) return true;
    if (leafHasIds(c)) return true;
  }
  return false;
}

const NO_IDS_MSG =
  "this cohort contains an explicit sample or patient list, which cannot be sent to an instance that is not entitled to patient-level data";

/** What every participant can answer, whatever its trust level. */
export interface AggregateCapable {
  readonly instance: Instance;
  readonly study: string;
  /** cohort size — a count, not a roster */
  count(def: CohortDef | null | undefined): Promise<number>;
  geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]>;
  survivalCounts(def: CohortDef | null | undefined, endpoint?: string, anchor?: SurvivalAnchor | null, columns?: EndpointColumns): Promise<SurvivalCount[]>;
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
  /** a plot's aggregated contract: bins, groups or cells — never points */
  plot(def: CohortDef | null | undefined, spec: PlotRequest): Promise<PlotData>;
  attributeStats(def: CohortDef | null | undefined, attributes: string[], opts?: { histograms?: boolean }): Promise<AttrStats[]>;
  /** the p-th quantile of a numeric clinical attribute in this cohort — the reference population
   *  for a percentile-based cohort cutoff. null when the attribute has no values here. */
  attributeQuantile(def: CohortDef | null | undefined, attribute: string, per: "patient" | "sample", p: number): Promise<number | null>;
  pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]>;
  variantCounts(def: CohortDef | null | undefined, genes: string[], minCount?: number): Promise<VariantReport>;
  /** per-codon counts for the lollipop (see lollipopCte) — aggregates only */
  lollipopCounts(def: CohortDef | null | undefined, genes: string[], minCount?: number): Promise<LollipopReport>;
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
  /** the values behind a box plot, with their case ids — the entitlement, in one method */
  plotPoints(def: CohortDef | null | undefined, spec: PlotRequest, cap?: number): Promise<PlotPoint[]>;
  readonly instance: Instance & { mode: "patient-level" };
  members(def: CohortDef | null | undefined): Promise<string[]>;
  /** per-patient rows for a Cox fit — see PatientLevelResolver.coxRows for why this is here and not on AggregateCapable */
  coxRows(def: CohortDef | null | undefined, endpoint: string, covariates: PlotAxis[], columns?: EndpointColumns):
    Promise<{ rows: { t: number; event: number; values: (number | string)[] }[]; kinds: AxisKind[] }>;
  /** per-patient rows for a logistic fit — same reason as coxRows */
  logisticRows(def: CohortDef | null | undefined, outcome: PlotAxis, covariates: PlotAxis[]):
    Promise<{ rows: { y: number | string; values: (number | string)[] }[]; outcomeKind: AxisKind; kinds: AxisKind[] }>;
  /** one row per patient (never an identifier) for a lib/views-more.ts view — see PatientLevelResolver.moreRows */
  moreRows(label: string, def: CohortDef | null | undefined, build: (cohortSql: string, study: string, db: string) => string): Promise<ChRow[]>;
}

export type Resolver = AggregateCapable | PatientLevelCapable;

export function isPatientLevel(r: Resolver): r is PatientLevelCapable {
  return r.instance.mode === "patient-level";
}

/**
 * The per-site pieces a federated plot needs (see BaseResolver's "a federated plot" methods,
 * below) — available on every local participant, patient-level or aggregate-only alike, but not
 * yet on a remote MCP peer (RemoteAggregateResolver.plot() itself still refuses even a single
 * study). Kept as its own capability interface rather than optional methods on AggregateCapable,
 * the same way PatientLevelCapable is kept separate from it: a caller should be told which
 * participants lack a capability, not find out from an undefined method call.
 */
export interface FederatedPlotCapable {
  plotAxisKinds(spec: { x: PlotAxis; y: PlotAxis }): Promise<{ xk: AxisKind; yk: AxisKind; shape: PlotShape; xLabel: string; yLabel: string }>;
  plotExtent(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ n: number; x0: number; x1: number; y0: number; y1: number }>;
  plotBinCounts(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind,
    bins: [number, number], extent: { x0: number; x1: number; y0: number; y1: number }): Promise<{ bx: number; by: number; n: number }[]>;
  plotMoments(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<Moments>;
  plotTableCells(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ cx: string; cy: string; n: number }[]>;
  plotBoxRows(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number }[]>;
  plotCoverage(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ total: number; nx: number; ny: number }>;
}
/**
 * The aggregates behind the view kinds in lib/views-more.ts. Every local participant has them,
 * aggregate-only included; a remote MCP peer does not yet, so those views name it as unable to
 * answer rather than silently leaving its patients out.
 */
export interface MoreAggregateCapable {
  moreAggregate(label: string, def: CohortDef | null | undefined,
    build: (cohortSql: string, study: string, db: string) => string): Promise<ChRow[]>;
  moreMeta(label: string, build: (study: string, db: string) => string): Promise<ChRow[]>;
}
export function hasMoreAggregates(r: Resolver): r is Resolver & MoreAggregateCapable {
  return typeof (r as unknown as Partial<MoreAggregateCapable>).moreAggregate === "function";
}
export function hasFederatedPlot(r: Resolver): r is Resolver & FederatedPlotCapable {
  return typeof (r as unknown as Partial<FederatedPlotCapable>).plotAxisKinds === "function";
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
    const zeroType = (): TypeCounts => ({ profiled: 0, altered: 0 });
    const byGene = new Map<string, GeneCounts>();
    for (const g of genes) byGene.set(g, { gene: g, profiled: 0, altered: 0, driver: 0,
      byType: { mutation: zeroType(), cna: zeroType(), structuralVariant: zeroType() } });
    for (const x of r.data) {
      const g = byGene.get(x.gene as string);
      if (!g) continue; // defensive: a row for a gene we didn't ask about
      const profiled = Number(x.profiled), altered = Number(x.altered), driver = Number(x.driver);
      if (x.vtype === "any") { g.profiled = profiled; g.altered = altered; g.driver = driver; }
      else if (x.vtype === "mutation") g.byType.mutation = { profiled, altered };
      else if (x.vtype === "cna") g.byType.cna = { profiled, altered };
      else if (x.vtype === "structural_variant") g.byType.structuralVariant = { profiled, altered };
    }
    return genes.map((g) => byGene.get(g)!);
  }
  async survivalCounts(def: CohortDef | null | undefined, endpoint = "OS", anchor?: SurvivalAnchor | null, columns?: EndpointColumns): Promise<SurvivalCount[]> {
    const sql = anchor
      ? anchoredSurvivalSql(this.cohortSql(def), this.study, this.instance.conn.db, endpoint, anchor, columns)
      : survivalCountsSql(this.cohortSql(def), this.study, this.instance.conn.db, endpoint, columns);
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
    return r.data.map((x) => ({ step: Number(x.step), from: String(x.a), to: String(x.b),
      n: Number(x.n), fate: Number(x.fate) as 0 | 1 | 2 }));
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

  async lollipopCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<LollipopReport> {
    const pin = this.ctx.oncokbPin ?? null;
    const empty: LollipopReport = { changes: [], types: [], totals: [], cohortSamples: 0, minCount, annotated: !!pin };
    if (!genes.length) return empty;
    const cohort = this.cohortSql(def), db = this.instance.conn.db, conn = this.instance.conn;
    const pos = (x: unknown) => x == null || x === "" ? null : Number(x);
    const [c, t, tot, cs] = await Promise.all([
      this.runLogged<ChRow>("lollipop:changes", lollipopChangesSql(cohort, genes, this.study, minCount, pin, db), conn),
      this.runLogged<ChRow>("lollipop:types", lollipopTypesSql(cohort, genes, this.study, minCount, pin, db), conn),
      this.runLogged<ChRow>("lollipop:totals", lollipopTotalsSql(cohort, genes, this.study, db), conn),
      this.runLogged<ChRow>("lollipop:samples", cohortSampleCountSql(cohort, this.study, db), conn)
    ]);
    return {
      minCount, annotated: !!pin, cohortSamples: Number(cs.data[0]?.n || 0),
      changes: c.data.map((x) => ({ gene: String(x.gene), pos: pos(x.pos), change: String(x.change), n: Number(x.n), rows: Number(x.rows), driver: Number(x.driver) === 1 })),
      types: t.data.map((x) => ({ gene: String(x.gene), pos: pos(x.pos), mtype: String(x.mtype), driver: Number(x.driver) === 1, rows: Number(x.rows) })),
      totals: tot.data.map((x) => ({ gene: String(x.gene), patients: Number(x.patients), pairs: Number(x.pairs), somaticSamples: Number(x.somatic_samples) }))
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
  async attributeStats(def: CohortDef | null | undefined, attributes: string[], opts?: { histograms?: boolean }): Promise<AttrStats[]> {
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
    const [cats, nums, hist] = await Promise.all([
      catAttrs.length ? this.runLogged<ChRow>("clinicalCounts", clinicalCountsSql(cohort, catAttrs, this.study, db), conn) : Promise.resolve(empty),
      numAttrs.length ? this.runLogged<ChRow>("clinicalMoments", clinicalMomentsSql(cohort, numAttrs, this.study, db), conn) : Promise.resolve(empty),
      opts?.histograms && numAttrs.length
        ? this.runLogged<ChRow>("clinicalHistogram", clinicalHistogramSql(cohort, numAttrs, this.study, db), conn)
        : Promise.resolve(empty)
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
    const histGrouped = new Map<string, { v: number; n: number }[]>();
    for (const r of hist.data) {
      const key = r.a + "|" + r.per;
      if (!histGrouped.has(key)) histGrouped.set(key, []);
      histGrouped.get(key)!.push({ v: Number(r.x), n: Number(r.n) });
    }
    for (const r of nums.data) {
      const vc = histGrouped.get(r.a + "|" + r.per);
      const truncated = !!vc && vc.length > HISTOGRAM_CAP;
      out.push({ attribute: r.a, per: r.per as "patient" | "sample", kind: "num",
        n: Number(r.n), sum: Number(r.sx), sumsq: Number(r.sxx), min: Number(r.mn), max: Number(r.mx),
        ...(opts?.histograms ? { valueCounts: truncated ? undefined : vc, histogramTruncated: truncated } : {}) });
    }
    for (const a of attrs) {
      if (!kindOf.has(a))
        out.push({ attribute: a, per: "patient", kind: "cat", skipped: "not declared by " + this.study });
    }
    return out;
  }

  async attributeQuantile(def: CohortDef | null | undefined, attribute: string, per: "patient" | "sample", p: number): Promise<number | null> {
    const r = await this.runLogged<ChRow>("attributeQuantile",
      attributeQuantileSql(this.cohortSql(def), attribute, per, p, this.study, this.instance.conn.db), this.instance.conn);
    const v = r.data[0]?.q;
    return v == null || v === "" ? null : Number(v);
  }

  /**
   * Which of these axes' clinical attributes the STUDY declares as numbers. Only it knows: it
   * declared them. An attribute it does not declare has no answer here rather than a guess.
   */
  protected async clinicalKinds(axes: PlotAxis[]): Promise<Map<string, "num" | "cat">> {
    const db = this.instance.conn.db, conn = this.instance.conn;
    const attrs = axes.filter((a) => a.source === "clinical").map((a) => (a as { attribute: string }).attribute);
    const kinds = new Map<string, "num" | "cat">();
    if (!attrs.length) return kinds;
    const meta = await chQuery<ChRow>(
      "SELECT cam.attr_id AS a, upper(cam.datatype) AS dt\n" +
      "FROM " + db + ".clinical_attribute_meta cam\n" +
      "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
      "WHERE cs.cancer_study_identifier = " + sq(this.study) + " AND cam.attr_id IN (" + attrs.map(sq).join(",") + ")", conn)
      .catch(() => ({ data: [] as ChRow[] }));
    for (const r of meta.data) kinds.set(String(r.a), String(r.dt) === "NUMBER" ? "num" : "cat");
    return kinds;
  }

  /**
   * A plot: two axes over the same cases, aggregated inside the database.
   *
   * Nothing here returns a point. A scatter comes back as counts per grid cell, a box as
   * quartiles per group, a contingency as counts per pair — so the answer is a few kilobytes
   * whatever the cohort's size, and an aggregate-only participant can compute it at all.
   */
  async plot(def: CohortDef | null | undefined, spec: PlotRequest): Promise<PlotData> {
    const db = this.instance.conn.db, conn = this.instance.conn;
    validateAxis(spec.x, "x");
    validateAxis(spec.y, "y");
    const unit = spec.unit === "sample" ? "sample" as const : "patient" as const;
    const ctx = { study: this.study, db, unit, cohortSql: this.cohortSql(def) };

    const kinds = await this.clinicalKinds([spec.x, spec.y]);
    const kindOf = (attr: string) => kinds.get(attr);
    const xk = axisKind(spec.x, kindOf), yk = axisKind(spec.y, kindOf);
    const shape = plotShape(xk, yk);
    if (shape === "waterfall") throw new Error("an ordered-cases axis (a waterfall) is not implemented yet; give both axes a source");
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const label = { x: { label: axisLabel(spec.x), kind: xk }, y: { label: axisLabel(spec.y), kind: yk } };
    // alongside the plot's own queries, never failing it: a missing coverage just means no note
    const coverage = this.runLogged<ChRow>("plot:coverage", plotCoverageSql(xSel, ySel, ctx), conn)
      .then((r) => ({ total: Number(r.data[0]?.total || 0), nx: Number(r.data[0]?.nx || 0), ny: Number(r.data[0]?.ny || 0) }))
      .catch(() => undefined);
    const done = async (d: PlotData): Promise<PlotData> => { const c = await coverage; return c ? { ...d, coverage: c } : d; };

    if (shape === "scatter") {
      const c = await this.runLogged<ChRow>("plot:extent", plotCountSql(xSel, ySel, ctx.cohortSql, true), conn);
      const n = Number(c.data[0]?.n || 0);
      if (!n) return done({ shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" });
      const [st, bins] = await Promise.all([
        this.runLogged<ChRow>("plot:stats", plotStatsSql(xSel, ySel, ctx.cohortSql), conn),
        this.runLogged<ChRow>("plot:bins", plotBinsSql(xSel, ySel, ctx.cohortSql, spec.bins), conn)
      ]);
      const r = st.data[0] || {};
      const pearson = num(r.pearson), spearman = num(r.spearman);
      return done({
        shape, n, ...label,
        extent: { x0: Number(c.data[0].x0), x1: Number(c.data[0].x1), y0: Number(c.data[0].y0), y1: Number(c.data[0].y1) },
        grid: [spec.bins?.[0] ?? DEFAULT_BINS[0], spec.bins?.[1] ?? DEFAULT_BINS[1]],
        bins: bins.data.map((b) => ({ bx: Number(b.bx), by: Number(b.by), n: Number(b.n) })),
        stats: { pearson, spearman, slope: num(r.slope), intercept: num(r.intercept),
          pPearson: corrPValue(pearson, n), pSpearman: corrPValue(spearman, n) }
      });
    }

    if (shape === "table") {
      const c = await this.runLogged<ChRow>("plot:extent", plotCountSql(xSel, ySel, ctx.cohortSql, false), conn);
      const n = Number(c.data[0]?.n || 0), kx = Number(c.data[0]?.kx || 0), ky = Number(c.data[0]?.ky || 0);
      if (!n) return done({ shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" });
      // a truncated contingency table is a wrong contingency table, so it is refused
      if (kx > CATEGORY_CAP || ky > CATEGORY_CAP)
        throw new Error("this pair has " + Math.max(kx, ky) + " distinct categories on one axis and " + CATEGORY_CAP +
          " is the most a contingency table stays readable (and testable) at; narrow the cohort or pick another attribute");
      const cells = await this.runLogged<ChRow>("plot:cells", plotTableSql(xSel, ySel, ctx.cohortSql), conn);
      return done({ shape, n, ...label, cells: cells.data.map((r) => ({ cx: String(r.cx), cy: String(r.cy), n: Number(r.n) })) });
    }

    // box: the numeric axis grouped by the categorical one, whichever way round they were given
    const numFirst = xk === "num";
    const colorSel = spec.colorBy ? axisSelect(spec.colorBy, ctx, "cat") : undefined;
    const [rows, vio] = await Promise.all([
      this.runLogged<ChRow>("plot:box", plotBoxSql(numFirst ? xSel : ySel, numFirst ? ySel : xSel, ctx.cohortSql), conn),
      this.runLogged<ChRow>("plot:violin",
        plotViolinSql(numFirst ? xSel : ySel, numFirst ? ySel : xSel, ctx.cohortSql, VIOLIN_BINS, colorSel), conn)
    ]);
    if (rows.data.length > CATEGORY_CAP)
      throw new Error("more than " + CATEGORY_CAP + " groups on the categorical axis; narrow the cohort or pick another attribute");
    const groups = rows.data.map((r) => {
      const q = (r.q as unknown as number[]).map(Number);
      const lo = Number(r.lo), hi = Number(r.hi);
      const t = tukey(q[0], q[2], lo, hi);
      return { g: String(r.g), n: Number(r.n), lo, hi, q1: q[0], median: q[1], q3: q[2],
        loWhisker: t.loWhisker, hiWhisker: t.hiWhisker };
    });
    const violin = vio.data.map((r) => ({ g: String(r.g), b: Number(r.b), n: Number(r.n),
      ...(spec.colorBy ? { c: String(r.c ?? "") } : {}) }));
    const vx0 = num(vio.data[0]?.vx0), vx1 = num(vio.data[0]?.vx1);
    return done({ shape, n: groups.reduce((a, g) => a + g.n, 0), ...label, groups,
      violin, violinBins: VIOLIN_BINS, overlay: "violin",
      ...(vx0 != null && vx1 != null ? { violinExtent: [vx0, vx1] as [number, number] } : {}),
      ...(spec.colorBy ? { colorLabel: axisLabel(spec.colorBy), legend: legendFor(violin.map((v) => v.c || "")) } : {}) });
  }

  // ---- a federated plot: one pass per site, pooled by lib/analysis.ts --------
  //
  // plot() above answers a single study end to end. A cohort spanning several studies cannot
  // just call plot() per site and stack the results — a scatter's bin grid is scaled to
  // whichever study computed it, a table's category set may differ, and a box's quartiles are
  // per-site statistics, not additive ones. The methods below expose the smaller pieces a
  // federated plot needs instead, mirroring the shape pairMoments() already uses for
  // co-expression: each site answers a cheap, self-contained question, and lib/analysis.ts pools
  // the answers using the same sufficient-statistic arguments this file already relies on
  // elsewhere (shared bin edges, moment sums).

  /**
   * Which shape a pair draws as, and its axis labels — decided from THIS site's own clinical
   * metadata, the same way plot() decides it for one study. A federated plot calls this on one
   * reference site (the first) and hands the SAME xk/yk to every other site's calls below, so a
   * site whose metadata classifies an attribute differently cannot quietly split the combined
   * figure into two incompatible shapes.
   */
  async plotAxisKinds(spec: { x: PlotAxis; y: PlotAxis }): Promise<{ xk: AxisKind; yk: AxisKind; shape: PlotShape; xLabel: string; yLabel: string }> {
    validateAxis(spec.x, "x"); validateAxis(spec.y, "y");
    const kinds = await this.clinicalKinds([spec.x, spec.y]);
    const xk = axisKind(spec.x, (a) => kinds.get(a)), yk = axisKind(spec.y, (a) => kinds.get(a));
    return { xk, yk, shape: plotShape(xk, yk), xLabel: axisLabel(spec.x), yLabel: axisLabel(spec.y) };
  }

  private plotCtx(def: CohortDef | null | undefined, spec: PlotRequest) {
    return { study: this.study, db: this.instance.conn.db,
      unit: spec.unit === "sample" ? "sample" as const : "patient" as const, cohortSql: this.cohortSql(def) };
  }

  /** This site's cases, and how many carry each axis — summed across sites by lib/analysis.ts. */
  async plotCoverage(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ total: number; nx: number; ny: number }> {
    const ctx = this.plotCtx(def, spec);
    const r = await this.runLogged<ChRow>("plot:coverage",
      plotCoverageSql(axisSelect(spec.x, ctx, xk), axisSelect(spec.y, ctx, yk), ctx), this.instance.conn);
    const row = r.data[0] || {};
    return { total: Number(row.total || 0), nx: Number(row.nx || 0), ny: Number(row.ny || 0) };
  }

  /** Pass 1 of a federated numeric pair: this site's count and extent (plotBinsSql's `extent` arg). */
  async plotExtent(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ n: number; x0: number; x1: number; y0: number; y1: number }> {
    const ctx = this.plotCtx(def, spec);
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const r = await this.runLogged<ChRow>("plot:extent", plotCountSql(xSel, ySel, ctx.cohortSql, true), this.instance.conn);
    const row = r.data[0] || {};
    return { n: Number(row.n || 0), x0: Number(row.x0), x1: Number(row.x1), y0: Number(row.y0), y1: Number(row.y1) };
  }

  /** Pass 2: this site's bin counts against the shared extent every participant was given. */
  async plotBinCounts(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind,
    bins: [number, number], extent: { x0: number; x1: number; y0: number; y1: number }): Promise<{ bx: number; by: number; n: number }[]> {
    const ctx = this.plotCtx(def, spec);
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const r = await this.runLogged<ChRow>("plot:bins", plotBinsSql(xSel, ySel, ctx.cohortSql, bins, extent), this.instance.conn);
    return r.data.map((b) => ({ bx: Number(b.bx), by: Number(b.by), n: Number(b.n) }));
  }

  /** This site's six sums for the pair — sufficient for a federated Pearson/regression (lib/stats.ts). */
  async plotMoments(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<Moments> {
    const ctx = this.plotCtx(def, spec);
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const r = await this.runLogged<ChRow>("plot:moments", plotMomentsSql(xSel, ySel, ctx.cohortSql), this.instance.conn);
    const row = r.data[0] || {};
    return { n: Number(row.n || 0), sx: Number(row.sx || 0), sy: Number(row.sy || 0),
      sxy: Number(row.sxy || 0), sxx: Number(row.sxx || 0), syy: Number(row.syy || 0) };
  }

  /** This site's contingency cells for a categorical pair — exact sums, no shared-scale issue at all. */
  async plotTableCells(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ cx: string; cy: string; n: number }[]> {
    const ctx = this.plotCtx(def, spec);
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const r = await this.runLogged<ChRow>("plot:cells", plotTableSql(xSel, ySel, ctx.cohortSql), this.instance.conn);
    return r.data.map((row) => ({ cx: String(row.cx), cy: String(row.cy), n: Number(row.n) }));
  }

  /**
   * This site's per-group quartile summary for a numeric x categorical pair. n/lo/hi sum and
   * pool exactly; q1/median/q3 do not decompose exactly across sites and are approximated by
   * lib/analysis.ts with the same size-weighted mean Explore's federated numeric histograms
   * already use for the same reason — stated as an approximation, never silent.
   */
  async plotBoxRows(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number }[]> {
    const ctx = this.plotCtx(def, spec);
    const numFirst = xk === "num";
    const xSel = axisSelect(spec.x, ctx, xk), ySel = axisSelect(spec.y, ctx, yk);
    const r = await this.runLogged<ChRow>("plot:box",
      plotBoxSql(numFirst ? xSel : ySel, numFirst ? ySel : xSel, ctx.cohortSql), this.instance.conn);
    return r.data.map((row) => {
      const q = (row.q as unknown as number[]).map(Number);
      return { g: String(row.g), n: Number(row.n), lo: Number(row.lo), hi: Number(row.hi), q1: q[0], median: q[1], q3: q[2] };
    });
  }

  /**
   * One of lib/federation-more.ts's aggregates, for a view in lib/views-more.ts: this resolver
   * supplies its own cohort SQL (which, on an aggregate-only instance, refuses an id-carrying
   * definition), study and database, and logs what ran. `build` is a function, never text, so a
   * document cannot reach it; every builder it is given is swept by test/boundary.test.ts.
   */
  async moreAggregate(label: string, def: CohortDef | null | undefined,
    build: (cohortSql: string, study: string, db: string) => string): Promise<ChRow[]> {
    const r = await this.runLogged<ChRow>(label, build(this.cohortSql(def), this.study, this.instance.conn.db), this.instance.conn);
    return r.data;
  }
  /** Study metadata for those views (no cohort involved), logged the same way. */
  async moreMeta(label: string, build: (study: string, db: string) => string): Promise<ChRow[]> {
    const r = await this.runLogged<ChRow>(label, build(this.study, this.instance.conn.db), this.instance.conn);
    return r.data;
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
  /**
   * The points behind a box plot, with their case ids, so a reader can find one on the figure.
   *
   * It lives here and nowhere else. `AggregateResolver` has no such method, and neither does a
   * remote peer, so a participant that may not disclose a case cannot be asked for one — the
   * same guarantee as `members()`, and for the same reason. The cap is what stops a quarter of
   * a million dots being called a drawing; above it the caller falls back to the density every
   * participant can compute.
   */
  async plotPoints(def: CohortDef | null | undefined, spec: PlotRequest, cap = POINTS_CAP): Promise<PlotPoint[]> {
    const db = this.instance.conn.db, conn = this.instance.conn;
    const unit = spec.unit === "sample" ? "sample" as const : "patient" as const;
    const ctx = { study: this.study, db, unit, cohortSql: this.cohortSql(def) };
    const kinds = await this.clinicalKinds([spec.x, spec.y]);
    const xk = axisKind(spec.x, (a) => kinds.get(a)), yk = axisKind(spec.y, (a) => kinds.get(a));
    if (plotShape(xk, yk) !== "box") return [];
    const numFirst = xk === "num";
    const numSel = axisSelect(numFirst ? spec.x : spec.y, ctx, "num");
    const catSel = axisSelect(numFirst ? spec.y : spec.x, ctx, "cat");
    const colorSel = spec.colorBy ? axisSelect(spec.colorBy, ctx, "cat") : undefined;
    const ringSel = spec.ringBy ? axisSelect(spec.ringBy, ctx, "cat") : undefined;
    const r = await this.runLogged<ChRow>("plot:points",
      plotPointsSql(numSel, catSel, ctx.cohortSql, cap, colorSel, ringSel), conn);
    // one over the cap means there were more than a drawing can hold: the caller draws density
    if (r.data.length > cap) return [];
    return r.data.map((x) => ({ id: String(x.id), g: String(x.g), v: Number(x.v),
      ...(colorSel ? { c: String(x.c ?? "") } : {}), ...(ringSel ? { r: String(x.r ?? "") } : {}) }));
  }

  async members(def: CohortDef | null | undefined): Promise<string[]> {
    const r = await chQuery<ChRow>("SELECT pid FROM (" + this.cohortSql(def) + ")", this.instance.conn);
    return r.data.map((x) => x.pid);
  }

  /**
   * Per-patient (time, event, covariate values) rows for a Cox fit — patient-level only, for
   * the same reason plotPoints() is: it lives nowhere on AggregateResolver, so a participant
   * that may not disclose a case structurally cannot be asked for these rows, even though no
   * single row carries an identifier. `kinds` says which covariates came back numeric so the
   * caller (which dummy-codes categoricals) doesn't have to re-derive it.
   */
  async coxRows(def: CohortDef | null | undefined, endpoint: string, covariates: PlotAxis[], columns?: EndpointColumns):
    Promise<{ rows: { t: number; event: number; values: (number | string)[] }[]; kinds: AxisKind[] }> {
    covariates.forEach((c, i) => validateAxis(c, "covariate " + (i + 1)));
    const db = this.instance.conn.db, conn = this.instance.conn;
    const kindsMap = await this.clinicalKinds(covariates);
    const kinds = covariates.map((c) => axisKind(c, (a) => kindsMap.get(a)));
    const ctx = { study: this.study, db, unit: "patient" as const, cohortSql: this.cohortSql(def) };
    const sels = covariates.map((c, i) => ({ label: "c" + i, sel: axisSelect(c, ctx, kinds[i]) }));
    const sql = coxRowsSql(ctx.cohortSql, this.study, db, endpoint, sels, columns);
    const r = await this.runLogged<ChRow>("coxRows:" + endpoint, sql, conn);
    const rows = r.data.map((row) => ({
      t: Number(row.m), event: Number(row.ev),
      values: covariates.map((_, i) => kinds[i] === "num" ? Number(row["c" + i]) : String(row["c" + i]))
    }));
    return { rows, kinds };
  }

  /**
   * One row per PATIENT for a view in lib/views-more.ts (a waterfall's bars): values, never an
   * identifier, but still one patient's own values, so — like plotPoints and coxRows — only a
   * patient-level participant has this method. An aggregate-only or remote resolver cannot be
   * asked, because the method does not exist on it.
   */
  async moreRows(label: string, def: CohortDef | null | undefined,
    build: (cohortSql: string, study: string, db: string) => string): Promise<ChRow[]> {
    const r = await this.runLogged<ChRow>(label, build(this.cohortSql(def), this.study, this.instance.conn.db), this.instance.conn);
    return r.data;
  }

  /**
   * Per-patient (outcome, covariate values) rows for a logistic fit — patient-level only, for
   * the same reason coxRows is. The outcome is validated and axis-selected exactly like a
   * covariate; the caller (runAnalysis's logistic branch) is the one that knows which observed
   * level, or which already-0/1 numeric value, counts as the event.
   */
  async logisticRows(def: CohortDef | null | undefined, outcome: PlotAxis, covariates: PlotAxis[]):
    Promise<{ rows: { y: number | string; values: (number | string)[] }[]; outcomeKind: AxisKind; kinds: AxisKind[] }> {
    validateAxis(outcome, "outcome");
    covariates.forEach((c, i) => validateAxis(c, "covariate " + (i + 1)));
    const db = this.instance.conn.db, conn = this.instance.conn;
    const kindsMap = await this.clinicalKinds([outcome, ...covariates]);
    const outcomeKind = axisKind(outcome, (a) => kindsMap.get(a));
    const kinds = covariates.map((c) => axisKind(c, (a) => kindsMap.get(a)));
    const ctx = { study: this.study, db, unit: "patient" as const, cohortSql: this.cohortSql(def) };
    const outcomeSel = { label: "y0", sel: axisSelect(outcome, ctx, outcomeKind) };
    const sels = covariates.map((c, i) => ({ label: "c" + i, sel: axisSelect(c, ctx, kinds[i]) }));
    const sql = logisticRowsSql(ctx.cohortSql, outcomeSel, sels);
    const r = await this.runLogged<ChRow>("logisticRows", sql, conn);
    const rows = r.data.map((row) => ({
      y: outcomeKind === "num" ? Number(row.y) : String(row.y),
      values: covariates.map((_, i) => kinds[i] === "num" ? Number(row["c" + i]) : String(row["c" + i]))
    }));
    return { rows, outcomeKind, kinds };
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
