// DSL v2: unified cohort algebra.
//
// A cohort definition is bounded boolean composition over typed leaf predicates:
//   { all: [ clause, ... ], lineGap?: 90 }
//   clause := leaf | { any: [leaf, ...] } | { not: leaf }
//   leaf   := { kind: "oql", q: "KRAS: MUT=G12C; STK11: DRIVER" } // genomic status (OQL)
//          | { kind: "clinical", attribute, op, value }           // patient attribute
//          | { kind: "event", a, b?, rel, priorGuard? }           // timeline sub-DSL (v1 shape)
//          | { kind: "sampleList", ids: ["<study>:<id>", ...] }    // explicit, cross-study sample list
//          | { kind: "patientList", ids: ["<study>:<id>", ...] }   // explicit, cross-study patient list
//
// Depth is capped by construction (all -> any/not -> leaf): everything compiles to
// per-leaf CTEs over patient stable ids combined with INTERSECT / UNION / EXCEPT,
// and everything stays renderable as a sentence. Back-compat: the v1 flat event
// shape {a, b?, rel, ...} is accepted anywhere a definition is expected.
import { DB, STUDY } from "./ch.ts";
import { compileCohort, sq, LINE_TYPE } from "./compiler.ts";
import { oqlLeafSql } from "./oql.ts";
import { clinicalValueFoldSql, canonicalEventName } from "./event-names.ts";
import type {
  CohortDef, Clause, Leaf, CompileCtx, ClinicalLeaf, ClinicalRange,
  ProfiledLeaf, CaseListLeaf, GenomicDataLeaf, GenericAssayLeaf,
  SampleListLeaf, PatientListLeaf, AlterationLeaf, EventLeafFields
} from "./types.ts";

/** Every leaf compiler receives a fully-resolved context. */
type Ctx = CompileCtx & { study: string };
const dbOf = (ctx: Ctx): string => ctx.db || DB;

