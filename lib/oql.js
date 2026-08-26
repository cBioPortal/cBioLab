// OQL (Onco Query Language) support for the cohort DSL: {kind:"oql", q:"STK11: DRIVER"}.
// Parses the cBioPortal OQL subset our data can honestly answer and compiles it to SQL
// over genomic_event_derived (+ the pinned OncoKB store for DRIVER semantics).
//
// Supported per gene: MUT | MUT=<pchange> | MISSENSE NONSENSE TRUNC INFRAME SPLICE |
//   AMP HOMDEL | FUSION | DRIVER (standalone = any driver alteration) | _DRIVER /
//   DRIVER_ modifiers on any of the above | bare gene = any alteration.
// Rejected with an explanation (not silently approximated): GAIN/HETLOSS (only high-level
// CNA (+-2) is stored), EXP/PROT (no expression thresholds here), GERMLINE/SOMATIC
// (public studies are germline-stripped), PROMOTER.
import { DB, STUDY } from "./ch.js";
import { sq } from "./compiler.js";

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const CLASS_MAP = {
  MISSENSE: "missense", NONSENSE: "nonsense", TRUNC: "trunc", INFRAME: "in_frame", SPLICE: "splice"
};
const REJECT = {
  GAIN: "GAIN is not supported: only high-level CNA (amp/deep-deletion, ±2) is stored",
  HETLOSS: "HETLOSS is not supported: only high-level CNA (±2) is stored",
  EXP: "EXP is not supported (no expression data in this store)",
  PROT: "PROT is not supported (no protein data in this store)",
  GERMLINE: "GERMLINE is not supported: public studies are germline-stripped",
  SOMATIC: "SOMATIC modifier is not supported (all stored mutations are somatic/unknown)",
  PROMOTER: "PROMOTER is not supported in this dataset"
};

// -> [{gene, specs: [{type:'MUT'|'CNA'|'SV'|'ANY', pchange?, cls?, cna?, driver}]}]
export function parseOql(q) {
  if (typeof q !== "string" || !q.trim()) throw new Error("empty OQL");
  if (q.length > 500) throw new Error("OQL too long");
  const entries = q.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  if (!entries.length || entries.length > 10) throw new Error("OQL: 1-10 gene entries");
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

function parseSpec(tok0, entry) {
  let tok = tok0.toUpperCase();
  let driver = false;
  // DRIVER as prefix/suffix modifier (DRIVER_G12D, G12D_DRIVER, MUT=DRIVER_G12D, TRUNC_DRIVER…)
  if (tok.startsWith("DRIVER_")) { driver = true; tok = tok.slice(7); }
  if (tok.endsWith("_DRIVER")) { driver = true; tok = tok.slice(0, -7); }
  if (tok === "DRIVER") return { type: "ANY", driver: true };
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

function specCond(spec) {
  const conds = [];
  if (spec.type === "MUT") {
    conds.push("g.variant_type = 'mutation'");
    if (spec.cls === "trunc") conds.push("(lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%')");
    else if (spec.cls) conds.push("lower(g.mutation_type) LIKE " + sq(spec.cls + "%"));
    if (spec.pchange) conds.push("g.mutation_variant = " + sq(spec.pchange));
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

const DRIVER_JOIN = (pin) =>
  "  JOIN oncokb_annotation.variant_annotation ann\n" +
  "    ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
  "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
  "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
  "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
  "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n";

// full OQL leaf -> SQL of matching patient stable ids (portal semantics: altered by ANY entry)
export function oqlLeafSql(q, { oncokbPin } = {}) {
  const parsed = parseOql(q);
  const parts = [];
  for (const { gene, specs } of parsed) {
    for (const spec of specs) {
      if (spec.driver && !oncokbPin) throw new Error("OQL DRIVER requires the OncoKB annotation store");
      parts.push(
        "SELECT DISTINCT replaceOne(g.patient_unique_id, " + sq(STUDY + "_") + ", '') AS pid\n" +
        "  FROM " + DB + ".genomic_event_derived g\n" +
        (spec.driver ? DRIVER_JOIN(oncokbPin) : "") +
        "  WHERE g.cancer_study_identifier = " + sq(STUDY) + "\n" +
        "    AND g.hugo_gene_symbol = " + sq(gene) + "\n" +
        "    AND " + specCond(spec)
      );
    }
  }
  return parts.map(p => "(" + p + ")").join("\nUNION DISTINCT\n");
}
