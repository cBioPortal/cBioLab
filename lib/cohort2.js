// DSL v2: unified cohort algebra.
//
// A cohort definition is bounded boolean composition over typed leaf predicates:
//   { all: [ clause, ... ], lineGap?: 90 }
//   clause := leaf | { any: [leaf, ...] } | { not: leaf }
//   leaf   := { kind: "alteration", gene, driver?: "any"|"driverOnly",
//               types?: ["MUT","CNA","SV"] }                     // genomic status
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

const PID = (col) => "replaceOne(" + col + ", " + sq(STUDY + "_") + ", '')";
const CLIN_OP = { "=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

export function basePatientsSql() {
  return "SELECT DISTINCT " + PID("patient_unique_id") + " AS pid FROM " + DB + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(STUDY);
}

function alterationLeafSql(leaf, oncokbPin) {
  const gene = String(leaf.gene || "").toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(gene)) throw new Error("invalid gene symbol in alteration clause");
  const types = (leaf.types && leaf.types.length ? leaf.types : ["MUT", "CNA", "SV"])
    .filter(t => ["MUT", "CNA", "SV"].includes(t));
  const vt = [];
  if (types.includes("MUT")) vt.push("'mutation'");
  if (types.includes("CNA")) vt.push("'cna'");
  if (types.includes("SV")) vt.push("'structural_variant'");
  let sql =
    "SELECT DISTINCT " + PID("g.patient_unique_id") + " AS pid\n" +
    "  FROM " + DB + ".genomic_event_derived g\n";
  if (leaf.driver === "driverOnly") {
    if (!oncokbPin) throw new Error("driverOnly requires the OncoKB annotation store");
    sql +=
      "  JOIN oncokb_annotation.variant_annotation ann\n" +
      "    ON ann.oncokb_version = " + sq(oncokbPin) + " AND ann.is_driver\n" +
      "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
      "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
      "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
      "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n";
  }
  sql +=
    "  WHERE g.cancer_study_identifier = " + sq(STUDY) + "\n" +
    "    AND g.hugo_gene_symbol = " + sq(gene) + "\n" +
    "    AND g.variant_type IN (" + vt.join(",") + ")\n" +
    "    AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)";
  return sql;
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
  if (leaf.kind === "alteration") return alterationLeafSql(leaf, ctx.oncokbPin);
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
