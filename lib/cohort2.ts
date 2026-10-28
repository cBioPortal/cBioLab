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
// Depth is capped by construction (all -> any/not -> leaf). A cohort is a set of SAMPLES, as on
// cBioPortal: every leaf compiles to rows (pid, sid) of the study's samples — a sample-level leaf
// (an alteration, a sample attribute, a sample list) the samples that match it, a patient-level
// one (a patient attribute, a timeline event, a patient list) every sample of the patients that
// match — combined with INTERSECT / UNION / EXCEPT, so all/any/not are intersection, union and
// complement over samples. A cohort's patients are the owners of its samples. Everything stays
// renderable as a sentence. Back-compat: the v1 flat event
// shape {a, b?, rel, ...} is accepted anywhere a definition is expected.
import { DB, STUDY } from "./ch.ts";
import { compileCohort, sq, LINE_TYPE } from "./compiler.ts";
import { oqlCasesSql } from "./oql.ts";
import { clinicalValueFoldSql, foldedEqualsSql } from "./event-names.ts";
import { linesCtes, DEFAULT_LINE_GAP } from "./treatment-lines.ts";
import { activeCustomData, clinicalTable } from "./custom-data.ts";
import { UPLOAD_DATASET_RE, customAttr } from "./custom-data-names.ts";
import { idSetTable, idSetIfLoaded, ID_SET_UUID } from "./id-sets.ts";
import { lockClause } from "./cohort-lock.ts";
import type {
  CohortDef, Clause, Leaf, CompileCtx, ClinicalLeaf, ClinicalRange,
  ProfiledLeaf, CaseListLeaf, GenomicDataLeaf, GenericAssayLeaf,
  SampleListLeaf, PatientListLeaf, SplitLeaf, UploadLeaf, AlterationLeaf, EventLeafFields, ProteinPositionLeaf
} from "./types.ts";
import { finiteSql } from "./sql-number.ts";
import { ASSAY_MISSING_VALUES } from "./generic-assay.ts";
import { aggregateSql, type AggregateSql, patientSql, type PatientSql } from "./sql-kinds.ts";
import { DAYS_PER_MONTH } from "./time-units.ts";

/** Every leaf compiler receives a fully-resolved context. */
type Ctx = CompileCtx & { study: string };
const dbOf = (ctx: Ctx): string => ctx.db || DB;