const PID = (col: string, study: string): string => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
const CLIN_OP: Record<string, string> = { "=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

export function basePatientsSql(study: string = STUDY, db: string = DB): string {
  return "SELECT DISTINCT " + PID("patient_unique_id", study) + " AS pid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study);
}

// DEPRECATED back-compat: {kind:"alteration", gene, driver, types} — grandfathered so
// saved cohorts and old links keep working, but no longer part of the public DSL.
// It translates to OQL and compiles through the same engine, so equivalence with the
// OQL form holds by construction (one semantics owner).
function alterationToOql(leaf: AlterationLeaf): string {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("invalid gene symbol in alteration clause");
  const types = (leaf.types && leaf.types.length ? leaf.types : ["MUT", "CNA", "SV"])
    .filter(t => ["MUT", "CNA", "SV"].includes(t));
  const driver = leaf.driver === "driverOnly";
  if (types.length === 3) return gene + ":" + (driver ? " DRIVER" : "");
  const specs: string[] = [];
  if (types.includes("MUT")) specs.push(driver ? "MUT_DRIVER" : "MUT");
  if (types.includes("CNA")) specs.push(driver ? "AMP_DRIVER HOMDEL_DRIVER" : "AMP HOMDEL");
  if (types.includes("SV")) specs.push(driver ? "FUSION_DRIVER" : "FUSION");
  return gene + ": " + specs.join(" ");
}

function clinicalLeafSql(leaf: ClinicalLeaf, ctx: Ctx): string {
  const attr = String(leaf.attribute || "");
  if (!attr || attr.length > 200) throw new Error("invalid clinical attribute");
  const per = leaf.per === "sample" ? "sample" : "patient"; // sample-level collapses: patient matches if ANY sample matches
  const conds: string[] = [];
  if (Array.isArray(leaf.values) && leaf.values.length) {
    // folded on both sides, exactly as the `=` case is — a multi-value pick is
    // several facet clicks, and must select what those facets counted
    conds.push(clinicalValueFoldSql("attribute_value") + " IN (" +
      leaf.values.slice(0, 50).map(v => clinicalValueFoldSql(sq(String(v)))).join(",") + ")");
  }
  if (leaf.range && typeof leaf.range === "object") {
    const r = leaf.range as Record<string, number | undefined>, num = "toFloat64OrNull(attribute_value)";
    for (const [k, opSym] of [["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]]) {
      if (r[k] != null) {
        if (!Number.isFinite(Number(r[k]))) throw new Error("clinical range." + k + " must be a number");
        conds.push(num + " " + opSym + " " + Number(r[k]));
      }
    }
  }
  if (leaf.op != null) {
    const op = CLIN_OP[leaf.op];
    if (!op) throw new Error("invalid clinical op (use = != > >= < <=)");
    conds.push(typeof leaf.value === "number"
      ? "toFloat64OrNull(attribute_value) " + op + " " + Number(leaf.value)
      // Equality folds case and whitespace, matching how the facet that offered
      // this value counted it. Ordering comparisons do not: they are for
      // numbers, and folding a string range would change what it means.
      : op === "=" || op === "!="
        ? clinicalValueFoldSql("attribute_value") + " " + op + " " + clinicalValueFoldSql(sq(String(leaf.value)))
        : "attribute_value " + op + " " + sq(String(leaf.value)));
  }
  if (!conds.length) throw new Error("clinical clause needs op/value, values[], or range{gt,gte,lt,lte}");
  return "SELECT DISTINCT " + PID("patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + dbOf(ctx) + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(ctx.study) + " AND type = " + sq(per) + "\n" +
    "    AND attribute_name = " + sq(attr) + " AND " + conds.join(" AND ");
}

const PROFILED_TYPE: Record<string, string> = { MUTATION: "MUTATION_EXTENDED", CNA: "COPY_NUMBER_ALTERATION", SV: "STRUCTURAL_VARIANT" };

/**
 * Metrics derived from the SHAPE of a study's data rather than from its
 * vocabulary. Event type names and attribute keys are study-specific — this
 * database spells the same concept "Treatment" in 87 studies and "TREATMENT" in
 * 10, and the key MSK-CHORD calls SUBTYPE exists in only 27 of 131 timeline
 * studies — so anything keyed on those names works nowhere in particular.
 * These read dates and gene symbols, which every study that has them has, and
 * so mean the same thing everywhere.
 *
 *   followupMonths  how long the timeline runs after its own day 0
 *   historyMonths   how much of the timeline predates day 0
 *   alteredGenes    distinct genes altered in the patient
 *
 * `lines` and `treatmentSpan` are the deliberate exception: they DO read a
 * study's own event-type vocabulary (which timeline event means "a therapy"),
 * because there is no vocabulary-free way to ask "how many lines of treatment"
 * at all. That is why they carry an explicit `eventType` rather than being a
 * bare metric name — the caller names the event type this study uses (Explore
 * suggests one from the study's own catalog), and a study with no event type
 * resembling a therapy simply has none of this metric to report, the same way
 * `alteredGenes` reports nothing for a study with no genomic profile.
 */
export const DERIVED_METRICS = ["followupMonths", "historyMonths", "alteredGenes", "lines", "treatmentSpan"] as const;
export type DerivedMetric = typeof DERIVED_METRICS[number];
/** Metrics that need more than (study, db) to compute — see the comment above. */
export const PARAMETERIZED_DERIVED_METRICS = new Set<DerivedMetric>(["lines", "treatmentSpan"]);

export interface DerivedMetricParams {
  /** the timeline event type that stands for "a line of treatment" here */
  eventType?: string;
  /** records within this many days of each other belong to the same line (metric "lines" only) */
  lineGap?: number;
}

/** Per-patient value for a derived metric, as SQL yielding (pid, v). */
export function derivedMetricSql(metric: DerivedMetric, study: string, db: string, params?: DerivedMetricParams): string {
  const evJoin =
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "  GROUP BY pid";
  if (metric === "followupMonths")
    return "SELECT p.stable_id AS pid, max(ce.start_date) / 30.4375 AS v\n" + evJoin;
  if (metric === "historyMonths")
    return "SELECT p.stable_id AS pid, greatest(0, -min(ce.start_date)) / 30.4375 AS v\n" + evJoin;
  if (metric === "lines" || metric === "treatmentSpan") {
    const et = canonicalEventName(String(params?.eventType || ""));
    if (!et) throw new Error("derived clause: metric '" + metric + "' needs an eventType");
    // Same shape of records as a study's timeline in general: possibly several
    // rows per decision (combination therapy), which is exactly what grouping
    // into lines (below) is for — see lib/federation.ts's sequenceSql, the
    // Sankey view this shares its line-grouping scheme with.
    const tx = "tx AS (\n" +
      "  SELECT ce.clinical_event_id AS eid, p.stable_id AS pid, ce.start_date AS s,\n" +
      "         coalesce(ce.stop_date, ce.start_date) AS e\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
      "    AND " + eventTypeMatchSql("ce.event_type", et) + "\n" +
      ")";
    if (metric === "treatmentSpan")
      return "WITH " + tx + "\nSELECT pid, (max(e) - min(s)) / 30.4375 AS v FROM tx GROUP BY pid";
    const gap = Math.max(1, Math.min(3650, Math.floor(Number(params?.lineGap) || 90)));
    return "WITH " + tx + ",\n" +
      // toNullable: over an empty frame max() on a non-nullable column returns 0,
      // which corrupts first-row detection because day offsets are often <= 0
      // (the same guard sequenceSql uses, for the same reason).
      "flagged AS (\n  SELECT *, max(toNullable(e)) OVER (PARTITION BY pid\n" +
      "    ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms\n  FROM tx\n),\n" +
      "numbered AS (\n  SELECT *, sum(if(pms IS NULL OR s > pms + " + gap + ", 1, 0)) OVER (\n" +
      "    PARTITION BY pid ORDER BY s, e, eid ROWS UNBOUNDED PRECEDING) AS line_no\n  FROM flagged\n)\n" +
      "SELECT pid, max(line_no) AS v FROM numbered GROUP BY pid";
  }
  // alteredGenes — high-level CNA only, matching the rest of the engine
  return "SELECT " + PID("patient_unique_id", study) + " AS pid, uniqExact(hugo_gene_symbol) AS v\n" +
    "  FROM " + db + ".genomic_event_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "    AND (variant_type != 'cna' OR abs(cna_alteration) >= 2)\n" +
    "  GROUP BY pid";
}

/** Match an event type by CANONICAL name — see lib/event-names.ts for why case+trim is the whole rule. */
export function eventTypeMatchSql(col: string, canonical: string): string {
  return "lower(trim(" + col + ")) = " + sq(canonicalEventName(canonical));
}

/** Validate a derived leaf and return its range predicate over `v`, plus any params it carries. */
function derivedConds(leaf: any): { metric: DerivedMetric; conds: string; params?: DerivedMetricParams } {
  const metric = String(leaf.metric || "");
  if (!(DERIVED_METRICS as readonly string[]).includes(metric))
    throw new Error("derived clause: metric must be one of " + DERIVED_METRICS.join(", ") +
      " (got '" + metric.slice(0, 40) + "')");
  let params: DerivedMetricParams | undefined;
  if (PARAMETERIZED_DERIVED_METRICS.has(metric as DerivedMetric)) {
    const eventType = String(leaf.eventType || "").trim();
    if (!eventType) throw new Error("derived clause: metric '" + metric + "' needs an eventType");
    params = { eventType, ...(leaf.lineGap != null ? { lineGap: Number(leaf.lineGap) } : {}) };
  }
  const r = leaf.range || {};
  const conds: string[] = [];
  for (const [op, sqlOp] of [["gte", ">="], ["gt", ">"], ["lte", "<="], ["lt", "<"]] as const)
    if (r[op] != null) {
      const num = Number(r[op]);
      if (!Number.isFinite(num)) throw new Error("derived clause: range." + op + " must be a number");
      conds.push("v " + sqlOp + " " + num);
    }
  if (!conds.length) throw new Error("derived clause: needs a range, e.g. {\"gte\":24,\"lt\":60}");
  return { metric: metric as DerivedMetric, conds: conds.join(" AND "), params };
}

/**
 * Several buckets of ONE derived metric, OR'd — computed in a SINGLE pass.
 *
 * The generic `any` path unions the leaves, and every derived leaf recomputes
 * its metric from scratch (a GROUP BY over the whole study's clinical_event), so
 * ticking four follow-up buckets meant four full scans. Measured federated over
 * two studies, Explore went 4.7s for one bucket to 13.3s for four — slow enough
 * that each answer was superseded by the next click and the draft count never
 * caught up, which reads as a frozen UI. Buckets of one metric are exactly the
 * case where the scan can be shared.
 */
function derivedAnySql(leaves: any[], ctx: Ctx): string {
  const parts = leaves.map(derivedConds);
  const metric = parts[0].metric;
  return "SELECT pid FROM (\n" + derivedMetricSql(metric, ctx.study, dbOf(ctx), parts[0].params) + "\n)\n" +
    "  WHERE " + parts.map((p) => "(" + p.conds + ")").join(" OR ");
}

function derivedLeafSql(leaf: any, ctx: Ctx): string {
  const { metric, conds: condStr, params } = derivedConds(leaf);
  const conds = [condStr];
  return "SELECT pid FROM (\n" + derivedMetricSql(metric as DerivedMetric, ctx.study, dbOf(ctx), params) + "\n)\n" +
    "  WHERE " + conds.join(" AND ");
}

function profiledLeafSql(leaf: ProfiledLeaf, ctx: Ctx): string {
  const t = PROFILED_TYPE[String(leaf.type || "").toUpperCase()];
  if (!t) throw new Error("profiled clause: type must be MUTATION, CNA, or SV");
  const db = dbOf(ctx);
  // Optional gene narrowing, resolved through the SAME panel tables as the
  // gene-table denominator: a sample is profiled for a gene when its panel
  // covers that gene, or when it is whole-exome. WES is a separate term rather
  // than a join because it enumerates ~45k genes — joining it multiplied one
  // TCGA study to 47.8M rows. See geneTables() in lib/explore.ts.
  let geneCond = "";
  if (leaf.gene != null) {
    const gene = String(leaf.gene).toUpperCase().trim();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("profiled clause: invalid gene symbol");
    geneCond = "\n    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (\n" +
      "      SELECT gene_panel_id FROM " + db + ".gene_panel_to_gene_derived WHERE gene = " + sq(gene) + "))";
  }
  return "SELECT DISTINCT " + PID("sd.patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(ctx.study) + " AND sp.alteration_type = " + sq(t) + geneCond;
}

function caseListLeafSql(leaf: CaseListLeaf, ctx: Ctx): string {
  let id = String(leaf.id || "").trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("caseList clause: bad list id");
  if (!id.startsWith(ctx.study)) id = ctx.study + "_" + id; // accept 'sequenced' shorthand
  return "SELECT DISTINCT p.stable_id AS pid\n" +
    "  FROM " + dbOf(ctx) + ".sample_list sl\n" +
    "  JOIN " + dbOf(ctx) + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "  JOIN " + dbOf(ctx) + ".sample s ON s.internal_id = sll.sample_id\n" +
    "  JOIN " + dbOf(ctx) + ".patient p ON p.internal_id = s.patient_id\n" +
    "  WHERE sl.stable_id = " + sq(id);
}

function numRangeConds(range: ClinicalRange | undefined, expr: string): string[] {
  const conds: string[] = [];
  for (const [k, opSym] of [["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]]) {
    const rv = range ? (range as Record<string, number | undefined>)[k] : undefined;
    if (rv != null) {
      if (!Number.isFinite(Number(rv))) throw new Error("range." + k + " must be a number");
      conds.push(expr + " " + opSym + " " + Number(rv));
    }
  }
  return conds;
}

function genomicDataLeafSql(leaf: GenomicDataLeaf, ctx: Ctx): string {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("genomicData clause: bad gene");
  const pt = String(leaf.profileType || "");
  if (ctx.profiles && !ctx.profiles.includes(pt))
    throw new Error("genomicData: profile '" + pt + "' not in this study (available: " + (ctx.profiles.join(", ") || "none") + ")");
  const conds = numRangeConds(leaf.range, "toFloat64OrNull(ga.alteration_value)");
  if (Array.isArray(leaf.values) && leaf.values.length)
    conds.push("ga.alteration_value IN (" + leaf.values.slice(0, 20).map(v => sq(String(v))).join(",") + ")");
  if (!conds.length) throw new Error("genomicData clause needs range{gt,gte,lt,lte} or values[]");
  return "SELECT DISTINCT " + PID("sd.patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + dbOf(ctx) + ".genetic_alteration_derived ga\n" +
    "  JOIN " + dbOf(ctx) + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(ctx.study) + "\n" +
    "    AND ga.hugo_gene_symbol = " + sq(gene) + " AND ga.profile_type = " + sq(pt) + "\n" +
    "    AND " + conds.join(" AND ");
}

function genericAssayLeafSql(leaf: GenericAssayLeaf, ctx: Ctx): string {
  if (ctx.gaProfiles && !ctx.gaProfiles.length)
    throw new Error("genericAssay: this study has no generic assay profiles");
  const pt = String(leaf.profileType || ""), entity = String(leaf.entity || "");
  if (!pt || !entity) throw new Error("genericAssay clause needs profileType and entity");
  if (ctx.gaProfiles && !ctx.gaProfiles.includes(pt))
    throw new Error("genericAssay: profile '" + pt + "' not in this study (available: " + ctx.gaProfiles.join(", ") + ")");
  const conds = numRangeConds(leaf.range, "toFloat64OrNull(value)");
  if (Array.isArray(leaf.values) && leaf.values.length)
    conds.push("value IN (" + leaf.values.slice(0, 20).map(v => sq(String(v))).join(",") + ")");
  if (!conds.length) throw new Error("genericAssay clause needs range or values[]");
  return "SELECT DISTINCT " + PID("patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + dbOf(ctx) + ".generic_assay_data_derived\n" +
    "  WHERE (sample_unique_id LIKE " + sq(ctx.study + "_%") + " OR patient_unique_id LIKE " + sq(ctx.study + "_%") + ")\n" +
    "    AND profile_type = " + sq(pt) + " AND entity_stable_id = " + sq(entity) + "\n" +
    "    AND " + conds.join(" AND ");
}

function eventLeafSql(leaf: EventLeafFields, ctx: Ctx): string {
  const { patientsSql } = compileCohort({
    db: dbOf(ctx), study: ctx.study, a: leaf.a, b: leaf.b, rel: leaf.rel,
    priorGuard: !!leaf.priorGuard, lineGap: leaf.lineGap ?? ctx.lineGap, patientsLimit: 1000000
  });
  return patientsSql;
}

/**
 * Splits "<study>:<id>" and keeps only the ids that belong to `study` —
 * everything else in the list is for a study compiled in a different pass
 * (see SampleListLeaf's doc comment in lib/types.ts) and is silently dropped
 * here, not an error. A colon is the delimiter, not an underscore, because a
 * bare id may itself contain one; it matches the legacy portal's own
 * study-qualified id convention.
 */
function idsForStudy(raw: string[] | undefined, study: string): string[] {
  return (raw || []).map(String).map((s): { study: string; id: string } | null => {
    const i = s.indexOf(":");
    return i > 0 && i < s.length - 1 ? { study: s.slice(0, i), id: s.slice(i + 1) } : null;
  }).filter((p): p is { study: string; id: string } => !!p && p.study === study && /^[A-Za-z0-9._-]{1,64}$/.test(p.id))
    .map(p => p.id)
    .slice(0, 50000);
}

function requireQualifiedIds(raw: string[] | undefined, kind: string): void {
  const any = (raw || []).some(s => { const i = String(s).indexOf(":"); return i > 0 && i < String(s).length - 1; });
  if (!any) throw new Error(kind + ' clause needs ids as "<study>:<id>" — none of the given ids parsed');
}

function sampleListLeafSql(leaf: SampleListLeaf, ctx: Ctx): string {
  requireQualifiedIds(leaf.ids, "sampleList");
  const ids = idsForStudy(leaf.ids, ctx.study);
  // No ids for THIS study is a normal, expected shape for a cross-study list
  // (most of it belongs to other studies in the fan-out) — it contributes
  // zero patients here, not an error.
  if (!ids.length) return "SELECT " + PID("patient_unique_id", ctx.study) + " AS pid FROM " + dbOf(ctx) + ".sample_derived WHERE 1=0";
  return "SELECT DISTINCT " + PID("patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + dbOf(ctx) + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(ctx.study) + "\n" +
    "    AND " + PID("sample_unique_id", ctx.study) + " IN (" + ids.map(sq).join(",") + ")";
}

function patientListLeafSql(leaf: PatientListLeaf, ctx: Ctx): string {
  requireQualifiedIds(leaf.ids, "patientList");
  const ids = idsForStudy(leaf.ids, ctx.study);
  if (!ids.length) return "SELECT " + PID("patient_unique_id", ctx.study) + " AS pid FROM " + dbOf(ctx) + ".sample_derived WHERE 1=0";
  return basePatientsSql(ctx.study, dbOf(ctx)) + "\n    AND " + PID("patient_unique_id", ctx.study) + " IN (" + ids.map(sq).join(",") + ")";
}

function leafSql(leaf: any, ctx: Ctx): string {
  if (leaf.kind === "oql") return oqlLeafSql(leaf.q, { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles, study: ctx.study, db: dbOf(ctx) });
  if (leaf.kind === "alteration") return oqlLeafSql(alterationToOql(leaf), { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles, study: ctx.study, db: dbOf(ctx) }); // deprecated alias
  if (leaf.kind === "clinical") return clinicalLeafSql(leaf, ctx);
  if (leaf.kind === "profiled") return profiledLeafSql(leaf, ctx);
  if (leaf.kind === "caseList") return caseListLeafSql(leaf, ctx);
  if (leaf.kind === "genomicData") return genomicDataLeafSql(leaf, ctx);
  if (leaf.kind === "genericAssay") return genericAssayLeafSql(leaf, ctx);
  if (leaf.kind === "event") return eventLeafSql(leaf, ctx);
  if (leaf.kind === "derived") return derivedLeafSql(leaf, ctx);
  if (leaf.kind === "sampleList") return sampleListLeafSql(leaf, ctx);
  if (leaf.kind === "patientList") return patientListLeafSql(leaf, ctx);
  // v1 flat event shape without kind
  if (leaf.a && leaf.rel) return eventLeafSql(leaf, ctx);
  throw new Error("unknown clause kind: " + JSON.stringify(Object.keys(leaf)));
}

function clauseSql(clause: any, ctx: Ctx): string {
  if (clause.any) {
    if (!Array.isArray(clause.any) || !clause.any.length || clause.any.length > 8) throw new Error("any: 1-8 leaves");
    // Buckets of one derived metric share a single scan — see derivedAnySql.
    // eventType must match too: two buckets of "lines" naming different event
    // types are not buckets of the same scan, they're two different metrics
    // that happen to share a name.
    const ls = clause.any;
    if (ls.length > 1 && ls.every((l: any) => l && l.kind === "derived" && l.metric === ls[0].metric
      && (l.eventType || "") === (ls[0].eventType || "")))
      return derivedAnySql(ls, ctx);
    return clause.any.map((l: any) => "(" + leafSql(l, ctx) + ")").join("\nUNION DISTINCT\n");
  }
  if (clause.not) {
    // clauseSql, not leafSql: {not: {any: [...]}} needs the same any/leaf dispatch a bare
    // clause gets, not just a single leaf — De Morgan's otherwise forces two separate `not`s
    // to express "none of these" (e.g. "DDR intact" needed !A and !B and !C by hand).
    return "(" + basePatientsSql(ctx.study, dbOf(ctx)) + ")\nEXCEPT DISTINCT\n(" + clauseSql(clause.not, ctx) + ")";
  }
  return leafSql(clause, ctx);
}

/** v1 sugar: a bare event definition becomes {all:[...]}. */
function normalizeSugar(def: CohortDef): CohortDef {
  if (def.a && def.rel && !def.all) return { all: [def as unknown as Leaf], lineGap: def.lineGap };
  return def;
}

// def -> SQL producing the cohort's patient stable ids (column: pid)
export function compileCohortDef(def: CohortDef | null | undefined, { oncokbPin, profiles, gaProfiles, study = STUDY, db }: Partial<CompileCtx> = {}): string {
  if (!def) return basePatientsSql(study, db || DB);
  const d = normalizeSugar(def);
  const clauses = d.all;
  // No clauses means every patient in the study — the same thing an absent
  // definition means, and a legitimate cohort (it is the denominator for
  // everything else). Kept consistent with the null case rather than erroring on
  // one spelling of the same intent; the readback says "all patients in the
  // study" so it can never be mistaken for a filter that silently did nothing.
  if (Array.isArray(clauses) && clauses.length === 0) return basePatientsSql(study, db || DB);
  if (!Array.isArray(clauses) || clauses.length > 8) throw new Error("cohort def needs all: [0-8 clauses]");
  const ctx: Ctx = { oncokbPin, profiles, gaProfiles, study, db: db || DB, lineGap: d.lineGap ?? 90 };
  return clauses.map((c) => "(" + clauseSql(c, ctx) + ")").join("\nINTERSECT DISTINCT\n");
}

// ---- plain-language readback --------------------------------------------
function leafText(leaf: any): string {
  if (leaf.kind === "oql") return "OQL[" + leaf.q + "]";
  if (leaf.kind === "alteration") {
    const t = leaf.types && leaf.types.length && leaf.types.length < 3 ? " (" + leaf.types.join("/") + ")" : "";
    return leaf.gene + (leaf.driver === "driverOnly" ? " driver-altered" : " altered") + t;
  }
  if (leaf.kind === "clinical") {
    const bits: string[] = [];
    if (leaf.values && leaf.values.length) bits.push("in [" + leaf.values.join(", ") + "]");
    if (leaf.range) bits.push(Object.entries(leaf.range).map(([k, v]) => k + " " + v).join(", "));
    if (leaf.op != null) bits.push(leaf.op + " " + leaf.value);
    return leaf.attribute + " " + bits.join(" ") + (leaf.per === "sample" ? " (any sample)" : "");
  }
  if (leaf.kind === "profiled") return "profiled for " + leaf.type;
  if (leaf.kind === "derived") {
    const r = (leaf as any).range || {};
    const parts = [r.gte != null ? "\u2265 " + r.gte : null, r.gt != null ? "> " + r.gt : null,
                   r.lte != null ? "\u2264 " + r.lte : null, r.lt != null ? "< " + r.lt : null].filter(Boolean);
    const m = (leaf as any).metric;
    // "lines" already names its own unit ("3 lines"), so it does not get a
    // second unit word appended the way the others do.
    const unit = m === "alteredGenes" ? " genes" : m === "lines" ? "" : " months";
    const of = (leaf as any).eventType ? " of '" + (leaf as any).eventType + "'" : "";
    return m + of + " " + parts.join(" and ") + unit;
  }
  if (leaf.kind === "caseList") return "in case list " + leaf.id;
  if (leaf.kind === "genomicData") return leaf.gene + " " + leaf.profileType + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "genericAssay") return leaf.entity + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "sampleList" || leaf.kind === "patientList") {
    const ids: string[] = leaf.ids || [];
    const noun = leaf.kind === "sampleList" ? "sample" : "patient";
    const studies = new Set(ids.map((s) => String(s).split(":")[0]).filter(Boolean));
    return "in a list of " + ids.length + " " + noun + (ids.length === 1 ? "" : "s") +
      (studies.size > 1 ? " across " + studies.size + " studies" : "");
  }
  if (leaf.kind === "event" || (leaf.a && leaf.rel)) {
    const rel = leaf.rel || {};
    const NUM_SYM: Record<string, string> = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "" };
    const selText = (s: any): string => {
      if (!s) return "?";
      const occ = s.occurrence === "FIRST" ? "first " : s.occurrence === "LAST" ? "last " : "";
      // A treatment line's LINE_NO can arrive as an attrs equality or a numeric
      // predicate (>=/<=) — "line 2" vs "line ≥2" — so read whichever is present
      // rather than dropping the number the way a plain attrs/eventType join would.
      if (s.eventType === LINE_TYPE) {
        const eq = (s.attrs || []).find((a: any) => a.key === "LINE_NO");
        const lineNo = eq ? eq.value
          : s.numeric && s.numeric.key === "LINE_NO" ? (NUM_SYM[s.numeric.op] ?? s.numeric.op) + s.numeric.value : "n";
        return occ + "line " + lineNo;
      }
      const attrs = (s.attrs || []).map((a: any) => a.value).join(" ");
      return occ + (attrs ? attrs + " " : "") + s.eventType.replace(" (derived)", "").toLowerCase();
    };
    if (rel.type === "BEFORE") return selText(leaf.a) + " then " + selText(leaf.b) + " ≤" + rel.maxDays + "d";
    if (rel.type === "DURING") return selText(leaf.b) + " during " + selText(leaf.a);
    if (rel.type === "NOT_FOLLOWED_BY") return selText(leaf.a) + " NOT followed by " + selText(leaf.b) + " ≤" + rel.withinDays + "d";
    return "has " + selText(leaf.a) + (leaf.priorGuard ? " (treatment-naïve)" : "");
  }
  return "?";
}

export function describeCohortDef(def: CohortDef | null | undefined): string {
  if (!def) return "all patients in the study";
  const d = normalizeSugar(def);
  if (Array.isArray(d.all) && d.all.length === 0) return "all patients in the study";
  return (d.all || []).map((c: any) => {
    if (c.any) return "(" + c.any.map(leafText).join(" OR ") + ")";
    if (c.not) return c.not.any
      ? "NOT (" + c.not.any.map(leafText).join(" OR ") + ")"
      : "NOT " + leafText(c.not);
    return leafText(c);
  }).join(" AND ");
}
