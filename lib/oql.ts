// OQL (Onco Query Language) support for the cohort DSL: {kind:"oql", q:"STK11: DRIVER"}.
// Parses the cBioPortal OQL subset our data can honestly answer and compiles it to SQL
// over genomic_event_derived (+ the pinned OncoKB store for DRIVER semantics).
//
// Supported per gene: MUT | MUT=<pchange> | MISSENSE NONSENSE NONSTART NONSTOP FRAMESHIFT INFRAME
//   SPLICE PROMOTER TRUNC (the portal's classes, mutClassSql) |
//   AMP HOMDEL | FUSION | DRIVER (standalone = any driver alteration) | _DRIVER /
//   DRIVER_ modifiers on any of the above | bare gene = any alteration |
//   protein position range modifier on a mutation: (a-b) (a-) (-b), with * for fully contained,
//   e.g. TRUNC_(1400-), MUT_(-500), (1-100*)_DRIVER, MUT=(712-979)_DRIVER.
//   EXP/PROT with a threshold, e.g. EXP>2, PROT<=-1.5, on the study's mRNA / protein profile (its
//   z-score profile where it has one).
// Rejected with an explanation (not silently approximated): GAIN/HETLOSS (only high-level
// CNA (+-2) is stored), EXP/PROT without a threshold, GERMLINE/SOMATIC (public studies are
// germline-stripped).
import { DB, STUDY } from "./ch.ts";
import { sq } from "./compiler.ts";

export { parseOql } from "./oql-parse.ts";
export type { OqlSpecType, OqlRange, OqlSpec, OqlEntry } from "./oql-parse.ts";
import type { OqlRange, OqlSpec } from "./oql-parse.ts";
import { parseOql } from "./oql-parse.ts";
import { finiteSql } from "./sql-number.ts";

/**
 * A mutation's class as cBioPortal's OQL sees it — cbioportal-frontend's getMutationSubType and
 * getSimplifiedMutationType (src/shared/lib/oql/AccessorsForOqlFilter.ts), case for case: a
 * protein change of "Promoter" is a promoter mutation whatever its type, a listed type maps to
 * its class, and anything unlisted (5'Flank, Silent, Targeted_Region, ...) is "other". The
 * portal's Fusion has no class; "none" stands for it.
 */
const PORTAL_TYPE_CLASS: [string, string[]][] = [
  ["missense", ["missense_mutation", "missense", "missense_variant"]],
  ["frameshift", ["frame_shift_ins", "frame_shift_del", "frameshift", "frameshift_deletion", "frameshift_insertion",
    "de_novo_start_outofframe", "frameshift_variant"]],
  ["nonsense", ["nonsense_mutation", "nonsense", "stopgain_snv"]],
  ["splice", ["splice_site", "splice", "splice site", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel",
    "splice_region"]],
  ["nonstart", ["translation_start_site", "start_codon_snp", "start_codon_del"]],
  ["nonstop", ["nonstop_mutation"]],
  ["inframe", ["in_frame_del", "in_frame_ins", "in_frame_deletion", "in_frame_insertion", "indel", "nonframeshift_deletion",
    "nonframeshift", "nonframeshift insertion", "nonframeshift_insertion"]],
];
const mutClassSql = (type: string, change: string): string =>
  "multiIf(lower(" + type + ") = 'fusion', 'none', lower(" + change + ") = 'promoter', 'promoter', " +
  PORTAL_TYPE_CLASS.map(([cls, types]) => "lower(" + type + ") IN (" + types.map(sq).join(", ") + "), " + sq(cls)).join(", ") +
  ", 'other')";
/** not an uncalled mutation (see specCond); true of every copy-number and structural-variant row */
const CALLED = "g.mutation_status != 'UNCALLED'";

function specCond(spec: OqlSpec): string {
  // An uncalled mutation is a called variant's read support looked up in the patient's other
  // samples, below the caller's thresholds there; the portal shows it greyed out and never counts
  // it as an alteration, and neither does any query here. Other rows carry SOMATIC, NA, … .
  const conds: string[] = [CALLED];
  if (spec.type === "MUT") {
    conds.push("g.variant_type = 'mutation'");
    // The portal's TRUNC is every class but missense and in-frame (oqlfilter.ts), not a list of types.
    if (spec.cls === "trunc") conds.push(mutClassSql("g.mutation_type", "g.mutation_variant") + " NOT IN ('missense', 'inframe')");
    else if (spec.cls) conds.push(mutClassSql("g.mutation_type", "g.mutation_variant") + " = " + sq(spec.cls));
    if (spec.pchange) conds.push("g.mutation_variant = " + sq(spec.pchange));
    if (spec.range) conds.push(rangeCond(spec.range));
  } else if (spec.type === "CNA") {
    conds.push("g.variant_type = 'cna'");
    conds.push(spec.cna === 2 ? "g.cna_alteration >= 2" : spec.cna === -2 ? "g.cna_alteration <= -2" : "abs(g.cna_alteration) >= 2");
  } else if (spec.type === "SV") {
    conds.push("g.variant_type = 'structural_variant'");
  } else { // ANY
    conds.push("(g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)");
  }
  return conds.join(" AND ");
}

