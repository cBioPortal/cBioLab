// THE single owner of what a gene track is.
//
// A gene list entry is either a symbol, drawn as its own row, or a GROUP of symbols drawn as
// one merged row — cBioPortal's `[TP53 MDM2 MDM4]`. A merged row is altered where any member
// is altered, and profiled where any member was profiled, so its denominator is the union of
// the members' panels. Groups do not nest.
//
// Everything that needs the flat set of symbols (SQL, the coverage bitmask, every non-oncoprint
// view) goes through `geneSymbols` / `normalizeGeneTracks` rather than reading the list itself,
// so the order the mask bits are assigned in has exactly one definition.

/** a gene list entry: a symbol, or a merged group of them */
export type GeneTrackSpec = string | { label?: string; genes: string[] };
/** one drawn row */
export interface GeneTrack { label: string; members: string[] }

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

/** rows: the portal draws a dozen comfortably and the gutter runs out after that */
export const MAX_GENE_TRACKS = 12;
/**
 * distinct symbols: the panel-coverage bitmask is one UInt32 per column, one bit per symbol,
 * which is what keeps coverage cheap to send for 400k columns.
 */
export const MAX_GENE_SYMBOLS = 32;

const clean = (g: unknown): string => String(g ?? "").toUpperCase().trim();

/**
 * The drawn rows and the flat symbol list, from an authored gene list.
 *
 * Invalid symbols are dropped, as they always have been. Structural nonsense — a nested group,
 * a group with nothing left in it, an entry that is neither a symbol nor a group — throws,
 * because there is no honest way to guess what was meant.
 */
export function normalizeGeneTracks(list: unknown): { tracks: GeneTrack[]; symbols: string[] } {
  const entries = Array.isArray(list) ? list : [];
  const tracks: GeneTrack[] = [];
  const symbols: string[] = [];
  const seenSymbol = new Set<string>();
  const seenLabel = new Set<string>();
  const take = (g: string) => { if (!seenSymbol.has(g)) { seenSymbol.add(g); symbols.push(g); } };

  for (const raw of entries) {
    if (typeof raw === "string" || typeof raw === "number") {
      const g = clean(raw);
      if (!GENE_RE.test(g)) continue;
      tracks.push({ label: g, members: [g] });
      take(g);
      continue;
    }
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { genes?: unknown }).genes))
      throw new Error("gene list: an entry must be a gene symbol or {label?, genes: [...]}, got " + JSON.stringify(raw)?.slice(0, 60));
    const g = raw as { label?: unknown; genes: unknown[] };
    if (g.genes.some((m) => m && typeof m === "object"))
      throw new Error("gene list: merged tracks do not nest — flatten " + JSON.stringify(g.genes).slice(0, 60));
    const members = g.genes.map(clean).filter((m) => GENE_RE.test(m)).filter((m, i, a) => a.indexOf(m) === i);
    if (!members.length) throw new Error("gene list: merged track " + JSON.stringify(g.label ?? g.genes).slice(0, 60) + " has no valid gene symbols");
    const label = clean(g.label) ? String(g.label).trim() : members.join(" / ");
    tracks.push({ label, members });
    for (const m of members) take(m);
  }

  for (const t of tracks) {
    if (seenLabel.has(t.label)) throw new Error("gene list: two tracks are both labelled '" + t.label + "'");
    seenLabel.add(t.label);
  }
  if (tracks.length > MAX_GENE_TRACKS)
    throw new Error("gene list: " + tracks.length + " tracks, and " + MAX_GENE_TRACKS + " is the most this draws — merge some into one row or drop them");
  if (symbols.length > MAX_GENE_SYMBOLS)
    throw new Error("gene list: " + symbols.length + " distinct genes, and " + MAX_GENE_SYMBOLS +
      " is the most panel coverage can be tracked for (one bit per gene in a 32-bit mask)");
  return { tracks, symbols };
}

/** just the symbols, flattened and deduplicated — for SQL and for views that do not merge */
export function geneSymbols(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const members = typeof raw === "string" || typeof raw === "number" ? [clean(raw)]
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
      for (const g of genes) rejectPerGeneOql(g);
      out.push(label ? { label, genes } : { genes });
      continue;
    }
    const w = word();
    if (!w) { i++; continue; }
    rejectPerGeneOql(w);
    out.push(w);
  }
  return out;
}

/**
 * The portal lets a track carry its own OQL (`TP53: MUT`). This oncoprint draws every alteration
 * type a gene has, so accepting the syntax would quietly mean something weaker than it says.
 */
function rejectPerGeneOql(w: string): void {
  if (w.includes(":"))
    throw new Error("gene list: per-track OQL ('" + w.slice(0, 24) + "') is not supported — an oncoprint track here draws " +
      "every alteration type for its gene. Use a cohort with an OQL clause to restrict the columns instead.");
}

/** the inverse of parseGeneList, for an editor that shows the list as text */
export function formatGeneList(list: unknown): string {
  return (Array.isArray(list) ? list : []).map((e) => {
    if (typeof e === "string" || typeof e === "number") return clean(e);
    const g = e as { label?: unknown; genes?: unknown[] };
    const members = (g.genes || []).map(clean);
    const auto = members.join(" / ");
    const label = clean(g.label) && String(g.label).trim() !== auto ? '"' + String(g.label).trim() + '" ' : "";
    return "[" + label + members.join(" ") + "]";
  }).join(" ");
}

/** the canonical authored form of a normalized list, so re-normalizing is a no-op */
export function toGeneList(tracks: GeneTrack[]): GeneTrackSpec[] {
  return tracks.map((t) => t.members.length === 1 && t.label === t.members[0]
    ? t.members[0] : { label: t.label, genes: t.members });
}
