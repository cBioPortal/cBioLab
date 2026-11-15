// THE single owner of what a gene track is.
//
// A gene list entry is either a symbol, drawn as its own row, or a GROUP of symbols drawn as
// one merged row — cBioPortal's `[TP53 MDM2 MDM4]`. A merged row is altered where any member
// is altered, and profiled where any member was profiled, so its denominator is the union of
// the members' panels. Groups do not nest. A symbol's row may carry the portal's OQL line,
// "KRAS: AMP MUT=G12D": it is still the gene's row, drawing only the alterations the line wants.
//
// Everything that needs the flat set of symbols (SQL, the coverage bitmask, every non-oncoprint
// view) goes through `geneSymbols` / `normalizeGeneTracks` rather than reading the list itself,
// so the order the mask bits are assigned in has exactly one definition.

import { parseOql, type OqlSpec } from "./oql-parse.ts";
import { hasOql, oqlSublabel } from "./oql-match.ts";

/** a gene list entry: a symbol (with its OQL line, "KRAS: AMP"), or a merged group of symbols */
export type GeneTrackSpec = string | { label?: string; genes: string[] };
/**
 * One drawn row; `oql`, a single gene's line, the alterations it draws. `key` names the row
 * uniquely, where two rows may share a label (two lines of one gene, as the portal draws them):
 * its entry written back ("KRAS: AMP", "KRAS", a merged row's label), " #2", " #3" for a repeat.
 */
export interface GeneTrack { label: string; members: string[]; oql?: OqlSpec[]; key: string }

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

/** rows: the portal draws a dozen comfortably and the gutter runs out after that */
export const MAX_GENE_TRACKS = 12;
/**
 * distinct symbols: the panel-coverage bitmask is one UInt32 per column, one bit per symbol,
 * which is what keeps coverage cheap to send for 400k columns.
 */
export const MAX_GENE_SYMBOLS = 32;

const clean = (g: unknown): string => String(g ?? "").toUpperCase().trim();
/** the symbol of an entry, less any OQL line */
const symbolOf = (g: unknown): string => clean(String(g ?? "").split(":")[0]);

/** a symbol's row from its entry: its OQL line parsed, refused where this figure cannot draw it */
function geneRow(raw: string): GeneTrack | null {
  if (!raw.includes(":")) {
    const g = clean(raw);
    return GENE_RE.test(g) ? { label: g, members: [g], key: g } : null;
  }
  const entries = parseOql(raw);
  if (entries.length !== 1) throw new Error("gene list: '" + raw.slice(0, 40) + "' is more than one row; give each its own entry");
  const { gene, specs } = entries[0];
  const exp = specs.find((x) => x.type === "EXP" || x.type === "PROT");
  if (exp) throw new Error("gene list: a row's " + exp.type + " ('" + raw.slice(0, 40) + "') is not drawn on the oncoprint yet");
  return hasOql(specs) ? { label: gene, members: [gene], oql: specs, key: gene + oqlSublabel(specs) } : { label: gene, members: [gene], key: gene };
}

/**
 * The drawn rows and the flat symbol list, from an authored gene list.
 *
 * Invalid symbols are dropped, as they always have been. Structural nonsense — a nested group,
 * a group with nothing left in it, an entry that is neither a symbol nor a group — throws,
 * because there is no honest way to guess what was meant.
 */
export function normalizeGeneTracks(list: unknown): { tracks: GeneTrack[]; symbols: string[] } {
  const { tracks, symbols } = geneRows(list);
  return { tracks, symbols };
}

/** each entry's row key, by the entry's position in the list; null for an entry that draws no row */
export function geneRowKeys(list: unknown): (string | null)[] {
  const { tracks, entryOf } = geneRows(list);
  const keys: (string | null)[] = (Array.isArray(list) ? list : []).map(() => null);
  tracks.forEach((t, i) => { keys[entryOf[i]] = t.key; });
  return keys;
}

