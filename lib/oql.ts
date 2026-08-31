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
import { DB, STUDY } from "./ch.ts";
import { sq } from "./compiler.ts";

export type OqlSpecType = "MUT" | "CNA" | "SV" | "ANY" | "EXP" | "PROT";
export interface OqlSpec {
  type: OqlSpecType; driver?: boolean;
  pchange?: string; cls?: string; cna?: number;
  op?: string; z?: number;
}
export interface OqlEntry { gene: string; specs: OqlSpec[] }

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const CLASS_MAP: Record<string, string> = {
  MISSENSE: "missense", NONSENSE: "nonsense", TRUNC: "trunc", INFRAME: "in_frame", SPLICE: "splice"
};
const REJECT: Record<string, string> = {
  GAIN: "GAIN is not supported: only high-level CNA (amp/deep-deletion, ±2) is stored",
  HETLOSS: "HETLOSS is not supported: only high-level CNA (±2) is stored",

  GERMLINE: "GERMLINE is not supported: public studies are germline-stripped",
  SOMATIC: "SOMATIC modifier is not supported (all stored mutations are somatic/unknown)",
  PROMOTER: "PROMOTER is not supported in this dataset"
};

// -> [{gene, specs: [{type:'MUT'|'CNA'|'SV'|'ANY', pchange?, cls?, cna?, driver}]}]
export function parseOql(q: string): OqlEntry[] {
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

function parseSpec(tok0: string, entry: string): OqlSpec {
  let tok = tok0.toUpperCase();
  let driver = false;
  // DRIVER as prefix/suffix modifier (DRIVER_G12D, G12D_DRIVER, MUT=DRIVER_G12D, TRUNC_DRIVER…)
  if (tok.startsWith("DRIVER_")) { driver = true; tok = tok.slice(7); }
  if (tok.endsWith("_DRIVER")) { driver = true; tok = tok.slice(0, -7); }
  if (tok === "DRIVER") return { type: "ANY", driver: true };
  let em = tok.match(/^(EXP|PROT)([<>]=?)(-?\d+(?:\.\d+)?)$/);
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

const DRIVER_JOIN = (pin: string): string =>
  "  JOIN oncokb_annotation.variant_annotation ann\n" +
  "    ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
  "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
  "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
  "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
  "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n";

// full OQL leaf -> SQL of matching patient stable ids (portal semantics: altered by ANY entry)
export function oqlLeafSql(q: string, { oncokbPin, profiles, study = STUDY, db = DB }: { oncokbPin?: string | null; profiles?: string[]; study?: string; db?: string } = {}): string {
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
          "SELECT DISTINCT replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
          "  FROM " + db + ".genetic_alteration_derived ga\n" +
          "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
          "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.hugo_gene_symbol = " + sq(gene) + "\n" +
          "    AND ga.profile_type = " + sq(prof) + " AND toFloat64OrNull(ga.alteration_value) " + spec.op + " " + spec.z);
        continue;
      }
      parts.push(
        "SELECT DISTINCT replaceOne(g.patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
        "  FROM " + db + ".genomic_event_derived g\n" +
        (spec.driver ? DRIVER_JOIN(oncokbPin!) : "") +
        "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
        "    AND g.hugo_gene_symbol = " + sq(gene) + "\n" +
        "    AND " + specCond(spec)
      );
    }
  }
  return parts.map(p => "(" + p + ")").join("\nUNION DISTINCT\n");
}
