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
// Rejected with an explanation (not silently approximated): GAIN/HETLOSS (only high-level
// CNA (+-2) is stored), EXP/PROT (no expression thresholds here), GERMLINE/SOMATIC
// (public studies are germline-stripped).
import { DB, STUDY } from "./ch.ts";
import { sq } from "./compiler.ts";

export type OqlSpecType = "MUT" | "CNA" | "SV" | "ANY" | "EXP" | "PROT";
/** The portal's RANGE modifier: protein positions, either bound open; `contained` is its `*`. */
export interface OqlRange { start?: number; end?: number; contained: boolean }
export interface OqlSpec {
  type: OqlSpecType; driver?: boolean;
  pchange?: string; cls?: string; cna?: number;
  op?: string; z?: number;
  range?: OqlRange;
}
export interface OqlEntry { gene: string; specs: OqlSpec[] }

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const CLASS_MAP: Record<string, string> = {
  MISSENSE: "missense", NONSENSE: "nonsense", NONSTART: "nonstart", NONSTOP: "nonstop", FRAMESHIFT: "frameshift",
  INFRAME: "inframe", SPLICE: "splice", PROMOTER: "promoter", TRUNC: "trunc"
};

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
const REJECT: Record<string, string> = {
  GAIN: "GAIN is not supported: only high-level CNA (amp/deep-deletion, ±2) is stored",
  HETLOSS: "HETLOSS is not supported: only high-level CNA (±2) is stored",

  GERMLINE: "GERMLINE is not supported: public studies are germline-stripped",
  SOMATIC: "SOMATIC modifier is not supported (all stored mutations are somatic/unknown)"
};

// -> [{gene, specs: [{type:'MUT'|'CNA'|'SV'|'ANY', pchange?, cls?, cna?, driver}]}]
export function parseOql(q: string): OqlEntry[] {
  if (typeof q !== "string" || !q.trim()) throw new Error("empty OQL");
  if (q.length > 1000) throw new Error("OQL too long");
  const entries = q.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  // Each entry compiles to its own UNION-DISTINCT'd subquery (see below), so cost scales
  // roughly linearly rather than sitting at a wall near any particular number — 30 covers a
  // full pathway gene set (e.g. a 20-30 gene DDR panel) with room to spare, not a measured
  // ceiling.
  if (!entries.length || entries.length > 30) throw new Error("OQL: 1-30 gene entries");
  return entries.map(entry => {
    const m = entry.match(/^([A-Za-z0-9.-]+)\s*(?::\s*(.*))?$/);
    if (!m || !GENE_RE.test(m[1])) throw new Error("OQL: bad gene entry '" + entry.slice(0, 40) + "'");
    const gene = m[1].toUpperCase();
    const specText = (m[2] || "").trim();
    if (!specText) return { gene, specs: [{ type: "ANY", driver: false }] };
    const specs = specText.split(/\s+/).map(tok => parseSpec(tok, entry));
    return { gene, specs };
  });
}

// A range sits among a token's "_"-joined modifiers, or right after "MUT=" (the portal's
// grammar: modifiers in any order around the mutation, joined by "_").
const RANGE_RE = /(^|_|=)\((\d*)-(\d*)(\*?)\)(_|$)/;

function parseSpec(tok0: string, entry: string): OqlSpec {
  const rm = tok0.match(RANGE_RE);
  if (!rm) return parseSpecNoRange(tok0, entry);
  const [whole, lead, a, b, star, trail] = rm;
  const rest = tok0.slice(0, rm.index) + (lead === "=" ? "=" : lead && trail ? "_" : "") + tok0.slice(rm.index! + whole.length);
  if (RANGE_RE.test(rest)) throw new Error("OQL '" + entry + "': at most one position range per alteration");
  if (a === "" && b === "") throw new Error("OQL '" + entry + "': a position range needs a start, an end, or both, e.g. (1400-) or (1-500)");
  const range: OqlRange = { contained: star === "*" };
  if (a !== "") range.start = Number(a);
  if (b !== "") range.end = Number(b);
  if (range.start != null && range.end != null && range.start > range.end)
    throw new Error("OQL '" + entry + "': position range (" + a + "-" + b + ") starts after it ends");
  // A range alone, or with only DRIVER, is any mutation in that range (the portal's reading).
  const restU = rest.toUpperCase();
  const base = rest === "" || restU === "MUT=" ? { type: "MUT" as const, driver: false }
    : restU === "DRIVER" || restU === "MUT=DRIVER" ? { type: "MUT" as const, driver: true }
    : parseSpecNoRange(rest, entry);
  if (base.type !== "MUT")
    throw new Error("OQL '" + entry + "': a position range applies only to mutations, not to " + rest);
  return { ...base, range };
}