function geneRows(list: unknown): { tracks: GeneTrack[]; symbols: string[]; entryOf: number[] } {
  const entries = Array.isArray(list) ? list : [];
  const tracks: GeneTrack[] = [];
  const entryOf: number[] = [];
  const symbols: string[] = [];
  const seenSymbol = new Set<string>();
  const take = (g: string) => { if (!seenSymbol.has(g)) { seenSymbol.add(g); symbols.push(g); } };

  for (const [at, raw] of entries.entries()) {
    if (typeof raw === "string" || typeof raw === "number") {
      const t = geneRow(String(raw));
      if (!t) continue;
      tracks.push(t); entryOf.push(at);
      take(t.members[0]);
      continue;
    }
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { genes?: unknown }).genes))
      throw new Error("gene list: an entry must be a gene symbol or {label?, genes: [...]}, got " + JSON.stringify(raw)?.slice(0, 60));
    const g = raw as { label?: unknown; genes: unknown[] };
    if (g.genes.some((m) => m && typeof m === "object"))
      throw new Error("gene list: merged tracks do not nest — flatten " + JSON.stringify(g.genes).slice(0, 60));
    for (const m of g.genes) rejectMergedOql(String(m ?? ""));
    const members = g.genes.map(clean).filter((m) => GENE_RE.test(m)).filter((m, i, a) => a.indexOf(m) === i);
    if (!members.length) throw new Error("gene list: merged track " + JSON.stringify(g.label ?? g.genes).slice(0, 60) + " has no valid gene symbols");
    const label = clean(g.label) ? String(g.label).trim() : members.join(" / ");
    tracks.push({ label, members, key: label }); entryOf.push(at);
    for (const m of members) take(m);
  }

  // a repeated row is drawn again, as the portal draws each line of its query
  const seen = new Map<string, number>();
  for (const t of tracks) {
    const n = (seen.get(t.key) || 0) + 1;
    seen.set(t.key, n);
    if (n > 1) t.key += " #" + n;
  }
  if (tracks.length > MAX_GENE_TRACKS)
    throw new Error("gene list: " + tracks.length + " tracks, and " + MAX_GENE_TRACKS + " is the most this draws — merge some into one row or drop them");
  if (symbols.length > MAX_GENE_SYMBOLS)
    throw new Error("gene list: " + symbols.length + " distinct genes, and " + MAX_GENE_SYMBOLS +
      " is the most panel coverage can be tracked for (one bit per gene in a 32-bit mask)");
  return { tracks, symbols, entryOf };
}