const PID = (col: string, study: string): string => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
const CLIN_OP: Record<string, string> = { "=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

export function basePatientsSql(study: string = STUDY, db: string = DB): string {
  return "SELECT DISTINCT " + PID("patient_unique_id", study) + " AS pid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study);
}

/** Every sample of the study as (pid, sid), bare ids: what a cohort with no clauses is, and every cohort a subset of. */
export function baseSamplesSql(study: string = STUDY, db: string = DB): string {
  return "SELECT " + PID("patient_unique_id", study) + " AS pid, " + PID("sample_unique_id", study) + " AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study);
}

/**
 * What a leaf selects, before it becomes the study's samples: sample ids (`sample`), patient ids
 * (`patient`, every sample of each), or rows (lvl, id) whose level the study's own data decides
 * (`stored`, a clinical attribute or generic assay recorded per sample in one study and per patient
 * in another). Each is a one-column subquery but `stored`, whose subquery yields (lvl, id) with lvl
 * 'sample' or 'patient'.
 */
type LeafIds = { level: "sample" | "patient" | "stored"; sql: string };
const ofSamples = (sql: string): LeafIds => ({ level: "sample", sql });
const ofPatients = (sql: string): LeafIds => ({ level: "patient", sql });
const ofStored = (sql: string): LeafIds => ({ level: "stored", sql });

/** A leaf's ids as rows (pid, sid) of the study's samples. */
function leafSamplesSql(ids: LeafIds, ctx: Ctx): string {
  const pid = PID("patient_unique_id", ctx.study), sid = PID("sample_unique_id", ctx.study);
  const cond = ids.level === "sample" ? sid + " IN (" + ids.sql + ")"
    : ids.level === "patient" ? pid + " IN (" + ids.sql + ")"
    // one subquery, named twice: ClickHouse builds the set for an identical IN subquery once
    : "(('sample', " + sid + ") IN (" + ids.sql + ") OR ('patient', " + pid + ") IN (" + ids.sql + "))";
  return baseSamplesSql(ctx.study, dbOf(ctx)) + "\n    AND " + cond;
}

/** A clause naming `per` no longer means anything: the level an attribute is recorded at is each study's own. */
function rejectPer(leaf: object, kind: string): void {
  if ("per" in leaf) throw new Error(kind + " clause: `per` was removed — an attribute is matched at the level each study records it (a sample attribute selects the matching samples, a patient attribute every sample of the matching patients)");
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

function clinicalLeafSql(leaf: ClinicalLeaf, ctx: Ctx): LeafIds {
  const attr = String(leaf.attribute || "");
  if (!attr || attr.length > 200) throw new Error("invalid clinical attribute");
  rejectPer(leaf, "clinical");
  const conds: string[] = [];
  if (Array.isArray(leaf.values) && leaf.values.length) {
    // folded on both sides, exactly as the `=` case is — a multi-value pick is
    // several facet clicks, and must select what those facets counted
    conds.push(clinicalValueFoldSql("attribute_value") + " IN (" +
      leaf.values.slice(0, 50).map(v => clinicalValueFoldSql(sq(String(v)))).join(",") + ")");
  }
  if (leaf.range && typeof leaf.range === "object") {
    const r = leaf.range as Record<string, number | undefined>, num = finiteSql("attribute_value");
    for (const [k, opSym] of [["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]]) {
      if (r[k] != null) {
        if (!Number.isFinite(Number(r[k]))) throw new Error("clinical range." + k + " must be a number");
        conds.push(num + " " + opSym + " " + Number(r[k]));
      }
    }
  }
  // Every condition here reads a recorded value, so a sample with none matches neither `= X` nor
  // `!= X`, while {not: {= X}} keeps it.
  if (leaf.op != null) {
    const op = CLIN_OP[leaf.op];
    if (!op) throw new Error("invalid clinical op (use = != > >= < <=)");
    conds.push(typeof leaf.value === "number"
      ? finiteSql("attribute_value") + " " + op + " " + Number(leaf.value)
      // Equality folds case and whitespace, matching how the facet that offered
      // this value counted it. Ordering comparisons do not: they are for
      // numbers, and folding a string range would change what it means.
      : op === "=" || op === "!="
        ? clinicalValueFoldSql("attribute_value") + " " + op + " " + clinicalValueFoldSql(sq(String(leaf.value)))
        : "attribute_value " + op + " " + sq(String(leaf.value)));
  }
  if (!conds.length) throw new Error("clinical clause needs op/value, values[], or range{gt,gte,lt,lte}");
  return ofStored(storedRowsSql(clinicalTable(dbOf(ctx), [attr]), ctx) +
    "    AND attribute_name = " + sq(attr) + " AND " + conds.join(" AND "));
}

/** A clinical table's rows in this study as (lvl, id): a sample row names its sample, a patient row its patient. */
function storedRowsSql(table: string, ctx: Ctx): string {
  return "SELECT DISTINCT type AS lvl, if(type = 'sample', " + PID("sample_unique_id", ctx.study) + ", " + PID("patient_unique_id", ctx.study) + ") AS id\n" +
    "  FROM " + table + "\n" +
    "  WHERE cancer_study_identifier = " + sq(ctx.study) + "\n";
}

/** The samples with any value in an upload — a row of any of its columns — or every sample of a patient with one. */
function uploadLeafSql(leaf: UploadLeaf, ctx: Ctx): LeafIds {
  const name = UPLOAD_DATASET_RE.exec(String(leaf.dataset || ""))?.[1];
  if (!name) throw new Error('upload clause needs dataset:"custom:<name>"');
  const d = activeCustomData()?.datasets.find((x) => x.id === name);
  if (!d) throw new Error("this analysis uses custom data that was not sent with it: '" + name + "'");
  const attrs = d.columns.map((c) => customAttr(d.id, c.name));
  return ofStored(storedRowsSql(clinicalTable(dbOf(ctx), attrs), ctx) + "    AND attribute_name IN (" + attrs.map(sq).join(",") + ")");
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
  /** which treatment records form lines (metric "lines" only): the systemic classes by default — lib/treatment-lines.ts */
  lineClasses?: "systemic" | "all" | string[];
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
    return "SELECT p.stable_id AS pid, max(ce.start_date) / " + DAYS_PER_MONTH + " AS v\n" + evJoin;
  if (metric === "historyMonths")
    return "SELECT p.stable_id AS pid, greatest(0, -min(ce.start_date)) / " + DAYS_PER_MONTH + " AS v\n" + evJoin;
  if (metric === "lines" || metric === "treatmentSpan") {
    const eventType = String(params?.eventType || "").trim();
    if (!eventType) throw new Error("derived clause: metric '" + metric + "' needs an eventType");
    if (metric === "treatmentSpan")
      return "SELECT p.stable_id AS pid, (max(coalesce(ce.stop_date, ce.start_date)) - min(ce.start_date)) / " + DAYS_PER_MONTH + " AS v\n" +
        "  FROM " + db + ".clinical_event ce\n" +
        "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
        "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
        "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
        "    AND " + eventTypeMatchSql("ce.event_type", eventType) + "\n" +
        "  GROUP BY pid";
    // the one line definition every view and clause shares — see lib/treatment-lines.ts
    return "WITH " + linesCtes({ db, study, patientFilter: "1",
      spec: { gap: params?.lineGap ?? DEFAULT_LINE_GAP, eventType, ...(params?.lineClasses ? { classes: params.lineClasses } : {}) } }).join(",\n") + "\n" +
      "SELECT pid, max(line_no) AS v FROM lines GROUP BY pid";
  }
  // alteredGenes — high-level CNA only, matching the rest of the engine
  return "SELECT " + PID("patient_unique_id", study) + " AS pid, uniqExact(hugo_gene_symbol) AS v\n" +
    "  FROM " + db + ".genomic_event_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "    AND (variant_type != 'cna' OR abs(cna_alteration) >= 2)\n" +
    "  GROUP BY pid";
}

/** Match an event type by CANONICAL name — see lib/event-names.ts for why case+trim is the whole rule. */
export function eventTypeMatchSql(col: string, name: string): string {
  return foldedEqualsSql(col, name);
}

/** A document's lineClasses, validated: "systemic", "all", or up to 40 class names. */
export function lineClassesParam(x: unknown): "systemic" | "all" | string[] {
  if (x === "systemic" || x === "all") return x;
  if (Array.isArray(x) && x.length && x.length <= 40 && x.every((c) => typeof c === "string" && c.trim() && c.length <= 120)) return x.map(String);
  throw new Error("lineClasses is \"systemic\", \"all\", or a list of up to 40 treatment class names");
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
    params = { eventType, ...(leaf.lineGap != null ? { lineGap: Number(leaf.lineGap) } : {}),
      ...(leaf.lineClasses != null ? { lineClasses: lineClassesParam(leaf.lineClasses) } : {}) };
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
function derivedAnySql(leaves: any[], ctx: Ctx): LeafIds {
  const parts = leaves.map(derivedConds);
  const metric = parts[0].metric;
  return ofPatients("SELECT pid FROM (\n" + derivedMetricSql(metric, ctx.study, dbOf(ctx), parts[0].params) + "\n)\n" +
    "  WHERE " + parts.map((p) => "(" + p.conds + ")").join(" OR "));
}

function derivedLeafSql(leaf: any, ctx: Ctx): LeafIds {
  const { metric, conds, params } = derivedConds(leaf);
  return ofPatients("SELECT pid FROM (\n" + derivedMetricSql(metric as DerivedMetric, ctx.study, dbOf(ctx), params) + "\n)\n" +
    "  WHERE " + conds);
}

/**
 * The cases (samples, or patients with a profiled sample) profiled for `gene` in one alteration
 * type, as bare ids in the column `profiled_id`: the same panel tables, and the same whole-exome rule, as the `profiled` clause
 * and the gene-table denominator. What an OQL plot axis needs to tell "not altered" from "not
 * profiled", per sample or per patient.
 */
export function profiledCasesSql(gene: string, type: "MUTATION" | "CNA" | "SV", o: { study: string; db: string; unit: "patient" | "sample" }): string {
  const g = String(gene).toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)) throw new Error("profiled: invalid gene symbol");
  const col = o.unit === "sample" ? "sd.sample_unique_id" : "sd.patient_unique_id";
  return "SELECT DISTINCT " + PID(col, o.study) + " AS profiled_id\n" +
    "  FROM " + o.db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + o.db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(o.study) + " AND sp.alteration_type = " + sq(PROFILED_TYPE[type]) +
    "\n    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (\n" +
    "      SELECT gene_panel_id FROM " + o.db + ".gene_panel_to_gene_derived WHERE gene = " + sq(g) + "))";
}

/** the most genes one profiled clause names: a gene list's own limit (lib/gene-tracks.ts) */
export const PROFILED_MAX_GENES = 32;

function profiledLeafSql(leaf: ProfiledLeaf, ctx: Ctx): LeafIds {
  const t = PROFILED_TYPE[String(leaf.type || "").toUpperCase()];
  if (!t) throw new Error("profiled clause: type must be MUTATION, CNA, or SV");
  // A gene list is its genes' clauses AND-ed: the same samples as one clause per gene
  if (leaf.genes != null) {
    if (leaf.gene != null) throw new Error("profiled clause: give `gene` or `genes`, not both");
    if (!Array.isArray(leaf.genes) || !leaf.genes.length) throw new Error("profiled clause: `genes` must list at least one gene");
    const genes = [...new Set(leaf.genes.map((g) => String(g).toUpperCase().trim()))];
    if (genes.length > PROFILED_MAX_GENES)
      throw new Error("profiled clause: at most " + PROFILED_MAX_GENES + " genes; this names " + genes.length);
    return ofSamples(genes.map((gene) => "(" + profiledLeafSql({ kind: "profiled", type: leaf.type, gene }, ctx).sql + ")").join("\n  INTERSECT DISTINCT\n"));
  }
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
  return ofSamples("SELECT DISTINCT " + PID("sp.sample_unique_id", ctx.study) + " AS sid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(ctx.study) + " AND sp.alteration_type = " + sq(t) + geneCond);
}

function caseListLeafSql(leaf: CaseListLeaf, ctx: Ctx): LeafIds {
  let id = String(leaf.id || "").trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("caseList clause: bad list id");
  if (!id.startsWith(ctx.study + "_")) id = ctx.study + "_" + id; // accept 'sequenced' shorthand
  // only this study's lists: a sibling study's id also starts with this one's, and TCGA patient
  // ids are shared across TCGA studies, so its list would read as plausible members
  return ofSamples("SELECT DISTINCT s.stable_id AS sid\n" +
    "  FROM " + dbOf(ctx) + ".sample_list sl\n" +
    "  JOIN " + dbOf(ctx) + ".cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id\n" +
    "  JOIN " + dbOf(ctx) + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "  JOIN " + dbOf(ctx) + ".sample s ON s.internal_id = sll.sample_id\n" +
    "  WHERE sl.stable_id = " + sq(id) + " AND cs.cancer_study_identifier = " + sq(ctx.study));
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

function genomicDataLeafSql(leaf: GenomicDataLeaf, ctx: Ctx): LeafIds {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("genomicData clause: bad gene");
  const pt = String(leaf.profileType || "");
  if (ctx.profiles && !ctx.profiles.includes(pt))
    throw new Error("genomicData: profile '" + pt + "' not in this study (available: " + (ctx.profiles.join(", ") || "none") + ")");
  const conds = numRangeConds(leaf.range, finiteSql("ga.alteration_value"));
  if (Array.isArray(leaf.values) && leaf.values.length)
    conds.push("ga.alteration_value IN (" + leaf.values.slice(0, 20).map(v => sq(String(v))).join(",") + ")");
  if (!conds.length) throw new Error("genomicData clause needs range{gt,gte,lt,lte} or values[]");
  return ofSamples("SELECT DISTINCT " + PID("ga.sample_unique_id", ctx.study) + " AS sid\n" +
    "  FROM " + dbOf(ctx) + ".genetic_alteration_derived ga\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(ctx.study) + "\n" +
    "    AND ga.hugo_gene_symbol = " + sq(gene) + " AND ga.profile_type = " + sq(pt) + "\n" +
    "    AND " + conds.join(" AND "));
}

function genericAssayLeafSql(leaf: GenericAssayLeaf, ctx: Ctx): LeafIds {
  if (ctx.gaProfiles && !ctx.gaProfiles.length)
    throw new Error("genericAssay: this study has no generic assay profiles");
  const pt = String(leaf.profileType || ""), entity = String(leaf.entity || "");
  if (!pt || !entity) throw new Error("genericAssay clause needs profileType and entity");
  if (ctx.gaProfiles && !ctx.gaProfiles.includes(pt))
    throw new Error("genericAssay: profile '" + pt + "' not in this study (available: " + ctx.gaProfiles.join(", ") + ")");
  const conds = numRangeConds(leaf.range, finiteSql("value"));
  if (Array.isArray(leaf.values) && leaf.values.length)
    conds.push("value IN (" + leaf.values.slice(0, 20).map(v => sq(String(v))).join(",") + ")");
  if (leaf.measured === true) conds.push("trimBoth(value) NOT IN (" + ASSAY_MISSING_VALUES.map(sq).join(",") + ")");
  if (!conds.length) throw new Error("genericAssay clause needs range, values[] or measured: true");
  // a profile is measured per sample or (patient_level) per patient
  return ofStored("SELECT DISTINCT if(patient_level = 1, 'patient', 'sample') AS lvl,\n" +
    "       if(patient_level = 1, " + PID("patient_unique_id", ctx.study) + ", " + PID("sample_unique_id", ctx.study) + ") AS id\n" +
    "  FROM " + dbOf(ctx) + ".generic_assay_data_derived\n" +
    // the study's own profile by its exact id: a prefix match on the ids also reads every sibling
    // study named after this one (brca_tcga_pub_…, brca_tcga_pan_can_atlas_2018_…)
    "  WHERE profile_type = " + sq(pt) + " AND profile_stable_id = " + sq(ctx.study + "_" + pt) + "\n" +
    "    AND entity_stable_id = " + sq(entity) + "\n" +
    "    AND " + conds.join(" AND "));
}

// mutation_derived, not genetic_alteration_derived: the same table the lollipop reads
// proteinPosStart from (never parsed from the change string), and its sampleId is
// already bare — no PID() stripping, unlike every table above keyed by sample_unique_id.
function proteinPositionLeafSql(leaf: ProteinPositionLeaf, ctx: Ctx): LeafIds {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("proteinPosition clause: bad gene");
  const conds = numRangeConds(leaf.range, "proteinPosStart");
  if (!conds.length) throw new Error("proteinPosition clause needs range{gt,gte,lt,lte}");
  return ofSamples("SELECT DISTINCT sampleId AS sid\n" +
    "  FROM " + dbOf(ctx) + ".mutation_derived\n" +
    "  WHERE studyId = " + sq(ctx.study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n" +
    "    AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''\n" +
    "    AND " + conds.join(" AND "));
}

function eventLeafSql(leaf: EventLeafFields, ctx: Ctx): LeafIds {
  const { patientsSql } = compileCohort({
    db: dbOf(ctx), study: ctx.study, a: leaf.a, b: leaf.b, rel: leaf.rel,
    priorGuard: !!leaf.priorGuard, lineGap: leaf.lineGap ?? ctx.lineGap, patientsLimit: 1000000
  });
  return ofPatients(patientsSql);
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
    .map(p => p.id);
}

function requireQualifiedIds(raw: string[] | undefined, kind: string): void {
  const any = (raw || []).some(s => { const i = String(s).indexOf(":"); return i > 0 && i < String(s).length - 1; });
  if (!any) throw new Error(kind + ' clause needs ids as "<study>:<id>" — none of the given ids parsed');
}

/**
 * The most SQL text an inline list may compile to. ClickHouse refuses a statement over its
 * 256 KB max_query_size, and the list shares the statement with the rest of the query; past this a
 * list is refused here, by name, rather than by a syntax error from the database. A stored set
 * (`set`) has no such limit: its ids travel as an external table.
 */
export const INLINE_ID_SQL_LIMIT = 200_000;

/** `<pid expression> IN (…)` for a list leaf: its stored set's table, or its inline ids. Null when it names nobody in `study`. */
function listMembership(leaf: SampleListLeaf | PatientListLeaf, ctx: Ctx, col: string): string | null {
  const { kind } = leaf;
  if (leaf.set !== undefined && leaf.ids !== undefined) throw new Error(kind + " clause takes ids or a stored set, not both");
  const level = kind === "sampleList" ? "sample" : "patient";
  if (leaf.part !== undefined && leaf.set === undefined) throw new Error(kind + " clause: part names a part of a stored set, so it needs set");
  if (leaf.set !== undefined) {
    if (typeof leaf.set !== "string" || !ID_SET_UUID.test(leaf.set)) throw new Error(kind + " clause: set must be a stored id set's id (a uuid)");
    if (leaf.part !== undefined && (typeof leaf.part !== "string" || !leaf.part)) throw new Error(kind + " clause: part must name a part of the set");
    const table = idSetTable(leaf.set, ctx.study, level, leaf.part ?? "");
    return table && PID(col, ctx.study) + " IN (SELECT id FROM " + table + ")";
  }
  requireQualifiedIds(leaf.ids, kind);
  const ids = idsForStudy(leaf.ids, ctx.study);
  if (!ids.length) return null;
  const sql = ids.map(sq).join(",");
  if (sql.length > INLINE_ID_SQL_LIMIT)
    throw new Error("this " + kind + " has " + ids.length.toLocaleString("en-US") + " " + level + " ids for " + ctx.study +
      ", too many to write into one query (" + Math.round(sql.length / 1000) + " KB of the " + INLINE_ID_SQL_LIMIT / 1000 +
      " KB a list may take): save it as a stored id set and name it with \"set\" instead");
  return PID(col, ctx.study) + " IN (" + sql + ")";
}

function sampleListLeafSql(leaf: SampleListLeaf, ctx: Ctx): LeafIds {
  const member = listMembership(leaf, ctx, "sample_unique_id");
  // No ids for THIS study is a normal, expected shape for a cross-study list
  // (most of it belongs to other studies in the fan-out) — it contributes
  // zero samples here, not an error.
  return ofSamples("SELECT " + PID("sample_unique_id", ctx.study) + " AS sid FROM " + dbOf(ctx) + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(ctx.study) + " AND " + (member ?? "1=0"));
}

function patientListLeafSql(leaf: PatientListLeaf, ctx: Ctx): LeafIds {
  const member = listMembership(leaf, ctx, "patient_unique_id");
  return ofPatients(basePatientsSql(ctx.study, dbOf(ctx)) + "\n    AND " + (member ?? "1=0"));
}

/**
 * The one rule for joining a table to a cohort (a compiled cohort named `cte`, columns pid, sid).
 * A table keyed by sample keeps the cohort's samples and nothing else — a patient's other samples
 * are not in it; a table keyed by patient keeps the cohort's patients, the owners of its samples.
 * Each takes the table's bare id expression (study prefix already stripped).
 */
export function inCohortSamples(sampleIdExpr: string, cte = "cohort"): string {
  return sampleIdExpr + " IN (SELECT sid FROM " + cte + ")";
}
export function inCohortPatients(patientIdExpr: string, cte = "cohort"): string {
  return patientIdExpr + " IN (SELECT pid FROM " + cte + ")";
}
/** A table's `sample_unique_id`-style column as a bare id, for inCohortSamples. */
export const bareSampleId = (col: string, study: string): string => PID(col, study);

/** A compiled cohort's samples, as bare ids (column sid): what a lock records beside its patients. */
export function memberSamplesSql(cohortSql: string): PatientSql {
  return patientSql("SELECT DISTINCT sid FROM (" + cohortSql + ")");
}

/**
 * How far the data has moved from a locked cohort, in samples: of the frozen samples
 * (`lockedSql`) how many the data still holds, what the definition (`liveSql`) selects now, and
 * which it would add and which it would drop — a new sample the definition selects is one it adds.
 */
export function lockDriftSql(lockedSql: string, liveSql: string): AggregateSql {
  return aggregateSql("WITH locked AS (" + lockedSql + "),\n     live AS (" + liveSql + ")\n" +
    "SELECT (SELECT uniqExact(sid) FROM locked) AS present,\n" +
    "       (SELECT uniqExact(sid) FROM live) AS now,\n" +
    "       (SELECT uniqExact(sid) FROM live WHERE sid NOT IN (SELECT sid FROM locked)) AS entered,\n" +
    "       (SELECT uniqExact(sid) FROM locked WHERE sid NOT IN (SELECT sid FROM live)) AS left");
}

// The salt is part of what every held-out result means: changing it reshuffles every
// discovery/validation partition ever reported. test/cohort.test.ts pins it.
export const SPLIT_SALT = "cohort-lab-split-v1";
const SPLIT_PARTS: Record<string, number> = { discovery: 0, validation: 1 };
/** The held-out split's bucket for a bare patient id expression: 0 = discovery, 1 = validation. One
 *  definition, shared with any view that reports on the halves, so they cannot disagree. */
export function splitBucketSql(pidExpr: string, study: string): string {
  return "cityHash64(concat(" + sq(SPLIT_SALT + ":" + study + ":") + ", " + pidExpr + ")) % 2";
}

function splitLeafSql(leaf: SplitLeaf, ctx: Ctx): LeafIds {
  const bucket = SPLIT_PARTS[String(leaf.part)];
  if (bucket === undefined) throw new Error('split clause: part must be "discovery" or "validation"');
  const pid = PID("patient_unique_id", ctx.study);
  return ofPatients("SELECT DISTINCT " + pid + " AS pid FROM " + dbOf(ctx) + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(ctx.study) + "\n" +
    "    AND " + splitBucketSql(pid, ctx.study) + " = " + bucket);
}

/** A leaf as rows (pid, sid) of the study's samples. */
function leafSql(leaf: Leaf, ctx: Ctx): string {
  return leafSamplesSql(leafIds(leaf, ctx), ctx);
}

function leafIds(leaf: Leaf, ctx: Ctx): LeafIds {
  // an alteration is called per sample
  const oql = (q: string) => ofSamples(oqlCasesSql(q, { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles, study: ctx.study, db: dbOf(ctx), unit: "sample" }));
  // v1 flat event shape without kind
  if (!("kind" in leaf)) {
    if (leaf.a && leaf.rel) return eventLeafSql(leaf, ctx);
    throw new Error("unknown clause kind: " + JSON.stringify(Object.keys(leaf)));
  }
  // one case per Leaf kind: a kind added to the Leaf union without a case here is a type error
  switch (leaf.kind) {
    case "oql": return oql(leaf.q);
    case "alteration": return oql(alterationToOql(leaf)); // deprecated alias
    case "clinical": return clinicalLeafSql(leaf, ctx);
    case "profiled": return profiledLeafSql(leaf, ctx);
    case "caseList": return caseListLeafSql(leaf, ctx);
    case "genomicData": return genomicDataLeafSql(leaf, ctx);
    case "genericAssay": return genericAssayLeafSql(leaf, ctx);
    case "proteinPosition": return proteinPositionLeafSql(leaf, ctx);
    case "event": return eventLeafSql(leaf, ctx);
    case "derived": return derivedLeafSql(leaf, ctx);
    case "sampleList": return sampleListLeafSql(leaf, ctx);
    case "patientList": return patientListLeafSql(leaf, ctx);
    case "split": return splitLeafSql(leaf, ctx);
    case "upload": return uploadLeafSql(leaf, ctx);
    default: return unknownLeaf(leaf);
  }
}

/** Documents arrive as JSON, so a kind the types rule out can still reach here at run time. */
function unknownLeaf(leaf: never): never {
  throw new Error("unknown clause kind: " + JSON.stringify(Object.keys(leaf as object)));
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
      return leafSamplesSql(derivedAnySql(ls, ctx), ctx);
    return clause.any.map((l: any) => "(" + leafSql(l, ctx) + ")").join("\nUNION DISTINCT\n");
  }
  if (clause.not) {
    // `not` is the study's samples minus the matches, so it keeps every sample the leaf could
    // not decide: {not: oql "STK11:"} includes samples never sequenced for STK11, and
    // {not: clinical} those with no value recorded. A wild-type cohort pairs it with
    // {kind: "profiled", type, gene} for the same gene; lib/cohort-partitions.ts sends the
    // undecided to their own arm instead.
    // clauseSql, not leafSql: {not: {any: [...]}} needs the same any/leaf dispatch a bare
    // clause gets, not just a single leaf — De Morgan's otherwise forces two separate `not`s
    // to express "none of these" (e.g. "DDR intact" needed !A and !B and !C by hand).
    return "(" + baseSamplesSql(ctx.study, dbOf(ctx)) + ")\nEXCEPT DISTINCT\n(" + clauseSql(clause.not, ctx) + ")";
  }
  return leafSql(clause, ctx);
}

/** v1 sugar: a bare event definition becomes {all:[...]}. */
function normalizeSugar(def: CohortDef): CohortDef {
  if (def.a && def.rel && !def.all) return { all: [def as unknown as Leaf], lineGap: def.lineGap };
  return def;
}

// def -> SQL producing the cohort's samples, one row each: (pid, sid), bare stable ids
export function compileCohortDef(def: CohortDef | null | undefined, { oncokbPin, profiles, gaProfiles, study = STUDY, db }: Partial<CompileCtx> = {}): string {
  if (!def) return baseSamplesSql(study, db || DB);
  // a locked cohort is its frozen patients wherever it is compiled, not only inside runAnalysis
  // (which has already made it so, lib/cohort-lock.ts): Explore, an oncoprint spec, a link
  const d = def.lock ? { ...normalizeSugar(def), all: [lockClause(def.lock)] } : normalizeSugar(def);
  const clauses = d.all;
  // No clauses means every sample in the study — the same thing an absent
  // definition means, and a legitimate cohort (it is the denominator for
  // everything else). Kept consistent with the null case rather than erroring on
  // one spelling of the same intent; the readback says "all samples in the
  // study" so it can never be mistaken for a filter that silently did nothing.
  if (Array.isArray(clauses) && clauses.length === 0) return baseSamplesSql(study, db || DB);
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
    if (leaf.op != null) bits.push(leaf.op + " " + leaf.value +
      (leaf.percentile != null ? " (" + Math.round(leaf.percentile * 100) + "th percentile" + (leaf.percentileOf ? " of " + leaf.percentileOf : "") + ")" : ""));
    return leaf.attribute + " " + bits.join(" ");
  }
  if (leaf.kind === "profiled") return "profiled for " + (leaf.genes?.length ? leaf.genes.map((g: string) => String(g).toUpperCase()).join(", ") + " " : leaf.gene ? String(leaf.gene).toUpperCase() + " " : "") + leaf.type;
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
  if (leaf.kind === "split") return "in the " + leaf.part + " half (fixed held-out split)";
  if (leaf.kind === "upload") return "with a row in upload " + String(leaf.dataset).slice("custom:".length);
  if (leaf.kind === "genomicData") return leaf.gene + " " + leaf.profileType + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "genericAssay") return leaf.entity + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "proteinPosition") return leaf.gene + " protein position " + JSON.stringify(leaf.range || {});
  if (leaf.kind === "sampleList" || leaf.kind === "patientList") {
    const noun = leaf.kind === "sampleList" ? "sample" : "patient";
    if (typeof leaf.set === "string") {
      const s = idSetIfLoaded(leaf.set);
      if (!s) return "in stored " + noun + " set " + leaf.set;
      return "in stored " + noun + " set “" + s.name + "” (" + s.count.toLocaleString("en-US") + " " + noun + (s.count === 1 ? "" : "s") + ")";
    }
    const ids: string[] = leaf.ids || [];
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
  if (!def) return "all samples in the study";
  const d = normalizeSugar(def);
  if (Array.isArray(d.all) && d.all.length === 0) return "all samples in the study";
  return (d.all || []).map(describeClause).join(" AND ");
}

/** One clause of a cohort's `all`, in the same plain language as describeCohortDef. */
export function describeClause(c: any): string {
  if (c.any) return "(" + c.any.map(leafText).join(" OR ") + ")";
  if (c.not) return c.not.any
    ? "NOT (" + c.not.any.map(leafText).join(" OR ") + ")"
    : "NOT " + leafText(c.not);
  return leafText(c);
}

/** A cohort's clauses as a list, v1 sugar normalized — what an attrition view steps through. */
export function cohortClauses(def: CohortDef | null | undefined): Clause[] {
  if (!def) return [];
  return normalizeSugar(def).all || [];
}
