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
  const op = CLIN_OP[leaf.op];
  if (!op) throw new Error("invalid clinical op (use = != > >= < <=)");
  const numeric = typeof leaf.value === "number";
  const cond = numeric
    ? "toFloat64OrNull(attribute_value) " + op + " " + Number(leaf.value)
    : "attribute_value " + op + " " + sq(String(leaf.value));
  return "SELECT DISTINCT " + PID("patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(STUDY) + " AND type = 'patient'\n" +
    "    AND attribute_name = " + sq(attr) + " AND " + cond;
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
  if (leaf.kind === "oql") return oqlLeafSql(leaf.q, { oncokbPin: ctx.oncokbPin });
  if (leaf.kind === "alteration") return oqlLeafSql(alterationToOql(leaf), { oncokbPin: ctx.oncokbPin }); // deprecated alias
  if (leaf.kind === "clinical") return clinicalLeafSql(leaf);
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
export function compileCohortDef(def, { oncokbPin } = {}) {
  if (!def) return basePatientsSql();
  if (def.a && def.rel && !def.all) def = { all: [def], lineGap: def.lineGap }; // v1 sugar
  if (def.patients && !def.all) def = { all: [{ kind: "patients", ids: def.patients }] };
  const clauses = def.all;
  if (!Array.isArray(clauses) || !clauses.length || clauses.length > 8) throw new Error("cohort def needs all: [1-8 clauses]");
  const ctx = { oncokbPin, lineGap: def.lineGap ?? 90 };
  return clauses.map(c => "(" + clauseSql(c, ctx) + ")").join("\nINTERSECT DISTINCT\n");
}

// ---- plain-language readback --------------------------------------------
function leafText(leaf) {
  if (leaf.kind === "oql") return "OQL[" + leaf.q + "]";
  if (leaf.kind === "alteration") {
    const t = leaf.types && leaf.types.length && leaf.types.length < 3 ? " (" + leaf.types.join("/") + ")" : "";
    return leaf.gene + (leaf.driver === "driverOnly" ? " driver-altered" : " altered") + t;
  }
  if (leaf.kind === "clinical") return leaf.attribute + " " + leaf.op + " " + leaf.value;
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