/**
 * The portal's RANGE test (oqlfilter.ts, AccessorsForOqlFilter.mut_position): a mutation has a
 * position only when start and end are both known, neither is -1 and start <= end — otherwise
 * it never matches a range. Default: the two ranges overlap at all; with `*`: the query range
 * contains the mutation's.
 */
function rangeCond(r: OqlRange): string {
  const conds = ["g.pos_start IS NOT NULL", "g.pos_end IS NOT NULL", "g.pos_start != -1", "g.pos_end != -1", "g.pos_start <= g.pos_end"];
  if (r.contained) {
    if (r.start != null) conds.push("g.pos_start >= " + r.start);
    if (r.end != null) conds.push("g.pos_end <= " + r.end);
  } else {
    if (r.start != null) conds.push("g.pos_end >= " + r.start);
    if (r.end != null) conds.push("g.pos_start <= " + r.end);
  }
  return "(" + conds.join(" AND ") + ")";
}

/**
 * Mutations with their protein positions, under genomic_event_derived's column names so specCond
 * and DRIVER_JOIN read them unchanged. genomic_event_derived stores no positions; this table holds
 * the same mutation rows (same profiles, same protein change and type, the same mutation status).
 */
const mutationsWithPositions = (db: string, study: string, gene: string): string =>
  "(SELECT concat(studyId, '_', sampleId) AS sample_unique_id, concat(studyId, '_', patientId) AS patient_unique_id,\n" +
  "          studyId AS cancer_study_identifier, `GENE.hugoGeneSymbol` AS hugo_gene_symbol, 'mutation' AS variant_type,\n" +
  "          proteinChange AS mutation_variant, mutationType AS mutation_type, proteinPosStart AS pos_start, proteinPosEnd AS pos_end,\n" +
  "          CAST(NULL AS Nullable(Int8)) AS cna_alteration, ifNull(mutationStatus, '') AS mutation_status\n" +
  "     FROM " + db + ".mutation_derived WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + ") g\n";

const DRIVER_JOIN = (pin: string): string =>
  "  JOIN oncokb_annotation.variant_annotation ann\n" +
  "    ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
  "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
  "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
  "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
  "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n";

// full OQL leaf -> SQL of matching patient stable ids (portal semantics: altered by ANY entry)
export function oqlLeafSql(q: string, opts: { oncokbPin?: string | null; profiles?: string[]; study?: string; db?: string } = {}): string {
  return oqlCasesSql(q, { ...opts, unit: "patient" });
}

/**
 * The cases an OQL query matches, as `pid`: patients (any of their samples matches) or samples
 * (that sample matches), each stripped of the study prefix. The cohort leaf asks for patients; a
 * plot axis asks in the plot's own unit.
 */
export function oqlCasesSql(q: string, { oncokbPin, profiles, study = STUDY, db = DB, unit }:
  { oncokbPin?: string | null; profiles?: string[]; study?: string; db?: string; unit: "patient" | "sample" }): string {
  const caseCol = unit === "sample" ? "sample_unique_id" : "patient_unique_id";
  const parsed = parseOql(q);
  const parts: string[] = [];
  for (const { gene, specs } of parsed) {
    for (const spec of specs) {
      if (spec.driver && !oncokbPin) throw new Error("OQL DRIVER requires the OncoKB annotation store");
      if (spec.type === "EXP" || spec.type === "PROT") {
        const want = spec.type === "EXP" ? /mrna|rna_seq/i : /protein|rppa/i;
        const prof = (profiles || []).find(p => want.test(p) && /zscore/i.test(p)) || (profiles || []).find(p => want.test(p));
        if (!prof) throw new Error("OQL " + spec.type + " requires an " + (spec.type === "EXP" ? "mRNA" : "protein") +
          " profile; this study has: " + ((profiles || []).join(", ") || "none"));
        parts.push(
          "SELECT DISTINCT replaceOne(sd." + caseCol + ", " + sq(study + "_") + ", '') AS pid\n" +
          "  FROM " + db + ".genetic_alteration_derived ga\n" +
          "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
          "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.hugo_gene_symbol = " + sq(gene) + "\n" +
          "    AND ga.profile_type = " + sq(prof) + " AND " + finiteSql("ga.alteration_value") + " " + spec.op + " " + spec.z);
        continue;
      }
      parts.push(
        "SELECT DISTINCT replaceOne(g." + caseCol + ", " + sq(study + "_") + ", '') AS pid\n" +
        "  FROM " + (spec.range ? mutationsWithPositions(db, study, gene) : db + ".genomic_event_derived g\n") +
        (spec.driver ? DRIVER_JOIN(oncokbPin!) : "") +
        "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
        "    AND g.hugo_gene_symbol = " + sq(gene) + "\n" +
        "    AND " + specCond(spec)
      );
    }
  }
  return parts.map(p => "(" + p + ")").join("\nUNION DISTINCT\n");
}
