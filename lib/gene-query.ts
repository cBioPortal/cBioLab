// What a gene query typed into a page says, checked entry by entry as it is typed: an OQL query
// (each line or ";"-separated entry a gene and what counts as altered in it) or a plain gene list
// (cBioPortal's, where `[A B]` is one merged row). Pure and browser-safe; the symbols it finds are
// checked against the warehouse's gene table separately (POST /api/genes).
import { parseOql, OQL_SEPARATOR, type OqlSpec } from "./oql-parse.ts";
import { parseGeneList, geneSymbols, normalizeGeneTracks, MAX_GENE_TRACKS, type GeneTrackSpec } from "./gene-tracks.ts";

export type GeneQueryMode = "oql" | "genes";

export interface QueryEntry {
  /** the entry as typed */
  text: string;
  /** the symbols it names, upper-cased */
  genes: string[];
  /** what it selects, in words, when it parses */
  meaning?: string;
  error?: string;
}

export interface QueryCheck {
  entries: QueryEntry[];
  /** every symbol, in order of first appearance */
  genes: string[];
  /** what is wrong with the query as a whole (too many entries, unbalanced brackets) */
  error?: string;
  /** the gene list's rows, in "genes" mode, when it parses */
  tracks?: GeneTrackSpec[];
}

/** the most entries an OQL query takes (lib/oql-parse.ts) */
export const MAX_OQL_ENTRIES = 30;

const CLASS_WORDS: Record<string, string> = {
  missense: "missense", nonsense: "nonsense", nonstart: "nonstart", nonstop: "nonstop", frameshift: "frameshift",
  inframe: "in-frame", splice: "splice", promoter: "promoter", trunc: "truncating",
};

/** one OQL alteration, in words */
export function describeSpec(s: OqlSpec): string {
  const drv = s.driver ? " (drivers only)" : "";
  const range = s.range ? " at positions " + (s.range.start ?? "") + "–" + (s.range.end ?? "") + (s.range.contained ? ", wholly inside" : "") : "";
  switch (s.type) {
    case "MUT": return (s.pchange ? s.pchange + " mutations" : s.cls ? CLASS_WORDS[s.cls] + " mutations" : "mutations") + range + drv;
    case "CNA": return (s.cna === 2 ? "amplification" : s.cna === -2 ? "deep deletion" : "amplification or deep deletion") + drv;
    case "SV": return "structural variants" + drv;
    case "EXP": return "mRNA z " + s.op + " " + s.z;
    case "PROT": return "protein z " + s.op + " " + s.z;
    default: return s.driver ? "any driver alteration" : "any alteration";
  }
}

export function checkGeneQuery(text: string, mode: GeneQueryMode): QueryCheck {
  if (mode === "genes") {
    try {
      const tracks = parseGeneList(text);
      const entries: QueryEntry[] = tracks.map((t) => typeof t === "string"
        ? { text: t, genes: [t.toUpperCase()], meaning: "its own row" }
        : { text: "[" + (t.label ? '"' + t.label + '" ' : "") + t.genes.join(" ") + "]", genes: t.genes.map((g) => g.toUpperCase()), meaning: "one merged row" });
      let error: string | undefined;
      try { normalizeGeneTracks(tracks); } catch (e) { error = String((e as Error).message || e); }
      if (!error && tracks.length > MAX_GENE_TRACKS) error = "a gene list takes at most " + MAX_GENE_TRACKS + " rows; this has " + tracks.length;
      return { entries, genes: geneSymbols(tracks).map((g) => g.toUpperCase()), tracks, error };
    } catch (e) {
      return { entries: [], genes: [], error: String((e as Error).message || e) };
    }
  }
  const parts = text.split(OQL_SEPARATOR).flatMap(splitBareGenes);
  const entries: QueryEntry[] = parts.map((p) => {
    const head = (p.match(/^([A-Za-z0-9.-]+)/)?.[1] || "").toUpperCase();
    try {
      const [e] = parseOql(p);
      return { text: p, genes: [e.gene], meaning: e.specs.map(describeSpec).join(" or ") };
    } catch (err) {
      return { text: p, genes: head ? [head] : [], error: String((err as Error).message || err).replace(/^OQL:?\s*/, "") };
    }
  });
  const genes = [...new Set(entries.flatMap((e) => e.genes))];
  const error = parts.length > MAX_OQL_ENTRIES ? "a query takes at most " + MAX_OQL_ENTRIES + " entries; this has " + parts.length : undefined;
  return { entries, genes, error };
}

/**
 * One line of OQL as the portal reads it: genes separated by spaces or commas, the last of them
 * optionally followed by ":" and what counts as altered — "KRAS NRAS BRAF" is three entries,
 * "TP53 KRAS: MUT" two.
 */
function splitBareGenes(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  const m = t.match(/^((?:[A-Za-z0-9.-]+[\s,]+)*)([A-Za-z0-9.-]+\s*:.*)$/);
  if (m) return [...m[1].split(/[\s,]+/).filter(Boolean), m[2].trim()];
  return t.includes(":") ? [t] : t.split(/[\s,]+/).filter(Boolean);
}

/** `symbol` replaced by `by` wherever it stands as a gene in the query text, whatever its case */
export function replaceSymbol(text: string, symbol: string, by: string): string {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return text.replace(new RegExp("(^|[\\s,;\\[\\n])" + esc + "(?=$|[\\s,;:\\]\\n])", "gim"), "$1" + by);
}

/** OQL as this deployment answers it: one example per construct, with what it selects */
export const OQL_HELP: { q: string; means: string }[] = [
  { q: "TP53", means: "any alteration in TP53" },
  { q: "KRAS: MUT", means: "any KRAS mutation" },
  { q: "KRAS: G12C", means: "one protein change (shorthand for MUT=G12C)" },
  { q: "BRAF: MUT=V600E", means: "one protein change" },
  { q: "TP53: TRUNC", means: "truncating mutations; also MISSENSE, NONSENSE, FRAMESHIFT, INFRAME, SPLICE, NONSTART, NONSTOP, PROMOTER" },
  { q: "ERBB2: AMP", means: "amplification (high-level, +2)" },
  { q: "CDKN2A: HOMDEL", means: "deep deletion (−2)" },
  { q: "ALK: FUSION", means: "structural variants" },
  { q: "EGFR: DRIVER", means: "any alteration OncoKB calls oncogenic" },
  { q: "KRAS: MUT_DRIVER AMP", means: "driver mutations, or amplification (space = or)" },
  { q: "BRCA2: TRUNC_(1400-)", means: "truncating mutations from position 1400 on; (a-b), (-b), * for wholly inside" },
];

/** what the deployment refuses, and why — said up front so a pasted portal query is not a surprise */
export const OQL_REFUSED = "Not answered here: GAIN and HETLOSS (only high-level copy number is stored), GERMLINE and SOMATIC (public studies are germline-stripped). Each is refused with that reason rather than approximated.";
