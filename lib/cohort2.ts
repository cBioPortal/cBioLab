// DSL v2: unified cohort algebra.
//
// A cohort definition is bounded boolean composition over typed leaf predicates:
//   { all: [ clause, ... ], lineGap?: 90 }
//   clause := leaf | { any: [leaf, ...] } | { not: leaf }
//   leaf   := { kind: "oql", q: "KRAS: MUT=G12C; STK11: DRIVER" } // genomic status (OQL)
//          | { kind: "clinical", attribute, op, value }           // patient attribute
//          | { kind: "event", a, b?, rel, priorGuard? }           // timeline sub-DSL (v1 shape)
//          | { kind: "patients", ids: [...] }                     // explicit list
//
// Depth is capped by construction (all -> any/not -> leaf): everything compiles to
// per-leaf CTEs over patient stable ids combined with INTERSECT / UNION / EXCEPT,
// and everything stays renderable as a sentence. Back-compat: the v1 flat event
// shape {a, b?, rel, ...} is accepted anywhere a definition is expected.
import { DB, STUDY } from "./ch.ts";
import { compileCohort, sq } from "./compiler.ts";
import { oqlLeafSql } from "./oql.ts";
import type {
  CohortDef, Clause, Leaf, CompileCtx, ClinicalLeaf, ClinicalRange,
  ProfiledLeaf, CaseListLeaf, GenomicDataLeaf, GenericAssayLeaf,
  PatientsLeaf, AlterationLeaf, EventLeafFields
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
    conds.push("attribute_value IN (" + leaf.values.slice(0, 50).map(v => sq(String(v))).join(",") + ")");
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
 */
export const DERIVED_METRICS = ["followupMonths", "historyMonths", "alteredGenes"] as const;
export type DerivedMetric = typeof DERIVED_METRICS[number];

/** Per-patient value for a derived metric, as SQL yielding (pid, v). */
export function derivedMetricSql(metric: DerivedMetric, study: string, db: string): string {
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
  // alteredGenes — high-level CNA only, matching the rest of the engine
  return "SELECT " + PID("patient_unique_id", study) + " AS pid, uniqExact(hugo_gene_symbol) AS v\n" +
    "  FROM " + db + ".genomic_event_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "    AND (variant_type != 'cna' OR abs(cna_alteration) >= 2)\n" +
    "  GROUP BY pid";
}

/** Validate a derived leaf and return its range predicate over `v`. */
function derivedConds(leaf: any): { metric: DerivedMetric; conds: string } {
  const metric = String(leaf.metric || "");
  if (!(DERIVED_METRICS as readonly string[]).includes(metric))
    throw new Error("derived clause: metric must be one of " + DERIVED_METRICS.join(", ") +
      " (got '" + metric.slice(0, 40) + "')");
  const r = leaf.range || {};
  const conds: string[] = [];
  for (const [op, sqlOp] of [["gte", ">="], ["gt", ">"], ["lte", "<="], ["lt", "<"]] as const)
    if (r[op] != null) {
      const num = Number(r[op]);
      if (!Number.isFinite(num)) throw new Error("derived clause: range." + op + " must be a number");
      conds.push("v " + sqlOp + " " + num);
    }
  if (!conds.length) throw new Error("derived clause: needs a range, e.g. {\"gte\":24,\"lt\":60}");
  return { metric: metric as DerivedMetric, conds: conds.join(" AND ") };
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
  return "SELECT pid FROM (\n" + derivedMetricSql(metric, ctx.study, dbOf(ctx)) + "\n)\n" +
    "  WHERE " + parts.map((p) => "(" + p.conds + ")").join(" OR ");
}

function derivedLeafSql(leaf: any, ctx: Ctx): string {
  const { metric, conds: condStr } = derivedConds(leaf);
  const conds = [condStr];
  return "SELECT pid FROM (\n" + derivedMetricSql(metric as DerivedMetric, ctx.study, dbOf(ctx)) + "\n)\n" +
    "  WHERE " + conds.join(" AND ");
}

function profiledLeafSql(leaf: ProfiledLeaf, ctx: Ctx): string {
  const t = PROFILED_TYPE[String(leaf.type || "").toUpperCase()];
  if (!t) throw new Error("profiled clause: type must be MUTATION, CNA, or SV");
  return "SELECT DISTINCT " + PID("sd.patient_unique_id", ctx.study) + " AS pid\n" +
    "  FROM " + dbOf(ctx) + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + dbOf(ctx) + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(ctx.study) + " AND sp.alteration_type = " + sq(t);
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

function patientsLeafSql(leaf: PatientsLeaf, ctx: Ctx): string {
  const ids = (leaf.ids || []).map(String).filter(p => /^[A-Za-z0-9._-]{1,64}$/.test(p)).slice(0, 50000);
  if (!ids.length) throw new Error("patients clause has no valid ids");
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
  if (leaf.kind === "patients") return patientsLeafSql(leaf, ctx);
  // v1 flat event shape without kind
  if (leaf.a && leaf.rel) return eventLeafSql(leaf, ctx);
  throw new Error("unknown clause kind: " + JSON.stringify(Object.keys(leaf)));
}

function clauseSql(clause: any, ctx: Ctx): string {
  if (clause.any) {
    if (!Array.isArray(clause.any) || !clause.any.length || clause.any.length > 8) throw new Error("any: 1-8 leaves");
    // Buckets of one derived metric share a single scan — see derivedAnySql.
    const ls = clause.any;
    if (ls.length > 1 && ls.every((l: any) => l && l.kind === "derived" && l.metric === ls[0].metric))
      return derivedAnySql(ls, ctx);
    return clause.any.map((l: any) => "(" + leafSql(l, ctx) + ")").join("\nUNION DISTINCT\n");
  }
  if (clause.not) {
    return "(" + basePatientsSql(ctx.study, dbOf(ctx)) + ")\nEXCEPT DISTINCT\n(" + leafSql(clause.not, ctx) + ")";
  }
  return leafSql(clause, ctx);
}

/** v1 sugar: a bare event definition, or an explicit patient list, becomes {all:[...]}. */
function normalizeSugar(def: CohortDef): CohortDef {
  if (def.a && def.rel && !def.all) return { all: [def as unknown as Leaf], lineGap: def.lineGap };
  if (def.patients && !def.all) return { all: [{ kind: "patients", ids: def.patients }] };
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
    const unit = (leaf as any).metric === "alteredGenes" ? " genes" : " months";
    return (leaf as any).metric + " " + parts.join(" and ") + unit;
  }
  if (leaf.kind === "caseList") return "in case list " + leaf.id;
  if (leaf.kind === "genomicData") return leaf.gene + " " + leaf.profileType + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "genericAssay") return leaf.entity + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "patients") return "in a list of " + (leaf.ids || []).length + " patients";
  if (leaf.kind === "event" || (leaf.a && leaf.rel)) {
    const rel = leaf.rel || {};
    const selText = (s: any): string => {
      if (!s) return "?";
      const attrs = (s.attrs || []).map((a: any) => a.value).join(" ");
      const base = (attrs ? attrs + " " : "") + s.eventType.replace(" (derived)", "").toLowerCase();
      return (s.occurrence === "FIRST" ? "first " : s.occurrence === "LAST" ? "last " : "") + base;
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
    if (c.not) return "NOT " + leafText(c.not);
    return leafText(c);
  }).join(" AND ");
}
