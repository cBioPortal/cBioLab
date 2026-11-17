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
//   z-score profile where it has one), or on the profile `pins` names (the query page's choice).
// Rejected with an explanation (not silently approximated): GAIN/HETLOSS (only high-level
// CNA (+-2) is stored), EXP/PROT without a threshold, GERMLINE/SOMATIC (public studies are
// germline-stripped).
import { DB, STUDY } from "./ch.ts";
import { mutationStudySql, sq, genomicStudySql } from "./compiler.ts";

export { parseOql } from "./oql-parse.ts";
export type { OqlSpecType, OqlRange, OqlSpec, OqlEntry } from "./oql-parse.ts";
import type { OqlRange, OqlSpec } from "./oql-parse.ts";
import { parseOql } from "./oql-parse.ts";
import { finiteSql } from "./sql-number.ts";
import { ONCOKB_TABLE } from "./annotation-store.ts";
import { PORTAL_TYPE_CLASS, oqlHasMutationOql } from "./oql-match.ts";
export { oqlHasMutationOql };
import { driverCondSql } from "./driver-sql.ts";
import { svDriverKeysSql } from "./sv-oncokb.ts";
import { hotspotKeysSql } from "./hotspots.ts";
import { resolveDrivers, type DriverSettings } from "./driver-settings.ts";
import type { VariantPins } from "./variant-annotation.ts";

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
    // a mutation typed Fusion has no class in the portal, so no mutation command addresses it
    conds.push("lower(g.mutation_type) != 'fusion'");
    // The portal's TRUNC is every class but missense and in-frame (oqlfilter.ts), not a list of types.
    if (spec.cls === "trunc") conds.push(mutClassSql("g.mutation_type", "g.mutation_variant") + " NOT IN ('missense', 'inframe')");
    else if (spec.cls) conds.push(mutClassSql("g.mutation_type", "g.mutation_variant") + " = " + sq(spec.cls));
    if (spec.pchange) conds.push("lower(g.mutation_variant) = " + sq(spec.pchange.toLowerCase()));
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
 * and driverEventSql read them unchanged. genomic_event_derived stores no positions; this table holds
 * the same mutation rows (same profiles, same protein change and type, the same mutation status).
 */