function parseSpecNoRange(tok0: string, entry: string): OqlSpec {
  if (/[()]/.test(tok0)) throw new Error("OQL '" + entry + "': unrecognized token '" + tok0.slice(0, 20) + "' — a position range is written (a-b), (a-) or (-b), optionally with * for fully contained");
  let tok = tok0.toUpperCase();
  let driver = false;
  // DRIVER as prefix/suffix modifier (DRIVER_G12D, G12D_DRIVER, MUT=DRIVER_G12D, TRUNC_DRIVER…)
  if (tok.startsWith("DRIVER_")) { driver = true; tok = tok.slice(7); }
  if (tok.endsWith("_DRIVER")) { driver = true; tok = tok.slice(0, -7); }
  if (tok === "DRIVER") return { type: "ANY", driver: true };
  const em = tok.match(/^(EXP|PROT)([<>]=?)(-?\d+(?:\.\d+)?)$/);
  if (em) return { type: em[1] as OqlSpecType, op: em[2], z: Number(em[3]) };
  if (tok === "EXP" || tok === "PROT") throw new Error("OQL " + tok + " needs a threshold, e.g. " + tok + ">2");
  for (const k of Object.keys(REJECT)) {
    if (tok === k || tok.startsWith(k + "_") || tok.endsWith("_" + k)) throw new Error("OQL '" + entry + "': " + REJECT[k]);
  }
  if (tok === "MUT") return { type: "MUT", driver };
  if (tok.startsWith("MUT=")) {
    let rest = tok0.slice(4); // preserve original case of protein change
    let restU = rest.toUpperCase();
    if (restU.startsWith("DRIVER_")) { driver = true; rest = rest.slice(7); restU = restU.slice(7); }
    if (restU.endsWith("_DRIVER")) { driver = true; rest = rest.slice(0, -7); restU = restU.slice(0, -7); }
    if (CLASS_MAP[restU]) return { type: "MUT", cls: CLASS_MAP[restU], driver };
    if (!/^[A-Za-z0-9*_.-]{1,40}$/.test(rest)) throw new Error("OQL: bad protein change '" + rest.slice(0, 20) + "'");
    return { type: "MUT", pchange: rest, driver };
  }
  if (CLASS_MAP[tok]) return { type: "MUT", cls: CLASS_MAP[tok], driver };
  if (tok === "AMP") return { type: "CNA", cna: 2, driver };
  if (tok === "HOMDEL") return { type: "CNA", cna: -2, driver };
  if (tok === "CNA") return { type: "CNA", driver };
  if (tok === "FUSION") return { type: "SV", driver };
  // bare token = protein change shorthand (KRAS: G12D)
  if (/^[A-Za-z0-9*_.-]{1,40}$/.test(tok0.replace(/^DRIVER_|_DRIVER$/gi, "")))
    return { type: "MUT", pchange: tok0.replace(/^DRIVER_|_DRIVER$/gi, ""), driver };
  throw new Error("OQL: unrecognized token '" + tok0.slice(0, 20) + "' in '" + entry + "'");
}

function specCond(spec: OqlSpec): string {
  const conds: string[] = [];
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
 * the same mutation rows (same profiles, uncalled included, same protein change and type).
 */
const mutationsWithPositions = (db: string, study: string, gene: string): string =>
  "(SELECT concat(studyId, '_', sampleId) AS sample_unique_id, concat(studyId, '_', patientId) AS patient_unique_id,\n" +
  "          studyId AS cancer_study_identifier, `GENE.hugoGeneSymbol` AS hugo_gene_symbol, 'mutation' AS variant_type,\n" +
  "          proteinChange AS mutation_variant, mutationType AS mutation_type, proteinPosStart AS pos_start, proteinPosEnd AS pos_end,\n" +
  "          CAST(NULL AS Nullable(Int8)) AS cna_alteration\n" +
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
          "    AND ga.profile_type = " + sq(prof) + " AND toFloat64OrNull(ga.alteration_value) " + spec.op + " " + spec.z);
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
