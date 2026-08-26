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
import { DB, STUDY } from "./ch.js";
import { compileCohort, sq } from "./compiler.js";
import { oqlLeafSql } from "./oql.js";

const PID = (col) => "replaceOne(" + col + ", " + sq(STUDY + "_") + ", '')";
const CLIN_OP = { "=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

export function basePatientsSql() {
  return "SELECT DISTINCT " + PID("patient_unique_id") + " AS pid FROM " + DB + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(STUDY);
}

// DEPRECATED back-compat: {kind:"alteration", gene, driver, types} — grandfathered so
// saved cohorts and old links keep working, but no longer part of the public DSL.
// It translates to OQL and compiles through the same engine, so equivalence with the
// OQL form holds by construction (one semantics owner).
function alterationToOql(leaf) {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("invalid gene symbol in alteration clause");
  const types = (leaf.types && leaf.types.length ? leaf.types : ["MUT", "CNA", "SV"])
    .filter(t => ["MUT", "CNA", "SV"].includes(t));
  const driver = leaf.driver === "driverOnly";
  if (types.length === 3) return gene + ":" + (driver ? " DRIVER" : "");
  const specs = [];
  if (types.includes("MUT")) specs.push(driver ? "MUT_DRIVER" : "MUT");
  if (types.includes("CNA")) specs.push(driver ? "AMP_DRIVER HOMDEL_DRIVER" : "AMP HOMDEL");
  if (types.includes("SV")) specs.push(driver ? "FUSION_DRIVER" : "FUSION");
  return gene + ": " + specs.join(" ");
}

function clinicalLeafSql(leaf) {
  const attr = String(leaf.attribute || "");
  if (!attr || attr.length > 200) throw new Error("invalid clinical attribute");
  const per = leaf.per === "sample" ? "sample" : "patient"; // sample-level collapses: patient matches if ANY sample matches
  const conds = [];
  if (Array.isArray(leaf.values) && leaf.values.length) {
    conds.push("attribute_value IN (" + leaf.values.slice(0, 50).map(v => sq(String(v))).join(",") + ")");
  }
  if (leaf.range && typeof leaf.range === "object") {
    const r = leaf.range, num = "toFloat64OrNull(attribute_value)";
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
  return "SELECT DISTINCT " + PID("patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(STUDY) + " AND type = " + sq(per) + "\n" +
    "    AND attribute_name = " + sq(attr) + " AND " + conds.join(" AND ");
}

const PROFILED_TYPE = { MUTATION: "MUTATION_EXTENDED", CNA: "COPY_NUMBER_ALTERATION", SV: "STRUCTURAL_VARIANT" };

function profiledLeafSql(leaf) {
  const t = PROFILED_TYPE[String(leaf.type || "").toUpperCase()];
  if (!t) throw new Error("profiled clause: type must be MUTATION, CNA, or SV");
  return "SELECT DISTINCT " + PID("sd.patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(STUDY) + " AND sp.alteration_type = " + sq(t);
}

function caseListLeafSql(leaf) {
  let id = String(leaf.id || "").trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("caseList clause: bad list id");
  if (!id.startsWith(STUDY)) id = STUDY + "_" + id; // accept 'sequenced' shorthand
  return "SELECT DISTINCT p.stable_id AS pid\n" +
    "  FROM " + DB + ".sample_list sl\n" +
    "  JOIN " + DB + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "  JOIN " + DB + ".sample s ON s.internal_id = sll.sample_id\n" +
    "  JOIN " + DB + ".patient p ON p.internal_id = s.patient_id\n" +
    "  WHERE sl.stable_id = " + sq(id);
}

function numRangeConds(range, expr) {
  const conds = [];
  for (const [k, opSym] of [["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]]) {
    if (range && range[k] != null) {
      if (!Number.isFinite(Number(range[k]))) throw new Error("range." + k + " must be a number");
      conds.push(expr + " " + opSym + " " + Number(range[k]));
    }
  }
  return conds;
}

function genomicDataLeafSql(leaf, ctx) {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("genomicData clause: bad gene");
  const pt = String(leaf.profileType || "");
  if (ctx.profiles && !ctx.profiles.includes(pt))
    throw new Error("genomicData: profile '" + pt + "' not in this study (available: " + (ctx.profiles.join(", ") || "none") + ")");
  const conds = numRangeConds(leaf.range, "toFloat64OrNull(ga.alteration_value)");
  if (Array.isArray(leaf.values) && leaf.values.length)
    conds.push("ga.alteration_value IN (" + leaf.values.slice(0, 20).map(v => sq(String(v))).join(",") + ")");
  if (!conds.length) throw new Error("genomicData clause needs range{gt,gte,lt,lte} or values[]");
  return "SELECT DISTINCT " + PID("sd.patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".genetic_alteration_derived ga\n" +
    "  JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(STUDY) + "\n" +
    "    AND ga.hugo_gene_symbol = " + sq(gene) + " AND ga.profile_type = " + sq(pt) + "\n" +
    "    AND " + conds.join(" AND ");
}

function genericAssayLeafSql(leaf, ctx) {
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
  return "SELECT DISTINCT " + PID("patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".generic_assay_data_derived\n" +
    "  WHERE (sample_unique_id LIKE " + sq(STUDY + "_%") + " OR patient_unique_id LIKE " + sq(STUDY + "_%") + ")\n" +
    "    AND profile_type = " + sq(pt) + " AND entity_stable_id = " + sq(entity) + "\n" +
    "    AND " + conds.join(" AND ");
}

function eventLeafSql(leaf, lineGap) {
  const { patientsSql } = compileCohort({
    db: DB, study: STUDY, a: leaf.a, b: leaf.b, rel: leaf.rel,
    priorGuard: !!leaf.priorGuard, lineGap: leaf.lineGap ?? lineGap, patientsLimit: 1000000
  });
  return patientsSql;
}

function patientsLeafSql(leaf) {
  const ids = (leaf.ids || []).map(String).filter(p => /^[A-Za-z0-9._-]{1,64}$/.test(p)).slice(0, 50000);
  if (!ids.length) throw new Error("patients clause has no valid ids");
  return basePatientsSql() + "\n    AND " + PID("patient_unique_id") + " IN (" + ids.map(sq).join(",") + ")";
}

function leafSql(leaf, ctx) {
  if (leaf.kind === "oql") return oqlLeafSql(leaf.q, { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles });
  if (leaf.kind === "alteration") return oqlLeafSql(alterationToOql(leaf), { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles }); // deprecated alias
  if (leaf.kind === "clinical") return clinicalLeafSql(leaf);
  if (leaf.kind === "profiled") return profiledLeafSql(leaf);
  if (leaf.kind === "caseList") return caseListLeafSql(leaf);
  if (leaf.kind === "genomicData") return genomicDataLeafSql(leaf, ctx);
  if (leaf.kind === "genericAssay") return genericAssayLeafSql(leaf, ctx);
  if (leaf.kind === "event") return eventLeafSql(leaf, ctx.lineGap);
  if (leaf.kind === "patients") return patientsLeafSql(leaf);
  // v1 flat event shape without kind
  if (leaf.a && leaf.rel) return eventLeafSql(leaf, ctx.lineGap);
  throw new Error("unknown clause kind: " + JSON.stringify(Object.keys(leaf)));
}

function clauseSql(clause, ctx) {
  if (clause.any) {
    if (!Array.isArray(clause.any) || !clause.any.length || clause.any.length > 8) throw new Error("any: 1-8 leaves");
    return clause.any.map(l => "(" + leafSql(l, ctx) + ")").join("\nUNION DISTINCT\n");
  }
  if (clause.not) {
    return "(" + basePatientsSql() + ")\nEXCEPT DISTINCT\n(" + leafSql(clause.not, ctx) + ")";
  }
  return leafSql(clause, ctx);
}

// def -> SQL producing the cohort's patient stable ids (column: pid)
export function compileCohortDef(def, { oncokbPin, profiles, gaProfiles } = {}) {
  if (!def) return basePatientsSql();
  if (def.a && def.rel && !def.all) def = { all: [def], lineGap: def.lineGap }; // v1 sugar
  if (def.patients && !def.all) def = { all: [{ kind: "patients", ids: def.patients }] };
  const clauses = def.all;
  if (!Array.isArray(clauses) || !clauses.length || clauses.length > 8) throw new Error("cohort def needs all: [1-8 clauses]");
  const ctx = { oncokbPin, profiles, gaProfiles, lineGap: def.lineGap ?? 90 };
  return clauses.map(c => "(" + clauseSql(c, ctx) + ")").join("\nINTERSECT DISTINCT\n");
}

// ---- plain-language readback --------------------------------------------
function leafText(leaf) {
  if (leaf.kind === "oql") return "OQL[" + leaf.q + "]";
  if (leaf.kind === "alteration") {
    const t = leaf.types && leaf.types.length && leaf.types.length < 3 ? " (" + leaf.types.join("/") + ")" : "";
    return leaf.gene + (leaf.driver === "driverOnly" ? " driver-altered" : " altered") + t;
  }
  if (leaf.kind === "clinical") {
    const bits = [];
    if (leaf.values && leaf.values.length) bits.push("in [" + leaf.values.join(", ") + "]");
    if (leaf.range) bits.push(Object.entries(leaf.range).map(([k, v]) => k + " " + v).join(", "));
    if (leaf.op != null) bits.push(leaf.op + " " + leaf.value);
    return leaf.attribute + " " + bits.join(" ") + (leaf.per === "sample" ? " (any sample)" : "");
  }
  if (leaf.kind === "profiled") return "profiled for " + leaf.type;
  if (leaf.kind === "caseList") return "in case list " + leaf.id;
  if (leaf.kind === "genomicData") return leaf.gene + " " + leaf.profileType + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "genericAssay") return leaf.entity + " " + JSON.stringify(leaf.range || leaf.values);
  if (leaf.kind === "patients") return "in a list of " + (leaf.ids || []).length + " patients";
  if (leaf.kind === "event" || (leaf.a && leaf.rel)) {
    const rel = leaf.rel || {};
    const selText = s => {
      if (!s) return "?";
      const attrs = (s.attrs || []).map(a => a.value).join(" ");
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

export function describeCohortDef(def) {
  if (!def) return "all patients in the study";
  if (def.a && def.rel && !def.all) def = { all: [def] };
  if (def.patients && !def.all) def = { all: [{ kind: "patients", ids: def.patients }] };
  return (def.all || []).map(c => {
    if (c.any) return "(" + c.any.map(leafText).join(" OR ") + ")";
    if (c.not) return "NOT " + leafText(c.not);
    return leafText(c);
  }).join(" AND ");
}
