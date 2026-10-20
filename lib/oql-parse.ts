// The OQL parser alone: text -> entries, or an Error that says what is wrong. Pure and
// browser-safe, so a gene query can be checked as it is typed; lib/oql.ts compiles the entries
// to SQL and re-exports this. The grammar it accepts is described at the top of lib/oql.ts.

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

/**
 * The data a patient must have been profiled for before an OQL alteration can be said NOT to be
 * there — the panel-aware rule that keeps "not profiled" out of "unaltered". An alteration type
 * missing here (EXP, PROT) has no profiling condition in this engine.
 */
export const OQL_PROFILE: Partial<Record<OqlSpecType, ("MUTATION" | "CNA" | "SV")[]>> = {
  MUT: ["MUTATION"], CNA: ["CNA"], SV: ["SV"],
  // "altered at all" is only decidable as false for a patient profiled for every type
  ANY: ["MUTATION", "CNA", "SV"]
};

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const CLASS_MAP: Record<string, string> = {
  MISSENSE: "missense", NONSENSE: "nonsense", NONSTART: "nonstart", NONSTOP: "nonstop", FRAMESHIFT: "frameshift",
  INFRAME: "inframe", SPLICE: "splice", PROMOTER: "promoter", TRUNC: "trunc"
};

const REJECT: Record<string, string> = {
  GAIN: "GAIN is not supported: only high-level CNA (amp/deep-deletion, ±2) is stored",
  HETLOSS: "HETLOSS is not supported: only high-level CNA (±2) is stored",

  GERMLINE: "GERMLINE is not supported: public studies are germline-stripped",
  SOMATIC: "SOMATIC modifier is not supported (all stored mutations are somatic/unknown)"
};

/** what separates one OQL statement from the next: a semicolon, a new line or a comma */
export const OQL_SEPARATOR = /[;\n,]/;
/** a query's statements as typed, trimmed, empty ones dropped */
export function oqlStatements(q: string): string[] {
  return q.split(OQL_SEPARATOR).map((s) => s.trim()).filter(Boolean);
}

// -> [{gene, specs: [{type:'MUT'|'CNA'|'SV'|'ANY', pchange?, cls?, cna?, driver}]}]
export function parseOql(q: string): OqlEntry[] {
  if (typeof q !== "string" || !q.trim()) throw new Error("empty OQL");
  if (q.length > 1000) throw new Error("OQL too long");
  const entries = oqlStatements(q);
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