const mutationsWithPositions = (db: string, study: string, gene: string): string =>
  "(SELECT concat(studyId, '_', sampleId) AS sample_unique_id, concat(studyId, '_', patientId) AS patient_unique_id,\n" +
  "          studyId AS cancer_study_identifier, `GENE.hugoGeneSymbol` AS hugo_gene_symbol, 'mutation' AS variant_type,\n" +
  "          ifNull(driverFilter, '') AS driver_filter, ifNull(driverTiersFilter, '') AS driver_tiers_filter,\n" +
  "          proteinChange AS mutation_variant, mutationType AS mutation_type, proteinPosStart AS pos_start, proteinPosEnd AS pos_end,\n" +
  "          CAST(NULL AS Nullable(Int8)) AS cna_alteration, ifNull(mutationStatus, '') AS mutation_status, '' AS sv_event_info\n" +
  "     FROM " + db + ".mutation_derived WHERE " + mutationStudySql(study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + ") g\n";

/**
 * An event row `g` matched to the OncoKB store's row `ann` for it: equal on gene, alteration type
 * and alteration, each derived from the event. Kept a plain equality join on purpose: ClickHouse
 * runs the same match written as an OR of per-type conditions ~65x slower (5.8s against 0.09s over
 * msk_met_2021's mutations).
 */
export const annotationMatchSql = (ann: string, g: string): string =>
  ann + ".hugo_gene_symbol = " + g + ".hugo_gene_symbol\n" +
  "   AND " + ann + ".alteration_type = " + storeAlterationType(g + ".") + "\n" +
  "   AND " + ann + ".alteration = " + storeAlteration(g + ".") + "\n";

/** an event's alteration type and alteration as the OncoKB store keys them; `g` prefixes the event's columns */
const storeAlterationType = (g: string): string =>
  "multiIf(" + g + "variant_type = 'mutation', 'MUTATION', " + g + "variant_type = 'cna', 'CNA', " + g + "variant_type = 'structural_variant', 'SV', '')";
const storeAlteration = (g: string): string =>
  "multiIf(" + g + "variant_type = 'mutation', " + g + "mutation_variant, " + g + "variant_type = 'cna', " +
  "if(" + g + "cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')";

/**
 * "This genomic_event_derived row is an OncoKB driver at the pin", as a condition on the row's own
 * columns (`g` names its table, or "" for unqualified columns), as a set lookup, so it narrows a
 * query that aggregates the rows without joining them, and never repeats a row the store happens to
 * list twice. A mutation or copy-number row matches the store's row for its gene and alteration; a
 * structural variant row matches its variant's pair call (lib/sv-oncokb.ts svDriverKeysSql), read
 * from `db`'s structural variants, of `studies` when given.
 */
export const driverEventSql = (pin: string, g = "", { db = DB, studies }: { db?: string; studies?: string[] } = {}): string => {
  const c = g ? g + "." : "";
  return "((" + c + "variant_type != 'structural_variant' AND (" + c + "hugo_gene_symbol, " + storeAlterationType(c) + ", " + storeAlteration(c) + ") IN (\n" +
    "    SELECT hugo_gene_symbol, alteration_type, alteration FROM " + ONCOKB_TABLE + "\n" +
    "    WHERE oncokb_version = " + sq(pin) + " AND is_driver))\n" +
    "  OR (" + c + "variant_type = 'structural_variant' AND (" + c + "sample_unique_id, " + c + "hugo_gene_symbol, ifNull(" + c + "sv_event_info, '')) IN (\n" +
    svDriverKeysSql(db, pin, studies) + ")))";
};

/**
 * The store's driver rows at the pin, joined to each event `g` (`kind`: INNER or LEFT) on gene and
 * alteration: a structural variant by its genes' gene-level Fusion rows, not by its pair's call.
 */
export const driverAnnotationJoin = (pin: string, kind: "INNER" | "LEFT"): string =>
  "  " + kind + " JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, is_driver FROM " + ONCOKB_TABLE + "\n" +
  "      WHERE oncokb_version = " + sq(pin) + " AND is_driver) ann\n" +
  "    ON " + annotationMatchSql("ann", "g");

/**
 * The Mutations tab's filter for one gene: a condition over mutation_derived's own columns
 * keeping the mutations some line of the gene wants, as the portal filters the tab's data by the
 * whole query (ResultsViewPageStore 3644-3680) — or null when nothing is filtered: the query
 * narrows no mutation, or a line of the gene wants every one (a bare gene, a plain MUT). A gene
 * whose lines want no mutation (only AMP, FUSION, EXP …) keeps none.
 */
export function oqlMutationFilterSql(lines: string[], gene: string, { study, db, oncokbPin, drivers, hotspotPins }:
  { study: string; db: string; oncokbPin?: string | null } & OqlDriverOpts): string | null {
  if (!oqlHasMutationOql(lines)) return null;
  const specs = lines.flatMap((l) => parseOql(l)).filter((e) => e.gene === gene).flatMap((e) => e.specs);
  if (specs.some((x) => (x.type === "ANY" && !x.driver) || (x.type === "MUT" && !x.cls && !x.pchange && !x.range && !x.driver))) return null;
  const wanting = specs.filter((x) => x.type === "MUT" || (x.type === "ANY" && x.driver));
  if (!wanting.length) return "0";
  const rule = drivers === undefined ? undefined : resolveDrivers(drivers);
  const driver = (): string => {
    if (rule) {
      if (rule.hotspots && !hotspotPins) throw new Error("OQL DRIVER with Cancer Hotspots on needs the Genome Nexus pins the hotspots are read at; none were given");
      return driverCondSql(rule, oncokbPin, "g", rule.hotspots ? hotspotKeysSql(db, [study], [gene], hotspotPins!) : null, { db, studies: [study] });
    }
    if (!oncokbPin) throw new Error("OQL DRIVER requires the OncoKB annotation store");
    return driverEventSql(oncokbPin, "g", { db, studies: [study] });
  };
  const conds = wanting.map((x) => "(" + specCond(x.type === "ANY" ? { type: "MUT" } : x) + (x.driver ? " AND " + driver() : "") + ")");
  return "(concat(studyId, '_', sampleId), ifNull(proteinChange, ''), ifNull(mutationType, ''), ifNull(proteinPosStart, -99), ifNull(proteinPosEnd, -99)) IN (\n" +
    "  SELECT g.sample_unique_id, ifNull(g.mutation_variant, ''), ifNull(g.mutation_type, ''), ifNull(g.pos_start, -99), ifNull(g.pos_end, -99)\n" +
    "  FROM " + mutationsWithPositions(db, study, gene) +
    "  WHERE " + conds.join("\n     OR ") + ")";
}

/**
 * The condition on a gene's fusion rows the query's OQL keeps on the Mutations tab, or null when nothing
 * is filtered: the same gate as oqlMutationFilterSql (ResultsViewPageStore 3686-3712). A fusion is the
 * datum of both its partners (AccessorsForOqlFilter gene), so a line of either partner's gene keeps it:
 * a bare line or FUSION keeps every fusion, FUSION_DRIVER or a standalone DRIVER a driver one; MUT,
 * copy-number and EXP / PROT commands never address a fusion (oqlfilter.ts 498-693). `site1`, `site2`:
 * the partners' symbols; `driver`: whether the fusion is a driver — all SQL expressions.
 */
export function oqlFusionFilterSql(lines: string[], site1: string, site2: string, driver: string): string | null {
  if (!oqlHasMutationOql(lines)) return null;
  const every = new Set<string>(), drivers = new Set<string>();
  for (const e of lines.flatMap((l) => parseOql(l)))
    for (const x of e.specs) if (x.type === "SV" || x.type === "ANY") (x.driver ? drivers : every).add(e.gene);
  const either = (genes: Set<string>): string => {
    const list = [...genes].map(sq).join(", ");
    return "(" + site1 + " IN (" + list + ") OR " + site2 + " IN (" + list + "))";
  };
  const conds = [...(every.size ? [either(every)] : []), ...(drivers.size ? ["(" + driver + " AND " + either(drivers) + ")"] : [])];
  return conds.length ? "(" + conds.join(" OR ") + ")" : "0";
}

/** the profile EXP and PROT read, by id without the study prefix, where the query names one */
/**
 * The profiles EXP and PROT read (ids without the study prefix). `ifHeld`: a study without the
 * named profile has no EXP / PROT alterations, instead of being refused (the portal's query across
 * studies, whose expression choice applies to each study holding that profile).
 */
export interface OqlPins { EXP?: string; PROT?: string; ifHeld?: boolean }

// full OQL leaf -> SQL of matching patient stable ids (portal semantics: altered by ANY entry)
export function oqlLeafSql(q: string, opts: { oncokbPin?: string | null; profiles?: string[]; study?: string; db?: string } = {}): string {
  return oqlCasesSql(q, { ...opts, unit: "patient" });
}

/**
 * The cases an OQL query matches, as `pid`: patients (any of their samples matches) or samples
 * (that sample matches), each stripped of the study prefix. The cohort leaf asks for patients; a
 * plot axis asks in the plot's own unit.
 */
export function oqlCasesSql(q: string, { oncokbPin, profiles, pins, study = STUDY, db = DB, unit, drivers, hotspotPins }:
  { oncokbPin?: string | null; profiles?: string[]; pins?: OqlPins; study?: string; db?: string; unit: "patient" | "sample" } & OqlDriverOpts): string {
  return oqlSelectSql(q, { oncokbPin, profiles, pins, study, db, caseCol: unit === "sample" ? "sample_unique_id" : "patient_unique_id", events: false, drivers, hotspotPins });
}

/** an event row's label as the portal's download tab spells it: protein change, AMP / HOMDEL, the structural variant's event */
const EVENT_LABEL = "multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info)";
/** its kind's place in a sample's list: mutations, then copy number, then structural variants, then expression */
const EVENT_ORDER = "multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3)";

/**
 * The events an OQL query matches, sample by sample: each matching event as (`sid`, the sample's
 * bare id; `o`, its kind's order — mutation 1, copy number 2, structural variant 3, expression or
 * protein 4; `ev`, its label — the protein change, AMP or HOMDEL, the structural variant's event
 * info, or EXP / PROT HIGH or LOW). The same conditions as oqlCasesSql, row by row: a sample is in
 * oqlCasesSql's samples exactly when it has a row here. The rows name samples: patient-level SQL.
 */
export function oqlEventsSql(q: string, { oncokbPin, profiles, pins, study = STUDY, db = DB, drivers, hotspotPins }:
  { oncokbPin?: string | null; profiles?: string[]; pins?: OqlPins; study?: string; db?: string } & OqlDriverOpts): string {
  return oqlSelectSql(q, { oncokbPin, profiles, pins, study, db, caseCol: "sample_unique_id", events: true, drivers, hotspotPins });
}

/**
 * The profile an EXP or PROT alteration reads: the one `pins` names, which must be one of the
 * study's profiles of that kind, or else the study's z-score profile of that kind (its first
 * profile of that kind when it has no z-scores).
 */
export function expressionProfileFor(type: "EXP" | "PROT", profiles: string[] | undefined, pins?: OqlPins): string {
  const want = type === "EXP" ? /mrna|rna_seq/i : /protein|rppa/i;
  const noun = type === "EXP" ? "mRNA" : "protein";
  const pinned = pins?.[type];
  if (pinned != null) {
    // a profile the study lacks matches no row: nothing of this study is altered by it
    if (pins?.ifHeld && typeof pinned === "string" && want.test(pinned) && !(profiles || []).includes(pinned)) return pinned;
    if (typeof pinned !== "string" || !(profiles || []).includes(pinned) || !want.test(pinned))
      throw new Error("OQL " + type + " is set to read the " + noun + " profile '" + String(pinned).slice(0, 80) + "', which this study does not have; its " + noun +
        " profiles: " + ((profiles || []).filter((p) => want.test(p)).join(", ") || "none"));
    return pinned;
  }
  const prof = (profiles || []).find(p => want.test(p) && /zscore/i.test(p)) || (profiles || []).find(p => want.test(p));
  if (!prof) throw new Error("OQL " + type + " requires an " + noun + " profile; this study has: " + ((profiles || []).join(", ") || "none"));
  return prof;
}

/**
 * How DRIVER reads: `drivers`, the page's driver settings (the portal's putativeDriver: OncoKB at
 * the pin, Cancer Hotspots at the Genome Nexus pins, the study's own calls); without them, OncoKB
 * at the pin alone.
 */
export interface OqlDriverOpts { drivers?: DriverSettings; hotspotPins?: VariantPins }

function oqlSelectSql(q: string, { oncokbPin, profiles, pins, study, db, caseCol, events, drivers, hotspotPins }:
  { oncokbPin?: string | null; profiles?: string[]; pins?: OqlPins; study: string; db: string; caseCol: string; events: boolean } & OqlDriverOpts): string {
  const parsed = parseOql(q);
  const settings = drivers === undefined ? undefined : resolveDrivers(drivers);
  // the driver rule of the settings, as a condition on the event `g` of `gene`
  const driverCond = (gene: string): string => {
    if (settings!.oncokb && !oncokbPin) throw new Error("OQL DRIVER with OncoKB on requires the OncoKB annotation store");
    if (settings!.hotspots && !hotspotPins) throw new Error("OQL DRIVER with Cancer Hotspots on needs the Genome Nexus pins the hotspots are read at; none were given");
    return driverCondSql(settings!, oncokbPin, "g", settings!.hotspots ? hotspotKeysSql(db, [study], [gene], hotspotPins!) : null, { db, studies: [study] });
  };
  const parts: string[] = [];
  // what each part selects: the case alone, distinct; or, for events, the case with the event's order and label
  const head = (t: "g" | "sd", order: string, label: string) => events
    ? "SELECT replaceOne(" + t + "." + caseCol + ", " + sq(study + "_") + ", '') AS sid, " + order + " AS o, " + label + " AS ev\n"
    : "SELECT DISTINCT replaceOne(" + t + "." + caseCol + ", " + sq(study + "_") + ", '') AS pid\n";
  // the plain event conditions of every gene, read in one pass over genomic_event_derived: one
  // subquery per gene had ClickHouse plan the view again for each
  const plain: { gene: string; cond: string }[] = [];
  for (const { gene, specs } of parsed) {
    for (const spec of specs) {
      if (spec.driver && !settings && !oncokbPin) throw new Error("OQL DRIVER requires the OncoKB annotation store");
      if (spec.type === "EXP" || spec.type === "PROT") {
        const prof = expressionProfileFor(spec.type, profiles, pins);
        parts.push(
          head("sd", "4", sq(spec.type + (String(spec.op).startsWith(">") ? " HIGH" : " LOW"))) +
          "  FROM " + db + ".genetic_alteration_derived ga\n" +
          "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
          "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.hugo_gene_symbol = " + sq(gene) + "\n" +
          "    AND ga.profile_type = " + sq(prof) + " AND " + finiteSql("ga.alteration_value") + " " + spec.op + " " + spec.z);
        continue;
      }
      if (!spec.range && !spec.driver) { plain.push({ gene, cond: specCond(spec) }); continue; }
      parts.push(
        head("g", spec.range ? "1" : EVENT_ORDER, spec.range ? "g.mutation_variant" : EVENT_LABEL) +
        "  FROM " + (spec.range ? mutationsWithPositions(db, study, gene) : db + ".genomic_event_derived g\n") +
        "  WHERE " + (spec.range ? "g.cancer_study_identifier = " + sq(study) : genomicStudySql(study, "g")) + "\n" +
        "    AND g.hugo_gene_symbol = " + sq(gene) + "\n" +
        "    AND " + specCond(spec) +
        (spec.driver ? "\n    AND " + (settings ? driverCond(gene) : driverEventSql(oncokbPin!, "g", { db, studies: [study] })) : "")
      );
    }
  }
  if (plain.length)
    parts.unshift(
      head("g", EVENT_ORDER, EVENT_LABEL) +
      "  FROM " + db + ".genomic_event_derived g\n" +
      "  WHERE " + genomicStudySql(study, "g") + "\n" +
      "    AND g.hugo_gene_symbol IN (" + [...new Set(plain.map((x) => x.gene))].map(sq).join(", ") + ")\n" +
      "    AND (" + plain.map((x) => "(g.hugo_gene_symbol = " + sq(x.gene) + " AND " + x.cond + ")").join("\n      OR ") + ")");
  return parts.map(p => "(" + p + ")").join("\nUNION DISTINCT\n");
}