/** just the symbols, flattened and deduplicated — for SQL and for views that do not merge */
export function geneSymbols(list: unknown, opts: { oql?: boolean } = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    // a row's OQL line is the oncoprint's: any other view would draw the whole gene under it
    if (!opts.oql && typeof raw === "string" && raw.includes(":") && raw.split(":")[1].trim())
      throw new Error("genes: '" + raw.slice(0, 40) + "' carries OQL, which only the oncoprint draws; this view draws every alteration of its genes — give the gene alone");
    const members = typeof raw === "string" || typeof raw === "number" ? [symbolOf(raw)]
      : raw && typeof raw === "object" && Array.isArray((raw as { genes?: unknown[] }).genes)
        ? (raw as { genes: unknown[] }).genes.map(clean) : [];
    for (const g of members) if (GENE_RE.test(g) && !seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}

/** does this list ask for any merged row? */
export function hasMergedTracks(list: unknown): boolean {
  return Array.isArray(list) && list.some((e) => e && typeof e === "object" && Array.isArray((e as { genes?: unknown }).genes));
}

/**
 * The portal's own gene-list text, so a query pasted from cBioPortal means here what it means
 * there: symbols separated by whitespace, commas, semicolons or newlines, and `[...]` around a
 * merged group with an optional quoted label first.
 *
 *   TP53 KRAS ["TP53 pathway" TP53 MDM2 MDM4]
 */
export function parseGeneList(text: string): GeneTrackSpec[] {
  const out: GeneTrackSpec[] = [];
  const src = String(text ?? "");
  let i = 0;
  const isSep = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === "," || c === ";";
  const word = (): string => {
    const start = i;
    while (i < src.length && !isSep(src[i]) && src[i] !== "[" && src[i] !== "]") i++;
    return src.slice(start, i);
  };
  // a symbol followed by ":" carries its OQL line, to the next ";" or newline ("TP53:" is bare)
  const withLine = (w: string): string => {
    let gene = w, rest = "";
    if (w.includes(":")) { gene = w.slice(0, w.indexOf(":")); rest = w.slice(w.indexOf(":") + 1); }
    else {
      let j = i;
      while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
      if (src[j] !== ":") return w;
      i = j + 1;
    }
    const end = src.slice(i).search(/[;\n]/);
    const stop = end < 0 ? src.length : i + end;
    rest = (rest + src.slice(i, stop)).trim();
    i = stop;
    return rest ? gene + ": " + rest : gene;
  };
  while (i < src.length) {
    const c = src[i];
    if (isSep(c)) { i++; continue; }
    if (c === "]") throw new Error("gene list: a ']' with no '[' before it, at character " + (i + 1));
    if (c === "[") {
      i++;
      let label: string | undefined;
      while (i < src.length && isSep(src[i])) i++;
      if (src[i] === '"') {
        const end = src.indexOf('"', i + 1);
        if (end < 0) throw new Error("gene list: a merged track's label is missing its closing quote");
        label = src.slice(i + 1, end).trim();
        i = end + 1;
      }
      const genes: string[] = [];
      let closed = false;
      while (i < src.length) {
        if (isSep(src[i])) { i++; continue; }
        if (src[i] === "]") { i++; closed = true; break; }
        if (src[i] === "[") throw new Error("gene list: merged tracks do not nest");
        const w = word();
        if (!w) break;
        genes.push(w);
      }
      if (!closed) throw new Error("gene list: a '[' with no closing ']'");
      if (!genes.length) throw new Error("gene list: an empty merged track '[]'");
      for (const g of genes) rejectMergedOql(g);
      out.push(label ? { label, genes } : { genes });
      continue;
    }
    const w = word();
    if (!w) { i++; continue; }
    out.push(withLine(w));
  }
  return out;
}

/** The portal lets a merged row's genes carry OQL (`[KRAS: AMP NRAS]`); a merged row here draws every alteration of its genes. */
function rejectMergedOql(w: string): void {
  if (w.includes(":"))
    throw new Error("gene list: OQL inside a merged row ('" + w.slice(0, 24) + "') is not supported — a merged row draws " +
      "every alteration of its genes. Give the gene its own row, 'KRAS: AMP'.");
}

/** the inverse of parseGeneList, for an editor that shows the list as text */
export function formatGeneList(list: unknown): string {
  const parts = (Array.isArray(list) ? list : []).map((e) => {
    if (typeof e === "string" || typeof e === "number") {
      const [g, ...line] = String(e).split(":");
      return line.length ? clean(g) + ": " + line.join(":").trim() + ";" : clean(e);
    }
    const g = e as { label?: unknown; genes?: unknown[] };
    const members = (g.genes || []).map(clean);
    const auto = members.join(" / ");
    const label = clean(g.label) && String(g.label).trim() !== auto ? '"' + String(g.label).trim() + '" ' : "";
    return "[" + label + members.join(" ") + "]";
  });
  return parts.join(" ").replace(/;$/, "");
}

/** the canonical authored form of a normalized list, so re-normalizing is a no-op */
export function toGeneList(tracks: GeneTrack[]): GeneTrackSpec[] {
  return tracks.map((t) => t.oql ? t.members[0] + oqlSublabel(t.oql)
    : t.members.length === 1 && t.label === t.members[0] ? t.members[0] : { label: t.label, genes: t.members });
}
